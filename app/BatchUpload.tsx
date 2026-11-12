import React,{useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {Button,Checkbox,Dialog,Select,Switch,TextInput} from '@gravity-ui/uikit';
import {AlertCircle,ArrowUpCircle,CheckCircle2,FileText,FileSpreadsheet,FileVideo,FileAudio,ChevronDown,Plus,Upload,X} from 'lucide-react';
import {existingFileMessage,fileNameKey} from './file-name.ts';
import {UploadQueue,type UploadItem,type UploadRow} from './upload-queue.ts';

const accept='.mp4,.mov,.webm,.mp3,.wav,.m4a,.pdf,.txt,.docx,.doc,.xlsx';
const formats=new Set(accept.split(','));
const types=['Интервью','Юзабилити-тест','Встреча','Отчёт'].map(value=>({value,content:value}));
const size=(bytes:number)=>bytes<1024**2?Math.max(1,Math.round(bytes/1024))+' КБ':new Intl.NumberFormat('ru',{maximumFractionDigits:1}).format(bytes/1024**2)+' МБ';
type Draft=UploadItem&{id:string;checked:boolean;invalid:string};
const countFiles=(n:number)=>n+' '+({one:'файл',few:'файла',many:'файлов',other:'файла'}[new Intl.PluralRules('ru').select(n)]);
const labels:Record<UploadRow['state'],string>={queued:'В очереди',uploading:'Загружается',saving:'Сохраняется',ready:'Загружен',error:'Ошибка загрузки',cancelling:'Отменяем',cancelled:'Отменён','cancel-error':'Ошибка отмены'};

type PickerProps = {
 close:()=>void;
 start:(items:UploadItem[])=>void;
 model:string;
 existingNames:ReadonlySet<string>;
 queuedNames:ReadonlySet<string>;
};
const duplicateSelectionMessage = 'Файл с таким именем уже выбран. Чтобы выбрать этот, снимите отметку с одноимённого файла.';
const queuedFileMessage = 'Файл с таким именем уже в очереди. Чтобы добавить другой, переименуйте его на устройстве и выберите снова.';

function Picker({close,start,model,existingNames,queuedNames}:PickerProps){
 const [rows,setRows]=useState<Draft[]>([]),[autoSummary,setSummary]=useState(true);
 const input=useRef<HTMLInputElement>(null);
 const [expanded,setExpanded]=useState<string|null>(null),[dragging,setDragging]=useState(false);
 function add(files:FileList|null){
   const added=Array.from(files||[]);
   setRows(previous=>{
     const used = new Set(previous.filter(row=>row.checked&&!row.invalid).map(row=>fileNameKey(row.file.name)));
     const next = [...previous];
     for(const file of added){
       const key = fileNameKey(file.name);
       const invalid=!formats.has('.'+file.name.trim().split('.').at(-1)?.toLowerCase())?'Формат не поддерживается':!file.size?'Пустой файл':file.size>2*1024**3?'Файл больше 2 ГБ':'';
       const checked = !invalid&&!used.has(key)&&!existingNames.has(key)&&!queuedNames.has(key);
       if(checked) used.add(key);
       next.push({id:crypto.randomUUID(),file,checked,invalid,title:file.name.replace(/\.[^.]+$/,''),type:'Интервью',project:'',autoSummary:true});
     }
     return next;
   });
 }
 function edit(id:string,change:Partial<Draft>){setRows(prev=>prev.map(r=>r.id===id?{...r,...change}:r))}
 function unavailable(row:Draft){
   const key=fileNameKey(row.file.name);
   if(existingNames.has(key))return existingFileMessage;
   if(queuedNames.has(key))return queuedFileMessage;
   return row.invalid;
 }
 const available=rows.filter(row=>!unavailable(row));
 const selected=available.filter(row=>row.checked);
 const chosenNames=new Set(selected.map(row=>fileNameKey(row.file.name)));
 const availableNames=new Set(available.map(row=>fileNameKey(row.file.name)));
 const allSelected=availableNames.size>0&&chosenNames.size===availableNames.size;
 function toggleAll(){
   const toSelect=new Set<string>();
   setRows(rows.map(row=>{
     const key=fileNameKey(row.file.name);
     const checked=!allSelected&&!unavailable(row)&&!toSelect.has(key)&&(row.checked||!chosenNames.has(key));
     if(checked)toSelect.add(key);
     return {...row,checked};
   }));
 }
 return <Dialog open className="bulk-picker-dialog" onClose={close} size="m" aria-label="Загрузка материалов"><Dialog.Header caption="Загрузка материалов"/>
  <Dialog.Body><div className={'bulk-picker upload-picker'+(dragging?' is-dragging':'')}
    onDragOver={event=>{event.preventDefault();setDragging(true)}}
    onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setDragging(false)}}
    onDrop={event=>{event.preventDefault();setDragging(false);add(event.dataTransfer.files)}}>
   <input ref={input} type="file" multiple accept={accept} hidden onChange={event=>{add(event.target.files);event.target.value=''}}/>
   {!rows.length?<div className="upload-drop">
    <span className="upload-drop-symbol"><Upload size={24} aria-hidden="true"/></span>
    <strong>Перетащите файлы сюда</strong><small>PDF, Word, XLSX, TXT, аудио и видео · до 2 ГБ на файл</small>
    <Button view="outlined" size="l" onClick={()=>input.current?.click()}>Выбрать файлы</Button>
   </div>:<>
    <div className="upload-selection-head"><Checkbox checked={allSelected} indeterminate={selected.length>0&&!allSelected} disabled={!available.length} onUpdate={toggleAll} controlProps={{'aria-label':'Выбрать все файлы'}}/>
     <strong>Выбрано {selected.length} из {rows.length}</strong>
     <Button view="flat" onClick={()=>input.current?.click()}><Plus size={16}/>Добавить файлы</Button>
    </div>
    <ul className="bulk-files upload-choice-list">{rows.map(r=>{
     const extension=r.file.name.split('.').at(-1)?.toUpperCase();
     const Icon=['MP4','MOV','WEBM'].includes(extension)?FileVideo:['MP3','WAV','M4A'].includes(extension)?FileAudio:extension==='XLSX'?FileSpreadsheet:FileText;
     const error=unavailable(r)||(!r.checked&&chosenNames.has(fileNameKey(r.file.name))?duplicateSelectionMessage:'');
     const checked=r.checked&&!error;
     return <li key={r.id} className={checked?'':'unchecked'}>
      <div className="upload-choice"><Checkbox checked={checked} disabled={Boolean(error)} onUpdate={checked=>edit(r.id,{checked})} controlProps={{'aria-label':'Загрузить '+r.file.name,'aria-describedby':error?'upload-error-'+r.id:undefined}}/>
       <span className="upload-kind"><Icon size={19} aria-hidden="true"/></span>
       <div className="bulk-name"><strong>{r.file.name}</strong><small>{extension+' · '+size(r.file.size)}</small>
        {error&&<small id={'upload-error-'+r.id} role="status" style={{color:'var(--g-color-text-danger)'}}>{error}</small>}</div>
       {!error&&<Button view="flat" size="m" aria-label={'Поля материала '+r.file.name} aria-expanded={expanded===r.id} aria-controls={'fields-'+r.id} onClick={()=>setExpanded(expanded===r.id?null:r.id)}>Поля<ChevronDown size={14} className={expanded===r.id?'expanded':''}/></Button>}
      </div>
      {!error&&expanded===r.id&&<div id={'fields-'+r.id} className="upload-edit-fields"><label>Название<TextInput value={r.title} onUpdate={title=>edit(r.id,{title})} controlProps={{maxLength:140}}/></label>
       <div><span>Тип источника</span><Select width="max" aria-label="Тип источника" value={[r.type]} options={types} onUpdate={v=>edit(r.id,{type:v[0]})}/></div>
       <label>Тема<TextInput value={r.project} onUpdate={project=>edit(r.id,{project})} controlProps={{maxLength:80}}/></label></div>}
     </li>
    })}</ul>
   </>}
   <div className="upload-summary-setting"><div><strong>Создать сводки</strong><small>{autoSummary?'После обработки текст получит модель '+model+'.':'Сводку можно создать позже в материале.'}</small></div>
    <Switch checked={autoSummary} onUpdate={setSummary} controlProps={{'aria-label':'Создать сводки после обработки'}}/></div>
  </div></Dialog.Body>
  <Dialog.Footer textButtonCancel="Отмена" onClickButtonCancel={close} textButtonApply={selected.length?'Загрузить '+countFiles(selected.length):'Загрузить'} propsButtonApply={{disabled:!selected.length}} onClickButtonApply={()=>{start(selected.map(({file,title,type,project})=>({file,title:title.trim()||file.name,type,project,autoSummary})));close()}}/>
 </Dialog>;
}

export default function BatchUpload({open,close,workspace,model,studies,receive,openStudy,busy}:{studies:readonly {fileName?:string}[];open:boolean;close:()=>void;workspace:string;model:string;receive:(r:any)=>void;openStudy:(id:string)=>void;busy:React.MutableRefObject<boolean>}){
 const receiveRef=useRef(receive);receiveRef.current=receive;
 const single=useRef(false);
 const [queue]=useState(()=>new UploadQueue(result=>{receiveRef.current(result);if(single.current&&result.createdStudyId)openStudy(result.createdStudyId)}));
 const rows=useSyncExternalStore(queue.subscribe,queue.snapshot);
 const [details,setDetails]=useState(false);
 const toggle=useRef<HTMLButtonElement>(null);
 useEffect(()=>{const sync=()=>{busy.current=queue.busy};const unsubscribe=queue.subscribe(sync);sync();return()=>{unsubscribe();queue.dispose();busy.current=false}},[queue,busy]);
 const done=rows.filter(r=>r.state==='ready').length;
 const failed=rows.filter(r=>r.state==='error'||r.state==='cancel-error').length;
 const cancelled=rows.filter(r=>r.state==='cancelled').length;
 const summary=queue.busy?'Загрузка файлов':failed?'Не все файлы загружены':cancelled===rows.length?'Загрузка отменена':'Загрузка завершена';
 const existingNames=new Set(studies.flatMap(study=>study.fileName?[fileNameKey(study.fileName)]:[]));
 const queuedNames=new Set(rows.filter(row=>row.state!=='cancelled'&&row.state!=='ready'&&!row.permanentDuplicate).map(row=>fileNameKey(row.name)));
 return <>{open&&<Picker close={close} model={model} existingNames={existingNames} queuedNames={queuedNames} start={items=>{if(!queue.busy&&rows.every(r=>r.state==='ready'||r.state==='cancelled'))queue.clear();if(!queue.snapshot().length)setDetails(false);single.current=!queue.snapshot().length&&items.length===1;queue.add(items,workspace)}}/>}
 {rows.length>0&&<aside className="transfer-dock" aria-label="Загрузка файлов" onKeyDown={event=>{if(details&&event.key==='Escape'){setDetails(false);toggle.current?.focus()}}}>
  {details&&<ul className="transfer-list" id="transfer-files" aria-label="Ход загрузки">{rows.map(r=><li key={r.id} className="transfer-card transfer-file">
   {r.state==='ready'?<CheckCircle2 size={18} aria-hidden="true"/>:['error','cancel-error'].includes(r.state)?<AlertCircle size={18} aria-hidden="true"/>:<FileText size={18} aria-hidden="true"/>}
   <div className="bulk-name"><strong>{r.name}</strong><small>{size(r.size)} · {labels[r.state]}{r.state==='uploading'?' · '+r.percent+' %':''}</small>
   {r.state==='uploading'&&<progress max={100} value={r.percent} aria-label={'Загрузка '+r.name}/>}
   {r.error&&['error','cancel-error'].includes(r.state)&&<small>{r.error}</small>}</div>
   <div className="transfer-actions">{r.state==='error'&&!r.permanentDuplicate&&<Button size="s" onClick={()=>queue.retry(r.id)}>Повторить</Button>}
   {['queued','uploading','error','cancel-error'].includes(r.state)&&<Button size="s" view="flat" aria-label={(r.permanentDuplicate?'Убрать из очереди ':'Отменить загрузку ')+r.name} onClick={()=>queue.cancel(r.id)}>{r.state==='cancel-error'?'Повторить отмену':r.permanentDuplicate?'Убрать':'Отменить'}</Button>}
   {r.studyId&&<Button view="flat" size="s" href={'#/study/'+r.studyId} onClick={()=>setDetails(false)}>Открыть</Button>}</div>
  </li>)}</ul>}
  <div className="transfer-head" data-layers={details?0:Math.min(rows.length-1,2)}>
   <div className="transfer-card transfer-front">
    <button className="transfer-toggle" ref={toggle} aria-expanded={details} aria-controls={details?'transfer-files':undefined} onClick={()=>setDetails(!details)}>
     {queue.busy?<ArrowUpCircle size={19}/>:failed?<AlertCircle size={19}/>:done?<CheckCircle2 size={19}/>:<X size={19}/>}
     <span><strong>{summary}</strong><small>{rows.length===1?rows[0].name+' · '+(rows[0].state==='uploading'?rows[0].percent+' %':labels[rows[0].state]):'Загружено: '+done+' из '+rows.length+(cancelled?' · Отменено: '+cancelled:'')}</small></span>
     <span className="transfer-disclosure">{details?'Свернуть':'Подробнее'}</span>
    </button>
    {!queue.busy&&!failed&&<Button view="flat" size="s" aria-label="Закрыть уведомление" onClick={()=>{setDetails(false);queue.clear()}}><X size={16}/></Button>}
   </div>
  </div><span className="transfer-sr" role="status">{summary}. Загружено: {done} из {rows.length}</span>
 </aside>}
 </>;
}
