import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createMnemaServer} from './server.ts';
import {corporateEmail,registrationEmail} from './registration.ts';
import {request as httpRequest} from 'node:http';

test('corporate email allows the exact domain and letter contains a usable text code',async()=>{
 assert.equal(corporateEmail(' Ivan.Petrov@SUTOCHNO.RU '),'ivan.petrov@sutochno.ru');
 for(const email of ['a@gmail.com','a@sutochno.ru.evil','a@sub.sutochno.ru','a@@sutochno.ru','a b@sutochno.ru','a..b@sutochno.ru','a@sutоchno.ru','a'])assert.throws(()=>corporateEmail(email));
 const mail=registrationEmail('ivan@sutochno.ru','012345');assert.match(mail.messageId,/^<[^<>\s]+@[^<>\s]+>$/);assert.match(mail.text,/012 345/);assert.match(mail.html,/30 минут/);assert.match(mail.html,/Код доступа/);assert.doesNotMatch(mail.html,/<script|<img/);
 await assert.rejects(createMnemaServer({production:true,baseURL:'https://example.test',authSecret:'a'.repeat(40),registrationCode:()=> '685791'}),/only in a local non-production/);
});

test('corporate registration is verified, single-use, persistent and grants project access without user-management privileges',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mnema-signup-test-')),base='http://127.0.0.1:4492',setup=randomBytes(32).toString('hex'),secret=randomBytes(48).toString('hex');
 const mails:any[]=[];let failMail=false;
 const options={dataDir:dir,baseURL:base,authSecret:secret,setupToken:setup,corporateRegistration:true,sendRegistrationMail:async mail=>{if(failMail)throw Error('synthetic mail failure');mails.push(mail)},sendCompletionMail:async()=>{},sendInvitationMail:async()=>{}};
 let app=await createMnemaServer(options);await new Promise<void>(resolve=>app.server.listen(4492,'127.0.0.1',resolve));
 const jar=()=>new Map<string,string>(),owner=jar(),browser=jar();
 const request=async(path:string,data?:any,cookies=browser,headers={})=>{
  const response=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),Connection:'close','Content-Type':'application/json','X-Mnema-Request':'1',Origin:base,...headers},...(data===undefined?{}:{body:JSON.stringify(data)})});
  for(const cookie of response.headers.getSetCookie()){const pair=cookie.split(';')[0],i=pair.indexOf('='),key=pair.slice(0,i),value=pair.slice(i+1);if(value)cookies.set(key,value);else cookies.delete(key)}
  return {status:response.status,body:await response.json(),headers:response.headers};
 };
 const code=()=>{const match=mails.at(-1).text.match(/\n\n(\d{3}) (\d{3})\n\n/);return match[1]+match[2]};
 const unlockMail=(email:string)=>app.db.prepare('UPDATE mnema_registration SET resend_at=0 WHERE email=?').run(email);
 const stop=async()=>{app.notifications.close();app.server.closeAllConnections();await new Promise<void>(resolve=>app.server.close(()=>resolve()));app.storage.close();app.db.close()};
 try{
  assert.equal((await request('/api/register',{email:'owner@sutochno.ru',password:'owner-password-only',setupToken:setup},owner)).status,200);
  assert.equal((await request('/api/session',undefined,owner)).body.user.welcomePending,true);
  for(const name of ['Чаты','Бронирование'])assert.equal((await request('/api/workspaces',{name},owner)).status,201);
  assert.equal((await request('/api/register',{email:'new@sutochno.ru',password:'secure-password-only',firstName:'Иван',lastName:'Петров'})).status,403);
  assert.equal((await request('/api/auth/sign-up/email',{email:'new@sutochno.ru',password:'secure-password-only',name:'Fake'})).status,404);
  assert.equal((await request('/api/registration/request-code',{email:'new@gmail.com'})).status,400);
  assert.equal((await request('/api/registration/request-code',{email:'NEW@SUTOCHNO.RU'},browser,{'X-Mnema-Request':'0'})).status,403);
  const sent=await request('/api/registration/request-code',{email:'NEW@SUTOCHNO.RU'});assert.equal(sent.status,200);assert.equal(sent.body.email,'new@sutochno.ru');assert.match(sent.headers.get('set-cookie')||'',/HttpOnly; SameSite=Strict/);assert.doesNotMatch(JSON.stringify(sent.body),/code|token/i);
  const valid=code();assert.equal((await request('/api/workspaces')).status,401);
  assert.equal((await request('/api/registration/request-code',{email:'new@sutochno.ru'})).status,429);
  const wrong=valid==='000000'?'111111':'000000';assert.equal((await request('/api/registration/verify-code',{email:'new@sutochno.ru',code:wrong})).status,400);
  assert.equal((await request('/api/registration/verify-code',{email:'other@sutochno.ru',code:valid})).body.code,'EMAIL_CHANGED');
  assert.equal((await request('/api/registration/verify-code',{email:'new@sutochno.ru',code:valid},jar())).status,410);
  assert.equal((await request('/api/registration/verify-code',{email:'new@sutochno.ru',code:valid})).status,200);
  assert.equal((await request('/api/registration/verify-code',{email:'new@sutochno.ru',code:valid})).status,409);
  assert.equal((await request('/api/workspaces')).status,401);
  assert.equal((await request('/api/welcome/dismiss',{})).status,401);
  app.db.exec('ALTER TABLE mnema_access DROP COLUMN welcome_pending');
  await stop();app=await createMnemaServer(options);await new Promise<void>(resolve=>app.server.listen(4492,'127.0.0.1',resolve));assert.equal((await request('/api/registration/status')).body.verified,true);
  assert.equal((await request('/api/session',undefined,owner)).body.user.welcomePending,false);
  const signup={email:'new@sutochno.ru',password:'abcdefgh',firstName:'Иван',lastName:'Петров',admin:true,role:'admin'};
  assert.equal((await request('/api/register',{...signup,password:'abcdefg'})).status,400);
  assert.equal((await request('/api/register',{...signup,firstName:''})).body.code,'FIRST_NAME');
  assert.equal((await request('/api/register',{...signup,lastName:''})).body.code,'LAST_NAME');
  assert.equal((await request('/api/register',{...signup,photo:'data:image/svg+xml;base64,PHN2Zy8+'})).body.code,'PHOTO');
  assert.equal((await request('/api/register',{...signup,photo:'data:image/png;base64,'+Buffer.from('not really an image').toString('base64')})).body.code,'PHOTO');
  const png=await readFile(new URL('./fixtures/avatar.jpg',import.meta.url));
  const saved=await request('/api/register',{...signup,photo:'data:image/jpeg;base64,'+png.toString('base64')});assert.equal(saved.status,200,JSON.stringify(saved.body));assert.equal(browser.has('mnema-registration'),false);assert(browser.size>0,'auth session cookie survived registration cookie deletion');
  const person=(await request('/api/session')).body.user;assert.equal(person.name,'Иван Петров');assert.equal(person.emailVerified,true);assert.equal(person.owner,false);assert.equal(person.manageUsers,false);assert.equal(person.workspaces.length,3);assert(person.workspaces.every(w=>w.role===(w.id==='main'?'full':'view')));assert.ok(person.image);
  assert.equal(person.welcomePending,true);
  assert.equal((await request('/api/welcome/dismiss',{},browser,{'X-Mnema-Request':'0'})).status,403);
  for(let attempt=0;attempt<2;attempt++)assert.equal((await request('/api/welcome/dismiss',{userId:'another-account'})).status,200);
  assert.equal((await request('/api/session')).body.user.welcomePending,false);
  assert.equal((await request('/api/users')).status,403);
  assert.equal((await request('/api/invitations',{name:'Other',email:'other@sutochno.ru',role:'full',scope:'all'})).status,403);
  const picture=await fetch(base+person.image,{headers:{Cookie:[...browser].map(([k,v])=>k+'='+v).join('; ')}});assert.equal(picture.status,200);assert.equal(picture.headers.get('content-type'),'image/png');assert.equal(picture.headers.get('cache-control'),'no-store');const bytes=Buffer.from(await picture.arrayBuffer()),chunks=[];for(let offset=8;offset<bytes.length;){const size=bytes.readUInt32BE(offset);chunks.push(bytes.toString('ascii',offset+4,offset+8));offset+=size+12}assert.ok(!chunks.includes('eXIf')&&!chunks.includes('tEXt'));assert.ok(!bytes.includes(Buffer.from('private-profile-metadata')));assert.equal((await fetch(base+person.image)).status,401);
  assert.equal((await request('/api/register',signup)).status,403,'verification grant cannot be replayed');
  await request('/api/workspaces',{name:'Будущий проект'},owner);assert.equal((await request('/api/session')).body.user.workspaces.length,4);
  unlockMail('new@sutochno.ru');const existing=jar();await request('/api/registration/request-code',{email:'new@sutochno.ru'},existing);assert.equal((await request('/api/registration/verify-code',{email:'new@sutochno.ru',code:code()},existing)).body.existingAccount,true);assert.equal((await request('/api/register',signup,existing)).status,409);assert.equal(app.db.prepare("SELECT count(*) AS n FROM user WHERE email='new@sutochno.ru'").get().n,1);
  app.db.prepare('UPDATE mnema_access SET revoked=1 WHERE user_id=?').run(person.id);unlockMail('new@sutochno.ru');const blocked=jar();await request('/api/registration/request-code',{email:'new@sutochno.ru'},blocked);assert.equal((await request('/api/registration/verify-code',{email:'new@sutochno.ru',code:code()},blocked)).body.code,'ACCOUNT_BLOCKED');assert.equal((await request('/api/session')).body.user,null);
  const attempts=jar(),email='attempts@sutochno.ru';await request('/api/registration/request-code',{email},attempts);const old=code(),bad=old==='999999'?'888888':'999999';for(let i=0;i<5;i++)await request('/api/registration/verify-code',{email,code:bad},attempts);assert.equal((await request('/api/registration/verify-code',{email,code:old},attempts)).body.code,'CODE_LOCKED');await request('/api/registration/cancel',{},attempts);assert.equal((await request('/api/registration/request-code',{email},attempts)).status,429,'cancel cannot bypass resend interval');
  const expired=jar(),expiresEmail='expired@sutochno.ru';await request('/api/registration/request-code',{email:expiresEmail},expired);app.db.prepare('UPDATE mnema_registration SET expires=0 WHERE email=?').run(expiresEmail);assert.equal((await request('/api/registration/verify-code',{email:expiresEmail,code:code()},expired)).body.code,'CODE_EXPIRED');
  failMail=true;const failed=jar();assert.equal((await request('/api/registration/request-code',{email:'failed@sutochno.ru'},failed)).body.code,'MAIL_FAILED');assert.equal((await request('/api/registration/status',undefined,failed)).body.pending,false);
 }finally{await stop();await rm(dir,{recursive:true,force:true})}
});

test('an unfinished registration body does not block other signups',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mnema-signup-slow-')),base='http://127.0.0.1:4493',setup=randomBytes(32).toString('hex');
 const app=await createMnemaServer({dataDir:dir,baseURL:base,setupToken:setup,authSecret:randomBytes(48).toString('hex'),corporateRegistration:true,sendRegistrationMail:async()=>{}});await new Promise<void>(resolve=>app.server.listen(4493,'127.0.0.1',resolve));
 const headers={'Content-Type':'application/json','X-Mnema-Request':'1',Origin:base};
 try{
  await fetch(base+'/api/register',{method:'POST',headers,body:JSON.stringify({email:'owner@sutochno.ru',password:'local-owner-password',setupToken:setup})});
  for(const [i,path] of ['/api/register','/api/registration/request-code'].entries()){
   const slow=httpRequest(base+path,{method:'POST',headers:{...headers,'Content-Length':'1000'}});slow.on('error',()=>{});slow.write('{');
   try{
    await new Promise(resolve=>setTimeout(resolve,30));
    const fast=await fetch(base+'/api/registration/request-code',{method:'POST',headers,body:JSON.stringify({email:'fast'+i+'@sutochno.ru'}),signal:AbortSignal.timeout(2000)});assert.equal(fast.status,200);
   }finally{slow.destroy()}
  }
 }finally{app.notifications.close();app.server.closeAllConnections();await new Promise<void>(resolve=>app.server.close(()=>resolve()));app.storage.close();app.db.close();await rm(dir,{recursive:true,force:true})}
});

test('explicit invitations retain view access when corporate self-registration is enabled',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mnema-invite-corporate-')),base='http://127.0.0.1:4498',setup=randomBytes(32).toString('hex');
 const app=await createMnemaServer({dataDir:dir,baseURL:base,setupToken:setup,authSecret:randomBytes(48).toString('hex'),corporateRegistration:true,sendInvitationMail:async()=>{}});await new Promise<void>(resolve=>app.server.listen(4498,'127.0.0.1',resolve));
 const post=async(path:string,data:any,cookie='')=>{const r=await fetch(base+path,{method:'POST',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json','X-Mnema-Request':'1','X-Mnema-Workspace':'main'},body:JSON.stringify(data)});return{status:r.status,data:await r.json(),cookie:r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')}};
 try{
  const owner=await post('/api/register',{email:'owner@sutochno.ru',password:'fixture-owner-password',setupToken:setup});assert.equal(owner.status,200);
  const invitation=await post('/api/invitations',{name:'Viewer',email:'viewer@example.test',role:'view'},owner.cookie);assert.equal(invitation.status,201);const token=new URL(invitation.data.inviteURL).searchParams.get('invite');
  assert.equal((await post('/api/register',{email:'outside@example.test',password:'abcdefgh'})).status,400);
  assert.equal((await post('/api/register',{email:'outside@example.test',password:'abcdefgh',inviteToken:'invalid'})).status,403);
  assert.equal((await post('/api/register',{email:'wrong@example.test',password:'abcdefgh',inviteToken:token})).status,403);
  const joined=await post('/api/register',{email:'viewer@example.test',password:'abcdefgh',inviteToken:token,role:'full',admin:true});assert.equal(joined.status,200,JSON.stringify(joined.data));
  const access=app.db.prepare('SELECT a.* FROM mnema_access a JOIN user u ON u.id=a.user_id WHERE u.email=?').get('viewer@example.test') as any;assert.equal(access.role,'view');assert.equal(access.admin,0);assert.equal(access.self_registered,0);
  const info=await(await fetch(base+'/api/session',{headers:{Cookie:joined.cookie}})).json() as any;assert.equal(info.user.role,'view');assert.equal(info.user.manageUsers,false);
  assert.equal((await post('/api/register',{email:'viewer@example.test',password:'abcdefgh',inviteToken:token})).status,403);
 }finally{app.notifications.close();app.server.closeAllConnections();await new Promise<void>(resolve=>app.server.close(()=>resolve()));app.storage.close();app.db.close();await rm(dir,{recursive:true,force:true})}
});

test('password reset works for any mail domain without self-registration, stays silent about unknown accounts and ends old sessions',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mnema-reset-test-')),base='http://127.0.0.1:4495',setup=randomBytes(32).toString('hex'),mails:any[]=[];
 const app=await createMnemaServer({dataDir:dir,baseURL:base,authSecret:randomBytes(48).toString('hex'),setupToken:setup,sendRegistrationMail:async mail=>{mails.push(mail)},sendCompletionMail:async()=>{},sendInvitationMail:async()=>{}});
 await new Promise<void>(resolve=>app.server.listen(4495,'127.0.0.1',resolve));
 const jar=()=>new Map<string,string>(),old=jar(),browser=jar();
 const request=async(path:string,data?:any,cookies=browser)=>{
  const response=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),Connection:'close','Content-Type':'application/json','X-Mnema-Request':'1',Origin:base},...(data===undefined?{}:{body:JSON.stringify(data)})});
  for(const cookie of response.headers.getSetCookie()){const pair=cookie.split(';')[0],i=pair.indexOf('='),key=pair.slice(0,i),value=pair.slice(i+1);if(value)cookies.set(key,value);else cookies.delete(key)}
  return {status:response.status,body:await response.json() as any};
 };
 try{
  assert.equal((await request('/api/register',{email:'owner@example.test',password:'old-password',name:'Owner',setupToken:setup},old)).status,200);
  assert.ok((await request('/api/session',undefined,old)).body.user);
  assert.equal((await request('/api/registration/request-code',{email:'a@sutochno.ru'})).status,404);
  assert.equal((await request('/api/password-reset/request-code',{email:'not mail'})).status,400);
  const unknown=await request('/api/password-reset/request-code',{email:'nobody@example.test'});
  assert.equal(unknown.status,200);assert.equal(unknown.body.pending,true);assert.equal(mails.length,0);
  assert.equal((await request('/api/password-reset/verify-code',{email:'nobody@example.test',code:'000000'})).status,400);
  assert.equal((await request('/api/password-reset/complete',{password:'new-password'})).status,403);
  const sent=await request('/api/password-reset/request-code',{email:' Owner@Example.test '});
  assert.deepEqual({...sent.body,expiresAt:0,resendAt:0,serverNow:0},{...unknown.body,email:'owner@example.test',expiresAt:0,resendAt:0,serverNow:0});
  assert.equal(mails.length,1);const match=mails[0].text.match(/(\d{3}) (\d{3})/);
  assert.equal((await request('/api/password-reset/complete',{password:'new-password'})).status,403);
  assert.equal((await request('/api/password-reset/verify-code',{email:'owner@example.test',code:match[1]+match[2]})).status,200);
  assert.equal((await request('/api/password-reset/complete',{password:'short'})).status,400);
  assert.equal((await request('/api/password-reset/complete',{password:'new-password'})).status,200);
  assert.equal((await request('/api/session')).body.user.email,'owner@example.test');
  assert.equal((await request('/api/session',undefined,old)).body.user,null);
  assert.equal((await request('/api/password-reset/complete',{password:'another-password'})).status,403);
  assert.equal((await request('/api/auth/sign-in/email',{email:'owner@example.test',password:'old-password'},jar())).status,401);
  assert.equal((await request('/api/auth/sign-in/email',{email:'owner@example.test',password:'new-password'},jar())).status,200);
  assert.equal(mails.at(-1).subject,'Пароль в Мнемодаке изменён');assert.equal(mails.at(-1).to,'owner@example.test');
  app.db.prepare('UPDATE mnema_access SET revoked=1').run();app.db.prepare('UPDATE mnema_registration SET resend_at=0').run();
  assert.equal((await request('/api/password-reset/request-code',{email:'owner@example.test'})).status,200);assert.equal(mails.length,2);
 }finally{app.notifications.close();app.server.closeAllConnections();await new Promise<void>(resolve=>app.server.close(()=>resolve()));app.storage.close();app.db.close();await rm(dir,{recursive:true,force:true})}
});
