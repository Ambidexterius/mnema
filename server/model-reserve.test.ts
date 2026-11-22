import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createMnemaServer } from './server.ts';

test('reserve model: overload of the selected model falls back, skips it for 10 minutes, then returns; key errors do not fall back', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1800000000000 });
  const dir = await mkdtemp(join(tmpdir(), 'mnemonika-reserve-')),
    setup = randomBytes(32).toString('hex'),
    calls: string[] = [];
  let primary = 529;
  const app = await createMnemaServer({
    dataDir: dir,
    baseURL: 'http://127.0.0.1:4199',
    authSecret: randomBytes(32).toString('hex'),
    setupToken: setup,
    providerFetch: async (input, init) => {
      const model = JSON.parse(String(init?.body || '{}')).model;
      calls.push(model);
      if (model === 'primary-model' && primary !== 200)
        return Response.json({ error: 'fixture failure' }, { status: primary });
      return Response.json({
        choices: [{ finish_reason: 'stop', message: { content: 'Ответ модели ' + model + '.' } }],
        usage: { total_tokens: 12 },
      });
    },
  });
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + (app.server.address() as any).port;
  const req = async (
    path: string,
    { body, method, cookie = '' }: { body?: any; method?: string; cookie?: string } = {},
  ) => {
    const response = await fetch(base + path, {
      method: method || (body === undefined ? 'GET' : 'POST'),
      headers: {
        'Content-Type': 'application/json',
        'X-Mnema-Request': '1',
        Origin: 'http://127.0.0.1:4199',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { response, data: await response.json() };
  };
  try {
    const owner = await req('/api/register', {
      body: {
        email: 'reserve-owner@example.com',
        password: 'fixture-owner-password',
        setupToken: setup,
      },
    });
    assert.equal(owner.response.status, 200, JSON.stringify(owner.data));
    const cookie = owner.response.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    const add = async (name: string, model: string, reserve = false) => {
      const r = await req('/api/models', {
        cookie,
        body: {
          name,
          model,
          apiType: 'compatible',
          url: 'https://api.deepseek.com/v1',
          provider: 'Fixture',
          keySource: 'api',
          apiKey: 'fixture-key-not-real-' + model,
          reserve,
        },
      });
      assert.equal(r.response.status, 201, JSON.stringify(r.data));
      return r.data.state.models.find((m: any) => m.model === model);
    };
    const main = await add('Основная', 'primary-model'),
      first = await add('Резерв 1', 'reserve-one', true),
      second = await add('Резерв 2', 'reserve-model', true);
    const models = (await req('/api/state', { cookie })).data.state.models;
    assert.deepEqual(
      models.filter((m: any) => m.reserve).map((m: any) => m.id),
      [second.id],
      'marking a new reserve clears the previous one',
    );
    assert(first);
    const state = (await req('/api/state', { cookie })).data.state;
    state.modelId = main.id;
    state.studies = [
      {
        id: 's',
        title: 'Synthetic',
        type: 'Интервью',
        format: 'TXT',
        status: 'ready',
        summary: [],
        tags: [],
        report: 'none',
        segments: [
          {
            id: 'g',
            time: 0,
            speaker: 'Participant',
            text: 'Участник проверяет выбранные даты после сохранения.',
          },
        ],
      },
    ];
    app.db
      .prepare('UPDATE mnema_workspaces SET data=? WHERE id=?')
      .run(JSON.stringify(state), 'main');
    const ask = async () => {
      calls.length = 0;
      const r = await req('/api/chat', {
        cookie,
        body: { question: 'Как участник проверяет выбранные даты?', modelId: main.id },
      });
      return { status: r.response.status, model: r.data.model, calls: [...calls] };
    };

    assert.deepEqual(
      await ask(),
      { status: 200, model: 'Резерв 2', calls: ['primary-model', 'reserve-model'] },
      'overload falls back and names the reserve',
    );
    primary = 200;
    assert.deepEqual(
      await ask(),
      { status: 200, model: 'Резерв 2', calls: ['reserve-model'] },
      'within 10 minutes the failed model is skipped',
    );
    t.mock.timers.tick(600001);
    assert.deepEqual(
      await ask(),
      { status: 200, model: 'Основная', calls: ['primary-model'] },
      'after the pause the selected model answers again',
    );
    primary = 401;
    const denied = await ask();
    assert.equal(denied.status, 502);
    assert.deepEqual(denied.calls, ['primary-model'], 'key errors are not hidden by the reserve');
    primary = 502;
    const test = await req('/api/models/' + main.id + '/test', { cookie, body: {} });
    assert.notEqual(test.response.status, 200, 'connection test checks only the chosen model');
  } finally {
    await app.close?.();
    app.server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
