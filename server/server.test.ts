import type {
  Study,
  Segment,
  Finding,
  Highlight,
  ChatSource,
  WorkspaceUser,
} from '../app/types.ts';
import type { StoredStudy } from './projects/types.ts';
import type { Person } from './request-context.ts';
process.env.MNEMA_IMPORT_SOURCE_ORIGIN = 'https://source.example.com';
import { test, after } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { createMnemaServer } from './server.ts';
const dir = await mkdtemp(join(tmpdir(), 'mnema-test-'));
await mkdir(join(dir, 'public'));
await writeFile(
  join(dir, 'public', 'brand-mark.svg'),
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>',
);
const setup = randomBytes(32).toString('hex');
const testPort = Number(process.env.MNEMA_SERVER_TEST_PORT || 4191),
  baseURL = 'http://127.0.0.1:' + testPort;
let reply = 'OK',
  providerContext: any;
let waitForProvider: (() => Promise<void>) | undefined;
let speakerFixture: ((args: any) => Promise<any>) | undefined;
const completionMails: any[] = [];
const app = await createMnemaServer({
  sendCompletionMail: async (m) => {
    completionMails.push(m);
  },
  dataDir: dir,
  publicDir: join(dir, 'public'),
  baseURL,
  authSecret: randomBytes(32).toString('hex'),
  setupToken: setup,
  recordingProcessor: async () => ({
    segments: [
      {
        id: 'fixture-asr',
        time: 0,
        end: 11,
        speaker: 'Запись',
        text: 'Тестовый текст, не настоящее распознавание.',
      },
    ],
    duration: 11,
    model: 'Fixture — не ASR',
    processingSeconds: 0,
  }),
  speakerProcessor: async (args) =>
    speakerFixture
      ? speakerFixture(args)
      : {
          speakers: Object.fromEntries(args.segments.map((s) => [s.id, 'Спикер 1'])),
          count: 1,
          engine: 'Fixture — не диаризация',
          processingSeconds: 0,
        },
  providerFetch: async (_url, options) => {
    providerContext = JSON.parse(String(options?.body));
    await waitForProvider?.();
    return Response.json({
      choices: [{ message: { content: reply } }],
      usage: { total_tokens: 42 },
    });
  },
});
await new Promise<void>((r) => app.server.listen(testPort, '127.0.0.1', () => r()));
let ownerCookie = '',
  viewerCookie = '',
  invite;
async function req(
  path: string,
  {
    body,
    method,
    cookie,
    headers = {},
  }: { body?: any; method?: string; cookie?: string; headers?: Record<string, string> } = {},
): Promise<{ response: Response; data: any }> {
  const response = await fetch(baseURL + path, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: {
      'Content-Type': 'application/json',
      'X-Mnema-Request': '1',
      Origin: baseURL,
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    ...(body !== undefined
      ? { body: typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body) }
      : {}),
  } as RequestInit);
  const data = await response.json();
  return { response, data };
}
// A client socket left open by a test must not keep the run alive: close all connections before the server.
after(async () => {
  app.notifications.close();
  app.server.closeAllConnections();
  await new Promise((r) => app.server.close(r));
  app.db.close();
  await rm(dir, { recursive: true, force: true });
});
test('health version matches the package used by the frontend build', async () => {
  const expected = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ).version;
  const response = await fetch(baseURL + '/healthz');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).version, expected);
});
test('SVG brand assets are served with image MIME and nosniff', async () => {
  const res = await fetch(baseURL + '/brand-mark.svg');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/svg+xml');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});
test('anonymous access and public self-registration are denied', async () => {
  assert.equal((await req('/api/state')).response.status, 401);
  assert.equal(
    (
      await req('/api/register', {
        body: {
          email: 'intruder@example.com',
          name: 'Intruder',
          password: 'unimportant-test-pass',
        },
      })
    ).response.status,
    403,
  );
  assert.equal(
    (
      await req('/api/auth/sign-up/email', {
        body: {
          email: 'intruder@example.com',
          name: 'Intruder',
          password: 'unimportant-test-pass',
        },
      })
    ).response.status,
    404,
  );
});
test('owner bootstrap is one-time; session is an HTTP-only cookie', async () => {
  const r = await req('/api/register', {
    body: {
      email: 'owner@example.com',
      name: 'Owner',
      password: 'test-owner-password-only',
      setupToken: setup,
    },
  });
  assert.equal(r.response.status, 200, JSON.stringify(r.data));
  const cookies = r.response.headers.getSetCookie();
  assert(cookies.some((c) => /HttpOnly/i.test(c)));
  ownerCookie = cookies.map((c) => c.split(';')[0]).join('; ');
  const s = await req('/api/state', { cookie: ownerCookie });
  assert.equal(s.response.status, 200);
  assert.equal(s.data.user.admin, true);
  assert.equal(
    (
      await req('/api/register', {
        body: {
          email: 'other@example.com',
          name: 'Other',
          password: 'test-second-password',
          setupToken: setup,
        },
      })
    ).response.status,
    403,
  );
});
test('invitation pins email and role; reader cannot escalate or upload', async () => {
  const r = await req('/api/invitations', {
    cookie: ownerCookie,
    body: { email: 'reader@example.com', name: 'Reader', role: 'view', scope: 'project' },
  });
  assert.equal(r.response.status, 201);
  invite = new URLSearchParams(r.data.inviteURL.split('?')[1]).get('invite');
  const bad = await req('/api/register', {
    body: {
      email: 'wrong@example.com',
      name: 'Wrong',
      password: 'test-viewer-password',
      inviteToken: invite,
    },
  });
  assert.equal(bad.response.status, 403);
  const v = await req('/api/register', {
    body: {
      email: 'reader@example.com',
      password: 'test-viewer-password',
      inviteToken: invite,
      role: 'full',
      admin: true,
    },
  });
  assert.equal(v.response.status, 200, JSON.stringify(v.data));
  viewerCookie = v.response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const view = await req('/api/state', { cookie: viewerCookie });
  assert.equal(view.data.user.role, 'view');
  assert.equal(view.data.user.name, 'Reader');
  assert.equal(view.data.users?.length, undefined);
  assert.equal(view.data.state.users.length, 0);
  assert.equal(
    (
      await req('/api/state', {
        cookie: viewerCookie,
        method: 'PATCH',
        body: { version: view.data.version, changes: { findings: [] } },
      })
    ).response.status,
    403,
  );
  assert.equal(
    (
      await req('/api/invitations', {
        cookie: viewerCookie,
        body: { name: 'A', email: 'a@example.com', role: 'full' },
      })
    ).response.status,
    403,
  );
  assert.equal(
    (
      await req('/api/uploads', {
        cookie: viewerCookie,
        body: 'text',
        headers: { 'x-file-name': 'test.txt', 'Content-Type': 'text/plain' },
      })
    ).response.status,
    403,
  );
});
test('global product news permits account admins to publish, edit and delete, and other signed-in users to read', async () => {
  const newsList = () => req('/api/news', { cookie: viewerCookie });
  assert.equal((await req('/api/news')).response.status, 401);
  const initial = await newsList();
  assert.equal(initial.response.status, 200);
  assert(initial.data.posts.length >= 6);
  const body = { title: 'Учебная новость', description: '## Подробности\n\n- **Пункт**' };
  assert.equal((await req('/api/news', { cookie: viewerCookie, body })).response.status, 403);
  const posted = await req('/api/news', { cookie: ownerCookie, body });
  assert.equal(posted.response.status, 201);
  const post = posted.data.posts[0],
    url = '/api/news/' + post.id;
  assert.equal((await req('/api/session', { cookie: viewerCookie })).data.user.newsId, post.id);
  assert.equal(
    (await req(url, { cookie: viewerCookie, method: 'PATCH', body: { ...body, revision: 1 } }))
      .response.status,
    403,
  );
  const edited = await req(url, {
    cookie: ownerCookie,
    method: 'PATCH',
    body: { ...body, title: 'Правка', revision: 1 },
  });
  assert.equal(edited.response.status, 200);
  assert.equal(edited.data.posts[0].date, post.date);
  assert.equal(
    (await req(url, { cookie: ownerCookie, method: 'PATCH', body: { ...body, revision: 1 } }))
      .response.status,
    409,
  );
  assert.equal((await newsList()).data.posts[0].title, 'Правка');
  const remove = (cookie: string, revision: number) =>
    req(url, { cookie, method: 'DELETE', body: { revision } });
  assert.equal((await remove('', 2)).response.status, 401);
  assert.equal((await remove(viewerCookie, 2)).response.status, 403);
  assert.equal((await remove(ownerCookie, 1)).response.status, 409);
  assert.equal((await remove(ownerCookie, 2)).response.status, 200);
  assert.equal((await remove(ownerCookie, 2)).response.status, 200);
  assert.deepEqual((await newsList()).data.posts, initial.data.posts);
  assert.equal(
    (await req('/api/session', { cookie: viewerCookie })).data.user.newsId,
    initial.data.posts[0].id,
  );
});
test('upload is durable and original requires active access', async () => {
  const uploaded = await req('/api/uploads?title=Interview&type=Отчёт', {
    cookie: ownerCookie,
    body: 'Нейтральная тестовая запись. Участник проверяет выбранные даты.',
    headers: { 'x-file-name': 'sample.txt', 'Content-Type': 'text/plain' },
  });
  assert.equal(uploaded.response.status, 201, JSON.stringify(uploaded.data));
  const study = uploaded.data.state.studies[0];
  assert.equal(
    study.fileSize,
    Buffer.byteLength('Нейтральная тестовая запись. Участник проверяет выбранные даты.'),
  );
  assert.equal(
    (await req('/api/state', { cookie: viewerCookie })).data.state.studies.find(
      (s: Study) => s.id === study.id,
    ).fileSize,
    study.fileSize,
  );
  assert.equal(
    (await req('/api/research-library', { cookie: viewerCookie })).data.projects
      .flatMap((p: { studies: Study[] }) => p.studies)
      .find((s: Study) => s.id === study.id).fileSize,
    study.fileSize,
  );
  assert.equal((await req('/api/files/' + study.fileId)).response.status, 401);
  const file = await fetch(baseURL + '/api/files/' + study.fileId, {
    headers: { Cookie: viewerCookie },
  });
  assert.equal(file.status, 200);
  assert((await file.text()).includes('проверяет'));
  assert.match(file.headers.get('content-disposition') || '', /^inline;/);
  const saved = await fetch(baseURL + '/api/files/' + study.fileId + '?download=1', {
    headers: { Cookie: viewerCookie },
  });
  assert.equal(saved.status, 200);
  assert.match(
    saved.headers.get('content-disposition') || '',
    /^attachment; filename\*=UTF-8''sample\.txt$/,
  );
  assert.equal((await fetch(baseURL + '/api/files/' + study.fileId + '?download=1')).status, 401);
  assert.equal(
    app.db.prepare('SELECT status FROM mnema_uploads WHERE id=?').get(study.fileId)!.status,
    'ready',
  );
});
test('self-role mutation, hostile origin and provider SSRF are denied', async () => {
  const state = await req('/api/state', { cookie: ownerCookie });
  assert.equal(
    (
      await req('/api/users/' + state.data.user.id, {
        cookie: ownerCookie,
        method: 'PATCH',
        body: { role: 'view' },
      })
    ).response.status,
    403,
  );
  assert.equal(
    (
      await req('/api/state', {
        cookie: ownerCookie,
        method: 'PATCH',
        headers: { Origin: 'https://evil.example' },
        body: { version: state.data.version, changes: {} },
      })
    ).response.status,
    403,
  );
  assert.equal(
    (
      await req('/api/state', {
        cookie: ownerCookie,
        method: 'PATCH',
        body: {
          version: state.data.version,
          changes: {
            models: [
              { name: 'Private', url: 'https://127.0.0.1', model: 'x', keyRef: 'LLM_KEY_CUSTOM1' },
            ],
          },
        },
      })
    ).response.status,
    400,
  );
});
test('invalid project state patches leave the workspace version and contents intact', async () => {
  const before = await req('/api/state', { cookie: ownerCookie });
  assert.equal(before.response.status, 200);
  for (const changes of [
    null,
    [],
    { findings: null },
    { findings: [null] },
    { models: null },
    { processors: 'invalid' },
    { modelId: { id: 'invalid' } },
  ]) {
    const rejected = await req('/api/state', {
      cookie: ownerCookie,
      method: 'PATCH',
      body: { version: before.data.version, changes },
    });
    assert.equal(rejected.response.status, 400, JSON.stringify(changes));
  }
  const after = await req('/api/state', { cookie: ownerCookie });
  assert.equal(after.response.status, 200);
  assert.equal(after.data.version, before.data.version);
  assert.deepEqual(after.data.state, before.data.state);
});

test('storage configuration and backup checks are restricted to the service owner', async () => {
  assert.equal((await req('/api/storage')).response.status, 401);
  assert.equal((await req('/api/storage', { cookie: viewerCookie })).response.status, 403);
  const storage = await req('/api/storage', { cookie: ownerCookie });
  assert.equal(storage.response.status, 200);
  assert.equal(storage.data.enabled, false);
  assert.equal(storage.data.bucket, null);
  assert.equal(
    (await req('/api/storage/sync', { cookie: viewerCookie, body: {} })).response.status,
    403,
  );
  assert.equal(
    (await req('/api/storage/verify-backup', { cookie: viewerCookie, body: {} })).response.status,
    403,
  );
});
test('chunked upload bypasses request-size limits and retries do not duplicate bytes', async () => {
  assert.equal(
    (
      await req('/api/upload-sessions', {
        cookie: viewerCookie,
        body: { name: 'sample.webm', size: 100 },
      })
    ).response.status,
    403,
  );
  const bytes = Buffer.alloc(1024 * 1024 + 123, 65);
  const init = await req('/api/upload-sessions', {
    cookie: ownerCookie,
    body: {
      name: 'large-test.webm',
      mime: 'video/webm',
      size: bytes.length,
      title: 'Chunk test',
      participants: 3,
    },
  });
  assert.equal(init.response.status, 201);
  const id = init.data.id;
  assert.equal(
    (await req('/api/upload-sessions/' + id + '/complete', { cookie: ownerCookie, body: {} }))
      .response.status,
    409,
  );
  async function chunk(offset: number, end: number) {
    return fetch(baseURL + '/api/upload-sessions/' + id, {
      method: 'PUT',
      headers: {
        Cookie: ownerCookie,
        'X-Mnema-Request': '1',
        'X-Upload-Offset': String(offset),
        'Content-Type': 'application/octet-stream',
      },
      body: bytes.subarray(offset, end),
    });
  }
  let r = await chunk(0, 512 * 1024);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).offset, 512 * 1024);
  r = await chunk(0, 512 * 1024);
  assert.equal((await r.json()).offset, 512 * 1024);
  assert.equal((await chunk(512 * 1024, 1024 * 1024)).status, 200);
  assert.equal((await chunk(1024 * 1024, bytes.length)).status, 200);
  const done = await req('/api/upload-sessions/' + id + '/complete', {
    cookie: ownerCookie,
    body: {},
  });
  assert.equal(done.response.status, 201);
  assert(done.data.state.studies.some((s: Study) => s.fileId === id));
  const again = await req('/api/upload-sessions/' + id + '/complete', {
    cookie: ownerCookie,
    body: {},
  });
  assert.equal(again.data.createdStudyId, done.data.createdStudyId);
  assert.equal(again.data.state.studies.filter((s: Study) => s.fileId === id).length, 1);
  let processed;
  for (let i = 0; i < 50; i++) {
    processed = (await req('/api/state', { cookie: ownerCookie })).data.state.studies.find(
      (s: Study) => s.fileId === id,
    );
    if (processed.status === 'ready') break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(processed.status, 'ready');
  assert.equal(processed.participants, 3);
  assert.equal(processed.segments[0].id, 'fixture-asr');
  const file = await fetch(baseURL + '/api/files/' + id, { headers: { Cookie: ownerCookie } });
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
});
test('manual participant count changes only recording metadata', async () => {
  const study = async () =>
    (await req('/api/state', { cookie: ownerCookie })).data.state.studies.find(
      (s: Study) => s.title === 'Chunk test',
    );
  const original = await study(),
    url = '/api/studies/' + original.id + '/speaker-count';
  const patch = (body: object, cookie = ownerCookie) => req(url, { cookie, method: 'PATCH', body });
  const jobs = () =>
    app.db.prepare('SELECT count(*) AS n FROM mnema_jobs WHERE study_id=?').get(original.id)!.n;
  const initialJobs = jobs();
  assert.equal((await patch({ count: 2 }, viewerCookie)).response.status, 403);
  for (const count of [0, -1, 2.5, '2'])
    assert.equal((await patch({ count })).response.status, 400);
  assert.equal((await patch({ count: 2, before: original.participants })).response.status, 200);
  assert.deepEqual(await study(), { ...original, participants: 2 });
  assert.equal((await patch({ count: 3, before: 0 })).response.status, 409);
  assert.equal((await patch({ count: null, before: 2 })).response.status, 200);
  assert.equal(jobs(), initialJobs);
});
test('speakers are detected as a background job, renamed and reassigned only with full access', async () => {
  const find = async () =>
    (await req('/api/state', { cookie: ownerCookie })).data.state.studies.find(
      (s: Study) => s.title === 'Chunk test',
    );
  let study = await find();
  const id = study.id,
    seg = study.segments[0].id;
  assert.equal(
    (await req('/api/studies/' + id + '/speakers', { cookie: viewerCookie, body: {} })).response
      .status,
    403,
  );
  assert.equal(
    (await req('/api/studies/' + id + '/speakers', { cookie: ownerCookie, body: {} })).response
      .status,
    202,
  );
  for (let i = 0; i < 50; i++) {
    study = await find();
    if (study.speakerInfo?.state === 'ready') break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(study.speakerInfo.state, 'ready');
  assert.equal(study.status, 'ready');
  assert.equal(study.segments[0].speaker, 'Спикер 1');
  assert.equal(study.speakerEdits.at(-1).action, 'detected');
  assert.equal(
    (
      await req('/api/studies/' + id + '/speakers', {
        cookie: viewerCookie,
        method: 'PATCH',
        body: { from: 'Спикер 1', speaker: 'Читатель' },
      })
    ).response.status,
    403,
  );
  assert.equal(
    (
      await req('/api/studies/' + id + '/speakers', {
        cookie: ownerCookie,
        method: 'PATCH',
        body: { from: 'Спикер 1', speaker: 'Запись' },
      })
    ).response.status,
    400,
  );
  let r = await req('/api/studies/' + id + '/speakers', {
    cookie: ownerCookie,
    method: 'PATCH',
    body: { from: 'Спикер 1', speaker: 'Ведущая' },
  });
  assert.equal(r.response.status, 200);
  study = r.data.state.studies.find((s: Study) => s.id === id);
  assert.equal(study.segments[0].speaker, 'Ведущая');
  r = await req('/api/studies/' + id + '/speakers', {
    cookie: ownerCookie,
    method: 'PATCH',
    body: { segmentIds: [seg], speaker: 'Респондент' },
  });
  study = r.data.state.studies.find((s: Study) => s.id === id);
  assert.equal(study.segments[0].speaker, 'Респондент');
  assert.equal(study.speakerEdits.at(-1).action, 'reassigned');
  assert.equal(study.speakerEdits.at(-1).by.length > 0, true);
});
test('speaker rerun uses the saved limit and replaces labels only on success', async () => {
  const workspace = app.db.prepare("SELECT data FROM mnema_workspaces WHERE id='main'").get()!.data;
  const save = app.db.prepare("UPDATE mnema_workspaces SET data=? WHERE id='main'");
  const state = JSON.parse(String(workspace)),
    study = state.studies.find((s: Study) => s.title === 'Chunk test');
  const url = '/api/studies/' + study.id + '/speakers';
  const original = await (
    await fetch(baseURL + '/api/files/' + study.fileId, { headers: { Cookie: ownerCookie } })
  ).arrayBuffer();
  const segments = Array.from({ length: 10 }, (_, i) => ({
    id: 'rerun-' + i,
    time: i,
    end: i + 1,
    speaker: 'Спикер ' + (i + 1),
    text: 'Нейтральный текст ' + i,
    ...(i === 0 ? { correctedText: 'Ручное исправление' } : {}),
  }));
  Object.assign(study, { participants: 4, segments });
  save.run(JSON.stringify(state));
  const get = async () =>
    (await req('/api/state', { cookie: ownerCookie })).data.state.studies.find(
      (s: Study) => s.id === study.id,
    );
  const jobs = () =>
    Number(
      app.db
        .prepare("SELECT count(*) AS n FROM mnema_jobs WHERE study_id=? AND kind='speakers'")
        .get(study.id)!.n,
    );
  const wait = async (state: string) => {
    for (let i = 0; i < 100; i++) {
      const item = await get();
      if (item.speakerInfo?.state === state) return item;
      await new Promise((r) => setTimeout(r, 40));
    }
    assert.fail('Speaker state did not reach ' + state);
  };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  try {
    const initial = jobs();
    speakerFixture = async () => {
      await gate;
      throw new Error('Fixture failure');
    };
    const starts = await Promise.all([1, 2].map(() => req(url, { cookie: ownerCookie, body: {} })));
    assert(starts.every((r) => r.response.status === 202));
    assert.equal(jobs(), initial + 1);
    await wait('running');
    assert.deepEqual((await get()).segments, segments);
    assert.equal(
      (
        await req(url, {
          cookie: ownerCookie,
          method: 'PATCH',
          body: { segmentIds: [segments[0].id], speaker: 'Новое имя' },
        })
      ).response.status,
      409,
    );
    release();
    const failed = await wait('error');
    assert.equal(failed.status, 'ready');
    assert.deepEqual(failed.segments, segments);
    let savedLimit;
    speakerFixture = async ({ participants, segments }) => {
      savedLimit = participants;
      return {
        count: 4,
        engine: 'Fixture',
        processingSeconds: 0,
        speakers: Object.fromEntries(
          segments
            .slice(1)
            .map((segment: Segment, i: number) => [segment.id, 'Спикер ' + ((i % 4) + 1)]),
        ),
      };
    };
    assert.equal((await req(url, { cookie: ownerCookie, body: {} })).response.status, 202);
    const result = await wait('ready');
    assert.equal(savedLimit, 4);
    assert.equal(result.participants, 4);
    assert.equal(result.status, 'ready');
    assert.equal(result.segments[0].speaker, 'Запись');
    assert.equal(new Set(result.segments.slice(1).map((s: Segment) => s.speaker)).size, 4);
    assert.deepEqual(
      result.segments.map(({ speaker, ...segment }: Segment) => segment),
      segments.map(({ speaker, ...segment }) => segment),
    );
    assert.equal(result.fileId, study.fileId);
    assert.deepEqual(
      await (
        await fetch(baseURL + '/api/files/' + result.fileId, { headers: { Cookie: viewerCookie } })
      ).arrayBuffer(),
      original,
    );
  } finally {
    release();
    speakerFixture = undefined;
    save.run(workspace);
  }
});
test('model connection test is admin-only and accounts actual tokens before enforcing quota', async () => {
  const oldKey = process.env.LLM_KEY_CUSTOM1,
    oldLimit = process.env.LLM_MONTHLY_TOKEN_LIMIT;
  process.env.LLM_KEY_CUSTOM1 = 'test-only-provider-key';
  try {
    const state = await req('/api/state', { cookie: ownerCookie });
    const model = {
      id: 'quota-test',
      name: 'Quota test',
      url: 'https://api.openai.com/v1',
      model: 'fixture',
      keyRef: 'LLM_KEY_CUSTOM1',
      enabled: true,
    };
    assert.equal(
      (
        await req('/api/state', {
          cookie: ownerCookie,
          method: 'PATCH',
          body: {
            version: state.data.version,
            changes: { models: [...state.data.state.models, model] },
          },
        })
      ).response.status,
      200,
    );
    assert.equal(
      (await req('/api/models/quota-test/test', { cookie: viewerCookie, body: {} })).response
        .status,
      403,
    );
    const result = await req('/api/models/quota-test/test', { cookie: ownerCookie, body: {} });
    assert.equal(result.response.status, 200);
    assert.equal(result.data.usage.total_tokens, 42);
    assert.equal(
      app.db.prepare("SELECT sum(amount) AS n FROM mnema_usage WHERE kind='llm_tokens'").get()!.n,
      42,
    );
    process.env.LLM_MONTHLY_TOKEN_LIMIT = '42';
    assert.equal(
      (await req('/api/models/quota-test/test', { cookie: ownerCookie, body: {} })).response.status,
      429,
    );
  } finally {
    if (oldKey === undefined) delete process.env.LLM_KEY_CUSTOM1;
    else process.env.LLM_KEY_CUSTOM1 = oldKey;
    if (oldLimit === undefined) delete process.env.LLM_MONTHLY_TOKEN_LIMIT;
    else process.env.LLM_MONTHLY_TOKEN_LIMIT = oldLimit;
  }
});
test('stage 1: readers get only verified findings, history is stamped by the server, AI suggestions arrive as drafts', async () => {
  const oldKey = process.env.LLM_KEY_CUSTOM1;
  process.env.LLM_KEY_CUSTOM1 = 'test-only-provider-key';
  try {
    let owner;
    for (let i = 0; i < 40; i++) {
      owner = await req('/api/state', { cookie: ownerCookie });
      if (owner.data.state.studies.find((s: Study) => s.title === 'Interview')?.status === 'ready')
        break;
      await new Promise((r) => setTimeout(r, 250));
    }
    assert(owner);
    const study = owner.data.state.studies.find((s: Study) => s.title === 'Interview');
    assert.equal(study.status, 'ready');
    assert.equal(study.report, 'ready');
    assert.equal(study.addedBy, 'Owner');
    const seg = study.segments[0];
    const created = await req('/api/state', {
      cookie: ownerCookie,
      method: 'PATCH',
      body: {
        version: owner.data.version,
        changes: {
          modelId: 'quota-test',
          findings: [
            {
              id: 'human-1',
              title: 'Человек сохранил вывод',
              studyId: study.id,
              segmentId: seg.id,
              kind: 'Наблюдение',
              importance: 'Высокая',
              status: 'draft',
            },
          ],
        },
      },
    });
    assert.equal(created.response.status, 200, JSON.stringify(created.data));
    const human = created.data.state.findings.find((f: Finding) => f.id === 'human-1');
    assert.equal(human.status, 'verified');
    assert.equal(human.kind, 'Инсайт');
    assert.equal(human.importance, 'Высокая');
    assert.equal(human.basis, 'report');
    assert.equal(human.history[0].action, 'created');
    assert.equal(human.history[0].by, 'Owner');
    assert.equal(
      (
        await req('/api/state', {
          cookie: ownerCookie,
          method: 'PATCH',
          body: {
            version: created.data.version,
            changes: { findings: [{ ...human, importance: 'Значимо' }] },
          },
        })
      ).response.status,
      400,
    );
    reply =
      '```json\n' +
      JSON.stringify({
        findings: [
          {
            title: 'Черновик ИИ: участник проверяет даты',
            kind: 'Инсайт',
            importance: 'Средняя',
            segments: [seg.id],
          },
          { title: 'Черновик без фрагмента', segments: ['invented'] },
          {
            title: 'Второй черновик ИИ',
            kind: 'Проблема',
            importance: 'Критично',
            reason: 'Участник не может завершить задачу.',
            segments: [seg.id],
          },
        ],
      }) +
      '\n```';
    assert.equal(
      (
        await req('/api/studies/' + study.id + '/suggest-findings', {
          cookie: viewerCookie,
          body: {},
        })
      ).response.status,
      403,
    );
    const queued = await req('/api/studies/' + study.id + '/suggest-findings', {
      cookie: ownerCookie,
      body: {},
    });
    assert.equal(queued.response.status, 202, JSON.stringify(queued.data));
    assert.equal(
      queued.data.state.studies.find((s: Study) => s.id === study.id).findingsInfo.state,
      'queued',
    );
    let suggested;
    for (let i = 0; i < 80; i++) {
      suggested = await req('/api/state', { cookie: ownerCookie });
      if (
        suggested.data.state.studies.find((s: Study) => s.id === study.id).findingsInfo?.state ===
        'ready'
      )
        break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert(suggested);
    const info = suggested.data.state.studies.find((s: Study) => s.id === study.id).findingsInfo;
    assert.equal(info.state, 'ready', JSON.stringify(info));
    assert.equal(info.added, 2);
    const critical = suggested.data.state.findings.find(
      (f: Finding) => f.title === 'Второй черновик ИИ',
    );
    assert.equal(critical.importance, 'Критично');
    assert.equal(critical.kind, 'Проблема');
    assert.equal(critical.reason, 'Участник не может завершить задачу.');
    const again = await req('/api/studies/' + study.id + '/suggest-findings', {
      cookie: ownerCookie,
      body: {},
    });
    assert.equal(again.response.status, 202);
    for (let i = 0; i < 80; i++) {
      const s = (await req('/api/state', { cookie: ownerCookie })).data.state.studies.find(
        (s: Study) => s.id === study.id,
      );
      if (s.findingsInfo?.state === 'ready' && s.findingsInfo.startedAt !== info.startedAt) {
        assert.equal(s.findingsInfo.added, 0, 'a repeated run does not duplicate drafts');
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    suggested = await req('/api/state', { cookie: ownerCookie });
    const drafts = suggested.data.state.findings.filter((f: Finding) => f.origin === 'ai');
    assert.equal(drafts.length, 2);
    assert(
      drafts.every((f: Finding) => f.status === 'draft' && f.history[0].action === 'suggested'),
    );
    assert.equal(suggested.data.state.studies.find((s: Study) => s.id === study.id).drafts, 2);
    const viewer = await req('/api/state', { cookie: viewerCookie });
    assert.deepEqual(
      viewer.data.state.findings.map((f: Finding) => f.id),
      ['human-1'],
    );
    assert(!JSON.stringify(viewer.data).includes('Черновик ИИ'));
    const vs = viewer.data.state.studies.find((s: Study) => s.id === study.id);
    assert.equal(vs.findings, 1);
    assert.equal(vs.drafts, 0);
    const [first, second] = drafts;
    const reviewed = await req('/api/state', {
      cookie: ownerCookie,
      method: 'PATCH',
      body: {
        version: suggested.data.version,
        changes: {
          findings: suggested.data.state.findings.map((f: Finding) =>
            f.id === first.id
              ? { ...f, status: 'verified', title: 'Участник проверяет выбранные даты' }
              : f.id === second.id
                ? { ...f, status: 'rejected' }
                : f,
          ),
        },
      },
    });
    assert.equal(reviewed.response.status, 200, JSON.stringify(reviewed.data));
    const accepted = reviewed.data.state.findings.find((f: Finding) => f.id === first.id),
      rejected = reviewed.data.state.findings.find((f: Finding) => f.id === second.id);
    assert.equal(accepted.status, 'verified');
    assert.equal(accepted.history.at(-1).action, 'accepted');
    assert.equal(accepted.history.at(-1).by, 'Owner');
    assert.equal(rejected.history.at(-1).action, 'rejected');
    assert.equal(
      (
        await req('/api/state', {
          cookie: ownerCookie,
          method: 'PATCH',
          body: { version: suggested.data.version, changes: { findings: [] } },
        })
      ).response.status,
      409,
    );
    const viewer2 = await req('/api/state', { cookie: viewerCookie });
    assert.deepEqual(
      viewer2.data.state.findings.map((f: Finding) => f.id).sort(),
      [first.id, 'human-1'].sort(),
    );
    assert.equal(
      (
        await req('/api/studies/' + study.id, {
          cookie: viewerCookie,
          method: 'PATCH',
          body: { passport: { report: 'none' } },
        })
      ).response.status,
      403,
    );
    assert.equal(
      (
        await req('/api/studies/' + study.id, {
          cookie: ownerCookie,
          method: 'PATCH',
          body: { passport: { reportExpected: '17 ноября' } },
        })
      ).response.status,
      400,
    );
    const passport = await req('/api/studies/' + study.id, {
      cookie: ownerCookie,
      method: 'PATCH',
      body: {
        passport: {
          report: 'none',
          reportExpected: '2026-11-17',
          method: 'Юзабилити-тест',
          audience: 'Хозяева, 9 человек',
          author: 'Исследователь',
        },
      },
    });
    assert.equal(passport.response.status, 200, JSON.stringify(passport.data));
    const ps = passport.data.state.studies.find((s: Study) => s.id === study.id);
    assert.equal(ps.report, 'none');
    assert.equal(ps.reportExpected, '2026-11-17');
    assert(
      passport.data.state.findings
        .filter((f: Finding) => f.studyId === study.id)
        .every((f: Finding) => f.basis === 'raw'),
    );
    reply =
      'Участник проверяет даты [1] (по сырым данным).\n\nЧто осталось невыясненным\n- Причины не указаны [1].';
    const chat = await req('/api/chat', {
      cookie: viewerCookie,
      body: { question: 'Кто проверяет выбранные даты?', modelId: 'quota-test' },
    });
    assert.equal(chat.response.status, 200, JSON.stringify(chat.data));
    assert.equal(chat.data.sources[0].basis, 'raw');
    assert.equal(chat.data.sources[0].studyId, study.id);
  } finally {
    reply = 'OK';
    if (oldKey === undefined) delete process.env.LLM_KEY_CUSTOM1;
    else process.env.LLM_KEY_CUSTOM1 = oldKey;
  }
});
test('summary is durable, cited, idempotent and hidden from readers until human verification', async () => {
  const prior = process.env.LLM_KEY_CUSTOM1;
  process.env.LLM_KEY_CUSTOM1 = 'test-only-provider-key';
  try {
    const st = await req('/api/state', { cookie: ownerCookie });
    const study = st.data.state.studies.find((s: Study) => s.title === 'Interview');
    const id = study.id,
      seg = study.segments[0].id;
    reply = JSON.stringify({
      summary: [
        {
          title: 'Проверка дат',
          text: 'Участник проверяет выбранные даты.',
          segments: [seg, 'foreign-id'],
        },
      ],
    });
    assert.equal(
      (await req('/api/studies/' + id + '/summary', { cookie: viewerCookie, body: {} })).response
        .status,
      403,
    );
    const start = await req('/api/studies/' + id + '/summary', {
      cookie: ownerCookie,
      body: { modelId: 'quota-test' },
    });
    assert.equal(start.response.status, 202, JSON.stringify(start.data));
    const timestamp = start.data.state.studies.find((s: Study) => s.id === id).summaryInfo
      .startedAt;
    const duplicate = await req('/api/studies/' + id + '/summary', {
      cookie: ownerCookie,
      body: { modelId: 'quota-test' },
    });
    assert.equal(duplicate.response.status, 202);
    assert.equal(
      duplicate.data.state.studies.find((s: Study) => s.id === id).summaryInfo.startedAt,
      timestamp,
    );
    let ready;
    for (let i = 0; i < 50; i++) {
      ready = (await req('/api/state', { cookie: ownerCookie })).data.state.studies.find(
        (s: Study) => s.id === id,
      );
      if (ready.summaryInfo.state === 'ready') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(ready.summaryInfo.state, 'ready', JSON.stringify(ready));
    assert.deepEqual(ready.summary[0].segments, [seg]);
    const viewer = (await req('/api/state', { cookie: viewerCookie })).data;
    assert.equal(viewer.state.studies.find((s: Study) => s.id === id).summary.length, 0);
    assert(!JSON.stringify(viewer).includes('Проверка дат'));
    assert.equal(
      (await req('/api/studies/' + id + '/summary/verify', { cookie: viewerCookie, body: {} }))
        .response.status,
      403,
    );
    assert.equal(
      (await req('/api/studies/' + id + '/summary/verify', { cookie: ownerCookie, body: {} }))
        .response.status,
      200,
    );
    assert.equal(
      (await req('/api/state', { cookie: viewerCookie })).data.state.studies.find(
        (s: Study) => s.id === id,
      ).summary.length,
      1,
    );
    const persisted = JSON.parse(
      String(app.db.prepare("SELECT data FROM mnema_workspaces WHERE id='main'").get()!.data),
    ).studies.find((s: Study) => s.id === id);
    assert.equal(persisted.summaryInfo.review, 'verified');
    const original = study.segments[0].text;
    assert.equal(
      (
        await req('/api/studies/' + id + '/transcript/' + seg, {
          cookie: viewerCookie,
          method: 'PATCH',
          body: { text: 'Исправление' },
        })
      ).response.status,
      403,
    );
    const edited = await req('/api/studies/' + id + '/transcript/' + seg, {
      cookie: ownerCookie,
      method: 'PATCH',
      body: { text: 'Участник внимательно проверяет даты.', before: original },
    });
    assert.equal(edited.response.status, 200, JSON.stringify(edited.data));
    const es = edited.data.state.studies.find((s: Study) => s.id === id);
    assert.equal(es.segments[0].text, original);
    assert.equal(es.segments[0].correctedText, 'Участник внимательно проверяет даты.');
    assert.equal(es.transcriptEdits.at(-1).before, original);
    assert.equal(es.summary.length, 0);
    assert.equal(
      (
        await req('/api/studies/' + id + '/transcript/' + seg, {
          cookie: ownerCookie,
          method: 'PATCH',
          body: { text: 'Перезаписать', before: original },
        })
      ).response.status,
      409,
    );
    reply = JSON.stringify({
      summary: [
        { title: 'Несуществующий источник', text: 'Нельзя публиковать.', segments: ['foreign-id'] },
      ],
    });
    assert.equal(
      (
        await req('/api/studies/' + id + '/summary', {
          cookie: ownerCookie,
          body: { modelId: 'quota-test' },
        })
      ).response.status,
      202,
    );
    for (let i = 0; i < 50; i++) {
      ready = (await req('/api/state', { cookie: ownerCookie })).data.state.studies.find(
        (s: Study) => s.id === id,
      );
      if (ready.summaryInfo.state === 'error') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(ready.summaryInfo.state, 'error');
    assert.equal(ready.summaryInfo.errorCode, 'sources');
    assert.doesNotMatch(ready.summaryInfo.error, /JSON|ID|формат/i);
    assert.equal(
      (await req('/api/studies/' + id + '/summary/verify', { cookie: ownerCookie, body: {} }))
        .response.status,
      409,
    );
  } finally {
    reply = 'OK';
    if (prior === undefined) delete process.env.LLM_KEY_CUSTOM1;
    else process.env.LLM_KEY_CUSTOM1 = prior;
  }
});
test('project summary uses overview evidence, survives model errors and respects reader visibility', async () => {
  const row = app.db.prepare("SELECT data FROM mnema_workspaces WHERE id='main'");
  const stored = row.get()!.data;
  const save = app.db.prepare(
    "UPDATE mnema_workspaces SET data=?,version=version+1 WHERE id='main'",
  );
  const state = JSON.parse(String(stored)),
    oldKey = process.env.LLM_KEY_CUSTOM1;
  const source = {
    id: 'summary-segment',
    speaker: 'Документ',
    time: 5,
    page: 2,
    text: 'Пользователь сверяет даты заезда перед оплатой.',
  };
  const visible = {
    ...state.studies[0],
    id: 'visible-catalog',
    status: 'ready',
    title: 'Интервью',
    segments: [source],
    importSource: { catalog: true },
  };
  state.studies = [
    visible,
    {
      ...visible,
      id: 'hidden-catalog',
      fileId: 'hidden-catalog-file',
      fileName: 'PRIVATE_CATALOG.txt',
      title: 'Скрытый материал',
      segments: [{ ...source, text: 'PRIVATE_CATALOG' }],
    },
  ];
  state.highlights = [
    { id: 'visible-note', studyId: visible.id, segmentId: source.id, text: source.text },
    {
      id: 'hidden-note',
      studyId: 'hidden-catalog',
      segmentId: source.id,
      text: 'PRIVATE_HIGHLIGHT',
    },
  ];
  const finding = {
    kind: 'Инсайт',
    importance: 'Средняя',
    segmentId: source.id,
    studyId: visible.id,
    origin: 'ai',
  };
  state.findings = [
    { ...finding, id: 'verified', status: 'verified', title: 'Настройки проекта' },
    { ...finding, id: 'draft', status: 'draft', title: 'Черновик проекта PRIVATE_DRAFT' },
  ];
  save.run(JSON.stringify(state));
  process.env.LLM_KEY_CUSTOM1 = 'test-only-provider-key';
  const build = (cookie = ownerCookie) => req('/api/project-summary', { cookie, body: {} });
  const delayed = async (change: (current: any) => void) => {
    let entered: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => (entered = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    waitForProvider = () => {
      entered();
      return gate;
    };
    const pending = build();
    try {
      await Promise.race([
        started,
        pending.then((result) => assert.fail('Model did not start: ' + result.response.status)),
      ]);
      const current = JSON.parse(String(row.get()!.data));
      change(current);
      save.run(JSON.stringify(current));
    } finally {
      waitForProvider = undefined;
      release();
    }
    return pending;
  };
  try {
    const reader = (await req('/api/state', { cookie: viewerCookie })).data;
    assert.deepEqual(
      reader.state.studies.map((study: Study) => study.id),
      [visible.id],
    );
    assert.deepEqual(
      reader.state.highlights.map((note: Highlight) => note.id),
      ['visible-note'],
    );
    assert.doesNotMatch(JSON.stringify(reader.user.workspaces), /PRIVATE_CATALOG/);
    assert.equal((await build(viewerCookie)).response.status, 403);
    reply = '- Участник сверяет даты [1].';
    const response = await build();
    assert.equal(response.response.status, 200, JSON.stringify(response.data));
    const summary = response.data.state.projectSummary,
      context = JSON.parse(providerContext.messages[1].content);
    assert.equal(context.coverage.included, 1);
    assert.equal(context.coverage.fragments, 1);
    assert.deepEqual(
      context.reviewed_findings.map((f: { title: string }) => f.title),
      ['Настройки проекта'],
    );
    assert.doesNotMatch(JSON.stringify(providerContext), /PRIVATE_CATALOG|PRIVATE_DRAFT/);
    assert.equal(summary.sources[0].segmentId, source.id);
    assert.equal(summary.sources[0].page, 2);
    assert.equal(summary.sources[0].time, 5);
    const read = async () =>
      (await req('/api/state', { cookie: viewerCookie })).data.state.projectSummary;
    assert.deepEqual(await read(), summary);
    reply = '';
    assert.equal((await build()).response.status, 502);
    assert.deepEqual(await read(), summary);
    reply = '- Даты проверяют до оплаты [1].';
    const retry = await build();
    assert.equal(retry.response.status, 200);
    assert.equal((await read()).answer, reply);
    const published = row.get()!.data;
    const legacy = JSON.parse(String(published));
    delete legacy.projectSummary.reviewedRevision;
    save.run(JSON.stringify(legacy));
    assert.equal(
      (await read()).answer,
      reply,
      'a matching legacy overview without redactions stays readable',
    );
    legacy.studies[0].redactionCount = 1;
    save.run(JSON.stringify(legacy));
    assert.equal(
      await read(),
      null,
      'a legacy overview cannot establish what context was sent before a mask',
    );
    const changed = JSON.parse(String(published));
    changed.studies[0].segments[0].correctedText = 'Обновлённый текст без прежней цитаты.';
    save.run(JSON.stringify(changed));
    assert.equal(await read(), null, 'a stored overview with an unchanged source ID still expires');
    assert.equal(
      (await req('/api/state', { cookie: ownerCookie })).data.state.projectSummary,
      null,
    );
    save.run(published);
    assert.equal(
      (
        await delayed((current) => {
          current.studies[0].segments[0].correctedText = 'Скрытый текст заменён.';
          current.projectSummary = null;
        })
      ).response.status,
      409,
    );
    assert.equal(
      await read(),
      null,
      'a response from before the edit cannot bring back the overview',
    );
    save.run(published);
    assert.equal(
      (
        await delayed((current) => {
          current.findings[0].title = 'Новый проверенный вывод';
        })
      ).response.status,
      409,
      'reviewed findings are also sent to the model',
    );
    assert.equal(await read(), null);
    const current = JSON.parse(String(published));
    current.findings = [];
    save.run(JSON.stringify(current));
    assert.equal(await read(), null);
  } finally {
    save.run(stored);
    reply = 'OK';
    if (oldKey === undefined) delete process.env.LLM_KEY_CUSTOM1;
    else process.env.LLM_KEY_CUSTOM1 = oldKey;
  }
});
test('workspaces isolate studies; built-in models stay; studies can be deleted with their findings and file', async () => {
  const before = await req('/api/state', { cookie: ownerCookie });
  assert.equal(before.data.state.workspace.name, 'Команда');
  const deepseek = before.data.state.models.find((m: any) => m.id === 'deepseek');
  assert.equal(deepseek.builtin, true);
  const custom = before.data.state.models.find((m: any) => m.id === 'quota-test');
  assert.equal(custom.builtin, false);
  const removed = await req('/api/state', {
    cookie: ownerCookie,
    method: 'PATCH',
    body: {
      version: before.data.version,
      changes: { models: before.data.state.models.filter((m: any) => m.id !== 'quota-test') },
    },
  });
  assert.equal(removed.response.status, 200, JSON.stringify(removed.data));
  assert(!removed.data.state.models.some((m: any) => m.id === 'quota-test'));
  assert.notEqual(removed.data.state.modelId, 'quota-test');
  assert.equal(
    (await req('/api/workspaces', { cookie: ownerCookie, body: { name: '' } })).response.status,
    400,
  );
  const created = await req('/api/workspaces', {
    cookie: ownerCookie,
    body: { name: 'Гостевой продукт', mode: 'private' },
  });
  assert.equal(created.response.status, 201);
  const wsCookie = ownerCookie + '; mnema_ws=' + created.data.id;
  const completedUpload = app.db.prepare('SELECT id FROM mnema_upload_sessions LIMIT 1').get();
  assert(completedUpload);
  assert.equal(
    (await req('/api/upload-sessions/' + completedUpload.id, { cookie: wsCookie })).response.status,
    404,
  );
  const fresh = await req('/api/state', { cookie: wsCookie });
  assert.equal(fresh.data.state.workspace.name, 'Гостевой продукт');
  assert.equal(fresh.data.state.studies.length, 0);
  assert.equal(fresh.data.user.admin, true);
  assert.equal(fresh.data.user.workspaces.length, 2);
  assert.equal(fresh.data.state.workspace.creatorName, 'Owner');
  const fields = {
    category: 'Продукт',
    conducted: 'Ноябрь 2026',
    method: 'Интервью',
    audience: 'Группа 1\n\nГруппа 2',
    contact: '',
    report: 'ready',
  };
  const profilePath = '/api/workspaces/' + created.data.id + '/profile';
  const editProfile = (
    cookie: string,
    revision: number,
    values: Record<string, unknown> = fields,
    path = profilePath,
  ) => req(path, { cookie, method: 'PATCH', body: { revision, fields: values } });
  assert.equal(
    (await editProfile(viewerCookie, 0, fields, '/api/workspaces/main/profile')).response.status,
    403,
  );
  assert.equal((await editProfile(ownerCookie, 0)).response.status, 404);
  assert.equal(
    (await editProfile(wsCookie, 0, { ...fields, ...{ creatorName: 'Подмена' } })).response.status,
    400,
  );
  assert.equal((await editProfile(wsCookie, 0)).response.status, 200);
  assert.equal((await editProfile(wsCookie, 0)).response.status, 409);
  const savedProfile = (await req('/api/state', { cookie: wsCookie })).data.state.workspace;
  assert.equal(savedProfile.profile.audience, fields.audience);
  assert.equal(savedProfile.creatorName, 'Owner');
  assert.equal(
    (await editProfile(wsCookie, 1, { ...fields, tags: ['x'.repeat(41)] })).response.status,
    400,
  );
  assert.equal(
    (await editProfile(wsCookie, 1, { ...fields, tags: [' Продукт ', 'Продукт', 'Отчёт'] }))
      .response.status,
    200,
  );
  assert.equal((await editProfile(wsCookie, 2)).response.status, 200);
  assert.deepEqual(
    (await req('/api/state', { cookie: wsCookie })).data.state.workspace.profile.tags,
    ['Продукт', 'Отчёт'],
  );
  assert.equal(
    (await req('/api/state', { cookie: ownerCookie })).data.state.workspace.profile.audience,
    undefined,
  );
  const main = await req('/api/state', { cookie: ownerCookie });
  assert(main.data.state.studies.length > 0);
  const foreign = await req('/api/state', {
    cookie: viewerCookie + '; mnema_ws=' + created.data.id,
  });
  assert.equal(foreign.data.state.workspace.id, 'main');
  const study = main.data.state.studies.find((s: any) => s.title === 'Interview');
  assert.equal(
    (await req('/api/studies/' + study.id, { cookie: viewerCookie, method: 'DELETE' })).response
      .status,
    403,
  );
  assert.equal(
    (await req('/api/studies/' + study.id, { cookie: wsCookie, method: 'DELETE' })).response.status,
    404,
  );
  const deleted = await req('/api/studies/' + study.id, { cookie: ownerCookie, method: 'DELETE' });
  assert.equal(deleted.response.status, 200, JSON.stringify(deleted.data));
  assert(!deleted.data.state.studies.some((s: any) => s.id === study.id));
  assert(!deleted.data.state.findings.some((f: any) => f.studyId === study.id));
  assert.equal(
    (await req('/api/files/' + study.fileId, { cookie: ownerCookie })).response.status,
    404,
  );
});
test('project-wide questions use only current project evidence; automatic summary stays a draft', async () => {
  const prior = process.env.LLM_KEY_CUSTOM1;
  process.env.LLM_KEY_CUSTOM1 = 'test-only-provider-key';
  try {
    let state = (await req('/api/state', { cookie: ownerCookie })).data;
    const model = {
      id: 'project-test',
      name: 'Project fixture',
      url: 'https://api.openai.com/v1',
      model: 'fixture',
      keyRef: 'LLM_KEY_CUSTOM1',
      enabled: true,
    };
    await req('/api/state', {
      cookie: ownerCookie,
      method: 'PATCH',
      body: {
        version: state.version,
        changes: { models: [...state.state.models, model], modelId: model.id },
      },
    });
    const bytes = Buffer.from('Вымышленные данные. Проверка проекта и автоматической сводки.');
    const started = await req('/api/upload-sessions', {
      cookie: ownerCookie,
      body: {
        name: 'auto.txt',
        title: 'Auto summary fixture',
        size: bytes.length,
        autoSummary: true,
      },
    });
    assert.equal(started.response.status, 201);
    const uploadId = started.data.id;
    await fetch(baseURL + '/api/upload-sessions/' + uploadId, {
      method: 'PUT',
      headers: {
        Cookie: ownerCookie,
        'X-Mnema-Request': '1',
        'X-Upload-Offset': '0',
        'Content-Type': 'application/octet-stream',
      },
      body: bytes,
    });
    reply = JSON.stringify({
      summary: [{ title: 'Вывод', text: 'Проверка проекта.', segments: [] }],
    });
    const done = await req('/api/upload-sessions/' + uploadId + '/complete', {
      cookie: ownerCookie,
      body: {},
    });
    const studyId = done.data.createdStudyId;
    let study;
    // Prepare the valid source ID after text extraction, while the worker is between jobs.
    for (let i = 0; i < 80; i++) {
      study = (await req('/api/state', { cookie: ownerCookie })).data.state.studies.find(
        (s: Study) => s.id === studyId,
      );
      if (study.status === 'ready') {
        reply = JSON.stringify({
          summary: [
            { title: 'Вывод', text: 'Проверка проекта.', segments: [study.segments[0].id] },
          ],
        });
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    for (let i = 0; i < 80; i++) {
      study = (await req('/api/state', { cookie: ownerCookie })).data.state.studies.find(
        (s: Study) => s.id === studyId,
      );
      if (study.summaryInfo?.state === 'ready') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(study.summaryInfo?.state, 'ready');
    assert.equal(study.summaryInfo.review, 'draft');
    assert.equal(
      (await req('/api/state', { cookie: viewerCookie })).data.state.studies.find(
        (s: Study) => s.id === studyId,
      ).summary.length,
      0,
    );
    reply = 'Тестовый ответ [1].';
    const answer = await req('/api/chat', {
      cookie: ownerCookie,
      body: { question: 'Какие основные идеи есть в этом проекте?', modelId: model.id },
    });
    assert.equal(answer.response.status, 200);
    assert(answer.data.sources.length > 0);
    assert(answer.data.coverage.sampled);
    const ownIds = new Set(
      (await req('/api/state', { cookie: ownerCookie })).data.state.studies.map((s: Study) => s.id),
    );
    assert(answer.data.sources.every((s: ChatSource) => ownIds.has(s.studyId)));
    const other = await req('/api/workspaces', {
      cookie: ownerCookie,
      body: { name: 'Empty project fixture', mode: 'private' },
    });
    const wsCookie = ownerCookie + '; mnema_ws=' + other.data.id;
    const explicit = (
      await req('/api/state', { cookie: wsCookie, headers: { 'X-Mnema-Workspace': 'main' } })
    ).data;
    assert.equal(explicit.state.workspace.id, 'main');
    assert.equal(
      (
        await req('/api/state', {
          cookie: viewerCookie,
          headers: { 'X-Mnema-Workspace': other.data.id },
        })
      ).response.status,
      403,
    );
    const source = state.state.studies.find((s: Study) => s.fileId);
    if (source)
      assert.equal(
        (
          await fetch(baseURL + '/api/files/' + source.fileId + '?workspace=main', {
            headers: { Cookie: wsCookie },
          })
        ).status,
        200,
      );
    const fresh = (await req('/api/state', { cookie: wsCookie })).data;
    await req('/api/state', {
      cookie: wsCookie,
      method: 'PATCH',
      body: {
        version: fresh.version,
        changes: { models: [...fresh.state.models, model], modelId: model.id },
      },
    });
    const empty = await req('/api/chat', {
      cookie: wsCookie,
      body: { question: 'Какие основные идеи есть в этом проекте?' },
    });
    assert.equal(empty.response.status, 200);
    assert.equal(empty.data.sources.length, 0);
  } finally {
    reply = 'OK';
    if (prior === undefined) delete process.env.LLM_KEY_CUSTOM1;
    else process.env.LLM_KEY_CUSTOM1 = prior;
  }
});
test('research import is admin-only, checks bytes, preserves sources and hides imported draft catalogs', async () => {
  const url = 'https://source.example.com/studies/test-research';
  assert.equal(
    (
      await req('/api/imports/source/project', {
        cookie: viewerCookie,
        body: { url, name: 'Import' },
      })
    ).response.status,
    403,
  );
  const first = await req('/api/imports/source/project', {
    cookie: ownerCookie,
    body: {
      url,
      name: 'Import fixture',
      mode: 'private',
      text: 'Private imported draft in raw project passport',
    },
  });
  assert.equal(first.response.status, 201);
  const again = await req('/api/imports/source/project', {
    cookie: ownerCookie,
    body: { url, name: 'Import fixture' },
  });
  assert.equal(again.data.id, first.data.id);
  const wsCookie = ownerCookie + '; mnema_ws=' + first.data.id;
  const data = Buffer.from('Imported original file.');
  const sourceId = '11111111-1111-4111-8111-111111111111';
  const upload = await req('/api/upload-sessions', {
    cookie: wsCookie,
    body: {
      name: 'import.txt',
      size: data.length,
      deferProcessing: true,
      importId: sourceId,
      sha256: createHash('sha256').update(data).digest('hex'),
    },
  });
  assert.equal(upload.response.status, 201);
  await fetch(baseURL + '/api/upload-sessions/' + upload.data.id, {
    method: 'PUT',
    headers: {
      Cookie: wsCookie,
      'X-Mnema-Request': '1',
      'X-Upload-Offset': '0',
      'Content-Type': 'application/octet-stream',
    },
    body: data,
  });
  const done = await req('/api/upload-sessions/' + upload.data.id + '/complete', {
    cookie: wsCookie,
    body: {},
  });
  assert.equal(done.response.status, 201);
  const studyId = done.data.createdStudyId;
  assert.equal(done.data.state.studies[0].status, 'uploaded');
  assert.equal(app.db.prepare('SELECT 1 FROM mnema_jobs WHERE study_id=?').get(studyId), undefined);
  assert.equal(
    (
      await req('/api/imports/source/material', {
        cookie: wsCookie,
        body: {
          studyId,
          url: 'https://source.example.com/api/files/' + sourceId + '/download',
          segments: [
            { id: 'source-segment', time: 0, speaker: 'Документ', text: 'Original research text.' },
          ],
          passport: { report: 'none', author: 'Source author' },
        },
      })
    ).response.status,
    200,
  );
  const item = {
    url: 'https://source.example.com/insights/imported-finding',
    title: 'Private imported draft',
    text: 'Original source card',
    originalStatus: 'Принято к сведению',
    evidence: [],
  };
  const findings = await req('/api/imports/source/findings', {
    cookie: wsCookie,
    body: { items: [item] },
  });
  assert.equal(findings.data.added, 1);
  assert.equal(
    (await req('/api/imports/source/findings', { cookie: wsCookie, body: { items: [item] } })).data
      .added,
    0,
  );
  await req('/api/invitations', {
    cookie: wsCookie,
    body: { email: 'reader@example.com', name: 'Reader', role: 'view', scope: 'project' },
  });
  const viewCookie = viewerCookie + '; mnema_ws=' + first.data.id;
  const view = (await req('/api/state', { cookie: viewCookie })).data;
  assert.equal(view.state.studies.length, 1);
  assert(!JSON.stringify(view).includes('Private imported draft'));
  assert(!JSON.stringify(view).includes('Original source card'));
  assert.equal(
    (await req('/api/imports/source/status', { cookie: viewCookie })).response.status,
    403,
  );
  const full = (await req('/api/state', { cookie: wsCookie })).data;
  const accepted = await req('/api/state', {
    cookie: wsCookie,
    method: 'PATCH',
    body: {
      version: full.version,
      changes: {
        findings: full.state.findings.map((f: Finding) => ({ ...f, status: 'verified' })),
      },
    },
  });
  assert.equal(accepted.response.status, 200);
  assert.equal(accepted.data.state.findings[0].importSource.url, item.url);
  const visible = (await req('/api/state', { cookie: viewCookie })).data;
  assert.equal(visible.state.findings.length, 1);
  assert.equal(
    visible.state.studies.find((s: StoredStudy) => s.importSource?.catalog).segments.length,
    1,
  );
  const member = full.state.users.find((u: WorkspaceUser) => u.email === 'reader@example.com');
  assert.equal(
    (
      await req('/api/workspaces/' + first.data.id + '/sharing/members/' + member.id, {
        cookie: wsCookie,
        method: 'DELETE',
      })
    ).response.status,
    200,
  );
});
test('service derives its own draft findings from imported originals and does not requeue completed analysis', async () => {
  const prior = process.env.LLM_KEY_CUSTOM1;
  process.env.LLM_KEY_CUSTOM1 = 'test-only-provider-key';
  try {
    const owner = (await req('/api/state', { cookie: ownerCookie })).data;
    const project = owner.user.workspaces.find(
      (w: Person['workspaces'][number]) => w.name === 'Import fixture',
    );
    const cookie = ownerCookie + '; mnema_ws=' + project.id;
    let state = (await req('/api/state', { cookie })).data;
    const source = state.state.studies.find((s: StoredStudy) => s.importSource?.fileId);
    const model = {
      id: 'analysis-fixture',
      name: 'Analysis fixture',
      url: 'https://api.openai.com/v1',
      model: 'fixture',
      keyRef: 'LLM_KEY_CUSTOM1',
      enabled: true,
    };
    await req('/api/state', {
      cookie,
      method: 'PATCH',
      body: {
        version: state.version,
        changes: { models: [...state.state.models, model], modelId: model.id },
      },
    });
    reply = JSON.stringify({
      summary: [
        {
          title: 'New service conclusion',
          text: 'Derived from original text.',
          segments: [source.segments[0].id],
        },
      ],
    });
    const first = await req('/api/imports/source/analyze', { cookie, body: {} });
    assert.equal(first.response.status, 202);
    assert.equal(first.data.queued, 1);
    assert.equal((await req('/api/imports/source/analyze', { cookie, body: {} })).data.queued, 0);
    for (let i = 0; i < 80; i++) {
      state = (await req('/api/state', { cookie })).data;
      if (state.state.studies.find((s: Study) => s.id === source.id).summaryInfo?.state === 'ready')
        break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const findings = state.state.findings.filter(
      (f: Finding) => f.studyId === source.id && f.origin === 'ai',
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0].title, 'New service conclusion');
    assert.equal(findings[0].status, 'draft');
    assert.equal(findings[0].segmentId, source.segments[0].id);
    assert.equal(findings[0].importSource, undefined);
    assert.equal((await req('/api/imports/source/analyze', { cookie, body: {} })).data.queued, 0);
  } finally {
    reply = 'OK';
    if (prior === undefined) delete process.env.LLM_KEY_CUSTOM1;
    else process.env.LLM_KEY_CUSTOM1 = prior;
  }
});
test('highlights: only text from the material, full access to change, readers see them', async () => {
  const up = await req('/api/uploads?title=Highlights&type=Отчёт', {
    cookie: ownerCookie,
    body: 'Нейтральная тестовая запись. Участник проверяет выбранные даты.',
    headers: { 'x-file-name': 'highlights.txt', 'Content-Type': 'text/plain' },
  });
  assert.equal(up.response.status, 201, JSON.stringify(up.data));
  let study;
  for (let i = 0; i < 40; i++) {
    study = (await req('/api/state', { cookie: ownerCookie })).data.state.studies.find(
      (s: Study) => s.id === up.data.createdStudyId,
    );
    if (study?.status === 'ready') break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(study?.segments?.length, JSON.stringify(study?.status));
  const path = '/api/studies/' + study.id + '/highlights';
  assert.equal(
    (await req(path, { cookie: viewerCookie, body: { text: 'Участник проверяет выбранные даты' } }))
      .response.status,
    403,
  );
  assert.equal(
    (await req(path, { cookie: ownerCookie, body: { text: 'Этого текста нет в материале' } }))
      .response.status,
    400,
  );
  assert.equal(
    (await req(path, { cookie: ownerCookie, body: { text: 'ок' } })).response.status,
    400,
  );
  const created = await req(path, {
    cookie: ownerCookie,
    body: { text: '  Участник  проверяет\nвыбранные даты ' },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.data));
  const item = created.data.state.highlights.find(
    (h: Highlight) => h.id === created.data.createdHighlightId,
  );
  assert.equal(item.text, 'Участник проверяет выбранные даты');
  assert.equal(item.segmentId, study.segments.find((s: Segment) => s.text.includes('Участник')).id);
  assert.equal(item.by, 'Owner');
  const seen = (await req('/api/state', { cookie: viewerCookie })).data.state.highlights || [];
  assert(
    seen.some((h: Highlight) => h.id === item.id),
    'readers see highlights',
  );
  assert.equal(
    (await req(path + '/' + item.id, { cookie: viewerCookie, method: 'DELETE' })).response.status,
    403,
  );
  const removed = await req(path + '/' + item.id, { cookie: ownerCookie, method: 'DELETE' });
  assert.equal(removed.response.status, 200);
  assert(!(removed.data.state.highlights || []).some((h: Highlight) => h.id === item.id));
  assert.equal(
    (await req(path + '/' + item.id, { cookie: ownerCookie, method: 'DELETE' })).response.status,
    404,
  );
});
test('file preview is escaped and requires an active membership in the source project', async () => {
  const uploaded = await req('/api/uploads', {
    cookie: ownerCookie,
    body: '<script>fixture</script>',
    headers: { 'x-file-name': 'preview-fixture.txt', 'Content-Type': 'text/plain' },
  });
  assert.equal(uploaded.response.status, 201);
  const id = uploaded.data.state.studies.find(
    (s: Study) => s.id === uploaded.data.createdStudyId,
  ).fileId;
  const path = '/api/files/' + id + '/preview';
  assert.equal((await req(path)).response.status, 401);
  const preview = await req(path, { cookie: viewerCookie });
  assert.equal(preview.response.status, 200);
  assert.match(preview.data.html, /&lt;script&gt;fixture&lt;\/script&gt;/);
  assert.doesNotMatch(preview.data.html, /<script>/);
  const other = await req('/api/workspaces', {
    cookie: ownerCookie,
    body: { name: 'Preview isolation fixture', mode: 'private' },
  });
  assert.equal(
    (await req(path + '?workspace=' + other.data.id, { cookie: ownerCookie })).response.status,
    404,
  );
  assert.equal(
    (await req(path + '?workspace=' + other.data.id, { cookie: viewerCookie })).response.status,
    403,
  );
});
test('XLS uploads through both endpoints are documents and preview respects reader access', async () => {
  const bytes = await readFile(new URL('./fixtures/preview.xls', import.meta.url));
  const uploaded = await req('/api/uploads', {
    cookie: ownerCookie,
    body: bytes,
    headers: { 'x-file-name': 'legacy-sheet.xls', 'Content-Type': 'application/vnd.ms-excel' },
  });
  assert.equal(uploaded.response.status, 201);
  const study = uploaded.data.state.studies.find(
    (s: Study) => s.id === uploaded.data.createdStudyId,
  );
  assert.equal(study.format, 'XLS');
  const path = '/api/files/' + study.fileId + '/preview';
  assert.equal((await req(path)).response.status, 401);
  const preview = await req(path, { cookie: viewerCookie });
  assert.equal(preview.response.status, 200);
  assert.match(preview.data.html, /<table class="sheet">/);
  const init = await req('/api/upload-sessions', {
    cookie: ownerCookie,
    body: {
      name: 'chunked-sheet.XLS',
      mime: 'application/vnd.ms-excel',
      size: bytes.length,
      autoSummary: false,
    },
  });
  assert.equal(init.response.status, 201);
  const chunk = await req('/api/upload-sessions/' + init.data.id, {
    cookie: ownerCookie,
    method: 'PUT',
    body: bytes,
    headers: { 'Content-Type': 'application/octet-stream', 'X-Upload-Offset': '0' },
  });
  assert.equal(chunk.response.status, 200);
  const done = await req('/api/upload-sessions/' + init.data.id + '/complete', {
    cookie: ownerCookie,
    body: {},
  });
  assert.equal(done.response.status, 201);
  assert.equal(
    done.data.state.studies.find((s: Study) => s.id === done.data.createdStudyId).format,
    'XLS',
  );
});
test('revocation immediately denies existing session and source URL', async () => {
  const r = await req('/api/state', { cookie: ownerCookie });
  const viewer = r.data.state.users.find((u: WorkspaceUser) => u.email === 'reader@example.com');
  assert.equal(
    (
      await req('/api/users/' + viewer.id, {
        cookie: ownerCookie,
        method: 'PATCH',
        body: { status: 'revoked' },
      })
    ).response.status,
    200,
  );
  assert.equal((await req('/api/state', { cookie: viewerCookie })).response.status, 401);
  assert.equal(
    (await req('/api/files/' + r.data.state.studies[0].fileId, { cookie: viewerCookie })).response
      .status,
    401,
  );
  assert.equal(
    (
      await req('/api/files/' + r.data.state.studies[0].fileId + '/preview', {
        cookie: viewerCookie,
      })
    ).response.status,
    401,
  );
});

test('successful recording queues one completion email to its uploader', async () => {
  const bytes = Buffer.from('Fictional recording bytes, consumed only by the ASR fixture.');
  const title = 'Completion notification fixture';
  const started = await req('/api/upload-sessions', {
    cookie: ownerCookie,
    body: {
      name: 'completion.webm',
      mime: 'video/webm',
      title,
      size: bytes.length,
      autoSummary: false,
    },
  });
  assert.equal(started.response.status, 201);
  const id = started.data.id;
  await fetch(baseURL + '/api/upload-sessions/' + id, {
    method: 'PUT',
    headers: {
      Cookie: ownerCookie,
      'X-Mnema-Request': '1',
      'X-Upload-Offset': '0',
      'Content-Type': 'application/octet-stream',
    },
    body: bytes,
  });
  const done = await req('/api/upload-sessions/' + id + '/complete', {
    cookie: ownerCookie,
    body: {},
  });
  assert.equal(done.response.status, 201);
  let mail;
  for (let i = 0; i < 80; i++) {
    mail = completionMails.find((m) => m.subject.includes(title));
    if (mail) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(mail, 'Completion email was not delivered to the injected test transport');
  assert.equal(mail.to, 'owner@example.com');
  assert.match(mail.text, new RegExp(done.data.createdStudyId));
  assert.equal(completionMails.filter((m) => m.subject.includes(title)).length, 1);
});
