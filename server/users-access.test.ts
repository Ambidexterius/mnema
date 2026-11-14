import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createMnemaServer} from './server.ts';

test('invitation status and all-project access cover registration, expiry, future projects, roles and revocation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mnema-users-')),setup=randomBytes(32).toString('hex'),base='http://127.0.0.1:4254';
 const mails:any[]=[];
 const app=await createMnemaServer({dataDir:dir,baseURL:base,setupToken:setup,authSecret:randomBytes(48).toString('hex'),sendInvitationMail:async m=>{mails.push(m)}});
 await new Promise<void>(r=>app.server.listen(4254,'127.0.0.1',r));
 const req=async(path:string,cookie='',body?:any,workspace='',method=body?'POST':'GET')=>{
  const res=await fetch(base+path,{method,headers:{Cookie:cookie,'X-Mnema-Request':'1','Content-Type':'application/json',...(workspace?{'X-Mnema-Workspace':workspace}:{})},...(body?{body:JSON.stringify(body)}:{})});
  return {status:res.status,data:await res.json(),cookie:res.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')};
 };
 const invite=(cookie,email,scope='project',workspace='main')=>req('/api/invitations',cookie,{name:email.split('@')[0],email,role:'view',scope},workspace);
 const register=async(email,result)=>{assert.equal(result.status,201,JSON.stringify(result.data));return req('/api/register','',{email,password:'fixture-password-only',inviteToken:new URL(result.data.inviteURL).searchParams.get('invite')})};
 try{
  const initial=await req('/api/register','',{email:'owner@example.test',password:'fixture-password-only',setupToken:setup});assert.equal(initial.status,200);const owner=initial.cookie;
  const second=(await req('/api/workspaces',owner,{name:'Second'})).data.id;
  const pending=await invite(owner,'global@example.test','all');assert.equal(pending.status,201);assert.equal(new URL(pending.data.inviteURL).hash,'');
  let state=(await req('/api/state',owner,undefined,'main')).data;
  const pendingUser=state.state.users.find(u=>u.email==='global@example.test');assert.equal(pendingUser.status,'invited');assert.equal(pendingUser.scope,'all');assert(pendingUser.expires>Date.now());assert.match(mails[0].text,/текущие и будущие/);
  const global=await register('global@example.test',pending);assert.equal(global.status,200);const globalId=app.db.prepare("SELECT id FROM user WHERE email='global@example.test'").get().id;
  state=(await req('/api/state',owner,undefined,'main')).data;assert.equal(state.state.users.find(u=>u.email==='global@example.test').status,'active');assert.equal(state.state.users.filter(u=>u.email==='global@example.test').length,1);
  assert.equal((await register('global@example.test',pending)).status,403,'a used invitation cannot be accepted twice');
  const limitedInvite=await invite(owner,'limited@example.test');const limited=await register('limited@example.test',limitedInvite);assert.equal(limited.status,200);
  const third=(await req('/api/workspaces',owner,{name:'Future'})).data.id;
  const session=(await req('/api/session',global.cookie)).data.user;assert.deepEqual(session.workspaces.map(w=>w.id).sort(),['main',second,third].sort());assert(session.workspaces.every(w=>w.role==='view'&&!w.admin));
  assert.equal((await req('/api/state',limited.cookie,undefined,second)).status,403);assert.equal((await req('/api/research-library',limited.cookie)).data.projects.length,1);
  assert.equal((await req('/api/research-library',global.cookie)).data.projects.length,3);
  assert.equal((await req('/api/mcp/settings',global.cookie)).data.projects.length,3);
  assert.equal((await req('/api/state',global.cookie,{changes:{models:[]}},third,'PATCH')).status,403);
  // Both users may create their own project, but only the service owner can grant global access.
  const personal=(await req('/api/workspaces',limited.cookie,{name:'Personal'})).data.id;
  assert.equal((await invite(limited.cookie,'attack@example.test','all',personal)).status,403);
  assert.equal((await req('/api/users/'+globalId,limited.cookie,{role:'full'},personal,'PATCH')).status,403);
  // Explicit project endpoints never interpret a crafted all-project flag as global permission.
  const forced=await req('/api/workspaces/'+personal+'/invitations',limited.cookie,{name:'Scoped',email:'forced@example.test',role:'view',scope:'all'});
  assert.equal(forced.status,201);assert.equal(app.db.prepare("SELECT workspace_id FROM mnema_invites WHERE email='forced@example.test'").get().workspace_id,personal);
  const forcedUser=await register('forced@example.test',forced);assert.equal(forcedUser.status,200);
  const expired=await invite(owner,'expired@example.test');assert.equal(expired.status,201);
  app.db.prepare("UPDATE mnema_invites SET expires=1 WHERE email='expired@example.test'").run();
  state=(await req('/api/state',owner,undefined,'main')).data;assert.equal(state.state.users.find(u=>u.email==='expired@example.test').status,'expired');
  assert.equal((await register('expired@example.test',expired)).status,403);
  const renewed=await invite(owner,'expired@example.test');assert.equal(renewed.status,201);
  state=(await req('/api/state',owner,undefined,'main')).data;assert.equal(state.state.users.filter(u=>u.email==='expired@example.test').length,1);assert.equal(state.state.users.find(u=>u.email==='expired@example.test').status,'invited');
  // Existing scoped accounts get global access immediately, without another signup.
  const upgraded=await invite(owner,'limited@example.test','all');assert.equal(upgraded.data.added,true);assert.equal((await req('/api/session',limited.cookie)).data.user.workspaces.length,4);
  // A global grant must preserve a user's ownership of their own project.
  assert.equal((await req('/api/state',limited.cookie,undefined,personal)).data.user.admin,true);
  const limitedId=app.db.prepare("SELECT id FROM user WHERE email='limited@example.test'").get().id;
  // Role and revoke changes apply to all existing memberships and future projects.
  assert.equal((await req('/api/users/'+globalId,owner,{role:'full'},'main','PATCH')).status,200);assert((await req('/api/session',global.cookie)).data.user.workspaces.every(w=>w.role==='full'));
  assert.equal((await req('/api/users/'+globalId,owner,{status:'revoked'},'main','PATCH')).status,200);
  assert.equal((await req('/api/session',global.cookie)).data.user,null);assert.equal((await req('/api/mcp/settings',global.cookie)).status,401);
  assert.equal((await req('/api/users/'+globalId,owner,{status:'active'},'main','PATCH')).status,200);assert.equal((await req('/api/session',global.cookie)).data.user.workspaces.length,4);
  // An explicit demotion by the owner also lowers the creator's own project: no edits, no drafts.
  const draft=JSON.parse(String(app.db.prepare('SELECT data FROM mnema_workspaces WHERE id=?').get(personal).data));draft.findings=[{id:'draft-finding',studyId:'none',segmentId:'none',title:'Draft',kind:'Проблема',importance:'Высокая',status:'draft',origin:'ai',history:[]}];
  app.db.prepare('UPDATE mnema_workspaces SET data=?,version=version+1 WHERE id=?').run(JSON.stringify(draft),personal);
  assert.equal((await req('/api/users/'+limitedId,owner,{role:'view'},'main','PATCH')).status,200);
  const demoted=(await req('/api/state',limited.cookie,undefined,personal)).data;assert.equal(demoted.user.admin,false);assert.equal(demoted.user.role,'view');assert.equal(demoted.state.findings.length,0);
  assert.equal((await req('/api/state',limited.cookie,{changes:{models:[]}},personal,'PATCH')).status,403);
  // A reader can open source files only in projects included in their actual memberships.
  const raw=JSON.parse(String(app.db.prepare('SELECT data FROM mnema_workspaces WHERE id=?').get(second).data));
  raw.studies=[{id:'private-study',title:'Private',status:'ready',fileId:'private-file',fileName:'private.txt',segments:[{id:'part',time:0,text:'Synthetic text'}],summary:[]}];
  app.db.prepare('UPDATE mnema_workspaces SET data=?,version=version+1 WHERE id=?').run(JSON.stringify(raw),second);
  await writeFile(join(dir,'uploads','private-file'),'Synthetic text');app.db.prepare('INSERT INTO mnema_uploads VALUES(?,?,?,?,?)').run('private-file','private.txt','text/plain',14,'ready');
  assert.equal((await fetch(base+'/api/files/private-file?workspace='+second,{headers:{Cookie:global.cookie}})).status,200);
  assert.equal((await fetch(base+'/api/files/private-file?workspace='+second,{headers:{Cookie:forcedUser.cookie}})).status,403);
  assert.equal((await req('/api/research-library',forcedUser.cookie)).data.projects.length,1);
 }finally{app.notifications.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));app.storage.close();app.db.close();await rm(dir,{recursive:true,force:true})}
});
