import React,{useEffect,useState} from 'react';
import {Button,Checkbox,Dialog,TextInput} from '@gravity-ui/uikit';
import {Cable,Check,Copy,Folder,Search,ShieldCheck} from 'lucide-react';
import {api} from './api.ts';
import {oauthQuery} from './oauth-query.ts';
import BrandMark,{BetaMark} from './BrandMark.tsx';

type Project={id:string;name:string;role:'view'|'full'};
const when=(value:number)=>new Intl.DateTimeFormat('ru',{day:'numeric',month:'short',year:'numeric'}).format(value).replace(/\s*г\.$/,'');
const call=(path:string,body?:unknown,method?:string)=>api(path,body,method|| (body===undefined?'GET':'POST'),false);
function ProjectChoices({projects,selected,onChange}:{projects:Project[];selected:string[];onChange:(ids:string[])=>void}){
 return <div className="mcp-project-choices">{projects.map(p=><Checkbox key={p.id} className="mcp-project-choice" checked={selected.includes(p.id)} onUpdate={checked=>onChange(checked?[...selected,p.id]:selected.filter(id=>id!==p.id))} content={<span><strong>{p.name}</strong><small>{p.role==='view'?'Проверенные выводы и доступные исходники':'Включая видимые вам черновики'}</small></span>} controlProps={{'aria-label':'Проект: '+p.name}}/>)}</div>;
}
async function copy(value:string,notify:(text:string)=>void,what:string){try{await navigator.clipboard.writeText(value);notify(what+' скопирован.')}catch{notify('Не удалось скопировать. Выделите текст и скопируйте вручную.')}}

export default function MCPSettings({ctx}:{ctx:any}){
 const [data,setData]=useState<any>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[dialog,setDialog]=useState(false);
 const [name,setName]=useState(''),[selected,setSelected]=useState<string[]>([]),[secret,setSecret]=useState<any>(null),[busy,setBusy]=useState(false),[formError,setFormError]=useState('');
 const [revoke,setRevoke]=useState<any>(null);
 const load=async()=>{setLoading(true);setError('');try{setData(ctx.real?await call('/api/mcp/settings'):{endpoint:new URL('/mcp',location.origin).href,grants:[],projects:[{id:'demo',name:'Демо-проект',role:ctx.reader?'view':'full'}]})}catch(e){setError(e.message)}finally{setLoading(false)}};
 useEffect(()=>{load()},[ctx.real]);
 const openToken=()=>{setName('');setFormError('');setSecret(null);setSelected(data.projects.some(p=>p.id===ctx.user?.workspaceId)?[ctx.user.workspaceId]:data.projects.length===1?[data.projects[0].id]:[]);setDialog(true)};
 const closeToken=()=>{if(!busy){setSecret(null);setDialog(false)}};
 const create=async()=>{setFormError('');if(!ctx.real){setFormError('В демо токены не создаются. Откройте рабочую Мнемонику.');return}if(!name.trim()||!selected.length){setFormError('Назовите подключение и выберите проекты.');return}setBusy(true);try{setSecret(await call('/api/mcp/tokens',{name:name.trim(),projects:selected}));await load()}catch(e){setFormError(e.message)}finally{setBusy(false)}};
 return <section className="mcp-settings" aria-label="Подключение по MCP">
  <div className="page-heading"><div><div className="overline">Настройки</div><h1>MCP</h1><p>Подключите исследования к ИИ-ассистенту или боту.</p></div></div>
  {error?<div className="processing-notice" role="alert"><p>{error}</p><Button onClick={load}>Повторить</Button></div>:null}
  {loading&&!data?<p role="status">Загружаем настройки MCP…</p>:null}
  {data?<>
   <div className="mcp-connect"><h2>Подключить ассистента</h2><ol className="mcp-steps"><li>Добавьте новый MCP-сервер в подключениях вашего ассистента.</li><li>Вставьте адрес ниже и войдите в Мнемонику.</li><li>Выберите проекты и подтвердите доступ к чтению.</li></ol>
    <label className="model-field-label" htmlFor="mcp-endpoint">Адрес MCP-сервера</label><div className="mcp-address"><TextInput id="mcp-endpoint" value={data.endpoint} readOnly controlProps={{'aria-label':'Адрес MCP-сервера'}}/><Button view="action" onClick={()=>copy(data.endpoint,ctx.notify,'Адрес')}><Copy size={16} aria-hidden="true"/>Скопировать адрес</Button></div>
    <p className="muted">Для клиентов с удалённым MCP по HTTP, в том числе Claude, ChatGPT и Codex. Подтверждение доступа проходит на сайте Мнемоники.</p>
   </div>
   <section className="mcp-capabilities" aria-labelledby="mcp-capabilities-title"><h2 id="mcp-capabilities-title">Что получит ассистент</h2><ul><li><Folder size={18} aria-hidden="true"/>Выбранные проекты и их материалы</li><li><Search size={18} aria-hidden="true"/>Поиск и чтение конкретных фрагментов</li><li><Check size={18} aria-hidden="true"/>Находки со статусами и ссылками на источники</li></ul><p><ShieldCheck size={16} aria-hidden="true"/>Только чтение. Права Мнемоники продолжают действовать; доступ можно отозвать в любой момент.</p><p className="muted">Ответ формулирует подключённый ассистент. MCP передаёт ему доступные данные и источники.</p></section>
   <section className="mcp-access" aria-labelledby="mcp-access-title"><div className="section-heading"><h2 id="mcp-access-title">Выданные доступы</h2><Button view="flat" onClick={load} disabled={loading}>Обновить</Button></div>
    {!data.grants.length?<p className="muted">Подключений пока нет. Они появятся после подтверждения доступа ассистенту или создания токена для бота.</p>:<ul className="mcp-grants">{data.grants.map(g=><li key={g.id}><Cable size={20} aria-hidden="true"/><div><strong>{g.name}</strong><p>{g.projects.map(p=>p.name).join(' · ')}</p><small>{g.kind==='token'?'Токен до '+when(g.expires):g.origin||'OAuth'} · {g.last_used?'Использовался '+when(g.last_used):'Ещё не использовался'}</small></div><Button view="flat-danger" size="s" aria-label={'Отозвать доступ: '+g.name} onClick={()=>setRevoke(g)}>Отозвать</Button></li>)}</ul>}
   </section>
   <details className="mcp-bots"><summary>Для ботов и своего MCP-клиента</summary><p>Клиенту с поддержкой заголовка Authorization можно выдать отдельный токен на 30 дней. Вы сами выбираете проекты.</p><pre>{'Authorization: Bearer <ваш токен>'}</pre><Button view="outlined" onClick={openToken} disabled={!data.projects.length}>Создать токен для бота</Button><p className="muted">Чату без поддержки MCP нужен бот или мост с MCP-клиентом. Сам адрес сервера не добавляет бота в Mattermost.</p></details>
   <p className="mcp-example">Первый запрос: «Найди, что участники говорили о связи с хозяином, и покажи источники».</p>
  </>:null}
  <Dialog open={dialog} onClose={closeToken} size="m" className="mcp-token-dialog" aria-label={secret?'Токен MCP создан':'Токен для бота'}><Dialog.Header caption={secret?'Токен MCP создан':'Токен для бота'}/><Dialog.Body>
   {secret?<div className="mcp-secret"><p>Сохраните токен. Повторно получить его значение нельзя. Он действует до {when(secret.expires)}.</p><TextInput type="password" readOnly value={secret.token} controlProps={{'aria-label':'Созданный токен MCP'}}/><Button view="outlined" onClick={()=>copy(secret.token,ctx.notify,'Токен')}><Copy size={16}/>Скопировать токен</Button></div>:<><TextInput label="Название подключения" value={name} onUpdate={setName} controlProps={{'aria-label':'Название подключения MCP',maxLength:60}} placeholder="Например, бот Mattermost"/><p className="mcp-picker-label">Доступные проекты</p><ProjectChoices projects={data?.projects||[]} selected={selected} onChange={setSelected}/><p className="muted">Разрешается только чтение выбранных проектов. Токен действует 30 дней.</p></>}
   {formError?<p className="form-error" role="alert">{formError}</p>:null}
  </Dialog.Body><Dialog.Footer textButtonCancel={secret?'Готово':'Отмена'} onClickButtonCancel={closeToken} {...(!secret?{textButtonApply:'Создать токен',onClickButtonApply:create,propsButtonApply:{loading:busy,disabled:busy||!name.trim()||!selected.length}}:{})}/></Dialog>
  <Dialog open={Boolean(revoke)} onClose={()=>{if(!busy)setRevoke(null)}} size="s" className="mcp-token-dialog" aria-label="Отозвать доступ MCP"><Dialog.Header caption="Отозвать доступ?"/><Dialog.Body><p>«{revoke?.name}» перестанет получать данные через это подключение. Уже полученные внешним сервисом данные останутся у него.</p>{formError?<p role="alert">{formError}</p>:null}</Dialog.Body><Dialog.Footer textButtonCancel="Отмена" onClickButtonCancel={()=>{if(!busy)setRevoke(null)}} textButtonApply="Отозвать доступ" propsButtonApply={{view:'outlined-danger',loading:busy}} onClickButtonApply={async()=>{setBusy(true);setFormError('');try{await call('/api/mcp/grants/'+revoke.id+'/revoke',{});setRevoke(null);ctx.notify('Доступ отозван.');await load()}catch(e){setFormError(e.message)}finally{setBusy(false)}}}/></Dialog>
 </section>;
}

export function MCPConsent({user}:{user:any}){
 const [data,setData]=useState<any>(null),[selected,setSelected]=useState<string[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);const query=oauthQuery();
 useEffect(()=>{let alive=true;call('/api/mcp/consent/context',{query}).then(data=>{if(!alive)return;setData(data);setSelected(data.projects.some(p=>p.id===user.workspaceId)?[user.workspaceId]:data.projects.length===1?[data.projects[0].id]:[])}).catch(e=>{if(alive)setError(e.message)});return()=>{alive=false}},[query,user.id]);
 const decide=async(accept:boolean)=>{setBusy(true);setError('');try{const result=await call('/api/mcp/consent',{accept,projects:selected,query});if(!result.redirect||!result.url)throw new Error('Не удалось продолжить подключение. Начните его заново.');location.assign(result.url)}catch(e){setError(e.message);setBusy(false)}};
 return <main className="mcp-consent" id="main"><a href="/#/mcp" className="mcp-consent-brand" aria-label="Мнемоника — настройки MCP"><BrandMark/><strong>Мнемоника</strong><BetaMark/></a><h1>Доступ к исследованиям</h1><p className="muted">Вы вошли как {user.email}</p>
  {data?<><div className="mcp-client"><Cable size={24} aria-hidden="true"/><div><strong>{data.client.name}</strong><p>Адрес возврата: {data.client.origin}</p></div></div><p>Подключение сможет читать выбранные проекты от вашего имени. Изменение и удаление материалов недоступны.</p>{data.scopes.some(s=>['profile','email'].includes(s))?<p className="muted">Также запрошены сведения профиля: имя и рабочая почта.</p>:null}<h2>Разрешённые проекты</h2><ProjectChoices projects={data.projects} selected={selected} onChange={setSelected}/>{!data.projects.length?<p>У вас нет доступных проектов. Попросите владельца проекта добавить вас.</p>:null}<div className="mcp-consent-actions"><Button view="flat" onClick={()=>decide(false)} disabled={busy}>Отказать</Button><Button view="action" onClick={()=>decide(true)} loading={busy} disabled={busy||!selected.length}>Разрешить чтение</Button></div></>:!error?<p role="status">Проверяем запрос подключения…</p>:null}
  {error?<p role="alert" className="form-error">{error}</p>:null}
 </main>;
}
