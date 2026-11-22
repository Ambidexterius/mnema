import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {loadExtension} from './extension.ts';

test('an ordinary release ignores optional source modules and fails closed on a database marked for an extension',async t=>{
 assert.equal(await loadExtension(false),undefined);
 const dir=await mkdtemp(join(tmpdir(),'mnema-extension-check-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const db=new DatabaseSync(join(dir,'mnema.sqlite'));
 db.exec("CREATE TABLE mnema_migrations(name TEXT PRIMARY KEY); INSERT INTO mnema_migrations VALUES('app-extension-v1')");
 db.close();
 const previous=process.env.MNEMA_APP_EXTENSION;
 delete process.env.MNEMA_APP_EXTENSION;
 try{
  const {createMnemaServer}=await import('./server.ts');
  await assert.rejects(createMnemaServer({dataDir:dir,authSecret:'synthetic-extension-test-only-not-an-account'}),
   /database requires the application extension/);
 }finally{
  if(previous!==undefined)process.env.MNEMA_APP_EXTENSION=previous;
 }
});
