import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {completionEmail,createCompletionMailer} from './completion-mail.ts';
import {finishedRecordings,createCompletionAudio} from '../app/completion.ts';
const study:any={id:'recording',title:'Встреча <script>',date:'2026-11-11',addedBy:'QA',format:'Видео',status:'ready',summaryInfo:{state:'ready',review:'draft'},summary:[{title:'Тема <b>',text:'Текст & вывод',segments:['part']}],segments:[{id:'part',time:67,text:'Источник'}]};
test('completion sound detects only new successful recordings, not initial history, retries or documents',()=>{
 assert.deepEqual(finishedRecordings(new Map(),[study]),[]);
 assert.equal(finishedRecordings(new Map([['recording','processing']]),[study]).length,1);
 assert.deepEqual(finishedRecordings(new Map([['recording','ready']]),[study]),[]);
 assert.deepEqual(finishedRecordings(new Map([['recording','processing']]),[{...study,status:'error'}]),[]);
 assert.deepEqual(finishedRecordings(new Map([['recording','processing']]),[{...study,format:'PDF'}]),[]);
});
const audioFixture=()=>{let starts=0,created=0;const context:any={state:'running',destination:{},resume:async()=>{},decodeAudioData:async()=>({}),createBufferSource:()=>({connect(){},start(){starts++}}),close:async()=>{context.state='closed'}};return{context,create:()=>{created++;return context},starts:()=>starts,created:()=>created}};
test('completion audio recovers from a missing asset instead of remaining silent for the tab lifetime',async()=>{
 const fixture=audioFixture();let requests=0;const audio=createCompletionAudio(fixture.create,async()=>new Response(new Uint8Array([1,2]),{status:++requests===1?404:200}));
 await audio.play();assert.equal(fixture.created(),0,'completion must not bypass the initial user gesture');
 await assert.rejects(audio.activate(),/Audio unavailable/);await audio.activate();await audio.play();assert.equal(requests,2);assert.equal(fixture.starts(),1);audio.dispose();
});
test('a completion arriving during audio loading plays once after decoding and never after disposal',async()=>{
 const fixture=audioFixture();let resolve!:(response:Response)=>void;const waiting=new Promise<Response>(r=>resolve=r);let requests=0;const audio=createCompletionAudio(fixture.create,()=>{requests++;return waiting});
 const activate=audio.activate(),play=audio.play();await Promise.resolve();assert.equal(fixture.starts(),0);resolve(new Response(new Uint8Array([1])));await Promise.all([activate,play]);assert.equal(requests,1);assert.equal(fixture.starts(),1);audio.dispose();await audio.play();assert.equal(fixture.starts(),1);
 const other=audioFixture();let release!:(response:Response)=>void;const pending=new Promise<Response>(r=>release=r);const disposed=createCompletionAudio(other.create,()=>pending),activating=disposed.activate(),playing=disposed.play();await Promise.resolve();disposed.dispose();release(new Response(new Uint8Array([1])));await Promise.all([activating,playing]);assert.equal(other.starts(),0);
});
test('completion email escapes contents, links source and project, and excludes AI drafts for readers',()=>{
 const args={study,workspaceId:'space',workspaceName:'Проект',baseURL:'https://example.test',to:'qa@example.test',jobId:'job',canReadDraft:true};const mail=completionEmail(args);
 assert.match(mail.html,/&lt;script&gt;/);assert.doesNotMatch(mail.html,/<script>/);assert.match(mail.text,/Черновик|черновик/);assert.match(mail.html,/projects\/space\/studies\/recording/);assert.match(mail.html,/segment=part/);assert.match(mail.html,/1:07/);
 const reader=completionEmail({...args,canReadDraft:false});assert.doesNotMatch(reader.text,/Текст & вывод/);assert.equal(reader.subject,'Расшифровка готова: Встреча <script>');
});
test('durable mail queue waits for summary, sends once, and skips revoked access',async()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE mnema_workspaces(id TEXT,name TEXT,data TEXT);CREATE TABLE user(id TEXT,email TEXT);CREATE TABLE mnema_access(user_id TEXT,revoked INTEGER);CREATE TABLE mnema_members(workspace_id TEXT,user_id TEXT,role TEXT,revoked INTEGER)');
 db.prepare('INSERT INTO user VALUES(?,?)').run('u','qa@example.test');db.prepare('INSERT INTO mnema_access VALUES(?,0)').run('u');db.prepare('INSERT INTO mnema_members VALUES(?,?,?,0)').run('space','u','full');
 const save=s=>db.prepare('INSERT OR REPLACE INTO mnema_workspaces(rowid,id,name,data) VALUES(1,?,?,?)').run('space','Проект',JSON.stringify({studies:[s]}));
 save({...study,summaryInfo:{state:'queued',review:'draft'}});const sent:any[]=[];const mailer=createCompletionMailer({db,baseURL:'https://example.test',send:async m=>{sent.push(m)}});
 try{mailer.queue('job','space','recording','u');mailer.queue('job','space','recording','u');await mailer.tick();assert.equal(sent.length,0);save(study);db.exec('UPDATE mnema_completion_mail SET next_at=0');await mailer.tick();await mailer.tick();assert.equal(sent.length,1);assert.equal(db.prepare('SELECT status FROM mnema_completion_mail WHERE job_id=?').get('job').status,'sent');
 mailer.queue('revoked','space','recording','u');db.exec('UPDATE mnema_members SET revoked=1');await mailer.tick();assert.equal(sent.length,1);assert.equal(db.prepare('SELECT status FROM mnema_completion_mail WHERE job_id=?').get('revoked').status,'skipped');
 }finally{mailer.close();db.close()}
});
test('mail failures retry without changing transcription status',async()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE mnema_workspaces(id TEXT,name TEXT,data TEXT);CREATE TABLE user(id TEXT,email TEXT);CREATE TABLE mnema_access(user_id TEXT,revoked INTEGER);CREATE TABLE mnema_members(workspace_id TEXT,user_id TEXT,role TEXT,revoked INTEGER)');
 db.prepare('INSERT INTO mnema_workspaces VALUES(?,?,?)').run('space','Проект',JSON.stringify({studies:[study]}));db.exec("INSERT INTO user VALUES('u','qa@example.test');INSERT INTO mnema_access VALUES('u',0);INSERT INTO mnema_members VALUES('space','u','full',0)");
 const mailer=createCompletionMailer({db,baseURL:'https://example.test',send:async()=>{throw new Error('temporary')}});
 try{mailer.queue('job','space','recording','u');await mailer.tick();const row:any=db.prepare('SELECT * FROM mnema_completion_mail').get();assert.equal(row.status,'pending');assert.equal(row.attempts,1);assert(row.next_at>Date.now());assert.equal(JSON.parse(String(db.prepare('SELECT data FROM mnema_workspaces').get().data)).studies[0].status,'ready')}finally{mailer.close();db.close()}
});
