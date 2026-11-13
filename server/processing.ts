import {execFile} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import type {Segment} from '../app/types.ts';

type Run=(cmd:string,args:string[],options?:Record<string,unknown>)=>Promise<{stdout:string;stderr?:string}>;
interface JobArgs{filePath:string;fileName?:string;fileId:string;checkpointDir?:string;signal?:AbortSignal;onProgress?:(progress:string)=>void;run?:Run;maxPages?:number}
// execFile still bounds captured output; progress lines contain measurements only.
// Reading them while the child runs avoids waiting hours for its final stdout.
export const runProcessingCommand:Run=(cmd,args,options={})=>new Promise((resolve,reject)=>{
 const {onStdoutLine,...execOptions}=options;const signal=execOptions.signal as AbortSignal|undefined;let listenerError:unknown,closed=false,completed:{error:any;stdout:any;stderr:any}|undefined,killTimer:ReturnType<typeof setTimeout>|undefined;
 const finish=()=>{if(!closed||!completed)return;signal?.removeEventListener('abort',terminate);if(killTimer)clearTimeout(killTimer);const {error,stdout,stderr}=completed;if(error||listenerError)reject(error||listenerError);else resolve({stdout:String(stdout),stderr:String(stderr)})};
 // execFile's AbortError callback can run before the process actually exits.
 // A deleting request must wait for close before removing its input/cache.
 const child=execFile(cmd,args,execOptions as any,(error,stdout,stderr)=>{
  completed={error,stdout,stderr};finish();
 });
 const terminate=()=>{if(!closed&&!killTimer){killTimer=setTimeout(()=>{if(!closed)child.kill('SIGKILL')},5000);killTimer.unref()}};
 signal?.addEventListener('abort',terminate,{once:true});if(signal?.aborted)terminate();
 child.once('close',()=>{closed=true;finish()});
 if(typeof onStdoutLine==='function')createInterface({input:child.stdout}).on('line',line=>{
  if(signal?.aborted)return;try{onStdoutLine(line)}catch(error){listenerError=error;child.kill()}
 });
});
const interruptibleRun=(run:Run,signal?:AbortSignal):Run=>async(cmd,args,options={})=>{signal?.throwIfAborted();const result=await run(cmd,args,{...options,...(signal?{signal}:{})});signal?.throwIfAborted();return result};
const interruptibleProgress=(progress:(value:string)=>void,signal?:AbortSignal)=>(value:string)=>{if(!signal?.aborted)progress(value)};
const clock=(value:number)=>{const seconds=Math.floor(value);return seconds>=3600?Math.floor(seconds/3600)+':'+String(Math.floor(seconds/60)%60).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0'):Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0')};
/** Accept only structured numeric progress, never arbitrary subprocess output. */
export function processingProgress(line:string):string|null{
 let p:any;try{p=JSON.parse(line)}catch{return null}
 if(p?.event!=='progress')return null;
 if(p.phase==='loading')return 'Загружаем модель речи';
 if(!['transcribing','diarization'].includes(p.phase))return null;
 const part=Number.isSafeInteger(p.chunk)&&Number.isSafeInteger(p.chunks)&&p.chunk>=1&&p.chunk<=p.chunks&&p.chunks<=100?' · часть '+p.chunk+' из '+p.chunks:'';
 const measured=Number.isFinite(p.processedSeconds)&&p.processedSeconds>=0&&Number.isFinite(p.totalSeconds)&&p.totalSeconds>0&&p.processedSeconds<=p.totalSeconds;
 return (p.phase==='diarization'?'Определяем спикеров':'Распознаём запись')+(measured?': '+clock(p.processedSeconds)+' из '+clock(p.totalSeconds):'')+part;
}
function progressLines(onProgress:(p:string)=>void){let previous='';return (line:string)=>{const value=processingProgress(line);if(value&&value!==previous){previous=value;onProgress(value)}}}
const id=(fileId:string,part:string,text:string)=>'s-'+createHash('sha256').update(fileId+':'+part+':'+text).digest('hex').slice(0,24);
export function processingReadiness(){return {
 asr:existsSync(join(process.env.ASR_MODEL_DIR||'/app/models/whisper-small','model.bin')),
 ocr:existsSync('/usr/bin/tesseract')&&existsSync('/usr/bin/pdftoppm'),
 diarization:existsSync(join(process.env.ASR_DIARIZATION_DIR||'/app/models/diarization','segmentation.onnx'))&&existsSync(join(process.env.ASR_DIARIZATION_DIR||'/app/models/diarization','embedding.onnx'))&&process.env.ASR_DIARIZATION!=='0',
 model:'Whisper Small int8',ocrLanguages:process.env.OCR_LANGUAGES||'rus+eng'
}}
export async function extractDocument({filePath,fileName='',fileId,signal,onProgress=()=>{},run=runProcessingCommand,maxPages=Number(process.env.OCR_MAX_PAGES||100)}:JobArgs){
 signal?.throwIfAborted();run=interruptibleRun(run,signal);onProgress=interruptibleProgress(onProgress,signal);
 const segments=[];let pages=0,ocrPages=0,total=0;
 const add=(content,page)=>{const paras=content.split(/\n\s*\n/).map(p=>p.trim()).filter(Boolean);let index=0;for(const paragraph of paras)for(let offset=0;offset<paragraph.length;offset+=1200){const value=paragraph.slice(offset,offset+1200);total+=value.length;if(total>10*1024**2||segments.length>=5000)throw new Error('Документ слишком большой. Разделите его на части.');segments.push({id:id(fileId,page+':'+index++,value),time:0,page,speaker:page?'Страница '+page:'Документ',text:value})}};
 if(/\.xlsx?$/i.test(fileName)){
  onProgress('Читаем листы таблицы');
  try{add((await run(process.env.DOC_PYTHON||process.env.ASR_PYTHON||(existsSync('/opt/asr/bin/python')?'/opt/asr/bin/python':'python3'),[join(dirname(fileURLToPath(import.meta.url)),/\.xlsx$/i.test(fileName)?'extract-xlsx.py':'extract-xls.py'),filePath],{timeout:30000,maxBuffer:12*1024**2})).stdout,null)}catch{signal?.throwIfAborted();throw new Error('Не удалось прочитать таблицу. Сохраните таблицу как XLSX или PDF и загрузите снова.')}
 }
 else if(/\.docx?$/i.test(fileName)){
  onProgress('Извлекаем текст документа Word');
  try{const extracted=/\.docx$/i.test(fileName)?await run(process.env.DOC_PYTHON||'python3',[join(dirname(fileURLToPath(import.meta.url)),'extract-word.py'),filePath],{timeout:30000,maxBuffer:10*1024**2}):process.platform==='darwin'?await run('textutil',['-convert','txt','-stdout',filePath],{timeout:30000,maxBuffer:10*1024**2}):await run('antiword',['-m','UTF-8.txt',filePath],{timeout:30000,maxBuffer:10*1024**2});add(extracted.stdout,null)}catch{signal?.throwIfAborted();throw new Error('Не удалось прочитать документ Word. Сохраните его как DOCX или PDF и загрузите снова.')}
 }
 else if(!/\.pdf$/i.test(fileName)){const value=await readFile(filePath);if(value.length>10*1024**2)throw new Error('Текстовый файл больше 10 МБ. Разделите документ.');add(value.toString('utf8'),null)}
 else{
  const info=await run('pdfinfo',[filePath],{timeout:30000,maxBuffer:1024**2});pages=Number(info.stdout.match(/^Pages:\s+(\d+)/m)?.[1]);
  if(!Number.isInteger(pages)||pages<1)throw new Error('Не удалось определить страницы PDF. Проверьте, не защищён ли файл паролем.');
  if(pages>maxPages)throw new Error('В PDF больше '+maxPages+' страниц. Разделите его на части.');
  const working=await mkdtemp(join(tmpdir(),'mnema-ocr-'));
  try{for(let page=1;page<=pages;page++){
   onProgress('Страница '+page+' из '+pages);
   const extracted=await run('pdftotext',['-f',String(page),'-l',String(page),'-enc','UTF-8',filePath,'-'],{timeout:60000,maxBuffer:4*1024**2});let value=extracted.stdout.trim();
   if(value.replace(/\s/g,'').length<30){
    const prefix=join(working,'page');await run('pdftoppm',['-f',String(page),'-l',String(page),'-singlefile','-scale-to','2048','-gray','-png',filePath,prefix],{timeout:60000,maxBuffer:1024**2});
    try{value=(await run('tesseract',[prefix+'.png','stdout','-l',process.env.OCR_LANGUAGES||'rus+eng','--psm','3'],{timeout:90000,maxBuffer:4*1024**2,env:{...process.env,OMP_THREAD_LIMIT:'1'}})).stdout.trim();ocrPages++}finally{await rm(prefix+'.png',{force:true})}
   }
   add(value,page);
  }}finally{await rm(working,{recursive:true,force:true})}
 }
 signal?.throwIfAborted();if(!segments.length)throw new Error('Текст не найден. Проверьте качество скана и наличие печатного текста.');
 return {segments,pages,ocrPages,engine:/\.xlsx?$/i.test(fileName)?'Excel stored values':/\.docx?$/i.test(fileName)?'Word text':ocrPages?'Poppler + Tesseract':'Poppler / TXT'};
}
export async function transcribeRecording({filePath,fileId,checkpointDir,signal,onProgress=()=>{},run=runProcessingCommand}:JobArgs){
 signal?.throwIfAborted();run=interruptibleRun(run,signal);onProgress=interruptibleProgress(onProgress,signal);
 const readiness=processingReadiness();if(!readiness.asr)throw new Error('Локальная модель речи ещё не установлена. Дождитесь обновления сервера.');
 const probe=await run('ffprobe',['-v','error','-protocol_whitelist','file,pipe','-show_entries','format=duration,format_name','-of','json',filePath],{timeout:30000,maxBuffer:1024**2});const info=JSON.parse(probe.stdout).format||{};
 const duration=Number(info.duration),maximum=Number(process.env.ASR_MAX_AUDIO_SECONDS||14400);
 if(!Number.isFinite(duration)||duration<=0||duration>maximum)throw new Error('Запись должна быть непустой и не длиннее '+Math.floor(maximum/3600)+' часов.');
 if(!String(info.format_name||'').split(',').some(x=>['mov','mp4','m4a','matroska','webm','wav','mp3','flac','ogg','aac','avi'].includes(x)))throw new Error('Неподдерживаемый контейнер записи. Используйте MP4, WEBM, MP3 или WAV.');
 const working=await mkdtemp(join(tmpdir(),'mnema-asr-'));const started=Date.now();
 try{
  if(checkpointDir)await mkdir(checkpointDir,{recursive:true,mode:0o700});
  onProgress('Подготовка аудио');const audio=join(working,'audio-%05d.flac'),output=join(working,'transcript.json');
  await prepareAudio(run,filePath,audio,maximum);
  onProgress('Локальное распознавание речи');const script=join(dirname(fileURLToPath(import.meta.url)),'transcribe.py');
  let result:any;
  try{
   await run(process.env.ASR_PYTHON||'/opt/asr/bin/python',[script,working,output,'--model',process.env.ASR_MODEL_DIR||'/app/models/whisper-small','--threads',String(Number(process.env.ASR_CPU_THREADS||1)),'--duration',String(duration),...(checkpointDir?['--checkpoint',join(checkpointDir,'asr.json')]:[])],{timeout:Math.min(6*3600000,Math.max(10*60000,Math.ceil(duration*5000))),maxBuffer:2*1024**2,env:{...process.env,OMP_NUM_THREADS:process.env.ASR_CPU_THREADS||'1'},onStdoutLine:progressLines(onProgress)});
  }catch(error){
   signal?.throwIfAborted();
   // The Python checkpoint is written only after ALL speech chunks finish.
   // Losing optional speaker detection must not discard a complete transcript.
   try{result=JSON.parse(await readFile(output,'utf8'))}catch{}
   if(result?.transcriptionComplete!==true||result.diarizationError!=='NotCompleted'||!result.segments?.length)throw error;
   result.diarization=false;result.speakers=0;result.diarizationError='Interrupted';
   console.error('ASR speaker stage interrupted; completed transcript preserved');
  }
  result??=JSON.parse(await readFile(output,'utf8'));
  signal?.throwIfAborted();if(!result.segments?.length)throw new Error('В записи не удалось распознать речь. Проверьте качество звука.');
  result.segments=result.segments.map((s,i)=>({...s,id:id(fileId,String(i),s.text)}));
  return {...result,processingSeconds:Math.round((Date.now()-started)/10)/100};
 }finally{await rm(working,{recursive:true,force:true});if(checkpointDir)await rm(checkpointDir,{recursive:true,force:true})}
}

async function probeRecording(run:Run,filePath:string){
 const probe=await run('ffprobe',['-v','error','-protocol_whitelist','file,pipe','-show_entries','format=duration,format_name','-of','json',filePath],{timeout:30000,maxBuffer:1024**2});const info=JSON.parse(probe.stdout).format||{};
 const duration=Number(info.duration),maximum=Number(process.env.ASR_MAX_AUDIO_SECONDS||14400);
 if(!Number.isFinite(duration)||duration<=0||duration>maximum)throw new Error('Запись должна быть непустой и не длиннее '+Math.floor(maximum/3600)+' часов.');
 return {duration,maximum};
}
function prepareAudio(run:Run,filePath:string,audio:string,maximum:number){
 return run('ffmpeg',['-nostdin','-v','error','-protocol_whitelist','file,pipe','-threads','1','-i',filePath,'-map','0:a:0','-vn','-ac','1','-ar','16000','-c:a','flac','-threads','1','-t',String(maximum),'-f','segment','-segment_time','900','-reset_timestamps','1',audio],{timeout:15*60000,maxBuffer:1024**2});
}
/** Labels speakers of an existing transcript without running speech recognition again. */
export async function detectSpeakers({filePath,segments,signal,onProgress=()=>{},run=runProcessingCommand}:{filePath:string;segments:Segment[];signal?:AbortSignal;onProgress?:(p:string)=>void;run?:Run}){
 signal?.throwIfAborted();run=interruptibleRun(run,signal);onProgress=interruptibleProgress(onProgress,signal);
 if(!processingReadiness().diarization)throw new Error('Определение спикеров не установлено на этом сервере.');
 const {duration,maximum}=await probeRecording(run,filePath);
 const working=await mkdtemp(join(tmpdir(),'mnema-speakers-'));const started=Date.now();
 try{
  onProgress('Подготовка аудио');await prepareAudio(run,filePath,join(working,'audio-%05d.flac'),maximum);
  const input=join(working,'segments.json'),output=join(working,'speakers.json');
  await writeFile(input,JSON.stringify(segments.map(s=>({id:s.id,time:s.time,end:s.end,speaker:s.speaker}))),{mode:0o600});
  onProgress('Определяем спикеров');const script=join(dirname(fileURLToPath(import.meta.url)),'diarize.py');
  await run(process.env.ASR_PYTHON||'/opt/asr/bin/python',[script,working,input,output,'--models',process.env.ASR_DIARIZATION_DIR||'/app/models/diarization','--threads',String(Number(process.env.ASR_CPU_THREADS||1)),'--duration',String(duration)],{timeout:Math.min(4*3600000,Math.max(10*60000,Math.ceil(duration*3000))),maxBuffer:2*1024**2,env:{...process.env,OMP_NUM_THREADS:process.env.ASR_CPU_THREADS||'1'},onStdoutLine:progressLines(onProgress)});
  const result=JSON.parse(await readFile(output,'utf8')) as {speakers:Record<string,string>;count:number;engine:string};
  signal?.throwIfAborted();if(!result.count)throw new Error('Не удалось различить голоса. Проверьте качество звука.');
  return {...result,processingSeconds:Math.round((Date.now()-started)/10)/100};
 }finally{await rm(working,{recursive:true,force:true})}
}
