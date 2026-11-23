import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Person, RequestServices } from '../request-context.ts';
import { fail, handledJson, isRecord, text } from '../http.ts';
import type { openDatabase } from '../db.ts';
import { sourceURL, importedSegments, importFindings } from '../imports.ts';
import type {
  WorkspaceReader,
  createProjectStore,
  createWorkspaceFactory,
  initialState,
} from '../projects/store.ts';
import type { StoredModel } from '../projects/types.ts';
import { transcriptRevision } from '../summaries.ts';

interface ImportServices
  extends
    Pick<RequestServices, 'body' | 'limit'>,
    Pick<ReturnType<typeof createProjectStore>, 'getState' | 'mutate'> {
  q: ReturnType<typeof openDatabase>['q'];
  quota: number;
  currentWs: () => string;
  readWorkspace: WorkspaceReader;
  initialState: typeof initialState;
  createProject: ReturnType<typeof createWorkspaceFactory>;
  modelKey: (model: StoredModel) => string | null | undefined;
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
    readWorkspace,
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
      files: getState().state.studies.flatMap((s) =>
        s.importSource?.provider === 'external' && s.importSource.fileId
          ? [{ sourceId: s.importSource.fileId, studyId: s.id, ready: s.status === 'ready' }]
          : [],
      ),
    });
  }
  if (path === '/api/imports/source/project' && req.method === 'POST') {
    if (!person.admin) fail(403, 'Перенос доступен владельцу проекта.');
    const b: unknown = await body(req);
    if (!isRecord(b)) fail(400, 'Проверьте параметры переноса.');
    const url = sourceURL(b.url),
      name = text(b.name, 60);
    const mode = b.mode === undefined ? 'all' : b.mode;
    if (mode !== 'private' && mode !== 'all' && mode !== 'link')
      fail(400, 'Выберите способ доступа к проекту.');
    if (!name) fail(400, 'Назовите проект.');
    for (const w of person.workspaces.filter((w) => w.admin)) {
      if (readWorkspace(w.id)?.state.importSource?.url === url)
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
    };
    const id = createProject(name, person, mode, st);
    return handledJson(res, 201, { id, name });
  }
  if (path === '/api/imports/source/material' && req.method === 'POST') {
    if (!person.admin) fail(403, 'Перенос доступен владельцу проекта.');
    const b: unknown = await body(req);
    if (!isRecord(b)) fail(400, 'Проверьте параметры переноса.');
    const segments = importedSegments(b.segments),
      url = sourceURL(b.url);
    const found = getState().state.studies.find(
      (s) => s.id === b.studyId && s.importSource?.provider === 'external',
    );
    if (!found) fail(404, 'Сначала загрузите исходный файл в этот проект.');
    if (q("SELECT 1 FROM mnema_jobs WHERE study_id=? AND status='running'").get(found.id))
      fail(409, 'Дождитесь завершения обработки файла.');
    const passport = isRecord(b.passport) ? b.passport : {};
    mutate((st) => {
      const item = st.studies.find((s) => s.id === found.id);
      if (!item?.importSource) fail(404, 'Материал не найден.');
      item.segments = segments;
      item.status = 'ready';
      item.progress = null;
      item.error = null;
      item.duration =
        typeof b.duration === 'number' && Number.isFinite(b.duration) ? Math.max(0, b.duration) : 0;
      item.summary = [];
      item.summaryInfo = undefined;
      item.importSource = { ...item.importSource, url, transcriptImported: true };
      for (const k of ['conducted', 'method', 'audience', 'author', 'description'] as const) {
        const value = passport[k];
        if (typeof value === 'string') item[k] = value.slice(0, 10000);
      }
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
    const b: unknown = await body(req);
    if (!isRecord(b)) fail(400, 'Проверьте карточки находок.');
    let result: ReturnType<typeof importFindings> | undefined;
    mutate((st) => {
      result = importFindings(st, b.items, person);
    });
    return handledJson(res, 200, result);
  }
  return false;
}
