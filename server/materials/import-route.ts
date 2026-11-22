import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Person, RequestServices } from '../request-context.ts';
import { fail, handledJson, text } from '../http.ts';
import type { openDatabase } from '../db.ts';
import { sourceURL, importedSegments, importFindings } from '../imports.ts';
import { transcriptRevision } from '../summaries.ts';

interface ImportServices extends Pick<RequestServices, 'body' | 'limit'> {
  q: ReturnType<typeof openDatabase>['q'];
  quota: number;
  currentWs: () => string;
  getState: () => { state: any };
  initialState: () => { importSource: unknown };
  createProject: (name: string, person: Person, mode: string, state: any) => string;
  mutate: (change: (state: any) => void) => unknown;
  modelKey: (model: any) => string | undefined;
  deletingStudies: ReadonlySet<string>;
  jobKey: (workspace: string, study: string) => string;
}

export async function handleImports(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  person: Person,
  {
    q,
    quota,
    currentWs,
    getState,
    body,
    initialState,
    createProject,
    mutate,
    modelKey,
    limit,
    deletingStudies,
    jobKey,
  }: ImportServices,
) {
  if (path === '/api/imports/source/status' && req.method === 'GET') {
    if (!person.admin) fail(403, 'Перенос доступен владельцу проекта.');
    const used = q(
      "SELECT coalesce(sum(size),0) AS n FROM mnema_uploads WHERE status IN ('ready','uploading')",
    ).get().n;
    return handledJson(res, 200, {
      workspaceId: currentWs(),
      quota,
      used,
      files: getState()
        .state.studies.filter(
          (s) => s.importSource?.provider === 'external' && s.importSource.fileId,
        )
        .map((s) => ({
          sourceId: s.importSource.fileId,
          studyId: s.id,
          ready: s.status === 'ready',
        })),
    });
  }
  if (path === '/api/imports/source/project' && req.method === 'POST') {
    if (!person.admin) fail(403, 'Перенос доступен владельцу проекта.');
    const b = await body(req),
      url = sourceURL(b.url),
      name = text(b.name, 60);
    if (b.mode !== undefined && !['private', 'all', 'link'].includes(b.mode))
      fail(400, 'Выберите способ доступа к проекту.');
    if (!name) fail(400, 'Назовите проект.');
    for (const w of person.workspaces.filter((w) => w.admin)) {
      const raw = q('SELECT data FROM mnema_workspaces WHERE id=?').get(w.id);
      if (JSON.parse(raw.data).importSource?.url === url)
        return handledJson(res, 200, { id: w.id, name: w.name });
    }
    if (person.workspaces.filter((w) => w.admin).length >= 20)
      fail(409, 'Можно создать не больше 20 проектов.');
    const st = initialState();
    st.importSource = {
      provider: 'external',
      url,
      text: String(b.text || '').slice(0, 50000),
      importedBy: person.id,
      importedAt: Date.now(),
    } as any;
    const id = createProject(name, person, b.mode || 'all', st);
    return handledJson(res, 201, { id, name });
  }
  if (path === '/api/imports/source/material' && req.method === 'POST') {
    if (!person.admin) fail(403, 'Перенос доступен владельцу проекта.');
    const b = await body(req),
      segments = importedSegments(b.segments),
      url = sourceURL(b.url);
    const found = getState().state.studies.find(
      (s) => s.id === b.studyId && s.importSource?.provider === 'external',
    );
    if (!found) fail(404, 'Сначала загрузите исходный файл в этот проект.');
    if (q("SELECT 1 FROM mnema_jobs WHERE study_id=? AND status='running'").get(found.id))
      fail(409, 'Дождитесь завершения обработки файла.');
    const passport = b.passport || {};
    mutate((st) => {
      const item = st.studies.find((s) => s.id === found.id);
      item.segments = segments;
      item.status = 'ready';
      item.progress = null;
      item.error = null;
      item.duration = Number.isFinite(b.duration) ? Math.max(0, b.duration) : 0;
      item.summary = [];
      item.summaryInfo = undefined;
      item.importSource = { ...item.importSource, url, transcriptImported: true };
      for (const k of ['conducted', 'method', 'audience', 'author', 'description'])
        if (typeof passport[k] === 'string') item[k] = passport[k].slice(0, 10000);
      item.report = passport.report === 'ready' ? 'ready' : 'none';
      if (
        typeof passport.reportExpected === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(passport.reportExpected)
      )
        item.reportExpected = passport.reportExpected;
      item.tags = ['Импорт'];
    });
    return handledJson(res, 200, { ok: true, studyId: found.id });
  }
  if (path === '/api/imports/source/analyze' && req.method === 'POST') {
    if (!person.admin) fail(403, 'Обработка доступна владельцу проекта.');
    await body(req);
    const st = getState().state;
    if (st.importSource?.provider !== 'external') fail(409, 'Выберите перенесённый проект.');
    const model = st.models.find((m) => m.id === st.modelId && m.enabled);
    if (!model || !modelKey(model)) fail(503, 'Подключите модель для анализа исходников.');
    limit('import-analysis:' + person.id, 60);
    let queued = 0;
    mutate((s) => {
      for (const item of s.studies)
        if (
          !deletingStudies.has(jobKey(currentWs(), item.id)) &&
          item.importSource?.fileId &&
          item.status === 'ready' &&
          item.segments?.length &&
          !item.summaryInfo
        ) {
          item.summaryInfo = {
            state: 'queued',
            review: 'draft',
            revision: transcriptRevision(item.segments),
            modelId: model.id,
            requestedBy: person.id,
            startedAt: Date.now(),
            autoFindings: true,
          };
          queued++;
        }
    });
    return handledJson(res, 202, { queued });
  }
  if (path === '/api/imports/source/findings' && req.method === 'POST') {
    if (!person.admin) fail(403, 'Перенос доступен владельцу проекта.');
    const b = await body(req);
    let result;
    mutate((st) => {
      result = importFindings(st, b.items, person);
    });
    return handledJson(res, 200, result);
  }
  return false;
}
