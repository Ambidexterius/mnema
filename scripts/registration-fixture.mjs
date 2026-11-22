import {seedWorkspaceFixture} from './ui-fixture.mjs';
import {createMnemaServer} from '../server/server.ts';
import {registrationEmail} from '../server/registration.ts';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';

export async function startRegistrationFixture({port,dataDir}){
 process.env.MNEMA_S3_ENABLED='0';
 const base='http://127.0.0.1:'+port,setup=randomBytes(32).toString('hex'),messages=[],controls={failNextMail:false};
 const capture=async message=>{if(controls.failNextMail){controls.failNextMail=false;throw Error('local_mail_failure')}messages.push({...message,received:Date.now()});if(messages.length>100)messages.shift()};
 const app=await createMnemaServer({production:false,dataDir,publicDir:resolve(import.meta.dirname,'../dist'),baseURL:base,authSecret:randomBytes(48).toString('hex'),authCookiePrefix:'mnema-local-registration',setupToken:setup,corporateRegistration:true,registrationCode:()=> '685791',sendRegistrationMail:capture,sendInvitationMail:capture,sendCompletionMail:capture,providerFetch:async()=>{throw Error('Real providers are disabled in the registration stand')}});
 // This fixture has no stable server secret; request a fresh code after restarting it.
 app.db.prepare('DELETE FROM mnema_registration').run();
 const handler=app.server.listeners('request')[0];app.server.removeListener('request',handler);
 const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
 app.server.on('request',(req,res)=>{
  const url=new URL(req.url,base);
  if(!url.pathname.startsWith('/__mail'))return handler(req,res);
  if(req.method!=='GET'||req.headers.host!==new URL(base).host||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)){res.writeHead(403);res.end();return}
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Cross-Origin-Resource-Policy','same-origin');res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'");
  if(url.pathname==='/__mail/messages'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify(messages.map(({html,...message})=>message)))}
  if(url.pathname==='/__mail/example'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(registrationEmail('employee@sutochno.ru','685791').html)}
  const id=url.pathname.slice('/__mail/'.length),message=messages.find(m=>encodeURIComponent(m.messageId)===id);
  if(message){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(message.html)}
  if(url.pathname!=='/__mail'){res.writeHead(404);return res.end('Письмо не найдено')}
  const rows=[...messages].reverse().map(m=>'<li><a href="/__mail/'+encodeURIComponent(m.messageId)+'">'+escape(m.subject)+'</a><p>'+escape(m.to)+'</p></li>').join('');
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Тестовые письма — Мнемодак</title><style>body{font:16px/1.5 system-ui,sans-serif;color:#222;background:#f3f3f3;margin:0;padding:32px 20px}main{max-width:640px;margin:auto}h1{font-size:24px}p{color:#555;margin:4px 0}ul{list-style:none;padding:0}li{padding:16px 0;border-bottom:1px solid #ddd}a{color:#b9173a}a:focus-visible{outline:2px solid #4568ff;outline-offset:4px}</style><main><h1>Тестовые письма</h1><p>Письма этой локальной версии сохраняются здесь. На настоящую почту они не отправляются.</p><p><a href="'+base+'/signup">Вернуться к регистрации</a> · <a href="/__mail">Обновить список</a> · <a href="/__mail/example">Пример письма</a></p><ul>'+rows+'</ul>'+(!rows?'<p>Пока писем нет. Запросите код на странице регистрации и обновите список.</p>':'')+'</main></html>');
 });
 await new Promise(resolve=>app.server.listen(port,'127.0.0.1',resolve));
 if(!app.db.prepare('SELECT 1 FROM mnema_access WHERE admin=1').get()){
  // Scenarios restart the fixture on the same port. Do not pool a socket across them.
  const response=await fetch(base+'/api/register',{
   method:'POST',
   headers:{'Content-Type':'application/json','X-Mnema-Request':'1',Origin:base,Connection:'close'},
   body:JSON.stringify({email:'local.owner@sutochno.ru',password:randomBytes(24).toString('hex'),name:'Локальный владелец',setupToken:setup}),
  });
  if(response.status!==200)throw Error('Cannot seed local owner');
  await response.body?.cancel();
 }
 if(!app.db.prepare("SELECT 1 FROM mnema_migrations WHERE name='registration-local-projects-v1'").get()){
  const owner=app.db.prepare('SELECT user_id FROM mnema_access WHERE admin=1').get().user_id;
  const empty=JSON.parse(app.db.prepare("SELECT data FROM mnema_workspaces WHERE id='main'").get().data);empty.models=[];empty.modelId='';
  seedWorkspaceFixture(app.db,"UPDATE mnema_workspaces SET name=?,data=?,created_by=? WHERE id='main'",'UX-тест чатов · локальный пример',JSON.stringify(empty),owner);
  for(const [id,name] of [['booking','Бронирование · локальный пример'],['gallery','Галерея · локальный пример']]){
   seedWorkspaceFixture(app.db,'INSERT INTO mnema_workspaces VALUES(?,?,?,?,?,?)',id,name,0,JSON.stringify(empty),Date.now(),owner);
   app.db.prepare("INSERT INTO mnema_project_sharing VALUES(?,'all',?,lower(hex(randomblob(32))))").run(id,owner);
   app.db.prepare('INSERT INTO mnema_members(workspace_id,user_id,role,admin) SELECT ?,user_id,role,admin FROM mnema_access WHERE all_projects=1 AND revoked=0').run(id);
  }
  app.db.prepare("INSERT INTO mnema_migrations(name) VALUES('registration-local-projects-v1')").run();
 }
 return {app,base,messages,controls,async close(){app.notifications.close();app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));app.storage.close();app.db.close()}};
}
