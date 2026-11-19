import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {initialNews,type NewsPost} from '../app/product-news.ts';

function invalid(message:string,status=400):never{throw Object.assign(new Error(message),{status})}

function newsFields(body:any){
 const title=body?.title??'';
 if(typeof title!=='string'||title.trim().length>160)invalid('Заголовок слишком длинный.');
 if(typeof body?.description!=='string'||!body.description.trim()||body.description.length>24000)invalid('Введите текст новости до 24 000 символов.');
 return {title:title.trim(),description:body.description};
}

export function createProductNews(db:DatabaseSync){
 db.exec('CREATE TABLE IF NOT EXISTS mnema_news(seq INTEGER PRIMARY KEY,id TEXT UNIQUE NOT NULL,date TEXT,title TEXT NOT NULL,description TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1)');
 const insert=db.prepare('INSERT INTO mnema_news(id,date,title,description) VALUES(?,?,?,?)');
 const exists=db.prepare('SELECT 1 FROM mnema_news WHERE id=?');
 db.exec('BEGIN');
 try{
  for(const post of [...initialNews].reverse())if(!exists.get(post.id))insert.run(post.id,post.date,post.title,post.description);
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error}
 const list=db.prepare('SELECT id,date,title,description,revision FROM mnema_news ORDER BY seq DESC');
 const latest=db.prepare('SELECT id FROM mnema_news ORDER BY seq DESC LIMIT 1');
 const update=db.prepare('UPDATE mnema_news SET title=?,description=?,revision=revision+1 WHERE id=? AND revision=?');
 return {
  list:()=>list.all() as unknown as NewsPost[],
  latest:()=>latest.get()!.id as string,
  create(body:unknown){
   const {title,description}=newsFields(body);
   const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow'}).format(new Date());
   insert.run(randomUUID(),date,title,description);
  },
  edit(id:string,body:any){
   const {title,description}=newsFields(body);
   if(!Number.isSafeInteger(body.revision)||body.revision<1)invalid('Откройте новость заново.');
   if(update.run(title,description,id,body.revision).changes)return;
   if(!exists.get(id))invalid('Новость не найдена.',404);
   invalid('Новость уже изменили. Ваш текст остался в редакторе.',409);
  },
 };
}
