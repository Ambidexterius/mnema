import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createIdeas} from './ideas.ts';

test('inline feedback adds only known interface metadata and preserves earlier ideas',()=>{
  const db=new DatabaseSync(':memory:');
  try{
    db.exec("CREATE TABLE user(id TEXT PRIMARY KEY,name TEXT,email TEXT); CREATE TABLE mnema_ideas(id TEXT PRIMARY KEY,user_id TEXT,text TEXT,status TEXT DEFAULT 'open',reason TEXT DEFAULT '',hidden INTEGER DEFAULT 0,notified TEXT DEFAULT '',created INTEGER,updated INTEGER); INSERT INTO mnema_ideas(id,user_id,text,created,updated) VALUES('old','a','Старая идея',0,0)");
    const person={id:'a',owner:false};
    const ideas=createIdeas(db,{baseURL:'https://mnemo.test'});
    const feedback={page:'research',element:'heading',category:'accessibility'};
    assert.throws(()=>ideas.create(person,{text:'Закрытый проект',feedback:{...feedback,page:'/projects/secret'}}),/Выберите/);
    assert.throws(()=>ideas.create(person,{text:'Категория',feedback:{...feedback,category:'toString'}}),/Выберите/);
    const {id}=ideas.create(person,{text:'Улучшить заголовок',feedback:{...feedback,selection:'Закрытые данные'}});
    ideas.edit(person,id,{text:'Уточнить заголовок'});
    const list=createIdeas(db,{baseURL:'https://mnemo.test'}).list(person);
    assert.equal(list.length,2);
    assert.deepEqual(list.find(item=>item.id===id)?.feedback,feedback);
    assert.equal(list.find(item=>item.id==='old')?.feedback,undefined);
  }finally{db.close()}
});

test('feedback location permits canonical paths and discards untrusted fields',()=>{
  const db=new DatabaseSync(':memory:');
  try{
    db.exec('CREATE TABLE user(id TEXT PRIMARY KEY,name TEXT,email TEXT)');
    const person={id:'author',owner:false};
    const ideas=createIdeas(db,{baseURL:'https://mnemo.test'});
    const context={page:'research',element:'button',category:'content'};
    const write=(location:unknown,canOpen=()=>true)=>ideas.create(person,{text:'Подписать кнопку',feedback:{...context,location}},canOpen);
    for(const location of [
      null, 'plain', {}, {path:'/chat\n'}, {path:'/projects?share=token'}, {path:'/chat#draft'},
      {path:'https://mnemo.test/projects'}, {path:'//example.test/projects'}, {path:'/projects/./x'},
      {path:'/projects/x/'}, {path:'/projects/x/study/y'}, {path:'/projects/x/studies/%2e%2e'},
      {path:'/projects/x/settings'}, {path:'/conversation/x/messages'}, {path:'/projects/x\\stray'},
      {path:'/projects',anchor:'button[name]'}, {path:'/projects',anchor:'id\n'},
      {path:'/projects',anchor:'x'.repeat(513)}, {path:'/projects',anchor:null},
      {path:'/projects',label:'x'.repeat(121)}, {path:'/projects',label:'Ссылка\u202E'},
    ])assert.throws(()=>write(location),{status:400});
    const anchor='ui-projects:create'.padEnd(512,'_');
    const location={path:'/projects',anchor,label:' Кнопка «Создать» '};
    const allowed=write({...location,share:'private-token'}).id;
    const denied=write(location,()=>false).id;
    const absent=write({path:'/projects/main/research'}).id;
    const list=ideas.list(person,()=>true);
    assert.deepEqual(list.find(item=>item.id===allowed)?.feedback,{...context,location:{path:'/projects',anchor,label:'Кнопка «Создать»'}});
    assert.deepEqual(list.find(item=>item.id===denied)?.feedback,context);
    assert.deepEqual(list.find(item=>item.id===absent)?.feedback,{...context,location:{path:'/projects/main/research'}});
    assert.deepEqual(ideas.list(person,()=>false).map(item=>item.feedback),[context,context,context]);
  }finally{db.close()}
});

test('ideas: anyone writes, votes and comments; owner moderates; final statuses mail author and voters once',async()=>{
  const db=new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE user(id TEXT PRIMARY KEY,name TEXT,email TEXT);CREATE TABLE mnema_access(user_id TEXT,admin INTEGER DEFAULT 0,revoked INTEGER DEFAULT 0)');
    for(const [id,name] of [['a','Анна'],['b','Борис'],['o','Глеб']]){db.prepare('INSERT INTO user VALUES(?,?,?)').run(id,name,id+'@x.ru');db.prepare('INSERT INTO mnema_access(user_id) VALUES(?)').run(id)}
    db.prepare("UPDATE mnema_access SET admin=1 WHERE user_id='o'").run();
    const sent:string[]=[];
    const ideas=createIdeas(db,{baseURL:'https://mnemo.test',send:async m=>{sent.push(m.to+' '+m.subject)}});
    const anna={id:'a',owner:false},boris={id:'b',owner:false},gleb={id:'o',owner:true};
    assert.throws(()=>ideas.create(anna,{text:' '}),/Опишите/);
    const {id}=ideas.create(anna,{text:'Экспорт находок в Excel'});
    await new Promise(r=>setTimeout(r,0));
    assert.deepEqual(sent,['o@x.ru Новая идея: Экспорт находок в Excel'],'owner hears about a new idea');sent.length=0;
    ideas.create(gleb,{text:'Своя идея владельца'});await new Promise(r=>setTimeout(r,0));assert.equal(sent.length,0,'owner is not mailed about own idea');
    assert.deepEqual(ideas.vote(boris,id,true),{votes:2,voted:true});
    ideas.vote(boris,id,true);
    const item=ideas.list(boris).find(i=>i.id===id)!;
    assert.equal(item.votes,2);assert(item.voted);assert(!item.mine);assert.equal(item.author,'Анна');assert.equal(item.status,'open');
    ideas.comment(boris,id,{text:'Нужно и мне'});
    assert.equal(ideas.comments(anna,id)[0].author,'Борис');
    ideas.comment(anna,id,{text:'Спасибо'});ideas.comment(gleb,id,{text:'Берём'});
    assert.deepEqual(ideas.comments(boris,id).map(c=>c.role),['','author','admin'],'author and admin badges');
    await assert.rejects(ideas.moderate(anna,id,{status:'done'}),/администратор/);
    await assert.rejects(ideas.moderate(gleb,id,{status:'declined'}),/причину/);
    await ideas.moderate(gleb,id,{status:'progress'});
    assert.equal(sent.length,0,'no mail for intermediate status');
    await ideas.moderate(gleb,id,{status:'done'});
    assert.deepEqual(sent.map(s=>s.split(' ')[0]).sort(),['a@x.ru','b@x.ru']);
    await ideas.moderate(gleb,id,{status:'progress'});await ideas.moderate(gleb,id,{status:'done'});
    assert.equal(sent.length,2,'done twice mails once');
    await ideas.moderate(gleb,id,{status:'declined',reason:'Есть выгрузка CSV'});
    assert.equal(sent.length,4);assert.equal(ideas.list(anna).find(i=>i.id===id)!.reason,'Есть выгрузка CSV');
    await ideas.moderate(gleb,id,{hidden:true});
    assert.equal(ideas.list(anna).length,1);assert.equal(ideas.list(gleb).length,2);
    assert.throws(()=>ideas.vote(anna,id,true),/не найдена/);
    ideas.rate(anna,'up');assert.throws(()=>ideas.rate(anna,'meh'));
  } finally {db.close()}
});


test('only the author edits an idea before 24 hours; edits preserve creation, votes, comments and status',t=>{
 t.mock.timers.enable({apis:['Date'],now:1800000000000});
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('CREATE TABLE user(id TEXT PRIMARY KEY,name TEXT,email TEXT);CREATE TABLE mnema_access(user_id TEXT,admin INTEGER DEFAULT 0,revoked INTEGER DEFAULT 0)');
  for(const id of ['a','b','o'])db.prepare('INSERT INTO user VALUES(?,?,?)').run(id,id,id+'@example.test');
  const ideas=createIdeas(db,{baseURL:'https://mnemo.test'}),author={id:'a',owner:false},other={id:'b',owner:false},owner={id:'o',owner:true};
  const {id}=ideas.create(author,{text:'Исходная идея'}),created=Date.now();ideas.vote(other,id,true);ideas.comment(other,id,{text:'Комментарий'});
  const before=db.prepare('SELECT * FROM mnema_ideas WHERE id=?').get(id)!;
  const rejected=(person:any,text:string,status:number)=>assert.throws(()=>ideas.edit(person,id,{text}),(e:any)=>e.status===status);
  rejected(other,'Подмена текста',403);rejected(owner,'Подмена владельцем',403);rejected(author,' ',400);rejected(author,'x'.repeat(2001),400);
  t.mock.timers.tick(86400000-1);
  ideas.edit(author,id,{text:'  Уточнённая идея  ',created:Date.now(),user_id:'b',status:'done'});
  const after=db.prepare('SELECT * FROM mnema_ideas WHERE id=?').get(id)!;
  assert.equal(after.text,'Уточнённая идея');assert.equal(after.created,created);assert.equal(after.updated,Date.now());assert.equal(after.user_id,before.user_id);assert.equal(after.status,before.status);
  assert.equal(ideas.list(author)[0].votes,2);assert.equal(ideas.comments(author,id)[0].text,'Комментарий');
  t.mock.timers.tick(1);rejected(author,'Опоздавшая правка',403);assert.equal(db.prepare('SELECT text FROM mnema_ideas WHERE id=?').get(id)!.text,'Уточнённая идея');
  assert.throws(()=>ideas.edit(author,'missing',{text:'Текст'}),(e:any)=>e.status===404);
 }finally{db.close()}
});

test('only the author deletes an idea before 24 hours; votes and comments go with it',t=>{
 t.mock.timers.enable({apis:['Date'],now:1800000000000});
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('CREATE TABLE user(id TEXT PRIMARY KEY,name TEXT,email TEXT);CREATE TABLE mnema_access(user_id TEXT,admin INTEGER DEFAULT 0,revoked INTEGER DEFAULT 0)');
  const ideas=createIdeas(db,{baseURL:'https://mnemo.test'}),author={id:'a',owner:false},other={id:'b',owner:false},owner={id:'o',owner:true};
  const {id}=ideas.create(author,{text:'Удаляемая идея'}),{id:kept}=ideas.create(author,{text:'Остаётся'});
  ideas.vote(other,id,true);ideas.comment(other,id,{text:'Комментарий'});ideas.comment(other,kept,{text:'Чужой'});
  const rejected=(person:any,target:string,status:number)=>assert.throws(()=>ideas.remove(person,target),(e:any)=>e.status===status);
  rejected(other,id,403);rejected(owner,id,403);rejected(author,'missing',404);
  t.mock.timers.tick(86400000-1);ideas.remove(author,id);
  const count=(table:string,column:string)=>Number((db.prepare('SELECT count(*) AS n FROM '+table+' WHERE '+column+'=?').get(id) as any).n);
  assert.deepEqual([count('mnema_ideas','id'),count('mnema_idea_votes','idea_id'),count('mnema_idea_comments','idea_id')],[0,0,0]);
  assert.deepEqual(ideas.list(author).map(i=>i.id),[kept]);assert.equal(ideas.comments(author,kept).length,1);
  t.mock.timers.tick(1);rejected(author,kept,403);assert.equal(ideas.list(author).length,1);
 }finally{db.close()}
});
