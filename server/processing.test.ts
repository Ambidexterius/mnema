import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractDocument} from './processing.ts';
test('mixed PDF uses OCR only for scanned pages and preserves stable page citations',async()=>{
 const calls=[];const run=async(cmd:string,args:string[]):Promise<{stdout:string}>=>{calls.push([cmd,args]);if(cmd==='pdfinfo')return{stdout:'Pages: 2\n'};if(cmd==='pdftotext')return{stdout:args[1]==='1'?'Достаточный текст первого листа. Пользователь проверяет календарь.':''};if(cmd==='tesseract')return{stdout:'Распознанный скан второго листа.'};return{stdout:''}};
 const first=await extractDocument({filePath:'/tmp/neutral.pdf',fileName:'neutral.pdf',fileId:'fixture',run});
 assert.equal(first.ocrPages,1);assert.deepEqual(first.segments.map(s=>s.page),[1,2]);assert.equal(calls.filter(c=>c[0]==='tesseract').length,1);
 const again=await extractDocument({filePath:'/tmp/neutral.pdf',fileName:'neutral.pdf',fileId:'fixture',run});assert.equal(first.segments[1].id,again.segments[1].id);
});
test('PDF page limit stops before rendering',async()=>{let rendered=false;await assert.rejects(extractDocument({filePath:'/tmp/huge.pdf',fileName:'huge.pdf',fileId:'x',run:async(cmd:string):Promise<{stdout:string}>=>{if(cmd==='pdfinfo')return{stdout:'Pages: 101'};rendered=true;return{stdout:''}}}),/100/);assert.equal(rendered,false)});

test('Word text keeps stable source IDs without invented pages',async()=>{let engine='';const run=async(cmd:string)=>{engine=cmd;return{stdout:'Первый абзац про даты.\n\nВторой абзац про цены.'}};const first=await extractDocument({filePath:'/tmp/test.docx',fileName:'test.docx',fileId:'word',run});assert.equal(first.segments.length,2);assert.equal(first.segments[0].page,null);assert.equal(engine,process.env.DOC_PYTHON||'python3');const again=await extractDocument({filePath:'/tmp/test.docx',fileName:'test.docx',fileId:'word',run});assert.equal(first.segments[1].id,again.segments[1].id);await assert.rejects(extractDocument({filePath:'/tmp/broken.doc',fileName:'broken.doc',fileId:'broken',run:async()=>{throw new Error('bad file')}}),/Сохраните его как DOCX или PDF/)});

test('fractional recording duration produces valid integer subprocess timeouts for ASR and speakers',async()=>{
 const {transcribeRecording,detectSpeakers}=await import('./processing.ts');const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const dir=await mkdtemp(join(tmpdir(),'mnema-timeout-'));const keys=['ASR_MODEL_DIR','ASR_DIARIZATION_DIR','ASR_DIARIZATION'];const before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));const timeouts:number[]=[];
 try{
  for(const name of ['model.bin','segmentation.onnx','embedding.onnx'])await writeFile(join(dir,name),'fixture');process.env.ASR_MODEL_DIR=dir;process.env.ASR_DIARIZATION_DIR=dir;process.env.ASR_DIARIZATION='1';
  const run=async(cmd:string,args:string[],options:any)=>{assert(Number.isSafeInteger(options.timeout));assert(options.timeout>0);timeouts.push(options.timeout);if(cmd==='ffprobe')return{stdout:JSON.stringify({format:{duration:2049.14392,format_name:'webm'}})};if(args[0]?.endsWith('transcribe.py'))await writeFile(args[2],JSON.stringify({segments:[{time:0,end:2,speaker:'Запись',text:'Fixture speech'}]}));if(args[0]?.endsWith('diarize.py'))await writeFile(args[3],JSON.stringify({speakers:{s:'Спикер 1'},count:1,engine:'fixture'}));return{stdout:''}};
  const result=await transcribeRecording({filePath:'fixture.webm',fileId:'fixture',run});assert.equal(result.segments.length,1);assert(timeouts.includes(10245720));
  const speakers=await detectSpeakers({filePath:'fixture.webm',segments:[{id:'s',time:0,end:2,speaker:'Запись',text:'Fixture speech'}],run});assert.equal(speakers.count,1);
 }finally{for(const key of keys){if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key]}await rm(dir,{recursive:true,force:true})}
});
