import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createMnemaServer} from './server.ts';

test('only account administrators change the model, and the change reaches every project with its key',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mnemonika-model-sync-')),setup=randomBytes(32).toString('hex'),calls:string[]=[];
 const app=await createMnemaServer({dataDir:dir,baseURL:'http://127.0.0.1:4199',authSecret:randomBytes(32).toString('hex'),setupToken:setup,
  providerFetch:async(_input,init)=>{calls.push(JSON.parse(String(init?.body||'{}')).model);return Response.json({choices:[{finish_reason:'stop',message:{content:'Ответ.'}}],usage:{total_tokens:5}})}});
 await new Promise<void>(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+(app.server.address() as any).port;
 const req=async(path:string,{body,method,cookie='',workspace=''}:{body?:any;method?:string;cookie?:string;workspace?:string}={})=>{
  const response=await fetch(base+path,{method:method||(body===undefined?'GET':'POST'),headers:{'Content-Type':'application/json','X-Mnema-Request':'1',Origin:'http://127.0.0.1:4199',...(cookie?{Cookie:cookie}:{}),...(workspace?{'X-Mnema-Workspace':workspace}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  return {response,data:await response.json()};
 };
 try{
  const owner=await req('/api/register',{body:{email:'sync-owner@example.com',password:'fixture-owner-password',setupToken:setup}});
  assert.equal(owner.response.status,200,JSON.stringify(owner.data));const cookie=owner.response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  const second=(await req('/api/workspaces',{cookie,body:{name:'Второй проект'}})).data.id;assert(second);
  const added=await req('/api/models',{cookie,workspace:'main',body:{name:'Flash',model:'flash-model',apiType:'compatible',url:'https://api.deepseek.com/v1',provider:'Fixture',keySource:'api',apiKey:'fixture-key-not-real-flash',reserve:true}});
  assert.equal(added.response.status,201,JSON.stringify(added.data));const flash=added.data.state.models.find((m:any)=>m.model==='flash-model');
  const main=(await req('/api/state',{cookie,workspace:'main'})).data;
  const switched=await req('/api/state',{cookie,workspace:'main',method:'PATCH',body:{version:main.version,changes:{modelId:flash.id}}});
  assert.equal(switched.response.status,200,JSON.stringify(switched.data));
  const third=(await req('/api/workspaces',{cookie,body:{name:'Новый проект'}})).data.id;assert(third);
  for(const workspace of [second,third]){
   const state=(await req('/api/state',{cookie,workspace})).data.state;
   assert.equal(state.modelId,flash.id,workspace);
   const copy=state.models.find((m:any)=>m.id===flash.id);assert(copy?.keyConfigured&&copy.reserve,workspace);
  }
  // A full-access member who is not an account administrator uses the team model but cannot change it anywhere.
  const invitation=await req('/api/invitations',{cookie,body:{email:'sync-member@example.com',name:'Member',role:'full'}});
  const invite=new URLSearchParams(invitation.data.inviteURL.split('?').at(-1)).get('invite');
  const member=await req('/api/register',{body:{email:'sync-member@example.com',password:'fixture-member-password',inviteToken:invite}});
  assert.equal(member.response.status,200,JSON.stringify(member.data));const memberCookie=member.response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  const own=(await req('/api/workspaces',{cookie:memberCookie,body:{name:'Проект участника'}})).data.id;assert(own);
  for(const workspace of ['main',own]){
   const st=(await req('/api/state',{cookie:memberCookie,workspace})).data;assert.equal(st.state.modelId,flash.id,'member project uses the team model');
   assert.equal((await req('/api/state',{cookie:memberCookie,workspace,method:'PATCH',body:{version:st.version,changes:{modelId:'other'}}})).response.status,403,workspace);
   assert.equal((await req('/api/models',{cookie:memberCookie,workspace,body:{name:'Mine',model:'mine',apiType:'compatible',url:'https://api.deepseek.com/v1',provider:'Fixture',keySource:'api',apiKey:'fixture-key-not-real-mine'}})).response.status,403,workspace);
   assert.equal((await req('/api/models/'+flash.id+'/test',{cookie:memberCookie,workspace,body:{}})).response.status,403,workspace);
  }
  calls.length=0;
  const answer=await req('/api/models/'+flash.id+'/test',{cookie,workspace:second,body:{}});
  assert.equal(answer.response.status,200,JSON.stringify(answer.data));assert.deepEqual(calls,['flash-model'],'the copied key works in another project');
 }finally{await app.close?.();app.server.close();await rm(dir,{recursive:true,force:true})}
});
