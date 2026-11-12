import {createHmac, randomUUID, timingSafeEqual} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';

type Member = {id:string;role:string};
type Person = {id:string;workspaces:Member[]};
type Reference = {workspaceId:string;studyId:string;segmentId:string};
type Example = {
  scope:'project'|'global';
  question:string;
  answer:string;
  model:string;
  modelId?:string;
  projectIds:string[];
  references:Reference[];
  kind:'generated'|'no-evidence';
};
type Receipt = Example & {id:string;author:string;grants:Member[];build:string;issued:number};

function reject(status:number,message:string):never {
  throw Object.assign(new Error(message),{status});
}

export function createAnswerFeedback(db:DatabaseSync,secret:string,build:string) {
  db.exec(`CREATE TABLE IF NOT EXISTS mnema_answer_feedback(
    answer_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, rating TEXT NOT NULL CHECK(rating IN ('up','down')),
    example TEXT NOT NULL, updated INTEGER NOT NULL
  )`);
  const sign=(content:string)=>createHmac('sha256',secret).update('answer-feedback:v1:').update(content).digest();
  function issue(person:Person, example:Example) {
    const grants=[...new Set(example.projectIds)].map(id=>{
      const member=person.workspaces.find(w=>w.id===id);
      if(!member)reject(403,'Доступ к проекту изменился.');
      return {id,role:member.role};
    });
    const receipt:Receipt={...example,grants,author:person.id,id:randomUUID(),issued:Date.now(),build};
    const content=Buffer.from(JSON.stringify(receipt)).toString('base64url');
    return content+'.'+sign(content).toString('base64url');
  }
  function rate(person:Person,token:unknown,rating:unknown) {
    if(rating!=='up'&&rating!=='down'&&rating!==null)reject(400,'Неизвестная оценка.');
    if(typeof token!=='string')reject(400,'Ответ не найден.');
    const parts=token.split('.');
    const signature=Buffer.from(parts[1]||'','base64url');
    if(parts.length!==2||signature.length!==32||!timingSafeEqual(signature,sign(parts[0])))reject(403,'Не удалось проверить ответ.');
    const example:Receipt=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
    if(example.author!==person.id)reject(403,'Это ответ другого пользователя.');
    if(rating===null){
      db.prepare('DELETE FROM mnema_answer_feedback WHERE answer_id=? AND user_id=?').run(example.id,person.id);
      return {rating:null};
    }
    for(const grant of example.grants){
      const current=person.workspaces.find(w=>w.id===grant.id);
      if(!current||(grant.role==='full'&&current.role!=='full'))reject(403,'Доступ к проекту изменился.');
      const ids=new Set(example.references.filter(r=>r.workspaceId===grant.id).map(r=>r.studyId));
      if(ids.size){
        const row=db.prepare('SELECT data FROM mnema_workspaces WHERE id=?').get(grant.id);
        const present=new Set(row?JSON.parse(String(row.data)).studies.map(s=>s.id):[]);
        if([...ids].some(id=>!present.has(id)))reject(409,'Материал ответа удалён.');
      }
    }
    db.prepare(`INSERT INTO mnema_answer_feedback VALUES(?,?,?,?,?)
      ON CONFLICT(answer_id) DO UPDATE SET rating=excluded.rating,updated=excluded.updated`)
      .run(example.id,person.id,rating as string,JSON.stringify(example),Date.now());
    return {rating};
  }
  function forgetStudy(workspaceId:string,studyId:string) {
    db.prepare(`DELETE FROM mnema_answer_feedback WHERE EXISTS (
      SELECT 1 FROM json_each(example,'$.references') r
      WHERE json_extract(r.value,'$.workspaceId')=? AND json_extract(r.value,'$.studyId')=?
    )`).run(workspaceId,studyId);
  }
  return {issue,rate,forgetStudy};
}
