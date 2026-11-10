import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';

type Run=(cmd:string,args:string[],options?:Record<string,unknown>)=>Promise<{stdout:string;stderr?:string}>;
interface JobArgs{filePath:string;fileName?:string;fileId:string;onProgress?:(progress:string)=>void;run?:Run;maxPages?:number}
const execute=promisify(execFile) as unknown as Run;
const id=(fileId:string,part:string,text:string)=>'s-'+createHash('sha256').update(fileId+':'+part+':'+text).digest('hex').slice(0,24);
export function processingReadiness(){return {
 asr:existsSync(join(process.env.ASR_MODEL_DIR||'/app/models/whisper-small','model.bin')),
 ocr:existsSync('/usr/bin/tesseract')&&existsSync('/usr/bin/pdftoppm'),
 model:'Whisper Small int8',ocrLanguages:process.env.OCR_LANGUAGES||'rus+eng'
}}
export async function extractDocument({filePath,fileName='',fileId,onProgress=()=>{},run=execute,maxPages=Number(process.env.OCR_MAX_PAGES||100)}:JobArgs){
 const segments=[];let pages=0,ocrPages=0,total=0;
 const add=(content,page)=>{const paras=content.split(/\n\s*\n/).map(p=>p.trim()).filter(Boolean);let index=0;for(const paragraph of paras)for(let offset=0;offset<paragraph.length;offset+=1200){const value=paragraph.slice(offset,offset+1200);total+=value.length;if(total>10*1024**2||segments.length>=5000)throw new Error('Документ слишком большой. Разделите его на части.');segments.push({id:id(fileId,page+':'+index++,value),time:0,page,speaker:page?'Страница '+page:'Документ',text:value})}};
 if(!/\.pdf$/i.test(fileName)){const value=await readFile(filePath);if(value.length>10*1024**2)throw new Error('Текстовый файл больше 10 МБ. Разделите документ.');add(value.toString('utf8'),null)}
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
 if(!segments.length)throw new Error('Текст не найден. Проверьте качество скана и наличие печатного текста.');
 return {segments,pages,ocrPages,engine:ocrPages?'Poppler + Tesseract':'Poppler / TXT'};
}
export async function transcribeRecording({filePath,fileId,onProgress=()=>{},run=execute}:JobArgs){
 const readiness=processingReadiness();if(!readiness.asr)throw new Error('Локальная модель речи ещё не установлена. Дождитесь обновления сервера.');
 const probe=await run('ffprobe',['-v','error','-protocol_whitelist','file,pipe','-show_entries','format=duration,format_name','-of','json',filePath],{timeout:30000,maxBuffer:1024**2});const info=JSON.parse(probe.stdout).format||{};
 const duration=Number(info.duration),maximum=Number(process.env.ASR_MAX_AUDIO_SECONDS||14400);
 if(!Number.isFinite(duration)||duration<=0||duration>maximum)throw new Error('Запись должна быть непустой и не длиннее '+Math.floor(maximum/3600)+' часов.');
 if(!String(info.format_name||'').split(',').some(x=>['mov','mp4','m4a','matroska','webm','wav','mp3','flac','ogg','aac','avi'].includes(x)))throw new Error('Неподдерживаемый контейнер записи. Используйте MP4, WEBM, MP3 или WAV.');
 const working=await mkdtemp(join(tmpdir(),'mnema-asr-'));const started=Date.now();
 try{
  onProgress('Подготовка аудио');const audio=join(working,'audio-%05d.flac'),output=join(working,'transcript.json');
  await run('ffmpeg',['-nostdin','-v','error','-protocol_whitelist','file,pipe','-threads','1','-i',filePath,'-map','0:a:0','-vn','-ac','1','-ar','16000','-c:a','flac','-threads','1','-t',String(maximum),'-f','segment','-segment_time','900','-reset_timestamps','1',audio],{timeout:15*60000,maxBuffer:1024**2});
  onProgress('Локальное распознавание речи');const script=join(dirname(fileURLToPath(import.meta.url)),'transcribe.py');
  await run(process.env.ASR_PYTHON||'/opt/asr/bin/python',[script,working,output,'--model',process.env.ASR_MODEL_DIR||'/app/models/whisper-small','--threads',String(Number(process.env.ASR_CPU_THREADS||1))],{timeout:Math.min(6*3600000,Math.max(10*60000,duration*5000)),maxBuffer:2*1024**2,env:{...process.env,OMP_NUM_THREADS:process.env.ASR_CPU_THREADS||'1'}});
  const result=JSON.parse(await readFile(output,'utf8'));
  if(!result.segments?.length)throw new Error('В записи не удалось распознать речь. Проверьте качество звука.');
  result.segments=result.segments.map((s,i)=>({...s,id:id(fileId,String(i),s.text)}));
  return {...result,processingSeconds:Math.round((Date.now()-started)/10)/100};
 }finally{await rm(working,{recursive:true,force:true})}
}
