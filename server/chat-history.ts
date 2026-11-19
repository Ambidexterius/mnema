import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';

type Person={id:string;workspaces:{id:string;role:string;admin?:boolean}[]};
const reject=(status:number,message:string):never=>{throw Object.assign(new Error(message),{status})};
/** Private conversations. Revalidate the original grants and evidence before replaying any turn. */
export function createChatHistory(db:DatabaseSync,readProject?:(person:Person,workspaceId:string)=>any[]){
 db.exec(`CREATE TABLE IF NOT EXISTS mnema_chats(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,title TEXT NOT NULL,messages TEXT NOT NULL,grants TEXT NOT NULL,updated INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS mnema_chats_user_updated ON mnema_chats(user_id,updated DESC)`);
 // Optional binding: a chat started from a project answers from that project first.
 if(!db.prepare('PRAGMA table_info(mnema_chats)').all().some((c:any)=>c.name==='project_id'))db.exec('ALTER TABLE mnema_chats ADD COLUMN project_id TEXT');
 const busy=new Set<string>();
 const row=(person:Person,id:string)=>{const r=db.prepare('SELECT * FROM mnema_chats WHERE id=? AND user_id=?').get(id,person.id);if(!r)reject(404,'Чат не найден.');return r};
 function readable(person:Person,r:any,projects=new Map<string,any[]>()){
  if(r.project_id&&!person.workspaces.some(w=>w.id===r.project_id))return false;
  // Visibility follows the cited fragments only. The person already read these answers, so a role change or losing a project the chat never cited must not hide it.
  for(const m of JSON.parse(r.messages))for(const s of m.sources||[]){
   if(!person.workspaces.some(w=>w.id===s.workspaceId))return false;
   if(!projects.has(s.workspaceId)){
    const project=readProject?readProject(person,s.workspaceId):JSON.parse(String(db.prepare('SELECT data FROM mnema_workspaces WHERE id=?').get(s.workspaceId)?.data||'{"studies":[]}')).studies;
    projects.set(s.workspaceId,project);
   }
   const segment=projects.get(s.workspaceId)?.find(st=>st.id===s.studyId)?.segments?.find(seg=>seg.id===(s.segmentId||s.id));
   if(!segment||(segment.correctedText??segment.text)!==s.text)return false;
  }
  return true;
 }
 const decode=(r:any)=>({id:r.id,title:r.title,projectId:r.project_id||null,messages:JSON.parse(r.messages),updated:r.updated});
 function get(person:Person,id:string){const r=row(person,id);if(!readable(person,r))reject(409,'Источники или доступ к ним изменились. Начните новый чат.');return decode(r)}
 function list(person:Person){const projects=new Map<string,any[]>();return db.prepare('SELECT * FROM mnema_chats WHERE user_id=? ORDER BY updated DESC').all(person.id).filter(r=>readable(person,r,projects)).map(r=>({id:r.id,title:r.title,projectId:r.project_id||null,updated:r.updated}))}
 function create(person:Person,projectId:string|null=null){if(projectId&&!person.workspaces.some(w=>w.id===projectId))reject(404,'Проект не найден.');const id=randomUUID();db.prepare('INSERT INTO mnema_chats(id,user_id,title,messages,grants,updated,project_id) VALUES(?,?,?,?,?,?,?)').run(id,person.id,'Новый чат','[]','[]',Date.now(),projectId);return get(person,id)}
 function remove(person:Person,id:string){row(person,id);if(busy.has(id))reject(409,'Дождитесь ответа перед удалением чата.');db.prepare('DELETE FROM mnema_chats WHERE id=? AND user_id=?').run(id,person.id)}
 function acquire(person:Person,id:string){const chat=get(person,id);if(busy.has(id))reject(409,'В этом чате уже готовится ответ.');if(chat.messages.length>=200)reject(409,'В чате уже 100 вопросов. Начните новый чат.');busy.add(id);return chat}
 function append(person:Person,id:string,question:string,answer:any){
  const chat=get(person,id),r=row(person,id);
  const messages=[...chat.messages,{id:randomUUID(),role:'user',text:question},{id:randomUUID(),role:'assistant',...answer}];
  const next={...r,messages:JSON.stringify(messages)};
  if(!readable(person,next))reject(409,'Источники изменились. Начните новый чат.');
  db.prepare('UPDATE mnema_chats SET title=?,messages=?,updated=? WHERE id=? AND user_id=?').run(chat.messages.length?chat.title:question.slice(0,80),next.messages,Date.now(),id,person.id);
  return get(person,id);
 }
 return {list,get,create,remove,acquire,append,release:(id:string)=>busy.delete(id)};
}
