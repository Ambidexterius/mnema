import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createChatHistory} from './chat-history.ts';

const owner={id:'owner',workspaces:[{id:'a',role:'full'}]},reader={id:'reader',workspaces:[{id:'a',role:'view'}]};
function fixture(){const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE mnema_workspaces(id TEXT PRIMARY KEY,data TEXT)');db.prepare('INSERT INTO mnema_workspaces VALUES(?,?)').run('a',JSON.stringify({studies:[{id:'s',segments:[{id:'seg',text:'Evidence'}]}]}));return {db,store:createChatHistory(db)}}
const answer={answer:'Answer [1]',sources:[{workspaceId:'a',studyId:'s',segmentId:'seg',text:'Evidence'}]};
test('conversations persist, remain private, and deletion leaves research intact',()=>{const {db,store}=fixture();try{const chat=store.create(owner);store.acquire(owner,chat.id);store.append(owner,chat.id,'First question',answer);store.release(chat.id);const reloaded=createChatHistory(db);assert.equal(reloaded.get(owner,chat.id).messages.length,2);assert.equal(reloaded.list(owner)[0].title,'First question');assert.deepEqual(reloaded.list(reader),[]);assert.throws(()=>reloaded.get(reader,chat.id),{status:404});assert.throws(()=>reloaded.remove(reader,chat.id),{status:404});reloaded.remove(owner,chat.id);assert.deepEqual(reloaded.list(owner),[]);assert.equal(db.prepare('SELECT count(*) AS n FROM mnema_workspaces').get().n,1)}finally{db.close()}});
test('revocation, downgrade, changed or deleted evidence block both history and replay',()=>{for(const change of ['revoked','downgraded','edited','deleted']){const {db,store}=fixture();try{const chat=store.create(owner);store.append(owner,chat.id,'Question',answer);let person=owner;if(change==='revoked')person={...owner,workspaces:[]};if(change==='downgraded')person={...owner,workspaces:[{id:'a',role:'view'}]};if(change==='edited'||change==='deleted')db.prepare('UPDATE mnema_workspaces SET data=?').run(JSON.stringify({studies:change==='deleted'?[]:[{id:'s',segments:[{id:'seg',text:'Changed'}]}]}));assert.deepEqual(store.list(person),[],change);assert.throws(()=>store.get(person,chat.id),{status:409});assert.throws(()=>store.acquire(person,chat.id),{status:409});store.remove(person,chat.id)}finally{db.close()}}});
test('only one generation per chat; an in-flight chat cannot be removed',()=>{const {db,store}=fixture();try{const chat=store.create(owner);store.acquire(owner,chat.id);assert.throws(()=>store.acquire(owner,chat.id),{status:409});assert.throws(()=>store.remove(owner,chat.id),{status:409});store.release(chat.id);store.acquire(owner,chat.id);store.append(owner,chat.id,'First',answer);store.release(chat.id);store.acquire(owner,chat.id);store.append(owner,chat.id,'Follow-up',answer);store.release(chat.id);assert.equal(store.get(owner,chat.id).messages.length,4);assert.equal(store.get(owner,chat.id).title,'First')}finally{db.close()}});

test('history remembers full access used after an upgrade',()=>{const {db,store}=fixture();try{const initial={...owner,workspaces:[{id:'a',role:'view'}]};const chat=store.create(initial);store.append(initial,chat.id,'Reader question',answer);store.append(owner,chat.id,'Full access follow-up',answer);assert.throws(()=>store.get(initial,chat.id),{status:409});assert.equal(store.get(owner,chat.id).messages.length,4)}finally{db.close()}});

test('current source visibility is rechecked for history and continuation',()=>{const {db,store}=fixture();try{const chat=store.create(owner);store.append(owner,chat.id,'Question',answer);const restricted=createChatHistory(db,()=>[]);assert.throws(()=>restricted.get(owner,chat.id),{status:409});assert.deepEqual(restricted.list(owner),[]);assert.throws(()=>restricted.acquire(owner,chat.id),{status:409})}finally{db.close()}});

test('a chat bound to a project needs access to it and is hidden once that access is gone',()=>{const {db,store}=fixture();try{
 assert.throws(()=>store.create(owner,'foreign'),{status:404});
 const chat=store.create(owner,'a');assert.equal(chat.projectId,'a');assert.equal(store.list(owner)[0].projectId,'a');assert.equal(store.create(owner).projectId,null);
 const removed={...owner,workspaces:[]};assert(!store.list(removed).some(c=>c.id===chat.id));assert.throws(()=>store.get(removed,chat.id),{status:409});
}finally{db.close()}});
test('an existing chat table gains the project column without losing conversations',()=>{const db=new DatabaseSync(':memory:');try{
 db.exec('CREATE TABLE mnema_chats(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,title TEXT NOT NULL,messages TEXT NOT NULL,grants TEXT NOT NULL,updated INTEGER NOT NULL)');
 db.prepare('INSERT INTO mnema_chats VALUES(?,?,?,?,?,?)').run('old','owner','Старый чат','[]','[]',1);
 const store=createChatHistory(db);assert.deepEqual(store.list(owner),[{id:'old',title:'Старый чат',projectId:null,updated:1}]);createChatHistory(db);
}finally{db.close()}});
