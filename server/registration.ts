import {createHash,createHmac,randomBytes,randomInt,randomUUID,timingSafeEqual} from 'node:crypto';
import {execFile} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import type {DatabaseSync} from 'node:sqlite';
import {normalizeCorporateEmail} from '../app/corporate-email.ts';
import type {CompletionMail} from './completion-mail.ts';

export const CODE_TTL=30*60*1000,RESEND_DELAY=60*1000;
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
function fail(status:number,message:string,publicCode:string):never{throw Object.assign(new Error(message),{status,publicCode})}
export function corporateEmail(value:unknown){
 const email=normalizeCorporateEmail(value);if(!email)fail(400,'Используйте рабочую почту @sutochno.ru','EMAIL');
 return email;
}
export function registrationEmail(to:string,code:string):CompletionMail{
 if(!/^\d{6}$/.test(code))throw new Error('Invalid registration code');
 const spaced=code.slice(0,3)+' '+code.slice(3),note='Срок действия кода истечёт через 30 минут. Если вы не запрашивали код, то проигнорируйте это письмо.';
 return {to,subject:'Код доступа в Мнемонику',messageId:'<mnemonika-registration-'+randomUUID()+'@mnemoduck.ru>',text:'Код доступа\n\nВаш код доступа к Мнемонике:\n\n'+spaced+'\n\n'+note,
 html:'<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Код доступа</title></head><body style="margin:0;padding:4px;background:#f3f3f3;color:#000;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:auto"><tr><td style="background:#fff;border-radius:12px;padding:34px 36px"><h1 style="font-size:22px;line-height:28px;margin:0 0 28px">Код доступа</h1><p style="font-size:16px;line-height:24px;margin:0">Ваш код доступа к Мнемонике:</p><p style="font-size:22px;line-height:28px;font-weight:bold;margin:26px 0 30px">'+spaced+'</p><p style="font-size:16px;line-height:24px;margin:0">'+note+'</p></td></tr></table></body></html>'};
}
export function createRegistration(db:DatabaseSync,secret:string,production:boolean,send?:((mail:CompletionMail)=>Promise<void>),generateCode=()=>String(randomInt(1000000)).padStart(6,'0')){
 const q=(sql:string)=>db.prepare(sql) as any;
 db.exec(`CREATE TABLE IF NOT EXISTS mnema_registration(token TEXT PRIMARY KEY,email TEXT NOT NULL,code_hash TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,resend_at INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,verified INTEGER NOT NULL DEFAULT 0);
 CREATE INDEX IF NOT EXISTS mnema_registration_email ON mnema_registration(email,created);
 CREATE TABLE IF NOT EXISTS mnema_profiles(user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,first_name TEXT NOT NULL,last_name TEXT NOT NULL,photo BLOB,photo_mime TEXT);`);
 const cookieName=production?'__Host-mnema-registration':'mnema-registration';
 const token=(req:any)=>String(req.headers.cookie||'').split(';').map(c=>c.trim()).find(c=>c.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';
 const find=(req:any)=>{const raw=token(req);return /^[\w-]{43}$/.test(raw)?q('SELECT * FROM mnema_registration WHERE token=?').get(digest(raw)):undefined};
 const codeHash=(raw:string,code:string)=>createHmac('sha256',secret).update(raw+':'+code).digest('hex');
 const setCookie=(res:any,raw:string,age=1800)=>{res.setHeader('Set-Cookie',cookieName+'='+raw+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+age+(production?'; Secure':''))};
 const publicState=(row:any)=>row?{pending:true,email:row.email,expiresAt:row.expires,resendAt:row.resend_at,verified:Boolean(row.verified),locked:row.attempts>=5,serverNow:Date.now()}:{pending:false,serverNow:Date.now()};
 const current=(req:any)=>{const row=find(req);return row&&row.expires>Date.now()?row:undefined};
 const status=(req:any)=>publicState(current(req));
 const verified=(req:any,email:string)=>{const row=current(req);if(!row||row.email!==corporateEmail(email)||!row.verified)fail(403,'Подтвердите рабочую почту ещё раз','VERIFICATION_REQUIRED');return row};
 return {
  status,verified,
  async request(req:any,res:any,value:unknown){
   const email=corporateEmail(value),now=Date.now(),previous=current(req);
   const last=q('SELECT resend_at FROM mnema_registration WHERE email=? ORDER BY created DESC LIMIT 1').get(email);
   if(last?.resend_at>now)fail(429,'Новый код можно запросить через '+Math.ceil((last.resend_at-now)/1000)+' с','RESEND_WAIT');
   if(q('SELECT count(*) AS n FROM mnema_registration WHERE email=? AND created>?').get(email,now-CODE_TTL).n>=5)fail(429,'Слишком много писем. Попробуйте через 30 минут','MAIL_LIMIT');
   if(!send)fail(503,'Отправка писем пока не подключена. Попробуйте позже','MAIL_UNAVAILABLE');
   const raw=randomBytes(32).toString('base64url'),code=generateCode();
   try{await send(registrationEmail(email,code))}catch{fail(502,'Не удалось отправить код. Повторите попытку','MAIL_FAILED')}
   q('DELETE FROM mnema_registration WHERE expires<?').run(now-24*3600000);
   if(previous)q('UPDATE mnema_registration SET expires=0 WHERE token=?').run(previous.token);
   q('INSERT INTO mnema_registration(token,email,code_hash,created,expires,resend_at) VALUES(?,?,?,?,?,?)').run(digest(raw),email,codeHash(raw,code),now,now+CODE_TTL,now+RESEND_DELAY);
   setCookie(res,raw);return publicState(current({headers:{cookie:cookieName+'='+raw}}));
  },
  verify(req:any,res:any,input:any){
   const row=current(req),email=corporateEmail(input.email);
   if(!row)fail(410,'Код истёк. Запросите новый','CODE_EXPIRED');
   if(row.email!==email)fail(409,'Почта изменилась в другой вкладке. Получите новый код','EMAIL_CHANGED');
   if(row.verified)fail(409,'Код уже использован. Продолжите создание аккаунта','CODE_USED');
   if(row.attempts>=5)fail(429,'Слишком много попыток. Запросите новый код','CODE_LOCKED');
   const code=typeof input.code==='string'?input.code:'';
   if(!/^\d{6}$/.test(code))fail(400,'Введите 6 цифр из письма','CODE');
   const actual=codeHash(token(req),code);
   if(row.code_hash.length!==actual.length||!timingSafeEqual(Buffer.from(row.code_hash),Buffer.from(actual))){q('UPDATE mnema_registration SET attempts=attempts+1 WHERE token=?').run(row.token);fail(400,row.attempts>=4?'Слишком много попыток. Запросите новый код':'Код не подошёл. Проверьте цифры в письме',row.attempts>=4?'CODE_LOCKED':'CODE')}
   const existing=q('SELECT u.id,a.revoked FROM user u LEFT JOIN mnema_access a ON a.user_id=u.id WHERE lower(u.email)=?').get(email);
   if(existing&&existing.revoked!==0)fail(403,'Доступ к аккаунту закрыт. Обратитесь к администратору','ACCOUNT_BLOCKED');
   q('UPDATE mnema_registration SET verified=1,code_hash=?,expires=? WHERE token=?').run('',Date.now()+CODE_TTL,row.token);
   setCookie(res,token(req));return {...publicState(current(req)),existingAccount:Boolean(existing)};
  },
  consume(req:any,res:any){const row=find(req);if(row)q('UPDATE mnema_registration SET verified=0,expires=0 WHERE token=?').run(row.token);setCookie(res,'',0)},
  profile(input:any){
   const name=(value:unknown,label:string)=>{if(typeof value!=='string'||!value.trim()||value.trim().length>70||/[\x00-\x1f\x7f]/.test(value))fail(400,'Укажите '+label+' от 1 до 70 символов',label==='имя'?'FIRST_NAME':'LAST_NAME');return value.trim()};
   return {firstName:name(input.firstName,'имя'),lastName:name(input.lastName,'фамилию')};
  },
  async photo(value:unknown):Promise<Buffer|null>{
   if(value===undefined||value===null||value==='')return null;
   if(typeof value!=='string'||value.length>6700000)fail(400,'Выберите JPG, PNG или WebP размером до 5 МБ','PHOTO');
   const match=value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
   if(!match)fail(400,'Выберите фотографию в формате JPG, PNG или WebP','PHOTO');
   const bytes=Buffer.from(match[2],'base64');
   if(bytes.length>5000000||bytes.length<12||bytes.toString('base64')!==match[2])fail(400,'Выберите непустое фото размером до 5 МБ','PHOTO');
   return await new Promise((resolve,reject)=>{
    const child=execFile(existsSync('/opt/asr/bin/python')?'/opt/asr/bin/python':'python3',[fileURLToPath(new URL('./profile-image.py',import.meta.url))],{encoding:'buffer',timeout:15000,maxBuffer:2*1024**2},(err,out)=>{if(err)reject(Object.assign(new Error('Не удалось открыть фото. Выберите другой JPG, PNG или WebP'),{status:400,publicCode:'PHOTO'}));else resolve(out)});
    child.stdin.on('error',()=>{});child.stdin.end(bytes);
   });
  },
 };
}
