import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile,readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createMnemaServer} from './server.ts';

// Synthetic local files and provider replies only. No process-wide key environment is changed.
test('blocked ASR does not block analysis; queued documents keep honest status and run before the next recording across isolated projects', {timeout:20000}, async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mnemonika-processing-queue-'));
 const base='http://127.0.0.1:4198',setup=randomBytes(32).toString('hex');
 let releaseASR!:()=>void;const asrGate=new Promise<void>(resolve=>{releaseASR=resolve});
 let asrReleased=false,asrCalls=0,documentId='',projectB='',cookie='',firstCheckpointDir='';
 const providerInputs:any[]=[];
 const app=await createMnemaServer({dataDir:dir,baseURL:base,authSecret:randomBytes(32).toString('hex'),setupToken:setup,
  recordingProcessor:async args=>{
   asrCalls++;const call=asrCalls;
   if(call===1){
    assert.ok(args.checkpointDir,'worker must supply a job-scoped persistent checkpoint directory');firstCheckpointDir=args.checkpointDir;
    await mkdir(firstCheckpointDir,{recursive:true});await writeFile(join(firstCheckpointDir,'asr.json'),JSON.stringify({synthetic:true,segments:['FIXTURE_PRIVATE_CHECKPOINT']}));
    args.onProgress?.('Синтетическое распознавание ждёт разрешения теста');await asrGate;asrReleased=true;
   }
   else{
    const project:any=app.db.prepare('SELECT data FROM mnema_workspaces WHERE id=?').get(projectB);
    assert.equal(JSON.parse(project.data).studies.find(study=>study.id===documentId)?.status,'ready','queued document must finish before a second CPU recording starts');
   }
   return {segments:[{id:'fixture-recording-'+call,time:0,end:1,speaker:'Запись',text:'SYNTHETIC_MAIN_RECORDING_'+call}],duration:1,model:'Fixture — not real ASR',processingSeconds:0};
  },
  providerFetch:async(_input,init)=>{
   const request=JSON.parse(String(init?.body)),payload=JSON.parse(request.messages.at(-1).content);providerInputs.push(payload);
   assert.equal(asrReleased,false,'analysis should complete while the first recording is still blocked');
   assert.match(JSON.stringify(payload),/SYNTHETIC_PROJECT_B_ONLY/);assert.doesNotMatch(JSON.stringify(payload),/SYNTHETIC_MAIN_ONLY|SYNTHETIC_MAIN_RECORDING/);
   return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({summary:[{title:'Синтетическая тема проекта Б',text:'Синтетическая сводка проекта Б.',segments:['shared-segment']}]})}}],usage:{total_tokens:10}});
  },
 });
 await new Promise<void>(resolve=>app.server.listen(4198,'127.0.0.1',resolve));
 const request=async(path:string,{body,method,workspace='main',headers={}}:{body?:any;method?:string;workspace?:string;headers?:Record<string,string>}={})=>{
  const raw=body instanceof Uint8Array;
  const response=await fetch(base+path,{method:method||(body===undefined?'GET':'POST'),headers:{Origin:base,'Content-Type':raw?'application/octet-stream':'application/json','X-Mnema-Request':'1',Cookie:cookie+'; mnema_ws='+workspace,...headers},...(body===undefined?{}:{body:raw?new Uint8Array(body):JSON.stringify(body)})});
  return {response,data:await response.json()};
 };
 const state=async(workspace='main')=>{const result=await request('/api/state',{workspace});assert.equal(result.response.status,200,JSON.stringify(result.data));return result.data.state};
 const until=async<T>(read:()=>Promise<T>,accept:(value:T)=>boolean,label:string)=>{
  const deadline=Date.now()+7000;let latest:T;
  do{latest=await read();if(accept(latest))return latest;await new Promise(resolve=>setTimeout(resolve,40))}while(Date.now()<deadline);
  assert.fail(label+': '+JSON.stringify(latest));
 };
 const upload=async(name:string,bytes:string,workspace='main')=>{
  const result=await request('/api/uploads',{workspace,body:Buffer.from(bytes),headers:{'X-File-Name':encodeURIComponent(name)}});
  assert.equal(result.response.status,201,JSON.stringify(result.data));return {id:result.data.createdStudyId,state:result.data.state};
 };
 try{
  const owner=await request('/api/register',{body:{email:'processing-queue-owner@example.test',password:'queue-fixture-password-only',setupToken:setup}});
  assert.equal(owner.response.status,200,JSON.stringify(owner.data));cookie=owner.response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  const created=await request('/api/workspaces',{body:{name:'Synthetic queue project B'}});assert.equal(created.response.status,201);projectB=created.data.id;
  const model=await request('/api/models',{workspace:projectB,body:{name:'Queue fixture model',model:'queue-fixture-model',url:'https://api.deepseek.com/v1',apiKey:'queue-provider-fixture-not-real',enabled:true}});
  assert.equal(model.response.status,201,JSON.stringify(model.data));const modelId=model.data.state.models.find(value=>value.model==='queue-fixture-model').id;
  const seedReady=(workspace:string,text:string)=>{
   const row:any=app.db.prepare('SELECT data FROM mnema_workspaces WHERE id=?').get(workspace),snapshot=JSON.parse(row.data);
   snapshot.studies.push({id:'shared-material',title:'Synthetic ready '+workspace,type:'Интервью',format:'TXT',status:'ready',report:'none',summary:[],tags:[],segments:[{id:'shared-segment',time:0,speaker:'Документ',text}]});
   app.db.prepare('UPDATE mnema_workspaces SET data=? WHERE id=?').run(JSON.stringify(snapshot),workspace);
  };
  seedReady('main','SYNTHETIC_MAIN_ONLY');seedReady(projectB,'SYNTHETIC_PROJECT_B_ONLY');
  const recording=await upload('first-fixture.wav','synthetic-recording-one');
  const running=await until(()=>state(),value=>value.studies.some(study=>study.id===recording.id&&study.processingState==='running')&&asrCalls===1,'first recording did not enter blocked ASR');
  const firstJob:any=app.db.prepare('SELECT id FROM mnema_jobs WHERE study_id=?').get(recording.id);assert.equal(firstCheckpointDir,join(dir,'processing',firstJob.id));assert(existsSync(join(firstCheckpointDir,'asr.json')),'active ASR checkpoint must survive while the processor is blocked');
  const active=running.studies.find(study=>study.id===recording.id);assert.equal(active.activity.label,'Распознаём запись');assert.equal(active.activity.state,'running');assert(active.processingStartedAt>0);assert(active.processingUpdatedAt>=active.processingStartedAt);
  // The next recording is enqueued before the document, making document priority observable.
  const nextRecording=await upload('second-fixture.wav','synthetic-recording-two');
  const document=await upload('queued-fixture.txt','SYNTHETIC_PROJECT_B_DOCUMENT',projectB);documentId=document.id;
  const waiting=document.state.studies.find(study=>study.id===documentId);
  const retainedDocument=join(dir,'uploads',waiting.fileId),retainedBytes=await readFile(retainedDocument);
  const discarded=await upload('discarded-fixture.wav','synthetic-recording-to-delete');
  const discardedStudy=discarded.state.studies.find(study=>study.id===discarded.id),discardedJob:any=app.db.prepare("SELECT id FROM mnema_jobs WHERE study_id=? AND status='queued'").get(discarded.id);assert(discardedJob);
  const discardedCache=join(dir,'processing',discardedJob.id);await mkdir(discardedCache,{recursive:true});await writeFile(join(discardedCache,'asr.json'),'SYNTHETIC_QUEUED_PRIVATE_CHECKPOINT');
  const removed=await request('/api/studies/'+discarded.id,{method:'DELETE'});assert.equal(removed.response.status,200,JSON.stringify(removed.data));
  assert(!app.db.prepare('SELECT id FROM mnema_jobs WHERE id=?').get(discardedJob.id),'deleted queued study must have no runnable job');
  assert(!existsSync(discardedCache),'deleted queued study must leave no private checkpoint');assert(!existsSync(join(dir,'uploads',discardedStudy.fileId)),'deleted queued original must be removed');
  assert.deepEqual(await readFile(retainedDocument),retainedBytes,'deleting a queued material must leave the other project original unchanged');
  assert(existsSync(join(firstCheckpointDir,'asr.json')),'deleting another study must retain the running ASR checkpoint');
  assert.equal(waiting.processingState,'queued');assert.equal(waiting.activity.state,'queued');assert.equal(waiting.activity.label,'В очереди на обработку');assert.equal(waiting.processingStartedAt,undefined);assert.equal(asrCalls,1);
  const queued=await request('/api/studies/shared-material/summary',{workspace:projectB,body:{modelId}});assert.equal(queued.response.status,202,JSON.stringify(queued.data));
  const analyzed=await until(()=>state(projectB),value=>value.studies.find(study=>study.id==='shared-material')?.summaryInfo?.state==='ready','analysis was blocked by ASR');
  assert.equal(asrReleased,false);assert.equal(asrCalls,1);assert.equal(providerInputs.length,1);
  assert.equal(analyzed.studies.find(study=>study.id===documentId).processingState,'queued');assert(!JSON.stringify(analyzed).includes('SYNTHETIC_MAIN_ONLY'));
  const mainWhileBlocked=await state();assert.equal(mainWhileBlocked.studies.find(study=>study.id==='shared-material').summaryInfo,undefined);assert(!mainWhileBlocked.studies.some(study=>study.id===documentId));assert(!JSON.stringify(mainWhileBlocked).includes('SYNTHETIC_PROJECT_B_ONLY'));
  releaseASR();
  const doneB=await until(()=>state(projectB),value=>value.studies.find(study=>study.id===documentId)?.status==='ready','document did not complete after ASR release');
  const doneMain=await until(()=>state(),value=>[recording.id,nextRecording.id].every(id=>value.studies.find(study=>study.id===id)?.status==='ready'),'recording lane did not complete');
  await until(async()=>existsSync(firstCheckpointDir),exists=>!exists,'finished ASR checkpoint was retained');
  assert.equal(asrCalls,2);assert.equal(doneB.studies.find(study=>study.id===documentId).processingState,undefined);assert.equal(doneB.studies.find(study=>study.id===documentId).activity.label,'Текст готов');
  assert.match(JSON.stringify(doneB),/SYNTHETIC_PROJECT_B_DOCUMENT/);assert.doesNotMatch(JSON.stringify(doneB),/SYNTHETIC_MAIN_RECORDING/);assert.doesNotMatch(JSON.stringify(doneMain),/SYNTHETIC_PROJECT_B_DOCUMENT|Синтетическая сводка проекта Б/);
 }finally{
  releaseASR();
  // Let an already-started fake processor finish before closing its SQLite handle.
  for(let attempt=0;attempt<100;attempt++){if(!Number((app.db.prepare("SELECT count(*) AS n FROM mnema_jobs WHERE status='running'").get() as any).n))break;await new Promise(resolve=>setTimeout(resolve,20))}
  app.notifications.close();app.server.closeAllConnections();await new Promise<void>(resolve=>app.server.close(()=>resolve()));app.db.close();await rm(dir,{recursive:true,force:true});
 }
});
