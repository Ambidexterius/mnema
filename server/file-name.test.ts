import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {createMnemaServer} from './server.ts';

test('uploads reserve the original file name within the project', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'mnema-file-names-'));
  const base = 'http://127.0.0.1:4214';
  const setupToken = randomBytes(32).toString('hex');
  const app = await createMnemaServer({dataDir: dir, baseURL: base, setupToken, authSecret: randomBytes(32).toString('hex')});
  await new Promise<void>(resolve => app.server.listen(4214, '127.0.0.1', resolve));
  t.after(async () => {
    app.server.closeAllConnections();
    await new Promise<void>(resolve => app.server.close(() => resolve()));
    app.close();
    await rm(dir, {recursive: true, force: true});
  });

  let cookie = '';
  async function request(path: string, method: string, body?: object | string, workspace = 'main', headers: Record<string, string> = {}) {
    const response = await fetch(base + path, {
      method,
      headers: {Origin: base, Cookie: cookie, 'X-Mnema-Request': '1', 'X-Mnema-Workspace': workspace, 'Content-Type': 'application/json', ...headers},
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    return {status: response.status, data: await response.json(), headers: response.headers};
  }
  const owner = await request('/api/register', 'POST', {
    email: 'fixture@example.test', password: 'file-name-test-password', setupToken,
  });
  assert.equal(owner.status, 200);
  cookie = owner.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');

  function start(name: string, workspace = 'main') {
    return request('/api/upload-sessions', 'POST', {name, size: 1, title: 'Одинаковый заголовок материала', deferProcessing: true}, workspace);
  }
  function direct(name: string) {
    return request('/api/uploads', 'POST', 'X', 'main', {'X-File-Name': encodeURIComponent(name), 'Content-Type': 'application/octet-stream'});
  }
  function assertConflict(result: Awaited<ReturnType<typeof request>>, code: string) {
    assert.equal(result.status, 409);
    assert.equal(result.data.code, code);
    assert.match(result.data.error, /файл/i);
  }

  await t.test('a single reservation wins the race, blocks the other upload route and releases on cancel', async () => {
    const names = ['Отчёт.WEBM', '  отчёт.webm  '.normalize('NFD')];
    const attempts = await Promise.all(names.map(name => start(name)));
    assert.deepEqual(attempts.map(value => value.status).sort(), [201, 409]);
    assertConflict(attempts.find(value => value.status === 409)!, 'file_name_uploading');
    assertConflict(await direct('ОТЧЁТ.webm'), 'file_name_uploading');

    const id = attempts.find(value => value.status === 201)!.data.id;
    assert.equal((await request('/api/upload-sessions/' + id, 'DELETE')).status, 200);
    const next = await start(names[0]);
    assert.equal(next.status, 201);
    assert.equal((await request('/api/upload-sessions/' + next.data.id, 'DELETE')).status, 200);
  });

  await t.test('simultaneous direct uploads with the same name create one material', async () => {
    const attempts = await Promise.all([direct('Синхронная загрузка.webm'), direct('СИНХРОННАЯ ЗАГРУЗКА.WEBM')]);
    assert.deepEqual(attempts.map(result => result.status).sort(), [201, 409]);
    const rejected = attempts.find(result => result.status === 409)!;
    assert.ok(['file_name_uploading', 'duplicate_file_name'].includes(rejected.data.code));
    const saved = attempts.find(result => result.status === 201)!;
    const state = await request('/api/state', 'GET');
    assert.equal(state.status, 200);
    const matching = state.data.state.studies.filter(study => study.fileName?.toLowerCase() === 'синхронная загрузка.webm');
    assert.deepEqual(matching.map(study => study.id), [saved.data.createdStudyId]);
  });

  await t.test('completion is idempotent, other projects and extensions may use the same base name', async () => {
    const file = 'Пробное интервью.webm';
    const session = await start(file);
    assert.equal(session.status, 201);
    const path = '/api/upload-sessions/' + session.data.id;
    const part = await request(path, 'PUT', 'X', 'main', {'X-Upload-Offset': '0', 'Content-Type': 'application/octet-stream'});
    assert.equal(part.status, 200);
    const saved = await request(path + '/complete', 'POST', {});
    const replay = await request(path + '/complete', 'POST', {});
    assert.equal(saved.status, 201);
    assert.equal(replay.status, 201);
    assert.equal(replay.data.createdStudyId, saved.data.createdStudyId);
    assert.equal(replay.data.state.studies.filter(study => study.fileId === session.data.id).length, 1);
    assertConflict(await start(file), 'duplicate_file_name');
    assertConflict(await direct(file), 'duplicate_file_name');

    const otherFormat = await start('Пробное интервью.mp3');
    assert.equal(otherFormat.status, 201);
    const otherProject = await request('/api/workspaces', 'POST', {name: 'Второй проект'});
    assert.equal(otherProject.status, 201);
    assert.equal((await start(file, otherProject.data.id)).status, 201);
    assert.equal((await request('/api/studies/' + saved.data.createdStudyId, 'DELETE')).status, 200);
    assert.equal((await start(file)).status, 201);
  });
});
