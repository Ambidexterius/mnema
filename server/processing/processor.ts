import { join } from 'node:path';
import type { Study } from '../../app/types.ts';
import type { openDatabase } from '../db.ts';
import type { ServerExtension } from '../extension.ts';
import { extractDocument, transcribeRecording, detectSpeakers } from '../processing.ts';
import { transcriptRevision } from '../summaries.ts';
import type { createProjectStore } from '../projects/store.ts';
import type { StoredStudy } from '../projects/types.ts';

interface ProcessorServices extends Pick<ReturnType<typeof createProjectStore>, 'mutate'> {
  q: ReturnType<typeof openDatabase>['q'];
  dir: string;
  currentWs: () => string;
  jobKey: (workspace: string, study: string) => string;
  recordingProcessor?: typeof transcribeRecording;
  speakerProcessor?: typeof detectSpeakers;
  extension: () => Pick<ServerExtension, 'wordTimes'> | undefined;
}

export function createFileProcessor({
  q,
  dir,
  currentWs,
  jobKey,
  mutate,
  recordingProcessor,
  speakerProcessor,
  extension,
}: ProcessorServices) {
  const transcriptPreviews = new Map<string, NonNullable<Study['transcriptPreview']>>();
  const processSpeakers = async (
    study: StoredStudy,
    fileId: string | undefined,
    signal: AbortSignal,
  ) => {
    const setInfo = (info: Partial<NonNullable<Study['speakerInfo']>>) => {
      if (signal.aborted) return;
      mutate((s) => {
        const item = s.studies.find((x) => x.id === study.id);
        const status = info.state ?? item?.speakerInfo?.state;
        if (item && status) item.speakerInfo = { ...item.speakerInfo, ...info, state: status };
      });
    };
    setInfo({ state: 'running', progress: 'Подготовка аудио' });
    try {
      if (!fileId) throw new Error('Исходник не найден.');
      const result = await (speakerProcessor || detectSpeakers)({
        filePath: join(dir, 'uploads', fileId),
        segments: study.segments || [],
        participants: study.participants,
        signal,
        onProgress: (progress) => setInfo({ progress }),
      });
      signal.throwIfAborted();
      mutate((s) => {
        const item = s.studies.find((x) => x.id === study.id);
        if (!item) return;
        const before = new Map((item.segments || []).map((x) => [x.id, x.speaker]));
        for (const seg of item.segments || []) seg.speaker = result.speakers[seg.id] || 'Запись';
        item.speakerInfo = {
          state: 'ready',
          count: result.count,
          engine: result.engine,
          finishedAt: Date.now(),
        };
        item.speakerEdits = [
          ...(item.speakerEdits || []),
          {
            action: 'detected' as const,
            count: result.count,
            changed: (item.segments || []).filter((x) => before.get(x.id) !== x.speaker).length,
            by: 'Мнемодак',
            at: Date.now(),
          },
        ].slice(-500);
      });
    } catch (e) {
      signal.throwIfAborted();
      console.error('Speakers failed', e.name);
      setInfo({
        state: 'error',
        progress: null,
        error: 'Не удалось различить голоса. Расшифровка сохранена, попробуйте ещё раз.',
      });
    }
  };
  const processStudy = async (
    study: StoredStudy,
    kind: 'asr' | 'document' | 'speakers',
    checkpointDir: string,
    signal: AbortSignal,
  ) => {
    signal.throwIfAborted();
    const record = study.fileId
      ? q<{ id: string; name: string }>('SELECT id,name FROM mnema_uploads WHERE id=?').get(
          study.fileId,
        )
      : undefined;
    if (kind === 'speakers') return processSpeakers(study, record?.id, signal);
    if (!record) throw new Error('Исходник не найден. Добавьте файл заново.');
    const started = Date.now();
    const args = {
      filePath: join(dir, 'uploads', record.id),
      fileName: record.name,
      fileId: record.id,
      checkpointDir,
      participants: study.participants,
      wordTimes: extension()?.wordTimes,
      signal,
      onProgress: (progress: string) => {
        if (signal.aborted) return;
        mutate((s) => {
          const item = s.studies.find((x) => x.id === study.id);
          if (item) {
            item.progress = progress;
            item.processingUpdatedAt = Date.now();
          }
        });
      },
    };
    const key = jobKey(currentWs(), study.id);
    let result;
    try {
      result =
        kind === 'document'
          ? await extractDocument(args)
          : await (recordingProcessor || transcribeRecording)({
              ...args,
              onTranscript: (segments) => {
                if (!signal.aborted) transcriptPreviews.set(key, segments);
              },
            });
    } finally {
      transcriptPreviews.delete(key);
    }
    signal.throwIfAborted();
    mutate((s) => {
      const item = s.studies.find((x) => x.id === study.id);
      if (item)
        Object.assign(item, {
          status: 'ready',
          step: 4,
          segments: result.segments,
          summary: [],
          summaryInfo: undefined,
          speakerInfo:
            kind === 'document'
              ? undefined
              : result.diarization
                ? {
                    state: 'ready',
                    count: result.speakers,
                    engine: 'pyannote-segmentation-3.0 + WeSpeaker ResNet34',
                    finishedAt: Date.now(),
                  }
                : result.diarizationError
                  ? {
                      state: 'error',
                      error:
                        'Не удалось различить голоса. Расшифровка сохранена, попробуйте ещё раз.',
                    }
                  : undefined,
          error: null,
          progress: null,
          duration: result.duration || 0,
          processing: {
            ...result,
            segments: undefined,
            processingSeconds: (Date.now() - started) / 1000,
          },
        });
      if (item?.autoSummary) {
        const request = item.autoSummary;
        item.summaryInfo = {
          state: 'queued',
          review: 'draft',
          revision: transcriptRevision(item.segments),
          modelId: request.modelId,
          requestedBy: request.requestedBy,
          autoFindings: true,
          startedAt: Date.now(),
          progress: 'В очереди',
        };
        delete item.autoSummary;
      }
    });
  };
  return { processStudy, transcriptPreviews };
}
