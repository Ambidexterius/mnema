import {test} from 'node:test';
import assert from 'node:assert/strict';
import {materialActivity} from '../app/material-activity.ts';
test('public activity distinguishes source processing from queued, running, failed and completed analysis',()=>{
 const s:any={format:'Word',status:'ready',summary:[]};
 assert.equal(materialActivity(s).label,'Текст готов');
 s.summaryInfo={state:'queued',progress:'В очереди'};assert.equal(materialActivity(s).state,'queued');
 s.summaryInfo={state:'running',progress:'Часть 3 из 5',requestedBy:'private-id',modelId:'private-model'};
 assert.deepEqual(materialActivity(s),{state:'running',label:'Анализируем материал',detail:'Часть 3 из 5'});
 s.summaryInfo.state='error';assert.equal(materialActivity(s).label,'Ошибка анализа');
 s.summaryInfo.state='ready';assert.equal(materialActivity(s).label,'Анализ завершён');
 s.status='processing';assert.equal(materialActivity(s).label,'Извлекаем текст');
 s.format='Видео';assert.equal(materialActivity(s).label,'Распознаём запись');
 s.status='error';assert.equal(materialActivity(s).label,'Ошибка обработки');
});
