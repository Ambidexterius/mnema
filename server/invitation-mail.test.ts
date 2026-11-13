import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {invitationEmail,sendInvitationEmail} from './invitation-mail.ts';
import {createMnemaServer} from './server.ts';

const input={to:'invited@example.test',name:'Анна',workspaceId:'project-b',workspaceName:'Проект <script>',inviterName:'Глеб & команда',role:'view' as const,baseURL:'https://example.test',inviteURL:'https://example.test/#/signup?invite=fixture-token&email=invited%40example.test'};
test('invitation email preserves the server link, escapes HTML and distinguishes existing accounts',()=>{
 const mail=invitationEmail(input);assert.equal(mail.to,input.to);assert.match(mail.text,/Просмотр/);assert.match(mail.text,/7 дней/);assert(mail.text.includes(input.inviteURL));assert.match(mail.html,/&lt;script&gt;/);assert.doesNotMatch(mail.html,/<script>/);assert.match(mail.html,/Глеб &amp; команда/);
 const existing=invitationEmail({...input,inviteURL:undefined,role:'full'});assert.match(existing.text,/Полный доступ/);assert.doesNotMatch(existing.text,/7 дней|signup/);assert(existing.text.includes('/projects/project-b'));
 assert.throws(()=>invitationEmail({...input,inviteURL:'https://other.example/'}),/invalid_invitation_origin/);
 assert(!invitationEmail({...input,workspaceName:'One\r\nBcc: bad@example.test'}).subject.includes('\n'));
});
test('SMTP unavailability and failures are reported without exposing the link or transport error in logs',async()=>{
 const keys=['SMTP_HOST','SMTP_USER','SMTP_PASSWORD','SMTP_FROM'];const saved=keys.map(k=>process.env[k]);keys.forEach(k=>delete process.env[k]);
 try{assert.equal(await sendInvitationEmail(input),'not_configured');assert.equal(await sendInvitationEmail(input,async()=>{}),'sent');assert.equal(await sendInvitationEmail(input,async()=>{throw new Error('private SMTP details')}),'failed')}
 finally{keys.forEach((k,i)=>saved[i]===undefined?delete process.env[k]:process.env[k]=saved[i])}
});
test('both invitation endpoints send the correct project, notify existing accounts, and preserve access after a mail failure',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mnema-invitation-mail-')),setup=randomBytes(32).toString('hex');let cookie='',failMail=false;const sent:any[]=[];
 const baseURL='http://127.0.0.1:4217';
 const app=await createMnemaServer({dataDir:dir,baseURL,authSecret:randomBytes(32).toString('hex'),setupToken:setup,sendInvitationMail:async message=>{if(failMail)throw new Error('SMTP unavailable');sent.push(message)}});
 await new Promise<void>(r=>app.server.listen(4217,'127.0.0.1',r));
 const req=async(path:string,body?:any,extra={})=>{const res=await fetch(baseURL+path,{method:body?'POST':'GET',headers:{Cookie:cookie,'Content-Type':'application/json','X-Mnema-Request':'1',...extra},...(body?{body:JSON.stringify(body)}:{})});return{res,data:await res.json()}};
 try{
  const owner=await req('/api/register',{email:'owner-invitations@example.test',password:'fixture-password-only',setupToken:setup});assert.equal(owner.res.status,200);cookie=owner.res.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  const project=(await req('/api/workspaces',{name:'Project B'})).data.id;
  const invited=await req('/api/workspaces/'+project+'/invitations',{name:'Viewer',email:input.to,role:'view'});assert.equal(invited.res.status,201);assert.equal(invited.data.emailStatus,'sent');assert.equal(sent.length,1);assert.match(sent[0].text,/Project B/);assert(sent[0].text.includes(invited.data.inviteURL));
  const rawToken=new URL(invited.data.inviteURL).searchParams.get('invite')!;assert(!JSON.stringify(app.db.prepare('SELECT * FROM mnema_invites').all()).includes(rawToken));
  const registered=await req('/api/register',{email:input.to,password:'fixture-password-only',inviteToken:rawToken});assert.equal(registered.res.status,200);
  const existing=await req('/api/invitations',{name:'Viewer',email:input.to,role:'full'},{'X-Mnema-Workspace':'main'});assert.equal(existing.data.added,true);assert.equal(existing.data.emailStatus,'sent');assert.match(sent[1].text,/Команда/);assert.doesNotMatch(sent[1].text,/signup/);
  failMail=true;
  const failed=await req('/api/invitations',{name:'Failed mail',email:'failed@example.test',role:'view'},{'X-Mnema-Workspace':project});assert.equal(failed.res.status,201);assert.equal(failed.data.emailStatus,'failed');assert(failed.data.inviteURL);assert(app.db.prepare("SELECT id FROM mnema_invites WHERE email='failed@example.test' AND revoked=0").get());
  const count=sent.length;cookie=registered.res.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  const denied=await req('/api/workspaces/'+project+'/invitations',{name:'Other',email:'other@example.test',role:'full'});assert.equal(denied.res.status,403);assert.equal(sent.length,count);
 }finally{app.notifications.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));app.storage.close();app.db.close();await rm(dir,{recursive:true,force:true})}
});
