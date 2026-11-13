import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createMnemaServer} from './server.ts';

async function fixture(port:number){
 const dir=await mkdtemp(join(tmpdir(),'mnema-management-')),setup=randomBytes(32).toString('hex'),base='http://127.0.0.1:'+port;
 const options={dataDir:dir,baseURL:base,authSecret:randomBytes(48).toString('hex'),setupToken:setup,sendInvitationMail:async()=>{}};
 let app=await createMnemaServer(options);const listen=()=>new Promise<void>(r=>app.server.listen(port,'127.0.0.1',r));await listen();
 const stop=async()=>{app.notifications.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));app.storage.close();app.db.close()};
 const req=async(path:string,cookie='',body?:any,workspace='',method=body?'POST':'GET')=>{const res=await fetch(base+path,{method,headers:{Cookie:cookie,'Content-Type':'application/json','X-Mnema-Request':'1',...(workspace?{'X-Mnema-Workspace':workspace}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:res.status,data:await res.json(),cookie:res.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')}};
 const owner=await req('/api/register','',{email:'admin@example.test',password:'fixture-password-only',setupToken:setup});assert.equal(owner.status,200);
 const add=async(email:string,role='view',scope?:string,workspace='main')=>{const invited=await req('/api/invitations',owner.cookie,{name:email.split('@')[0],email,role,...(scope?{scope}:{})},workspace);assert.equal(invited.status,201,JSON.stringify(invited.data));const user=await req('/api/register','',{email,password:'fixture-password-only',inviteToken:new URL(invited.data.inviteURL).searchParams.get('invite')});assert.equal(user.status,200);return user};
 return {get app(){return app},req,owner:owner.cookie,add,restart:async()=>{await stop();app=await createMnemaServer(options);await listen()},close:async()=>{await stop();await rm(dir,{recursive:true,force:true})}};
}

test('global user directory is independent of the selected project; full members invite and configure, only admins revoke and assign admins',async()=>{
 const f=await fixture(4256),{req,owner}=f;
 try{
  const other=(await req('/api/workspaces',owner,{name:'Other'})).data.id;
  const full=await f.add('full@example.test','full'),reader=await f.add('reader@example.test'),scoped=await f.add('scoped@example.test','view','project',other);
  const fullSession=(await req('/api/session',full.cookie)).data.user,fullId=fullSession.id,readerId=(await req('/api/session',reader.cookie)).data.user.id;
  assert.equal(fullSession.owner,false);assert.equal(fullSession.manageUsers,true);assert.equal(fullSession.admin,true);assert.equal(fullSession.workspaces.length,2);
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
  const other=(await req('/api/workspaces',owner,{name:'Other'})).data.id;
  const oldReader=await f.add('old-reader@example.test','view','project');
  const legacy=await f.add('legacy@example.test','full','project'),revoked=await f.add('revoked@example.test','view','project');
  const revokedId=(await req('/api/session',revoked.cookie)).data.user.id;
  f.app.db.prepare('UPDATE mnema_access SET revoked=1 WHERE user_id=?').run(revokedId);f.app.db.prepare('UPDATE mnema_members SET revoked=1 WHERE user_id=?').run(revokedId);
  assert.equal((await req('/api/invitations',owner,{name:'Old pending',email:'old-pending@example.test',role:'view',scope:'project'},other)).status,201);
  f.app.db.prepare("DELETE FROM mnema_migrations WHERE name='all-existing-users-2026-11-13'").run();await f.restart();
  const user=(await req('/api/session',legacy.cookie)).data.user;assert.equal(user.workspaces.length,2);assert(user.workspaces.every(w=>w.role==='full'));assert.equal(user.owner,false);
  const migratedReader=(await req('/api/session',oldReader.cookie)).data.user;assert.equal(migratedReader.workspaces.length,2);assert(migratedReader.workspaces.every(w=>w.role==='view'));
  assert.equal((await req('/api/session',revoked.cookie)).data.user,null);assert.equal(f.app.db.prepare("SELECT workspace_id FROM mnema_invites WHERE email='old-pending@example.test'").get().workspace_id,'*');
  const future=(await req('/api/workspaces',owner,{name:'Future'})).data.id;assert.equal((await req('/api/session',legacy.cookie)).data.user.workspaces.length,3);
  const scoped=await f.add('new-scoped@example.test','view','project',future);assert.equal((await req('/api/session',scoped.cookie)).data.user.workspaces.length,1);
  await f.restart();assert.equal((await req('/api/session',scoped.cookie)).data.user.workspaces.length,1);assert.equal((await req('/api/state',scoped.cookie,undefined,other)).status,403);
 }finally{await f.close()}
});
