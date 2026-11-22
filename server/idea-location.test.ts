import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createMnemaServer } from './server.ts';

test('idea locations follow live project, material, finding and chat access', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'mnema-idea-location-'));
  const port = 4274,
    baseURL = 'http://127.0.0.1:' + port,
    setupToken = randomBytes(32).toString('hex');
  const app = await createMnemaServer({
    dataDir,
    baseURL,
    setupToken,
    authSecret: randomBytes(48).toString('hex'),
    sendInvitationMail: async () => {},
    sendCompletionMail: async () => {},
  });
  await new Promise<void>((resolve) => app.server.listen(port, '127.0.0.1', resolve));
  const req = async (
    path: string,
    cookie = '',
    body?: unknown,
    method = body === undefined ? 'GET' : 'POST',
  ) => {
    const response = await fetch(baseURL + path, {
      method,
      headers: {
        Cookie: cookie,
        Origin: baseURL,
        'X-Mnema-Request': '1',
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json(), headers: response.headers };
  };
  const account = async (email: string, extra: Record<string, string>) => {
    const result = await req('/api/register', '', {
      email,
      name: email,
      password: 'fixture-location-password',
      ...extra,
    });
    assert.equal(result.status, 200);
    return result.headers
      .getSetCookie()
      .map((value) => value.split(';', 1)[0])
      .join('; ');
  };
  const context = { page: 'research', element: 'button', category: 'bug' };
  const post = async (
    cookie: string,
    location: { path: string; anchor?: string; label?: string },
  ) => {
    const result = await req('/api/ideas', cookie, {
      text: 'Уточнить действие на экране',
      feedback: { ...context, location },
    });
    assert.equal(result.status, 200);
    return result.data.id;
  };
  const list = async (cookie: string) => {
    const result = await req('/api/ideas', cookie);
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    return new Map(result.data.ideas.map((idea) => [idea.id, idea.feedback]));
  };
  try {
    const author = await account('location-author@example.test', { setupToken });
    const email = 'location-viewer@example.test';
    const invitation = await req('/api/invitations', author, {
      email,
      name: 'Читатель',
      role: 'view',
      scope: 'all',
    });
    assert.equal(invitation.status, 201);
    const viewer = await account(email, {
      inviteToken: new URL(invitation.data.inviteURL).searchParams.get('invite')!,
    });
    const viewerId = (await req('/api/session', viewer)).data.user.id;
    const created = await req('/api/workspaces', author, {
      name: 'Закрытый тестовый проект',
      mode: 'private',
    });
    assert.equal(created.status, 201);
    const id = created.data.id,
      project = '/projects/' + id,
      members = '/api/workspaces/' + id + '/sharing/members';
    const state = JSON.parse(
      String(app.db.prepare('SELECT data FROM mnema_workspaces WHERE id=?').get(id).data),
    );
    const segment = { id: 'source', speaker: 'Респондент', time: 0, text: 'Вымышленная запись.' };
    state.studies = [
      { id: 'material', title: 'Доступный материал', status: 'ready', segments: [segment] },
      {
        id: 'catalog-draft',
        title: 'Скрытый каталог',
        status: 'ready',
        segments: [{ ...segment, id: 'hidden-source' }],
        importSource: { catalog: true },
      },
    ];
    state.findings = [
      { id: 'verified', status: 'verified', studyId: 'material', segmentId: 'source' },
      { id: 'draft', status: 'draft', studyId: 'material', segmentId: 'source' },
      { id: 'hidden', status: 'draft', studyId: 'catalog-draft', segmentId: 'hidden-source' },
    ];
    app.db
      .prepare('UPDATE mnema_workspaces SET data=?,version=version+1 WHERE id=?')
      .run(JSON.stringify(state), id);
    const chat = await req('/api/chats', author, { projectId: id });
    assert.equal(chat.status, 201);
    const globalLocation = {
      path: '/projects',
      anchor: 'ui-projects-create',
      label: 'Кнопка «Создать»',
    };
    const chatLocation = {
      path: '/conversation/' + chat.data.id,
      anchor: 'ui-chat',
      label: 'Личный чат',
    };
    const global = await post(author, globalLocation),
      privateChat = await post(author, chatLocation);
    const locations = [
      project,
      project + '/research',
      project + '/findings',
      project + '/studies/material',
      project + '/findings/verified',
      project + '/studies/catalog-draft',
      project + '/findings/draft',
    ].map((path) => ({ path, label: 'Место в закрытом проекте' }));
    const ids: string[] = [];
    for (const location of locations) ids.push(await post(author, location));
    const forgedProject = await post(viewer, locations[0]),
      forgedChat = await post(viewer, chatLocation);
    const own = await list(author);
    assert.deepEqual(own.get(privateChat), { ...context, location: chatLocation });
    assert.deepEqual(
      ids.map((idea) => own.get(idea)),
      locations.map((location) => ({ ...context, location })),
    );
    assert.deepEqual(own.get(forgedProject), context);
    assert.deepEqual(own.get(forgedChat), context);
    const before = await list(viewer);
    assert.deepEqual(before.get(global), { ...context, location: globalLocation });
    for (const idea of [...ids, privateChat]) assert.deepEqual(before.get(idea), context);

    assert.equal((await req(members, author, { email, role: 'full' })).status, 201);
    const full = await list(viewer);
    assert.deepEqual(
      ids.map((idea) => full.get(idea)),
      locations.map((location) => ({ ...context, location })),
    );
    assert.deepEqual(full.get(privateChat), context);
    assert.equal(
      (await req(members + '/' + viewerId, author, { role: 'view' }, 'PATCH')).status,
      200,
    );
    const read = await list(viewer);
    assert.deepEqual(
      ids.map((idea) => read.get(idea)),
      locations.map((location, index) => (index < 5 ? { ...context, location } : context)),
    );
    assert.equal((await req(members + '/' + viewerId, author, undefined, 'DELETE')).status, 200);
    const revoked = await list(viewer);
    for (const idea of ids) assert.deepEqual(revoked.get(idea), context);

    assert.equal(
      (await req('/api/chats/' + chat.data.id, author, undefined, 'DELETE')).status,
      200,
    );
    assert.deepEqual((await list(author)).get(privateChat), context);
  } finally {
    app.notifications.close();
    app.server.closeAllConnections();
    await new Promise<void>((resolve) => app.server.close(() => resolve()));
    app.storage.close();
    app.db.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
