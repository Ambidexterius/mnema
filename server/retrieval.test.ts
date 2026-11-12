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

test('all linked originals precede noisy interview windows, including distant secondary evidence',()=>{
 const make=(id:string,segments:any[])=>({id,title:'Исследование чатов',status:'ready',segments:segments.map((segment,i)=>({id:id+i,time:i,speaker:'Участник',...segment}))}) as any;
 const preference=make('preference',[{text:'Ожидаю, что хозяин ответит в чате сразу.'},{text:'Обычно отвечают сразу.'}]);
 const critical=make('critical',Array.from({length:32},(_,i)=>({text:i===28?'Ждала два часа. Затем выбрала гостиницу, потому что подтверждения не было.':'Хозяин ответил в чате сразу, ответ хозяина был быстрым.'})));
 const hints=[
  {studyId:preference.id,segmentId:'preference0',title:'Участник ожидает мгновенного ответа хозяина в чате',status:'verified',importance:'Высокая',kind:'Инсайт'},
  {studyId:critical.id,segmentId:'critical0',evidence:['critical4','critical8','critical16','critical28'],title:'Хозяйка долго подтверждала бронь',status:'verified',importance:'Критично',kind:'Проблема'},
 ];
 const noise=Array.from({length:5},(_,i)=>make('noise'+i,[{speaker:'Модератор',text:'Какие проблемы с ответом хозяина в чате?'},{text:'Обычно всё хорошо.'}]));
 const question='Какие проблемы с ответом хозяина есть в исследовании чатов? Сформулируй коротко и конкретно.';
 const result=selectEvidence([preference,critical,...noise],question,'all',hints);
 for(const id of ['preference0','critical0','critical4','critical8','critical16','critical28'])assert(result.sources.some(source=>source.id===id),id+' must retain its original evidence');
 assert.equal(result.sources.find(source=>source.id==='critical28').text,critical.segments[28].text);
 assert.equal(result.coverage.linkedFragments,6);assert.equal(result.coverage.includedLinkedFragments,6);
 assert(result.sources.length<=12);assert(result.sources.some(source=>source.studyId.startsWith('noise')));
 // Reproduce the old failure without any boost for the fifth linked excerpt.
 assert(!selectEvidence([preference,critical,...noise],question,'all',hints.map(hint=>({...hint,evidence:hint.evidence?.slice(0,3)}))).sources.some(source=>source.id==='critical28'));
});

test('a larger linked set uses a bounded budget and reports dropped evidence honestly',()=>{
 const docs=Array.from({length:4},(_,i)=>study('linked'+i,20));
 const hints=docs.map(doc=>({studyId:doc.id,segmentId:doc.id+'0',evidence:Array.from({length:8},(_,i)=>doc.id+(i+1)),title:'Подтверждение бронирования задерживается',status:'verified',importance:'Критично',kind:'Проблема'}));
 const result=selectEvidence(docs,'Почему подтверждение бронирования задерживается?','all',hints);
 assert.equal(result.sources.length,24);assert.equal(result.coverage.linkedFragments,36);assert.equal(result.coverage.includedLinkedFragments,24);
 assert.equal(result.coverage.included,4);assert.equal(result.coverage.sampled,true);
 const smaller=selectEvidence(docs.slice(0,2),'Почему подтверждение бронирования задерживается?','all',hints);
 assert.equal(smaller.coverage.linkedFragments,18);assert.equal(smaller.coverage.includedLinkedFragments,18);assert(smaller.sources.length<=24);
});

test('linked evidence reservation cannot cross material scope or revive rejected, imported or inaccessible findings',()=>{
 const docs=[study('allowed',3),study('other',3),{...study('pending',3),status:'processing'}];
 const hint={studyId:'allowed',segmentId:'allowed0',evidence:['allowed1'],title:'Возврат депозита задерживается',status:'verified',importance:'Критично'};
 const hints=[hint,{...hint,studyId:'other',segmentId:'other0',evidence:['other1']},{...hint,studyId:'pending',segmentId:'pending0',evidence:['pending1']},{...hint,studyId:'missing',segmentId:'missing0'}];
 const result=selectEvidence(docs,'Возврат депозита','allowed',hints);
 assert.deepEqual(new Set(result.sources.map(source=>source.studyId)),new Set(['allowed']));assert.equal(result.coverage.linkedFragments,2);
 for(const blocked of [{status:'rejected'},{origin:'import'}])assert.equal(selectEvidence(docs,'Возврат депозита','allowed',[{...hint,...blocked}]).sources.length,0);
 const forged=selectEvidence(docs,'Возврат депозита','allowed',[{...hint,evidence:['other1']}]);
 assert(forged.sources.every(source=>source.studyId==='allowed'));assert.equal(forged.coverage.linkedFragments,1);
});

test('many matched findings in one interview cannot crowd out another interview evidence',()=>{
 const docs=[study('large',50),study('small',3)];
 const hints=Array.from({length:30},(_,i)=>({studyId:'large',segmentId:'large'+i,title:'Задержка возврата депозита',status:'verified',importance:'Высокая'}));
 hints.push({studyId:'small',segmentId:'small2',title:'Задержка возврата депозита',status:'verified',importance:'Высокая'});
 const result=selectEvidence(docs,'Возврат депозита','all',hints);
 assert(result.sources.some(source=>source.studyId==='small'&&source.id==='small2'));assert.equal(result.sources.length,24);
});


test('competing same-study finding primaries cannot displace the fifth quote of the top verified critical finding',()=>{
 const large=study('large',40),small=study('small',1);
 large.segments[39].text='После долгого ожидания подтверждения выбрал гостиницу.';
 const hints=[{studyId:'large',segmentId:'large0',evidence:['large1','large2','large3','large39','large5'],title:'Хозяин долго отвечает',status:'verified',importance:'Критично'},...Array.from({length:20},(_,i)=>({studyId:'large',segmentId:'large'+(10+i),title:'Хозяин отвечает',status:'verified',importance:'Высокая'})),{studyId:'small',segmentId:'small0',title:'Хозяин отвечает',status:'verified',importance:'Высокая'}];
 const result=selectEvidence([large,small],'Что известно про ответы хозяина?','all',hints);
 for(const id of ['large0','large1','large2','large3','large39','large5'])assert(result.sources.some(source=>source.id===id),id+' must retain its original evidence');
 assert(result.sources.some(source=>source.studyId==='small'));assert.equal(result.sources.length,24);assert.equal(result.coverage.linkedFragments,27);assert.equal(result.coverage.includedLinkedFragments,24);
 const scoped=selectEvidence([large,small],'Что известно про ответы хозяина?','small',hints);
 assert.deepEqual(scoped.sources.map(source=>source.id),['small0']);assert.equal(scoped.coverage.linkedFragments,1);
});
