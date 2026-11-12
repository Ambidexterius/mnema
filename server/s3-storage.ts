import {createHash,createHmac} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {stat,mkdir,rm,mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {backup,DatabaseSync} from 'node:sqlite';

interface Config {endpoint:string;region:string;bucket:string;prefix:string;accessKey:string;secretKey:string}
const digest=(v:string)=>createHash('sha256').update(v).digest('hex');
const hmac=(key:any,v:string)=>createHmac('sha256',key).update(v).digest();
const encode=(s:string)=>encodeURIComponent(s).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
export function s3Config(env=process.env):Config|null{
 if(env.MNEMA_S3_ENABLED==='0'||!env.MNEMA_S3_BUCKET)return null;
 const config={endpoint:env.MNEMA_S3_ENDPOINT||'https://storage.yandexcloud.net',region:env.MNEMA_S3_REGION||'ru-central1',bucket:env.MNEMA_S3_BUCKET,prefix:(env.MNEMA_S3_PREFIX||'mnemonika/').replace(/^\/+|\/+$/g,'')+'/',accessKey:env.MNEMA_S3_ACCESS_KEY_ID||'',secretKey:env.MNEMA_S3_SECRET_ACCESS_KEY||''};
 if(!config.accessKey||!config.secretKey)throw new Error('S3 credentials are not configured');
 if(!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucket)||!/^[-a-zA-Z0-9_]+(?:\/[-a-zA-Z0-9_]+)*\/$/.test(config.prefix)||config.prefix.includes('..'))throw new Error('Invalid S3 namespace');
 const url=new URL(config.endpoint);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('Invalid S3 endpoint');
 return config;
}
export function signedS3Request(config:Config,method:string,key:string,hash=digest(''),extra:Record<string,string>={},now=new Date()){
 const uri='/'+[config.bucket,...(config.prefix+key).split('/')].map(encode).join('/');const url=new URL(uri,config.endpoint);
 const date=now.toISOString().replace(/[:-]|\.\d{3}/g,'');const day=date.slice(0,8);const scope=day+'/'+config.region+'/s3/aws4_request';
 const headers:Record<string,string>={host:url.host,'x-amz-date':date,'x-amz-content-sha256':hash,...extra};
 const names=Object.keys(headers).map(x=>x.toLowerCase()).sort();const canonical=names.map(n=>n+':'+headers[n].trim().replace(/\s+/g,' ')+'\n').join('');
 const request=[method,uri,'',canonical,names.join(';'),hash].join('\n');
 const signingKey=hmac(hmac(hmac(hmac('AWS4'+config.secretKey,day),config.region),'s3'),'aws4_request');
 headers.authorization='AWS4-HMAC-SHA256 Credential='+config.accessKey+'/'+scope+', SignedHeaders='+names.join(';')+', Signature='+hmac(signingKey,['AWS4-HMAC-SHA256',date,scope,digest(request)].join('\n')).toString('hex');
 return {url:url.href,headers};
}
async function fileDigests(path:string){const sha=createHash('sha256'),md5=createHash('md5');for await(const bytes of createReadStream(path)){sha.update(bytes);md5.update(bytes)}return {sha256:sha.digest('hex'),md5:md5.digest('base64')}}
export class S3Objects {
 readonly config:Config;private transport:typeof fetch;
 constructor(config:Config,transport:typeof fetch=fetch){this.config=config;this.transport=transport}
 async request(method:string,key:string,hash?:string,headers:Record<string,string>={},body?:any){
  const signed=signedS3Request(this.config,method,key,hash,headers);
  const response=await this.transport(signed.url,{method,headers:signed.headers,redirect:'error',signal:AbortSignal.timeout(30*60*1000),...(body?{body,duplex:'half'}:{})} as any);
  if(!response.ok)throw new Error('Object Storage HTTP '+response.status);
  return response;
 }
 async put(key:string,path:string){const info=await stat(path),hashes=await fileDigests(path);
  const sent=await this.request('PUT',key,hashes.sha256,{'content-length':String(info.size),'content-type':'application/octet-stream','content-md5':hashes.md5,'x-amz-meta-sha256':hashes.sha256},createReadStream(path));await sent.body?.cancel();
  const head=await this.request('HEAD',key);if(Number(head.headers.get('content-length'))!==info.size||head.headers.get('x-amz-meta-sha256')!==hashes.sha256)throw new Error('Object Storage verification failed');
  return {sha256:hashes.sha256,size:info.size};
 }
 get(key:string,range?:string){return this.request('GET',key,undefined,range?{range}:{})}
 async remove(key:string){const response=await this.request('DELETE',key);await response.body?.cancel()}
}

/** Durable copies in S3. Local originals are retained until recovery has been verified. */
export function createS3Mirror(db:DatabaseSync,dataDir:string,config:Config|null,transport?:typeof fetch){
 db.exec('CREATE TABLE IF NOT EXISTS mnema_s3_copies(id TEXT PRIMARY KEY,state TEXT NOT NULL,sha256 TEXT,size INTEGER,updated INTEGER NOT NULL,error TEXT)');
 const objects=config?new S3Objects(config,transport):null;let busy=false,closed=false;
 const q=(sql:string)=>db.prepare(sql);const objectKey=(id:string)=>id==='__database__'?'backups/latest.sqlite':'uploads/'+id;
 const save=(id:string,state:string,hash:string|null,size:number|null,error:string|null=null)=>q('INSERT OR REPLACE INTO mnema_s3_copies VALUES(?,?,?,?,?,?)').run(id,state,hash,size,Date.now(),error);
 const status=()=>{const files=q("SELECT count(*) n,coalesce(sum(size),0) bytes FROM mnema_uploads WHERE status='ready'").get();const synced=q("SELECT count(*) n FROM mnema_s3_copies c JOIN mnema_uploads u ON u.id=c.id WHERE c.state='ready' AND u.status='ready'").get();const snapshot=q("SELECT updated,error FROM mnema_s3_copies WHERE id='__database__' AND state='ready'").get();const failed=q("SELECT error FROM mnema_s3_copies WHERE state='error' ORDER BY updated DESC LIMIT 1").get();return {enabled:Boolean(objects),bucket:config?.bucket||null,prefix:config?.prefix||null,files:Number(files.n),synced:Number(synced.n),bytes:Number(files.bytes),backupAt:snapshot?.updated||null,busy,error:failed?.error||null,localCopiesRetained:true}};
 const copyDatabase=async()=>{if(!objects)return;const folder=join(dataDir,'s3-backup');await mkdir(folder,{recursive:true,mode:0o700});const path=join(folder,'snapshot.sqlite');await rm(path,{force:true});
  try{await backup(db,path);const result=await objects.put(objectKey('__database__'),path);if(!closed)save('__database__','ready',result.sha256,result.size)}finally{await rm(path,{force:true})}
 };
 const tick=async()=>{if(!objects||busy||closed)return;busy=true;let current:string|null=null;
  try{
   const orphan=q("SELECT c.id FROM mnema_s3_copies c LEFT JOIN mnema_uploads u ON u.id=c.id WHERE c.id!='__database__' AND u.id IS NULL LIMIT 1").get();
   if(orphan){await objects.remove(objectKey(String(orphan.id)));q('DELETE FROM mnema_s3_copies WHERE id=?').run(orphan.id);return}
   const file=q("SELECT u.* FROM mnema_uploads u LEFT JOIN mnema_s3_copies c ON c.id=u.id WHERE u.status='ready' AND (c.id IS NULL OR c.state!='ready') AND (c.updated IS NULL OR c.updated<?) ORDER BY coalesce(c.updated,0) LIMIT 1").get(Date.now()-30000);
   if(file){current=String(file.id);const result=await objects.put(objectKey(current),join(dataDir,'uploads',current));if(closed)return;if(!q("SELECT 1 FROM mnema_uploads WHERE id=? AND status='ready'").get(current)){await objects.remove(objectKey(current));q('DELETE FROM mnema_s3_copies WHERE id=?').run(current)}else save(current,'ready',result.sha256,result.size);return}
   const snapshot=q("SELECT updated,state FROM mnema_s3_copies WHERE id='__database__'").get();
   if(!snapshot||Number(snapshot.updated)<Date.now()-(snapshot.state==='error'?30000:3600000)){current='__database__';await copyDatabase()}
  }catch(error){if(!closed&&current)save(current,'error',null,null,error instanceof Error?error.message:'Object Storage unavailable');console.error('S3 copy failed',error instanceof Error?error.name:'Error')}
  finally{busy=false}
 };
 const timer=objects?setInterval(()=>void tick(),3000):null;timer?.unref();
 const verifyBackup=async()=>{if(!objects)throw new Error('Object Storage is not configured');const expected=q("SELECT sha256 FROM mnema_s3_copies WHERE id='__database__' AND state='ready'").get();if(!expected)throw new Error('Backup is not ready');const dir=await mkdtemp(join(tmpdir(),'mnema-restore-check-')),path=join(dir,'restore.sqlite');
  try{const response=await objects.get(objectKey('__database__'));await pipeline(Readable.fromWeb(response.body as any),createWriteStream(path,{mode:0o600}));const hashes=await fileDigests(path);if(hashes.sha256!==expected.sha256)throw new Error('Backup checksum mismatch');const restored=new DatabaseSync(path,{readOnly:true});try{if(restored.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw new Error('Backup integrity check failed');return {verified:true,sha256:hashes.sha256,workspaces:Number(restored.prepare('SELECT count(*) n FROM mnema_workspaces').get().n),checkedAt:Date.now()}}finally{restored.close()}}finally{await rm(dir,{recursive:true,force:true})}
 };
 return {status,tick,objects,objectKey,verifyBackup,has:(id:string)=>Boolean(objects&&q("SELECT 1 FROM mnema_s3_copies WHERE id=? AND state='ready'").get(id)),backup:copyDatabase,close:()=>{closed=true;if(timer)clearInterval(timer)}};
}
