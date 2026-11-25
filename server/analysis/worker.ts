import type { AsyncLocalStorage } from 'node:async_hooks';
import type { openDatabase } from '../db.ts';
import type { createProjectSharing } from '../project-sharing.ts';
import { requestSummary, type AnalysisRequest, type AnalysisResponse } from '../summary-request.ts';
import { summarizeMaterial, transcriptRevision } from '../summaries.ts';
import {
  extractFindings,
  dedupeWithModel,
  type ExtractedFinding,
  type DedupePlan,
} from '../finding-extraction.ts';
import type { createProjectStore } from '../projects/store.ts';
import type {
  StoredFinding,
  StoredModel,
  StoredStudy,
  StoredWorkspace,
} from '../projects/types.ts';

interface AnalysisWorkerServices extends Pick<
  ReturnType<typeof createProjectStore>,
  'getState' | 'mutate'
> {
  q: ReturnType<typeof openDatabase>['q'];
  fromTables: boolean;
  wsStore: Pick<AsyncLocalStorage<string>, 'run'>;
  sharing: Pick<ReturnType<typeof createProjectSharing>, 'projects'>;
  currentWs: () => string;
  callModel: (
    person: { id: string },
    model: StoredModel,
    payload: AnalysisRequest,
  ) => Promise<AnalysisResponse>;
  deletingStudies: ReadonlySet<string>;
  jobKey: (workspace: string, study: string) => string;
  hash: (value: string) => string;
}

type AnalysisTask = { workspaceId: string; studyId: string; kind: 'summary' | 'findings' };
export function createAnalysisWorker({
  q,
  fromTables,
  wsStore,
  getState,
  mutate,
  currentWs,
  callModel,
  sharing,
  deletingStudies,
  jobKey,
  hash,
}: AnalysisWorkerServices) {
  let analysisBusy = false;
  const processSummary = async (
    study: StoredStudy,
    job: NonNullable<StoredStudy['summaryInfo']>,
  ) => {
    const info = { ...job },
      revision = transcriptRevision(study.segments || []);
    if (revision !== info.revision)
      throw new Error('Расшифровка изменилась. Создайте сводку заново.');
    const member = sharing
      .projects(info.requestedBy)
      .find((w: { id: string }) => w.id === currentWs());
    if (member?.role !== 'full')
      throw new Error('Доступ изменился. Попросите участника с полным доступом создать сводку.');
    const model = getState().state.models.find((m) => m.id === info.modelId && m.enabled);
    if (!model) throw new Error('Модель выключена. Выберите подключённую модель и повторите.');
    mutate((s) => {
      const target = s.studies.find((x) => x.id === study.id);
      if (target?.summaryInfo) target.summaryInfo.state = 'running';
    });
    const summary = await summarizeMaterial(
      study.segments,
      study.title,
      (payload) =>
        requestSummary(
          model.model,
          payload,
          (request) => callModel({ id: info.requestedBy }, model, request),
          () =>
            mutate((s) => {
              const target = s.studies.find((x) => x.id === study.id);
              if (target?.summaryInfo)
                target.summaryInfo.progress =
                  (target.summaryInfo.progress || 'Анализируем материал') + ' · Повтор ответа';
            }),
        ),
      (progress) =>
        mutate((s) => {
          const target = s.studies.find((x) => x.id === study.id);
          if (target?.summaryInfo) target.summaryInfo.progress = progress;
        }),
    );
    // Findings are a separate pass over the whole text; if it fails, the summary blocks become drafts as before.
    let extracted: DedupePlan | null = null;
    if (info.autoFindings) {
      try {
        const items = await runExtraction(study, model, info.requestedBy, (progress) =>
          mutate((s) => {
            const t = s.studies.find((x) => x.id === study.id);
            if (t?.summaryInfo) t.summaryInfo.progress = progress;
          }),
        );
        mutate((s) => {
          const t = s.studies.find((x) => x.id === study.id);
          if (t?.summaryInfo) t.summaryInfo.progress = 'Ищем повторы';
        });
        extracted = await planFindings(study, items, model, info.requestedBy);
      } catch (e) {
        console.error('Findings pass failed, using summary blocks', e.code || e.status || e.name);
      }
    }
    mutate((s) => {
      const target = s.studies.find((x) => x.id === study.id);
      if (!target) return;
      if (transcriptRevision(target.segments) !== revision)
        throw new Error('Расшифровка изменилась. Повторите создание сводки.');
      target.summary = summary;
      target.summaryInfo = {
        ...info,
        state: 'ready',
        review: 'draft',
        model: model.name,
        finishedAt: Date.now(),
        progress: null,
        error: null,
      };
      if (info.autoFindings) {
        if (extracted) applyFindingsPlan(s, study.id, revision, extracted, model.name);
        else {
          const now = Date.now();
          for (const [i, block] of summary.entries()) {
            const id = 'sf-' + hash(study.id + ':' + revision + ':' + i).slice(0, 32);
            if (s.findings.some((f) => f.id === id)) continue;
            s.findings.push({
              id,
              studyId: study.id,
              segmentId: block.segments[0],
              ...(block.segments.length > 1 ? { evidence: block.segments.slice(1, 9) } : {}),
              title: block.title.slice(0, 160),
              description: block.text,
              kind: 'Инсайт',
              importance: 'Средняя',
              significant: false,
              origin: 'ai',
              status: 'draft',
              createdAt: now,
              createdBy: model.name,
              history: [{ action: 'suggested', status: 'draft', by: model.name, at: now }],
            });
          }
        }
      }
    });
  };
  const runExtraction = (
    study: StoredStudy,
    model: StoredModel,
    requestedBy: string,
    onProgress: (progress: string) => void,
  ) =>
    extractFindings(
      study.segments,
      { title: study.title, type: study.type },
      (payload) =>
        requestSummary(model.model, payload, (request) =>
          callModel({ id: requestedBy }, model, request),
        ),
      onProgress,
    );
  // Semantic duplicates: the model groups new candidates with the material's findings; on failure — word matching.
  const knownFindings = (state: StoredWorkspace, studyId: string) =>
    state.findings
      .filter((f) => f.studyId === studyId)
      .map((f) => ({
        id: f.id,
        title: f.title,
        description: f.description,
        kind: f.kind,
        importance: f.importance,
        status: f.status || 'draft',
        origin: f.origin || 'human',
        segmentId: f.segmentId,
        evidence: f.evidence,
      }));
  const planFindings = (
    study: StoredStudy,
    items: ExtractedFinding[],
    model: StoredModel,
    requestedBy: string,
  ) =>
    dedupeWithModel(
      items,
      knownFindings(getState().state, study.id),
      (payload) =>
        requestSummary(model.model, payload, (request) =>
          callModel({ id: requestedBy }, model, request),
        ),
      (reason) => console.error('Findings dedupe fallback', reason),
    );
  // Stable IDs per transcript revision: a repeated run does not duplicate drafts. Only AI drafts that are still drafts are merged or removed.
  const applyFindingsPlan = (
    s: StoredWorkspace,
    studyId: string,
    revision: string,
    plan: DedupePlan,
    modelName: string,
  ) => {
    const now = Date.now();
    let added = 0,
      merged = plan.merged;
    const draft = (f: StoredFinding | undefined): f is StoredFinding =>
      Boolean(f && f.studyId === studyId && f.status === 'draft' && f.origin === 'ai');
    for (const u of plan.update) {
      const f = s.findings.find((x) => x.id === u.id);
      if (draft(f)) {
        const evidence = u.evidence.filter((id) => id !== f.segmentId).slice(0, 8);
        if (evidence.length) f.evidence = evidence;
      }
    }
    const removable = new Set(
      plan.remove.filter((id) => draft(s.findings.find((x) => x.id === id))),
    );
    merged -= plan.remove.length - removable.size;
    s.findings = s.findings.filter((f) => !removable.has(f.id));
    for (const item of plan.add) {
      const id = 'af-' + hash(studyId + ':' + revision + ':' + item.title).slice(0, 32);
      if (s.findings.some((f) => f.id === id)) continue;
      s.findings.push({
        id,
        studyId,
        segmentId: item.segments[0],
        ...(item.segments.length > 1 ? { evidence: item.segments.slice(1) } : {}),
        title: item.title,
        description: item.description,
        kind: item.kind,
        importance: item.importance,
        ...(item.reason ? { reason: item.reason } : {}),
        significant: false,
        origin: 'ai',
        status: 'draft',
        createdAt: now,
        createdBy: modelName,
        history: [{ action: 'suggested', status: 'draft', by: modelName, at: now }],
      });
      added++;
    }
    return { added, merged };
  };
  const processFindings = async (
    study: StoredStudy,
    job: NonNullable<StoredStudy['findingsInfo']>,
  ) => {
    const info = { ...job },
      revision = transcriptRevision(study.segments || []);
    if (revision !== info.revision)
      throw new Error('Расшифровка изменилась. Запустите поиск находок заново.');
    const requestedBy = info.requestedBy;
    const member = requestedBy && sharing.projects(requestedBy).find((w) => w.id === currentWs());
    if (!member || member.role !== 'full' || !requestedBy)
      throw new Error('Доступ изменился. Попросите участника с полным доступом повторить поиск.');
    const model = getState().state.models.find((m) => m.id === info.modelId && m.enabled);
    if (!model) throw new Error('Модель выключена. Выберите подключённую модель и повторите.');
    const setInfo = (patch: Partial<NonNullable<StoredStudy['findingsInfo']>>) =>
      mutate((s) => {
        const t = s.studies.find((x) => x.id === study.id);
        if (t?.findingsInfo) t.findingsInfo = { ...t.findingsInfo, ...patch };
      });
    setInfo({ state: 'running', progress: 'Ищем находки' });
    const items = await runExtraction(study, model, requestedBy, (progress) =>
      setInfo({ progress }),
    );
    setInfo({ progress: 'Ищем повторы' });
    const plan = await planFindings(study, items, model, requestedBy);
    mutate((s) => {
      const t = s.studies.find((x) => x.id === study.id);
      if (!t) return;
      if (transcriptRevision(t.segments) !== revision)
        throw new Error('Расшифровка изменилась. Запустите поиск находок заново.');
      const { added, merged } = applyFindingsPlan(s, study.id, revision, plan, model.name);
      t.findingsInfo = {
        ...info,
        state: 'ready',
        progress: null,
        error: null,
        found: items.length,
        added,
        merged,
        dedupe: plan.method,
        model: model.name,
        finishedAt: Date.now(),
      };
    });
  };
  const nextSummary = (): AnalysisTask | null => {
    if (fromTables) {
      const queued = q<AnalysisTask>(
        'SELECT j.workspace_id AS workspaceId,j.study_id AS studyId,j.kind FROM mnema_analysis_jobs j ' +
          'JOIN mnema_workspaces w ON w.id=j.workspace_id ' +
          'JOIN mnema_studies s ON s.workspace_id=j.workspace_id AND s.id=j.study_id ' +
          "WHERE j.status='queued' ORDER BY w.rowid,j.kind DESC,s.seq",
      ).all();
      return (
        queued.find((task) => !deletingStudies.has(jobKey(task.workspaceId, task.studyId))) ?? null
      );
    }
    for (const ws of q<{ id: string; data: string }>(
      'SELECT id,data FROM mnema_workspaces',
    ).all()) {
      const { studies: saved } = JSON.parse(ws.data) as Pick<StoredWorkspace, 'studies'>;
      const studies = saved.filter((s) => !deletingStudies.has(jobKey(ws.id, s.id)));
      const study = studies.find((s) => s.summaryInfo?.state === 'queued');
      if (study) return { workspaceId: ws.id, studyId: study.id, kind: 'summary' };
      const search = studies.find((s) => s.findingsInfo?.state === 'queued');
      if (search) return { workspaceId: ws.id, studyId: search.id, kind: 'findings' };
    }
    return null;
  };
  return async function runAnalysis() {
    if (analysisBusy) return;
    const task = nextSummary();
    if (!task) return;
    analysisBusy = true;
    try {
      await wsStore.run(task.workspaceId, async () => {
        const study = getState().state.studies.find((s) => s.id === task.studyId);
        if (!study) return;
        if (task.kind === 'findings') {
          if (!study.findingsInfo) return;
          try {
            await processFindings(study, study.findingsInfo);
          } catch (e) {
            const code =
              e.code || (e.status === 429 ? 'limit' : e.status >= 500 ? 'unavailable' : 'unknown');
            console.error('Findings failed', code, e.name, e.status || '');
            const error =
              code === 'too_large'
                ? 'Материал слишком большой: разделите его на несколько файлов.'
                : code === 'limit'
                  ? 'Лимит обращений к модели исчерпан. Обратитесь к владельцу проекта.'
                  : code === 'unavailable'
                    ? 'Модель не отвечает. Попробуйте позже — материал и находки сохранены.'
                    : code === 'truncated' || code === 'format' || code === 'empty'
                      ? 'Модель вернула неполный ответ. Попробуйте ещё раз.'
                      : String(e.message || '').startsWith('Расшифровка') ||
                          String(e.message || '').startsWith('Доступ') ||
                          String(e.message || '').startsWith('Модель выключена')
                        ? e.message
                        : 'Не удалось найти находки. Попробуйте ещё раз.';
            mutate((s) => {
              const t = s.studies.find((x) => x.id === task.studyId);
              if (t)
                t.findingsInfo = {
                  ...t.findingsInfo,
                  state: 'error',
                  progress: null,
                  errorCode: code,
                  error,
                };
            });
          }
          return;
        }
        if (!study.summaryInfo) return;
        try {
          await processSummary(study, study.summaryInfo);
        } catch (e) {
          const code =
            e.code || (e.status === 429 ? 'limit' : e.status >= 500 ? 'unavailable' : 'unknown');
          console.error('Summary failed', code, e.name, e.status || '');
          const publicError =
            code === 'too_large'
              ? 'Разделите материал на несколько файлов и создайте сводку для каждого.'
              : code === 'limit'
                ? 'Лимит обращений к модели исчерпан. Обратитесь к управляющему пространством.'
                : code === 'not_ready'
                  ? 'Дождитесь расшифровки и попробуйте ещё раз.'
                  : code === 'truncated'
                    ? 'Модель вернула неполный ответ. Текст сохранён. Повторите анализ.'
                    : code === 'unavailable'
                      ? 'Сервис сводок не отвечает. Попробуйте позже. Материал и расшифровка сохранены.'
                      : 'Материал и расшифровка сохранены. Попробуйте ещё раз.';
          mutate((s) => {
            const target = s.studies.find((x) => x.id === task.studyId);
            if (target?.summaryInfo)
              target.summaryInfo = {
                ...target.summaryInfo,
                state: 'error',
                errorCode: code,
                error: publicError,
              };
          });
        }
      });
    } finally {
      analysisBusy = false;
    }
  };
}
