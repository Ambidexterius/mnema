import React,{useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {Button,Checkbox,Dialog,Select,Switch,TextInput} from '@gravity-ui/uikit';
import {ArrowUpCircle,CheckCircle2,FileText,Upload,X} from 'lucide-react';
import {fileKey,UploadQueue,type UploadItem,type UploadRow} from './upload-queue.ts';

const accept='.mp4,.mov,.webm,.mp3,.wav,.m4a,.pdf,.txt,.docx,.doc,.xlsx';
const formats=new Set(accept.split(','));
const types=['Интервью','Юзабилити-тест','Встреча','Отчёт'].map(value=>({value,content:value}));
const size=(bytes:number)=>bytes<1024**2?Math.max(1,Math.round(bytes/1024))+' КБ':new Intl.NumberFormat('ru',{maximumFractionDigits:1}).format(bytes/1024**2)+' МБ';
type Draft=UploadItem&{id:string;checked:boolean;invalid:string};
const countFiles=(n:number)=>n+' '+({one:'файл',few:'файла',many:'файлов',other:'файла'}[new Intl.PluralRules('ru').select(n)]);
const labels:Record<UploadRow['state'],string>={queued:'В очереди',uploading:'Загружается',saving:'Сохраняется',ready:'Загружен',error:'Ошибка загрузки',cancelling:'Отменяем',cancelled:'Отменён','cancel-error':'Ошибка отмены'};

function Picker({close,start,model}:{close:()=>void;start:(items:UploadItem[])=>void;model:string}){
 const [rows,setRows]=useState<Draft[]>([]),[autoSummary,setSummary]=useState(true);
 const input=useRef<HTMLInputElement>(null);
 function add(files:FileList|null){
   const added=Array.from(files||[]);
   setRows(previous=>{
     const next=[...previous],keys=new Set(previous.map(r=>fileKey(r.file)));
     for(const file of added){
       const key=fileKey(file);if(keys.has(key))continue;keys.add(key);
       const invalid=!formats.has('.'+file.name.split('.').at(-1)?.toLowerCase())?'Формат не поддерживается':!file.size?'Пустой файл':file.size>2*1024**3?'Файл больше 2 ГБ':'';
       next.push({id:crypto.randomUUID(),file,checked:!invalid,invalid,title:file.name.replace(/\.[^.]+$/,''),type:'Интервью',project:'',autoSummary:true});
     }
     return next;
   });
 }
 function edit(id:string,change:Partial<Draft>){setRows(prev=>prev.map(r=>r.id===id?{...r,...change}:r))}
 const selected=rows.filter(r=>r.checked&&!r.invalid);
 return <Dialog open onClose={close} size="m" aria-label="Загрузка материалов"><Dialog.Header caption="Загрузка материалов"/>
  <Dialog.Body><div className="bulk-picker">
   <input ref={input} type="file" multiple accept={accept} hidden onChange={e=>{add(e.target.files);e.target.value=''}}/>
   {rows.length>0&&<ul className="bulk-files">{rows.map(r=><li key={r.id}>
    <div className="bulk-line"><Checkbox checked={r.checked} disabled={Boolean(r.invalid)} onUpdate={checked=>edit(r.id,{checked})} controlProps={{'aria-label':'Загрузить '+r.file.name}}/>
     <div className="bulk-name"><strong>{r.file.name}</strong><small>{r.invalid||size(r.file.size)}</small></div>
    </div>
    {!r.invalid&&<details className="bulk-fields"><summary>Поля материала</summary><label>Название<TextInput value={r.title} onUpdate={title=>edit(r.id,{title})} controlProps={{maxLength:140}}/></label>
     <div><span>Тип источника</span><Select width="max" aria-label="Тип источника" value={[r.type]} options={types} onUpdate={v=>edit(r.id,{type:v[0]})}/></div>
     <label>Тема<TextInput value={r.project} onUpdate={project=>edit(r.id,{project})} controlProps={{maxLength:80}}/></label></details>}
   </li>)}</ul>}
   <Button view="outlined" onClick={()=>input.current?.click()}><Upload size={16}/>{rows.length?'Добавить ещё файлы':'Выбрать файлы'}</Button>
   <small>PDF, Word, XLSX, TXT, аудио и видео · до 2 ГБ на файл</small>
   <Switch checked={autoSummary} onUpdate={setSummary} content="Создать сводки после обработки"/>
   {autoSummary&&<small>Текст выбранных материалов будет отправлен модели {model}.</small>}
  </div></Dialog.Body>
  <Dialog.Footer textButtonCancel="Отмена" onClickButtonCancel={close} textButtonApply={selected.length?'Загрузить '+countFiles(selected.length):'Загрузить'} propsButtonApply={{disabled:!selected.length}} onClickButtonApply={()=>{start(selected.map(({file,title,type,project})=>({file,title:title.trim()||file.name,type,project,autoSummary})));close()}}/>
 </Dialog>;
}

export default function BatchUpload({open,close,workspace,model,receive,openStudy,busy}:{open:boolean;close:()=>void;workspace:string;model:string;receive:(r:any)=>void;openStudy:(id:string)=>void;busy:React.MutableRefObject<boolean>}){
 const receiveRef=useRef(receive);receiveRef.current=receive;
 const single=useRef(false);
 const [queue]=useState(()=>new UploadQueue(result=>{receiveRef.current(result);if(single.current&&result.createdStudyId)openStudy(result.createdStudyId)}));
 const rows=useSyncExternalStore(queue.subscribe,queue.snapshot);
 const [details,setDetails]=useState(false);
 useEffect(()=>{const sync=()=>{busy.current=queue.busy};const unsubscribe=queue.subscribe(sync);sync();return()=>{unsubscribe();queue.dispose();busy.current=false}},[queue,busy]);
 const done=rows.filter(r=>r.state==='ready').length;
 const failed=rows.filter(r=>r.state==='error'||r.state==='cancel-error').length;
 const cancelled=rows.filter(r=>r.state==='cancelled').length;
 const summary=queue.busy?'Загрузка файлов':failed?'Не все файлы загружены':cancelled===rows.length?'Загрузка отменена':'Загрузка завершена';
 return <>{open&&<Picker close={close} model={model} start={items=>{if(!queue.busy&&rows.every(r=>r.state==='ready'||r.state==='cancelled'))queue.clear();single.current=!queue.snapshot().length&&items.length===1;queue.add(items,workspace)}}/>}
 {rows.length>0&&<aside className={'upload-task-tray bulk-tray'+(rows.length>1?' bulk-stack':'')} aria-label="Загрузка файлов">
  <ArrowUpCircle size={20}/><div><strong role="status">{summary} · {done} из {rows.length}</strong>
   {rows.length===1&&<small>{rows[0].name} · {rows[0].state==='uploading'?rows[0].percent+' %':labels[rows[0].state]}</small>}
   {cancelled>0&&<small>Отменено: {cancelled}</small>}
   <Button size="s" onClick={()=>setDetails(true)}>Подробнее</Button></div>
  {!queue.busy&&!failed&&<Button view="flat" size="s" aria-label="Закрыть уведомление" onClick={()=>queue.clear()}><X size={16}/></Button>}
 </aside>}
 {details&&<Dialog open size="m" aria-label="Ход загрузки" onClose={()=>setDetails(false)}><Dialog.Header caption="Ход загрузки"/><Dialog.Body>
  <ul className="bulk-files bulk-status">{rows.map(r=><li key={r.id}><div className="bulk-line">
   {r.state==='ready'?<CheckCircle2 size={18}/>:<FileText size={18}/>}
   <div className="bulk-name"><strong>{r.name}</strong><small>{size(r.size)} · {labels[r.state]}{r.state==='uploading'?' · '+r.percent+' %':''}</small>
   {r.state==='uploading'&&<progress max={100} value={r.percent} aria-label={'Загрузка '+r.name}/>}
   {r.error&&['error','cancel-error'].includes(r.state)&&<small>{r.error}</small>}</div>
   {r.state==='error'&&<Button size="s" onClick={()=>queue.retry(r.id)}>Повторить</Button>}
   {['queued','uploading','error','cancel-error'].includes(r.state)&&<Button size="s" view="flat" aria-label={'Отменить загрузку '+r.name} onClick={()=>queue.cancel(r.id)}>{r.state==='cancel-error'?'Повторить отмену':'Отменить'}</Button>}
   {r.studyId&&<Button view="flat" size="s" href={'#/study/'+r.studyId} onClick={()=>setDetails(false)}>Открыть</Button>}
  </div></li>)}</ul></Dialog.Body></Dialog>}
 </>;
}
