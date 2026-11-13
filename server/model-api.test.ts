import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createMnemaServer} from './server.ts';

test('model API: owner-only keys/catalogue, native providers, chat rules and cross-project key isolation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mnemonika-model-api-')),setup=randomBytes(32).toString('hex'),calls:any[]=[];
 const openAIKey='fixture-openai-key-not-real',claudeKey='fixture-anthropic-key-not-real',longAnswer='Завершённый тестовый ответ. '.repeat(700);
 const app=await createMnemaServer({dataDir:dir,baseURL:'http://127.0.0.1:4198',authSecret:randomBytes(32).toString('hex'),setupToken:setup,
  providerFetch:async(input,init)=>{
   const url=String(input);calls.push({url,headers:new Headers(init?.headers),body:init?.body?JSON.parse(String(init.body)):null});
   if(!init?.method||init.method==='GET')return Response.json({data:[{id:url.includes('anthropic')?'claude-fixture':'gpt-fixture',display_name:'Fixture model'}]});
   if(url.endsWith('/responses'))return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:longAnswer}]}],usage:{input_tokens:10,output_tokens:20,total_tokens:30}});
   return Response.json({stop_reason:'end_turn',content:[{type:'text',text:'Claude fixture OK'}],usage:{input_tokens:10,output_tokens:20}});
  }});
 await new Promise<void>(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+(app.server.address() as any).port;
 const req=async(path:string,{body,method,cookie='',workspace='main'}:{body?:any;method?:string;cookie?:string;workspace?:string}={})=>{
  const response=await fetch(base+path,{method:method||(body===undefined?'GET':'POST'),headers:{'Content-Type':'application/json','X-Mnema-Request':'1',Origin:'http://127.0.0.1:4198','X-Mnema-Workspace':workspace,...(cookie?{Cookie:cookie}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  return {response,data:await response.json()};
 };
 try{
  const owner=await req('/api/register',{body:{email:'model-owner@example.com',password:'fixture-owner-password',setupToken:setup}});
  assert.equal(owner.response.status,200,JSON.stringify(owner.data));const cookie=owner.response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  const values={name:'GPT fixture',model:'gpt-fixture',apiType:'openai',provider:'OpenAI',keySource:'api',apiKey:openAIKey,instructions:'Как UX-исследователь: конкретный участник и действие.'};
  const created=await req('/api/models',{cookie,body:values});assert.equal(created.response.status,201,JSON.stringify(created.data));
  const connection=created.data.state.models.find(m=>m.apiType==='openai');assert(connection.keyConfigured&&connection.hasStoredKey);
  assert(!JSON.stringify(created.data).includes(openAIKey));assert(!JSON.stringify(app.db.prepare('SELECT * FROM mnema_model_keys').all()).includes(openAIKey));
  const catalog=await req('/api/models/catalog',{cookie,body:{connectionId:connection.id}});assert.equal(catalog.response.status,200);assert.equal(catalog.data.models[0].id,'gpt-fixture');assert.equal(calls.at(-1).headers.get('Authorization'),'Bearer '+openAIKey);
  const rejected=await req('/api/models/'+connection.id,{cookie,method:'PUT',body:{...values,apiType:'anthropic',apiKey:''}});assert.equal(rejected.response.status,400);
  const state=created.data.state;state.modelId=connection.id;state.studies=[{id:'fixture-study',title:'Synthetic research',type:'Интервью',format:'TXT',status:'ready',summary:[],tags:[],report:'none',segments:[{id:'fixture-segment',time:0,speaker:'Participant',text:'Участник проверяет выбранные даты после сохранения.'}]}];
  app.db.prepare('UPDATE mnema_workspaces SET data=? WHERE id=?').run(JSON.stringify(state),'main');
  const answer=await req('/api/chat',{cookie,body:{question:'Как участник проверяет выбранные даты?',modelId:connection.id}});
  assert.equal(answer.response.status,200,JSON.stringify(answer.data));assert.equal(answer.data.answer,longAnswer);assert(answer.data.answer.length>16000);
  assert(calls.at(-1).body.input[0].content.includes('Как UX-исследователь'));assert.equal(calls.at(-1).body.store,false);
  const second=await req('/api/workspaces',{cookie,body:{name:'Second fixture'}});assert.equal(second.response.status,201);const workspace=second.data.id;
  assert.equal((await req('/api/models/'+connection.id,{cookie,workspace,method:'PUT',body:values})).response.status,404);
  assert.equal((await req('/api/models/catalog',{cookie,workspace,body:{connectionId:connection.id}})).response.status,404);
  const global=await req('/api/chat/global',{cookie,workspace,body:{question:'Как участник проверяет выбранные даты?'}});
  assert.equal(global.response.status,200,JSON.stringify(global.data));assert.equal(calls.at(-1).headers.get('Authorization'),'Bearer '+openAIKey);
  const claude=await req('/api/models',{cookie,workspace,body:{name:'Claude fixture',model:'claude-fixture',apiType:'anthropic',provider:'Claude',keySource:'api',apiKey:claudeKey}});
  assert.equal(claude.response.status,201,JSON.stringify(claude.data));const c=claude.data.state.models.find(m=>m.apiType==='anthropic');
  const tested=await req('/api/models/'+c.id+'/test',{cookie,workspace,body:{}});assert.equal(tested.response.status,200,JSON.stringify(tested.data));assert.equal(tested.data.answer,'Claude fixture OK');assert.equal(calls.at(-1).headers.get('Authorization'),'Bearer '+claudeKey);
  const invitation=await req('/api/invitations',{cookie,body:{email:'model-reader@example.com',name:'Reader',role:'view'}});
  const invite=new URLSearchParams(invitation.data.inviteURL.split('?').at(-1)).get('invite');const viewer=await req('/api/register',{body:{email:'model-reader@example.com',password:'fixture-reader-password',inviteToken:invite}});
  assert.equal(viewer.response.status,200,JSON.stringify(viewer.data));const viewerCookie=viewer.response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  const before=calls.length;
  assert.equal((await req('/api/models',{cookie:viewerCookie,body:values})).response.status,403);
  assert.equal((await req('/api/models/catalog',{cookie:viewerCookie,body:{connectionId:connection.id}})).response.status,403);assert.equal(calls.length,before);
  const latest=await req('/api/state',{cookie});
  const unsafe=await req('/api/state',{cookie,method:'PATCH',body:{version:latest.data.version,changes:{models:latest.data.state.models.map(m=>({...m,apiKey:'should-never-be-persisted'}))}}});assert.equal(unsafe.response.status,400);
  const deleted=await req('/api/state',{cookie,method:'PATCH',body:{version:latest.data.version,changes:{models:latest.data.state.models.filter(m=>m.id!==connection.id)}}});assert.equal(deleted.response.status,200,JSON.stringify(deleted.data));
  assert.equal(app.db.prepare('SELECT 1 FROM mnema_model_keys WHERE workspace_id=? AND model_id=?').get('main',connection.id),undefined);
 }finally{
  const closed=new Promise<void>(resolve=>app.server.once('close',resolve));app.server.closeAllConnections();app.close();await closed;await rm(dir,{recursive:true,force:true});
 }
});

test('built-in connection without a model or key can be removed; a configured one cannot',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mnemonika-builtin-')),setup=randomBytes(32).toString('hex');
 const app=await createMnemaServer({dataDir:dir,baseURL:'http://127.0.0.1:4198',authSecret:randomBytes(32).toString('hex'),setupToken:setup,
  providerFetch:async()=>Response.json({object:'list'})});
 await new Promise<void>(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+(app.server.address() as any).port;
 const req=async(path:string,{body,method,cookie=''}:{body?:any;method?:string;cookie?:string}={})=>{
  const response=await fetch(base+path,{method:method||(body===undefined?'GET':'POST'),headers:{'Content-Type':'application/json','X-Mnema-Request':'1',Origin:'http://127.0.0.1:4198','X-Mnema-Workspace':'main',...(cookie?{Cookie:cookie}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  return {response,data:await response.json()};
 };
 try{
  const owner=await req('/api/register',{body:{email:'builtin-owner@example.com',password:'fixture-owner-password',setupToken:setup}});
  const cookie=owner.response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  const created=await req('/api/models',{cookie,body:{name:'Amvera fixture',model:'deepseek-V4',url:'https://api.deepseek.com/v1',provider:'Совместимый API',keySource:'api',apiKey:'fixture-key-not-real'}});
  assert.equal(created.response.status,201,JSON.stringify(created.data));
  const list=await req('/api/models/catalog',{cookie,body:{url:'https://api.deepseek.com/v1',provider:'Совместимый API',keySource:'api',apiKey:'fixture-key-not-real'}});
  assert.equal(list.response.status,502,JSON.stringify(list.data));assert.match(list.data.error||'',/Указать ID вручную/);
  const state=(await req('/api/state',{cookie})).data;const builtin=state.state.models.find(m=>m.id==='deepseek');
  assert(builtin&&builtin.builtin&&!builtin.model,'fresh built-in DeepSeek has no model id');
  const removed=await req('/api/state',{cookie,method:'PATCH',body:{version:state.version,changes:{models:state.state.models.filter(m=>m.id!=='deepseek')}}});
  assert.equal(removed.response.status,200,JSON.stringify(removed.data));
  assert(!removed.data.state.models.some(m=>m.id==='deepseek'));
  assert.equal(removed.data.state.modelId,created.data.state.models.find(m=>m.name==='Amvera fixture').id);
 }finally{app.server.close();app.db.close();await rm(dir,{recursive:true,force:true})}
});

test('a configured built-in connection cannot be removed, only switched off',async()=>{
 const saved={preset:process.env.MNEMA_LLM_PRESET,key:process.env.LLM_KEY_DEEPSEEK};
 process.env.MNEMA_LLM_PRESET='amvera-deepseek-v4';process.env.LLM_KEY_DEEPSEEK='fixture-env-key-not-real';
 const dir=await mkdtemp(join(tmpdir(),'mnemonika-builtin-ready-')),setup=randomBytes(32).toString('hex');
 const app=await createMnemaServer({dataDir:dir,baseURL:'http://127.0.0.1:4198',authSecret:randomBytes(32).toString('hex'),setupToken:setup,providerFetch:async()=>Response.json({})});
 await new Promise<void>(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+(app.server.address() as any).port;
 const req=async(path:string,{body,method,cookie=''}:{body?:any;method?:string;cookie?:string}={})=>{
  const response=await fetch(base+path,{method:method||(body===undefined?'GET':'POST'),headers:{'Content-Type':'application/json','X-Mnema-Request':'1',Origin:'http://127.0.0.1:4198','X-Mnema-Workspace':'main',...(cookie?{Cookie:cookie}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  return {response,data:await response.json()};
 };
 try{
  const owner=await req('/api/register',{body:{email:'builtin-ready@example.com',password:'fixture-owner-password',setupToken:setup}});
  const cookie=owner.response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  const state=(await req('/api/state',{cookie})).data;const preset=state.state.models.find(m=>m.id==='amvera-deepseek-v4');
  assert(preset&&preset.builtin&&preset.keyConfigured&&preset.model,'Amvera preset is configured from the environment');
  const attempt=await req('/api/state',{cookie,method:'PATCH',body:{version:state.version,changes:{models:state.state.models.filter(m=>m.id!=='amvera-deepseek-v4')}}});
  assert.equal(attempt.response.status,400);assert.match(attempt.data.error,/можно выключить/);
 }finally{app.server.close();app.db.close();await rm(dir,{recursive:true,force:true});
  if(saved.preset===undefined)delete process.env.MNEMA_LLM_PRESET;else process.env.MNEMA_LLM_PRESET=saved.preset;
  if(saved.key===undefined)delete process.env.LLM_KEY_DEEPSEEK;else process.env.LLM_KEY_DEEPSEEK=saved.key}
});
