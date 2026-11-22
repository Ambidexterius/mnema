import type { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { openDatabase } from '../db.ts';
import { fail } from '../http.ts';
import { providerHeaders, providerRequest, providerResult } from '../model-connections.ts';
import type { createProjectSharing } from '../project-sharing.ts';
import type { Person } from '../request-context.ts';

interface ModelCallerServices {
  q: ReturnType<typeof openDatabase>['q'];
  sharing: Pick<ReturnType<typeof createProjectSharing>, 'projects' | 'validRevision'>;
  currentWs: () => string;
  modelKey: (model: any, workspace: string) => string | undefined;
  wsStore: Pick<AsyncLocalStorage<string>, 'run'>;
  getState: () => { state: any };
  options: { providerFetch?: typeof fetch };
}

export function createModelCaller({
  q,
  sharing,
  currentWs,
  modelKey,
  wsStore,
  getState,
  options,
}: ModelCallerServices) {
  const callProvider = async (
    person: Pick<Person, 'id'> & Partial<Pick<Person, 'workspaces' | 'sharedProject'>>,
    model: any,
    payload: any,
    workspace: string,
  ) => {
    const current = sharing.projects(person.id).find((w) => w.id === workspace),
      before = person.workspaces?.find((w) => w.id === workspace);
    const shared =
      person.sharedProject?.id === workspace &&
      sharing.validRevision(workspace, person.sharedProject.shareVersion) &&
      q('SELECT 1 FROM mnema_access WHERE user_id=? AND revoked=0').get(person.id);
    if (
      (!current && !shared) ||
      (!person.workspaces && current?.role !== 'full') ||
      (before?.role === 'full' && current?.role !== 'full')
    )
      fail(403, 'Доступ к проекту изменился. Повторите действие.');
    const key = modelKey(model, workspace);
    if (!key || !model.model) fail(503, 'Модель ещё не подключена.');
    const since = Date.parse(new Date().toISOString().slice(0, 7) + '-01T00:00:00Z');
    const count = q("SELECT count(*) AS n FROM mnema_usage WHERE kind='llm' AND created>=?").get(
      since,
    ).n;
    const used = q(
      "SELECT coalesce(sum(amount),0) AS n FROM mnema_usage WHERE kind='llm_tokens' AND created>=?",
    ).get(since).n;
    const reserve = Buffer.byteLength(JSON.stringify(payload)) + (payload.max_tokens || 0) + 256;
    if (
      count >= Number(process.env.LLM_MONTHLY_REQUEST_LIMIT || 1200) ||
      used + reserve > Number(process.env.LLM_MONTHLY_TOKEN_LIMIT || 2800000)
    )
      fail(429, 'Месячный лимит модели исчерпан.');
    const reservation = randomUUID();
    q('INSERT INTO mnema_usage VALUES(?,?,?,?,?)').run(
      reservation,
      person.id,
      'llm_tokens',
      reserve,
      Date.now(),
    );
    q('INSERT INTO mnema_usage VALUES(?,?,?,?,?)').run(
      randomUUID(),
      person.id,
      'llm',
      1,
      Date.now(),
    );
    let response;
    const started = Date.now();
    try {
      const request = providerRequest(model, payload);
      response = await (options.providerFetch || fetch)(request.url, {
        method: 'POST',
        headers: providerHeaders(model, key),
        body: JSON.stringify(request.body),
        redirect: 'error',
        signal: AbortSignal.timeout(240000),
      });
    } catch (e) {
      console.error(
        'LLM transport',
        model.model,
        e.name,
        e.cause?.code || 'no-code',
        Math.round((Date.now() - started) / 1000),
      );
      if (['TimeoutError', 'AbortError'].includes(e.name))
        fail(504, 'Провайдер модели не ответил вовремя. Попробуйте позже.', { retryable: true });
      fail(502, 'Не удалось связаться с моделью. Повторите запрос позже.', { retryable: true });
    }
    if (!response.ok) {
      console.error('LLM rejected', model.model, 'HTTP', response.status);
      fail(
        502,
        response.status === 403
          ? 'Провайдер отклонил доступ (HTTP 403). Проверьте права ключа, доступ к модели и регион сервера.'
          : 'Модель вернула ошибку ' +
              response.status +
              '. Проверьте ключ, баланс и идентификатор модели.',
        { retryable: [429, 500, 502, 503, 504, 529].includes(response.status) },
      );
    }
    const result = providerResult(model, await response.json());
    console.log(
      'LLM completed',
      model.model,
      'HTTP',
      response.status,
      'ms',
      Date.now() - started,
      'finish',
      result.choices?.[0]?.finish_reason || 'unknown',
      'chars',
      typeof result.choices?.[0]?.message?.content === 'string'
        ? result.choices[0].message.content.length
        : 0,
      'reasoningChars',
      String(result.choices?.[0]?.message?.reasoning_content || '').length,
      'completionTokens',
      result.usage?.completion_tokens || 0,
    );
    const actual = result.usage?.total_tokens;
    if (Number.isSafeInteger(actual) && actual >= 0)
      q('UPDATE mnema_usage SET amount=? WHERE id=?').run(actual, reservation);
    return result;
  };
  // Reserve model: on overload/unavailability of the selected model the same request goes to the model marked «reserve».
  // The failed model is skipped for 10 minutes, then the next request tries it again — that is the way back.
  // shortcut: cooldown lives in process memory, a restart starts from the selected model again.
  const modelDownUntil = new Map<string, number>();
  const callModel = async (person, model, payload, workspace = currentWs(), useReserve = true) => {
    const reserve =
      useReserve && !model.reserve
        ? wsStore.run(workspace, () =>
            getState().state.models.find((m) => m.reserve && m.enabled && m.id !== model.id),
          )
        : undefined;
    const viaReserve = async () => ({
      ...(await callProvider(person, reserve, { ...payload, model: reserve.model }, workspace)),
      mnemaModel: reserve,
    });
    const down = workspace + ':' + model.id;
    if (reserve && (modelDownUntil.get(down) || 0) > Date.now()) return viaReserve();
    try {
      return await callProvider(person, model, payload, workspace);
    } catch (e) {
      if (!reserve || !e.retryable) throw e;
      modelDownUntil.set(down, Date.now() + 600000);
      console.error('LLM fallback', model.model, '->', reserve.model, e.status);
      return viaReserve();
    }
  };
  return callModel;
}
