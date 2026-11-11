import test from 'node:test';
import assert from 'node:assert/strict';
import {extractFindings,mergeFindings,newFindings,validFindings} from './finding-extraction.ts';

const seg=(id:string,text:string,time=0)=>({id,time,speaker:'Спикер 1',text});

test('findings: every part of a long material is read, IDs must exist in that part',async()=>{
 const segments=Array.from({length:6},(_,i)=>seg('s'+i,'Фрагмент '+i+' '+'слово '.repeat(900),i*60));
 const seen:string[][]=[];
 const result=await extractFindings(segments,{title:'Интервью',type:'Интервью'},async(payload:any)=>{
  const ids=payload.fragments.map((f:any)=>f.id);seen.push(ids);
  return JSON.stringify({findings:[{title:'Вывод части '+seen.length+' про оплату брони гостем',kind:'Проблема',importance:'Высокая',reason:'Участник не смог оплатить.',segments:[ids[0],'invented-id']},{title:'Без источника',segments:['nope']}]});
 });
 assert(seen.length>1,'a long material is split into parts');
 assert.deepEqual(seen.flat(),segments.map(s=>s.id),'no fragment is skipped');
 assert(result.every(f=>f.segments.every(id=>segments.some(s=>s.id===id))),'only real IDs survive');
 assert(!result.some(f=>f.title==='Без источника'));
 assert.equal(result[0].kind,'Проблема');assert.equal(result[0].reason,'Участник не смог оплатить.');
});

test('findings: unknown type and importance fall back to neutral values, reply without findings fails',async()=>{
 const [f]=validFindings({findings:[{title:'Вывод',kind:'Наблюдение',importance:'Значимо',segments:['a']}]},new Set(['a']));
 assert.equal(f.kind,'Инсайт');assert.equal(f.importance,'Средняя');
 await assert.rejects(extractFindings([seg('a','Текст')],{title:'T'},async()=>JSON.stringify({summary:[]})),/формате/);
 assert.deepEqual(await extractFindings([seg('a','Текст')],{title:'T'},async()=>'{"findings":[]}'),[]);
});

test('findings: near-duplicates from different parts merge into the more important one with both sources',()=>{
 const merged=mergeFindings([
  {title:'Непонятно, почему меняются условия бронирования',description:'',kind:'Проблема',importance:'Средняя',reason:'',segments:['a']},
  {title:'Непонятно, почему владелец изменил условия брони',description:'',kind:'Проблема',importance:'Критично',reason:'Может потерять бронь.',segments:['b']},
  {title:'Первая фотография квартиры решает клик',description:'',kind:'Инсайт',importance:'Высокая',reason:'',segments:['c']},
 ]);
 assert.equal(merged.length,2);assert.equal(merged[0].importance,'Критично');assert.deepEqual(merged[0].segments.sort(),['a','b']);
});

test('findings: what the study already has, including rejected, is not suggested again',()=>{
 const fresh=newFindings([
  {title:'Непонятно, почему меняются условия бронирования',description:'',kind:'Проблема',importance:'Высокая',reason:'',segments:['a']},
  {title:'Таймер предоплаты не заметен в системном сообщении',description:'',kind:'Проблема',importance:'Высокая',reason:'',segments:['b']},
 ],['Непонятно, почему владелец меняет условия бронирования']);
 assert.deepEqual(fresh.map(f=>f.title),['Таймер предоплаты не заметен в системном сообщении']);
});
