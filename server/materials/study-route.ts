import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Person, RequestServices } from '../request-context.ts';
import { fail, handledJson, isRecord } from '../http.ts';
import type { openDatabase } from '../db.ts';
import { randomUUID } from 'node:crypto';
import { rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { createAnswerFeedback } from '../answer-feedback.ts';
import type { ServerExtension } from '../extension.ts';
import { quoteSegment } from '../../app/highlight-text.ts';
import type { createProjectStore } from '../projects/store.ts';
import type { createProjectView } from '../projects/view.ts';

type StudyState = Pick<ReturnType<typeof createProjectStore>, 'getState' | 'mutate'> & {
  view: ReturnType<typeof createProjectView>;
};

interface StudyServices extends Pick<RequestServices, 'body' | 'session'>, StudyState {
  q: ReturnType<typeof openDatabase>['q'];
  dir: string;
  currentWs: () => string;
  jobKey: (workspace: string, study: string) => string;
  deletingStudies: Set<string>;
  activeCPU: ReadonlyMap<string, { controller: AbortController; done: Promise<void> }>;
  extension?: Pick<
    ServerExtension,
    'forget' | 'removeFiles' | 'beforeEditTranscript' | 'afterEditTranscript'
  >;
  feedback: Pick<ReturnType<typeof createAnswerFeedback>, 'forgetStudy'>;
}

type HighlightServices = Pick<RequestServices, 'body' | 'limit'> & StudyState;

export async function handleStudy(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  person: Person,
  {
    body,
    session,
    getState,
    mutate,
    view,
    q,
    currentWs,
    jobKey,
    deletingStudies,
    activeCPU,
    dir,
    extension,
    feedback,
  }: StudyServices,
) {
  if (/^\/api\/studies\/[^/]+$/.test(path) && req.method === 'DELETE') {
    if (person.role !== 'full') fail(403, 'Удалять исследования может участник с полным доступом.');
    const id = path.split('/')[3];
    const study = getState().state.studies.find((s) => s.id === id);
    if (!study) fail(404, 'Материал не найден.');
    if (study.summaryInfo?.state === 'queued' || study.summaryInfo?.state === 'running')
      fail(409, 'Дождитесь завершения сводки перед удалением.');
    if (study.findingsInfo?.state === 'queued' || study.findingsInfo?.state === 'running')
      fail(409, 'Дождитесь завершения поиска находок перед удалением.');
    const workspaceId = currentWs(),
      key = jobKey(workspaceId, id);
    if (deletingStudies.has(key)) fail(409, 'Материал уже удаляется. Дождитесь завершения.');
    deletingStudies.add(key);
    try {
      const active = activeCPU.get(key);
      if (active) {
        active.controller.abort();
        await active.done;
      }
      // Access can change while the subprocess is shutting down. Recheck before deletion.
      const latest = await session(req);
      if (!latest || latest.workspaceId !== workspaceId || latest.role !== 'full')
        fail(403, 'Доступ изменился. Удаление недоступно.');
      if (
        q("SELECT 1 FROM mnema_jobs WHERE study_id=? AND workspace_id=? AND status='running'").get(
          id,
          workspaceId,
        )
      )
        fail(409, 'Не удалось остановить обработку. Повторите удаление позже.');
      const discardedJobs = q<{ id: string }>(
        'SELECT id FROM mnema_jobs WHERE study_id=? AND workspace_id=?',
      ).all(id, workspaceId);
      extension?.forget(workspaceId, id);
      feedback.forgetStudy(workspaceId, id);
      q('DELETE FROM mnema_jobs WHERE study_id=? AND workspace_id=?').run(id, workspaceId);
      mutate((s) => {
        s.studies = s.studies.filter((x) => x.id !== id);
        s.findings = s.findings.filter((f) => f.studyId !== id);
        s.highlights = (s.highlights || []).filter((h) => h.studyId !== id);
      });
      for (const job of discardedJobs)
        await rm(join(dir, 'processing', job.id), { recursive: true, force: true });
      await extension?.removeFiles(study);
      if (study.fileId) {
        await unlink(join(dir, 'uploads', study.fileId)).catch(() => {});
        q('DELETE FROM mnema_uploads WHERE id=?').run(study.fileId);
      }
      return handledJson(res, 200, view(latest));
    } finally {
      deletingStudies.delete(key);
    }
  }
  if (/^\/api\/studies\/[^/]+$/.test(path) && req.method === 'PATCH') {
    if (person.role !== 'full')
      fail(403, 'Паспорт исследования может менять участник с полным доступом.');
    const b: unknown = await body(req);
    if (!isRecord(b)) fail(400, 'Проверьте поля паспорта.');
    const p = b.passport || {};
    if (!isRecord(p)) fail(400, 'Проверьте поля паспорта.');
    const id = path.split('/')[3];
    const current = getState();
    if (b.version !== undefined && b.version !== current.version)
      fail(409, 'Материалы изменились в другой вкладке. Обновите страницу и повторите действие.');
    if (!current.state.studies.some((s) => s.id === id)) fail(404, 'Материал не найден.');
    const fields: Record<string, string> = {};
    for (const [k, max] of [
      ['title', 140],
      ['description', 1000],
      ['method', 120],
      ['audience', 1000],
      ['author', 120],
      ['conducted', 40],
    ] as const) {
      const value = p[k];
      if (value !== undefined) {
        if (typeof value !== 'string' || value.trim().length > max)
          fail(400, 'Слишком длинное поле паспорта.');
        fields[k] = value.trim();
      }
    }
    if (fields.title === '') fail(400, 'Укажите название исследования.');
    if (p.type !== undefined) {
      if (
        typeof p.type !== 'string' ||
        !['Интервью', 'Юзабилити-тест', 'Встреча', 'Отчёт'].includes(p.type)
      )
        fail(400, 'Неизвестный тип источника.');
      fields.type = p.type;
    }
    if (p.report !== undefined) {
      if (p.report !== 'ready' && p.report !== 'none') fail(400, 'Статус отчёта: есть или нет.');
      fields.report = p.report;
    }
    if (p.reportExpected !== undefined) {
      if (
        typeof p.reportExpected !== 'string' ||
        (p.reportExpected !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(p.reportExpected))
      )
        fail(400, 'Дата отчёта — в формате ГГГГ-ММ-ДД.');
      fields.reportExpected = p.reportExpected;
    }
    mutate((s) => {
      const item = s.studies.find((x) => x.id === id);
      if (item) Object.assign(item, fields, { updatedBy: person.name, updatedAt: Date.now() });
    });
    return handledJson(res, 200, view(person));
  }
  if (/^\/api\/studies\/[^/]+\/transcript\/[^/]+$/.test(path) && req.method === 'PATCH') {
    if (person.role !== 'full') fail(403, 'Исправлять текст может участник с полным доступом.');
    const b: unknown = await body(req),
      study = getState().state.studies.find((s) => s.id === path.split('/')[3]);
    if (!study) fail(404, 'Материал не найден.');
    if (study.summaryInfo?.state === 'queued' || study.summaryInfo?.state === 'running')
      fail(409, 'Дождитесь сводки перед исправлением текста.');
    const seg = study.segments?.find((s) => s.id === path.split('/')[5]);
    if (!seg) fail(404, 'Фрагмент не найден.');
    if (!isRecord(b) || typeof b.text !== 'string' || !b.text.trim() || b.text.length > 4000)
      fail(400, 'Введите исправленный текст до 4000 символов.');
    const correctedText = b.text.trim();
    if (b.before !== undefined && b.before !== (seg.correctedText ?? seg.text))
      fail(409, 'Фрагмент изменился. Откройте его заново и повторите правку.');
    extension?.beforeEditTranscript(seg);
    mutate((s) => {
      const target = s.studies.find((x) => x.id === study.id);
      const part = target?.segments.find((x) => x.id === seg.id);
      if (!target || !part) fail(404, 'Фрагмент не найден.');
      target.transcriptEdits = [
        ...(target.transcriptEdits || []),
        {
          segmentId: part.id,
          before: part.correctedText ?? part.text,
          after: correctedText,
          by: person.name,
          at: Date.now(),
        },
      ].slice(-1000);
      part.correctedText = correctedText;
      extension?.afterEditTranscript(part);
      target.summary = [];
      target.summaryInfo = undefined;
    });
    return handledJson(res, 200, view(person));
  }
  return false;
}

export async function handleHighlights(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  person: Person,
  { body, limit, getState, mutate, view }: HighlightServices,
) {
  // Highlights: a quote a person marked in the material. The text must be in the transcript; readers see them, cannot change them.
  if (/^\/api\/studies\/[^/]+\/highlights$/.test(path) && req.method === 'POST') {
    if (person.role !== 'full') fail(403, 'Отмечать фрагменты может участник с полным доступом.');
    const b: unknown = await body(req);
    if (!isRecord(b)) fail(400, 'Выделите хотя бы несколько слов.');
    const { state } = getState();
    const study = state.studies.find((s) => s.id === path.split('/')[3]);
    if (!study) fail(404, 'Материал не найден.');
    const quote = String(b.text || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (quote.length < 3) fail(400, 'Выделите хотя бы несколько слов.');
    if (quote.length > 2000) fail(400, 'Выделите фрагмент короче 2 000 символов.');
    const segmentId = quoteSegment(study.segments || [], quote, {
      segmentId: typeof b.segmentId === 'string' ? b.segmentId : undefined,
      page: typeof b.page === 'number' && Number.isInteger(b.page) ? b.page : undefined,
    });
    if (!segmentId)
      fail(400, 'Не нашли этот текст в расшифровке материала. Выделите фрагмент заново.');
    if ((state.highlights || []).filter((h) => h.studyId === study.id).length >= 500)
      fail(400, 'В материале уже 500 отметок. Удалите лишние.');
    limit('highlight:' + person.id, 120);
    const page = study.segments.find((s) => s.id === segmentId)?.page;
    const item = {
      id: randomUUID(),
      studyId: study.id,
      segmentId,
      text: quote,
      ...(typeof page === 'number' && Number.isInteger(page) ? { page } : {}),
      by: person.name,
      byId: person.id,
      at: Date.now(),
    };
    mutate((s) => {
      s.highlights = [...(s.highlights || []), item];
    });
    return handledJson(res, 201, { ...view(person), createdHighlightId: item.id });
  }
  if (/^\/api\/studies\/[^/]+\/highlights\/[^/]+$/.test(path) && req.method === 'DELETE') {
    if (person.role !== 'full') fail(403, 'Удалять отметки может участник с полным доступом.');
    const [, , , studyId, , id] = path.split('/');
    if (!(getState().state.highlights || []).some((h) => h.id === id && h.studyId === studyId))
      fail(404, 'Отметка уже удалена.');
    mutate((s) => {
      s.highlights = (s.highlights || []).filter((h) => h.id !== id);
    });
    return handledJson(res, 200, view(person));
  }
  return false;
}
