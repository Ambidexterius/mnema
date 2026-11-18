import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createMnemaServer} from './server.ts';

async function fixture(port:number,corporateRegistration=false){
 const dir=await mkdtemp(join(tmpdir(),'mnema-management-')),setup=randomBytes(32).toString('hex'),base='http://127.0.0.1:'+port;
 const options={dataDir:dir,baseURL:base,authSecret:randomBytes(48).toString('hex'),setupToken:setup,corporateRegistration,sendInvitationMail:async()=>{},sendRegistrationMail:async()=>{},registrationCode:()=> '685791' };
 let app=await createMnemaServer(options);const listen=()=>new Promise<void>(r=>app.server.listen(port,'127.0.0.1',r));await listen();
 const stop=async()=>{app.notifications.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));app.storage.close();app.db.close()};
 const req=async(path:string,cookie='',body?:any,workspace='',method=body?'POST':'GET')=>{const res=await fetch(base+path,{method,headers:{Cookie:cookie,Connection:'close','Content-Type':'application/json','X-Mnema-Request':'1',...(workspace?{'X-Mnema-Workspace':workspace}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:res.status,data:await res.json(),cookie:res.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')}};
 const owner=await req('/api/register','',{email:'admin@example.test',password:'fixture-password-only',setupToken:setup});assert.equal(owner.status,200);
 const add=async(email:string,role='view',scope?:string,workspace='main')=>{const invited=await req('/api/invitations',owner.cookie,{name:email.split('@')[0],email,role,...(scope?{scope}:{})},workspace);assert.equal(invited.status,201,JSON.stringify(invited.data));const user=await req('/api/register','',{email,password:'fixture-password-only',inviteToken:new URL(invited.data.inviteURL).searchParams.get('invite')});assert.equal(user.status,200);return user};
 return {get app(){return app},req,owner:owner.cookie,add,restart:async()=>{await stop();app=await createMnemaServer(options);await listen()},close:async()=>{await stop();await rm(dir,{recursive:true,force:true})}};
}

test('global user directory is independent of the selected project; full members invite and configure, only admins revoke and assign admins',async()=>{
 const f=await fixture(4256),{req,owner}=f;
 try{
  const other=(await req('/api/workspaces',owner,{name:'Other',mode:'private'})).data.id;
  const full=await f.add('full@example.test','full'),reader=await f.add('reader@example.test'),scoped=await f.add('scoped@example.test','view','project',other);
  const fullSession=(await req('/api/session',full.cookie)).data.user,fullId=fullSession.id,readerId=(await req('/api/session',reader.cookie)).data.user.id;
  assert.equal(fullSession.owner,false);assert.equal(fullSession.manageUsers,true);assert.equal(fullSession.admin,true);assert.deepEqual(fullSession.workspaces.map(w=>w.id),['main']);
  f.app.db.prepare('INSERT INTO mnema_invites(id,token_hash,email,name,role,expires,used,revoked,workspace_id) VALUES(?,?,?,?,?,?,0,0,?)').run('superseded','superseded-fixture-hash','full@example.test','Old invitation','full',Date.now()+86400000,'*');
  const directory=(await req('/api/users',owner)).data.users;assert.equal(directory.length,4);assert(directory.some(u=>u.email==='scoped@example.test'));
  for(const workspace of ['main',other])assert.deepEqual((await req('/api/state',owner,undefined,workspace)).data.state.users,directory);
  assert.equal((await req('/api/users',full.cookie)).status,200);assert.equal((await req('/api/users',reader.cookie)).status,403);assert.equal((await req('/api/users',scoped.cookie)).status,403);
  const state=(await req('/api/state',full.cookie,undefined,'main')).data;
  assert.equal((await req('/api/state',full.cookie,{version:state.version,changes:{modelId:state.state.modelId}},'main','PATCH')).status,200);
  assert.equal((await req('/api/storage',full.cookie)).status,200);
  const invited=await req('/api/invitations',full.cookie,{name:'By full',email:'by-full@example.test',role:'view'},'main');assert.equal(invited.status,201);assert.equal(f.app.db.prepare("SELECT workspace_id FROM mnema_invites WHERE email='by-full@example.test'").get().workspace_id,'*');
  assert.equal((await req('/api/users/'+readerId,full.cookie,{role:'full'},'main','PATCH')).status,200);
  assert.equal((await req('/api/users/'+readerId,full.cookie,{status:'revoked'},'main','PATCH')).status,403);
  assert.equal((await req('/api/users/'+readerId,full.cookie,{admin:true},'main','PATCH')).status,403);
  assert.equal((await req('/api/users/'+fullId,owner,{admin:'true'},'main','PATCH')).status,400);
  assert.equal((await req('/api/users/'+fullId,owner,{admin:true},'main','PATCH')).status,200);
  assert.equal((await req('/api/session',full.cookie)).data.user.owner,true);
  assert.equal((await req('/api/users/'+fullId,full.cookie,{admin:false},'main','PATCH')).status,403,'self-demotion stays blocked');
  assert.equal((await req('/api/users/'+readerId,full.cookie,{status:'revoked'},'main','PATCH')).status,200);
  assert.equal((await req('/api/session',reader.cookie)).data.user,null);
  assert.equal((await req('/api/users/'+fullId,owner,{admin:false},'main','PATCH')).status,200);
  const demoted=(await req('/api/session',full.cookie)).data.user;assert.equal(demoted.owner,false);assert.equal(demoted.manageUsers,true);
  assert.equal((await req('/api/users/'+readerId,full.cookie,{status:'active'},'main','PATCH')).status,403);
 }finally{await f.close()}
});

test('one-time migration opens all projects for old active accounts and invitations, preserving roles, revocation and later explicit restrictions',async()=>{
 const f=await fixture(4257),{req,owner}=f;
 try{
  const other=(await req('/api/workspaces',owner,{name:'Other',mode:'private'})).data.id;
  // This fixture predates private-by-default creation.
  f.app.db.prepare("UPDATE mnema_project_sharing SET mode='legacy' WHERE workspace_id=?").run(other);
  const oldReader=await f.add('old-reader@example.test','view','project');
  const legacy=await f.add('legacy@example.test','full','project'),revoked=await f.add('revoked@example.test','view','project');
  const revokedId=(await req('/api/session',revoked.cookie)).data.user.id;
  f.app.db.prepare('UPDATE mnema_access SET revoked=1 WHERE user_id=?').run(revokedId);f.app.db.prepare('UPDATE mnema_members SET revoked=1 WHERE user_id=?').run(revokedId);
  assert.equal((await req('/api/invitations',owner,{name:'Old pending',email:'old-pending@example.test',role:'view',scope:'project'},other)).status,201);
  f.app.db.prepare("DELETE FROM mnema_migrations WHERE name='all-existing-users-2026-11-13'").run();await f.restart();
  const user=(await req('/api/session',legacy.cookie)).data.user;assert.equal(user.workspaces.length,2);assert(user.workspaces.every(w=>w.role==='full'));assert.equal(user.owner,false);
  const migratedReader=(await req('/api/session',oldReader.cookie)).data.user;assert.equal(migratedReader.workspaces.length,2);assert(migratedReader.workspaces.every(w=>w.role==='view'));
  assert.equal((await req('/api/session',revoked.cookie)).data.user,null);assert.equal(f.app.db.prepare("SELECT workspace_id FROM mnema_invites WHERE email='old-pending@example.test'").get().workspace_id,'*');
  const future=(await req('/api/workspaces',owner,{name:'Future',mode:'private'})).data.id;assert.deepEqual((await req('/api/session',legacy.cookie)).data.user.workspaces.map(w=>w.id).sort(),['main',other].sort());
  const scoped=await f.add('new-scoped@example.test','view','project',future);assert.equal((await req('/api/session',scoped.cookie)).data.user.workspaces.length,1);
  await f.restart();assert.equal((await req('/api/session',scoped.cookie)).data.user.workspaces.length,1);assert.equal((await req('/api/state',scoped.cookie,undefined,other)).status,403);
 }finally{await f.close()}
});

test('only admins remove other accounts and unused invitations without removing project content',async()=>{
 const f=await fixture(4258,true),{req,owner}=f;
 try{
  const full=await f.add('full@example.test','full'),reader=await f.add('removed@sutochno.ru');
  const id=(await req('/api/session',reader.cookie)).data.user.id;
  const ownerId=(await req('/api/session',owner)).data.user.id;
  const target='/api/users/'+id;
  assert.equal((await req(target,full.cookie,undefined,'','DELETE')).status,403);
  assert.equal((await req('/api/users/'+ownerId,owner,undefined,'','DELETE')).status,403);
  f.app.db.prepare("UPDATE mnema_project_sharing SET owner_id=? WHERE workspace_id='main'").run(id);
  assert.equal((await req(target,owner,undefined,'','DELETE')).status,409);
  f.app.db.prepare("UPDATE mnema_project_sharing SET owner_id=? WHERE workspace_id='main'").run(ownerId);
  assert.equal((await req(target,owner,{status:'revoked'},'main','PATCH')).status,200);
  assert.equal((await req('/api/session',reader.cookie)).data.user,null);
  const project=f.app.db.prepare("SELECT data FROM mnema_workspaces WHERE id='main'").get().data;
  const removed=await req(target,owner,undefined,'','DELETE');
  assert.equal(removed.status,200);assert.equal(removed.data.users.some(u=>u.id===id||u.email==='removed@sutochno.ru'),false);
  assert.equal((await req('/api/state',reader.cookie)).status,401);
  assert.equal((await req('/api/auth/sign-in/email','',{email:'removed@sutochno.ru',password:'fixture-password-only'})).status,401);
  assert.equal(f.app.db.prepare('SELECT count(*) AS count FROM session WHERE userId=?').get(id).count,0);
  assert.equal(f.app.db.prepare('SELECT count(*) AS count FROM mnema_removed_emails').get().count,1);
  assert.equal(f.app.db.prepare("SELECT data FROM mnema_workspaces WHERE id='main'").get().data,project);
  assert.equal((await req(target,owner,undefined,'','DELETE')).status,200);

  const pendingEmail='pending@example.test';
  const makeInvite=()=>req('/api/invitations',owner,{email:pendingEmail,name:'Pending',role:'view'});
  const old=await makeInvite();assert.equal(old.status,201);
  const first=(await req('/api/users',owner)).data.users.find(u=>u.email===pendingEmail);
  assert.equal((await req('/api/users/'+first.id,owner,{status:'revoked'},'main','PATCH')).status,200);
  const newInvite=await makeInvite();assert.equal(newInvite.status,201);
  const current=(await req('/api/users',owner)).data.users.find(u=>u.email===pendingEmail);
  const result=await req('/api/users/'+current.id,owner,undefined,'','DELETE');
  assert.equal(result.status,200);
  assert.equal(result.data.users.some(u=>u.email===pendingEmail),false);
  for(const invite of [old,newInvite]){
   const inviteToken=new URL(invite.data.inviteURL).searchParams.get('invite');
   assert.equal((await req('/api/register','',{email:pendingEmail,password:'fixture-password-only',inviteToken})).status,403);
  }
  const workEmail='removed@sutochno.ru';
  const mail=await req('/api/registration/request-code','',{email:workEmail});
  assert.equal(mail.status,200);
  const verified=await req('/api/registration/verify-code',mail.cookie,{email:workEmail,code:'685791'});
  assert.equal(verified.status,200);
  const selfRegistration=await req('/api/register',verified.cookie,{email:workEmail,password:'new-fixture-password',firstName:'Test',lastName:'User'});
  assert.equal(selfRegistration.status,403);
  assert.match(selfRegistration.data.error,/новое приглашение/u);
  assert.equal((await f.add('removed@sutochno.ru')).status,200,'a new invitation can bring a deleted user back as a new account');
  assert.notEqual(f.app.db.prepare("SELECT id FROM user WHERE email='removed@sutochno.ru'").get().id,id);
 }finally{await f.close()}
});
