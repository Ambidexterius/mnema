import React,{useEffect,useState} from 'react';
import {Avatar,Button,Dialog,Label,Modal,SegmentedRadioGroup,Select,TextArea,TextInput,Tooltip} from '@gravity-ui/uikit';
import {ArrowLeft,Check,EyeOff,Lightbulb,MessageSquare,Pencil,Search,ThumbsDown,ThumbsUp,X} from 'lucide-react';
import {api} from './api.ts';
import ChatComposer from './ChatComposer.tsx';

type Status='open'|'progress'|'done'|'declined';
type Idea={id:string;text:string;status:Status;reason:string;hidden:boolean;created:number;author:string;mine:boolean;votes:number;voted:boolean;comments:number};
type Comment={id:string;text:string;created:number;author:string};
// «Отклонили» is not a public tab for now: declined ideas stay visible to their author in «Мои идеи».
const TABS:[string,string][]=[['open','Голосование'],['progress','В работе'],['done','Сделали'],['mine','Мои идеи']];
const LABEL:Record<Status,string>={open:'Голосование',progress:'В работе',done:'Сделали',declined:'Отклонили'};
const THEME:Record<Status,'normal'|'info'|'success'|'danger'>={open:'normal',progress:'info',done:'success',declined:'danger'};
const EMPTY:Record<string,[string,string]>={
 open:['Идей пока нет','Предложите улучшение. Коллеги смогут поддержать вашу идею.'],
 progress:['Сейчас в\u00a0работе ничего нет','Сюда попадут идеи, которые мы начали делать'],
 done:['Пока ничего не\u00a0сделали','Здесь появятся идеи, которые уже в\u00a0Мнемонике'],
 mine:['Вы ещё не\u00a0предлагали идей','Расскажите, что улучшить в сервисе. Напишем, когда реализуем идею.'],
 search:['Ничего не\u00a0нашлось','Измените запрос или предложите новую идею.']};
const when=(t:number)=>new Date(t).toLocaleDateString('ru-RU',{day:'numeric',month:'short'});
const PLACEHOLDER='Например: нужна выгрузка находок в Excel, чтобы собирать отчёт для бизнеса';

// Two-step feedback: the answer buttons are the content, so the first step has no footer.
export function FeedbackDialog({open,onClose,onIdeas}:{open:boolean;onClose:()=>void;onIdeas:()=>void}){
 const [step,setStep]=useState<'ask'|'idea'|'liked'|'sent'>('ask'),[text,setText]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{if(open){setStep('ask');setText('');setError('')}},[open]);
 const rate=async(rating:'up'|'down')=>{setError('');try{await api('/api/interface-rating',{rating},'POST',false);setStep(rating==='up'?'liked':'idea')}catch(e:any){setError(e.message)}};
 const send=async()=>{setBusy(true);setError('');try{await api('/api/ideas',{text},'POST',false);setStep('sent')}catch(e:any){setError(e.message)}finally{setBusy(false)}};
 const done=step==='liked'||step==='sent';
 return <Dialog open={open} onClose={onClose} size="s" aria-labelledby="feedback-title">
  {done?null:<Dialog.Header caption={<span id="feedback-title">{step==='idea'?'Что улучшить?':'Как оцениваете сервис?'}</span>}/>}
  <Dialog.Body>
   {step==='ask'?<div className="feedback-rate"><button type="button" className="feedback-choice" onClick={()=>rate('up')}><ThumbsUp size={32} aria-hidden="true"/>Нравится</button><button type="button" className="feedback-choice" onClick={()=>rate('down')}><ThumbsDown size={32} aria-hidden="true"/>Есть что улучшить</button></div>:null}
   {step==='idea'?<><TextArea value={text} onUpdate={setText} minRows={4} maxRows={10} placeholder={PLACEHOLDER} controlProps={{'aria-label':'Что улучшить'}} autoFocus/><p className="feedback-hint">Идею увидят коллеги и смогут её поддержать</p></>:null}
   {done?<div className="feedback-done" role="status">
    <span className="feedback-done-icon" aria-hidden="true">{step==='liked'?<ThumbsUp size={32}/>:<Check size={32}/>}</span>
    <h2 id="feedback-title">{step==='liked'?'Спасибо за оценку':'Идея опубликована'}</h2>
    <p>{step==='liked'?'Посмотрите, что предлагают коллеги, и\u00a0поддержите полезные идеи':'Напишем на\u00a0почту, когда сделаем её или решим не\u00a0делать'}</p>
    <Button view="flat" size="l" width="max" onClick={onIdeas}>Открыть портал идей</Button>
    <Button view="flat-secondary" size="xl" width="max" onClick={onClose}>Закрыть</Button>
   </div>:null}
   {error?<p className="auth-error" role="alert">{error}</p>:null}
  </Dialog.Body>
  {step==='ask'?<Dialog.Footer className="feedback-portal-footer"><Button view="flat" size="l" onClick={onIdeas}>Открыть портал идей</Button></Dialog.Footer>:null}
  {step==='idea'?<Dialog.Footer textButtonCancel="Отмена" onClickButtonCancel={onClose} textButtonApply="Отправить" onClickButtonApply={send} loading={busy} propsButtonApply={{disabled:text.trim().length<3}}/>:null}
 </Dialog>;
}

// Ideas board as a right-side sheet over the current page: search, status tabs, votes, comments; owner moderates.
export function IdeasPanel({open,onClose}:{open:boolean;onClose:()=>void}){
 const [ideas,setIdeas]=useState<Idea[]|null>(null),[admin,setAdmin]=useState(false),[tab,setTab]=useState('open'),[query,setQuery]=useState('');
 const [error,setError]=useState(''),[adding,setAdding]=useState(false),[draft,setDraft]=useState(''),[busy,setBusy]=useState(false),[openId,setOpenId]=useState<string|null>(null),[editing,setEditing]=useState<Idea|null>(null);
 const load=async()=>{setError('');try{const r=await api<{ideas:Idea[];admin:boolean}>('/api/ideas',undefined,'GET',false);setIdeas(r.ideas);setAdmin(r.admin)}catch(e:any){setError(e.message)}};
 useEffect(()=>{if(open)load();else{setOpenId(null);setAdding(false);setEditing(null)}},[open]);
 const vote=async(idea:Idea)=>{setBusy(true);try{const r=await api<{votes:number;voted:boolean}>('/api/ideas/'+idea.id+'/vote',{vote:!idea.voted},'POST',false);setIdeas(list=>list&&list.map(i=>i.id===idea.id?{...i,...r}:i))}catch(e:any){setError(e.message)}finally{setBusy(false)}};
 const add=async()=>{setBusy(true);setError('');try{await api(editing?'/api/ideas/'+editing.id:'/api/ideas',{text:draft},editing?'PATCH':'POST',false);setDraft('');setAdding(false);setEditing(null);if(!editing)setTab('mine');await load()}catch(e:any){setError(e.message)}finally{setBusy(false)}};
 const edit=(idea:Idea)=>{setError('');setDraft(idea.text);setEditing(idea)};
 const closeEditor=()=>{if(!busy){setAdding(false);setEditing(null);setDraft('');setError('')}};
 const words=query.trim().toLowerCase();
 // Search looks across the public tabs so a duplicate is found wherever it sits.
 const shown=(ideas||[]).filter(i=>words?i.text.toLowerCase().includes(words)&&(i.status!=='declined'||i.mine):tab==='mine'?i.mine:i.status===tab);
 const current=ideas?.find(i=>i.id===openId);
 const ideaTitle=current?.text.trim().split(/\r?\n/,1)[0]||'Идея';
 return <><Modal open={open&&!adding&&!editing} keepMounted onOpenChange={o=>{if(!o)onClose()}} className="ideas-modal" contentClassName="ideas-sheet" aria-labelledby="ideas-title">
  <header className="ideas-header">
   {current?<Button view="flat" size="l" aria-label="Назад в портал идей" onClick={()=>setOpenId(null)}><ArrowLeft size={18}/></Button>:null}
   <h2 id="ideas-title" title={current?ideaTitle:undefined}>{current?ideaTitle:'Портал идей'}</h2>
   {!current?<Button view="outlined" size="l" onClick={()=>{setError('');setAdding(true)}}>Предложить идею</Button>:null}
   <Button view="flat" size="l" aria-label="Закрыть портал идей" onClick={onClose}><X size={18}/></Button>
  </header>
  <div className="ideas-body">
   {error&&!adding&&!editing?<div className="processing-notice" role="alert"><p>{error}</p><Button onClick={load}>Повторить</Button></div>:null}
   {current?<IdeaPage idea={current} admin={admin} busy={busy} onVote={()=>vote(current)} onEdit={()=>edit(current)} onChanged={load}/>:<>
    <TextInput className="ideas-search" view="normal" size="l" value={query} onUpdate={setQuery} placeholder="Поиск по идеям" startContent={<Search size={16} className="ideas-search-icon" aria-hidden="true"/>} hasClear controlProps={{'aria-label':'Поиск по идеям'}}/>
    {!words?<SegmentedRadioGroup className="ideas-tabs" size="l" name="Раздел идей" value={tab} onUpdate={setTab} options={TABS.map(([value,content])=>({value,content}))}/>:null}
    {ideas===null&&!error?<p role="status">Загружаем идеи…</p>:null}
    {ideas?<ul className="ideas-list" aria-label={words?'Результаты поиска':TABS.find(([id])=>id===tab)?.[1]}>
     {!shown.length?<li className="ideas-empty"><span className="feedback-done-icon" aria-hidden="true">{words?<Search size={28}/>:<Lightbulb size={28}/>}</span><h3>{EMPTY[words?'search':tab][0]}</h3><p>{EMPTY[words?'search':tab][1]}</p>{tab==='open'||tab==='mine'||words?<Button view="outlined" size="l" onClick={()=>{setDraft(query.trim());setAdding(true)}}>Предложить идею</Button>:null}</li>:null}
     {shown.map(i=><li key={i.id} className="ideas-row">
      <button type="button" className="ideas-row-main" onClick={()=>setOpenId(i.id)}>
       <span className="ideas-text">{i.text}</span>
       <span className="ideas-meta">{tab==='mine'||words?<Label theme={THEME[i.status]}>{LABEL[i.status]}</Label>:null}<span>{i.author} · {when(i.created)}</span>{i.comments?<span><MessageSquare size={12} aria-hidden="true"/> {i.comments}</span>:null}{i.hidden?<span><EyeOff size={12} aria-hidden="true"/> Скрыта</span>:null}</span>
       {i.status==='declined'&&i.reason?<span className="ideas-reason">Почему отклонили: {i.reason}</span>:null}
      </button>
      <div className="idea-actions"><EditIdeaButton idea={i} busy={busy} onEdit={()=>edit(i)}/><VoteButton idea={i} busy={busy} onVote={()=>vote(i)}/></div>
     </li>)}
    </ul>:null}
   </>}
  </div>
 </Modal>
  <Dialog open={open&&(adding||Boolean(editing))} onClose={closeEditor} size="s" aria-label={editing?'Редактировать идею':'Новая идея'}>
   <Dialog.Header caption={editing?'Редактировать идею':'Новая идея'}/>
   <Dialog.Body>{error?<p className="form-error" role="alert">{error}</p>:null}<TextArea value={draft} onUpdate={setDraft} minRows={4} maxRows={10} placeholder={PLACEHOLDER} controlProps={{'aria-label':'Описание идеи',maxLength:2000}} autoFocus/><p className="feedback-hint">Идею увидят коллеги и смогут её поддержать</p></Dialog.Body>
   <Dialog.Footer onClickButtonCancel={closeEditor} textButtonCancel="Отмена" onClickButtonApply={add} textButtonApply={editing?'Сохранить':'Отправить'} loading={busy} propsButtonApply={{disabled:draft.trim().length<3}}/>
  </Dialog>
 </>;
}

function EditIdeaButton({idea,busy,onEdit}:{idea:Idea;busy:boolean;onEdit:()=>void}){
 const [expired,setExpired]=useState(()=>Date.now()>=idea.created+86400000);
 useEffect(()=>{
  const remaining=idea.created+86400000-Date.now();setExpired(remaining<=0);
  if(remaining>0){const timer=setTimeout(()=>setExpired(true),remaining);return()=>clearTimeout(timer)}
 },[idea.created]);
 if(!idea.mine)return null;
 return <Tooltip content={expired?'Редактировать можно только в течение суток после отправки':'Редактировать идею'}><span className="idea-edit-trigger" tabIndex={expired?0:undefined}><Button view="flat" size="l" disabled={expired||busy} aria-label="Редактировать идею" onClick={onEdit}><Pencil size={18} aria-hidden="true"/></Button></span></Tooltip>;
}

function VoteButton({idea,busy,onVote}:{idea:Idea;busy:boolean;onVote:()=>void}){
 return <Button className="ideas-vote" view={idea.voted?'outlined-action':'outlined'} size="l" disabled={busy} aria-pressed={idea.voted} aria-label={(idea.voted?'Убрать голос':'Поддержать идею')+', голосов: '+idea.votes} onClick={onVote}><ThumbsUp size={16}/>{idea.votes}</Button>;
}

function IdeaPage({idea,admin,busy,onVote,onEdit,onChanged}:{idea:Idea;admin:boolean;busy:boolean;onVote:()=>void;onEdit:()=>void;onChanged:()=>Promise<void>}){
 const [comments,setComments]=useState<Comment[]|null>(null),[text,setText]=useState(''),[sending,setSending]=useState(false),[error,setError]=useState('');
 const [status,setStatus]=useState<Status>(idea.status),[reason,setReason]=useState(idea.reason);
 useEffect(()=>{api<{comments:Comment[]}>('/api/ideas/'+idea.id+'/comments',undefined,'GET',false).then(r=>setComments(r.comments),e=>setError(e.message))},[idea.id]);
 const comment=async(value:string)=>{setSending(true);setError('');try{setComments((await api<{comments:Comment[]}>('/api/ideas/'+idea.id+'/comments',{text:value},'POST',false)).comments);setText('');await onChanged()}catch(e:any){setError(e.message)}finally{setSending(false)}};
 const moderate=async(change:{status?:Status;reason?:string;hidden?:boolean})=>{setSending(true);setError('');try{await api('/api/ideas/'+idea.id+'/status',change,'POST',false);await onChanged()}catch(e:any){setError(e.message)}finally{setSending(false)}};
 return <div className="idea-page">
  <div className="ideas-row"><div className="ideas-row-main"><p className="ideas-text">{idea.text}</p><span className="ideas-meta">{idea.status!=='open'?<Label theme={THEME[idea.status]}>{LABEL[idea.status]}</Label>:null}<span>{idea.author} · {when(idea.created)}</span></span>{idea.status==='declined'&&idea.reason?<span className="ideas-reason">Почему отклонили: {idea.reason}</span>:null}</div><div className="idea-actions"><EditIdeaButton idea={idea} busy={busy} onEdit={onEdit}/><VoteButton idea={idea} busy={busy} onVote={onVote}/></div></div>
  {admin?<section className="idea-admin" aria-label="Управление идеей">
   <p className="idea-admin-title">Видите только вы как администратор</p>
   <Select label="Статус:" width="max" value={[status]} onUpdate={v=>setStatus(v[0] as Status)} options={(Object.keys(LABEL) as Status[]).map(s=>({value:s,content:LABEL[s]}))}/>
   {status==='declined'?<TextArea value={reason} onUpdate={setReason} minRows={2} placeholder="Почему отклоняем. Причину увидят автор и проголосовавшие" controlProps={{'aria-label':'Причина отказа'}}/>:null}
   <div className="idea-admin-actions"><Button view="outlined" loading={sending} disabled={status===idea.status&&reason===idea.reason} onClick={()=>moderate({status,reason})}>Сохранить</Button><Button view="flat" onClick={()=>moderate({hidden:!idea.hidden})}>{idea.hidden?'Показать всем':'Скрыть идею'}</Button></div>
   <p className="feedback-hint">Когда идею сделают или отклонят, автор и проголосовавшие получат письмо</p>
  </section>:null}
  <h3 className="idea-comments-title">Комментарии</h3>
  {comments===null&&!error?<p role="status">Загружаем…</p>:null}
  {comments?<ul className="idea-comments">{comments.map(c=><li key={c.id}><span aria-hidden="true"><Avatar size="s" text={c.author.trim().split(/\s+/).map(word=>word[0]).slice(0,2).join('')}/></span><div className="idea-comment-content"><div className="idea-comment-meta"><span className="idea-comment-author">{c.author}</span><time dateTime={new Date(c.created).toISOString()} title={new Date(c.created).toLocaleString('ru-RU')}>{new Date(c.created).toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</time></div><p>{c.text}</p></div></li>)}{!comments.length?<li className="ideas-meta">Комментариев пока нет</li>:null}</ul>:null}
  {error?<p className="auth-error" role="alert">{error}</p>:null}
  <ChatComposer value={text} onChange={setText} onSubmit={comment} available loading={sending} placeholder="Напишите комментарий" inputLabel="Комментарий" sendLabel="Отправить комментарий"/>
 </div>;
}
