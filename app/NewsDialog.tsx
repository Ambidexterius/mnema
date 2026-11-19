import React,{useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Button,Dialog,TextArea,Tooltip} from '@gravity-ui/uikit';
import {ArrowUp,Pencil,Plus,X} from 'lucide-react';
import Markdown from 'markdown-to-jsx';
import {api,ApiError} from './api.ts';
import {demoNews,type NewsPost} from './product-news.ts';

type Draft={id?:string;description:string;revision?:number};
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
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[conflict,setConflict]=useState(false);
 const input=useRef<HTMLTextAreaElement>(null),scroll=useRef<HTMLDivElement>(null);
 const returnTo=useRef({id:'',top:0}),restore=useRef(false);
 const fetchPosts=useCallback(async()=>real?(await api<{posts:NewsPost[]}>('/api/news',undefined,'GET',false)).posts:demoNews(),[real]);
 const accept=useCallback((items:NewsPost[])=>{setPosts(items);if(items.length)onSeen(items[0].id)},[onSeen]);
 useEffect(()=>{let live=true;fetchPosts().then(items=>{if(live)accept(items)}).catch(e=>{if(live)setError(e.message)});return()=>{live=false}},[fetchPosts,accept]);
 const editing=draft!==null&&canEdit;
 useLayoutEffect(()=>{
  if(editing){input.current?.focus();return}
  if(!restore.current||!scroll.current)return;
  restore.current=false;const body=scroll.current.parentElement;if(body)body.scrollTop=returnTo.current.top;
  const trigger=returnTo.current.id?document.getElementById('news-edit-'+returnTo.current.id):document.getElementById('news-add');
  trigger?.focus({preventScroll:true});
 },[editing]);
 function message(post:NewsPost){return post.title?'### '+post.title+'\n\n'+post.description:post.description}
 function edit(post?:NewsPost){
  returnTo.current={id:post?.id||'',top:scroll.current?.parentElement?.scrollTop||0};setError('');setConflict(false);
  setDraft(post?{id:post.id,description:message(post),revision:post.revision}:{description:''});
 }
 function cancel(){if(busy)return;restore.current=true;setDraft(null);setError('');setConflict(false)}
 async function save(){
  if(!canEdit||!draft||busy||conflict||!draft.description.trim())return;
  setBusy(true);setError('');
  try{
   let items:NewsPost[];
   if(real){
    const route=draft.id?'/api/news/'+encodeURIComponent(draft.id):'/api/news';
    items=(await api<{posts:NewsPost[]}>(route,draft,draft.id?'PATCH':'POST',false)).posts;
   }else{
    const current=demoNews(),old=current.find(x=>x.id===draft.id);
    if(draft.id&&draft.revision!==old?.revision)throw new ApiError('Новость уже изменили. Ваш текст остался в редакторе.',409);
    const post={id:draft.id||crypto.randomUUID(),title:'',description:draft.description,
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
   if(conflict&&draft){const current=items.find(p=>p.id===draft.id);if(current){setDraft({id:current.id,description:message(current),revision:current.revision});input.current?.focus()}setConflict(false)}
  }catch(e){setError((e as Error).message)}
 }
 return <Dialog open onClose={editing?cancel:onClose} aria-labelledby="news-caption" hasCloseButton size="m" className="updates-dialog" modalClassName="updates-modal" disableHeightTransition>
  <Dialog.Header id="news-caption" caption="Что нового"/>
  <Dialog.Body>
   <div className="updates-feed" ref={scroll}>
    {posts===null&&!error?<p role="status">Загружаем новости…</p>:null}
    {posts?.map(post=><section key={post.id}>
     <div className="news-post-meta">
      {post.date?<time dateTime={post.date}>{dateLabel(post.date)}</time>:null}
      {canEdit?<Tooltip content="Редактировать"><Button id={'news-edit-'+post.id} disabled={editing} view="flat-secondary" size="m"
       aria-label={'Редактировать: '+(post.title||post.description.slice(0,80))} onClick={()=>edit(post)}><Pencil size={16}/></Button></Tooltip>:null}
     </div>
     {post.title?<h3 className="news-title">{post.title}</h3>:null}
     <NewsText value={post.description}/>
    </section>)}
   </div>
   {!editing&&error?<div role="alert" className="news-error"><p>{error}</p><Button onClick={reload}>Попробовать снова</Button></div>:null}
  </Dialog.Body>
  {canEdit?<div className="news-actions">
   {editing?<><div className="news-composer">
    <TextArea controlRef={input} view="clear" value={draft.description} onUpdate={description=>setDraft({...draft,description})}
     minRows={1} maxRows={4} controlProps={{maxLength:24000,'aria-label':'Текст новости'}} placeholder="Напишите новость…"
     onKeyDown={e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)&&!e.nativeEvent.isComposing){e.preventDefault();void save()}}}/>
    <Tooltip content="Отмена"><Button size="m" view="flat-secondary" aria-label="Отмена" disabled={busy} onClick={cancel}><X size={16}/></Button></Tooltip>
    <Tooltip content="Сохранить"><Button size="m" view="action" aria-label="Сохранить" loading={busy} disabled={conflict||!draft.description.trim()} onClick={save}><ArrowUp size={16}/></Button></Tooltip>
   </div>{error?<div className="news-error" role="alert"><p>{error}</p>{conflict?<Button onClick={reload}>Открыть сохранённую версию</Button>:null}</div>:null}</>:
   <Button id="news-add" view="action" disabled={!posts} onClick={()=>edit()}><Plus size={16}/>Добавить новость</Button>}
  </div>:null}
 </Dialog>;
}
