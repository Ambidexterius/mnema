import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectEvidence} from './retrieval.ts';
const study=(id:string,count:number)=>({id,title:id,status:'ready',segments:Array.from({length:count},(_,i)=>({id:id+i,text:i===count-1?'Последний фрагмент про цены':'Материал '+i,time:i}))}) as any;
test('project overview samples every eligible material, including late transcript excerpts',()=>{const result=selectEvidence([study('a',100),study('b',4),{...study('pending',2),status:'processing'}],'Какие основные идеи есть в этом проекте?');assert.equal(result.coverage.materials,2);assert.equal(result.coverage.included,2);assert(result.sources.some(s=>s.studyId==='a'&&s.time>80));assert(result.sources.length<=24);assert.equal(result.coverage.sampled,true)});
test('single-material scope never widens for an overview or unknown material',()=>{const docs=[study('a',4),study('b',4)];assert(selectEvidence(docs,'Какие основные идеи?','b').sources.every(s=>s.studyId==='b'));assert.equal(selectEvidence(docs,'Какие основные идеи?','missing').sources.length,0);assert.equal(selectEvidence(docs,'неизвестно').sources.length,0)});
test('ordinary questions retain text matching and corrected text',()=>{const doc=study('a',3);doc.segments[0].correctedText='Аванс';const result=selectEvidence([doc],'Аванс');assert.equal(result.sources.length,1);assert.equal(result.sources[0].text,'Аванс')});
test('a matching moderator question brings the actual participant reply, including speaker continuation',()=>{
 const doc={id:'interview',title:'Interview',status:'ready',segments:[
  {id:'q1',time:0,speaker:'Модератор',text:'Как хозяин отвечает в чате?'},
  {id:'q2',time:10,speaker:'Модератор',text:'Расскажите про последний раз.'},
  {id:'reply',time:20,speaker:'Участник',text:'Ждал полтора часа, затем отменил бронирование.'},
 ]} as any;
 const result=selectEvidence([doc],'Что известно про ответы хозяина?');
 assert(result.sources.some(s=>s.id==='reply'));assert(result.sources.some(s=>s.id==='q1'));assert.equal(result.sources.find(s=>s.id==='reply').text,doc.segments[2].text);
});
test('visible findings guide ranking to original evidence without becoming evidence or widening scope',()=>{
 const doc={id:'source',title:'Interview',status:'ready',segments:[{id:'original',time:0,speaker:'Участник',text:'Ждал полтора часа, затем отменил бронирование.'}]} as any;
 const hint={studyId:'source',segmentId:'original',title:'Хозяин долго отвечает',kind:'Проблема',status:'verified',importance:'Критично'};
 const result=selectEvidence([doc],'Какие проблемы с ответом хозяина?','all',[hint]);assert.equal(result.sources[0].id,'original');assert.equal(result.sources[0].text,doc.segments[0].text);assert(!result.sources.some(s=>s.text===hint.title));
 assert(selectEvidence([doc],'Топ-3 ошибки в сервисе Пример','all',[hint]).sources.some(s=>s.id==='original'));
 assert.equal(selectEvidence([doc],'Какие проблемы с ответом хозяина?','all',[{...hint,status:'rejected'}]).sources.length,0);
 assert.equal(selectEvidence([doc],'Какие проблемы с ответом хозяина?','other',[hint]).sources.length,0);
 const critical={...doc,segments:[{id:'preference',time:0,text:'Я хочу, чтобы она отвечала сразу.'},...Array.from({length:6},(_,i)=>({id:'filler'+i,time:i+1,text:'Дополнительная информация.'})),{id:'event',time:10,text:'Ждал полтора часа и в итоге выбрал отель.'}]} as any;
 const noise=Array.from({length:6},(_,i)=>({id:'noise'+i,title:'Interview',status:'ready',segments:[{id:'q'+i,time:0,speaker:'Модератор',text:'Когда хозяин отвечает?'},{id:'a'+i,time:1,speaker:'Участник',text:'Не знаю.'}]})) as any;
 const contextual=selectEvidence([critical,...noise],'Какие проблемы с ответом хозяина?','all',[{...hint,segmentId:'preference',evidence:['event']}]);assert(contextual.sources.some(s=>s.id==='event'));assert(contextual.sources.length<=12);
});
test('one matching interview cannot consume the entire source budget while another has a relevant reply',()=>{
 const make=(id:string,n:number)=>({id,title:id,status:'ready',segments:Array.from({length:n},(_,i)=>({id:id+i,time:i,speaker:i%2?'Участник':'Модератор',text:i%2?'Ждал полтора часа, потом отменил бронь.':'Когда хозяин отвечает?'}))}) as any;
 const result=selectEvidence([make('a',40),make('b',2)],'Как быстро хозяева отвечают?');assert.deepEqual(new Set(result.sources.map(s=>s.studyId)),new Set(['a','b']));assert(result.sources.some(s=>s.id==='b1'));assert(result.sources.length<=12);assert.equal(result.coverage.sampled,true);
});
