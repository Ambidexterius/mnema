import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Person, RequestServices } from '../request-context.ts';
import { fail, handledJson } from '../http.ts';
import type { openDatabase } from '../db.ts';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { uniqueNames, writeZip } from '../zip.ts';
import { documentPreview } from '../document-preview.ts';
import type { createS3Mirror } from '../s3-storage.ts';

interface FileServices extends Pick<RequestServices, 'session'> {
  q: ReturnType<typeof openDatabase>['q'];
  dir: string;
  currentWs: () => string;
  view: (person: Person) => { state: any };
  storageMirror: ReturnType<typeof createS3Mirror>;
}

interface StorageServices extends Pick<RequestServices, 'body'> {
  storageMirror: ReturnType<typeof createS3Mirror>;
}

export async function handleStorage(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  person: Person,
  { storageMirror, body }: StorageServices,
) {
  if (path === '/api/storage' && req.method === 'GET') {
    if (!person.admin) fail(403, 'Доступно участникам с полным доступом.');
    return handledJson(res, 200, storageMirror.status());
  }
  if (path === '/api/storage/verify-backup' && req.method === 'POST') {
    if (!person.owner) fail(403, 'Доступно владельцу сервиса.');
    await body(req);
    try {
      return handledJson(res, 200, await storageMirror.verifyBackup());
    } catch {
      fail(
        503,
        'Не удалось проверить резервную копию. Дождитесь завершения копирования и повторите.',
      );
    }
  }
  if (path === '/api/storage/sync' && req.method === 'POST') {
    if (!person.owner) fail(403, 'Доступно владельцу сервиса.');
    await body(req);
    void storageMirror.tick();
    return handledJson(res, 202, storageMirror.status());
  }
  return false;
}

export async function handleFiles(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  person: Person,
  { view, session, q, dir, currentWs, storageMirror }: FileServices,
) {
  const path = url.pathname;
  if (/^\/api\/files\/[^/]+\/preview$/.test(path) && req.method === 'GET') {
    const id = path.split('/')[3];
    const study = view(person).state.studies.find((s) => s.fileId === id);
    const file = study && q("SELECT * FROM mnema_uploads WHERE id=? AND status='ready'").get(id);
    if (!file) fail(404, 'Файл не найден.');
    let html;
    try {
      html = /\.pdf$/i.test(file.name)
        ? null
        : await documentPreview(join(dir, 'uploads', id), file.name);
    } catch {
      fail(422, 'Не удалось открыть предпросмотр. Исходный файл сохранён.');
    }
    const current = await session(req);
    if (
      !current ||
      current.workspaceId !== person.workspaceId ||
      !view(current).state.studies.some((s) => s.fileId === id)
    )
      fail(403, 'Доступ к файлу закрыт.');
    return handledJson(res, 200, { html });
  }
  if (path === '/api/files/archive' && req.method === 'GET') {
    // Every ready file the person can open in this project, as one ZIP read from the retained local copies.
    const files = view(person)
      .state.studies.filter((s) => s.fileId)
      .map((s) =>
        q("SELECT id,name FROM mnema_uploads WHERE id=? AND status='ready'").get(s.fileId),
      )
      .filter(Boolean);
    if (!files.length) fail(404, 'В проекте нет файлов для скачивания.');
    for (const f of files) {
      try {
        if (!(await stat(join(dir, 'uploads', f.id))).isFile()) throw 0;
      } catch {
        fail(404, 'Исходный файл недоступен. Обратитесь к администратору.');
      }
    }
    const current = await session(req);
    if (
      !current ||
      current.workspaceId !== person.workspaceId ||
      files.some((f) => !view(current).state.studies.some((s) => s.fileId === f.id))
    )
      fail(403, 'Доступ к файлам закрыт.');
    const project =
      q('SELECT name FROM mnema_workspaces WHERE id=?').get(currentWs())?.name || 'Материалы';
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(project + '.zip')}`,
    });
    const names = uniqueNames(files.map((f) => f.name));
    await writeZip(
      res,
      files.map((f, i) => ({ name: names[i], path: join(dir, 'uploads', f.id) })),
    );
    return true;
  }
  if (/^\/api\/files\/[^/]+$/.test(path) && ['GET', 'HEAD'].includes(req.method)) {
    const id = path.split('/').at(-1);
    const study = view(person).state.studies.find((s) => s.fileId === id);
    const file = study && q("SELECT * FROM mnema_uploads WHERE id=? AND status='ready'").get(id);
    if (!file) fail(404, 'Файл не найден.');
    const isPDF = /\.pdf$/i.test(file.name),
      isText = /\.txt$/i.test(file.name);
    const mime = isPDF
      ? 'application/pdf'
      : isText
        ? 'text/plain; charset=utf-8'
        : /^video\//.test(file.mime) || /^audio\//.test(file.mime)
          ? file.mime
          : 'application/octet-stream';
    let start = 0,
      end = file.size - 1,
      status = 200;
    const r = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    if (req.headers.range && !r) fail(416, 'Некорректный диапазон.');
    if (r) {
      start = Number(r[1]);
      end = r[2] ? Math.min(Number(r[2]), end) : end;
      if (start > end || start >= file.size) fail(416, 'Некорректный диапазон.');
      status = 206;
    }
    const headers = {
      'Content-Type': mime,
      'Content-Length': end - start + 1,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `${url.searchParams.get('download') === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    };
    if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${file.size}`;
    if (storageMirror.has(id)) {
      try {
        const remote = await storageMirror.objects.request(
          req.method,
          storageMirror.objectKey(id),
          undefined,
          req.headers.range ? { range: req.headers.range } : {},
        );
        const remoteHeaders = {
          ...headers,
          'X-Mnema-Storage': 's3',
          'Content-Length': remote.headers.get('content-length') || String(end - start + 1),
          ...(remote.headers.get('content-range')
            ? { 'Content-Range': remote.headers.get('content-range') }
            : {}),
        };
        const latest = await session(req);
        if (
          !latest ||
          latest.workspaceId !== person.workspaceId ||
          !view(latest).state.studies.some((s) => s.fileId === id)
        ) {
          await remote.body?.cancel();
          fail(403, 'Доступ к файлу закрыт.');
        }
        res.writeHead(remote.status, remoteHeaders);
        if (req.method === 'HEAD') {
          res.end();
          return true;
        }
        await pipeline(Readable.fromWeb(remote.body as any), res);
        return true;
      } catch (e) {
        if (res.headersSent) throw e;
        console.error('S3 read unavailable; using retained local copy');
      }
    }
    const local = join(dir, 'uploads', id);
    let info;
    try {
      info = await stat(local);
    } catch {
      fail(404, 'Исходный файл недоступен. Обратитесь к администратору.');
    }
    if (!info.isFile()) fail(404, 'Исходный файл недоступен.');
    if (info.size !== file.size)
      fail(409, 'Размер исходного файла изменился. Обратитесь к администратору.');
    const latest = await session(req);
    if (
      !latest ||
      latest.workspaceId !== person.workspaceId ||
      !view(latest).state.studies.some((s) => s.fileId === id)
    )
      fail(403, 'Доступ к файлу закрыт.');
    res.writeHead(status, { ...headers, 'X-Mnema-Storage': 'local' });
    if (req.method === 'HEAD') {
      res.end();
      return true;
    }
    await pipeline(createReadStream(local, { start, end }), res);
    return true;
  }
  return false;
}
