import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {s3Config,signedS3Request,createS3Mirror} from './s3-storage.ts';
const env={MNEMA_S3_BUCKET:'fixture-bucket',MNEMA_S3_PREFIX:'mnemonika/',MNEMA_S3_ACCESS_KEY_ID:'fixture-key-not-real',MNEMA_S3_SECRET_ACCESS_KEY:'fixture-secret-not-real'};
test('S3 requires credentials and an isolated namespace; signing encodes paths and never exposes the secret',()=>{
 assert.equal(s3Config({}),null);assert.throws(()=>s3Config({MNEMA_S3_BUCKET:'fixture-bucket'}));assert.throws(()=>s3Config({...env,MNEMA_S3_PREFIX:'/'}));assert.throws(()=>s3Config({...env,MNEMA_S3_PREFIX:'../'}));
 const request=signedS3Request(s3Config(env),'GET','uploads/файл с пробелом',undefined,{range:'bytes=0-3'},new Date('2026-11-11T00:00:00Z'));
 assert.match(request.url,/fixture-bucket\/mnemonika\/uploads\/%D1%84/);assert.match(request.headers.authorization,/Credential=fixture-key-not-real\/20261111\/ru-central1\/s3\/aws4_request/);assert.match(request.headers.authorization,/SignedHeaders=host;range;x-amz-content-sha256;x-amz-date/);assert.doesNotMatch(JSON.stringify(request),/fixture-secret-not-real/);
});
test('S3 copies retry durably, preserve originals, support ranges, and restore a verified SQLite snapshot',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mnema-s3-'));const db=new DatabaseSync(join(dir,'db.sqlite'));let mirror:any;const objects=new Map<string,{bytes:Buffer;sha:string}>();let fail=true;
 const transport:any=async(input:string,init:any)=>{const url=new URL(input),key=decodeURIComponent(url.pathname);const headers=new Headers(init.headers);assert.equal(url.host,'storage.yandexcloud.net');assert.match(key,/^\/fixture-bucket\/mnemonika\//);assert.match(headers.get('authorization'),/^AWS4-HMAC-SHA256 /);
  if(init.method==='PUT'){if(fail){fail=false;return new Response('fixture failure',{status:503})}const chunks=[];for await(const bytes of init.body)chunks.push(bytes);const data=Buffer.concat(chunks);assert.equal(headers.get('content-md5'),createHash('md5').update(data).digest('base64'));assert.equal(headers.get('x-amz-content-sha256'),createHash('sha256').update(data).digest('hex'));objects.set(key,{bytes:data,sha:headers.get('x-amz-meta-sha256')});return new Response(null,{status:200})}
  const item=objects.get(key);if(init.method==='DELETE'){objects.delete(key);return new Response(null,{status:204})}if(!item)return new Response(null,{status:404});
  if(init.method==='HEAD')return new Response(null,{headers:{'content-length':String(item.bytes.length),'x-amz-meta-sha256':item.sha}});
  const range=headers.get('range');return new Response(new Uint8Array(range?item.bytes.subarray(0,4):item.bytes),{status:range?206:200,headers:{'content-length':String(range?4:item.bytes.length),...(range?{'content-range':'bytes 0-3/'+item.bytes.length}:{})}});
 };
 try{
  await mkdir(join(dir,'uploads'));await writeFile(join(dir,'uploads','file-id'),'original source');db.exec("CREATE TABLE mnema_uploads(id TEXT PRIMARY KEY,name TEXT,mime TEXT,size INTEGER,status TEXT);CREATE TABLE mnema_workspaces(id TEXT,data TEXT);INSERT INTO mnema_uploads VALUES('file-id','fixture.txt','text/plain',15,'ready');INSERT INTO mnema_workspaces VALUES('main','{}')");
  mirror=createS3Mirror(db,dir,s3Config(env),transport);await mirror.tick();assert.equal(mirror.status().synced,0);assert.equal((await readFile(join(dir,'uploads','file-id'))).toString(),'original source');
  db.prepare('UPDATE mnema_s3_copies SET updated=0').run();await mirror.tick();assert.equal(mirror.status().synced,1);assert.equal(mirror.has('file-id'),true);const source=await mirror.objects.get(mirror.objectKey('file-id'),'bytes=0-3');assert.equal(source.status,206);assert.equal(await source.text(),'orig');
  await mirror.tick();assert(mirror.status().backupAt);const restored=await mirror.verifyBackup();assert.equal(restored.verified,true);assert.equal(restored.workspaces,1);
  const stored=objects.get('/fixture-bucket/mnemonika/backups/latest.sqlite');stored.bytes=Buffer.from('broken');await assert.rejects(mirror.verifyBackup(),/checksum/);
  db.prepare("DELETE FROM mnema_uploads WHERE id='file-id'").run();await mirror.tick();assert.equal(objects.has('/fixture-bucket/mnemonika/uploads/file-id'),false);assert.equal(objects.has('/fixture-bucket/mnemonika/backups/latest.sqlite'),true);
 }finally{mirror?.close();db.close();await rm(dir,{recursive:true,force:true})}
});
