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

import {dedupeWithModel,planDedupe,validGroups} from './finding-extraction.ts';
const cand=(title:string,importance='Средняя',segments=['x'])=>({title,description:'',kind:'Проблема' as const,importance:importance as any,reason:'',segments});
const known=(id:string,title:string,status='draft',origin='ai',importance='Средняя')=>({id,title,kind:'Проблема',importance,status,origin,segmentId:'seg-'+id});

test('dedupe: groups are validated and overlapping groups merge into one',()=>{
 assert.deepEqual(validGroups({groups:[[1,2],[2,3],[4],[5,99,6],['7','8']]},8),[[0,1,2],[4,5],[6,7]]);
 assert.deepEqual(validGroups({groups:[[1,4],[2,4]]},5),[[0,1,3]],'two old drafts tied to one new candidate become one group');
 assert.deepEqual(validGroups({groups:[Array.from({length:13},(_,i)=>i+1)]},20),[],'oversized groups are not trusted');
 assert.deepEqual(validGroups({summary:[]},3),[]);
});

test('dedupe: the more important member stays and takes the others\' quotes; other AI drafts are removed',()=>{
 const plan=planDedupe(
  [cand('Бронь сорвалась из-за долгого ожидания','Критично',['b1']),cand('Нет станции на карте метро','Высокая',['c1'])],
  [known('d1','Хозяйка подтверждала бронь 1 ч 35 мин','draft','ai','Высокая')],
  [[0,1]],'model');
 assert.equal(plan.add.length,2);assert.deepEqual(plan.add[0].segments,['b1','seg-d1']);assert.deepEqual(plan.remove,['d1']);assert.equal(plan.merged,1);assert.deepEqual(plan.update,[]);
 const keepOld=planDedupe([cand('Хочет редактировать сообщения','Средняя',['n1'])],[known('d2','Нельзя редактировать сообщения','draft','ai','Высокая')],[[0,1]],'model');
 assert.deepEqual(keepOld.add,[]);assert.deepEqual(keepOld.update,[{id:'d2',evidence:['n1']}]);assert.deepEqual(keepOld.remove,[]);
});

test('dedupe: a person\'s decision wins — repeats of accepted, rejected or hand-written findings are dropped, drafts stay',()=>{
 for(const [status,origin] of [['verified','ai'],['rejected','ai'],['verified','human']]){
  const plan=planDedupe([cand('То же другими словами')],[known('h','Исходная находка',status,origin),known('d','Черновик')],[[0,1,2]],'model');
  assert.deepEqual(plan.add,[]);assert.deepEqual(plan.remove,[]);assert.deepEqual(plan.update,[]);assert.equal(plan.merged,1);
 }
});

test('dedupe: model failure or a broken reply falls back to word matching',async()=>{
 const reasons:string[]=[];const candidates=[cand('Непонятно, почему меняются условия бронирования'),cand('Таймер предоплаты не заметен в сообщении')];const existing=[known('a','Непонятно, почему владелец меняет условия бронирования')];
 const broken=await dedupeWithModel(candidates,existing,async()=>'не JSON',r=>reasons.push(r));
 assert.equal(broken.method,'words');assert.deepEqual(broken.add.map(f=>f.title),['Таймер предоплаты не заметен в сообщении']);
 const offline=await dedupeWithModel(candidates,existing,async()=>{throw Object.assign(new Error('down'),{status:503})},r=>reasons.push(r));
 assert.equal(offline.method,'words');assert.equal(reasons.length,2);
 const model=await dedupeWithModel(candidates,existing,async(payload:any)=>{assert.equal(payload.findings.length,3);return JSON.stringify({groups:[[1,2]]})});
 assert.equal(model.method,'model');assert.deepEqual(model.add.map(f=>f.title),['Таймер предоплаты не заметен в сообщении']);assert.equal(model.merged,1);
 assert.deepEqual((await dedupeWithModel([cand('Непонятно, почему владелец меняет условия бронирования')],existing,async()=>{throw new Error('not called')})).add,[],'exact repeats need no model call');
});
