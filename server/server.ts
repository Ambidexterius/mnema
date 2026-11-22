import http from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backendBuildId } from './build-id.ts';
import { loadExtension } from './extension.ts';
import { json } from './http.ts';
import { createRequestHandler } from './routes.ts';
import { createRuntime, type MnemaServerOptions } from './runtime.ts';

export type { MnemaServerOptions } from './runtime.ts';
export { answerTemplate } from './chat/prompt.ts';

process.umask(0o077);
const packageInfo = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const VERSION: string = packageInfo.version;
// Identify the loaded backend even when several fixes share one product version.
const bundledExtension = await loadExtension(process.env.MNEMA_APP_EXTENSION === '1');
export const BUILD_ID = backendBuildId(
  new URL('.', import.meta.url),
  VERSION,
  packageInfo.dependencies,
  Boolean(bundledExtension),
);

export async function createMnemaServer(options: MnemaServerOptions = {}) {
  const runtime = await createRuntime(options, {
    version: VERSION,
    buildId: BUILD_ID,
    bundledExtension,
  });
  const { auth, db, storageMirror, completionMail, stopWorker, mcpService } = runtime;
  const handler = createRequestHandler(runtime, options, VERSION, BUILD_ID);
  const server = http.createServer((req, res) => {
    handler(req, res).catch(() => {
      if (!res.headersSent) json(res, 500, { error: 'Не удалось выполнить запрос.' });
    });
  });
  server.once('close', () => {
    storageMirror.close();
    stopWorker();
    mcpService.close().catch(() => {});
  });
  server.requestTimeout = 30 * 60 * 1000;
  server.headersTimeout = 30000;
  return {
    server,
    db,
    auth,
    storage: storageMirror,
    notifications: completionMail,
    close: () => {
      storageMirror.close();
      completionMail.close();
      stopWorker();
      server.close();
      db.close();
    },
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await createMnemaServer({
    corporateRegistration: process.env.MNEMA_CORPORATE_REGISTRATION === '1',
  });
  const port = Number(process.env.PORT || 4180);
  app.server.listen(port, '0.0.0.0', () =>
    console.log('Mnema ' + VERSION + ' listening on ' + port),
  );
  for (const signal of ['SIGTERM', 'SIGINT'])
    process.on(signal, () => {
      app.server.close(() => {
        app.db.close();
        process.exit(0);
      });
    });
}
