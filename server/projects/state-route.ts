import type { IncomingMessage, ServerResponse } from 'node:http';
import { fail, handledJson, isRecord, text } from '../http.ts';
import type { Person, RequestServices } from '../request-context.ts';
import { materialActivity } from '../../app/material-activity.ts';
import type { Processor, Study } from '../../app/types.ts';
import {
  cleanModel,
  keySlot as slotPattern,
  modelBase,
  type modelKeyStore,
} from '../model-connections.ts';
import type { reviewFinding } from '../analysis/review.ts';
import type { ProjectSnapshot, createProjectStore } from './store.ts';
import type { ProjectProfile, StoredModel, StoredWorkspace } from './types.ts';
import type { createProjectView } from './view.ts';

interface ProjectStateServices
  extends
    Pick<RequestServices, 'body' | 'session'>,
    Pick<ReturnType<typeof createProjectStore>, 'mutate'> {
  currentWs: () => string;
  getState: () => ProjectSnapshot;
  view: ReturnType<typeof createProjectView>;
  transcriptPreviews: ReadonlyMap<string, NonNullable<Study['transcriptPreview']>>;
  jobKey: (workspace: string, study: string) => string;
  findingStatuses: ReadonlySet<string>;
  importanceLevels: readonly string[];
  modelKeys: ReturnType<typeof modelKeyStore>;
  isBuiltin: (model: Pick<StoredModel, 'id' | 'builtin'>) => boolean;
  reviewFinding: typeof reviewFinding;
  syncModels: (workspace: string) => void;
}

const isProcessor = (value: unknown): value is Processor =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.name === 'string' &&
  typeof value.description === 'string' &&
  typeof value.enabled === 'boolean' &&
  (value.mode === undefined || typeof value.mode === 'string') &&
  (value.configured === undefined || typeof value.configured === 'boolean');

export async function handleProjectState(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  person: Person,
  {
    body,
    session,
    currentWs,
    getState,
    mutate,
    view,
    transcriptPreviews,
    jobKey,
    findingStatuses,
    importanceLevels,
    modelKeys,
    isBuiltin,
    reviewFinding,
    syncModels,
  }: ProjectStateServices,
) {
  if (path === '/api/workspaces/' + currentWs() + '/profile' && req.method === 'PATCH') {
    const input: unknown = await body(req),
      latest = await session(req);
    if (!latest || latest.workspaceId !== currentWs() || latest.role !== 'full')
      fail(403, 'Редактировать сведения может участник с полным доступом.');
    const limits = {
      category: 80,
      conducted: 100,
      method: 200,
      audience: 10000,
      contact: 200,
      report: 10,
    };
    if (!isRecord(input)) fail(400, 'Проверьте поля проекта.');
    const fields = input.fields;
    if (
      !isRecord(fields) ||
      Object.keys(fields).some((key) => !Object.hasOwn(limits, key) && key !== 'tags')
    )
      fail(400, 'Проверьте поля проекта.');
    let tags: string[] | undefined;
    if (fields.tags !== undefined) {
      if (!Array.isArray(fields.tags) || fields.tags.length > 20)
        fail(400, 'Тегов может быть до 20, каждый до 40 символов.');
      tags = [
        ...new Set(
          fields.tags.map((tag: unknown) => {
            if (typeof tag !== 'string' || !tag.trim() || tag.length > 40)
              fail(400, 'Тегов может быть до 20, каждый до 40 символов.');
            return tag.trim();
          }),
        ),
      ];
    }
    for (const [key, max] of Object.entries(limits)) {
      const value = fields[key];
      if (typeof value !== 'string' || value.length > max)
        fail(400, 'Проверьте значение поля проекта.');
    }
    if (fields.report !== '' && fields.report !== 'ready' && fields.report !== 'none')
      fail(400, 'Выберите статус отчёта.');
    mutate((state) => {
      const revision = state.projectProfile?.revision || 0;
      if (input.revision !== revision)
        fail(409, 'Сведения изменились. Откройте редактирование заново.');
      // Tags are optional so older clients keep the saved ones.
      const savedTags = tags ?? state.projectProfile?.tags;
      state.projectProfile = {
        ...(Object.fromEntries(
          Object.keys(limits).map((key) => [key, (fields[key] as string).trim()]),
        ) as Omit<ProjectProfile, 'tags' | 'revision'>),
        ...(savedTags ? { tags: savedTags } : {}),
        revision: revision + 1,
      };
    });
    return handledJson(res, 200, view(latest));
  }
  if (path === '/api/state' && req.method === 'GET') {
    const data = view(person);
    for (const study of data.state.studies) {
      if (
        study.status !== 'processing' ||
        study.segments?.length ||
        (study.importSource?.catalog && person.role !== 'full')
      )
        continue;
      const preview = transcriptPreviews.get(jobKey(currentWs(), study.id));
      if (preview) {
        study.transcriptPreview = preview;
        study.activity = materialActivity(study);
      }
    }
    return handledJson(res, 200, data);
  }
  if (path === '/api/state' && req.method === 'PATCH') {
    if (person.role !== 'full') fail(403, 'У вас доступ только для просмотра.');
    const b: unknown = await body(req);
    const current = getState();
    if (!isRecord(b) || b.version !== current.version)
      fail(409, 'Материалы изменились в другой вкладке. Обновите страницу и повторите действие.');
    const changes = b.changes === undefined ? {} : b.changes;
    if (!isRecord(changes)) fail(400, 'Проверьте параметры изменения проекта.');
    // Models are one team-wide setting: only account administrators change them.
    const allowed = [
      'findings',
      ...(person.admin ? ['processors'] : []),
      ...(person.owner ? ['models', 'modelId'] : []),
    ];
    if (Object.keys(changes).some((k) => !allowed.includes(k)))
      fail(403, 'Недостаточно прав для этого изменения.');
    let incomingFindings: Parameters<typeof reviewFinding>[0][] | undefined;
    if (changes.findings !== undefined) {
      if (!Array.isArray(changes.findings) || changes.findings.length > 10000)
        fail(400, 'Некорректные находки.');
      incomingFindings = changes.findings.map((f: unknown) => {
        if (!isRecord(f) || typeof f.studyId !== 'string' || typeof f.segmentId !== 'string')
          fail(400, 'Находке нужен существующий фрагмент источника.');
        const study = current.state.studies.find((s) => s.id === f.studyId);
        if (!study || !study.segments?.some((t) => t.id === f.segmentId))
          fail(400, 'Находке нужен существующий фрагмент источника.');
        if (
          f.evidence !== undefined &&
          (!Array.isArray(f.evidence) ||
            f.evidence.some((id: unknown) => !study.segments.some((t) => t.id === id)))
        )
          fail(400, 'Доказательства находки должны быть фрагментами того же материала.');
        if (
          typeof f.title !== 'string' ||
          !text(f.title, 160) ||
          f.title.length > 160 ||
          String(f.description || '').length > (f.importSource ? 28000 : 4000)
        )
          fail(400, 'Сократите текст находки.');
        if (
          f.status !== undefined &&
          (typeof f.status !== 'string' || !findingStatuses.has(f.status))
        )
          fail(400, 'Неизвестный статус находки.');
        if (
          f.importance !== undefined &&
          (typeof f.importance !== 'string' || !importanceLevels.includes(f.importance))
        )
          fail(400, 'Важность: Критично, Высокая, Средняя или Низкая.');
        return { ...f, studyId: f.studyId, segmentId: f.segmentId };
      });
    }
    const patch: Partial<Pick<StoredWorkspace, 'findings' | 'models' | 'modelId' | 'processors'>> =
      {};
    if (changes.models !== undefined) {
      if (!Array.isArray(changes.models) || changes.models.length > 20)
        fail(400, 'Не больше 20 подключений.');
      // A built-in connection that works stays (it can be switched off); one without a model or key may be removed.
      const builtinReady = (m: StoredModel) =>
        Boolean(m.model) &&
        (modelKeys.has(currentWs(), m.id) ||
          (slotPattern.test(m.keyRef || '') && Boolean(process.env[m.keyRef])));
      for (const m of current.state.models.filter(isBuiltin))
        if (builtinReady(m) && !changes.models.some((x: unknown) => isRecord(x) && x.id === m.id))
          fail(400, 'Работающее встроенное подключение нельзя удалить, его можно выключить.');
      const seen = new Set<string>();
      patch.models = changes.models.map((m: unknown) => {
        if (!isRecord(m)) fail(400, 'Проверьте параметры подключения.');
        if (m.apiKey !== undefined || m.sealed !== undefined)
          fail(400, 'API-ключ сохраняется только через настройки подключения.');
        if (typeof m.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(m.id) || seen.has(m.id))
          fail(400, 'Проверьте идентификаторы подключений.');
        seen.add(m.id);
        const prev = current.state.models.find((x) => x.id === m.id),
          next = cleanModel(m, prev, true);
        if (
          prev &&
          modelKeys.has(currentWs(), m.id) &&
          (modelBase(prev) !== modelBase(next) ||
            (prev.apiType !== next.apiType && Boolean(prev.apiType || next.apiType)))
        )
          fail(400, 'При смене поставщика сохраните новый ключ в настройках подключения.');
        return { ...next, builtin: isBuiltin(prev || { id: '' }) };
      });
      if (patch.models.filter((m) => m.reserve).length > 1)
        fail(400, 'Резервной может быть только одна модель.');
    }
    if (incomingFindings) {
      const now = Date.now();
      const previous = new Map(current.state.findings.map((f) => [f.id, f]));
      const seen = new Set<string>();
      patch.findings = incomingFindings.map((f) => {
        const prev = typeof f.id === 'string' ? previous.get(f.id) : undefined;
        const next = reviewFinding(f, prev, person, now);
        if (seen.has(next.id)) fail(400, 'Находка указана дважды.');
        seen.add(next.id);
        return next;
      });
    }
    if (changes.processors !== undefined) {
      if (!Array.isArray(changes.processors) || !changes.processors.every(isProcessor))
        fail(400, 'Проверьте параметры обработчиков.');
      patch.processors = changes.processors;
    }
    if (changes.modelId !== undefined) {
      if (typeof changes.modelId !== 'string') fail(400, 'Проверьте выбранное подключение.');
      patch.modelId = changes.modelId;
    }
    mutate((s) => {
      if (patch.models) {
        const models = patch.models;
        for (const old of s.models)
          if (!models.some((m) => m.id === old.id)) modelKeys.remove(currentWs(), old.id);
      }
      Object.assign(s, patch);
      if (!s.models.some((m) => m.id === s.modelId && m.enabled))
        s.modelId = s.models.find((m) => m.enabled)?.id || '';
      return s;
    });
    if (patch.models || patch.modelId !== undefined) syncModels(currentWs());
    return handledJson(res, 200, view(person));
  }
  return false;
}
