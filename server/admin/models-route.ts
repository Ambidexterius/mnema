import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fail, handledJson } from '../http.ts';
import {
  availableModels,
  cleanModel,
  keySlot as slotPattern,
  modelBase,
  type modelKeyStore,
} from '../model-connections.ts';
import type { Person, RequestServices } from '../request-context.ts';

interface ModelState {
  models: any[];
}

interface ModelServices extends Pick<RequestServices, 'body' | 'limit'> {
  getState: () => { state: ModelState };
  modelKey: (model: any) => string | null | undefined;
  modelKeys: ReturnType<typeof modelKeyStore>;
  currentWs: () => string;
  mutate: (change: (state: ModelState) => void) => unknown;
  syncModels: (workspace: string) => void;
  view: (person: Person) => unknown;
  providerFetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  callModel: (
    person: Person,
    model: any,
    payload: any,
    workspace: string,
    useReserve: boolean,
  ) => Promise<any>;
}

export async function handleModels(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  person: Person,
  {
    body,
    limit,
    getState,
    modelKey,
    modelKeys,
    currentWs,
    mutate,
    syncModels,
    view,
    providerFetch,
    callModel,
  }: ModelServices,
) {
  if (path === '/api/models/catalog' && req.method === 'POST') {
    if (!person.owner) fail(403, 'Модели настраивает администратор.');
    limit('model-catalog:' + person.id, 10);
    const b = await body(req),
      saved = b.connectionId ? getState().state.models.find((m) => m.id === b.connectionId) : null;
    if (b.connectionId && !saved) fail(404, 'Подключение не найдено.');
    const model = {
      apiType: b.apiType || saved?.apiType || 'compatible',
      url: b.url || saved?.url,
    };
    modelBase(model);
    if (
      saved &&
      !b.apiKey &&
      !b.keyRef &&
      (modelBase(saved) !== modelBase(model) || (saved.apiType || 'compatible') !== model.apiType)
    )
      fail(400, 'Введите ключ нового поставщика.');
    const key =
      String(b.apiKey || '').trim() ||
      (b.keyRef
        ? slotPattern.test(b.keyRef)
          ? process.env[b.keyRef]
          : null
        : saved
          ? modelKey(saved)
          : null);
    if (!key) fail(400, 'Введите API-ключ или выберите настроенный серверный ключ.');
    if (!/^[\x21-\x7e]{8,4096}$/.test(key))
      fail(400, 'Проверьте API-ключ: пробелы и переносы строк не допускаются.');
    return handledJson(res, 200, {
      models: await availableModels(model, key, providerFetch),
    });
  }
  if (
    (path === '/api/models' && req.method === 'POST') ||
    (/^\/api\/models\/[^/]+$/.test(path) && req.method === 'PUT')
  ) {
    if (!person.owner) fail(403, 'Модели настраивает администратор.');
    limit('model-save:' + person.id, 20);
    const b = await body(req),
      state = getState().state,
      id = req.method === 'PUT' ? path.split('/')[3] : randomUUID(),
      previous = state.models.find((m) => m.id === id);
    if (req.method === 'PUT' && !previous) fail(404, 'Подключение не найдено.');
    if (!previous && state.models.length >= 20) fail(400, 'Не больше 20 подключений.');
    const next = cleanModel({ ...b, id }, previous),
      apiKey = String(b.apiKey || '').trim(),
      useServer = b.keySource === 'server';
    if (apiKey && !/^[\x21-\x7e]{8,4096}$/.test(apiKey))
      fail(400, 'Проверьте API-ключ: пробелы и переносы строк не допускаются.');
    if (useServer && !slotPattern.test(next.keyRef)) fail(400, 'Выберите серверный ключ.');
    if (!useServer && !apiKey && (!previous || !modelKeys.has(currentWs(), id)))
      fail(400, 'Введите API-ключ.');
    if (
      previous &&
      !useServer &&
      !apiKey &&
      (modelBase(previous) !== modelBase(next) ||
        (previous.apiType || 'compatible') !== next.apiType)
    )
      fail(400, 'Введите ключ нового поставщика.');
    mutate((s) => {
      if (useServer) modelKeys.remove(currentWs(), id);
      else if (apiKey) modelKeys.set(currentWs(), id, apiKey);
      s.models = (
        previous ? s.models.map((m) => (m.id === id ? next : m)) : [...s.models, next]
      ).map((m) => (next.reserve && m.id !== id && m.reserve ? { ...m, reserve: false } : m));
    });
    syncModels(currentWs());
    return handledJson(res, req.method === 'POST' ? 201 : 200, view(person));
  }
  if (/^\/api\/models\/[^/]+\/test$/.test(path) && req.method === 'POST') {
    if (!person.owner) fail(403, 'Модели настраивает администратор.');
    limit('model-test:' + person.id, 3);
    await body(req);
    const model = getState().state.models.find((m) => m.id === path.split('/')[3]);
    if (!model) fail(404, 'Модель не найдена.');
    const started = Date.now();
    if (new URL(model.url).hostname === 'inference.waw0.amvera.ru') {
      try {
        const ping = await fetch(model.url.replace(/\/$/, '') + '/models', {
          headers: { Authorization: 'Bearer ' + modelKey(model) },
          signal: AbortSignal.timeout(15000),
        });
        console.log('Amvera models preflight', ping.status);
        await ping.arrayBuffer();
        if (!ping.ok) fail(502, 'API Amvera вернул HTTP ' + ping.status);
      } catch (e) {
        if (e.status) throw e;
        fail(504, 'API Amvera недоступен из контейнера. ' + e.name);
      }
    }
    const result = await callModel(
      person,
      model,
      {
        model: model.model,
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Reply with one word: OK' }],
      },
      currentWs(),
      false,
    );
    const content = result.choices?.[0]?.message?.content;
    if (!content?.trim()) fail(502, 'API доступен, но модель не вернула текст.');
    return handledJson(res, 200, {
      ok: true,
      model: model.model,
      answer: content.slice(0, 500),
      usage: result.usage,
      seconds: (Date.now() - started) / 1000,
    });
  }
  return false;
}
