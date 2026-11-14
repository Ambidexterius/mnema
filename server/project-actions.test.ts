import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createMnemaServer} from './server.ts';
const dir=await mkdtemp(join(tmpdir(),'mnema-project-actions-'));
const setup=randomBytes(32).toString('hex'),secret=randomBytes(32).toString('hex');
const options={dataDir:dir,baseURL:'http://127.0.0.1:4196',authSecret:secret,setupToken:setup};
let app=await createMnemaServer(options);
await new Promise<void>(r=>app.server.listen(4196,'127.0.0.1',r));
after(async()=>{app.notifications.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));app.db.close();await rm(dir,{recursive:true,force:true})});
async function req(path:string,body?:any,method=body===undefined?'GET':'POST',cookie=owner,workspace=''){
 const response=await fetch(options.baseURL+path,{method,headers:{'Content-Type':'application/json','X-Mnema-Request':'1',Cookie:cookie,...(workspace?{'X-Mnema-Workspace':workspace}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 return {status:response.status,data:await response.json(),cookie:response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')};
}
let owner='',viewer='',a='',b='',invite='';
test('project actions: setup isolated owner and projects',async()=>{
 const registered=await req('/api/register',{email:'owner-projects@example.test',name:'Owner',password:'fixture-password-only',setupToken:setup});assert.equal(registered.status,200);owner=registered.cookie;
 a=(await req('/api/workspaces',{name:'Project A'})).data.id;b=(await req('/api/workspaces',{name:'Project B'})).data.id;
 const invited=await req('/api/workspaces/'+a+'/invitations',{name:'Viewer',email:'viewer-projects@example.test',role:'view'});assert.equal(invited.status,201);
 const token=new URL(invited.data.inviteURL).searchParams.get('invite')!;
 const registeredView=await req('/api/register',{email:'viewer-projects@example.test',name:'Viewer',password:'fixture-password-only',inviteToken:token});assert.equal(registeredView.status,200);viewer=registeredView.cookie;
});
test('rename and invitation target an explicit project independently of the active one',async()=>{
 assert.equal((await req('/api/workspaces/'+b,{name:'Renamed B'},'PATCH',owner,a)).status,200);
 const state=await req('/api/state',undefined,'GET',owner,a);assert.equal(state.data.state.workspace.name,'Project A');assert.equal(state.data.user.workspaces.find(w=>w.id===b).name,'Renamed B');
 assert.equal((await req('/api/workspaces/'+b,{name:'x'.repeat(61)},'PATCH')).status,400);
 const added=await req('/api/workspaces/'+b+'/invitations',{name:'Viewer',email:'viewer-projects@example.test',role:'full'},'POST',owner,a);assert.equal(added.status,201);assert.equal(added.data.added,true);
 const asB=await req('/api/state',undefined,'GET',viewer,b);assert.equal(asB.data.user.role,'full');assert.equal(asB.data.user.admin,true);assert.equal(asB.data.user.owner,false);
 assert.equal((await req('/api/state',undefined,'GET',viewer,a)).data.user.role,'view');
});
test('readers are blocked; full access can manage project settings and invitations',async()=>{
 assert.equal((await req('/api/workspaces/'+a,{name:'Attack'},'PATCH',viewer)).status,403);
 assert.equal((await req('/api/workspaces/'+a,{name:'Project A'},'DELETE',viewer)).status,403);
 assert.equal((await req('/api/workspaces/'+a+'/invitations',{name:'Other',email:'other@example.test',role:'full'},'POST',viewer)).status,403);
 assert.equal((await req('/api/workspaces/'+b,{name:'Renamed B'},'PATCH',viewer)).status,200);
 assert.equal((await req('/api/workspaces/'+b+'/invitations',{name:'Other',email:'other@example.test',role:'view'},'POST',viewer)).status,201);
 assert.equal((await req('/api/workspaces/unknown',{name:'Attack'},'PATCH')).status,403);
});
test('file counts do not expose hidden catalog materials to readers',async()=>{
 const row=app.db.prepare('SELECT data FROM mnema_workspaces WHERE id=?').get(a) as any,st=JSON.parse(row.data);
 st.studies=[{id:'visible',fileId:'file-a',fileName:'visible.txt',status:'ready',segments:[]},{id:'hidden',fileId:'file-hidden',fileName:'hidden.txt',importSource:{catalog:true},segments:[]}];
 app.db.prepare('UPDATE mnema_workspaces SET data=? WHERE id=?').run(JSON.stringify(st),a);
 assert.equal((await req('/api/session')).data.user.workspaces.find(w=>w.id===a).fileCount,2);
 const visible=(await req('/api/session',undefined,'GET',viewer)).data.user.workspaces.find(w=>w.id===a);assert.equal(visible.fileCount,1);assert.deepEqual(visible.filePreviews,[{name:'visible.txt',format:'TXT'}]);assert.equal(JSON.stringify(visible).includes('hidden.txt'),false);
 // The download endpoint applies the same reader filter as the preview: a known id is not enough.
 await writeFile(join(dir,'uploads','file-hidden'),'hidden');app.db.prepare("INSERT INTO mnema_uploads VALUES('file-hidden','hidden.txt','text/plain',6,'ready')").run();
 const download=id=>fetch(options.baseURL+'/api/files/'+id,{headers:{Cookie:viewer,'X-Mnema-Workspace':a}});
 assert.equal((await download('file-hidden')).status,404);
 assert.equal((await fetch(options.baseURL+'/api/files/file-hidden',{headers:{Cookie:owner,'X-Mnema-Workspace':a}})).status,200);
});
test('deletion rejects stale confirmation, active processing and unfinished uploads',async()=>{
 assert.equal((await req('/api/workspaces/'+a,{name:'Stale'},'DELETE')).status,409);
 app.db.prepare("INSERT INTO mnema_jobs(id,study_id,status,kind,created,workspace_id) VALUES('active-a','visible','running','asr',?,?)").run(Date.now(),a);
 assert.equal((await req('/api/workspaces/'+a,{name:'Project A'},'DELETE')).status,409);
 app.db.prepare("DELETE FROM mnema_jobs WHERE id='active-a'").run();
 const upload=await req('/api/upload-sessions',{name:'pending.webm',mime:'video/webm',size:20},'POST',owner,a);assert.equal(upload.status,201);
 assert.equal((await req('/api/workspaces/'+a,{name:'Project A'},'DELETE')).status,409);
 assert.equal((await req('/api/upload-sessions/'+upload.data.id,undefined,'DELETE',owner,a)).status,200);
});
test('deletion removes files and access while keeping another project intact',async()=>{
 await writeFile(join(dir,'uploads','file-a'),'fixture');app.db.prepare("INSERT INTO mnema_uploads VALUES('file-a','fixture.txt','text/plain',7,'ready')").run();
 const pending=await req('/api/workspaces/'+a+'/invitations',{name:'Pending',email:'pending@example.test',role:'view'});assert.equal(pending.status,201);invite=new URL(pending.data.inviteURL).searchParams.get('invite')!;
 assert.equal((await req('/api/workspaces/'+a,{name:'Project A'},'DELETE')).status,200);
 for(const [table,col] of [['mnema_workspaces','id'],['mnema_members','workspace_id'],['mnema_invites','workspace_id']])assert.equal(app.db.prepare('SELECT 1 FROM '+table+' WHERE '+col+'=?').get(a),undefined);
 await assert.rejects(access(join(dir,'uploads','file-a')));
 assert.equal((await req('/api/state',undefined,'GET',viewer,a)).status,403);assert.equal((await req('/api/state',undefined,'GET',viewer,b)).status,200);
 assert.equal((await req('/api/register',{email:'pending@example.test',name:'Pending',password:'fixture-password-only',inviteToken:invite})).status,403);
});
test('deleted projects and memberships stay deleted after restart; an empty account can create a project',async()=>{
 assert.equal((await req('/api/workspaces/'+b,{name:'Renamed B'},'DELETE')).status,200);
 assert.equal((await req('/api/workspaces/main',{name:'Команда'},'DELETE')).status,200);
 app.notifications.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));app.db.close();
 app=await createMnemaServer(options);await new Promise<void>(r=>app.server.listen(4196,'127.0.0.1',r));
 assert.equal((await req('/api/session')).data.user.workspaces.length,0);assert.equal(app.db.prepare('SELECT count(*) AS n FROM mnema_members').get().n,0);
 assert.equal((await req('/api/state')).status,200);assert.equal((await req('/api/workspaces',{name:'New after deletion'})).status,201);
});
