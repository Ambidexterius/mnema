import type { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { openDatabase } from '../db.ts';
import type { createCompletionMailer } from '../completion-mail.ts';
import { fail, text } from '../http.ts';
import type { createFileProcessor } from './processor.ts';
import type { createProjectStore } from '../projects/store.ts';
import type { StoredStudy } from '../projects/types.ts';

type FileJobKind = Parameters<ReturnType<typeof createFileProcessor>['processStudy']>[1];
type FileJob = { id: string; study_id: string; workspace_id?: string; kind: FileJobKind };

interface QueueServices extends Pick<ReturnType<typeof createProjectStore>, 'getState' | 'mutate'> {
  q: ReturnType<typeof openDatabase>['q'];
  dir: string;
  currentWs: () => string;
  wsStore: Pick<AsyncLocalStorage<string>, 'run'>;
  deletingStudies: ReadonlySet<string>;
  runAnalysis: () => Promise<void>;
  processStudy: ReturnType<typeof createFileProcessor>['processStudy'];
  completionMail: Pick<ReturnType<typeof createCompletionMailer>, 'queue'>;
}

export const jobKey = (workspaceId: string, studyId: string) => workspaceId + '\0' + studyId;

export function createProcessingQueue({
  q,
  dir,
  currentWs,
  getState,
  mutate,
  wsStore,
  deletingStudies,
  runAnalysis,
  processStudy,
  completionMail,
}: QueueServices) {
  let workerBusy = false;
  const activeCPU = new Map<string, { controller: AbortController; done: Promise<void> }>();
  const processingLog = (event: string, job: FileJob, extra = {}) =>
    console.info(
      'Processing',
      JSON.stringify({
        event,
        jobId: job.id,
        studyId: job.study_id,
        workspaceId: job.workspace_id,
        kind: job.kind,
        ...extra,
      }),
    );
  const work = async (lane: 'files' | 'analysis') => {
    if (lane === 'analysis') return runAnalysis();
    if (workerBusy) return;
    const job = q<FileJob>(
      "SELECT * FROM mnema_jobs WHERE status='queued' ORDER BY CASE WHEN kind='document' THEN 0 ELSE 1 END,created LIMIT 1",
    ).get();
    if (!job) return;
    const activeKey = jobKey(job.workspace_id || 'main', job.study_id);
    if (deletingStudies.has(activeKey)) return;
    workerBusy = true;
    const controller = new AbortController();
    let finishJob!: () => void;
    const done = new Promise<void>((resolve) => {
      finishJob = resolve;
    });
    activeCPU.set(activeKey, { controller, done });
    try {
      await wsStore.run(job.workspace_id || 'main', async () => {
        q("UPDATE mnema_jobs SET status='running' WHERE id=?").run(job.id);
        const started = Date.now();
        processingLog('started', job);
        const heartbeat = setInterval(() => {
          const item = getState().state.studies.find((s) => s.id === job.study_id);
          processingLog('heartbeat', job, {
            elapsedSeconds: Math.floor((Date.now() - started) / 1000),
            progressAgeSeconds: item?.processingUpdatedAt
              ? Math.floor((Date.now() - item.processingUpdatedAt) / 1000)
              : null,
            progress: item?.progress || null,
          });
        }, 30000);
        heartbeat.unref();
        try {
          const study = getState().state.studies.find((x) => x.id === job.study_id);
          if (!study) throw new Error('Материал удалён.');
          if (job.kind !== 'speakers')
            mutate((s) => {
              const item = s.studies.find((x) => x.id === job.study_id);
              if (item)
                Object.assign(item, {
                  processingStartedAt: started,
                  processingUpdatedAt: started,
                  progress: 'Начинаем обработку',
                });
            });
          await processStudy(study, job.kind, join(dir, 'processing', job.id), controller.signal);
          controller.signal.throwIfAborted();
          if (job.kind === 'asr')
            completionMail.queue(
              job.id,
              currentWs(),
              study.id,
              study.uploadedById ||
                q('SELECT user_id FROM mnema_upload_sessions WHERE id=?').get(study.fileId)
                  ?.user_id ||
                '',
            );
          q("UPDATE mnema_jobs SET status='done',error=NULL WHERE id=?").run(job.id);
          processingLog('completed', job, {
            elapsedSeconds: Math.floor((Date.now() - started) / 1000),
          });
        } catch (e) {
          if (controller.signal.aborted) {
            q("UPDATE mnema_jobs SET status='cancelled',error=NULL WHERE id=?").run(job.id);
            processingLog('cancelled', job, {
              elapsedSeconds: Math.floor((Date.now() - started) / 1000),
            });
            mutate((s) => {
              const item = s.studies.find((x) => x.id === job.study_id);
              if (item)
                Object.assign(item, {
                  status: 'error',
                  progress: null,
                  error: 'Обработка остановлена.',
                });
            });
            return;
          }
          processingLog('failed', job, {
            errorType: e.name,
            errorCode: e.code || null,
            signal: e.signal || null,
            killed: Boolean(e.killed),
            elapsedSeconds: Math.floor((Date.now() - started) / 1000),
          });
          const message = text(e.message, 500);
          q("UPDATE mnema_jobs SET status='error',error=? WHERE id=?").run(message, job.id);
          mutate((s) => {
            const item = s.studies.find((x) => x.id === job.study_id);
            if (item) Object.assign(item, { status: 'error', error: message });
          });
        } finally {
          clearInterval(heartbeat);
          await rm(join(dir, 'processing', job.id), { recursive: true, force: true });
        }
      });
    } finally {
      activeCPU.delete(activeKey);
      workerBusy = false;
      finishJob();
    }
  };
  const worker = setInterval(() => {
    for (const lane of ['files', 'analysis'] as const)
      work(lane).catch((error) =>
        console.error('Worker failed', lane, error.name, error.code || ''),
      );
  }, 1000);
  worker.unref();
  const activeStudyJob = (studyId: string) =>
    q(
      "SELECT 1 FROM mnema_jobs WHERE study_id=? AND workspace_id=? AND status IN ('queued','running')",
    ).get(studyId, currentWs());
  const queueStudy = (study: StoredStudy, kind: FileJobKind) => {
    if (deletingStudies.has(jobKey(currentWs(), study.id)))
      fail(409, 'Материал удаляется. Дождитесь завершения.');
    if (activeStudyJob(study.id)) fail(409, 'Этот материал уже обрабатывается.');
    const now = Date.now();
    q(
      'INSERT INTO mnema_jobs(id,study_id,status,kind,created,workspace_id) VALUES(?,?,?,?,?,?)',
    ).run(randomUUID(), study.id, 'queued', kind, now, currentWs());
    if (kind === 'speakers') study.speakerInfo = { state: 'queued', startedAt: now };
    else
      Object.assign(study, {
        status: 'processing',
        step: 1,
        processingStartedAt: undefined,
        processingUpdatedAt: now,
        progress: 'В очереди на обработку',
        error: null,
      });
  };
  const enqueue = (study: StoredStudy, kind: FileJobKind) =>
    mutate((s) => {
      const target = s.studies.find((x) => x.id === study.id);
      if (!target) fail(404, 'Материал не найден.');
      queueStudy(target, kind);
    });
  return {
    stopWorker: () => clearInterval(worker),
    activeCPU,
    activeStudyJob,
    enqueue,
    queueStudy,
  };
}
