import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { WorkspaceReader } from './projects/store.ts';

type Member = { id: string; role: string };
type Person = { id: string; workspaces: Member[] };
type Reference = { workspaceId: string; studyId: string; segmentId: string; revision: string };
type Example = {
  scope: 'project' | 'global';
  question: string;
  answer: string;
  model: string;
  modelId?: string;
  projectIds: string[];
  references: Reference[];
  kind: 'generated' | 'no-evidence';
};
type Receipt = Example & {
  id: string;
  author: string;
  grants: Member[];
  build: string;
  issued: number;
};

function reject(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}

export function createAnswerFeedback(
  db: DatabaseSync,
  secret: string,
  build: string,
  readProject?: (person: Person, workspaceId: string) => any[],
  readWorkspace?: WorkspaceReader,
) {
  db.exec(`CREATE TABLE IF NOT EXISTS mnema_answer_feedback(
    answer_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, rating TEXT NOT NULL CHECK(rating IN ('up','down')),
    example TEXT NOT NULL, updated INTEGER NOT NULL
  )`);
  const sign = (content: string) =>
    createHmac('sha256', secret).update('answer-feedback:v1:').update(content).digest();
  const revision = (text: string) =>
    createHmac('sha256', secret)
      .update('answer-feedback:source:v1:')
      .update(text)
      .digest('base64url');
  function issue(
    person: Person,
    {
      references: originals,
      ...example
    }: Omit<Example, 'references'> & {
      references: (Omit<Reference, 'revision'> & { text: string })[];
    },
  ) {
    const grants = [...new Set(example.projectIds)].map((id) => {
      const member = person.workspaces.find((w) => w.id === id);
      if (!member) reject(403, 'Доступ к проекту изменился.');
      return { id, role: member.role };
    });
    const references = originals.map(({ text, ...ref }) => ({ ...ref, revision: revision(text) }));
    const receipt: Receipt = {
      ...example,
      references,
      grants,
      author: person.id,
      id: randomUUID(),
      issued: Date.now(),
      build,
    };
    if (!readableSources(person, receipt)) reject(409, 'Источники или доступ к ним изменились.');
    const content = Buffer.from(JSON.stringify(receipt)).toString('base64url');
    return content + '.' + sign(content).toString('base64url');
  }
  function readableSources(person: Person, example: Example, cache = new Map<string, any[]>()) {
    return example.references.every((ref) => {
      // Older receipts cannot establish which text the model received.
      if (!ref.revision) return false;
      if (!cache.has(ref.workspaceId)) {
        const studies = readProject
          ? readProject(person, ref.workspaceId)
          : JSON.parse(
              String(
                db.prepare('SELECT data FROM mnema_workspaces WHERE id=?').get(ref.workspaceId)
                  ?.data || '{"studies":[]}',
              ),
            ).studies;
        cache.set(ref.workspaceId, studies);
      }
      const segment = cache
        .get(ref.workspaceId)
        ?.find((study) => study.id === ref.studyId)
        ?.segments?.find((segment) => segment.id === ref.segmentId);
      return Boolean(segment && revision(segment.correctedText ?? segment.text) === ref.revision);
    });
  }
  function rate(person: Person, token: unknown, rating: unknown) {
    if (rating !== 'up' && rating !== 'down' && rating !== null) reject(400, 'Неизвестная оценка.');
    if (typeof token !== 'string') reject(400, 'Ответ не найден.');
    const parts = token.split('.');
    const signature = Buffer.from(parts[1] || '', 'base64url');
    if (
      parts.length !== 2 ||
      signature.length !== 32 ||
      !timingSafeEqual(signature, sign(parts[0]))
    )
      reject(403, 'Не удалось проверить ответ.');
    const example: Receipt = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (example.author !== person.id) reject(403, 'Это ответ другого пользователя.');
    if (rating === null) {
      db.prepare('DELETE FROM mnema_answer_feedback WHERE answer_id=? AND user_id=?').run(
        example.id,
        person.id,
      );
      return { rating: null };
    }
    for (const grant of example.grants) {
      const current = person.workspaces.find((w) => w.id === grant.id);
      if (!current || (grant.role === 'full' && current.role !== 'full'))
        reject(403, 'Доступ к проекту изменился.');
    }
    if (!readableSources(person, example)) reject(409, 'Источники или доступ к ним изменились.');
    db.prepare(
      `INSERT INTO mnema_answer_feedback VALUES(?,?,?,?,?)
      ON CONFLICT(answer_id) DO UPDATE SET rating=excluded.rating,updated=excluded.updated`,
    ).run(example.id, person.id, rating as string, JSON.stringify(example), Date.now());
    return { rating };
  }
  function forgetStudy(workspaceId: string, studyId: string) {
    db.prepare(
      `DELETE FROM mnema_answer_feedback WHERE EXISTS (
      SELECT 1 FROM json_each(example,'$.references') r
      WHERE json_extract(r.value,'$.workspaceId')=? AND json_extract(r.value,'$.studyId')=?
    )`,
    ).run(workspaceId, studyId);
  }
  // Admin review: newest ratings with author name, project names and source titles; tokens and signatures stay out.
  function list(person: Person) {
    const lookup =
      readWorkspace ??
      ((id: string) => {
        const row = db.prepare('SELECT name,data FROM mnema_workspaces WHERE id=?').get(id);
        return row && { name: String(row.name), state: JSON.parse(String(row.data)) };
      });
    const cache = new Map<
        string,
        { name: string; studies: { id: string; title?: string }[] } | null
      >(),
      visible = new Map<string, any[]>();
    const ws = (id: string) => {
      if (!cache.has(id)) {
        const row = lookup(id);
        cache.set(
          id,
          row ? { name: String(row.name || ''), studies: row.state.studies || [] } : null,
        );
      }
      return cache.get(id);
    };
    return (
      db
        .prepare(
          `SELECT f.answer_id,f.rating,f.updated,f.example,u.name AS user_name FROM mnema_answer_feedback f
      LEFT JOIN user u ON u.id=f.user_id ORDER BY f.updated DESC LIMIT 200`,
        )
        .all() as any[]
    ).flatMap((row) => {
      const e: Receipt = JSON.parse(String(row.example));
      if (
        e.grants.some((grant) => {
          const current = person.workspaces.find((w) => w.id === grant.id);
          return !current || (grant.role === 'full' && current.role !== 'full');
        }) ||
        !readableSources(person, e, visible)
      )
        return [];
      const sources = [
        ...new Map(e.references.map((r) => [r.workspaceId + '/' + r.studyId, r])).values(),
      ].map((r) => ({
        projectId: r.workspaceId,
        studyId: r.studyId,
        title:
          ws(r.workspaceId)?.studies.find((s) => s.id === r.studyId)?.title || 'Материал удалён',
      }));
      return [
        {
          id: String(row.answer_id),
          rating: row.rating as 'up' | 'down',
          updated: Number(row.updated),
          userName: row.user_name ? String(row.user_name) : 'Пользователь удалён',
          question: e.question,
          answer: e.answer,
          model: e.model,
          kind: e.kind,
          scope: e.scope,
          projects: e.projectIds.map((id) => ({ id, name: ws(id)?.name || 'Проект удалён' })),
          sources,
        },
      ];
    });
  }
  return { issue, rate, forgetStudy, list };
}
