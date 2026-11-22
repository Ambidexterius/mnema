import type { IncomingMessage, ServerResponse } from 'node:http';
import { fail, handledJson, text } from '../http.ts';
import type { Person, RequestServices } from '../request-context.ts';
import { materialActivity } from '../../app/material-activity.ts';
import type { Study } from '../../app/types.ts';
import {
  cleanModel,
  keySlot as slotPattern,
  modelBase,
  type modelKeyStore,
} from '../model-connections.ts';

interface ProjectStateServices extends Pick<RequestServices, 'body' | 'session'> {
  currentWs: () => string;
  getState: () => { state: any; version: number };
  mutate: (change: (state: any) => void) => unknown;
  view: (person: Person) => { state: any };
  transcriptPreviews: ReadonlyMap<string, NonNullable<Study['transcriptPreview']>>;
  jobKey: (workspace: string, study: string) => string;
  findingStatuses: ReadonlySet<string>;
  importanceLevels: readonly string[];
  modelKeys: ReturnType<typeof modelKeyStore>;
  isBuiltin: (model: any) => boolean;
  reviewFinding: (finding: any, previous: any, person: Person, now: number) => { id: string };
  syncModels: (workspace: string) => void;
}

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
    const input = await body(req),
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
    const fields = input?.fields;
    if (
      !fields ||
      typeof fields !== 'object' ||
      Array.isArray(fields) ||
      Object.keys(fields).some((key) => !Object.hasOwn(limits, key) && key !== 'tags')
    )
      fail(400, 'Проверьте поля проекта.');
    if (
      fields.tags !== undefined &&
      (!Array.isArray(fields.tags) ||
        fields.tags.length > 20 ||
        fields.tags.some((tag) => typeof tag !== 'string' || !tag.trim() || tag.length > 40))
    )
      fail(400, 'Тегов может быть до 20, каждый до 40 символов.');
    for (const [key, max] of Object.entries(limits)) {
      if (typeof fields[key] !== 'string' || fields[key].length > max)
        fail(400, 'Проверьте значение поля проекта.');
    }
    if (!['', 'ready', 'none'].includes(fields.report)) fail(400, 'Выберите статус отчёта.');
    mutate((state) => {
      const revision = state.projectProfile?.revision || 0;
      if (input.revision !== revision)
        fail(409, 'Сведения изменились. Откройте редактирование заново.');
      // Tags are optional so older clients keep the saved ones.
      const tags = fields.tags
        ? [...new Set(fields.tags.map((tag) => tag.trim()))]
        : state.projectProfile?.tags;
      state.projectProfile = {
        ...Object.fromEntries(Object.keys(limits).map((key) => [key, fields[key].trim()])),
        ...(tags ? { tags } : {}),
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
    const b = await body(req);
    const current = getState();
    if (b.version !== current.version)
      fail(409, 'Материалы изменились в другой вкладке. Обновите страницу и повторите действие.');
    const changes = b.changes || {};
    // Models are one team-wide setting: only account administrators change them.
    const allowed = [
      'findings',
      ...(person.admin ? ['processors'] : []),
      ...(person.owner ? ['models', 'modelId'] : []),
    ];
    if (Object.keys(changes).some((k) => !allowed.includes(k)))
      fail(403, 'Недостаточно прав для этого изменения.');
    if (changes.findings) {
      if (!Array.isArray(changes.findings) || changes.findings.length > 10000)
        fail(400, 'Некорректные находки.');
      for (const f of changes.findings) {
        const study = current.state.studies.find((s) => s.id === f.studyId);
        if (!study || !study.segments?.some((t) => t.id === f.segmentId))
          fail(400, 'Находке нужен существующий фрагмент источника.');
        if (
          f.evidence !== undefined &&
          (!Array.isArray(f.evidence) ||
            f.evidence.some((id) => !study.segments.some((t) => t.id === id)))
        )
          fail(400, 'Доказательства находки должны быть фрагментами того же материала.');
        if (
          !text(f.title, 160) ||
          f.title.length > 160 ||
          String(f.description || '').length > (f.importSource ? 28000 : 4000)
        )
          fail(400, 'Сократите текст находки.');
        if (f.status !== undefined && !findingStatuses.has(f.status))
          fail(400, 'Неизвестный статус находки.');
        if (f.importance !== undefined && !importanceLevels.includes(f.importance))
          fail(400, 'Важность: Критично, Высокая, Средняя или Низкая.');
      }
    }
    if (changes.models) {
      if (!Array.isArray(changes.models) || changes.models.length > 20)
        fail(400, 'Не больше 20 подключений.');
      // A built-in connection that works stays (it can be switched off); one without a model or key may be removed.
      const builtinReady = (m: any) =>
        Boolean(m.model) &&
        (modelKeys.has(currentWs(), m.id) ||
          (slotPattern.test(m.keyRef || '') && Boolean(process.env[m.keyRef])));
      for (const m of current.state.models.filter(isBuiltin))
        if (builtinReady(m) && !changes.models.some((x: any) => x.id === m.id))
          fail(400, 'Работающее встроенное подключение нельзя удалить, его можно выключить.');
      const seen = new Set();
      changes.models = changes.models.map((m: any) => {
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
      if (changes.models.filter((m) => m.reserve).length > 1)
        fail(400, 'Резервной может быть только одна модель.');
    }
    if (changes.findings) {
      const now = Date.now();
      const previous = new Map(current.state.findings.map((f) => [f.id, f]));
      const seen = new Set();
      changes.findings = changes.findings.map((f) => {
        const prev = previous.get(f.id);
        const next = reviewFinding(f, prev, person, now);
        if (seen.has(next.id)) fail(400, 'Находка указана дважды.');
        seen.add(next.id);
        return next;
      });
    }
    mutate((s) => {
      if (changes.models)
        for (const old of s.models)
          if (!changes.models.some((m) => m.id === old.id)) modelKeys.remove(currentWs(), old.id);
      Object.assign(s, changes);
      if (!s.models.some((m) => m.id === s.modelId && m.enabled))
        s.modelId = s.models.find((m) => m.enabled)?.id || '';
      return s;
    });
    if (changes.models || changes.modelId !== undefined) syncModels(currentWs());
    return handledJson(res, 200, view(person));
  }
  return false;
}
