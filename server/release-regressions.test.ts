import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { createMnemaServer } from './server.ts';

test('missing or truncated originals return errors without terminating the server; slow writes recheck revoked access', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mnema-release-')),
    base = 'http://127.0.0.1:4454',
    setup = randomBytes(32).toString('hex');
  const app = await createMnemaServer({
    dataDir: dir,
    baseURL: base,
    authSecret: randomBytes(48).toString('hex'),
    setupToken: setup,
    sendCompletionMail: async () => {},
  });
  try {
    await new Promise<void>((r) => app.server.listen(4454, '127.0.0.1', r));
    const registered = await fetch(base + '/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Mnema-Request': '1' },
      body: JSON.stringify({
        email: 'release@example.test',
        password: randomBytes(20).toString('hex'),
        setupToken: setup,
      }),
    });
    assert.equal(registered.status, 200);
    const cookie = registered.headers
        .getSetCookie()
        .map((c) => c.split(';')[0])
        .join('; '),
      headers = { Cookie: cookie, 'X-Mnema-Request': '1', 'Content-Type': 'application/json' };
    const raw = JSON.parse(
      String(app.db.prepare("SELECT data FROM mnema_workspaces WHERE id='main'").get().data),
    );
    raw.studies = [
      {
        id: 'missing',
        title: 'Synthetic original',
        fileId: 'source',
        fileName: 'source.txt',
        status: 'ready',
        segments: [],
        summary: [],
      },
    ];
    app.db.prepare("UPDATE mnema_workspaces SET data=? WHERE id='main'").run(JSON.stringify(raw));
    app.db
      .prepare('INSERT INTO mnema_uploads VALUES(?,?,?,?,?)')
      .run('source', 'source.txt', 'text/plain', 10, 'ready');
    assert.equal((await fetch(base + '/api/files/source', { headers })).status, 404);
    assert.equal((await fetch(base + '/healthz')).status, 200);
    await writeFile(join(dir, 'uploads', 'source'), 'x');
    assert.equal((await fetch(base + '/api/files/source', { headers })).status, 409);
    const state = await fetch(base + '/api/state', { headers }).then((r) => r.json());
    let seen: (req: http.IncomingMessage) => void;
    const incoming = new Promise<http.IncomingMessage>((r) => (seen = r));
    app.server.on('request', (req) => {
      if (req.url === '/api/state' && req.method === 'PATCH') seen(req);
    });
    const text = JSON.stringify({ version: state.version, changes: { models: [] } });
    const response = new Promise<number>((resolve, reject) => {
      const request = http.request(
        base + '/api/state',
        { method: 'PATCH', headers: { ...headers, 'Content-Length': Buffer.byteLength(text) } },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode!));
        },
      );
      request.on('error', reject);
      request.write(text.slice(0, 10));
      void incoming
        .then(async (req) => {
          const end = Date.now() + 2000;
          while (req.listenerCount('readable') === 0) {
            assert.ok(Date.now() < end);
            await new Promise((r) => setTimeout(r, 5));
          }
          app.db.prepare('UPDATE mnema_access SET revoked=1').run();
          app.db.prepare('UPDATE mnema_members SET revoked=1').run();
          request.end(text.slice(10));
        })
        .catch(reject);
    });
    assert.equal(await response, 401);
    assert.equal(
      JSON.parse(
        String(app.db.prepare("SELECT data FROM mnema_workspaces WHERE id='main'").get().data),
      ).models.length,
      raw.models.length,
    );
  } finally {
    app.notifications.close();
    app.server.closeAllConnections();
    await new Promise((r) => app.server.close(r));
    app.storage.close();
    app.db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
