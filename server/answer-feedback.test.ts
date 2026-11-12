import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createAnswerFeedback} from './answer-feedback.ts';

test('rating is optional, bound to the author and every source project, and removable',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE mnema_workspaces(id TEXT PRIMARY KEY,data TEXT NOT NULL)');
    for(const id of ['a','b'])db.prepare('INSERT INTO mnema_workspaces VALUES(?,?)').run(id,JSON.stringify({studies:[{id:'material'}]}));
    const api=createAnswerFeedback(db,'fixture signing secret','fixture-build');
    const owner={id:'u',workspaces:[{id:'a',role:'view'},{id:'b',role:'full'}]};
    const receipt=api.issue(owner,{scope:'global',kind:'generated',question:'Вопрос?',answer:'Ответ [1].',model:'Test',
      projectIds:['a','b'],references:[{workspaceId:'a',studyId:'material',segmentId:'s'}]});
    const rows=()=>db.prepare('SELECT rating,example FROM mnema_answer_feedback').all();
    assert.equal(rows().length,0);
    assert.throws(()=>api.rate({...owner,id:'other'},receipt,'up'));
    assert.throws(()=>api.rate({...owner,workspaces:owner.workspaces.slice(0,1)},receipt,'up'));
    assert.throws(()=>api.rate({...owner,workspaces:owner.workspaces.map(w=>({...w,role:'view'}))},receipt,'down'));
    assert.throws(()=>api.rate(owner,receipt.replace(/^./,'x'),'up'));
    api.rate(owner,receipt,'up');api.rate(owner,receipt,'down');api.rate(owner,receipt,'down');
    assert.equal(rows().length,1);assert.equal(rows()[0].rating,'down');
    assert.equal(JSON.parse(String(rows()[0].example)).answer,'Ответ [1].');
    api.rate(owner,receipt,null);assert.equal(rows().length,0);
    api.rate(owner,receipt,'up');api.forgetStudy('b','material');assert.equal(rows().length,1);
    db.prepare('UPDATE mnema_workspaces SET data=? WHERE id=?').run('{"studies":[]}','a');
    api.forgetStudy('a','material');assert.equal(rows().length,0);
    assert.throws(()=>api.rate(owner,receipt,'up'));
  } finally {db.close()}
});
