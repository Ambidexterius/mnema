import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createMnemaServer} from './server.ts';

// Disposable accounts exercise the real API; the provider never leaves this process.
test('private projects, named members and authenticated share links cannot leak through adjacent APIs',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mnema-private-access-')),base='http://127.0.0.1:4266',setup=randomBytes(32).toString('hex'),previous=process.env.LLM_KEY_CUSTOM2,previousOrigin=process.env.MNEMA_IMPORT_SOURCE_ORIGIN;
 process.env.LLM_KEY_CUSTOM2='synthetic-sharing-test-key';process.env.MNEMA_IMPORT_SOURCE_ORIGIN='https://source.example.test';let sentToModel='',duringCall=()=>{};
 const options={dataDir:dir,baseURL:base,setupToken:setup,authSecret:randomBytes(48).toString('hex'),sendInvitationMail:async()=>{},sendCompletionMail:async()=>{},providerFetch:async(_url,options)=>{sentToModel=String(options.body);duringCall();return new Response(JSON.stringify({choices:[{message:{content:'Синтетический ответ [1].'}}],usage:{total_tokens:12}}),{headers:{'Content-Type':'application/json'}})}};let app=await createMnemaServer(options);
 await new Promise<void>(r=>app.server.listen(4266,'127.0.0.1',r));
 const admin=new Map<string,string>(),creator=new Map<string,string>(),viewer=new Map<string,string>(),anonymous=new Map<string,string>();
 const req=async(path:string,jar=admin,body?:any,workspace='',method=body===undefined?'GET':'POST')=>{
  const response=await fetch(base+path,{method,headers:{Cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),Origin:base,'X-Mnema-Request':'1','Content-Type':'application/json',...(workspace?{'X-Mnema-Workspace':workspace}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  for(const cookie of response.headers.getSetCookie()){const pair=cookie.split(';')[0],i=pair.indexOf('='),key=pair.slice(0,i),value=pair.slice(i+1);if(value)jar.set(key,value);else jar.delete(key)}
  const text=await response.text();let data:any;try{data=JSON.parse(text)}catch{data=text}return {status:response.status,data,headers:response.headers};
 };
 const register=async(email:string,jar:Map<string,string>,inviteToken?:string)=>{const result=await req('/api/register',jar,{email,password:'fixture-private-password',...(inviteToken?{inviteToken}:{setupToken:setup})});assert.equal(result.status,200,JSON.stringify(result.data));return (await req('/api/session',jar)).data.user};
 const inviteAccount=async(email:string,jar:Map<string,string>,role:string,scope:string)=>{const invite=await req('/api/invitations',admin,{name:email,email,role,scope},'main');assert.equal(invite.status,201,JSON.stringify(invite.data));return register(email,jar,new URL(invite.data.inviteURL).searchParams.get('invite')!)};
 const seed=async(id:string,secret:boolean)=>{const row=app.db.prepare('SELECT data FROM mnema_workspaces WHERE id=?').get(id) as any,raw=JSON.parse(row.data),fileId=secret?'private-file':'public-file';
  raw.studies=[{id:secret?'private-study':'public-study',title:secret?'Секретный материал private-marker':'Общий материал',fileId,fileName:fileId+'.txt',status:'ready',type:'Интервью',format:'TXT',date:'2026-11-18',tags:[],summary:[],segments:[{id:'part',time:0,speaker:'Участник',text:secret?'Private-marker: участник ждёт ответа хозяина перед оплатой.':'Участник выбирает даты отпуска.'}]}];
  raw.findings=[{id:secret?'private-finding':'public-finding',studyId:raw.studies[0].id,segmentId:'part',title:secret?'Private-marker finding':'Выбирает даты',status:'verified',kind:'Проблема',importance:'Высокая',origin:'human',history:[]}];raw.models=[{id:'fixture',name:'Fixture',model:'fixture',provider:'Совместимый API',url:'https://api.openai.com/v1',keyRef:'LLM_KEY_CUSTOM2',enabled:true}];raw.modelId='fixture';app.db.prepare('UPDATE mnema_workspaces SET data=? WHERE id=?').run(JSON.stringify(raw),id);await writeFile(join(dir,'uploads',fileId),'Synthetic source');app.db.prepare('INSERT INTO mnema_uploads VALUES(?,?,?,?,?)').run(fileId,fileId+'.txt','text/plain',16,'ready');
 };
 try{
  await register('admin-sharing@example.test',admin);const author=await inviteAccount('author-sharing@example.test',creator,'full','project'),reader=await inviteAccount('reader-sharing@example.test',viewer,'view','all');await seed('main',false);
  const openProject=await req('/api/workspaces',creator,{name:'Open by default'});assert.equal(openProject.status,201);assert.equal((await req('/api/workspaces/'+openProject.data.id+'/sharing',creator)).data.mode,'all');
  const imported=await req('/api/imports/source/project',creator,{url:'https://source.example.test/studies/open',name:'Imported open by default'},'main');assert.equal(imported.status,201,JSON.stringify(imported.data));assert.equal((await req('/api/workspaces/'+imported.data.id+'/sharing',creator)).data.mode,'all');
  for(const projectId of [openProject.data.id,imported.data.id]){const state=await req('/api/state',viewer,undefined,projectId);assert.equal(state.status,200);assert.equal(state.data.user.role,'view');assert.equal(state.data.state.workspace.canManageSharing,false);assert.equal((await req('/api/state',viewer,{changes:{models:[]}},projectId,'PATCH')).status,403)}
  const made=await req('/api/workspaces',creator,{name:'Private-marker project',mode:'private'});assert.equal(made.status,201,JSON.stringify(made.data));const id=made.data.id,sharing='/api/workspaces/'+id+'/sharing';await seed(id,true);
  const details=await req(sharing,creator);assert.equal(details.status,200);assert.equal(details.data.mode,'private');assert.equal(details.data.owner.id,author.id);assert.deepEqual(details.data.members,[]);
  for(const jar of [admin,viewer]){
   assert.equal((await req('/api/state',jar,undefined,id)).status,403,'global administrators and all-project accounts are not private members');
   assert.ok(!(await req('/api/session',jar)).data.user.workspaces.some(w=>w.id===id));
   const library=await req('/api/research-library',jar);assert.equal(library.status,200);assert.doesNotMatch(JSON.stringify(library.data),/private-marker|Private-marker/);
   const mcp=await req('/api/mcp/settings',jar);assert.equal(mcp.status,200);assert.ok(!mcp.data.projects.some(p=>p.id===id));
  }
  assert.equal((await req(sharing,admin)).status,403);assert.equal((await req(sharing,viewer,{mode:'all'},'','PATCH')).status,403);
  const directory=await req('/api/users',admin);assert.equal(directory.status,200);assert.doesNotMatch(JSON.stringify(directory.data),/Private-marker project|private-finding/);
  assert.equal((await req('/api/files/private-file?workspace='+id,viewer)).status,403);
  assert.equal((await req('/api/chats',viewer,{projectId:id})).status,404);
  assert.equal((await req('/api/mcp/tokens',viewer,{name:'No private permission',projects:[id]})).status,403);

  const named=await req(sharing+'/members',creator,{email:'reader-sharing@example.test',role:'full'});assert.equal(named.status,201,JSON.stringify(named.data));assert.equal(named.data.added,true);
  let state=await req('/api/state',viewer,undefined,id);assert.equal(state.status,200);assert.equal(state.data.user.role,'full');assert.equal(state.data.state.workspace.canManageSharing,false);
  assert.equal((await req(sharing,viewer,{mode:'all'},'','PATCH')).status,403,'full editing does not grant sharing ownership');
  assert.equal((await req(sharing+'/members/'+author.id,creator,undefined,'','DELETE')).status,403,'the owner cannot be removed');
  assert.equal((await req(sharing+'/members/'+reader.id,creator,{role:'view'},'','PATCH')).status,200);assert.equal((await req('/api/state',viewer,undefined,id)).data.user.role,'view');
  assert.equal((await req('/api/state',viewer,{changes:{models:[]}},id,'PATCH')).status,403);
  assert.equal((await req(sharing+'/members/'+reader.id,creator,undefined,'','DELETE')).status,200);assert.equal((await req('/api/state',viewer,undefined,id)).status,403);

  const pending=await req(sharing+'/members',creator,{email:'pending-sharing@example.test',role:'view'});assert.equal(pending.status,201);const inviteToken=new URL(pending.data.inviteURL).searchParams.get('invite');assert.ok(inviteToken);assert.ok(pending.data.members.some(m=>m.email==='pending-sharing@example.test'&&m.status==='invited'));
  const pendingJar=new Map<string,string>();assert.equal((await req('/api/register',pendingJar,{email:'wrong-sharing@example.test',password:'fixture-private-password',inviteToken})).status,403);
  const accepted=await req('/api/register',pendingJar,{email:'pending-sharing@example.test',password:'fixture-private-password',inviteToken,role:'full',admin:true});assert.equal(accepted.status,200);const pendingPerson=(await req('/api/session',pendingJar)).data.user;assert.deepEqual(new Set(pendingPerson.workspaces.map(w=>w.id)),new Set([id,openProject.data.id,imported.data.id]));assert.equal(pendingPerson.workspaces.find(w=>w.id===id).role,'view');assert.equal(pendingPerson.role,'view');assert.equal(pendingPerson.owner,false);
  assert.equal((await req(sharing+'/members/'+pendingPerson.id,creator,undefined,'','DELETE')).status,200);assert.equal((await req('/api/state',pendingJar,undefined,id)).status,403);

  const linked=await req(sharing,creator,{mode:'link'},'','PATCH');assert.equal(linked.status,200);const token=new URL(linked.data.link.url).searchParams.get('share');assert.ok(token);
  assert.equal((await req('/api/workspaces/'+id+'/share',anonymous,{token})).status,401);assert.equal((await req('/api/workspaces/'+id+'/share',viewer,{token:'invalid'})).status,403);
  const redeemed=await req('/api/workspaces/'+id+'/share',viewer,{token});assert.equal(redeemed.status,200,JSON.stringify(redeemed.data));assert.match(redeemed.headers.get('set-cookie')||'',/mnema_share_[^=]+=[^;]+; Path=\/api; HttpOnly; SameSite=Lax/);
  assert.equal(app.db.prepare('SELECT revoked FROM mnema_members WHERE workspace_id=? AND user_id=?').get(id,reader.id).revoked,1,'redeeming a link does not restore or create named membership');
  state=await req('/api/state',viewer,undefined,id);assert.equal(state.status,200);assert.equal(state.data.user.role,'view');assert.equal(state.data.state.workspace.canManageSharing,false);assert.equal(state.data.state.studies.length,1);
  assert.ok(!(await req('/api/session',viewer)).data.user.workspaces.some(w=>w.id===id));assert.doesNotMatch(JSON.stringify((await req('/api/research-library',viewer)).data),/Private-marker/);
  assert.equal((await req('/api/files/private-file?workspace='+id,viewer)).status,200);assert.equal((await req('/api/mcp/tokens',viewer,{name:'No durable link export',projects:[id]},id)).status,403);
  const chat=await req('/api/chats',viewer,{projectId:id},id);assert.equal(chat.status,201,JSON.stringify(chat.data));
  const answer=await req('/api/chat/global',viewer,{chatId:chat.data.id,question:'Почему участник ждёт ответа хозяина перед оплатой?'},id);assert.equal(answer.status,200,JSON.stringify(answer.data));assert.match(sentToModel,/Private-marker/);const feedbackToken=answer.data.chat.messages.at(-1).feedbackToken;assert.ok(feedbackToken);
  assert.equal((await req('/api/chat/feedback',viewer,{token:feedbackToken,rating:'up'},id)).status,200);
  assert.doesNotMatch(JSON.stringify((await req('/api/chat/feedback',admin)).data),/Private-marker|private-study|private-finding/,'admin ratings cannot reveal private answers');
  assert.equal((await req('/api/chats/'+chat.data.id,viewer,undefined,id)).status,200);
  assert.equal((await req(sharing+'/link/rotate',creator,{})).status,200);
  assert.equal((await req('/api/state',viewer,undefined,id)).status,403);assert.equal((await req('/api/files/private-file?workspace='+id,viewer)).status,403);assert.equal((await req('/api/chat/feedback',viewer,{token:feedbackToken,rating:'down'},id)).status,403);
  assert.ok(!(await req('/api/chats',viewer)).data.chats.some(c=>c.id===chat.data.id),'old private history disappears after link rotation');
  assert.equal((await req('/api/workspaces/'+id+'/share',viewer,{token})).status,403,'old links cannot recreate access');

  const freshLink=(await req(sharing,creator)).data.link.url,freshToken=new URL(freshLink).searchParams.get('share');assert.equal((await req('/api/workspaces/'+id+'/share',viewer,{token:freshToken})).status,200);
  const inFlight=await req('/api/chats',viewer,{projectId:id},id);assert.equal(inFlight.status,201);duringCall=()=>{app.db.prepare('UPDATE mnema_project_sharing SET nonce=? WHERE workspace_id=?').run(randomBytes(32).toString('hex'),id)};
  const raced=await req('/api/chat/global',viewer,{chatId:inFlight.data.id,question:'Почему участник ждёт ответа перед оплатой?'},id);assert.ok([403,409].includes(raced.status),JSON.stringify(raced.data));assert.equal(raced.data.answer,undefined);assert.equal(raced.data.chat,undefined);assert.ok(!JSON.parse(String(app.db.prepare('SELECT messages FROM mnema_chats WHERE id=?').get(inFlight.data.id).messages)).some(m=>m.role==='assistant'),'a revoked generation must not enter saved history');duringCall=()=>{};

  const publicMode=await req(sharing,creator,{mode:'all'},'','PATCH');assert.equal(publicMode.status,200);assert.equal((await req('/api/state',viewer,undefined,id)).status,200);assert.equal((await req('/api/state',viewer,undefined,id)).data.user.role,'view');assert.ok((await req('/api/session',viewer)).data.user.workspaces.some(w=>w.id===id));
  assert.equal((await req(sharing,creator,{mode:'private'},'','PATCH')).status,200);assert.equal((await req('/api/state',viewer,undefined,id)).status,403);
  assert.equal((await req('/api/workspaces',creator,{name:'Invalid mode',mode:'public-internet'})).status,400);
  const beforeBan=await req(sharing,creator,{mode:'link'},'','PATCH'),beforeBanToken=new URL(beforeBan.data.link.url).searchParams.get('share');assert.equal((await req('/api/workspaces/'+id+'/share',pendingJar,{token:beforeBanToken})).status,200);assert.equal((await req('/api/state',pendingJar,undefined,id)).status,200);
  assert.equal((await req('/api/users/'+pendingPerson.id,admin,{status:'revoked'},'','PATCH')).status,200);assert.equal((await req('/api/session',pendingJar)).data.user,null);assert.equal((await req('/api/workspaces/'+id+'/share',pendingJar,{token:beforeBanToken})).status,401);assert.equal((await req('/api/files/private-file?workspace='+id,pendingJar)).status,401,'globally disabled scoped accounts cannot keep a live share cookie');
  assert.equal((await req('/api/users/'+pendingPerson.id,admin,{status:'active'},'','PATCH')).status,200);assert.deepEqual(new Set((await req('/api/session',pendingJar)).data.user.workspaces.map(w=>w.id)),new Set([openProject.data.id,imported.data.id]),'restoring a scoped account exposes default-open projects but does not silently restore private membership');
  assert.equal((await req(sharing,creator,{mode:'private'},'','PATCH')).status,200);const persistentLink=await req('/api/workspaces',creator,{name:'Explicit link survives restart',mode:'link'});assert.equal(persistentLink.status,201);
  app.notifications.close();app.server.closeAllConnections();await new Promise<void>(r=>app.server.close(()=>r()));app.storage.close();app.db.close();app=await createMnemaServer(options);await new Promise<void>(r=>app.server.listen(4266,'127.0.0.1',r));
  assert.equal((await req(sharing,creator)).data.mode,'private');assert.equal((await req('/api/workspaces/'+persistentLink.data.id+'/sharing',creator)).data.mode,'link');assert.equal((await req('/api/state',viewer,undefined,id)).status,403);assert.equal((await req('/api/state',viewer,undefined,persistentLink.data.id)).status,403);assert.equal((await req('/api/state',viewer,undefined,openProject.data.id)).data.user.role,'view');
 }finally{if(previous===undefined)delete process.env.LLM_KEY_CUSTOM2;else process.env.LLM_KEY_CUSTOM2=previous;if(previousOrigin===undefined)delete process.env.MNEMA_IMPORT_SOURCE_ORIGIN;else process.env.MNEMA_IMPORT_SOURCE_ORIGIN=previousOrigin;app.notifications.close();app.server.closeAllConnections();await new Promise<void>(r=>app.server.close(()=>r()));app.storage.close();app.db.close();await rm(dir,{recursive:true,force:true})}
});
