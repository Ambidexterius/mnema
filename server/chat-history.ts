import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';

type Person={id:string;workspaces:{id:string;role:string;admin?:boolean}[]};
const reject=(status:number,message:string):never=>{throw Object.assign(new Error(message),{status})};
/** Private conversations. Revalidate the original grants and evidence before replaying any turn. */
export function createChatHistory(db:DatabaseSync,readProject?:(person:Person,workspaceId:string)=>any[]){
 db.exec(`CREATE TABLE IF NOT EXISTS mnema_chats(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,title TEXT NOT NULL,messages TEXT NOT NULL,grants TEXT NOT NULL,updated INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS mnema_chats_user_updated ON mnema_chats(user_id,updated DESC)`);
 const busy=new Set<string>();
 const row=(person:Person,id:string)=>{const r=db.prepare('SELECT * FROM mnema_chats WHERE id=? AND user_id=?').get(id,person.id);if(!r)reject(404,'Чат не найден.');return r};
 function readable(person:Person,r:any,projects=new Map<string,any[]>()){
  if(JSON.parse(String(r.grants)).some(g=>{const w=person.workspaces.find(w=>w.id===g.id);return !w||(g.role==='full'&&w.role!=='full')}))return false;
  for(const m of JSON.parse(r.messages))for(const s of m.sources||[]){
   if(!projects.has(s.workspaceId)){
    const project=readProject?readProject(person,s.workspaceId):JSON.parse(String(db.prepare('SELECT data FROM mnema_workspaces WHERE id=?').get(s.workspaceId)?.data||'{"studies":[]}')).studies;
    projects.set(s.workspaceId,project);
   }
   const segment=projects.get(s.workspaceId)?.find(st=>st.id===s.studyId)?.segments?.find(seg=>seg.id===(s.segmentId||s.id));
   if(!segment||(segment.correctedText??segment.text)!==s.text)return false;
  }
  return true;
 }
 const decode=(r:any)=>({id:r.id,title:r.title,messages:JSON.parse(r.messages),updated:r.updated});
 function get(person:Person,id:string){const r=row(person,id);if(!readable(person,r))reject(409,'Источники или доступ к ним изменились. Начните новый чат.');return decode(r)}
 function list(person:Person){const projects=new Map<string,any[]>();return db.prepare('SELECT * FROM mnema_chats WHERE user_id=? ORDER BY updated DESC').all(person.id).filter(r=>readable(person,r,projects)).map(r=>({id:r.id,title:r.title,updated:r.updated}))}
 function create(person:Person){const id=randomUUID();db.prepare('INSERT INTO mnema_chats VALUES(?,?,?,?,?,?)').run(id,person.id,'Новый чат','[]','[]',Date.now());return get(person,id)}
 function remove(person:Person,id:string){row(person,id);if(busy.has(id))reject(409,'Дождитесь ответа перед удалением чата.');db.prepare('DELETE FROM mnema_chats WHERE id=? AND user_id=?').run(id,person.id)}
 function acquire(person:Person,id:string){const chat=get(person,id);if(busy.has(id))reject(409,'В этом чате уже готовится ответ.');if(chat.messages.length>=200)reject(409,'В чате уже 100 вопросов. Начните новый чат.');busy.add(id);return chat}
 function append(person:Person,id:string,question:string,answer:any){
  const chat=get(person,id),r=row(person,id),grants=JSON.parse(String(r.grants));
  // A generated answer may use reviewed findings as well as its displayed citations.
  for(const w of person.workspaces){const grant=grants.find(g=>g.id===w.id);if(!grant)grants.push({id:w.id,role:w.role});else if(w.role==='full')grant.role='full'}
  const messages=[...chat.messages,{id:randomUUID(),role:'user',text:question},{id:randomUUID(),role:'assistant',...answer}];
  const next={...r,messages:JSON.stringify(messages),grants:JSON.stringify(grants)};
  if(!readable(person,next))reject(409,'Источники изменились. Начните новый чат.');
  db.prepare('UPDATE mnema_chats SET title=?,messages=?,grants=?,updated=? WHERE id=? AND user_id=?').run(chat.messages.length?chat.title:question.slice(0,80),next.messages,next.grants,Date.now(),id,person.id);
  return get(person,id);
 }
 return {list,get,create,remove,acquire,append,release:(id:string)=>busy.delete(id)};
}
