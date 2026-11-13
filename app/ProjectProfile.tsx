import React,{useEffect,useRef,useState} from 'react';
import {Button,Dialog,Label,TextInput,TextArea,Select} from '@gravity-ui/uikit';
import {Pencil} from 'lucide-react';
import {api} from './api.ts';

const empty={category:'',conducted:'',method:'',audience:'',contact:'',report:''};
type Fields=typeof empty;
type Project={id:string;name:string;creatorName?:string;created?:number;profile?:Partial<Fields>&{revision?:number}};
export default function ProjectProfile({project,editable,onSave}:{project:Project;editable:boolean;onSave:(result:any)=>void}){
 const [draft,setDraft]=useState<Fields>(empty);
 const [editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const revision=useRef(0),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
 const fields={...empty,...project.profile};
 function edit(){
   setDraft({...empty,...Object.fromEntries(Object.keys(empty).map(k=>[k,fields[k]]))});
   revision.current=project.profile?.revision||0;
   setError('');setEditing(true);
 }
 async function save(){
   if(busy)return;
   setBusy(true);setError('');
   try{
     const data=await api('/api/workspaces/'+encodeURIComponent(project.id)+'/profile',{fields:draft,revision:revision.current},'PATCH');
     if(mounted.current){onSave(data);setEditing(false)}
   }catch(e){if(mounted.current)setError((e as Error).message)}
   finally{if(mounted.current)setBusy(false)}
 }
 const set=(key:keyof Fields,value:string)=>setDraft(d=>({...d,[key]:value}));
 const reportText=fields.report==='ready'?'Отчёт есть':fields.report==='none'?'Без отчёта':'';
 return <section className="project-profile" aria-labelledby="profile-title">
  <div className="profile-meta">
   {fields.category&&<Label>{fields.category}</Label>}
   {reportText&&<Label theme={fields.report==='ready'?'success':'normal'}>{reportText}</Label>}
   {fields.conducted&&<span>Проведено: {fields.conducted}</span>}
   {project.created&&<span>Добавлено {new Intl.DateTimeFormat('ru',{day:'numeric',month:'long',year:'numeric',timeZone:'Europe/Moscow'}).format(project.created)}</span>}
  </div>
  <div className="profile-card">
   <div className="profile-card-head"><h2 id="profile-title">Об исследовании</h2>{editable&&<Button size="s" view="flat" onClick={edit}><Pencil size={15}/>Редактировать</Button>}</div>
   <dl>{[['Метод',fields.method],['Аудитория',fields.audience],['Автор',project.creatorName],['Контакт',fields.contact]].filter(([label,value])=>value||label==='Автор').map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value||'Не указан'}</dd></div>)}</dl>
  </div>
  <Dialog open={editing} onClose={()=>{if(!busy)setEditing(false)}}><Dialog.Header caption="Об исследовании"/><Dialog.Body>
   <div className="profile-form">
    {([['category','Категория',80],['conducted','Период исследования',100],['method','Метод',200],['audience','Аудитория',10000],['contact','Контакт',200]] as const).map(([key,label,max])=><label key={key}>{label}{key==='audience'?<TextArea value={draft[key]} onUpdate={v=>set(key,v)} minRows={5} controlProps={{maxLength:max,'aria-label':label}}/>:<TextInput value={draft[key]} onUpdate={v=>set(key,v)} controlProps={{maxLength:max,'aria-label':label}}/>}</label>)}
    <label>Отчёт<Select width="max" aria-label="Отчёт" value={[draft.report||'unknown']} onUpdate={v=>set('report',v[0]==='unknown'?'':v[0])} options={[{value:'unknown',content:'Не указано'},{value:'ready',content:'Отчёт есть'},{value:'none',content:'Без отчёта'}]}/></label>
    {error&&<p role="alert">{error}</p>}
   </div></Dialog.Body><Dialog.Footer textButtonCancel="Отмена" textButtonApply="Сохранить" onClickButtonCancel={()=>setEditing(false)} onClickButtonApply={save} propsButtonCancel={{disabled:busy}} propsButtonApply={{loading:busy}}/></Dialog>
 </section>;
}
