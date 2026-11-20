import React,{useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Button,Dialog,TextArea,Tooltip} from '@gravity-ui/uikit';
import {ArrowDown,Check,Pencil,Plus,Trash2,X} from 'lucide-react';
import Markdown from 'markdown-to-jsx';
import NewsFormatting from './NewsFormatting.tsx';
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
 const [deleting,setDeleting]=useState<NewsPost|null>(null);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[conflict,setConflict]=useState(false);
 const input=useRef<HTMLTextAreaElement>(null),scroll=useRef<HTMLDivElement>(null);
 const returnTo=useRef({id:'',top:0}),restore=useRef(false);
 const deleteReturn=useRef<{id:string;top:number}|null>(null);
 const fetchPosts=useCallback(async()=>real?(await api<{posts:NewsPost[]}>('/api/news',undefined,'GET',false)).posts:demoNews(),[real]);
 const accept=useCallback((items:NewsPost[])=>{setPosts(items);onSeen(items[0]?.id??'')},[onSeen]);
 useEffect(()=>{let live=true;fetchPosts().then(items=>{if(live)accept(items)}).catch(e=>{if(live)setError(e.message)});return()=>{live=false}},[fetchPosts,accept]);
 const editing=draft!==null&&canEdit;
 useLayoutEffect(()=>{
  if(editing){
   input.current?.focus({preventScroll:true});
   input.current?.closest('.news-edit-inline')?.scrollIntoView({block:'nearest'});
   return;
  }
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
 function startDelete(post:NewsPost){
  deleteReturn.current={id:'news-delete-'+post.id,top:scroll.current?.parentElement?.scrollTop||0};
  setError('');setDeleting(post);
 }
 function restoreAfterDelete(){
  const target=deleteReturn.current,body=scroll.current?.parentElement;
  if(!target||!body||deleting)return;
  deleteReturn.current=null;
  body.scrollTop=target.top;
  document.getElementById(target.id)?.focus({preventScroll:true});
 }
 function closeDelete(){if(!busy){setDeleting(null);setError('')}}
 async function removeNews(){
  if(!canEdit||!deleting||busy)return;
  setBusy(true);setError('');
  try{
   let items:NewsPost[];
   if(real){
    items=(await api<{posts:NewsPost[]}>('/api/news/'+encodeURIComponent(deleting.id),{revision:deleting.revision},'DELETE',false)).posts;
   }else{
    const current=demoNews(),latest=current.find(post=>post.id===deleting.id);
    if(latest&&latest.revision!==deleting.revision)throw new ApiError('Новость уже изменили. Обновите ленту перед удалением.',409);
    items=current.filter(post=>post.id!==deleting.id);
    localStorage.setItem('mnema.demo.news',JSON.stringify(items));
   }
   accept(items);setDeleting(null);
   if(deleteReturn.current)deleteReturn.current.id='news-add';
  }catch(e){
   setError((e as Error).message);
   if(e instanceof ApiError&&e.status===409)setDeleting(null);
  }finally{setBusy(false)}
 }
 async function reload(){
  try{
   const items=await fetchPosts();accept(items);setError('');
   if(conflict&&draft){const current=items.find(p=>p.id===draft.id);if(current){setDraft({id:current.id,description:message(current),revision:current.revision});input.current?.focus()}setConflict(false)}
  }catch(e){setError((e as Error).message)}
 }
 const editor=editing?<>
   <div className="news-composer">
    <NewsFormatting input={input} value={draft.description} onUpdate={description=>setDraft({...draft,description})}>
    <TextArea controlRef={input} view="clear" value={draft.description} onUpdate={description=>setDraft({...draft,description})}
     minRows={1} controlProps={{maxLength:24000,'aria-label':'Текст новости'}} placeholder="Напишите новость…"
     onKeyDown={e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)&&!e.nativeEvent.isComposing){e.preventDefault();void save()}}}/>
    </NewsFormatting>
    <div className="news-composer-buttons">
     <Tooltip content="Отмена"><Button size="m" view="flat-secondary" aria-label="Отмена" disabled={busy} onClick={cancel}><X size={16}/></Button></Tooltip>
     <Tooltip content="Сохранить"><Button size="m" view="action" aria-label="Сохранить" loading={busy} disabled={conflict||!draft.description.trim()} onClick={save}>{draft.id?<Check size={16}/>:<ArrowDown size={16}/>}</Button></Tooltip>
    </div>
   </div>{error?<div className="news-error" role="alert"><p>{error}</p>{conflict?<Button onClick={reload}>Открыть сохранённую версию</Button>:null}</div>:null}
 </>:null;
 return <>
 <Dialog open={!deleting} onClose={editing?cancel:onClose} onTransitionInComplete={restoreAfterDelete} aria-labelledby="news-caption" hasCloseButton size="m" className="updates-dialog" modalClassName="updates-modal" disableHeightTransition>
  <Dialog.Header id="news-caption" caption="Что нового"/>
  {canEdit?<div className="news-add-row">
   <Button id="news-add" view={editing?'normal':'action'} disabled={editing||!posts} onClick={()=>edit()}><Plus size={16}/>Добавить новость</Button>
  </div>:null}
  {editor&&!draft?.id?<div className="news-actions">{editor}</div>:null}
  <Dialog.Body>
   <div className="updates-feed" ref={scroll}>
    {posts===null&&!error?<p role="status">Загружаем новости…</p>:null}
    {posts?.length===0?<p>Пока нет новостей</p>:null}
    {posts?.map(post=><section key={post.id}>
     <div className="news-post-meta">
      {post.date?<time dateTime={post.date}>{dateLabel(post.date)}</time>:null}
      {canEdit?<div className="news-post-tools"><Tooltip content="Редактировать"><Button id={'news-edit-'+post.id} disabled={editing||Boolean(deleting)} view="flat-secondary" size="m"
       aria-label={'Редактировать: '+(post.title||post.description.slice(0,80))} onClick={()=>edit(post)}><Pencil size={16}/></Button></Tooltip>
       <Tooltip content="Удалить"><Button id={'news-delete-'+post.id} disabled={editing||Boolean(deleting)} view="flat-secondary" size="m"
        aria-label={'Удалить: '+(post.title||post.description.slice(0,80))} onClick={()=>startDelete(post)}><Trash2 size={16}/></Button></Tooltip>
      </div>:null}
     </div>
     {editor&&draft?.id===post.id?<div className="news-edit-inline">{editor}</div>:<>
      {post.title?<h3 className="news-title">{post.title}</h3>:null}
      <NewsText value={post.description}/>
     </>}
    </section>)}
   </div>
   {!editing&&!deleting&&error?<div role="alert" className="news-error"><p>{error}</p><Button onClick={reload}>Попробовать снова</Button></div>:null}
  </Dialog.Body>
 </Dialog>
 <Dialog open={canEdit&&Boolean(deleting)} onClose={closeDelete} initialFocus="cancel" size="s" aria-labelledby="news-delete-caption">
  <Dialog.Header id="news-delete-caption" caption="Удалить новость?"/>
  <Dialog.Body>
   <p className="dialog-copy">Новость исчезнет из ленты у всех участников.</p>
   {error?<p className="news-error" role="alert">{error}</p>:null}
  </Dialog.Body>
  <Dialog.Footer onClickButtonCancel={closeDelete} textButtonCancel="Отмена"
   onClickButtonApply={removeNews} textButtonApply="Удалить новость"
   propsButtonCancel={{disabled:busy}} propsButtonApply={{view:'outlined-danger'}} loading={busy}/>
 </Dialog>
 </>;
}
