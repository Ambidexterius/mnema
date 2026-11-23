import type { IncomingMessage, ServerResponse } from 'node:http';
import { fail, handledJson, isRecord, text } from '../http.ts';
import type { Person, RequestServices } from '../request-context.ts';
import type { ServerExtension } from '../extension.ts';
import {
  processingReadiness,
  type transcribeRecording,
  type detectSpeakers,
} from '../processing.ts';
import type { createProjectStore } from '../projects/store.ts';
import type { createProjectView } from '../projects/view.ts';
import type { StoredStudy } from '../projects/types.ts';

interface ProcessingServices
  extends
    Pick<RequestServices, 'body'>,
    Pick<ReturnType<typeof createProjectStore>, 'getState' | 'mutate'> {
  view: ReturnType<typeof createProjectView>;
  enqueue: (study: StoredStudy, kind: 'asr' | 'document' | 'speakers') => unknown;
  extension?: Pick<ServerExtension, 'beforeProcess'>;
  recordingProcessor?: typeof transcribeRecording;
  speakerProcessor?: typeof detectSpeakers;
}

const speakerCountPath = /^\/api\/studies\/[^/]+\/speaker-count$/;
const speakersPath = /^\/api\/studies\/[^/]+\/speakers$/;
const processPath = /^\/api\/studies\/[^/]+\/process$/;

export function isProcessingPath(path: string) {
  return speakerCountPath.test(path) || speakersPath.test(path) || processPath.test(path);
}

export async function handleProcessing(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  person: Person,
  {
    body,
    getState,
    mutate,
    view,
    enqueue,
    extension,
    recordingProcessor,
    speakerProcessor,
  }: ProcessingServices,
) {
  if (speakerCountPath.test(path) && req.method === 'PATCH') {
    if (person.role !== 'full') fail(403, 'Изменять число участников можно с полным доступом.');
    const b: unknown = await body(req),
      id = path.split('/')[3];
    const study = getState().state.studies.find((s) => s.id === id);
    if (!study) fail(404, 'Материал не найден.');
    if (study.format !== 'Видео') fail(400, 'Число участников можно указать для записи.');
    if (!isRecord(b)) fail(400, 'Введите целое число больше нуля.');
    const count = b.count;
    if (count !== null && (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1))
      fail(400, 'Введите целое число больше нуля.');
    if (b.before !== undefined && b.before !== (study.participants || 0))
      fail(409, 'Число участников изменилось. Откройте поле ещё раз.');
    mutate((s) => {
      const target = s.studies.find((x) => x.id === id);
      if (!target) fail(404, 'Материал не найден.');
      target.participants = typeof count === 'number' ? count : 0;
    });
    return handledJson(res, 200, view(person));
  }
  if (speakersPath.test(path) && (req.method === 'POST' || req.method === 'PATCH')) {
    if (person.role !== 'full') fail(403, 'Менять спикеров может участник с полным доступом.');
    const b: unknown = await body(req),
      study = getState().state.studies.find((s) => s.id === path.split('/')[3]);
    if (!study) fail(404, 'Материал не найден.');
    if (study.format !== 'Видео') fail(400, 'Спикеры есть только у записей.');
    if (req.method === 'POST') {
      if (study.status !== 'ready' || !study.segments?.length)
        fail(409, 'Сначала дождитесь расшифровки.');
      if (!speakerProcessor && !processingReadiness().diarization)
        fail(503, 'Определение спикеров не установлено на этом сервере.');
      if (study.speakerInfo?.state === 'queued' || study.speakerInfo?.state === 'running')
        return handledJson(res, 202, view(person));
      enqueue(study, 'speakers');
      return handledJson(res, 202, view(person));
    }
    if (study.speakerInfo?.state === 'queued' || study.speakerInfo?.state === 'running')
      fail(409, 'Дождитесь завершения определения спикеров.');
    if (!isRecord(b)) fail(400, 'Укажите фрагменты или спикера.');
    const name = text(b.speaker, 60);
    if (!name) fail(400, 'Введите имя спикера до 60 символов.');
    if (['Запись', 'Документ'].includes(name) || name.startsWith('Страница '))
      fail(400, 'Это имя зарезервировано. Выберите другое.');
    const ids = Array.isArray(b.segmentIds)
      ? new Set(b.segmentIds.filter((x: unknown): x is string => typeof x === 'string'))
      : null;
    const from = typeof b.from === 'string' ? b.from : null;
    if (!ids?.size && !from) fail(400, 'Укажите фрагменты или спикера.');
    const targets = (study.segments || []).filter((seg) =>
      ids?.size ? ids.has(seg.id) : seg.speaker === from,
    );
    if (!targets.length) fail(404, 'Фрагменты не найдены. Обновите страницу.');
    mutate((s) => {
      const item = s.studies.find((x) => x.id === study.id);
      if (!item) fail(404, 'Материал не найден.');
      const set = new Set(targets.map((x) => x.id));
      for (const seg of item.segments) if (set.has(seg.id)) seg.speaker = name;
      item.speakerEdits = [
        ...(item.speakerEdits || []),
        {
          action: ids?.size ? ('reassigned' as const) : ('renamed' as const),
          from: from || targets[0].speaker,
          to: name,
          changed: set.size,
          by: person.name,
          at: Date.now(),
        },
      ].slice(-500);
    });
    return handledJson(res, 200, view(person));
  }
  if (processPath.test(path) && req.method === 'POST') {
    if (person.role !== 'full') fail(403, 'Обработка недоступна.');
    await body(req);
    const study = getState().state.studies.find((s) => s.id === path.split('/')[3]);
    if (!study) fail(404, 'Материал не найден.');
    extension?.beforeProcess(study);
    if (study.format === 'Видео' && !recordingProcessor && !processingReadiness().asr)
      fail(503, 'Локальная модель речи ещё не установлена.');
    if (study.summaryInfo?.state === 'queued' || study.summaryInfo?.state === 'running')
      fail(409, 'Дождитесь завершения сводки перед повторным распознаванием.');
    enqueue(study, study.format === 'Видео' ? 'asr' : 'document');
    return handledJson(res, 202, view(person));
  }
  return false;
}
