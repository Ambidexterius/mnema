import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {createMnemaServer} from './server.ts';
import {runProcessingCommand} from './processing.ts';
import {transcriptRevision} from './summaries.ts';

test('explicit abort waits for a real child to exit rather than its early AbortError callback',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mnema-cancel-child-')),controller=new AbortController(),marker=join(dir,'closed');
 const script=`const fs=require('node:fs');process.on('SIGTERM',()=>{setTimeout(()=>{fs.writeFileSync(process.argv[1],'exited');process.exit(0)},180)});console.log('ready');setInterval(()=>{},1000);`;
 try{
  await assert.rejects(runProcessingCommand(process.execPath,['-e',script,marker],{signal:controller.signal,onStdoutLine:line=>{if(line==='ready')controller.abort()}}),{name:'AbortError'});
  assert.equal(await readFile(marker,'utf8'),'exited','the promise must not settle before child shutdown finishes');
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('deleting active speakers blocks concurrent LLM requests and skips queued analysis until cleanup', {timeout:15000}, async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mnema-cancel-speakers-')),base='http://127.0.0.1:4200',setup=randomBytes(32).toString('hex');
 let owner='',reader='',speakerArgs:any,aborted=false,providerCalls=0,releaseAbort:(()=>void)|undefined;
 let releaseStop!:()=>void;const stopGate=new Promise<void>(resolve=>{releaseStop=resolve});
 const app=await createMnemaServer({dataDir:dir,baseURL:base,authSecret:randomBytes(32).toString('hex'),setupToken:setup,
  recordingProcessor:async()=>({segments:[{id:'speaker-source',time:0,end:1,speaker:'Запись',text:'SYNTHETIC_READY_RECORDING'}],duration:1}),
  speakerProcessor:async args=>{speakerArgs=args;await new Promise<void>(resolve=>{releaseAbort=resolve;args.signal!.addEventListener('abort',()=>{aborted=true;resolve()},{once:true})});await stopGate;return{speakers:{'speaker-source':'Спикер 1'},count:1,engine:'Fixture',processingSeconds:0}},
  providerFetch:async()=>{providerCalls++;return Response.json({choices:[{finish_reason:'stop',message:{content:'{}'}}]})},
 });
 await new Promise<void>((resolve,reject)=>{app.server.once('error',reject);app.server.listen(4200,'127.0.0.1',resolve)});
 const request=async(path:string,{body,method,cookie=owner,headers={}}:{body?:any;method?:string;cookie?:string;headers?:Record<string,string>}={})=>{
  const raw=body instanceof Uint8Array,response=await fetch(base+path,{method:method||(body===undefined?'GET':'POST'),headers:{Origin:base,'X-Mnema-Request':'1','Content-Type':raw?'application/octet-stream':'application/json',Cookie:cookie,...headers},...(body===undefined?{}:{body:raw?new Uint8Array(body):JSON.stringify(body)})});return{response,data:await response.json()};
 };
 const until=async(check:()=>Promise<boolean>,label:string)=>{const deadline=Date.now()+6000;while(Date.now()<deadline){if(await check())return;await new Promise(resolve=>setTimeout(resolve,25))}assert.fail(label)};
 try{
  const registered=await request('/api/register',{body:{email:'speakers-owner@example.test',password:'speakers-fixture-owner-password',setupToken:setup}});assert.equal(registered.response.status,200);owner=registered.response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  const invited=await request('/api/invitations',{body:{email:'speakers-reader@example.test',name:'Synthetic reader',role:'view'}}),inviteToken=new URLSearchParams(invited.data.inviteURL.split('?')[1]).get('invite');
  const joined=await request('/api/register',{cookie:'',body:{email:'speakers-reader@example.test',password:'speakers-fixture-reader-password',inviteToken}});assert.equal(joined.response.status,200);reader=joined.response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  const configured=await request('/api/models',{body:{name:'Cancellation fixture model',model:'cancellation-fixture',url:'https://api.deepseek.com/v1',apiKey:'synthetic-not-a-real-provider-key',enabled:true}});assert.equal(configured.response.status,201);const modelId=configured.data.state.models.find(model=>model.model==='cancellation-fixture').id;
  const uploaded=await request('/api/uploads',{body:Buffer.from('SYNTHETIC_AUDIO'),headers:{'X-File-Name':'speakers-fixture.wav'}});assert.equal(uploaded.response.status,201);const studyId=uploaded.data.createdStudyId;
  await until(async()=>(await request('/api/state')).data.state.studies.find(study=>study.id===studyId)?.status==='ready','recording did not become ready');
  assert.equal((await request('/api/studies/'+studyId+'/speakers',{body:{}})).response.status,202);await until(async()=>Boolean(speakerArgs),'speaker worker did not start');
  const deleting=request('/api/studies/'+studyId,{method:'DELETE'});await until(async()=>aborted,'deletion did not start speaker cancellation');
  for(const suffix of ['/summary','/suggest-findings']){
   assert.equal((await request('/api/studies/'+studyId+suffix,{body:{modelId},cookie:reader})).response.status,403,'existing role denial must precede deletion status');
   const denied=await request('/api/studies/'+studyId+suffix,{body:{modelId}});assert.equal(denied.response.status,409,JSON.stringify(denied.data));assert.match(denied.data.error,/Материал удаляется/);
  }
  const current=(await request('/api/state')).data;assert.equal(current.state.studies.find(study=>study.id===studyId).summaryInfo,undefined);assert.equal(current.state.studies.find(study=>study.id===studyId).findingsInfo,undefined);
  // Simulate already persisted tasks racing the deletion; the scheduler must also guard them.
  const row:any=app.db.prepare("SELECT data FROM mnema_workspaces WHERE id='main'").get(),snapshot=JSON.parse(row.data),study=snapshot.studies.find(study=>study.id===studyId);
  study.summaryInfo={state:'queued',review:'draft',revision:transcriptRevision(study.segments),modelId,requestedBy:current.user.id};study.findingsInfo={state:'queued',revision:transcriptRevision(study.segments),modelId,requestedBy:current.user.id};
  app.db.prepare("UPDATE mnema_workspaces SET data=? WHERE id='main'").run(JSON.stringify(snapshot));
  await new Promise(resolve=>setTimeout(resolve,1250));assert.equal(providerCalls,0,'analysis scheduler must skip a material being deleted');
  const waiting=(await request('/api/state')).data.state.studies.find(study=>study.id===studyId);assert.equal(waiting.summaryInfo.state,'queued');assert.equal(waiting.findingsInfo.state,'queued');
  releaseStop();const removed=await deleting;assert.equal(removed.response.status,200,JSON.stringify(removed.data));assert.equal(providerCalls,0);assert(!removed.data.state.studies.some(study=>study.id===studyId));
 }finally{
  releaseAbort?.();releaseStop();
  for(let attempt=0;attempt<100;attempt++){if(!Number((app.db.prepare("SELECT count(*) AS n FROM mnema_jobs WHERE status='running'").get() as any).n))break;await new Promise(resolve=>setTimeout(resolve,20))}
  app.notifications.close();app.server.closeAllConnections();await new Promise<void>(resolve=>app.server.close(()=>resolve()));app.db.close();await rm(dir,{recursive:true,force:true});
 }
});

test('deleting a running material waits for scoped cancellation, ignores late callbacks and preserves another project', {timeout:20000}, async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mnema-cancel-api-')),base='http://127.0.0.1:4199',setup=randomBytes(32).toString('hex');
 let owner='',reader='',projectB='',aborted=false,stopped=false,processorCalls=0,firstArgs:any;
 let releaseStop!:()=>void,releaseAbort:(()=>void)|undefined;const stopGate=new Promise<void>(resolve=>{releaseStop=resolve});
 let lateProgress:(p:string)=>void=()=>{};
 const app=await createMnemaServer({dataDir:dir,baseURL:base,authSecret:randomBytes(32).toString('hex'),setupToken:setup,recordingProcessor:async args=>{
  processorCalls++;
  if(processorCalls===1){
   firstArgs=args;lateProgress=args.onProgress||(()=>{});
   await mkdir(args.checkpointDir!,{recursive:true});await writeFile(join(args.checkpointDir!,'asr.json'),'SYNTHETIC_PRIVATE_CHECKPOINT');
   await new Promise<void>(resolve=>{releaseAbort=resolve;args.signal!.addEventListener('abort',()=>{aborted=true;lateProgress('LATE_PROGRESS_AFTER_ABORT');resolve()},{once:true})});
   assert(existsSync(args.filePath),'the original must remain until the processor exits');
   await stopGate;
   assert(existsSync(args.filePath),'the original must still exist during shutdown cleanup');
   lateProgress('LATE_PROGRESS_BEFORE_RETURN');stopped=true;
   // A badly behaved processor can still return after abort; this must never be applied.
   return {segments:[{id:'late-source',time:0,speaker:'Запись',text:'LATE_RESULT_MUST_NOT_BE_SAVED'}],duration:1};
  }
  return {segments:[{id:'other-source',time:0,speaker:'Запись',text:'OTHER_PROJECT_RECORDING'}],duration:1};
 }});
 await new Promise<void>((resolve,reject)=>{app.server.once('error',reject);app.server.listen(4199,'127.0.0.1',resolve)});
 const request=async(path:string,{body,method,workspace='main',cookie=owner,headers={}}:{body?:any;method?:string;workspace?:string;cookie?:string;headers?:Record<string,string>}={})=>{
  const raw=body instanceof Uint8Array;const response=await fetch(base+path,{method:method||(body===undefined?'GET':'POST'),headers:{Origin:base,'X-Mnema-Request':'1','Content-Type':raw?'application/octet-stream':'application/json',Cookie:cookie+'; mnema_ws='+workspace,...headers},...(body===undefined?{}:{body:raw?new Uint8Array(body):JSON.stringify(body)})});
  return {response,data:await response.json()};
 };
 const state=async(workspace='main')=>(await request('/api/state',{workspace})).data.state;
 const until=async(check:()=>Promise<boolean>,message:string)=>{const deadline=Date.now()+7000;while(Date.now()<deadline){if(await check())return;await new Promise(resolve=>setTimeout(resolve,25))}assert.fail(message)};
 const upload=async(name:string,workspace='main')=>{const result=await request('/api/uploads',{workspace,body:Buffer.from('SYNTHETIC_RECORDING'),headers:{'X-File-Name':encodeURIComponent(name)}});assert.equal(result.response.status,201,JSON.stringify(result.data));return result.data.createdStudyId};
 try{
  const registered=await request('/api/register',{body:{email:'cancel-owner@example.test',password:'cancel-fixture-owner-password',setupToken:setup}});assert.equal(registered.response.status,200);owner=registered.response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  const invitation=await request('/api/invitations',{body:{name:'Synthetic reader',email:'cancel-reader@example.test',role:'view'}});assert.equal(invitation.response.status,201);const invite=new URLSearchParams(invitation.data.inviteURL.split('?')[1]).get('invite');
  const joined=await request('/api/register',{cookie:'',body:{email:'cancel-reader@example.test',password:'cancel-fixture-reader-password',inviteToken:invite}});assert.equal(joined.response.status,200,JSON.stringify(joined.data));reader=joined.response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  const project=await request('/api/workspaces',{body:{name:'Synthetic cancellation project B'}});assert.equal(project.response.status,201);projectB=project.data.id;
  const studyId=await upload('cancel-fixture.wav');
  await until(async()=>Boolean(firstArgs),'ASR did not start');
  const original=firstArgs.filePath,checkpoint=firstArgs.checkpointDir,jobId=(app.db.prepare('SELECT id FROM mnema_jobs WHERE study_id=?').get(studyId) as any).id;
  const otherId=await upload('other-fixture.wav',projectB),otherStudy=(await state(projectB)).studies.find(study=>study.id===otherId),otherPath=join(dir,'uploads',otherStudy.fileId),otherBytes=await readFile(otherPath);
  assert.equal((await request('/api/studies/'+studyId,{method:'DELETE',cookie:reader})).response.status,403);assert.equal(aborted,false,'a reader must not abort processing');
  assert.equal((await request('/api/studies/'+studyId,{method:'DELETE',workspace:projectB})).response.status,404);assert.equal(aborted,false,'another project must not select the active job');
  let deleteFinished=false;const deleting=request('/api/studies/'+studyId,{method:'DELETE'}).then(result=>{deleteFinished=true;return result});
  await until(async()=>aborted,'DELETE did not deliver the job-scoped abort');
  await new Promise(resolve=>setTimeout(resolve,80));assert.equal(deleteFinished,false,'DELETE must await processor shutdown');assert(existsSync(original));assert(existsSync(checkpoint));
  const shuttingDown=(await state()).studies.find(study=>study.id===studyId);assert(shuttingDown);assert.doesNotMatch(JSON.stringify(shuttingDown),/LATE_PROGRESS|LATE_RESULT/);assert.equal(processorCalls,1);
  assert.equal((await request('/api/studies/'+studyId,{method:'DELETE'})).response.status,409,'concurrent deletion must not race cleanup');
  releaseStop();const removed=await deleting;assert.equal(removed.response.status,200,JSON.stringify(removed.data));assert.equal(stopped,true);
  assert(!existsSync(original));assert(!existsSync(checkpoint));assert(!app.db.prepare('SELECT 1 FROM mnema_jobs WHERE id=?').get(jobId));assert(!removed.data.state.studies.some(study=>study.id===studyId));
  lateProgress('LATE_PROGRESS_AFTER_DELETE');assert(!(await state()).studies.some(study=>study.id===studyId),'late progress must not resurrect the material');
  await until(async()=>(await state(projectB)).studies.find(study=>study.id===otherId)?.status==='ready','the next project job did not continue');
  const remaining=await state(projectB);assert.equal(processorCalls,2);assert.match(JSON.stringify(remaining),/OTHER_PROJECT_RECORDING/);assert.doesNotMatch(JSON.stringify(remaining),/LATE_RESULT_MUST_NOT_BE_SAVED/);assert.deepEqual(await readFile(otherPath),otherBytes);
 }finally{
  releaseStop();releaseAbort?.();
  for(let attempt=0;attempt<100;attempt++){if(!Number((app.db.prepare("SELECT count(*) AS n FROM mnema_jobs WHERE status='running'").get() as any).n))break;await new Promise(resolve=>setTimeout(resolve,20))}
  app.notifications.close();app.server.closeAllConnections();await new Promise<void>(resolve=>app.server.close(()=>resolve()));app.db.close();await rm(dir,{recursive:true,force:true});
 }
});
