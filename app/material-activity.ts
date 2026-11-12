import type {Study,MaterialActivity} from './types.ts';

// Only public progress belongs here. Model configuration and draft contents stay private.
export function materialActivity(s:Study):MaterialActivity {
 if(s.status==='processing'&&s.processingState==='queued')return {state:'queued',label:'В очереди на обработку',detail:'Файл сохранён. Обработка начнётся после предыдущих файлов.'};
 if(s.status==='processing'&&s.progress?.startsWith('Определяем спикеров'))return {state:'running',label:'Определяем спикеров',detail:s.progress};
 if(s.status==='processing')return {state:'running',label:s.format==='Видео'?'Распознаём запись':'Извлекаем текст',detail:s.progress||'Файл обрабатывается на сервере.'};
 if(s.status==='error')return {state:'error',label:'Ошибка обработки',detail:'Материал сохранён. Откройте его, чтобы повторить обработку.'};
 if(['queued','running'].includes(s.summaryInfo?.state))return {state:s.summaryInfo.state as 'queued'|'running',label:s.summaryInfo.state==='queued'?'В очереди на анализ':'Анализируем материал',detail:s.summaryInfo.progress||'Создаём сводку. Текст материала уже можно читать.'};
 if(['queued','running'].includes(s.speakerInfo?.state))return {state:s.speakerInfo.state as 'queued'|'running',label:'Определяем спикеров',detail:s.speakerInfo.progress||'Расшифровку уже можно читать.'};
 if(s.summaryInfo?.state==='error')return {state:'error',label:'Ошибка анализа',detail:'Текст сохранён. Попробуйте создать сводку ещё раз.'};
 if(s.status==='ready')return {state:'ready',label:s.summaryInfo?.state==='ready'?'Анализ завершён':'Текст готов'};
 return {state:s.status==='cancelled'?'cancelled':'uploaded',label:s.status==='cancelled'?'Отменено':'Загружено'};
}
