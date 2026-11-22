import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createMnemaServer } from './server.ts';

test('upload completion recovers a renamed original across restart', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'mnema-upload-recovery-')),
    port = 4277,
    baseURL = 'http://127.0.0.1:' + port;
  const setupToken = randomBytes(32).toString('hex'),
    authSecret = randomBytes(32).toString('hex');
  let app: Awaited<ReturnType<typeof createMnemaServer>>;
  async function start() {
    app = await createMnemaServer({
      dataDir,
      baseURL,
      setupToken,
      authSecret,
      sendInvitationMail: async () => {},
    });
    await new Promise<void>((resolve) => app.server.listen(port, '127.0.0.1', resolve));
  }
  async function stop() {
    app.server.closeAllConnections();
    await new Promise<void>((resolve) => app.server.close(() => resolve()));
    app.close();
  }
  await start();
  t.after(async () => {
    await stop();
    await rm(dataDir, { recursive: true, force: true });
  });

  let owner = '';
  async function req(
    path: string,
    method: string,
    body?: object | string,
    cookie = owner,
    headers: Record<string, string> = {},
  ) {
    const response = await fetch(baseURL + path, {
      method,
      headers: {
        Origin: baseURL,
        Cookie: cookie,
        'X-Mnema-Request': '1',
        'Content-Type': 'application/json',
        ...headers,
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    return {
      status: response.status,
      data: await response.json(),
      cookie: response.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; '),
    };
  }
  const account = await req('/api/register', 'POST', {
    email: 'upload-recovery@example.test',
    password: 'fixture-password-2026',
    setupToken,
  });
  assert.equal(account.status, 200);
  owner = account.cookie;
  const bytes = 'Synthetic document for restart.';
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const original = (id: string) => join(dataDir, 'uploads', id);
  async function renamedUpload(name: string, metadata: object = {}, cookie = owner) {
    const init = await req(
      '/api/upload-sessions',
      'POST',
      { name, size: Buffer.byteLength(bytes), sha256, ...metadata },
      cookie,
    );
    assert.equal(init.status, 201);
    const id = init.data.id,
      path = '/api/upload-sessions/' + id;
    assert.equal(
      (
        await req(path, 'PUT', bytes, cookie, {
          'X-Upload-Offset': '0',
          'Content-Type': 'application/octet-stream',
        })
      ).status,
      200,
    );
    // Reproduce the on-disk state left by a restart after the move but before the commit.
    await rename(original(id) + '.part', original(id));
    return { id, path };
  }
  const studies = () =>
    JSON.parse(
      String(app.db.prepare("SELECT data FROM mnema_workspaces WHERE id='main'").get()?.data),
    ).studies;
  const first = await renamedUpload('recover.txt');
  await stop();
  await start();

  const saved = await req(first.path + '/complete', 'POST', {});
  assert.equal(saved.status, 201);
  assert.equal(await readFile(original(first.id), 'utf8'), bytes);
  assert.equal(
    (
      await fetch(baseURL + '/api/files/' + first.id, {
        method: 'HEAD',
        headers: { Cookie: owner },
      })
    ).status,
    200,
  );
  const reply = await req(first.path + '/complete', 'POST', {});
  assert.equal(reply.status, 201);
  assert.equal(reply.data.createdStudyId, saved.data.createdStudyId);
  assert.equal(studies().filter((study) => study.fileId === first.id).length, 1);
  assert.equal(
    app.db
      .prepare('SELECT count(*) AS n FROM mnema_jobs WHERE study_id=? AND kind=?')
      .get(saved.data.createdStudyId, 'document')?.n,
    1,
  );

  const legacy = await renamedUpload('legacy.txt');
  const state = JSON.parse(
    String(app.db.prepare("SELECT data FROM mnema_workspaces WHERE id='main'").get()?.data),
  );
  state.studies.push({
    ...state.studies.find((study) => study.fileId === first.id),
    id: 'legacy-study',
    fileId: legacy.id,
    fileName: 'legacy.txt',
    title: 'Legacy material',
    status: 'processing',
  });
  app.db
    .prepare("UPDATE mnema_workspaces SET data=?,version=version+1 WHERE id='main'")
    .run(JSON.stringify(state));
  app.db.prepare('UPDATE mnema_upload_sessions SET created=0 WHERE id=?').run(legacy.id);
  // A new reservation runs expiry, and cancelling must not remove the linked original either.
  assert.equal(
    (await req('/api/upload-sessions', 'POST', { name: 'new.txt', size: 1 })).status,
    201,
  );
  assert.equal((await req(legacy.path, 'DELETE')).status, 409);
  assert.equal(await readFile(original(legacy.id), 'utf8'), bytes);
  const repaired = await req(legacy.path + '/complete', 'POST', {});
  assert.equal(repaired.status, 201);
  assert.equal(repaired.data.createdStudyId, 'legacy-study');
  assert.equal(studies().filter((study) => study.fileId === legacy.id).length, 1);
  assert.equal(
    app.db.prepare('SELECT status FROM mnema_uploads WHERE id=?').get(legacy.id)?.status,
    'ready',
  );
  assert.equal(
    app.db.prepare('SELECT count(*) AS n FROM mnema_jobs WHERE study_id=?').get('legacy-study')?.n,
    1,
  );

  const failed = await renamedUpload('interrupted-commit.txt');
  const jobs = () => app.db.prepare('SELECT count(*) AS n FROM mnema_jobs').get()?.n;
  const beforeJobs = jobs();
  app.db.exec(
    "CREATE TRIGGER fixture_reject_completion BEFORE UPDATE OF metadata ON mnema_upload_sessions BEGIN SELECT RAISE(ABORT,'fixture transaction failure'); END",
  );
  const failedReply = await req(failed.path + '/complete', 'POST', {});
  assert.equal(failedReply.status, 500);
  assert.equal(
    studies().some((study) => study.fileId === failed.id),
    false,
  );
  assert.equal(
    app.db.prepare('SELECT status FROM mnema_uploads WHERE id=?').get(failed.id)?.status,
    'uploading',
  );
  assert.equal(jobs(), beforeJobs);
  assert.equal(await readFile(original(failed.id), 'utf8'), bytes);
  app.db.exec('DROP TRIGGER fixture_reject_completion');
  assert.equal((await req(failed.path + '/complete', 'POST', {})).status, 201);

  const damaged = await renamedUpload('damaged.txt');
  await writeFile(original(damaged.id), 'too short');
  assert.equal((await req(damaged.path + '/complete', 'POST', {})).status, 409);
  await writeFile(original(damaged.id), 'X'.repeat(Buffer.byteLength(bytes)));
  const corrupted = await req(damaged.path + '/complete', 'POST', {});
  assert.equal(corrupted.status, 409);
  assert.match(corrupted.data.error, /Контрольная сумма/);
  assert.equal(studies().filter((study) => study.fileId === damaged.id).length, 0);
  assert.equal((await req(damaged.path, 'DELETE')).status, 200);
  await assert.rejects(readFile(original(damaged.id)), { code: 'ENOENT' });

  const email = 'upload-revoked@example.test';
  const invite = await req('/api/invitations', 'POST', {
    email,
    name: 'Synthetic uploader',
    role: 'full',
  });
  assert.equal(invite.status, 201);
  const inviteToken = new URL(invite.data.inviteURL).searchParams.get('invite');
  const uploader = await req(
    '/api/register',
    'POST',
    { email, password: 'fixture-password-2026', inviteToken },
    '',
  );
  assert.equal(uploader.status, 200);
  const revoked = await renamedUpload('revoked.txt', {}, uploader.cookie);
  app.db
    .prepare('UPDATE mnema_access SET revoked=1 WHERE user_id=(SELECT id FROM user WHERE email=?)')
    .run(email);
  assert.equal((await req(revoked.path + '/complete', 'POST', {}, uploader.cookie)).status, 401);
  assert.equal(studies().filter((study) => study.fileId === revoked.id).length, 0);
  assert.equal(await readFile(original(revoked.id), 'utf8'), bytes);
});
