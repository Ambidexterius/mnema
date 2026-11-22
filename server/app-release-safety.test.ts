import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test,type TestContext} from 'node:test';
import {maintainUploadCache,rememberWorkspace,uploadFile} from '../app/api.ts';

function browserGlobal(t:TestContext,name:string,value:unknown){
 const old=Object.getOwnPropertyDescriptor(globalThis,name);
 Object.defineProperty(globalThis,name,{value,configurable:true});
 t.after(()=>{if(old)Object.defineProperty(globalThis,name,old);else Reflect.deleteProperty(globalThis,name)});
}

test('workspace cookie is secure over HTTPS and works over local HTTP',t=>{
 const doc={cookie:''},page={protocol:'https:'};
 browserGlobal(t,'document',doc);
 browserGlobal(t,'location',page);
 rememberWorkspace('team 1');
 assert.equal(doc.cookie,'mnema_ws=team%201; Path=/; SameSite=Lax; Secure');
 rememberWorkspace(null);
 assert.equal(doc.cookie,'mnema_ws=; Path=/; SameSite=Lax; Secure; Max-Age=0');
 page.protocol='http:';
 rememberWorkspace('main');
 assert.equal(doc.cookie,'mnema_ws=main; Path=/; SameSite=Lax');
});

test('old upload IDs resume from a hashed key, and expired entries are removed',async t=>{
 const file=new File(['fixture'],'Синтетическое интервью.txt',{type:'text/plain',lastModified:123});
 const signature=createHash('sha256').update('fixturefixture').digest('hex');
 const legacy='mnemonio.upload.main.'+encodeURIComponent(file.name)+'.'+file.size+'.'+file.lastModified+'.'+signature;
 const hashed='mnemonio.upload.v2.'+createHash('sha256').update(legacy).digest('hex');
 const workspaceCache=new Map([
  [legacy,JSON.stringify({id:'resume-id'})],
  ['mnemonio.upload.v2.expired',JSON.stringify({id:'expired',storedAt:0})],
  ['unrelated','keep'],
 ]);
 browserGlobal(t,'localStorage',{
  get length(){return workspaceCache.size},
  key:(index:number)=>[...workspaceCache.keys()][index],
  getItem:(key:string)=>workspaceCache.get(key)??null,
  setItem:(key:string,value:string)=>workspaceCache.set(key,value),
  removeItem:(key:string)=>workspaceCache.delete(key),
 });
 await maintainUploadCache();
 assert.deepEqual([...workspaceCache.keys()].sort(),[hashed,'unrelated'].sort());
 assert.equal(JSON.parse(workspaceCache.get(hashed)!).id,'resume-id');
 const requests:string[]=[];
 t.mock.method(globalThis,'fetch',async (path:string,options:RequestInit)=>{
  assert.equal(options.method,'GET');
  requests.push(path);
  return Response.json(path.startsWith('/api/upload-sessions')?{completedStudyId:'study-id'}:{state:{}});
 });
 assert.equal((await uploadFile(file,{workspaceId:'main'},()=>{})).createdStudyId,'study-id');
 assert.deepEqual(requests,['/api/upload-sessions/resume-id?workspace=main','/api/state?workspace=main']);
 assert.deepEqual([...workspaceCache.keys()],['unrelated']);
});
