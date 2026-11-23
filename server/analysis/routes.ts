import type { IncomingMessage, ServerResponse } from 'node:http';
import { fail, handledJson, isRecord } from '../http.ts';
import type { Person, RequestServices } from '../request-context.ts';
import { answerSystem, requestChatAnswer } from '../model-connections.ts';
import { answerTemplate } from '../chat/prompt.ts';
import { selectEvidence } from '../retrieval.ts';
import { transcriptRevision } from '../summaries.ts';
import { studiesForReader, summaryFindingsRevision, summarySourcesMatch } from './evidence.ts';
import type { legacyFinding, reportOf } from './review.ts';
import type { createProjectStore } from '../projects/store.ts';
import type { createProjectView } from '../projects/view.ts';
import type { StoredModel, StoredWorkspace } from '../projects/types.ts';
import type { AnalysisRequest, AnalysisResponse } from '../summary-request.ts';
import type { Basis } from '../../app/types.ts';

interface AnalysisServices
  extends RequestServices, Pick<ReturnType<typeof createProjectStore>, 'getState' | 'mutate'> {
  view: ReturnType<typeof createProjectView>;
  currentWs: () => string;
  deletingStudies: ReadonlySet<string>;
  jobKey: (workspace: string, study: string) => string;
  modelKey: (model: StoredModel) => string | null | undefined;
  callModel: (
    person: Person,
    model: StoredModel,
    payload: AnalysisRequest,
  ) => Promise<AnalysisResponse>;
  reportOf: typeof reportOf;
  legacyFinding: typeof legacyFinding;
}

export async function handleMaterialSummary(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  person: Person,
  {
    body,
    getState,
    currentWs,
    deletingStudies,
    jobKey,
    mutate,
    view,
    modelKey,
    limit,
  }: Pick<
    AnalysisServices,
    | 'body'
    | 'getState'
    | 'currentWs'
    | 'deletingStudies'
    | 'jobKey'
    | 'mutate'
    | 'view'
    | 'modelKey'
    | 'limit'
  >,
) {
  if (/^\/api\/studies\/[^/]+\/summary(?:\/verify)?$/.test(path) && req.method === 'POST') {
    if (person.role !== 'full')
      fail(403, 'Создавать и проверять сводки может участник с полным доступом.');
    const b: unknown = await body(req);
    const { state } = getState();
    const study = state.studies.find((s) => s.id === path.split('/')[3]);
    if (!study) fail(404, 'Материал не найден.');
    if (deletingStudies.has(jobKey(currentWs(), study.id)))
      fail(409, 'Материал удаляется. Дождитесь завершения.');
    if (path.endsWith('/verify')) {
      if (
        study.summaryInfo?.state !== 'ready' ||
        !study.summary?.length ||
        study.summaryInfo.revision !== transcriptRevision(study.segments)
      )
        fail(409, 'Сводка устарела или ещё не готова. Дождитесь результата или обновите сводку.');
      mutate((s) => {
        const target = s.studies.find((x) => x.id === study.id);
        if (target?.summaryInfo) target.summaryInfo.review = 'verified';
      });
      return handledJson(res, 200, view(person));
    }
    if (study.summaryInfo?.state === 'queued' || study.summaryInfo?.state === 'running')
      return handledJson(res, 202, view(person));
    if (study.status !== 'ready' || !study.segments?.length)
      fail(409, 'Сначала дождитесь расшифровки материала.');
    if (!isRecord(b)) fail(400, 'Проверьте параметры сводки.');
    const model = state.models.find((m) => m.id === (b.modelId || state.modelId) && m.enabled);
    if (!model || !modelKey(model)) fail(503, 'Выберите подключённую модель в настройках.');
    limit('summary:' + person.id, 3);
    mutate((s) => {
      const target = s.studies.find((x) => x.id === study.id);
      if (!target) fail(404, 'Материал не найден.');
      target.summaryInfo = {
        state: 'queued',
        review: 'draft',
        revision: transcriptRevision(study.segments),
        modelId: model.id,
        requestedBy: person.id,
        startedAt: Date.now(),
      };
    });
    return handledJson(res, 202, view(person));
  }
  return false;
}

export async function handleFindings(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  person: Person,
  {
    body,
    getState,
    currentWs,
    deletingStudies,
    jobKey,
    mutate,
    view,
    limit,
  }: Pick<
    AnalysisServices,
    'body' | 'getState' | 'currentWs' | 'deletingStudies' | 'jobKey' | 'mutate' | 'view' | 'limit'
  >,
) {
  if (/^\/api\/studies\/[^/]+\/suggest-findings$/.test(path) && req.method === 'POST') {
    if (person.role !== 'full') fail(403, 'Предлагать находки может участник с полным доступом.');
    await body(req);
    const { state } = getState();
    const study = state.studies.find((s) => s.id === path.split('/')[3]);
    if (!study) fail(404, 'Материал не найден.');
    if (deletingStudies.has(jobKey(currentWs(), study.id)))
      fail(409, 'Материал удаляется. Дождитесь завершения.');
    if (!study.segments?.length) fail(409, 'Дождитесь, пока материал будет обработан.');
    const model =
      state.models.find((m) => m.id === state.modelId && m.enabled) ||
      state.models.find((m) => m.enabled);
    if (!model) fail(400, 'Включите модель в разделе «Модели».');
    if (study.findingsInfo?.state === 'queued' || study.findingsInfo?.state === 'running')
      return handledJson(res, 202, view(person));
    limit('suggest:' + person.id, 6);
    mutate((s) => {
      const t = s.studies.find((x) => x.id === study.id);
      if (t)
        t.findingsInfo = {
          state: 'queued',
          progress: 'В очереди',
          modelId: model.id,
          requestedBy: person.id,
          revision: transcriptRevision(t.segments),
          startedAt: Date.now(),
        };
    });
    return handledJson(res, 202, view(person));
  }
  return false;
}

export async function handleProjectSummary(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  person: Person,
  {
    body,
    getState,
    view,
    modelKey,
    limit,
    session,
    reportOf,
    legacyFinding,
    callModel,
    mutate,
  }: Pick<
    AnalysisServices,
    | 'body'
    | 'getState'
    | 'view'
    | 'modelKey'
    | 'limit'
    | 'session'
    | 'reportOf'
    | 'legacyFinding'
    | 'callModel'
    | 'mutate'
  >,
) {
  if (path === '/api/project-summary' && req.method === 'POST') {
    // Build the shared summary from the same evidence a project reader can see.
    if (person.role !== 'full') fail(403, 'Собирать сводку может участник с полным доступом.');
    limit('project-summary:' + person.id, 5);
    await body(req);
    const { state } = getState();
    const model = state.models.find((m) => m.id === state.modelId && m.enabled);
    if (!model || !modelKey(model) || !model.model)
      fail(400, 'Подключите модель в настройках проекта.');
    const corpus = view({ ...person, role: 'view' }).state;
    if (!corpus.studies.some((s) => s.status === 'ready'))
      fail(409, 'Дождитесь обработки материалов.');
    const question = 'Обзор проекта';
    const { sources, coverage, reviewedFindings } = selectEvidence(
      corpus.studies,
      question,
      'all',
      corpus.findings,
    );
    if (!sources.length) fail(409, 'В материалах пока нет текста для сводки.');
    const evidence = sources.map(({ score, ...s }, i) => {
      const st = state.studies.find((x) => x.id === s.studyId);
      const basis: Basis = reportOf(st) === 'ready' ? 'report' : 'raw';
      return {
        ...s,
        number: i + 1,
        segmentId: s.id,
        studyType: st?.type,
        basis,
      };
    });
    const reviewedRevision = reviewedFindings.length
      ? summaryFindingsRevision(corpus.findings)
      : null;
    const requireCurrentEvidence = (current: StoredWorkspace) => {
      const findings = current.findings.map(legacyFinding);
      const studies = studiesForReader(current.studies, findings);
      if (
        !summarySourcesMatch(studies, evidence) ||
        (reviewedRevision && reviewedRevision !== summaryFindingsRevision(findings))
      )
        fail(409, 'Источники сводки изменились. Создайте сводку заново.');
    };
    const result: AnalysisResponse = await requestChatAnswer(
      model,
      {
        model: model.model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: answerSystem(answerTemplate, model.instructions) },
          {
            role: 'user',
            content: JSON.stringify({
              question,
              coverage,
              reviewed_findings: reviewedFindings,
              instruction:
                'Дай 3–5 главных выводов исследования короткими пунктами списка, без заголовков и разделов. Каждый пункт опирается на источники.' +
                (coverage.sampled
                  ? ' Доступна выборка фрагментов проекта, не утверждай, что изучил все материалы целиком.'
                  : ''),
              sources: evidence.map((s) => ({
                number: s.number,
                type: s.studyType,
                basis: s.basis,
                title: s.title,
                time: s.time,
                page: s.page,
                speaker: s.speaker,
                text: s.text,
                ...(s.uncertain && s.correctedText === undefined ? { uncertain: true } : {}),
              })),
            }),
          },
        ],
      },
      async (payload) => {
        const current = await session(req);
        if (!current || current.workspaceId !== person.workspaceId || current.role !== 'full')
          fail(409, 'Доступ к проекту изменился. Обновите страницу.');
        requireCurrentEvidence(getState().state);
        return callModel(current, model, payload);
      },
    );
    const answer = result.choices?.[0]?.message?.content;
    if (typeof answer !== 'string' || !answer.trim())
      fail(502, 'Модель вернула неожиданный ответ. Повторите попытку.');
    const latest = await session(req);
    if (!latest || latest.workspaceId !== person.workspaceId || latest.role !== 'full')
      fail(409, 'Доступ к проекту изменился. Обновите страницу.');
    const summary = {
      answer,
      sources: evidence,
      reviewedRevision,
      model: (result.mnemaModel || model).name,
      at: Date.now(),
      materials: coverage.included,
      fragments: coverage.fragments,
      totalFragments: coverage.totalFragments,
    };
    mutate((s) => {
      requireCurrentEvidence(s);
      s.projectSummary = summary;
    });
    return handledJson(res, 200, view(latest));
  }
  return false;
}
