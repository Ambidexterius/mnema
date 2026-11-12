import {test} from 'node:test';
import assert from 'node:assert/strict';
import {UploadQueue,type UploadItem} from '../app/upload-queue.ts';
import {uploadFile} from '../app/api.ts';

const item=(name:string):UploadItem=>({file:new File(['fixture'],name),title:name,type:'Отчёт',project:'',autoSummary:false});
const until=async(fn:()=>boolean)=>{for(let i=0;i<100&&!fn();i++)await new Promise(r=>setTimeout(r,5));assert(fn())};

test('batch cancellation releases an active session, skips queued files and continues after an individual failure',async()=>{
 const calls:string[]=[],saved:string[]=[];let cleanups=0,attempt=0;
 const queue=new UploadQueue(r=>saved.push(r.createdStudyId),async(file,_meta,progress,control)=>{
   calls.push(file.name);
   if(file.name==='first.txt'){
     progress(33);control.onSession(async()=>{cleanups++;return null});
     await new Promise((_,reject)=>control.signal.addEventListener('abort',()=>reject(control.signal.reason),{once:true}));
   }
   if(file.name==='retry.txt'&&!attempt++)throw new Error('fixture offline');
   return {createdStudyId:file.name};
 });
 queue.add(['first.txt','skip.txt','retry.txt','last.txt'].map(item),'project');
 const [first,skip,retry]=queue.snapshot();
 queue.cancel(skip.id);queue.cancel(first.id);await until(()=>!queue.busy);
 assert.deepEqual(calls,['first.txt','retry.txt','last.txt']);assert.equal(cleanups,1);
 assert.deepEqual(queue.snapshot().map(r=>r.state),['cancelled','cancelled','error','ready']);
 queue.retry(retry.id);await until(()=>!queue.busy);
 assert.deepEqual(saved,['last.txt','retry.txt']);queue.clear();assert.equal(queue.snapshot().length,0);
});
test('cancel in-flight chunk deletes the pinned workspace session, retries a busy cleanup and never completes it',async t=>{
 const store=new Map<string,string>(),requests:string[]=[];let began!:()=>void;const firstChunk=new Promise<void>(r=>{began=r});
 const original=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)}});
 t.after(()=>{if(original)Object.defineProperty(globalThis,'localStorage',original);else delete globalThis.localStorage});
 let deletes=0;t.mock.method(globalThis,'fetch',async(url:string,init:any)=>{
   requests.push(init.method+' '+url);
   if(init.method==='POST')return Response.json({id:'fixture',offset:0,chunkSize:4});
   if(init.method==='PUT'){assert.equal(init.headers['X-Mnema-Workspace'],'scope');began();return await new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}))}
   assert(url.endsWith('?workspace=scope'));
   if(init.method==='DELETE'&&++deletes===1)return Response.json({error:'busy'},{status:409});
   return Response.json({offset:0});
 });
 const controller=new AbortController();let discard:()=>Promise<any>;
 const transfer=uploadFile(new File(['abcdefgh'],'test.txt'),{workspaceId:'scope'},()=>{},{signal:controller.signal,onSession:fn=>{discard=fn}});
 await firstChunk;controller.abort();await assert.rejects(transfer);await discard();
 assert.equal(deletes,2);assert.equal(store.size,0);assert(!requests.some(r=>r.includes('/complete')));
});
