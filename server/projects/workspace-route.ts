import type { IncomingMessage, ServerResponse } from 'node:http';
import { fail, handledJson, isRecord, text } from '../http.ts';
import type { Person, RequestServices } from '../request-context.ts';
import type { AsyncLocalStorage } from 'node:async_hooks';
import { rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { openDatabase } from '../db.ts';
import type { createProjectSharing } from '../project-sharing.ts';
import type { createAnswerFeedback } from '../answer-feedback.ts';
import type { WorkspaceReader, createWorkspaceFactory, initialState } from './store.ts';
import type { InviteToProject } from './types.ts';
import type { ServerExtension } from '../extension.ts';

interface WorkspaceServices extends RequestServices {
  production: boolean;
  sharing: ReturnType<typeof createProjectSharing>;
  wsStore: Pick<AsyncLocalStorage<string>, 'run'>;
  inviteToProject: InviteToProject;
  q: ReturnType<typeof openDatabase>['q'];
  db: Pick<ReturnType<typeof openDatabase>['db'], 'exec'>;
  dir: string;
  readWorkspace: WorkspaceReader;
  uploadBusy: ReadonlySet<string>;
  feedback: Pick<ReturnType<typeof createAnswerFeedback>, 'forgetStudy'>;
  extension?: Pick<ServerExtension, 'removeFiles'>;
  initialState: typeof initialState;
  createProject: ReturnType<typeof createWorkspaceFactory>;
}

export async function handleWorkspace(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  person: Person,
  {
    body,
    session,
    limit,
    production,
    sharing,
    wsStore,
    inviteToProject,
    q,
    db,
    dir,
    readWorkspace,
    uploadBusy,
    feedback,
    extension,
    initialState,
    createProject,
  }: WorkspaceServices,
) {
  if (/^\/api\/workspaces\/[^/]+\/share$/.test(path) && req.method === 'POST') {
    limit('project-share:' + person.id, 30);
    const id = path.split('/')[3],
      input: unknown = await body(req);
    if (!isRecord(input) || typeof input.token !== 'string' || !sharing.validLink(id, input.token))
      fail(
        403,
        'Ссылка недействительна или доступ закрыт. Попросите владельца прислать новую ссылку.',
      );
    const cookies = res.getHeader('Set-Cookie') as string | string[] | undefined;
    res.setHeader('Set-Cookie', [
      ...(Array.isArray(cookies) ? cookies : cookies ? [cookies] : []),
      'mnema_share_' +
        id +
        '=' +
        input.token +
        '; Path=/api; HttpOnly; SameSite=Lax; Max-Age=604800' +
        (production ? '; Secure' : ''),
    ]);
    return handledJson(res, 200, { id });
  }
  {
    const match = path.match(
      /^\/api\/workspaces\/([^/]+)\/sharing(?:\/(members)(?:\/([^/]+))?|\/(link\/rotate))?$/,
    );
    if (match) {
      const [, id, members, memberId, rotate] = match;
      if (!sharing.canManage(id, person.id))
        fail(403, 'Управлять доступом может только владелец проекта.');
      if (req.method === 'GET' && !members && !rotate)
        return handledJson(res, 200, sharing.info(id, person.id));
      limit('project-sharing:' + person.id, 60);
      const input: unknown = await body(req),
        latest = await session(req);
      if (!latest || !sharing.canManage(id, latest.id)) fail(403, 'Доступ к проекту изменился.');
      if (!isRecord(input)) fail(400, 'Проверьте параметры доступа к проекту.');
      if (req.method === 'PATCH' && !members && !rotate)
        return handledJson(res, 200, sharing.setMode(id, latest.id, input.mode));
      if (req.method === 'POST' && rotate)
        return handledJson(res, 200, sharing.rotate(id, latest.id));
      if (members && memberId && (req.method === 'PATCH' || req.method === 'DELETE'))
        return handledJson(
          res,
          200,
          sharing.member(
            id,
            latest.id,
            memberId,
            req.method === 'PATCH' ? (input.role ?? null) : undefined,
          ),
        );
      if (members && !memberId && req.method === 'POST')
        return await wsStore.run(id, async () => {
          const result = await inviteToProject(
            { ...latest, workspaceId: id, admin: true, role: 'full' },
            {
              ...input,
              name: text(input.name, 70) || text(input.email, 150).split('@')[0],
              scope: 'project',
            },
          );
          return handledJson(res, 201, { ...sharing.info(id, latest.id), ...result });
        });
      fail(405, 'Метод недоступен.');
    }
  }

  if (
    /^\/api\/workspaces\/[^/]+(?:\/invitations)?$/.test(path) &&
    (req.method === 'PATCH' || req.method === 'DELETE' || req.method === 'POST')
  ) {
    const id = path.split('/')[3],
      target = person.workspaces.find((w) => w.id === id);
    if (!target?.admin) fail(403, 'Управление проектом доступно его владельцу.');
    const b: unknown = await body(req);
    // The request body is asynchronous: recheck membership before the mutation.
    const latest = await session(req);
    if (!latest || !latest.workspaces.some((w) => w.id === id && w.admin))
      fail(403, 'Доступ к проекту изменился.');
    if (!isRecord(b)) fail(400, 'Проверьте поля проекта.');
    return await wsStore.run(id, async () => {
      if (path.endsWith('/invitations') && req.method === 'POST')
        return handledJson(
          res,
          201,
          await inviteToProject(
            { ...latest, workspaceId: id, admin: true, role: 'full' },
            { ...b, scope: 'project' },
          ),
        );
      if (path.endsWith('/invitations')) fail(405, 'Метод недоступен.');
      if (req.method === 'PATCH') {
        if (typeof b.name !== 'string' || !b.name.trim() || b.name.trim().length > 60)
          fail(400, 'Укажите название от 1 до 60 символов.');
        q('UPDATE mnema_workspaces SET name=?,version=version+1 WHERE id=?').run(b.name.trim(), id);
        return handledJson(res, 200, { ok: true });
      }
      if (req.method !== 'DELETE') fail(405, 'Метод недоступен.');
      const project = readWorkspace(id);
      if (!project) fail(404, 'Проект не найден.');
      const { state } = project;
      if (b.name !== project.name)
        fail(409, 'Название проекта изменилось. Обновите страницу и повторите удаление.');
      if (
        q("SELECT 1 FROM mnema_jobs WHERE workspace_id=? AND status='running'").get(id) ||
        state.studies.some(
          (s) =>
            s.summaryInfo?.state === 'queued' ||
            s.summaryInfo?.state === 'running' ||
            s.findingsInfo?.state === 'queued' ||
            s.findingsInfo?.state === 'running',
        )
      )
        fail(409, 'Дождитесь завершения обработки в проекте и повторите удаление.');
      const sessions = q<{ id: string; metadata: string }>(
        'SELECT id,metadata FROM mnema_upload_sessions',
      )
        .all()
        .filter((s) => JSON.parse(s.metadata).workspaceId === id);
      if (
        sessions.some(
          (s) =>
            uploadBusy.has(s.id) ||
            q("SELECT 1 FROM mnema_uploads WHERE id=? AND status='uploading'").get(s.id),
        )
      )
        fail(409, 'Завершите или отмените загрузку файлов в проект и повторите удаление.');
      const jobs = q<{ id: string }>('SELECT id FROM mnema_jobs WHERE workspace_id=?').all(id);
      const fileIds = [...new Set(state.studies.flatMap((s) => (s.fileId ? [s.fileId] : [])))];
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const study of state.studies) feedback.forgetStudy(id, study.id);
        q(
          "DELETE FROM mnema_answer_feedback WHERE EXISTS(SELECT 1 FROM json_each(mnema_answer_feedback.example,'$.projectIds') WHERE value=?)",
        ).run(id);
        for (const item of sessions) q('DELETE FROM mnema_upload_sessions WHERE id=?').run(item.id);
        for (const file of fileIds) q('DELETE FROM mnema_uploads WHERE id=?').run(file);
        for (const table of [
          'mnema_jobs',
          'mnema_completion_mail',
          'mnema_model_keys',
          'mnema_invites',
          'mnema_members',
        ])
          q('DELETE FROM ' + table + ' WHERE workspace_id=?').run(id);
        // Clear the obsolete single-workspace snapshot too, so a restart cannot restore deleted data.
        if (id === 'main')
          q('UPDATE mnema_workspace SET data=? WHERE id=1').run(JSON.stringify(initialState()));
        q('DELETE FROM mnema_workspaces WHERE id=?').run(id);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      for (const file of fileIds) await unlink(join(dir, 'uploads', file)).catch(() => {});
      if (extension) for (const study of state.studies) await extension.removeFiles(study);
      for (const item of sessions)
        await unlink(join(dir, 'uploads', item.id + '.part')).catch(() => {});
      for (const job of jobs)
        await rm(join(dir, 'processing', job.id), { recursive: true, force: true });
      return handledJson(res, 200, { ok: true });
    });
  }
  if (path === '/api/workspaces' && req.method === 'POST') {
    limit('workspace:' + person.id, 5);
    const b: unknown = await body(req);
    if (!isRecord(b)) fail(400, 'Проверьте поля проекта.');
    const name = text(b.name, 60);
    const mode = b.mode === undefined ? 'all' : b.mode;
    if (mode !== 'private' && mode !== 'all' && mode !== 'link')
      fail(400, 'Выберите способ доступа к проекту.');
    if (!name) fail(400, 'Назовите проект.');
    if (person.workspaces.filter((w) => w.admin).length >= 20)
      fail(409, 'Можно создать не больше 20 проектов.');
    const id = createProject(name, person, mode);
    return handledJson(res, 201, { id, name });
  }
  return false;
}
