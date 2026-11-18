import {appHref} from './routes.ts';
import React,{useEffect,useState} from 'react';
import {Alert,Button,Checkbox,Dialog,DropdownMenu,TextInput} from '@gravity-ui/uikit';
import {Cable,Check,Copy,Folder,MoreHorizontal,Plus,Search,ShieldCheck} from 'lucide-react';
import {api} from './api.ts';
import {oauthQuery} from './oauth-query.ts';
import BrandMark,{BetaMark} from './BrandMark.tsx';
import EmptyState from './EmptyState.tsx';

type Project={id:string;name:string;role:'view'|'full'};
const when=(value:number)=>new Intl.DateTimeFormat('ru',{day:'numeric',month:'short',year:'numeric'}).format(value).replace(/\s*г\.$/,'');
const call=(path:string,body?:unknown,method?:string)=>api(path,body,method|| (body===undefined?'GET':'POST'),false);
function ProjectChoices({projects,selected,onChange}:{projects:Project[];selected:string[];onChange:(ids:string[])=>void}){
 const all=projects.length>0&&projects.every(p=>selected.includes(p.id)),some=!all&&projects.some(p=>selected.includes(p.id));
 return <div className="mcp-project-choices">{projects.length>1?<Checkbox className="mcp-project-choice" checked={all} indeterminate={some} onUpdate={checked=>onChange(checked?projects.map(p=>p.id):[])} content={<span><strong>Все проекты</strong><small>{projects.length} {projects.length%10===1&&projects.length%100!==11?'проект':[2,3,4].includes(projects.length%10)&&![12,13,14].includes(projects.length%100)?'проекта':'проектов'}, доступных вам сейчас</small></span>}/>:null}{projects.map(p=><Checkbox key={p.id} className="mcp-project-choice" checked={selected.includes(p.id)} onUpdate={checked=>onChange(checked?[...selected,p.id]:selected.filter(id=>id!==p.id))} content={<span><strong>{p.name}</strong><small>{p.role==='view'?'Проверенные выводы и доступные исходники':'Включая видимые вам черновики'}</small></span>} controlProps={{'aria-label':'Проект: '+p.name}}/>)}</div>;
}
async function copy(value:string,notify:(text:string)=>void,what:string){try{await navigator.clipboard.writeText(value);notify(what+' скопирован.')}catch{notify('Не удалось скопировать. Выделите текст и скопируйте вручную.')}}

export default function MCPSettings({ctx}:{ctx:any}){
 const [data,setData]=useState<any>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[dialog,setDialog]=useState(false);
 const [name,setName]=useState(''),[selected,setSelected]=useState<string[]>([]),[secret,setSecret]=useState<any>(null),[busy,setBusy]=useState(false),[formError,setFormError]=useState('');
 const [revoke,setRevoke]=useState<any>(null);
 // Administrators get the whole team's live connections; everyone else sees their own.
 const team=Boolean(data?.team),mine=new Set((data?.grants||[]).map(g=>g.id)),people=data?.team||(data?.grants||[]).filter(g=>!g.expires||g.expires>Date.now()).map(g=>({...g,user_id:ctx.user?.id}));
 const load=async()=>{setLoading(true);setError('');try{setData(ctx.real?await call('/api/mcp/settings'):{endpoint:new URL('/mcp',location.origin).href,grants:[],projects:[{id:'demo',name:'Демо-проект',role:ctx.reader?'view':'full'}]})}catch(e){setError(e.message)}finally{setLoading(false)}};
 useEffect(()=>{load()},[ctx.real]);
 const openToken=()=>{setName('');setFormError('');setSecret(null);setSelected(data.projects.some(p=>p.id===ctx.user?.workspaceId)?[ctx.user.workspaceId]:data.projects.length===1?[data.projects[0].id]:[]);setDialog(true)};
 const closeToken=()=>{if(!busy){setSecret(null);setDialog(false)}};
 const create=async()=>{setFormError('');if(!ctx.real){setFormError('В демо токены не создаются. Откройте рабочий Мнемодак.');return}if(!name.trim()||!selected.length){setFormError('Назовите подключение и выберите проекты.');return}setBusy(true);try{setSecret(await call('/api/mcp/tokens',{name:name.trim(),projects:selected}));await load()}catch(e){setFormError(e.message)}finally{setBusy(false)}};
 return <section className="mcp-settings" aria-label="Подключение по MCP">
  <p className="settings-copy">Подключите исследования к ИИ-ассистенту или боту.</p>
  <aside aria-labelledby="mcp-read-only-title">
   <Alert theme="info" className="mcp-read-only" icon={<ShieldCheck size={18} aria-hidden="true"/>}
    title={<h2 id="mcp-read-only-title">Только чтение</h2>}
    message="Ассистент читает материалы в выбранных проектах с учётом ваших прав. Доступ можно отозвать в любой момент. Проверяйте ответы ассистента по источникам."/>
  </aside>
  {error?<div className="processing-notice" role="alert"><p>{error}</p><Button onClick={load}>Повторить</Button></div>:null}
  {loading&&!data?<p className="settings-copy" role="status">Загружаем настройки MCP…</p>:null}
  {data?<>
   <section aria-labelledby="mcp-connection-title">
    <h2 className="settings-group-label" id="mcp-connection-title">Подключение</h2>
    <div className="settings-list"><div className="setting-row mcp-endpoint-row">
     <div className="setting-icon" aria-hidden="true"><Cable size={16}/></div>
     <div className="setting-main"><h3>Адрес MCP-сервера</h3><p><code className="mcp-endpoint">{data.endpoint}</code></p></div>
     <div className="setting-actions"><Button view="outlined" size="m" onClick={()=>copy(data.endpoint,ctx.notify,'Адрес')}><Copy size={14} aria-hidden="true"/>Скопировать</Button></div>
    </div></div>
    <ol className="mcp-steps">
     <li>Откройте настройки подключений в Claude, ChatGPT или Codex.</li>
     <li>Добавьте MCP-сервер, вставьте адрес и войдите в Мнемодак.</li>
     <li>Выберите проекты и подтвердите доступ.</li>
    </ol>
   </section>
   <section aria-labelledby="mcp-access-title">
    <div className="settings-group-head"><h2 className="settings-group-label" id="mcp-access-title">{team?'Кто подключён':'Ваши подключения'}{people.length?<span className="setting-count">{people.length}</span>:null}</h2><Button view="flat-secondary" size="s" onClick={load} loading={loading}>Обновить</Button></div>
    {!people.length?<EmptyState icon={<Cable size={28}/>} title="Подключений пока нет" description="Подключения появятся после подтверждения доступа ассистенту или создания токена."/>:null}
    <ul className="settings-list" aria-labelledby="mcp-access-title">
     {people.map(g=>{const active=Boolean(g.last_used&&Date.now()-g.last_used<7*864e5);const who=g.user_id===ctx.user?.id?'Вы':g.user_name||g.user_email||'Участник';return <li className="setting-row" key={g.id}>
      <div className="setting-icon setting-initial" data-status={active?'on':'off'} aria-hidden="true">{(g.user_name||ctx.user?.name||who)[0].toUpperCase()}</div>
      <div className="setting-main"><h3>{who}<span className="setting-meta">{g.name}</span></h3><p>{g.projects.map(p=>p.name).join(', ')}</p><p className="setting-sub">{g.last_used?(active?'Активно · ':'')+'Использовался '+when(g.last_used):'Ещё не использовался'} · {g.kind==='token'?'Токен до '+when(g.expires):g.origin||'OAuth'}</p></div>
      {mine.has(g.id)?<div className="setting-actions"><DropdownMenu popupProps={{placement:['bottom-end','top-end']}} renderSwitcher={props=><Button {...props} view="flat" size="m" aria-label={'Действия: '+g.name}><MoreHorizontal size={16} aria-hidden="true"/></Button>} items={[{text:'Отозвать доступ',theme:'danger',action:()=>setRevoke(g)}]}/></div>:null}
     </li>})}
     <li className="setting-row setting-add-row"><button type="button" className="setting-add" onClick={openToken} disabled={!data.projects.length}><span className="setting-icon" aria-hidden="true"><Plus size={16}/></span><span className="setting-main"><strong>Токен для бота</strong><span>Для своего клиента с заголовком Authorization. Действует год.</span></span></button></li>
    </ul>
    <p className="settings-copy mcp-note">Для чата без поддержки MCP, например Mattermost, нужен бот или мост с MCP-клиентом.</p>
   </section>
   <section aria-labelledby="mcp-capabilities-title">
    <h2 className="settings-group-label" id="mcp-capabilities-title">Что получит ассистент</h2>
    <ul className="settings-list">{([[Folder,'Выбранные проекты и их материалы'],[Search,'Поиск и чтение фрагментов'],[Check,'Находки со статусами и ссылками на источники']] as const).map(([Icon,text])=><li className="setting-row" key={text}><div className="setting-icon" aria-hidden="true"><Icon size={16}/></div><div className="setting-main"><h3>{text}</h3></div></li>)}</ul>
   </section>
  </>:null}
  <Dialog open={dialog} onClose={closeToken} size="m" className="mcp-token-dialog" aria-label={secret?'Токен MCP создан':'Токен для бота'}><Dialog.Header caption={secret?'Токен MCP создан':'Токен для бота'}/><Dialog.Body>
   {secret?<div className="mcp-secret"><p>Сохраните токен. Повторно получить его значение нельзя. Он действует до {when(secret.expires)}.</p><TextInput type="password" readOnly value={secret.token} controlProps={{'aria-label':'Созданный токен MCP'}}/><Button view="outlined" onClick={()=>copy(secret.token,ctx.notify,'Токен')}><Copy size={16}/>Скопировать токен</Button></div>:<><TextInput label="Название подключения" value={name} onUpdate={setName} controlProps={{'aria-label':'Название подключения MCP',maxLength:60}} placeholder="Например, бот Mattermost"/><p className="mcp-picker-label">Доступные проекты</p><ProjectChoices projects={data?.projects||[]} selected={selected} onChange={setSelected}/><p className="muted">Разрешается только чтение выбранных проектов. Токен действует год.</p></>}
   {formError?<p className="form-error" role="alert">{formError}</p>:null}
  </Dialog.Body><Dialog.Footer textButtonCancel={secret?'Готово':'Отмена'} onClickButtonCancel={closeToken} {...(!secret?{textButtonApply:'Создать токен',onClickButtonApply:create,propsButtonApply:{loading:busy,disabled:busy||!name.trim()||!selected.length}}:{})}/></Dialog>
  <Dialog open={Boolean(revoke)} onClose={()=>{if(!busy)setRevoke(null)}} size="s" className="mcp-token-dialog" aria-label="Отозвать доступ MCP"><Dialog.Header caption="Отозвать доступ?"/><Dialog.Body><p>«{revoke?.name}» перестанет получать данные через это подключение. Уже полученные внешним сервисом данные останутся у него.</p>{formError?<p role="alert">{formError}</p>:null}</Dialog.Body><Dialog.Footer textButtonCancel="Отмена" onClickButtonCancel={()=>{if(!busy)setRevoke(null)}} textButtonApply="Отозвать доступ" propsButtonApply={{view:'outlined-danger',loading:busy}} onClickButtonApply={async()=>{setBusy(true);setFormError('');try{await call('/api/mcp/grants/'+revoke.id+'/revoke',{});setRevoke(null);ctx.notify('Доступ отозван.');await load()}catch(e){setFormError(e.message)}finally{setBusy(false)}}}/></Dialog>
 </section>;
}

export function MCPConsent({user}:{user:any}){
 const [data,setData]=useState<any>(null),[selected,setSelected]=useState<string[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);const query=oauthQuery();
 useEffect(()=>{let alive=true;call('/api/mcp/consent/context',{query}).then(data=>{if(!alive)return;setData(data);setSelected(data.projects.some(p=>p.id===user.workspaceId)?[user.workspaceId]:data.projects.length===1?[data.projects[0].id]:[])}).catch(e=>{if(alive)setError(e.message)});return()=>{alive=false}},[query,user.id]);
 const decide=async(accept:boolean)=>{setBusy(true);setError('');try{const result=await call('/api/mcp/consent',{accept,projects:selected,query});if(!result.redirect||!result.url)throw new Error('Не удалось продолжить подключение. Начните его заново.');location.assign(result.url)}catch(e){setError(e.message);setBusy(false)}};
 return <main className="mcp-consent" id="main"><a href={appHref('mcp')} className="mcp-consent-brand" aria-label="Мнемодак — настройки MCP"><BrandMark/><strong>Мнемодак</strong><BetaMark/></a><h1>Доступ к исследованиям</h1><p className="muted">Вы вошли как {user.email}</p>
  {data?<><div className="mcp-client"><Cable size={24} aria-hidden="true"/><div><strong>{data.client.name}</strong><p>Адрес возврата: {data.client.origin}</p></div></div><p>Подключение сможет читать выбранные проекты от вашего имени. Изменение и удаление материалов недоступны.</p>{data.scopes.some(s=>['profile','email'].includes(s))?<p className="muted">Также запрошены сведения профиля: имя и рабочая почта.</p>:null}<h2>Разрешённые проекты</h2><ProjectChoices projects={data.projects} selected={selected} onChange={setSelected}/>{!data.projects.length?<p>У вас нет доступных проектов. Попросите владельца проекта добавить вас.</p>:null}<div className="mcp-consent-actions"><Button view="flat" onClick={()=>decide(false)} disabled={busy}>Отказать</Button><Button view="action" onClick={()=>decide(true)} loading={busy} disabled={busy||!selected.length}>Разрешить чтение</Button></div></>:!error?<p role="status">Проверяем запрос подключения…</p>:null}
  {error?<p role="alert" className="form-error">{error}</p>:null}
 </main>;
}
