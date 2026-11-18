import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import type {CompletionMail} from './completion-mail.ts';
import {feedbackCategories,feedbackElements,feedbackPages,isFeedbackPath,type FeedbackContext,type FeedbackLocation} from '../app/feedback-context.ts';

export type IdeaStatus = 'open'|'progress'|'done'|'declined';
const STATUSES:IdeaStatus[] = ['open','progress','done','declined'];
const NOTIFY:Record<string,string> = {done:'Идея реализована',declined:'Идея отклонена'};
type Person = {id:string;owner:boolean};
type CanOpenLocation = (location:FeedbackLocation)=>boolean;

function reject(status:number,message:string):never {
  throw Object.assign(new Error(message),{status});
}
const clean=(v:unknown,max:number)=>typeof v==='string'?v.trim().slice(0,max):'';
const escape=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
function feedbackLocation(value:unknown):FeedbackLocation|undefined{
  if(!value||typeof value!=='object')return;
  const {path,anchor,label}=value as Record<string,unknown>;
  if(!isFeedbackPath(path))return;
  if(anchor!==undefined&&(typeof anchor!=='string'||!anchor.length||anchor.length>512||/[^\w:-]/.test(anchor)))return;
  if(label!==undefined&&(typeof label!=='string'||label.length>120||/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(label)))return;
  return {path,...(typeof anchor==='string'?{anchor}:{}),...(typeof label==='string'&&label.trim()?{label:label.trim()}:{})};
}

// Ideas board: every signed-in user writes, votes and comments; only the owner changes status or hides.
// Author and voters get one email when an idea first reaches «done» or «declined».
export function createIdeas(db:DatabaseSync,{baseURL,send}:{baseURL:string;send?:(message:CompletionMail)=>Promise<void>}) {
  db.exec(`CREATE TABLE IF NOT EXISTS mnema_ideas(
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
    reason TEXT NOT NULL DEFAULT '', hidden INTEGER NOT NULL DEFAULT 0, notified TEXT NOT NULL DEFAULT '',
    created INTEGER NOT NULL, updated INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS mnema_idea_votes(idea_id TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY(idea_id,user_id));
  CREATE TABLE IF NOT EXISTS mnema_idea_comments(id TEXT PRIMARY KEY, idea_id TEXT NOT NULL, user_id TEXT NOT NULL, text TEXT NOT NULL, created INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS mnema_interface_ratings(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, rating TEXT NOT NULL CHECK(rating IN ('up','down')), created INTEGER NOT NULL)`);
  if(!db.prepare('PRAGMA table_info(mnema_ideas)').all().some(column=>column.name==='feedback'))db.exec("ALTER TABLE mnema_ideas ADD COLUMN feedback TEXT NOT NULL DEFAULT ''");
  const q=(sql:string)=>db.prepare(sql) as any;
  const find=(person:Person,id:unknown)=>{
    const idea=q('SELECT * FROM mnema_ideas WHERE id=?').get(String(id));
    if(!idea||(idea.hidden&&!person.owner))reject(404,'Идея не найдена.');
    return idea;
  };
  function list(person:Person,canOpenLocation?:CanOpenLocation) {
    return (q(`SELECT i.id,i.text,i.status,i.reason,i.hidden,i.created,i.user_id,i.feedback,u.name AS author,
      (SELECT count(*) FROM mnema_idea_votes v WHERE v.idea_id=i.id) AS votes,
      EXISTS(SELECT 1 FROM mnema_idea_votes v WHERE v.idea_id=i.id AND v.user_id=?) AS voted,
      (SELECT count(*) FROM mnema_idea_comments c WHERE c.idea_id=i.id) AS comments
      FROM mnema_ideas i LEFT JOIN user u ON u.id=i.user_id WHERE i.hidden=0 OR ? ORDER BY votes DESC,i.created DESC`).all(person.id,person.owner?1:0) as any[])
      .map(r=>{
        const {location,...context}=r.feedback?JSON.parse(r.feedback) as FeedbackContext:{};
        const safe=feedbackLocation(location);
        return {id:String(r.id),text:String(r.text),status:r.status as IdeaStatus,reason:String(r.reason),hidden:Boolean(r.hidden),created:Number(r.created),
          author:r.author?String(r.author):'Пользователь удалён',mine:r.user_id===person.id,votes:Number(r.votes),voted:Boolean(r.voted),comments:Number(r.comments),
          ...(r.feedback?{feedback:{...context,...(safe&&canOpenLocation?.(safe)?{location:safe}:{})}}:{})};
      });
  }
  function create(person:Person,input:any,canOpenLocation?:CanOpenLocation) {
    const text=clean(input?.text,2000);
    if(text.length<3)reject(400,'Опишите идею.');
    let feedback='';
    if(input?.feedback!==undefined){
      const {page,element,category,location}=input.feedback??{};
      if(typeof page!=='string'||!Object.hasOwn(feedbackPages,page)||typeof element!=='string'||element==='page'||!Object.hasOwn(feedbackElements,element)||
        (category!==undefined&&(typeof category!=='string'||!Object.hasOwn(feedbackCategories,category))))reject(400,'Не удалось определить элемент. Выберите его ещё раз.');
      const safe=feedbackLocation(location);
      if(location!==undefined&&!safe)reject(400,'Не удалось определить элемент. Выберите его ещё раз.');
      feedback=JSON.stringify({page,element,category,...(safe&&canOpenLocation?.(safe)?{location:safe}:{})});
    }
    const id=randomUUID(),now=Date.now();
    db.exec('BEGIN');
    try{
      q('INSERT INTO mnema_ideas(id,user_id,text,created,updated,feedback) VALUES(?,?,?,?,?,?)').run(id,person.id,text,now,now,feedback);
      q('INSERT INTO mnema_idea_votes VALUES(?,?)').run(id,person.id);
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e}
    void notifyOwners(person,text);
    return {id};
  }
  // Author-only changes within 24 hours of sending; checked here, not trusted from the client.
  function own(person:Person,id:unknown,verb:string) {
    const idea=find(person,id);
    if(idea.user_id!==person.id)reject(403,verb+' идею может только её автор.');
    if(Date.now()-idea.created>=86400000)reject(403,verb+' идею можно только в течение суток после отправки.');
    return idea;
  }
  function edit(person:Person,id:unknown,input:any) {
    const idea=own(person,id,'Редактировать'),now=Date.now();
    const text=clean(input?.text,2001);
    if(text.length<3)reject(400,'Опишите идею.');
    if(text.length>2000)reject(400,'Не больше 2 000 символов.');
    q('UPDATE mnema_ideas SET text=?,updated=? WHERE id=?').run(text,now,idea.id);
    return {ok:true};
  }
  function remove(person:Person,id:unknown) {
    const idea=own(person,id,'Удалить');
    db.exec('BEGIN');
    try{for(const table of ['mnema_idea_comments','mnema_idea_votes'])q('DELETE FROM '+table+' WHERE idea_id=?').run(idea.id);q('DELETE FROM mnema_ideas WHERE id=?').run(idea.id);db.exec('COMMIT')}
    catch(e){db.exec('ROLLBACK');throw e}
    return {ok:true};
  }
  function vote(person:Person,id:unknown,on:unknown) {
    const idea=find(person,id);
    if(on)q('INSERT OR IGNORE INTO mnema_idea_votes VALUES(?,?)').run(idea.id,person.id);
    else q('DELETE FROM mnema_idea_votes WHERE idea_id=? AND user_id=?').run(idea.id,person.id);
    return {votes:Number(q('SELECT count(*) AS n FROM mnema_idea_votes WHERE idea_id=?').get(idea.id).n),voted:Boolean(on)};
  }
  function comments(person:Person,id:unknown) {
    const idea=find(person,id);
    // Role badge: the idea's author wins over admin, so an owner's own idea reads «Автор идеи».
    return (q(`SELECT c.id,c.text,c.created,u.name AS author,c.user_id=? AS by_author,
      EXISTS(SELECT 1 FROM mnema_access a WHERE a.user_id=c.user_id AND a.admin=1 AND a.revoked=0) AS by_admin
      FROM mnema_idea_comments c LEFT JOIN user u ON u.id=c.user_id WHERE c.idea_id=? ORDER BY c.created`).all(idea.user_id,idea.id) as any[])
      .map(r=>({id:String(r.id),text:String(r.text),created:Number(r.created),author:r.author?String(r.author):'Пользователь удалён',role:r.by_author?'author':r.by_admin?'admin':''}));
  }
  function comment(person:Person,id:unknown,input:any) {
    const idea=find(person,id);const text=clean(input?.text,2000);
    if(!text)reject(400,'Напишите комментарий.');
    q('INSERT INTO mnema_idea_comments VALUES(?,?,?,?,?)').run(randomUUID(),idea.id,person.id,text,Date.now());
    return {comments:comments(person,idea.id)};
  }
  async function moderate(person:Person,id:unknown,input:any) {
    if(!person.owner)reject(403,'Статусы идей меняет администратор.');
    const idea=find(person,id);
    const status=STATUSES.includes(input?.status)?input.status as IdeaStatus:idea.status;
    const reason=status==='declined'?clean(input?.reason,1000)||idea.reason:'';
    if(status==='declined'&&!reason)reject(400,'Напишите причину отклонения — её увидят все.');
    const hidden=typeof input?.hidden==='boolean'?input.hidden:Boolean(idea.hidden);
    q('UPDATE mnema_ideas SET status=?,reason=?,hidden=?,updated=? WHERE id=?').run(status,reason,hidden?1:0,Date.now(),idea.id);
    if(NOTIFY[status]&&idea.notified!==status&&!hidden){
      q('UPDATE mnema_ideas SET notified=? WHERE id=?').run(status,idea.id);
      await notify({...idea,status,reason});
    }
    return {ok:true};
  }
  async function notify(idea:any) {
    if(!send)return;
    const link=new URL('/chat#ideas',baseURL).href;
    const people=q(`SELECT DISTINCT u.email FROM user u JOIN mnema_access a ON a.user_id=u.id WHERE a.revoked=0 AND u.id IN (
      SELECT user_id FROM mnema_idea_votes WHERE idea_id=? UNION SELECT ?)`).all(idea.id,idea.user_id) as any[];
    const subject=NOTIFY[idea.status]+': '+String(idea.text).replace(/\s+/g,' ').slice(0,100);
    const lines=[NOTIFY[idea.status],idea.text,idea.reason&&'Причина: '+idea.reason,'Все идеи: '+link].filter(Boolean);
    const html='<!doctype html><html lang="ru"><meta charset="utf-8"><body style="font-family:Arial,sans-serif;color:#242424">'+lines.map((l,i)=>i===lines.length-1?'<p><a href="'+escape(link)+'" style="color:#7252a3">Все идеи</a></p>':'<p>'+escape(l).replace(/\n/g,'<br>')+'</p>').join('')+'</body></html>';
    for(const p of people){
      try{await send({to:String(p.email),subject,text:lines.join('\n\n'),html,messageId:'<mnemonika-idea-'+idea.id+'-'+idea.status+'@'+new URL(baseURL).hostname+'>'})}
      catch{console.error('Idea email delivery failed')}
    }
  }
  // The owner learns about every new idea by work email; the author is skipped if they are the owner.
  async function notifyOwners(person:Person,text:string) {
    if(!send)return;
    const author=String(q('SELECT name FROM user WHERE id=?').get(person.id)?.name||'Участник');
    const link=new URL('/chat#ideas',baseURL).href;
    for(const p of q('SELECT u.email FROM user u JOIN mnema_access a ON a.user_id=u.id WHERE a.admin=1 AND a.revoked=0 AND u.id<>?').all(person.id) as any[]){
      try{await send({to:String(p.email),subject:'Новая идея: '+text.replace(/\s+/g,' ').slice(0,100),text:author+' предлагает:\n\n'+text+'\n\nОткрыть идеи: '+link,
        html:'<!doctype html><html lang="ru"><meta charset="utf-8"><body style="font-family:Arial,sans-serif;color:#242424"><p>'+escape(author)+' предлагает:</p><p>'+escape(text).replace(/\n/g,'<br>')+'</p><p><a href="'+escape(link)+'" style="color:#7252a3">Открыть идеи</a></p></body></html>',
        messageId:'<mnemonika-idea-'+randomUUID()+'@'+new URL(baseURL).hostname+'>'})}
      catch{console.error('Idea email delivery failed')}
    }
  }
  function rate(person:Person,rating:unknown) {
    if(rating!=='up'&&rating!=='down')reject(400,'Неизвестная оценка.');
    q('INSERT INTO mnema_interface_ratings VALUES(?,?,?,?)').run(randomUUID(),person.id,rating,Date.now());
    return {ok:true};
  }
  return {list,create,edit,remove,vote,comments,comment,moderate,rate};
}
