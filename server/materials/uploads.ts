import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Person, RequestServices } from '../request-context.ts';
import { fail, handledJson, text } from '../http.ts';
import type { openDatabase } from '../db.ts';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { appendFile, lstat, rename, truncate, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileNameKey, existingFileMessage, uploadingFileMessage } from '../../app/file-name.ts';
import { processingReadiness } from '../processing.ts';

interface UploadServices extends Pick<RequestServices, 'body' | 'limit'> {
  getState: () => { state: any; version: number };
  mutate: (change: (state: any) => void) => unknown;
  view: (person: Person) => { state: any };
  q: ReturnType<typeof openDatabase>['q'];
  db: Pick<ReturnType<typeof openDatabase>['db'], 'exec'>;
  dir: string;
  fromTables: boolean;
  quota: number;
  currentWs: () => string;
  recordingProcessor?: (...args: any[]) => unknown;
  deletingStudies: ReadonlySet<string>;
  jobKey: (workspace: string, study: string) => string;
  activeStudyJob: (id: string) => unknown;
  queueStudy: (study: any, kind: string) => void;
  recheckWrite: (req: IncomingMessage) => Promise<unknown>;
}

export function createUploads({
  q,
  db,
  dir,
  fromTables,
  quota,
  currentWs,
  getState,
  mutate,
  recordingProcessor,
  deletingStudies,
  jobKey,
  activeStudyJob,
  queueStudy,
  body,
  limit,
  view,
  recheckWrite,
}: UploadServices) {
  const uploadBusy = new Set<string>();
  // Both upload routes claim a name before accepting bytes. The SQLite writer lock
  // covers the check and reservation, including requests from different users.
  function checkUploadName(name: string, ownReservation?: string) {
    const key = fileNameKey(name);
    const existing = getState().state.studies.some((study) => {
      const originalName =
        study.fileName ||
        (study.fileId && q('SELECT name FROM mnema_uploads WHERE id=?').get(study.fileId)?.name);
      return originalName && fileNameKey(originalName) === key;
    });
    if (existing) fail(409, existingFileMessage, { uploadCode: 'duplicate_file_name' });
    // Sessions created before name reservations may already share a name.
    // In that case only the earliest open session can finish first.
    const pending = q(`SELECT u.name FROM mnema_upload_sessions s JOIN mnema_uploads u ON u.id=s.id
   WHERE u.status='uploading' AND coalesce(json_extract(s.metadata,'$.workspaceId'),'main')=?
   AND (? IS NULL OR s.rowid < (SELECT rowid FROM mnema_upload_sessions WHERE id=?))`).all(
      currentWs(),
      ownReservation ?? null,
      ownReservation ?? null,
    );
    if (pending.some((row) => fileNameKey(row.name) === key)) {
      fail(409, uploadingFileMessage, { uploadCode: 'file_name_uploading' });
    }
  }
  function releasePendingUpload(id: string) {
    q('DELETE FROM mnema_upload_sessions WHERE id=?').run(id);
    q("DELETE FROM mnema_uploads WHERE id=? AND status='uploading'").run(id);
  }
  function hasUploadStudy(id: string, workspaceId: string) {
    return Boolean(
      q(
        fromTables
          ? "SELECT 1 FROM mnema_studies WHERE workspace_id=? AND json_extract(meta, '$.fileId')=?"
          : "SELECT 1 FROM mnema_workspaces w, json_each(w.data,'$.studies') s WHERE w.id=? AND json_extract(s.value,'$.fileId')=?",
      ).get(workspaceId, id),
    );
  }
  function discardUpload(id: string, status?: string) {
    releasePendingUpload(id);
    const paths = [id + '.part', ...(status === 'uploading' ? [id] : [])];
    return Promise.all(paths.map((path) => unlink(join(dir, 'uploads', path)).catch(() => {})));
  }
  async function expireUploads() {
    const expired =
      q(`SELECT s.id,u.status,coalesce(json_extract(s.metadata,'$.workspaceId'),'main') AS workspaceId,
   json_extract(s.metadata,'$.completedStudyId') AS completedStudyId
   FROM mnema_upload_sessions s LEFT JOIN mnema_uploads u ON u.id=s.id WHERE s.created<?`).all(
        Date.now() - 86400000,
      );
    const cleanup: ReturnType<typeof discardUpload>[] = [];
    for (const { id, status, workspaceId, completedStudyId } of expired) {
      if (uploadBusy.has(id)) continue;
      if (!completedStudyId && hasUploadStudy(id, workspaceId)) continue;
      cleanup.push(discardUpload(id, status));
    }
    await Promise.all(cleanup);
  }
  function reserveUpload(
    name: string,
    mime: string,
    size: number,
    userId: string,
    metadata: object,
  ) {
    const id = randomUUID();
    db.exec('BEGIN IMMEDIATE');
    try {
      checkUploadName(name);
      const used = q(
        "SELECT coalesce(sum(size),0) AS n FROM mnema_uploads WHERE status IN ('ready','uploading')",
      ).get().n;
      if (used + size > quota) fail(413, 'Недостаточно места в хранилище.');
      q('INSERT INTO mnema_uploads VALUES(?,?,?,?,?)').run(id, name, mime, size, 'uploading');
      q('INSERT INTO mnema_upload_sessions VALUES(?,?,?,0,?)').run(
        id,
        userId,
        JSON.stringify({ ...metadata, workspaceId: currentWs() }),
        Date.now(),
      );
      db.exec('COMMIT');
      return id;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  function finalizeUpload(
    id: string,
    name: string,
    mime: string,
    meta,
    person: Person,
    linkedStudyId?: string,
  ) {
    const isDoc = /\.(txt|pdf|docx|doc|xlsx|xls)$/i.test(name);
    const autoProcess =
      !meta.deferProcessing &&
      (isDoc || (meta.autoProcess !== false && (recordingProcessor || processingReadiness().asr)));
    let createdStudyId: string;
    mutate((state) => {
      let study = state.studies.find((item) => item.fileId === id);
      if (
        (linkedStudyId && study?.id !== linkedStudyId) ||
        (study && deletingStudies.has(jobKey(currentWs(), study.id))) ||
        !q(
          'SELECT 1 FROM mnema_upload_sessions s JOIN mnema_uploads u ON u.id=s.id WHERE s.id=?',
        ).get(id)
      )
        fail(409, 'Загрузка изменилась. Обновите страницу.');
      if (!study) {
        study = {
          id: randomUUID(),
          fileId: id,
          title: text(meta.title, 140) || name,
          description: '',
          project: text(meta.project, 80),
          type: ['Интервью', 'Юзабилити-тест', 'Встреча', 'Отчёт'].includes(meta.type)
            ? meta.type
            : 'Интервью',
          format: isDoc
            ? /\.pdf$/i.test(name)
              ? 'PDF'
              : /\.docx?$/i.test(name)
                ? 'Word'
                : /\.xlsx?$/i.test(name)
                  ? /\.xls$/i.test(name)
                    ? 'XLS'
                    : 'XLSX'
                  : 'TXT'
            : 'Видео',
          date: new Date().toISOString().slice(0, 10),
          duration: 0,
          participants: isDoc ? 0 : meta.participants || 0,
          status: 'uploaded',
          tags: [],
          color: 'sage',
          findings: 0,
          summary: [],
          segments: [],
          fileName: name,
          mime,
          addedBy: person.name,
          uploadedById: person.id,
          importSource: meta.importId
            ? { provider: 'external', fileId: meta.importId, sha256: meta.sha256 }
            : undefined,
          autoSummary:
            meta.autoSummary === true
              ? { requestedBy: person.id, modelId: state.modelId }
              : undefined,
        };
        state.studies.unshift(study);
      }
      // Old releases could commit the material before inserting its job.
      if (
        autoProcess &&
        ['uploaded', 'processing'].includes(study.status) &&
        !activeStudyJob(study.id)
      )
        queueStudy(study, isDoc ? 'document' : 'asr');
      createdStudyId = study.id;
      q("UPDATE mnema_uploads SET status='ready' WHERE id=?").run(id);
      q(
        'UPDATE mnema_upload_sessions SET received=(SELECT size FROM mnema_uploads WHERE id=?),metadata=?,created=? WHERE id=?',
      ).run(
        id,
        JSON.stringify({ ...meta, workspaceId: currentWs(), completedStudyId: createdStudyId }),
        Date.now(),
        id,
      );
    });
    return createdStudyId!;
  }
  async function handleUpload(req: IncomingMessage, res: ServerResponse, url: URL, person: Person) {
    const path = url.pathname;
    if (path === '/api/upload-sessions' && req.method === 'POST') {
      if (person.role !== 'full') fail(403, 'Добавление материалов недоступно.');
      limit('upload-init:' + person.id, 60);
      const b = await body(req),
        name = text(b.name, 200),
        size = b.size;
      if (!/\.(txt|pdf|doc|docx|xlsx|xls|mp4|webm|mp3|wav|m4a|mov)$/i.test(name))
        fail(400, 'Этот формат файла не поддерживается.');
      if (!Number.isSafeInteger(size) || size < 1 || size > 2 * 1024 ** 3)
        fail(413, 'Файл должен быть непустым и не больше 2 ГБ.');
      if (
        b.participants !== undefined &&
        (!Number.isSafeInteger(b.participants) || b.participants < 1)
      )
        fail(400, 'Введите целое число участников больше нуля.');
      await expireUploads();
      const id = reserveUpload(
        name,
        text(b.mime, 100) || 'application/octet-stream',
        size,
        person.id,
        {
          title: b.title,
          type: b.type,
          project: b.project,
          participants: b.participants,
          autoSummary: b.autoSummary === true,
          autoProcess: b.autoProcess !== false,
          deferProcessing: person.admin && b.deferProcessing === true,
          importId:
            person.admin && /^[a-f0-9-]{36}$/.test(b.importId || '') ? b.importId : undefined,
          sha256: person.admin && /^[a-f0-9]{64}$/.test(b.sha256 || '') ? b.sha256 : undefined,
        },
      );
      try {
        await writeFile(join(dir, 'uploads', id + '.part'), '', { flag: 'wx', mode: 0o600 });
      } catch (error) {
        releasePendingUpload(id);
        throw error;
      }
      return handledJson(res, 201, { id, offset: 0, chunkSize: 512 * 1024 });
    }
    if (/^\/api\/upload-sessions\/[^/]+(?:\/complete)?$/.test(path)) {
      if (person.role !== 'full') fail(403, 'Загрузка недоступна.');
      const id = path.split('/')[3],
        upload = q(
          'SELECT s.*,u.name,u.mime,u.size,u.status FROM mnema_upload_sessions s JOIN mnema_uploads u ON u.id=s.id WHERE s.id=? AND s.user_id=?',
        ).get(id, person.id);
      const metadata = upload && JSON.parse(upload.metadata);
      if (!upload || (metadata.workspaceId || 'main') !== currentWs())
        fail(404, 'Загрузка не найдена.');
      const { completedStudyId } = metadata,
        temporary = join(dir, 'uploads', id + '.part'),
        destination = join(dir, 'uploads', id);
      if (req.method === 'GET')
        return handledJson(res, 200, {
          id,
          offset: upload.received,
          chunkSize: 512 * 1024,
          completedStudyId,
        });
      if (completedStudyId) {
        if (req.method === 'POST' && path.endsWith('/complete'))
          return handledJson(res, 201, { ...view(person), createdStudyId: completedStudyId });
        fail(409, 'Файл уже сохранён. Откройте материал.');
      }
      if (uploadBusy.has(id)) fail(409, 'Часть файла ещё загружается.');
      uploadBusy.add(id);
      try {
        if (req.method === 'DELETE') {
          if (hasUploadStudy(id, currentWs()))
            fail(409, 'Файл уже связан с материалом. Завершите загрузку.');
          await discardUpload(id, upload.status);
          return handledJson(res, 200, { ok: true });
        }
        if (req.method === 'PUT' && !path.endsWith('/complete')) {
          const offset = Number(req.headers['x-upload-offset']),
            size = Number(req.headers['content-length']);
          if (
            !Number.isSafeInteger(offset) ||
            !Number.isSafeInteger(size) ||
            size < 1 ||
            size > 512 * 1024 ||
            offset + size > upload.size
          )
            fail(400, 'Некорректная часть файла.');
          let length = 0;
          const pieces = [];
          for await (const chunk of req) {
            length += chunk.length;
            if (length > size) fail(413, 'Слишком большая часть файла.');
            pieces.push(chunk);
          }
          if (length !== size) fail(400, 'Загрузка части прервана.');
          await recheckWrite(req);
          if (offset < upload.received && offset + size <= upload.received)
            return handledJson(res, 200, { offset: upload.received });
          if (offset !== upload.received) fail(409, 'Позиция загрузки изменилась.');
          await truncate(temporary, offset);
          await appendFile(temporary, Buffer.concat(pieces));
          q('UPDATE mnema_upload_sessions SET received=?,created=? WHERE id=?').run(
            offset + size,
            Date.now(),
            id,
          );
          return handledJson(res, 200, { offset: offset + size });
        }
        if (req.method === 'POST' && path.endsWith('/complete')) {
          await body(req);
          if (upload.received !== upload.size) fail(409, 'Дождитесь загрузки всех частей файла.');
          const linkedStudyId = getState().state.studies.find((study) => study.fileId === id)?.id;
          // A previous /complete can have renamed the file before SQLite committed.
          const fileInfo = async (path: string) =>
            lstat(path).catch((error) => {
              if (error.code === 'ENOENT') return null;
              throw error;
            });
          const moved = await fileInfo(destination);
          const file = moved ?? (await fileInfo(temporary));
          if (!file?.isFile() || file.size !== upload.size)
            fail(409, 'Дождитесь загрузки всех частей файла.');
          if (metadata.sha256) {
            const digest = createHash('sha256');
            for await (const bytes of createReadStream(moved ? destination : temporary))
              digest.update(bytes);
            if (digest.digest('hex') !== metadata.sha256)
              fail(409, 'Контрольная сумма не совпала. Загрузите исходник ещё раз.');
          }
          if (!linkedStudyId) checkUploadName(upload.name, id);
          await recheckWrite(req);
          if (!moved) {
            await rename(temporary, destination);
            await recheckWrite(req);
          }
          const createdStudyId = finalizeUpload(
            id,
            upload.name,
            upload.mime,
            metadata,
            person,
            linkedStudyId,
          );
          return handledJson(res, 201, { ...view(person), createdStudyId });
        }
        fail(405, 'Метод недоступен.');
      } finally {
        uploadBusy.delete(id);
      }
    }
    if (path === '/api/uploads' && req.method === 'POST') {
      if (person.role !== 'full') fail(403, 'Добавление материалов недоступно.');
      const name = text(
          decodeURIComponent((req.headers['x-file-name'] as string | undefined) || ''),
          200,
        ),
        size = Number(req.headers['content-length']);
      if (!Number.isSafeInteger(size) || size < 1 || size > 2 * 1024 ** 3)
        fail(413, 'Файл должен быть непустым и не больше 2 ГБ.');
      if (!/\.(txt|pdf|doc|docx|xlsx|xls|mp4|webm|mp3|wav|m4a|mov)$/i.test(name))
        fail(400, 'Поддерживаются TXT, PDF, DOC, DOCX, XLS, XLSX, MP4, WEBM, MP3, WAV, M4A и MOV.');
      await expireUploads();
      const mime = String(req.headers['content-type'] || 'application/octet-stream');
      const metadata = {
        title: url.searchParams.get('title'),
        type: url.searchParams.get('type'),
        project: url.searchParams.get('project'),
      };
      const id = reserveUpload(name, mime, size, person.id, metadata);
      const tmp = join(dir, 'uploads', id + '.part'),
        dest = join(dir, 'uploads', id);
      let received = 0;
      uploadBusy.add(id);
      try {
        await pipeline(
          req,
          new Transform({
            transform(chunk, enc, cb) {
              received += chunk.length;
              if (received > size) cb(new Error('Превышен размер файла.'));
              else cb(null, chunk);
            },
          }),
          createWriteStream(tmp, { flags: 'wx', mode: 0o600 }),
        );
        if (received !== size) throw new Error('Загрузка прервана. Повторите её.');
        await recheckWrite(req);
        q('UPDATE mnema_upload_sessions SET received=? WHERE id=?').run(received, id);
        await rename(tmp, dest);
        await recheckWrite(req);
        const createdStudyId = finalizeUpload(id, name, mime, metadata, person);
        return handledJson(res, 201, { ...view(person), createdStudyId });
      } finally {
        uploadBusy.delete(id);
        await discardUpload(id, q('SELECT status FROM mnema_uploads WHERE id=?').get(id)?.status);
      }
    }
    return false;
  }
  return { uploadBusy, handleUpload };
}
