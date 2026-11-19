import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createMnemaServer} from './server.ts';

// End-to-end QA of research chats through the HTTP API: the cases users hit in production.
test('chat QA: team downgrade, closed uncited project, provider failures, races, validation, privacy and restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mnemonika-chat-qa-')),setup=randomBytes(32).toString('hex'),secret=randomBytes(32).toString('hex');
 let mode:'ok'|'slow'|'denied'|'overloaded'|'empty'='ok',calls=0;
 const providerFetch=async()=>{calls++;
  if(mode==='denied')return Response.json({error:'fixture'},{status:401});
  if(mode==='overloaded')return Response.json({error:'fixture'},{status:529});
  if(mode==='slow')await new Promise(r=>setTimeout(r,300));
  return Response.json({choices:[{finish_reason:'stop',message:{content:mode==='empty'?'':'Участник ждёт ответа хозяина [1].'}}],usage:{total_tokens:9}});
 };
 const start=async()=>{const app=await createMnemaServer({dataDir:dir,baseURL:'http://127.0.0.1:4199',authSecret:secret,setupToken:setup,providerFetch});await new Promise<void>(r=>app.server.listen(0,'127.0.0.1',r));return app};
 let app=await start();
 const req=async(path:string,{body,method,cookie='',workspace=''}:{body?:any;method?:string;cookie?:string;workspace?:string}={})=>{
  const response=await fetch('http://127.0.0.1:'+(app.server.address() as any).port+path,{method:method||(body===undefined?'GET':'POST'),headers:{'Content-Type':'application/json','X-Mnema-Request':'1',Origin:'http://127.0.0.1:4199',...(cookie?{Cookie:cookie}:{}),...(workspace?{'X-Mnema-Workspace':workspace}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  return {status:response.status,data:await response.json().catch(()=>null),response};
 };
 const login=(r:any)=>r.response.headers.getSetCookie().map((c:string)=>c.split(';')[0]).join('; ');
 const stop=async()=>{app.notifications?.close?.();app.server.closeAllConnections();await app.close?.()};
 try{
  const owner=await req('/api/register',{body:{email:'qa-owner@example.com',password:'fixture-owner-password',setupToken:setup}});assert.equal(owner.status,200);const ownerCookie=login(owner);
  const model=await req('/api/models',{cookie:ownerCookie,body:{name:'QA',model:'qa-model',apiType:'compatible',url:'https://api.deepseek.com/v1',provider:'Fixture',keySource:'api',apiKey:'fixture-key-not-real-qa'}});assert.equal(model.status,201,JSON.stringify(model.data));
  const st=(await req('/api/state',{cookie:ownerCookie})).data;
  await req('/api/state',{cookie:ownerCookie,method:'PATCH',body:{version:st.version,changes:{modelId:model.data.state.models.find((m:any)=>m.model==='qa-model').id}}});
  const seed=(id:string,text:string)=>{const raw=JSON.parse(String(app.db.prepare('SELECT data FROM mnema_workspaces WHERE id=?').get(id).data));raw.studies=[{id:'s-'+id,title:'Интервью',type:'Интервью',format:'TXT',date:'2026-11-19',status:'ready',tags:[],summary:[],segments:[{id:'g-'+id,time:0,speaker:'Участник',text}]}];app.db.prepare('UPDATE mnema_workspaces SET data=? WHERE id=?').run(JSON.stringify(raw),id)};
  seed('main','Я ждал ответа хозяина перед оплатой бронирования.');
  const closed=(await req('/api/workspaces',{cookie:ownerCookie,body:{name:'Закрытый',mode:'private'}})).data.id;seed(closed,'Отдельная тема про налоги и документы.');

  // A full member of the team project, also invited into a private project.
  const inv=await req('/api/invitations',{cookie:ownerCookie,body:{email:'qa-member@example.com',name:'Тимур',role:'full'}});
  const member=await req('/api/register',{body:{email:'qa-member@example.com',password:'fixture-member-password',inviteToken:new URL(inv.data.inviteURL).searchParams.get('invite')}});assert.equal(member.status,200,JSON.stringify(member.data));const cookie=login(member);
  const memberId=app.db.prepare("SELECT id FROM user WHERE email='qa-member@example.com'").get().id;
  app.db.prepare("INSERT OR REPLACE INTO mnema_members(workspace_id,user_id,role,admin,revoked,grant_source) VALUES(?,?,'full',0,0,'explicit')").run(closed,memberId);

  // Unauthenticated and validation.
  assert.equal((await req('/api/chats')).status,401);
  assert.equal((await req('/api/chat/global',{body:{question:'Привет'}})).status,401);
  const chat=(await req('/api/chats',{cookie,body:{}})).data;assert(chat.id);
  assert.equal((await req('/api/chat/global',{cookie,body:{chatId:chat.id,question:'   '}})).status,400,'empty question');
  assert.equal((await req('/api/chats',{cookie,body:{projectId:'foreign-project'}})).status,404,'foreign project');

  // Happy path: answer, history, title.
  let r=await req('/api/chat/global',{cookie,body:{chatId:chat.id,question:'Почему участник ждёт ответа хозяина?'}});
  assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.chat.messages.length,2);assert(r.data.sources.length>0);
  r=await req('/api/chat/global',{cookie,body:{chatId:chat.id,question:'Расскажи подробнее'}});assert.equal(r.data.chat.messages.length,4);
  assert.equal((await req('/api/chats',{cookie})).data.chats[0].title,'Почему участник ждёт ответа хозяина?');

  // Provider failures do not leave half-saved messages.
  for(const failure of ['denied','overloaded','empty'] as const){mode=failure;
   r=await req('/api/chat/global',{cookie,body:{chatId:chat.id,question:'Вопрос при сбое '+failure}});
   assert.notEqual(r.status,200,failure);assert(typeof r.data?.error==='string'&&r.data.error.length>0,failure+': user-facing message');
   assert.equal((await req('/api/chats/'+chat.id,{cookie})).data.messages.length,4,failure+': nothing appended');
  }
  mode='ok';

  // Two questions at once in one chat: one answers, the other is refused, history stays consistent.
  mode='slow';
  const [a,b]=await Promise.all([req('/api/chat/global',{cookie,body:{chatId:chat.id,question:'Первый параллельный'}}),req('/api/chat/global',{cookie,body:{chatId:chat.id,question:'Второй параллельный'}})]);
  mode='ok';
  assert.deepEqual([a.status,b.status].sort(),[200,409]);assert.equal((await req('/api/chats/'+chat.id,{cookie})).data.messages.length,6);

  // Privacy: another user cannot read, continue or delete the chat, and no model call is made.
  const before=calls;
  assert.equal((await req('/api/chats/'+chat.id,{cookie:ownerCookie})).status,404);
  assert.equal((await req('/api/chat/global',{cookie:ownerCookie,body:{chatId:chat.id,question:'Чужой чат'}})).status,404);
  assert.equal((await req('/api/chats/'+chat.id,{cookie:ownerCookie,method:'DELETE'})).status,404);
  assert.equal(calls,before,'no model call for a foreign chat');

  // Production regression 19.11: team project downgraded to view, and an uncited private project closed.
  app.db.prepare("UPDATE mnema_project_sharing SET mode='all' WHERE workspace_id='main'").run();
  app.db.prepare("UPDATE mnema_members SET grant_source='all' WHERE workspace_id='main' AND user_id=?").run(memberId);
  app.db.prepare('UPDATE mnema_members SET revoked=1 WHERE workspace_id=? AND user_id=?').run(closed,memberId);
  assert.deepEqual((await req('/api/chats',{cookie})).data.chats.map((c:any)=>c.id),[chat.id],'chat stays in the list');
  assert.equal((await req('/api/chats/'+chat.id,{cookie})).data.messages.length,6,'chat opens');
  r=await req('/api/chat/global',{cookie,body:{chatId:chat.id,question:'Продолжим после смены роли'}});assert.equal(r.status,200,JSON.stringify(r.data));

  // An edited cited fragment hides the chat with a clear reason; a new chat still works.
  seed('main','Текст фрагмента изменён после ответа.');
  assert.equal((await req('/api/chats',{cookie})).data.chats.length,0);
  r=await req('/api/chats/'+chat.id,{cookie});assert.equal(r.status,409);assert.match(r.data.error,/Источники|доступ/);
  const fresh=(await req('/api/chats',{cookie,body:{}})).data;assert.equal((await req('/api/chat/global',{cookie,body:{chatId:fresh.id,question:'Что изменилось во фрагменте?'}})).status,200);

  // Restart keeps chats.
  await stop();app=await start();
  assert.deepEqual((await req('/api/chats',{cookie})).data.chats.map((c:any)=>c.id),[fresh.id]);
  assert.equal((await req('/api/chats/'+fresh.id,{cookie})).data.messages.length,2);

  // Deleting a chat leaves research intact.
  assert.equal((await req('/api/chats/'+fresh.id,{cookie,method:'DELETE'})).status,200);
  assert.equal((await req('/api/chats/'+fresh.id,{cookie})).status,404);
  assert.equal(JSON.parse(String(app.db.prepare("SELECT data FROM mnema_workspaces WHERE id='main'").get().data)).studies.length,1);
 }finally{await stop();await rm(dir,{recursive:true,force:true})}
});
