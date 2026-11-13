import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectEvidence} from './retrieval.ts';
import {collectGlobalResearch,globalEvidence} from './global-research.ts';
import {mentionedProducts} from './product-scope.ts';

const report=(id:string)=>({id,title:'Отчёт '+id,type:'Отчёт',format:'PDF',status:'ready',segments:[{id:'intro',text:'Цели исследования и список респондентов.',time:0,page:1},...['Непонятно, когда оплачивать бронь.','Не приходят уведомления о сообщениях.','Нельзя изменить даты бронирования.','Не загружаются фотографии жилья.','Сложно найти жильё на карте.','Неудобно искать контакты хозяина.'].map((text,i)=>({id:'problem'+i,text,time:0,page:i+2}))]}) as any;

test('a broad product question includes report evidence and every available project despite many brand-matching interviews',()=>{
 const projects=Array.from({length:5},(_,i)=>({id:'p'+i,name:'Проект '+i,role:'full' as const,admin:true}));
 const research=collectGlobalResearch({workspaceId:'p0',workspaces:projects},project=>{
  const interviews=project.id==='p0'?Array.from({length:30},(_,i)=>({id:'interview'+i,title:'Интервью '+i,status:'ready',segments:[{id:'quote',time:0,text:'Респондент знает о Суточно и пользуется сервисом.'}]})):[];
  return{models:[],studies:[...interviews,report(project.id)],findings:interviews.map(s=>({studyId:s.id,segmentId:'quote',title:'Суточно помогает респонденту',kind:'Инсайт',status:'verified'}))};
 });
 for(const question of ['Какие есть проблемы в суточно?','Какие основные проблемы в Суточно.ру?','Дай обзор проблем по всем исследованиям']){
  const result=globalEvidence(research,question);assert.equal(result.coverage.strategy,'diverse-overview-v2');assert.equal(result.coverage.projects,5);assert(result.sources.some(s=>s.workspaceId==='p0'&&s.studyType==='Отчёт'));
  assert(result.sources.some(s=>s.id==='problem0'));assert(result.sources.some(s=>s.id==='problem1'));assert(result.sources.length<=48);assert(result.coverage.characters<=36000);assert(result.sources.filter(s=>s.studyType==='Отчёт').every(s=>s.basis==='report'));
  for(const source of result.sources){const material=research.studies.find(s=>s.actualStudyId===source.studyId&&s.workspaceId===source.workspaceId);assert.equal(source.text,material.segments.find(s=>s.id===source.segmentId).text)}
 }
 const specific=globalEvidence(research,'Когда оплачивать бронь?');assert.equal(specific.coverage.strategy,undefined);assert(specific.sources.every(s=>/брон|оплач/i.test(s.text)));
});

test('duplicate formats share an overview budget without losing distinct original excerpts or crossing project scope',()=>{
 const copies=Array.from({length:30},(_,i)=>({...report('copy'+i),title:'Интервью 01 — Ольга'+(i?' (1)':''),type:'Интервью',segments:[{id:'same',time:0,text:'Мне непонятно, когда оплатить бронь, поэтому приходится уточнять условия у хозяина.'}]}));
 const other={...report('other'),title:'Другое исследование'};
 const result=selectEvidence([...copies,other],'Какие есть проблемы в суточно?');
 assert.equal(result.sources.filter(s=>s.id==='same').length,1);assert(result.sources.some(s=>s.studyId==='other'));assert.equal(result.coverage.repeatedMaterials,29);
 const scoped=selectEvidence([...copies,other,{...report('pending'),status:'processing'}],'Какие есть проблемы в суточно?','other');assert(scoped.sources.every(s=>s.studyId==='other'));
});

test('overview byte budget never truncates or fabricates a source and reviewed titles remain bound to selected originals',()=>{
 const studies=Array.from({length:50},(_,i)=>({...report('study'+i),segments:[{id:'quote',time:0,text:('Непонятно, как изменить бронирование. Условия отмены не видны. '+i+' ').repeat(40)}]}));
 const hints=studies.map(s=>({studyId:s.id,segmentId:'quote',evidence:['private'],kind:'Проблема',status:'verified',title:'Непонятны условия бронирования '+s.id}));
 const result=selectEvidence(studies,'Какие есть проблемы в суточно?','all',[...hints,{...hints[0],status:'draft',title:'PRIVATE_DRAFT'},{...hints[0],status:'rejected',title:'PRIVATE_REJECTED'}]);
 assert(result.sources.length<48);assert(result.coverage.characters<=36000);assert.equal(result.sources.reduce((n,s)=>n+s.text.length,0),result.coverage.characters);
 for(const source of result.sources)assert.equal(source.text,studies.find(s=>s.id===source.studyId).segments[0].text);
 assert(result.reviewedFindings.length>0);assert(!JSON.stringify(result.reviewedFindings).includes('PRIVATE_'));for(const finding of result.reviewedFindings)assert(finding.sourceNumbers.every(n=>result.sources[n-1]));
});
test('explicit foreign-service context follows linked originals; comparisons remain available when both products are named',()=>{
 assert.deepEqual(mentionedProducts('посуточно снимают жильё'),[]);assert.deepEqual(mentionedProducts('Суточно.ру'),['sutochno']);
 const doc={...report('mixed'),segments:[{id:'foreign',time:0,text:'Синтетика: в Озоне произошёл сбой оплаты.'},{id:'continuation',time:1,text:'Синтетика: деньги вернули позже, пришлось уточнять.'},{id:'own',time:2,text:'Синтетика: в Суточно не приходят уведомления.'},{id:'comparison',time:3,text:'Синтетика: в Суточно карта загружается дольше, чем в Озоне.'}]};
 const hints=[{studyId:doc.id,segmentId:'foreign',evidence:['continuation'],title:'Сервис возвращает деньги с задержкой',kind:'Проблема',status:'verified'}];
 const own=selectEvidence([doc],'Какие проблемы в Суточно?','all',hints);assert(!own.sources.some(s=>['foreign','continuation'].includes(s.id)));assert(own.sources.some(s=>s.id==='own'));assert(own.sources.some(s=>s.id==='comparison'));assert(!own.reviewedFindings.some(h=>h.title===hints[0].title));
 const all=selectEvidence([doc],'Какие есть проблемы?','all',hints);assert(all.sources.some(s=>s.id==='foreign'));assert(all.sources.some(s=>s.id==='continuation'));
});
test('top questions about payment, maps and messages remain focused rather than becoming whole-product overviews',()=>{
 const docs=[{id:'pay',title:'Оплата',status:'ready',segments:[{id:'p',time:0,text:'Не могу оплатить бронь.'}]},{id:'map',title:'Карта',status:'ready',segments:[{id:'m',time:0,text:'Карта не загружается.'}]},{id:'chat',title:'Переписка',status:'ready',segments:[{id:'c',time:0,text:'Переписка неудобна.'}]}] as any;
 for(const q of ['Топ-3 проблемы с оплатой','Какие проблемы с картой?','Какие проблемы с перепиской?'])assert.equal(selectEvidence(docs,q).coverage.strategy,undefined);
 assert(selectEvidence(docs,'Топ-3 проблемы с оплатой').sources.every(s=>s.studyId==='pay'));
});
