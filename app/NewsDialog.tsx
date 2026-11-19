import React,{useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Button,Dialog,SegmentedRadioGroup,TextArea,TextInput,Tooltip} from '@gravity-ui/uikit';
import {Pencil,Plus} from 'lucide-react';
import Markdown from 'markdown-to-jsx';
import {api,ApiError} from './api.ts';
import {demoNews,type NewsPost} from './product-news.ts';

type Draft={id?:string;title:string;description:string;revision?:number};
const formatter=new Intl.DateTimeFormat('ru',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
const markdownOptions={disableParsingRawHTML:true,forceBlock:true,overrides:{
 a:{props:{target:'_blank',rel:'noopener noreferrer'}},
 img:{props:{loading:'lazy',referrerPolicy:'no-referrer'}}
}} as const;
const dateLabel=(date:string)=>formatter.format(new Date(date+'T12:00:00Z')).replace(/\s*г\.$/,'');
function NewsText({value}:{value:string}){return <div className="news-markdown"><Markdown options={markdownOptions}>{value}</Markdown></div>}

export default function NewsDialog({real,canEdit,onSeen,onClose}:{
 real:boolean;canEdit:boolean;onSeen:(id:string)=>void;onClose:()=>void
}){
 const [posts,setPosts]=useState<NewsPost[]|null>(null),[draft,setDraft]=useState<Draft|null>(null);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[conflict,setConflict]=useState(false),[preview,setPreview]=useState(false);
 const titleInput=useRef<HTMLInputElement>(null),scroll=useRef<HTMLDivElement>(null);
 const returnTo=useRef({id:'',top:0}),restore=useRef(false);
 const fetchPosts=useCallback(async()=>real?(await api<{posts:NewsPost[]}>('/api/news',undefined,'GET',false)).posts:demoNews(),[real]);
 const accept=useCallback((items:NewsPost[])=>{setPosts(items);if(items.length)onSeen(items[0].id)},[onSeen]);
 useEffect(()=>{let live=true;fetchPosts().then(items=>{if(live)accept(items)}).catch(e=>{if(live)setError(e.message)});return()=>{live=false}},[fetchPosts,accept]);
 const editing=draft!==null&&canEdit;
 useLayoutEffect(()=>{
  if(editing){titleInput.current?.focus();return}
  if(!restore.current||!scroll.current)return;
  restore.current=false;const body=scroll.current.parentElement;if(body)body.scrollTop=returnTo.current.top;
  const trigger=returnTo.current.id?document.getElementById('news-edit-'+returnTo.current.id):document.getElementById('news-add');
  trigger?.focus({preventScroll:true});
 },[editing]);
 function edit(post?:NewsPost){
  returnTo.current={id:post?.id||'',top:scroll.current?.parentElement?.scrollTop||0};setError('');setConflict(false);setPreview(false);
  setDraft(post?{id:post.id,title:post.title,description:post.description,revision:post.revision}:{title:'',description:''});
 }
 function cancel(){if(busy)return;restore.current=true;setDraft(null);setError('');setConflict(false)}
 async function save(){
  if(!canEdit||!draft||busy||conflict||!draft.title.trim()||!draft.description.trim())return;
  setBusy(true);setError('');
  try{
   let items:NewsPost[];
   if(real){
    const route=draft.id?'/api/news/'+encodeURIComponent(draft.id):'/api/news';
    items=(await api<{posts:NewsPost[]}>(route,draft,draft.id?'PATCH':'POST',false)).posts;
   }else{
    const current=demoNews(),old=current.find(x=>x.id===draft.id);
    if(draft.id&&draft.revision!==old?.revision)throw new ApiError('Новость уже изменили. Ваш текст остался в редакторе.',409);
    const post={id:draft.id||crypto.randomUUID(),title:draft.title.trim(),description:draft.description,
     date:old?old.date:new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow'}).format(new Date()),revision:(old?.revision||0)+1};
    items=old?current.map(p=>p.id===post.id?post:p):[post,...current];
    localStorage.setItem('mnema.demo.news',JSON.stringify(items));
   }
   accept(items);if(!draft.id)returnTo.current={id:items[0].id,top:0};
   restore.current=true;setDraft(null);
  }catch(e){setError((e as Error).message);if(e instanceof ApiError&&e.status===409)setConflict(true)}
  finally{setBusy(false)}
 }
 async function reload(){
  try{
   const items=await fetchPosts();accept(items);setError('');
   if(conflict&&draft){const current=items.find(p=>p.id===draft.id);if(current){setDraft({...current});setPreview(false)}setConflict(false)}
  }catch(e){setError((e as Error).message)}
 }
 const caption=editing?(draft.id?'Редактировать новость':'Новая новость'):'Что нового';
 return <Dialog open onClose={editing?cancel:onClose} aria-labelledby="news-caption" hasCloseButton size="m" className="updates-dialog" modalClassName="updates-modal" disableHeightTransition>
  <Dialog.Header id="news-caption" caption={caption}/>
  {!editing&&canEdit?<div className="news-actions"><Button id="news-add" view="action" disabled={!posts} onClick={()=>edit()}><Plus size={16}/>Добавить новость</Button></div>:null}
  <Dialog.Body>
   {editing?<div className="news-form">
    <TextInput label="Заголовок" controlRef={titleInput} value={draft.title} onUpdate={title=>setDraft({...draft,title})} controlProps={{maxLength:160,'aria-label':'Заголовок'}}/>
    <div className="news-description-head"><label htmlFor="news-description">Описание</label>
     <SegmentedRadioGroup name="Режим описания" value={preview?'preview':'text'} onUpdate={v=>setPreview(v==='preview')} options={[{value:'text',content:'Текст'},{value:'preview',content:'Предпросмотр'}]}/>
    </div>
    {preview?(draft.description.trim()?<NewsText value={draft.description}/>:<p className="muted">Описание пока пустое.</p>):
     <TextArea id="news-description" value={draft.description} onUpdate={description=>setDraft({...draft,description})} minRows={6} controlProps={{maxLength:20000,'aria-label':'Описание'}} placeholder="Введите текст в формате Markdown"/>}
   </div>:<div className="updates-feed" ref={scroll}>
    {posts===null&&!error?<p role="status">Загружаем новости…</p>:null}
    {posts?.map(post=><section key={post.id}>
     {post.date?<time dateTime={post.date}>{dateLabel(post.date)}</time>:null}
     <div className="news-post-heading"><h3>{post.title}</h3>{canEdit?<Tooltip content="Редактировать">
      <Button id={'news-edit-'+post.id} view="flat-secondary" size="m" aria-label={'Редактировать: '+post.title} onClick={()=>edit(post)}><Pencil size={16}/></Button>
     </Tooltip>:null}</div><NewsText value={post.description}/>
    </section>)}
   </div>}
   {error?<div className="news-error" role="alert"><p>{error}</p>{(!editing||conflict)?<Button onClick={reload}>{conflict?'Открыть сохранённую версию':'Попробовать снова'}</Button>:null}</div>:null}
  </Dialog.Body>
  {editing?<Dialog.Footer textButtonCancel="Отмена" onClickButtonCancel={cancel} propsButtonCancel={{disabled:busy}}
   textButtonApply={draft.id?'Сохранить':'Опубликовать'} onClickButtonApply={save} propsButtonApply={{loading:busy,disabled:conflict||!draft.title.trim()||!draft.description.trim()}}/>:null}
 </Dialog>;
}
