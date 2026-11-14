import React,{useEffect,useRef,useState} from 'react';
import {Button,Label,Popup,Select} from '@gravity-ui/uikit';
import {AtSign,CalendarDays,CalendarPlus,Check,ChevronLeft,ChevronRight,FileCheck,ListChecks,Minus,Tag,User,Users} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';
import {api} from './api.ts';

const empty={category:'',conducted:'',method:'',audience:'',contact:'',report:''};
type Fields=typeof empty;
type Project={id:string;name:string;creatorName?:string;created?:number;profile?:Partial<Fields>&{tags?:string[];revision?:number}};
const limits:Record<string,number>={method:200,audience:10000,contact:200};
const reportOptions=[{value:'ready',content:'Есть'},{value:'none',content:'Нет'},{value:'unknown',content:'Не указано'}];
// Same Gravity Label as finding tags. Green for a ready report, grey for none; the icon keeps the meaning without colour.
const reportBadge=(value:string)=>value==='ready'?<Label size="s" theme="success" icon={<Check size={12}/>}>Есть</Label>:value==='none'?<Label size="s" theme="normal" icon={<Minus size={12}/>}>Нет</Label>:<span className="property-hint">Не указано</span>;
const months=Array.from({length:12},(_,i)=>{const name=new Intl.DateTimeFormat('ru',{month:'long'}).format(new Date(2026,i,15));return name[0].toUpperCase()+name.slice(1)});

/** Obsidian-style properties: click a value to edit, Enter saves, Escape cancels. */
export default function ProjectProfile({project,editable,onSave}:{project:Project;editable:boolean;onSave:(result:any)=>void}){
 const [error,setError]=useState(''),[expanded,setExpanded]=useState(false),busy=useRef(false);
 const fields={...empty,...project.profile};
 // Older projects kept one category; it becomes the first tag until tags are saved.
 const tags=project.profile?.tags??(fields.category?[fields.category]:[]);
 async function save(patch:Partial<Fields>&{tags?:string[]}){
  if(busy.current)return false;busy.current=true;setError('');
  try{
   const next=Object.fromEntries(Object.keys(empty).map(k=>[k,(patch as any)[k]??fields[k as keyof Fields]]));
   onSave(await api('/api/workspaces/'+encodeURIComponent(project.id)+'/profile',{fields:{...next,tags:patch.tags??tags},revision:project.profile?.revision||0},'PATCH'));
   return true;
  }catch(e){setError((e as Error).message);return false}finally{busy.current=false}
 }
 const added=project.created?new Intl.DateTimeFormat('ru',{day:'numeric',month:'long',year:'numeric',timeZone:'Europe/Moscow'}).format(project.created):'';
 const text=(key:keyof typeof limits,multiline=false)=><TextValue value={fields[key as keyof Fields]} max={limits[key]} multiline={multiline} editable={editable} onSave={value=>save({[key]:value})}/>;
 const rows:[LucideIcon,string,React.ReactNode,boolean][]=[
  [User,'Автор',<span className="property-text">{project.creatorName||'Не указан'}</span>,true],
  [Users,'Аудитория',text('audience',true),Boolean(fields.audience)],
  [ListChecks,'Метод',text('method'),Boolean(fields.method)],
  [CalendarDays,'Проведено',<MonthValue value={fields.conducted} editable={editable} onSave={value=>save({conducted:value})}/>,Boolean(fields.conducted)],
  [FileCheck,'Отчёт',editable?<Select view="clear" width="auto" aria-label="Отчёт" value={[fields.report||'unknown']} onUpdate={v=>void save({report:v[0]==='unknown'?'':v[0]})} options={reportOptions} renderSelectedOption={o=>reportBadge(o.value)} renderOption={o=>reportBadge(o.value)}/>:reportBadge(fields.report),Boolean(fields.report)],
  [AtSign,'Контакт',text('contact'),Boolean(fields.contact)],
  [CalendarPlus,'Добавлено',<span className="property-text">{added}</span>,Boolean(added)],
  [Tag,'Теги',<TagsValue tags={tags} editable={editable} onSave={next=>save({tags:next})}/>,tags.length>0],
 ];
 const shown=rows.filter(([,,,filled])=>editable||filled),key=['Метод','Проведено','Отчёт'];
 return <section className="project-profile" aria-label="Об исследовании" data-collapsed={expanded?undefined:''}>
  <dl className="properties">{shown.map(([Icon,label,value])=><div key={label} className={key.includes(label)?undefined:'is-extra'}><dt><Icon size={16} aria-hidden="true"/>{label}</dt><dd>{value}</dd></div>)}</dl>
  {/* Phones show three key properties; the toggle is hidden on wider screens. */}
  <button type="button" className="properties-toggle" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?'Свернуть':'Все свойства · '+shown.length}</button>
  {error?<p className="properties-error" role="alert">{error}</p>:null}
 </section>;
}

function TextValue({value,max,multiline,editable,onSave}:{value:string;max:number;multiline:boolean;editable:boolean;onSave:(value:string)=>Promise<boolean>}){
 const [draft,setDraft]=useState<string|null>(null),input=useRef<HTMLTextAreaElement>(null);
 useEffect(()=>{const el=input.current;if(!el)return;el.focus();el.select();el.style.height='auto';el.style.height=el.scrollHeight+'px'},[draft===null]);
 if(!editable)return <span className="property-text">{value}</span>;
 if(draft===null)return <button type="button" className={'property-value'+(value?'':' is-empty')} onClick={()=>setDraft(value)}>{value||'Пусто'}</button>;
 const commit=async()=>{const next=draft.trim();if(next===value.trim()||await onSave(next))setDraft(null)};
 return <textarea ref={input} className="property-input" rows={1} value={draft} maxLength={max} aria-label="Значение свойства"
  onChange={e=>{setDraft(e.target.value);e.target.style.height='auto';e.target.style.height=e.target.scrollHeight+'px'}}
  onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();setDraft(null)}else if(e.key==='Enter'&&!(multiline&&e.shiftKey)&&!e.nativeEvent.isComposing){e.preventDefault();void commit()}}}
  onBlur={()=>void commit()}/>;
}

function TagsValue({tags,editable,onSave}:{tags:string[];editable:boolean;onSave:(tags:string[])=>Promise<boolean>}){
 const [draft,setDraft]=useState(''),[adding,setAdding]=useState(false);
 const add=async()=>{const tag=draft.trim().slice(0,40);if(!tag){setAdding(false);return}if(tags.includes(tag)||tags.length>=20||await onSave([...tags,tag]))setDraft('')};
 return <div className="property-tags" onClick={e=>{if(editable&&e.target===e.currentTarget)setAdding(true)}}>
  {tags.map(tag=><Label key={tag} size="s" theme="normal" type={editable?'close':'default'} closeButtonLabel={'Удалить тег «'+tag+'»'} onCloseClick={()=>void onSave(tags.filter(t=>t!==tag))}>{tag}</Label>)}
  {editable&&(adding||!tags.length)?<input className="property-tag-input" value={draft} maxLength={40} autoFocus={adding} placeholder={tags.length?'':'Добавить тег'} aria-label="Новый тег"
   onChange={e=>setDraft(e.target.value)} onBlur={()=>{void add();setAdding(false)}}
   onKeyDown={e=>{if((e.key==='Enter'||e.key===',')&&!e.nativeEvent.isComposing){e.preventDefault();void add()}else if(e.key==='Escape'){setDraft('');setAdding(false)}else if(e.key==='Backspace'&&!draft&&tags.length)void onSave(tags.slice(0,-1))}}/>
  :editable?<button type="button" className="property-tag-add" onClick={()=>setAdding(true)}>+ Тег</button>:null}
 </div>;
}

/** «Проведено» stores a month and year, e.g. «Ноябрь 2026»; picking a month saves and closes. */
function MonthValue({value,editable,onSave}:{value:string;editable:boolean;onSave:(value:string)=>Promise<boolean>}){
 const [anchor,setAnchor]=useState<HTMLButtonElement|null>(null),[open,setOpen]=useState(false);
 const savedYear=Number(value.match(/\d{4}/)?.[0])||new Date().getFullYear(),savedMonth=months.findIndex(m=>value.toLowerCase().startsWith(m.toLowerCase()));
 const [year,setYear]=useState(savedYear);
 if(!editable)return <span className="property-text">{value}</span>;
 return <>
  <button ref={setAnchor} type="button" className={'property-value'+(value?'':' is-empty')} aria-haspopup="dialog" aria-expanded={open} onClick={()=>{setYear(savedYear);setOpen(!open)}}>{value||'Пусто'}</button>
  <Popup open={open} anchorElement={anchor} placement="bottom-start" onOpenChange={setOpen} returnFocus>
   <div className="month-picker" role="dialog" aria-label="Месяц и год исследования">
    <div className="month-picker-head"><Button view="flat" size="s" aria-label="Предыдущий год" onClick={()=>setYear(y=>y-1)}><ChevronLeft size={16} aria-hidden="true"/></Button><span aria-live="polite">{year}</span><Button view="flat" size="s" aria-label="Следующий год" onClick={()=>setYear(y=>y+1)}><ChevronRight size={16} aria-hidden="true"/></Button></div>
    <div className="month-picker-grid">{months.map((m,i)=>{const selected=i===savedMonth&&year===savedYear;return <Button key={m} view={selected?'action':'flat'} size="m" width="max" selected={selected} onClick={async()=>{setOpen(false);if(!selected)await onSave(m+' '+year)}}>{m}</Button>})}</div>
   </div>
  </Popup>
 </>;
}
