import {collectGlobalResearch,globalEvidence,chatEvidence} from './global-research.ts';
import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomBytes} from 'node:crypto';
import {createMnemaServer} from './server.ts';

test('global answers enforce each project role, exclude revoked projects and hidden catalog segments, and recheck access after generation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mnemonika-global-test-'));const base='http://127.0.0.1:4192',setup=randomBytes(32).toString('hex');const old=process.env.LLM_KEY_CUSTOM2;process.env.LLM_KEY_CUSTOM2='global-test-fixture-not-a-secret';let sent:any[]=[];let sentContext:any=null,providerCalls=0;const replies:string[]=[];let revokeDuringCall=()=>{};
 const app=await createMnemaServer({dataDir:dir,baseURL:base,authSecret:randomBytes(32).toString('hex'),setupToken:setup,providerFetch:async(_input,init)=>{providerCalls++;const request=JSON.parse(String(init.body));sentContext=JSON.parse(request.messages.find(message=>message.role==='user').content);sent=sentContext.sources;revokeDuringCall();return new Response(JSON.stringify({choices:[{message:{content:replies.shift()||'Общий тестовый ответ [1].'}}],usage:{total_tokens:10}}),{headers:{'Content-Type':'application/json'}})}});
 await new Promise<void>(r=>app.server.listen(4192,'127.0.0.1',r));let cookie='';
 const req=async(path:string,body?:any)=>{const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Origin:base,'Content-Type':'application/json','X-Mnema-Request':'1',Cookie:cookie},...(body===undefined?{}:{body:JSON.stringify(body)})});return{response,data:await response.json()}};
 try{
  assert.equal((await req('/api/research-context')).response.status,401);
  const registered=await req('/api/register',{email:'global-owner@example.test',password:'global-test-password-only',setupToken:setup});assert.equal(registered.response.status,200);cookie=registered.response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  const user:any=app.db.prepare('SELECT id FROM user').get();const b=await req('/api/workspaces',{name:'Проект с просмотром'}),c=await req('/api/workspaces',{name:'Закрытый проект'});const bid=b.data.id,cid=c.data.id;
  const model={id:'global-test',name:'Тестовая модель',provider:'QA',url:'https://api.openai.com/v1',model:'fixture',keyRef:'LLM_KEY_CUSTOM2',enabled:true};
  const material=(text:string,id='shared',segments?:any[])=>({id,title:'Источник '+text,type:'Интервью',format:'TXT',status:'ready',report:'none',segments:segments||[{id:'same-segment',time:0,speaker:'Документ',text}],summary:[],tags:[]});
  const catalog={...material('CATALOG','catalog',[{id:'verified',time:0,text:'B_CATALOG_VERIFIED'},{id:'hidden',time:0,text:'B_CATALOG_HIDDEN'}]),importSource:{catalog:true},summaryInfo:{review:'draft',state:'ready'},summary:[{title:'Hidden',text:'B_AI_DRAFT_SECRET',segments:['hidden']}]};
  const state=(studies:any[],findings:any[]=[])=>({studies,findings,models:[model],modelId:model.id});
  app.db.prepare('UPDATE mnema_workspaces SET data=? WHERE id=?').run(JSON.stringify(state([material('A_ALLOWED')])), 'main');
  app.db.prepare('UPDATE mnema_workspaces SET data=? WHERE id=?').run(JSON.stringify(state([material('B_ALLOWED'),catalog],[{id:'verified-finding',studyId:'catalog',segmentId:'verified',status:'verified',kind:'Инсайт',importance:'Средняя',origin:'human'},{id:'draft-finding',studyId:'catalog',segmentId:'hidden',status:'draft',kind:'Инсайт',importance:'Средняя',origin:'ai'}])),bid);
  app.db.prepare('UPDATE mnema_workspaces SET data=? WHERE id=?').run(JSON.stringify(state([material('C_FORBIDDEN')])),cid);
  app.db.prepare("UPDATE mnema_members SET role='view',admin=0 WHERE user_id=? AND workspace_id=?").run(user.id,bid);app.db.prepare('UPDATE mnema_members SET revoked=1 WHERE user_id=? AND workspace_id=?').run(user.id,cid);
  const meta=await req('/api/research-context');assert.equal(meta.data.projects,2);assert.equal(meta.data.materials,3);
  const bstate=JSON.parse(String(app.db.prepare('SELECT data FROM mnema_workspaces WHERE id=?').get(bid).data));bstate.studies[0].summaryInfo={state:'running',review:'draft',progress:'Часть 2 из 3',requestedBy:'private-user',modelId:'private-model'};app.db.prepare('UPDATE mnema_workspaces SET data=? WHERE id=?').run(JSON.stringify(bstate),bid);
  const readerState=await req('/api/state?workspace='+bid);const visible=readerState.data.state.studies.find(s=>s.id==='shared');assert.equal(visible.activity.label,'Анализируем материал');assert.equal(visible.activity.detail,'Часть 2 из 3');assert.equal(visible.summaryInfo,undefined);assert.deepEqual(visible.summary,[]);assert.doesNotMatch(JSON.stringify(visible.activity),/private-user|private-model/);
  const answer=await req('/api/chat/global',{question:'Дай общую информацию по всем исследованиям'});assert.equal(answer.response.status,200,JSON.stringify(answer.data));
  const transmitted=JSON.stringify(sent);assert.match(transmitted,/A_ALLOWED/);assert.match(transmitted,/B_ALLOWED/);assert.match(transmitted,/B_CATALOG_VERIFIED/);assert.doesNotMatch(transmitted,/C_FORBIDDEN|B_CATALOG_HIDDEN|B_AI_DRAFT_SECRET/);
  assert.deepEqual(new Set(answer.data.sources.map(s=>s.workspaceId)),new Set(['main',bid]));assert(answer.data.sources.some(s=>s.workspaceId===bid&&s.studyId==='shared'));assert(answer.data.sources.some(s=>s.workspaceId==='main'&&s.studyId==='shared'));
  for(const workspace of ['main',bid]){const row:any=app.db.prepare('SELECT data FROM mnema_workspaces WHERE id=?').get(workspace),snapshot=JSON.parse(row.data);snapshot.findings.push({id:'reviewed-'+workspace,studyId:'shared',segmentId:'same-segment',title:'Возврат депозита задерживается '+workspace,status:'verified',kind:'Проблема',importance:'Критично',origin:'human',description:'PRIVATE_DESCRIPTION'});app.db.prepare('UPDATE mnema_workspaces SET data=? WHERE id=?').run(JSON.stringify(snapshot),workspace)}
  const beforeReview=providerCalls,usageBefore=Number((app.db.prepare("SELECT count(*) AS n FROM mnema_usage WHERE kind='llm'").get() as any).n);replies.push('Прямых данных нет.','В синтетическом источнике описан эпизод [1].');
  const reviewed=await req('/api/chat/global',{question:'Почему возврат депозита задерживается?'});assert.equal(reviewed.response.status,200,JSON.stringify(reviewed.data));assert.equal(providerCalls-beforeReview,2);assert.equal(Number((app.db.prepare("SELECT count(*) AS n FROM mnema_usage WHERE kind='llm'").get() as any).n)-usageBefore,2,'each review provider call must reserve quota');assert.equal(reviewed.data.usage.total_tokens,20);
  assert.equal(sentContext.reviewed_findings.length,2);assert(!JSON.stringify(sentContext.reviewed_findings).includes('PRIVATE_DESCRIPTION'));for(const finding of sentContext.reviewed_findings)for(const number of finding.sourceNumbers)assert(sentContext.sources.some(source=>source.number===number));
  const beforeProjectReview=providerCalls;replies.push('Прямых данных нет.','В синтетическом материале проекта описан эпизод [1].');
  const projectAnswer=await req('/api/chat',{question:'Почему возврат депозита задерживается?',scope:'shared'});assert.equal(projectAnswer.response.status,200,JSON.stringify(projectAnswer.data));assert.equal(providerCalls-beforeProjectReview,2);assert.equal(sentContext.reviewed_findings.length,1);assert.deepEqual(sentContext.reviewed_findings[0].sourceNumbers,[1]);assert(sentContext.reviewed_findings[0].title.endsWith('main'));assert.doesNotMatch(JSON.stringify(sentContext),/B_ALLOWED|B_CATALOG|C_FORBIDDEN|PRIVATE_DESCRIPTION/);assert.equal(projectAnswer.data.sources.length,1);assert.equal(projectAnswer.data.sources[0].basis,'raw');
  revokeDuringCall=()=>{app.db.prepare('UPDATE mnema_members SET revoked=1 WHERE user_id=? AND workspace_id=?').run(user.id,bid)};
  const callsBeforeRevocation=providerCalls;replies.push('Прямых данных нет.');
  const blockedReview=await req('/api/chat/global',{question:'Почему возврат депозита задерживается?'});assert.equal(blockedReview.response.status,409);assert.equal(providerCalls-callsBeforeRevocation,1,'a revoked project must never be sent to the provider again for consistency review');assert.equal(blockedReview.data.answer,undefined);

  app.db.prepare('UPDATE mnema_members SET revoked=0 WHERE user_id=? AND workspace_id=?').run(user.id,bid);
  const changed=await req('/api/chat/global',{question:'Какие основные идеи есть во всех исследованиях?'});assert.equal(changed.response.status,409);assert.equal(changed.data.sources,undefined);assert.equal(changed.data.answer,undefined);
  revokeDuringCall=()=>{};const after=await req('/api/chat/global',{question:'Какие основные идеи есть во всех исследованиях?'});assert.equal(after.response.status,200);assert.deepEqual(new Set(after.data.sources.map(s=>s.workspaceId)),new Set(['main']));
 }finally{app.notifications.close();await new Promise(r=>app.server.close(r));app.db.close();await rm(dir,{recursive:true,force:true});if(old===undefined)delete process.env.LLM_KEY_CUSTOM2;else process.env.LLM_KEY_CUSTOM2=old}
});

test('global overview samples across projects even when the first project exceeds the evidence budget',()=>{
 const projects=[{id:'a',name:'Календарь',role:'full' as const,admin:true},{id:'b',name:'Бронирование',role:'full' as const,admin:true}];
 const research=collectGlobalResearch({workspaceId:'a',workspaces:projects},project=>({models:[],modelId:'',studies:Array.from({length:40},(_,i)=>({id:'study-'+i,title:'Материал '+i,status:'ready',segments:[{id:'segment-'+i,time:0,text:'Синтетический текст проекта '+project.id}]}))}));
 const result=globalEvidence(research,'Какие основные идеи есть во всех проектах?');
 assert.equal(result.sources.length,24);assert.equal(result.sources.filter(s=>s.workspaceId==='a').length,12);assert.equal(result.sources.filter(s=>s.workspaceId==='b').length,12);assert.equal(result.coverage.materials,80);assert.equal(result.coverage.totalProjects,2);assert.equal(result.coverage.projects,2);
});


test('global reviewed titles keep project prefixes until their selected source numbers are resolved',()=>{
 const projects=[{id:'a',name:'Проект А',role:'view' as const,admin:false},{id:'b',name:'Проект Б',role:'view' as const,admin:false}];
 const reads:string[]=[];
 const research=collectGlobalResearch({workspaceId:'a',workspaces:projects},project=>{reads.push(project.id);return{models:[],studies:[{id:'shared',title:'Синтетическое интервью',status:'ready',segments:[{id:'shared-segment',time:0,text:'Синтетический источник '+project.id}]}],findings:[{studyId:'shared',segmentId:'shared-segment',title:'Возврат депозита '+project.id,status:'verified'},{studyId:'shared',segmentId:'shared-segment',title:'Возврат депозита DRAFT_SECRET',status:'draft'},{studyId:'a:shared',segmentId:'shared-segment',title:'Возврат депозита FOREIGN_LINK',status:'verified'},{studyId:'shared',segmentId:'hidden-segment',title:'Возврат депозита HIDDEN_SOURCE',status:'verified'}]}});
 const result=globalEvidence(research,'Возврат депозита');assert.deepEqual(reads,['a','b']);assert.equal(result.reviewedFindings.length,2);
 for(const finding of result.reviewedFindings){const workspace=finding.title.endsWith(' a')?'a':'b';assert(finding.sourceNumbers.every(number=>result.sources[number-1].workspaceId===workspace))}
 assert(!JSON.stringify(result.reviewedFindings).match(/DRAFT_SECRET|FOREIGN_LINK|HIDDEN_SOURCE/));assert(result.sources.every(source=>source.studyId==='shared'));
});

test('a project chat answers from its project and widens only when the project has no evidence',()=>{
 const projects=[{id:'a',name:'Проект А',role:'full' as const,admin:true},{id:'b',name:'Проект Б',role:'full' as const,admin:true}];
 const research=collectGlobalResearch({workspaceId:'a',workspaces:projects},project=>({models:[],modelId:'',studies:[{id:'s',title:'Интервью',status:'ready',segments:[{id:'seg',time:0,text:project.id==='a'?'Оплата без ответа хозяина':'Оплата и депозит'}]}],findings:[]}));
 assert.deepEqual(chatEvidence(research,'оплата','a').sources.map(s=>s.workspaceId),['a']);
 assert.deepEqual(chatEvidence(research,'депозит','a').sources.map(s=>s.workspaceId),['b']);
 assert.deepEqual(new Set(chatEvidence(research,'оплата',null).sources.map(s=>s.workspaceId)),new Set(['a','b']));
});
