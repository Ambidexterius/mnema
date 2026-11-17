import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {uniqueNames,writeZip} from './zip.ts';

test('uniqueNames keeps the first name and numbers repeats before the extension',()=>{
 assert.deepEqual(uniqueNames(['Отчёт.pdf','Отчёт.pdf','a/b.txt','Без расширения','Без расширения']),['Отчёт.pdf','Отчёт (2).pdf','a_b.txt','Без расширения','Без расширения (2)']);
});

test('writeZip produces an archive a standard reader opens with exact contents and Cyrillic names',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mnema-zip-'));
 try{
  const big=randomBytes(300_000),files=[{name:'Интервью № 1.txt',path:join(dir,'a'),data:Buffer.from('Синтетический текст')},{name:'запись.bin',path:join(dir,'b'),data:big},{name:'пустой.txt',path:join(dir,'c'),data:Buffer.alloc(0)}];
  for(const f of files)await writeFile(f.path,f.data);
  const archive=join(dir,'out.zip');const out=createWriteStream(archive);
  await writeZip(out,files);await new Promise<void>(done=>out.on('finish',()=>done()));
  const check=execFileSync('python3',['-I','-c','import zipfile,sys,hashlib,json;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(json.dumps({i.filename:hashlib.sha256(z.read(i)).hexdigest() for i in z.infolist()}))',archive],{encoding:'utf8'});
  const sha=(b:Buffer)=>execFileSync('python3',['-I','-c','import hashlib,sys;print(hashlib.sha256(sys.stdin.buffer.read()).hexdigest())'],{input:b,encoding:'utf8'}).trim();
  assert.deepEqual(JSON.parse(check),Object.fromEntries(files.map(f=>[f.name,sha(f.data)])));
 }finally{await rm(dir,{recursive:true,force:true})}
});
