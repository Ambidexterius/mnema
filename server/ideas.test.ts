import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createIdeas} from './ideas.ts';

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
