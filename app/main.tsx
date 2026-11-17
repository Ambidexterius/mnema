import {useCompactLayout,MOBILE_WEB_QUERY} from './useCompactLayout.ts';
import ChatHistoryScroll from './ChatHistoryScroll.tsx';
import {formatFileSize} from './file-size.ts';
import {findingStatusLabel as statusLabel} from './finding-status.ts';
import {appHref,appRoute,navigate,readRoute,requestedWorkspace,canonicalizeRoute,routeHref,navigateHref,restoreRouteScroll} from './routes.ts';
import {invitationMailNotice} from './invitation-mail-status.ts';
import ThinkingIndicator from './ThinkingIndicator.tsx';
import Mascot,{type MascotMood} from './Mascot.tsx';
// The agent reads the error: an exhausted limit makes it sleepy, a provider refusal angry, a lost connection dizzy.
const errorMood=(text:string):MascotMood=>/лимит/i.test(text)?'sleepy':/отклонил|403/.test(text)?'angry':/недоступ|соединени|сеть|504|тайм/i.test(text)?'dizzy':'sad';
import ResearchCatalog from './ResearchCatalog.tsx';
import {useResearchChats} from './useResearchChats.ts';
import ProjectFolder from './ProjectFolder.tsx';
import {ProjectMenu,ProjectDialog,fileCount} from './ProjectActions.tsx';
import BatchUpload from './BatchUpload.tsx';
import ProjectProfile from './ProjectProfile.tsx';
import AnswerActions from './AnswerActions.tsx';
import {answerBlocks,answerMetric,CARD_SECTIONS,METRICS_SECTION} from './answer-format.ts';
import {useCompletionFavicon} from './completion-favicon.ts';
import {findingRepeats} from './finding-repeats.ts';
import DocumentPreview from './DocumentPreview.tsx';
import StorageStatus from './StorageStatus.tsx';
import ChatComposer from './ChatComposer.tsx';
import ModelConnectionDialog from './ModelConnectionDialog.tsx';
import MCPSettings,{MCPConsent} from './MCPSettings.tsx';
import IntegrationsPage from './IntegrationsPage.tsx';
import AnswerFeedbackPage from './AnswerFeedbackPage.tsx';
import {FeedbackDialog,IdeasPanel} from './Ideas.tsx';
import {materialActivity} from './material-activity.ts';
import {APP_VERSION} from './version.ts';
import {useCompletionSound} from './completion.ts';
import ProjectImporter from './ProjectImporter.tsx';
import BrandMark,{BetaMark} from './BrandMark.tsx';
import StudyExperience from './StudyExperience.tsx';
import AuthPage from './AuthPage.tsx';
import RegistrationPage from './RegistrationPage.tsx';
import {api,setApiWorkspace,projectFile,projectFileDownload,projectArchive} from './api.ts';
import React, {createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {configure, Accordion, Modal, Avatar, Button, Card, Checkbox, Dialog, DropdownMenu, Popup, Label, Hotkey, Loader, Progress, SegmentedRadioGroup, Select, Switch, Table, TextArea, TextInput, ThemeProvider, Tooltip} from '@gravity-ui/uikit';
import {Megaphone, Link as LinkIcon, ArrowLeft, ArrowRight, Minimize2, Download, Bookmark, Box, Check, ChevronRight, Clock, Copy, File, FileAudio, FileDown, FileSpreadsheet, Files, FileText, FileType, FileVideo, Folder, House, Cable, Info, Library, Lightbulb, LoaderCircle, Menu, MessageSquare, Mic, Moon, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Pencil, Play, Plug, Monitor, Settings, Trash2, UserPlus, ChevronsUpDown, Plus, Quote, RefreshCw, RotateCcw, Search, ShieldCheck, Sparkles, Sun, ThumbsUp, Upload, Users, Video, LogOut, X} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';
import type {Finding, Study, Segment, ChatSource, WorkspaceUser} from './types.ts';
import '@gravity-ui/uikit/styles/styles.css';
import './gravity.css';
import {transcript, initialStudies, initialFindings, initialModels, initialProcessors, initialUsers, processingSteps} from './data.ts';

configure({lang:'ru'});
export const Context=createContext<any>(null);
// The app context is wide and evolves quickly; components read it untyped until it is split into smaller stores.
const useApp=():any=>useContext(Context);
const DEMO=import.meta.env.VITE_DEMO==='true';
const qa=DEMO&&new URLSearchParams(location.search).get('qa')==='1';
let reader=qa&&new URLSearchParams(location.search).get('role')==='view';
const storage=qa?'ai-hyposut.qa.v1':'ai-hyposut.demo.v1';
const defaults={studies:initialStudies,findings:initialFindings,models:initialModels,processors:initialProcessors,users:initialUsers,modelId:'deepseek',theme:'dark',sidebarCollapsed:false,soundEnabled:true,messages:[]};
const uid=()=>crypto.randomUUID();
const time=s=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
const materialDate=new Intl.DateTimeFormat('ru',{day:'numeric',month:'long',year:'numeric'});
const plural=(n,one,few,many)=>`${n} ${{one,few,many,other:many}[new Intl.PluralRules('ru').select(n)]}`;
// Stage 1 of the UX brief: review statuses, one importance scale, source basis.
const KINDS=['Проблема','Инсайт','Рекомендация','Цифра'];
const IMPORTANCE=['Критично','Высокая','Средняя','Низкая'];
const importanceOrder=Object.fromEntries(IMPORTANCE.map((x,i)=>[x,i]));
const legacyKinds={'Наблюдение':'Инсайт','Гипотеза':'Инсайт','Открытый вопрос':'Инсайт','Решение':'Рекомендация'};
const normalize=f=>f.status?f:{...f,status:f.verified?'verified':'draft',importance:f.importance||f.priority||'Средняя',kind:legacyKinds[f.kind]||f.kind||'Инсайт',origin:f.origin||'human',history:f.history||[]};
const reportOf=s=>s?.report==='ready'||s?.report==='none'?s.report:s?.type==='Отчёт'?'ready':'none';

const statusTheme=f=>f.status==='verified'?'success':f.status==='rejected'?'normal':'info';
const importanceTheme=i=>i==='Критично'?'danger':i==='Высокая'?'warning':'normal';
const actionLabel={created:'создал(а)',suggested:'предложил(а)',accepted:'принял(а)',rejected:'отклонил(а)',restored:'вернул(а) в проверенные',reopened:'вернул(а) на проверку',edited:'изменил(а)'};
const stamp=ms=>new Intl.DateTimeFormat('ru',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(ms));
const fullDate=s=>new Intl.DateTimeFormat('ru',{day:'numeric',month:'long'}).format(new Date(s+'T12:00:00'))+' '+s.slice(0,4);
// Documents without pages (TXT) have no timecode: show «Текст», not a misleading 0:00.
const where=seg=>seg?.page?'Стр. '+seg.page:seg?.speaker==='Документ'&&!seg?.time?'Текст':time(seg?.time||0);
const WHATS_NEW='ui-0.9.16-findings-2026-11-13';
const escapeHTML=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);

const management:[string,string,LucideIcon][]=[['models','Модели',Box],['integrations','Интеграции',Plug],['mcp','MCP',Cable],['users','Пользователи',Users],['feedback','Оценки ответов',ThumbsUp]];
function load(){try{const v=JSON.parse(localStorage.getItem(storage));const local=v?.version===1?v.data:{};return DEMO?{...structuredClone(defaults),...local}:{...structuredClone(defaults),studies:[],findings:[],users:[],models:[],processors:[],messages:[],theme:local.theme||'light',sidebarCollapsed:!!local.sidebarCollapsed,soundEnabled:local.soundEnabled!==false}}catch{return DEMO?structuredClone(defaults):{...structuredClone(defaults),studies:[],findings:[],users:[],models:[],processors:[],messages:[],theme:'light'}}}
function IconButton({icon:Icon,label,size="l",...props}:{icon:LucideIcon;label:string;[prop:string]:any}){return <Tooltip content={label}><Button view="flat" size={size} aria-label={label} {...props}><Icon size={size==="s"?14:18} aria-hidden="true"/></Button></Tooltip>}
export function NavigationHint({label,enabled,shortcut,children}:{label:string;enabled:boolean;shortcut?:string;children:React.ReactElement}){const mobileWeb=useCompactLayout(MOBILE_WEB_QUERY);return <Tooltip content={shortcut?<span className="creation-shortcut-tooltip"><span>{label}</span><Hotkey value={shortcut}/></span>:label} disabled={!enabled||mobileWeb} placement="right" openDelay={200} closeDelay={80}>{children}</Tooltip>}
function Notice({children}:{children:React.ReactNode}){return <div className="notice"><Info size={16}/><div>{children}</div></div>}
function Empty({title,children,action,icon:Icon=Library}:{title:string;children?:React.ReactNode;action?:React.ReactNode;icon?:LucideIcon}){return <div className="empty"><Icon size={28}/><h2>{title}</h2><p>{children}</p>{action}</div>}
function Status({study}:{study:Study}){const activity=study.activity||materialActivity(study);const active=['queued','running'].includes(activity.state);return <div className="material-status"><Label theme={active?'info':activity.state==='ready'?'success':activity.state==='error'?'danger':'normal'} size="s">{active?<LoaderCircle size={12} className="activity-spinner" aria-hidden="true"/>:null}{activity.label}</Label>{active&&activity.detail?<small>{activity.detail}</small>:null}</div>}
function PageHeading({overline,title,children,action,back,tabs}:{overline?:string;title:string;children?:React.ReactNode;action?:React.ReactNode;back?:{href:string;label:string;history?:boolean};tabs?:boolean}){
 const navigation=back||(tabs?{href:history.state?.previous||'/projects',label:'Назад',history:true}:undefined);
 return <div className="page-heading"><div>{overline?<div className="overline">{overline}</div>:null}<div className="page-title-row">{navigation?<Tooltip content={navigation.label}><a className="page-back" href={navigation.href} aria-label={navigation.label} onClick={e=>{if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;if(navigation.history&&history.state?.app&&history.state?.previous){e.preventDefault();history.back()}}}><ArrowLeft size={20} aria-hidden="true"/></a></Tooltip>:null}<h1>{title}</h1></div>{tabs?<ProjectTabs/>:null}{children?<p>{children}</p>:null}</div>{action}</div>;
}
/** Sections of a project, under the page title: overview, findings, materials with counts. */
function ProjectTabs(){const {state,route}=useApp();const mobile=useCompactLayout();const path=route.split('?')[0],current=path.startsWith('study/')?'library':path.startsWith('finding/')?'findings':path;const findings=state.findings.filter(f=>f.status!=='rejected').length;
 return <nav className="project-tabs" aria-label="Разделы проекта">{([['home','Обзор',null],['findings','Находки',findings],['library',mobile?'Документы':'Материалы',state.studies.length]] as [string,string,number|null][]).map(([id,label,n])=><a key={id} href={appHref(id)} aria-current={current===id?'page':undefined}>{label}{n?<span className="tab-count">{n}</span>:null}</a>)}</nav>}
function ProjectBreadcrumbs({project,studyTitle}:{project?:string;studyTitle?:string}) {
 const compact=useCompactLayout();if(compact){if(!studyTitle)return <nav className="mobile-path" aria-label="Путь"><span>Проекты</span></nav>;const back=history.state?.returnTo||appHref('library'),label=readRoute(new URL(back,location.href)).route.startsWith('finding/')?'Находка':'Документы';return <nav className="mobile-path" aria-label="Путь"><a href={back} aria-label={label==='Находка'?'Назад к находке':'Назад к документам'}><ArrowLeft size={24} aria-hidden="true"/><span>{label}</span></a></nav>;}
 return <nav className="breadcrumbs" aria-label="Путь">
  <Folder size={16} aria-hidden="true"/>
  {project?<a className="breadcrumb-root" href={appHref('research')}>Проекты</a>:<span className="breadcrumb-root" aria-current="page">Проекты</span>}
  {project?<>
   <span className={'breadcrumb-separator'+(studyTitle?' breadcrumb-project-separator':'')} aria-hidden="true">/</span>
   {studyTitle?<a className="breadcrumb-project" href={appHref('home')} title={project}>{project}</a>:<span aria-current="page" title={project}>{project}</span>}
  </>:null}
  {studyTitle?<><span className="breadcrumb-separator" aria-hidden="true">/</span><span aria-current="page" title={studyTitle}>{studyTitle}</span></>:null}
 </nav>;
}
function FindingsBreadcrumbs({project,finding,studyTitle}:{project?:string;finding?:Finding;studyTitle?:string}){
 const root=history.state?.findingsRoot||(project?appHref('findings'):'/all-findings');const compact=useCompactLayout();if(compact){if(!studyTitle)return <nav className="mobile-path" aria-label="Путь"><span>{project?'Проекты':'Находки'}</span></nav>;const back=finding?appHref('finding/'+finding.id):root,label=finding?'Находка':'Находки';return <nav className="mobile-path" aria-label="Путь"><a href={back} aria-label={finding?'Назад к находке':'Назад к находкам'}><ArrowLeft size={24} aria-hidden="true"/><span>{label}</span></a></nav>;}
 return <nav className="breadcrumbs" aria-label="Путь">
  {project?<><Folder size={16} aria-hidden="true"/><a className="breadcrumb-root" href={appHref('research')}>Проекты</a><span className="breadcrumb-separator" aria-hidden="true">/</span><a className="breadcrumb-project" href={appHref('home')}>{project}</a><span className="breadcrumb-separator" aria-hidden="true">/</span></>:null}
  {finding||studyTitle?<a href={root}>Находки</a>:<span aria-current="page">Находки</span>}
  {finding?<><span className="breadcrumb-separator" aria-hidden="true">/</span>{studyTitle?<a href={appHref('finding/'+finding.id)}>{finding.title}</a>:<span aria-current="page">{finding.title}</span>}</>:null}
  {studyTitle?<><span className="breadcrumb-separator" aria-hidden="true">/</span><span aria-current="page">{studyTitle}</span></>:null}
 </nav>;
}
function AddMaterial(){const compact=useCompactLayout();const {open}=useApp();return reader?null:<Button view="action" size="l" onClick={()=>open({type:'upload'})}><Plus size={16}/>Добавить</Button>}
export function App(){
 const [authInfo,setAuthInfo]=useState<{loading:boolean;user:any;setupRequired?:boolean;setupEnabled?:boolean;registrationEnabled?:boolean;error?:string}>({loading:!DEMO,user:null,setupRequired:false,setupEnabled:false});
 const authInfoRef=useRef(authInfo.user);authInfoRef.current=authInfo.user;
 const switchWorkspaceRef=useRef<((id:string,navigate?:boolean)=>Promise<void>)|null>(null);
 const serverVersion=useRef(0),stateRef=useRef(null),pending=useRef(Promise.resolve());
 const [state,setState]=useState(load);
 const [route,setRoute]=useState(appRoute);const routeRef=useRef(route);

 const [dialog,open]=useState<any>(null);
 const [projectAction,setProjectAction]=useState<any>(null);
 const [toast,setToast]=useState('');
 const [mobile,setMobile]=useState(()=>innerWidth<960);const mobileWeb=useCompactLayout(MOBILE_WEB_QUERY);
 const navs:[string,string,LucideIcon][]=[['home','Обзор проекта',House],['library',mobile?'Документы':'Материалы',mobile?Files:Library]];
 const [menuOpen,setMenuOpen]=useState(false);
 const menuTrigger=useRef<HTMLButtonElement>(null);
 const sidebarShift=useRef<{left:number;animation?:Animation}|null>(null);
 const [selected,setSelected]=useState<string|null>(()=>new URLSearchParams(location.search).get('segment'));
 const importOpen=useRef(false);importOpen.current=dialog?.type==='import';const switching=useRef(false);const [switchingProject,setSwitchingProject]=useState(false);
 const uploadingBatch=useRef(false);
 const [panel,setPanel]=useState<{studyId?:string;segmentId?:string;findingId?:string;number?:number;sources?:ChatSource[];heading?:string;key?:string}|null>(null);
 // The panel stays mounted briefly after closing so it can slide out while the content slides back.
 const [shownPanel,setShownPanel]=useState<typeof panel>(null),[panelClosing,setPanelClosing]=useState(false);
 useEffect(()=>{if(panel){setShownPanel(panel);setPanelClosing(false);return}if(matchMedia('(prefers-reduced-motion: reduce)').matches){setShownPanel(null);return}setPanelClosing(true);const t=setTimeout(()=>{setShownPanel(null);setPanelClosing(false)},160);return()=>clearTimeout(t)},[panel]);
 // Gleap-style navigation: a narrow rail that opens over the content on hover; the pin keeps it open.
 const [accountOpen,setAccountOpen]=useState(false),[accountEl,setAccountEl]=useState<HTMLElement|null>(null);
 const [feedbackOpen,setFeedbackOpen]=useState(false),[ideasOpen,setIdeasOpen]=useState(()=>location.hash==='#ideas');
 const [systemDark,setSystemDark]=useState(()=>matchMedia('(prefers-color-scheme: dark)').matches);
 useEffect(()=>{const m=matchMedia('(prefers-color-scheme: dark)');const h=()=>setSystemDark(m.matches);m.addEventListener('change',h);return()=>m.removeEventListener('change',h)},[]);
 const effectiveTheme=state.theme==='system'?(systemDark?'dark':'light'):state.theme;
 const [seen,setSeen]=useState(()=>{try{return localStorage.getItem('mnema.whatsnew')}catch{return null}});
 const markSeen=()=>{setSeen(WHATS_NEW);try{localStorage.setItem('mnema.whatsnew',WHATS_NEW)}catch{}};
 const main=useRef(null),timer=useRef(null),files=useRef(new Map());
 stateRef.current=state;
 reader=DEMO?(qa&&new URLSearchParams(location.search).get('role')==='view'):authInfo.user?.role!=='full';

 const receive=data=>{authInfoRef.current=data.user;setApiWorkspace(data.user?.workspaceId||null);serverVersion.current=data.version;setAuthInfo(a=>({...a,user:data.user}));setState(s=>({...s,...data.state,...(!data.user?.workspaceId?{workspace:undefined}:{})}));};
 const linkWorkspaceApplied=useRef(false);
 const refresh=async()=>{const info=await api('/api/session');if(info.user){if(!linkWorkspaceApplied.current){linkWorkspaceApplied.current=true;const requested=requestedWorkspace();if(requested&&!info.user.workspaces?.some(w=>w.id===requested))throw new Error('Доступ к проекту закрыт. Попросите владельца добавить вас в проект.');if(requested){setApiWorkspace(requested);document.cookie='mnema_ws='+encodeURIComponent(requested)+'; path=/; SameSite=Lax'}}receive(await api('/api/state'));setAuthInfo(a=>({...a,registrationEnabled:info.registrationEnabled,loading:false,error:undefined}))}else setAuthInfo({...info,loading:false});};
 useEffect(()=>{const screen=route.split('?')[0];if(authInfo.user&&(screen==='reset'||screen==='signup'&&authInfo.registrationEnabled))navigate('research')},[route,authInfo.user?.id,authInfo.registrationEnabled]);
 useEffect(()=>{if(DEMO)return;refresh().catch(e=>setAuthInfo({loading:false,user:null,error:e.message}));},[]);
 useEffect(()=>{if(DEMO||!authInfo.user)return;const t=setInterval(()=>{if((!document.hidden||stateRef.current.studies.some(s=>s.status==='processing'))&&!switching.current&&!importOpen.current)pending.current=pending.current.then(async()=>{try{receive(await api('/api/state'))}catch(e){if(e.status===401)setAuthInfo(info=>({...info,user:null,loading:false,setupRequired:false,error:undefined}));else setToast(e.message)}})},5000);return()=>clearInterval(t)},[authInfo.user?.id]);
 const update=patch=>{const changes=typeof patch==='function'?patch(stateRef.current):patch;const before=stateRef.current;const next={...before,...changes};stateRef.current=next;setState(next);if(DEMO)return Promise.resolve(true);
  const remote=Object.fromEntries(Object.entries(changes).filter(([k])=>['findings','models','processors','modelId'].includes(k)));
  const changedUser=changes.users?.find(u=>{const old=before.users.find(x=>x.id===u.id);return old&&(u.role!==old.role||u.status!==old.status||Boolean(u.admin)!==Boolean(old.admin))});
  if(!Object.keys(remote).length&&!changedUser)return Promise.resolve(true);
  const saved=pending.current.then(async()=>{try{const data=changedUser?await api('/api/users/'+changedUser.id,{...Object.fromEntries(['role','status','admin'].filter(key=>changedUser[key]!==before.users.find(u=>u.id===changedUser.id)?.[key]).map(key=>[key,changedUser[key]])),workspaceId:changedUser.projectIds?.length===1?changedUser.projectIds[0]:undefined},'PATCH'):await api('/api/state',{version:serverVersion.current,changes:remote},'PATCH');receive(data);return true}catch(e){setToast(e.message);try{receive(await api('/api/state'))}catch{}return false }});
  pending.current=saved.then(()=>{});return saved;
 };
 const go=(path,segment=null)=>{setSelected(segment);navigate(path+(segment?(path.includes('?')?'&':'?')+'segment='+encodeURIComponent(segment):''));if(appRoute()===path&&segment)requestAnimationFrame(()=>document.getElementById('segment-'+segment)?.scrollIntoView({block:'center'}))};
 const notify=text=>setToast(text);
 const chatHistory=useResearchChats({demo:DEMO,userId:authInfo.user?.id,route,go,notify,state,accessKey:(authInfo.user?.workspaces||[]).map(w=>w.id+':'+w.role).sort().join('|')});
 const {messages:globalMessages,setMessages:setGlobalMessages,typing:globalTyping,error:globalError,ask:askGlobal}=chatHistory;

 useCompletionFavicon(state.studies,authInfo.user?.workspaceId,authInfo.user?.id,route,(authInfo.user?.workspaces||[]).map(w=>w.id));
 useCompletionSound(state.studies,authInfo.user?.workspaceId,state.soundEnabled!==false,finished=>notify(finished.length===1?'Расшифровка готова: '+finished[0].title:'Расшифровки готовы: '+finished.length));
 useEffect(()=>{try{localStorage.setItem(storage,JSON.stringify({version:1,data:DEMO?state:{theme:state.theme,sidebarCollapsed:state.sidebarCollapsed,soundEnabled:state.soundEnabled!==false}}))}catch{setToast('Изменения не сохранились. Освободите место в хранилище браузера.')}},[state]);
 useEffect(()=>{
  const h=async()=>{
   if(location.hash==='#main'&&appRoute()===routeRef.current){main.current?.focus();return}
   const next=appRoute(),requested=requestedWorkspace();
   if(requested&&authInfoRef.current?.workspaceId!==requested&&authInfoRef.current){
    try{await switchWorkspaceRef.current?.(requested,false);if(authInfoRef.current?.workspaceId!==requested){history.replaceState(null,'',appHref(routeRef.current));return}}catch{history.replaceState(null,'',appHref(routeRef.current));return}
   }
   const overlayRoute=(r:string)=>r.startsWith('study/')||management.some(([id])=>id===r.split('?')[0]);const overlay=overlayRoute(next)||overlayRoute(routeRef.current);
   routeRef.current=next;setRoute(next);canonicalizeRoute();setSelected(new URLSearchParams(location.search).get('segment'));setMenuOpen(false);setPanel(null);
   if(!overlay){window.scrollTo(0,0);main.current?.parentElement?.scrollTo({top:0});requestAnimationFrame(()=>{main.current?.focus({preventScroll:true});if(next==='chat')main.current?.querySelector('.shared-composer textarea')?.focus()})}
  };
  const click=(e:MouseEvent)=>{const a=(e.target as Element).closest?.('a[href]');if(!a||e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||a.hasAttribute('download')||a.getAttribute('target'))return;
   const url=new URL(a.getAttribute('href'),location.href);if(url.origin!==location.origin||/^\/(api|mcp)(?:\/|$)/.test(url.pathname)||url.hash&&!url.hash.startsWith('#/'))return;
   e.preventDefault();if(url.hash.startsWith('#/'))navigate(readRoute(url).route);else navigateHref(url.pathname+url.search+url.hash)
  };
  window.addEventListener('hashchange',h);window.addEventListener('popstate',h);document.addEventListener('click',click);
  return()=>{window.removeEventListener('hashchange',h);window.removeEventListener('popstate',h);document.removeEventListener('click',click)};
 },[]);
 useEffect(()=>{if(authInfo.user)canonicalizeRoute()},[authInfo.user?.workspaceId,route]);
 useEffect(()=>{const m=matchMedia('(min-width:960px)');const resize=()=>{setMobile(!m.matches);setMenuOpen(false)};m.addEventListener('change',resize);resize();return()=>m.removeEventListener('change',resize)},[]);
 useEffect(()=>{const onKey=e=>{if(e.key!=='Escape'||e.defaultPrevented)return;if(menuOpen){setMenuOpen(false);return}if(document.querySelector('.g-modal_open,.g-popup_open'))return;setPanel(null)};document.addEventListener('keydown',onKey);return()=>document.removeEventListener('keydown',onKey)},[menuOpen]);
 useEffect(()=>{if(document.documentElement.dataset.theme===effectiveTheme)return;const freeze=document.createElement('style');freeze.textContent='*,*::before,*::after{transition:none!important}';document.head.appendChild(freeze);document.documentElement.dataset.theme=effectiveTheme;getComputedStyle(document.documentElement).colorScheme;requestAnimationFrame(()=>requestAnimationFrame(()=>freeze.remove()))},[effectiveTheme]);
 useEffect(()=>{document.documentElement.dataset.theme=effectiveTheme;document.documentElement.style.colorScheme=effectiveTheme;const label=route==='chat'?'Новый чат':route.startsWith('conversation/')?'Чат':route==='research'||route==='projects'?'Проекты':route.split('?')[0]==='all-findings'?'Находки':route.split('?')[0]==='findings'?'Находки':[...navs,...management].find(x=>x[0]===route.split('?')[0])?.[1]||state.studies.find(s=>route==='study/'+s.id)?.title||(route.startsWith('finding/')?state.findings.find(f=>route==='finding/'+f.id)?.title||'Находка':null)||(route.startsWith('file/')?state.studies.find(s=>route==='file/'+s.id)?.fileName||'Исходный файл':route==='signup'?'Регистрация':route==='login'?'Вход':route==='reset'?'Восстановление пароля':'Материал');document.title=label+(['home','library','findings','users','models','integrations','mcp'].includes(route.split('?')[0])&&state.workspace?.name?' · '+state.workspace.name:'')+' — Мнемодак'},[effectiveTheme,route,state.studies,state.workspace?.name]);
 useEffect(()=>()=>{clearTimeout(timer.current);for(const f of files.current.values())URL.revokeObjectURL(f.url)},[]);
 useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(''),6000);return()=>clearTimeout(t)},[toast]);
 // Only a local processing simulation. This interval never contacts an ASR service.
 useEffect(()=>{if(!DEMO)return;const t=setInterval(()=>setState(s=>{if(!s.studies.some(x=>x.status==='processing'))return s;return {...s,studies:s.studies.map(x=>x.status==='processing'?{...x,step:Math.min((x.step||0)+1,4),status:(x.step||0)>=3?'ready':'processing',summary:(x.step||0)>=3?structuredClone(initialStudies[0].summary):x.summary}:x)}}),2200);return()=>clearInterval(t)},[]);
 const theme=()=>{document.documentElement.classList.add('theme-changing');update({theme:effectiveTheme==='dark'?'light':'dark'});requestAnimationFrame(()=>requestAnimationFrame(()=>document.documentElement.classList.remove('theme-changing')))};
 const openPanel=p=>setPanel(p);
const setAnswerRating=(id:string,rating:'up'|'down'|null)=>{
  const apply=(messages:any[])=>messages.map(message=>message.id===id?{...message,rating}:message);
  setGlobalMessages(apply);
 };
 // Settings open as a modal over the last page; that page keeps its own route.
 const settingsTab=management.some(([id])=>id===route.split('?')[0])?route.split('?')[0]:null;if(!settingsTab)settingsBackdrop.current=route;const pageRoute=settingsTab?settingsBackdrop.current:route;
 const context={chatHistory,projectAction:(action,project)=>{setMenuOpen(false);if(action==='invite'&&authInfo.user?.manageUsers){open({type:'invite'});return}if(action==='files'){if(uploadingBatch.current){notify('Дождитесь завершения загрузки перед сменой проекта.');return}switchWorkspaceRef.current?.(project.id).then(()=>go('library')).catch(()=>{});return}setProjectAction({action,project})},setAnswerRating,globalMessages,globalTyping,globalError,askGlobal,clearGlobalChat:chatHistory.newChat,openGlobalSource:async(source)=>{try{if(!DEMO){if(source.workspaceId!==authInfo.user?.workspaceId)await switchWorkspaceRef.current?.(source.workspaceId,false);else await refresh()}setPanel({studyId:source.studyId,segmentId:source.segmentId,number:source.number})}catch{notify('Не удалось открыть источник. Проверьте доступ к проекту.')}},projectName:state.workspace?.name||'Проект',workspaces:(authInfo.user?.workspaces||[]).filter(w=>!w.emptyDefault),switchingProject,switchWorkspace:(id:string,navigate=true)=>switchWorkspaceRef.current?.(id,navigate),markSeen,state,update,receive,user:authInfo.user,real:!DEMO,reader,route:pageRoute,go,dialog,open,notify,selected,setSelected,files,panel:shownPanel,panelClosing,setPanel,openPanel};
 const studyOpen=pageRoute.startsWith('study/');
 const returnRoute=history.state?.returnTo?readRoute(new URL(history.state.returnTo,location.origin)).route:backdropRoute.current;
 const contentRoute=studyOpen?returnRoute:pageRoute;if(!studyOpen)backdropRoute.current=pageRoute;
 const base=contentRoute.split('?')[0],view=base;
 const globalFindingFlow=history.state?.findingsRoot?.startsWith('/all-findings');
 const findingsView=globalFindingFlow||base==='all-findings'||base==='findings'||contentRoute.startsWith('finding/');
 const breadcrumbFinding=state.findings.find(f=>contentRoute==='finding/'+f.id);
 const globalView=globalFindingFlow||['chat','research','projects','all-findings'].includes(base)||contentRoute.startsWith('conversation/');
 const findingCounts=state.findings.map(normalize).reduce((c,f)=>({...c,[f.status]:(c[f.status]||0)+1}),{});
 const canManage=!reader&&(DEMO||authInfo.user?.admin);const canUseSettings=DEMO||Boolean(authInfo.user);const visibleManagement=management.filter(([id])=>['feedback','users'].includes(id)?DEMO||Boolean(authInfo.user?.manageUsers):canManage||id==='mcp');const userName=authInfo.user?.name||'Глеб';
 const signOut=async()=>{setAccountOpen(false);setGlobalMessages([]);await api('/api/auth/sign-out',{});setApiWorkspace(null);setState(s=>({...s,messages:[]}));setAuthInfo(info=>({...info,user:null,loading:false,setupRequired:false,error:undefined}));navigate('login')};
 const workspaces=(authInfo.user?.workspaces||[]).filter(w=>!w.emptyDefault);const workspaceName=state.workspace?.name||workspaces.find(w=>w.id===authInfo.user?.workspaceId)?.name||'Команда';
 const switchWorkspace=async(id:string,navigate=true)=>{if(switching.current)return;if(uploadingBatch.current){notify('Дождитесь завершения загрузки перед сменой проекта.');return}const previous=authInfo.user?.workspaceId;switching.current=true;setSwitchingProject(true);try{await pending.current;setApiWorkspace(id);document.cookie='mnema_ws='+encodeURIComponent(id)+'; path=/; SameSite=Lax';setPanel(null);receive(await api('/api/state'));if(navigate)go('home')}catch(e){setApiWorkspace(previous||null);document.cookie='mnema_ws='+encodeURIComponent(previous||'')+'; path=/; SameSite=Lax';notify('Не удалось открыть проект. Попробуйте ещё раз.');throw e}finally{switching.current=false;setSwitchingProject(false)}};

 const collapsed=state.sidebarCollapsed&&!mobile;const unseen=seen!==WHATS_NEW;
 const toggleSidebar=(event:React.MouseEvent)=>{const el=main.current?.parentElement;const left=el?.getBoundingClientRect().left;sidebarShift.current?.animation?.cancel();sidebarShift.current=event.detail&&left!==undefined&&!matchMedia('(prefers-reduced-motion: reduce)').matches?{left}:null;update({sidebarCollapsed:!state.sidebarCollapsed})};
 useLayoutEffect(()=>{const el=main.current?.parentElement,previous=sidebarShift.current;if(!el||!previous||mobile)return;const delta=previous.left-el.getBoundingClientRect().left;const css=getComputedStyle(el),timing=css.getPropertyValue('--mn-motion-fast').trim();previous.animation=el.animate([{transform:'translateX('+delta+'px)'},{transform:'translateX(0)'}],{duration:parseFloat(timing)*(timing.endsWith('ms')?1:1000)||160,easing:css.getPropertyValue('--mn-ease-out').trim()||'cubic-bezier(0.23,1,0.32,1)'});return()=>previous.animation?.cancel()},[collapsed,mobile]);



 useEffect(()=>{
  if(mobileWeb||(!DEMO&&(!authInfo.user||authInfo.loading))||authInfo.error)return;
  const onKey=(event:KeyboardEvent)=>{
   if(event.defaultPrevented||event.repeat||event.isComposing||event.keyCode===229||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey)return;
   if(event.code!=='KeyC'&&event.code!=='KeyT')return;
   if(!document.querySelector('.app-shell'))return;
   const target=event.target instanceof Element?event.target:null;
   if(target?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"]')||document.querySelector('.g-modal_open,.g-popup_open')||dialog||projectAction||settingsTab||studyOpen||menuOpen||accountOpen||feedbackOpen||ideasOpen)return;
   event.preventDefault();
   if(event.code==='KeyC')open({type:'workspace'});else chatHistory.newChat();
  };
  document.addEventListener('keydown',onKey);
  return()=>document.removeEventListener('keydown',onKey);
 },[mobileWeb,authInfo.user?.id,authInfo.loading,authInfo.error,dialog,projectAction,settingsTab,studyOpen,menuOpen,accountOpen,feedbackOpen,ideasOpen,route]);

 const brand=<a className="brand" href={appHref('chat')} aria-label="Мнемодак, бета-версия — новый чат"><BrandMark/><span className="brand-text"><strong>Мнемодак</strong><span className="brand-beta" title="Бета-версия"><BetaMark/><span className="sr-only">бета-версия</span></span></span><span className="app-version">{APP_VERSION}</span></a>;
 switchWorkspaceRef.current=switchWorkspace;
 const navContent=<><div className="sidebar-head"><div className="brand-lockup"><NavigationHint label="Мнемодак" enabled={collapsed}>{brand}</NavigationHint></div>{mobile?<IconButton icon={X} label="Закрыть меню" className="mobile-close" onClick={()=>setMenuOpen(false)}/>:<IconButton icon={collapsed?PanelLeftOpen:PanelLeftClose} label={collapsed?'Развернуть меню':'Свернуть меню'} aria-expanded={!collapsed} className="collapse-button" onClick={toggleSidebar}/>}</div><nav className="project-navigation" aria-label="Основная навигация">
 {([['chat','Новый чат',Plus,'T'],['research','Проекты',Folder,'C'],['all-findings','Находки',Lightbulb]] as [string,string,LucideIcon,string?][]).map(([id,label,Icon,shortcut])=><NavigationHint key={id} label={id==='research'?'Создать новый проект':label} shortcut={shortcut} enabled={Boolean(shortcut)||collapsed}><a className="nav-item" href={appHref(''+id)} aria-label={label} aria-description={!mobileWeb&&id==='research'?'C — создать новый проект':undefined} aria-keyshortcuts={!mobileWeb&&id==='chat'?'T':undefined} aria-current={id!=='chat'&&(base===id||(id==='research'&&(base==='projects'||!globalView))||(id==='all-findings'&&globalFindingFlow))?'page':undefined}><Icon size={18}/><span>{label}</span>{shortcut&&!mobileWeb?<Hotkey className="shortcut-hint" value={shortcut} aria-hidden="true"/>:null}</a></NavigationHint>)}
 <div className="project-list-label">Чаты</div><ChatHistoryScroll>{chatHistory.chats.map(chat=><div className={'recent-chat-row'+(chatHistory.activeId===chat.id?' is-selected':'')} key={chat.id}><NavigationHint label={chat.title} enabled={collapsed}><a className="nav-item" href={appHref('conversation/'+chat.id)} aria-label={chat.title} aria-current={chatHistory.activeId===chat.id?'page':undefined}><MessageSquare size={18}/><span>{chat.title}</span></a></NavigationHint><IconButton icon={Trash2} label={'Удалить чат: '+chat.title} size="m" className="recent-chat-delete" disabled={globalTyping} onClick={()=>open({type:'delete-chat',chat})}/></div>)}{!chatHistory.chats.length&&!collapsed?<p className="recent-chats-empty">Здесь появятся ваши беседы</p>:null}</ChatHistoryScroll></nav>

 <div className="sidebar-bottom">{DEMO?null:<NavigationHint label="Обратная связь" enabled={collapsed}><button type="button" className="nav-item" aria-label="Обратная связь" aria-haspopup="dialog" onClick={()=>{setMenuOpen(false);setFeedbackOpen(true)}}><Megaphone size={20}/><span>Обратная связь</span></button></NavigationHint>}{canUseSettings?<NavigationHint label="Настройки" enabled={collapsed}><a className="nav-item" href={appHref(canManage?'models':'mcp')} aria-label="Настройки" aria-haspopup="dialog" aria-current={settingsTab?'page':undefined}><Settings size={20}/><span>Настройки</span></a></NavigationHint>:null}
 <div className="account-wrap"><NavigationHint label={'Профиль: '+userName} enabled={collapsed&&!accountOpen}><button type="button" ref={setAccountEl} className="account" aria-label={'Профиль: '+userName} aria-haspopup="menu" aria-expanded={accountOpen} onClick={()=>setAccountOpen(o=>!o)}><Avatar imgUrl={authInfo.user?.image||undefined} text={userName[0]} size="m"/><div><strong>{userName}</strong></div>{unseen?<span className="account-dot" aria-label="Есть новое в интерфейсе"/>:null}</button></NavigationHint></div></div>
 <Popup open={accountOpen} onOpenChange={setAccountOpen} anchorElement={accountEl} placement={mobile?['top-start','top']:['right-end','top-start']} className="account-popup"><div className="account-menu" role="menu" aria-label="Профиль">
  <div className="account-menu-row"><span>Тема</span><SegmentedRadioGroup size="m" value={state.theme==='system'||state.theme==='light'||state.theme==='dark'?state.theme:'light'} onUpdate={v=>update({theme:v})} name="Тема интерфейса" options={[{value:'system',content:<><Monitor size={14}/><span className="sr-only">Как в системе</span></>,title:'Как в системе'},{value:'light',content:<><Sun size={14}/><span className="sr-only">Светлая</span></>,title:'Светлая'},{value:'dark',content:<><Moon size={14}/><span className="sr-only">Тёмная</span></>,title:'Тёмная'}]}/></div>
  <div className="account-menu-row"><span>Звук уведомлений</span><Switch checked={state.soundEnabled!==false} controlProps={{'aria-label':'Звук уведомлений'}} onUpdate={v=>update({soundEnabled:v})}/></div>
  <div className="account-menu-sep" role="separator"/>
  {authInfo.user?.manageUsers&&!DEMO?<button type="button" role="menuitem" className="account-menu-item" onClick={()=>{setAccountOpen(false);setTimeout(()=>open({type:'invite'}),0)}}><UserPlus size={16}/>Пригласить людей</button>:null}
  <button type="button" role="menuitem" className="account-menu-item" onClick={()=>{setAccountOpen(false);markSeen();setTimeout(()=>open({type:'whatsnew'}),0)}}><Sparkles size={16}/>Что нового в интерфейсе{unseen?<span className="account-dot inline" aria-hidden="true"/>:null}</button>
  {DEMO?null:<button type="button" role="menuitem" className="account-menu-item" onClick={()=>{setAccountOpen(false);setMenuOpen(false);setIdeasOpen(true)}}><Lightbulb size={16}/>Портал идей</button>}
  {DEMO?null:<><div className="account-menu-sep" role="separator"/><button type="button" role="menuitem" className="account-menu-item danger" onClick={signOut}><LogOut size={16}/>Выйти</button></>}
 </div></Popup></>;
 if(authInfo.error)return <ThemeProvider theme={effectiveTheme}><main className="page"><Empty title="Не удалось открыть страницу" action={<Button view="action" href="/projects">К проектам</Button>}>{authInfo.error}</Empty></main></ThemeProvider>;
 if(route==='mcp-consent'&&authInfo.user)return <ThemeProvider theme={effectiveTheme}><MCPConsent user={authInfo.user}/></ThemeProvider>;
 if(route.startsWith('file/')&&authInfo.user)return <ThemeProvider theme={effectiveTheme}><Context.Provider value={context}><FileWindow/></Context.Provider></ThemeProvider>;
 return <ThemeProvider theme={effectiveTheme}><Context.Provider value={context}>{(!DEMO&&!authInfo.user)||['signup','login','reset'].includes(route.split('?')[0])?authInfo.loading?<div className="auth-loading" role="status"><Loader size="m"/><span>Открываем Мнемодак…</span></div>:route==='reset'?<RegistrationPage key="reset" reset theme={effectiveTheme} onTheme={theme} onComplete={async()=>{await refresh();go('research')}}/>:route.split('?')[0]==='signup'&&authInfo.registrationEnabled&&!new URLSearchParams(location.search).has('invite')?<RegistrationPage theme={effectiveTheme} onTheme={theme} onComplete={async()=>{await refresh();go('research')}}/>:<AuthPage key={route} registrationEnabled={authInfo.registrationEnabled} theme={effectiveTheme} login={route.split('?')[0]!=='signup'} onTheme={theme} setupRequired={authInfo.setupRequired} setupEnabled={authInfo.setupEnabled} onComplete={async()=>{await refresh();if(['login','signup'].includes(route.split('?')[0]))go('research')}}/>:<><a className="skip-link" href="#main">К содержимому</a><div className={'app-shell'+(collapsed?' rail-collapsed':'')+(shownPanel&&!panelClosing?' has-source-panel':'')}>
 {!mobile?<aside className="sidebar">{navContent}</aside>:null}
 <div className="content-shell"><header className="topbar">{mobile?<IconButton ref={menuTrigger} icon={Menu} label="Открыть меню" aria-expanded={menuOpen} onClick={()=>setMenuOpen(true)}/>:null}{findingsView?<FindingsBreadcrumbs project={globalFindingFlow||base==='all-findings'?undefined:workspaceName} finding={breadcrumbFinding}/>:globalView?base==='research'||base==='projects'?<ProjectBreadcrumbs/>:<div className="hub-topbar-title">{base==='chat'?'Новый чат':chatHistory.chats.find(c=>c.id===chatHistory.activeId)?.title||'Чат'}</div>:<ProjectBreadcrumbs project={workspaceName}/>}{!globalView&&state.workspace?<div className="topbar-actions"><IconButton icon={LinkIcon} label="Скопировать ссылку на проект" onClick={()=>navigator.clipboard.writeText(location.origin+routeHref('home',state.workspace.id)).then(()=>notify('Ссылка скопирована'),()=>notify('Не удалось скопировать ссылку'))}/>{workspaces.find(w=>w.id===state.workspace.id)?<ProjectMenu project={workspaces.find(w=>w.id===state.workspace.id)} onAction={context.projectAction}/>:null}</div>:null}</header>
 <Context.Provider value={studyOpen?{...context,route:contentRoute}:context}><main id="main" ref={main} tabIndex={-1} className={'page '+(base==='chat'||contentRoute.startsWith('conversation/')?'research-chat-page':'')}>{switchingProject&&!globalView?<div className="project-loading" role="status">Открываем проект…</div>:base==='chat'||contentRoute.startsWith('conversation/')?<GlobalChat key={chatHistory.activeId||'new'}/>:base==='research'||base==='projects'?<ResearchCatalog key="materials"/>:base==='all-findings'?<ResearchCatalog key="findings" findings/>:!DEMO&&authInfo.user&&!authInfo.user.workspaceId?null:view==='home'?<Home/>:view==='library'?<LibraryPage/>:view==='findings'?<Findings key={(state.workspace?.id||'')+':'+contentRoute}/>:contentRoute.startsWith('finding/')?<FindingPage key={contentRoute}/>:base==='chat'?<Home/>:!DEMO&&authInfo.user&&!authInfo.user.workspaceId?<Empty title="Создайте первый проект" action={<Button view="action" size="l" onClick={()=>open({type:'workspace'})}><Plus size={16}/>Создать проект</Button>}>Создайте папку для материалов по одной теме, затем добавьте файлы.</Empty>:<Study key={pageRoute}/>}{!globalView&&!DEMO&&authInfo.user&&!authInfo.user.workspaceId?<Empty title="Создайте первый проект" action={<Button view="action" size="l" onClick={()=>open({type:'workspace'})}><Plus size={16}/>Создать проект</Button>}>Создайте папку для материалов по одной теме, затем добавьте файлы.</Empty>:null}</main></Context.Provider></div>{studyOpen?<StudyModal back={returnRoute}/>:null}{settingsTab?<SettingsModal tab={settingsTab} tabs={visibleManagement} ctx={context}/>:null}<SourcePanel key={shownPanel?shownPanel.studyId+':'+shownPanel.segmentId:'none'}/>{DEMO?null:<><FeedbackDialog open={feedbackOpen} onClose={()=>setFeedbackOpen(false)} onIdeas={()=>{setFeedbackOpen(false);setIdeasOpen(true)}}/><IdeasPanel open={ideasOpen} onClose={()=>{setIdeasOpen(false);if(location.hash==='#ideas')history.replaceState(history.state,'',location.pathname+location.search)}}/></>}</div>
 <Modal open={mobile&&menuOpen} onOpenChange={setMenuOpen} returnFocus={menuTrigger} onTransitionOutComplete={()=>{if(!document.querySelector('.g-modal_open'))menuTrigger.current?.focus()}} aria-label="Основная навигация" className="mobile-nav-modal" contentClassName="mobile-nav-sheet"><div className="mobile-nav">{navContent}</div></Modal>
 </>}{!DEMO&&authInfo.user?.workspaceId&&authInfo.user.role==='full'&&<BatchUpload key={authInfo.user.id+':'+authInfo.user.workspaceId} studies={state.studies} workspace={authInfo.user.workspaceId} open={dialog?.type==='upload'} close={()=>open(null)} model={state.models.find(m=>m.id===state.modelId)?.name||'проекта'} receive={receive} openStudy={id=>go('study/'+id)} busy={uploadingBatch}/>}<ProjectImporter open={dialog?.type==='import'} onClose={()=>{setApiWorkspace(authInfo.user?.workspaceId||null);open(null)}} onComplete={async id=>{await switchWorkspace(id)}}/>{projectAction&&<ProjectDialog returnFocus={mobile?main:undefined} key={projectAction.project.id+projectAction.action} {...projectAction} notify={notify} onClose={()=>setProjectAction(null)} onChanged={async(id,deleted)=>{await pending.current;if(deleted){setGlobalMessages([]);chatHistory.refresh().catch(()=>{});if(authInfo.user?.workspaceId===id){setApiWorkspace(null);document.cookie='mnema_ws=; path=/; SameSite=Lax';setState(s=>({...s,messages:[]}));go('projects')}}await refresh()}}/>}{dialog?.type==='delete-chat'?<Dialog open onClose={()=>open(null)} aria-label="Удалить чат" hasCloseButton><Dialog.Header caption="Удалить чат?"/><Dialog.Body><p>Переписка «{dialog.chat.title}» будет удалена. Исследования и находки сохранятся.</p></Dialog.Body><Dialog.Footer onClickButtonCancel={()=>open(null)} textButtonCancel="Отмена" textButtonApply="Удалить чат" propsButtonApply={{view:'outlined-danger'}} onClickButtonApply={async()=>{await chatHistory.remove(dialog.chat.id);open(null)}}/></Dialog>:<AppDialog key={dialog?.key||dialog?.type||'closed'}/>}<div className={'toast '+(toast?'shown':'')} role="status">{toast}</div></Context.Provider></ThemeProvider>
}
function FileWindow(){const {state,route}=useApp();const study=state.studies.find(s=>s.id===route.slice(5));return <main className="file-window" id="main"><header className="file-window-header"><FileText size={20} aria-hidden="true"/><div><span className="muted">Исходный файл</span><h1>{study?.fileName||study?.title||'Открываем файл…'}</h1></div><Button view="flat" aria-label="Закрыть окно файла" onClick={()=>window.close()}><X size={20}/></Button></header>{study?.fileId?<DocumentPreview fileId={study.fileId} file={projectFile(study.fileId)} name={study.fileName||study.title} standalone/>:state.workspace?<Empty title="Файл недоступен">Проверьте доступ к проекту и откройте материал ещё раз.</Empty>:<p role="status">Открываем исходный файл…</p>}</main>}

const projectQuestions=['Какие основные идеи есть в этом проекте?','Какие проблемы повторяются?','Что осталось невыясненным?'];
/** Project overview chat: a real saved conversation, pinned to the project and listed in recent chats. */
function ProjectChatDock(){
 const {state,chatHistory,globalMessages:messages,globalTyping:typing,globalError,askGlobal,go}=useApp();
 const [draft,setDraft]=useState(''),[example,setExample]=useState(0),[hovered,setHovered]=useState(false),[focused,setFocused]=useState(false),[open,setOpen]=useState(false);
 const dock=useRef<HTMLElement>(null),enabled=state.models.some(x=>x.enabled),ready=state.studies.some(s=>s.status==='ready'),available=enabled&&ready;
 const projectId=state.workspace?.id,chatId=chatHistory.chats.find(c=>c.projectId===projectId)?.id||null,{pin}=chatHistory;
 useEffect(()=>{pin(chatId);return()=>pin(null)},[chatId,pin]);
 useLayoutEffect(()=>{
  if(!dock.current)return;
  const element=dock.current,content=element.closest<HTMLElement>('.content-shell')!,overview=element.closest<HTMLElement>('.project-overview')!,column=overview.querySelector<HTMLElement>('.overview-main');
  // Wide screens: under the left column, so the materials column stays clear.
  const align=()=>{const wide=column&&column.getBoundingClientRect().width<overview.getBoundingClientRect().width-100,box=(wide?column:content).getBoundingClientRect();element.style.left=box.left+'px';element.style.width=box.width+'px';overview.style.paddingBottom=element.querySelector('.composer')!.getBoundingClientRect().height+72+'px'};
  const observer=new ResizeObserver(align);observer.observe(content);observer.observe(element);window.addEventListener('resize',align);align();
  return()=>{observer.disconnect();window.removeEventListener('resize',align);overview.style.paddingBottom=''};
 },[]);
 useEffect(()=>{
  const motion=matchMedia('(prefers-reduced-motion: reduce)');let timer:ReturnType<typeof setInterval>|undefined;
  const refresh=()=>{clearInterval(timer);if(!motion.matches&&!document.hidden&&!hovered&&!focused&&!draft&&!typing&&available)timer=setInterval(()=>setExample(i=>(i+1)%projectQuestions.length),6000)};
  refresh();motion.addEventListener('change',refresh);document.addEventListener('visibilitychange',refresh);
  return()=>{clearInterval(timer);motion.removeEventListener('change',refresh);document.removeEventListener('visibilitychange',refresh)};
 },[hovered,focused,draft,typing,available]);
 useEffect(()=>{
  if(!open)return;
  // Source panel and Gravity popups live outside the dock; clicks there keep the answer open.
  const outside=(e:PointerEvent)=>{const t=e.target as Element;if(!dock.current?.contains(t)&&!t.closest?.('.source-panel,.g-popup,.g-dialog'))setOpen(false)};
  const esc=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!document.activeElement?.closest('.source-panel'))setOpen(false)};
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',esc);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',esc)};
 },[open]);
 useEffect(()=>{const ask=(e:Event)=>{if(available)void submit((e as CustomEvent<string>).detail)};window.addEventListener('mnema:project-ask',ask);return()=>window.removeEventListener('mnema:project-ask',ask)});
 const question=projectQuestions[example],shown=open&&(messages.length>0||typing);
 const reopen=(target:EventTarget)=>{if((target as Element).tagName==='TEXTAREA'&&messages.length)setOpen(true)};
 const submit=async(text:string)=>{setDraft('');setOpen(true);if(!await askGlobal(text,projectId))setDraft(text)};
 return <section ref={dock} className="project-question" data-open={shown?'':undefined} aria-label="Вопрос по материалам проекта" onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)} onFocusCapture={e=>{setFocused(true);reopen(e.target)}} onClick={e=>reopen(e.target)} onBlurCapture={e=>{if(!e.currentTarget.contains(e.relatedTarget))setFocused(false)}}>
  <div className="project-question-body">
   <div className="project-answer" role="region" aria-label="Ответ по проекту" inert={!shown}><div className="project-answer-inner">
    <div className="project-answer-head"><span>Мнемодак · про этот проект</span><IconButton icon={MessageSquare} label="Открыть в чате" size="m" disabled={!chatHistory.activeId&&!chatId} onClick={()=>chatId&&go('conversation/'+chatId)}/><IconButton icon={Minimize2} label="Свернуть" size="m" onClick={()=>setOpen(false)}/></div>
    <div className="project-answer-body"><ConversationLog label="Чат проекта"/></div>
   </div></div>
   {globalError?<p className="form-error composer-help chat-error" role="alert"><Mascot mood={errorMood(globalError)} size={20}/>{globalError}</p>:null}
   <ChatComposer value={draft} onChange={setDraft} loading={typing} available={available} inputLabel="Вопрос по исследованиям" sendLabel="Отправить вопрос" placeholder={question} suggestion={question} onSubmit={submit}/>
   {!available?<p className="composer-help">Подключите модель в настройках проекта, чтобы задать вопрос.</p>:null}
  </div>
 </section>;
}

function ConversationLog({label}:{label:string}){
 const {chatHistory,globalMessages,globalTyping,notify,setAnswerRating,panel,setPanel}=useApp();const showSources=(list:ChatSource[],key:string)=>setPanel({sources:list,heading:sourcesHeading(list),key});const bottom=useRef<HTMLDivElement>(null);
 useEffect(()=>{bottom.current?.scrollIntoView({block:'end',behavior:'instant'})},[globalMessages.length,globalTyping]);
 return <>{globalMessages.length?<div className="messages" role="log" aria-live="polite" aria-relevant="additions" aria-label={label}>{globalMessages.map((m,mi)=><article ref={m.id===chatHistory.latestReplyId?revealMessage:undefined} className={'message '+m.role+(m.id===chatHistory.latestReplyId||m.role==='user'&&globalTyping&&mi===globalMessages.length-1?' message-arrive':'')} key={m.id}>{m.role==='user'?m.text:<><AnswerText id={m.id} text={m.answer} sources={m.sources} onCite={showSources} active={panel?.key}/>{m.sources?.length?<button type="button" className="answer-sources" aria-expanded={panel?.key===m.id+'-all'} onClick={()=>setPanel({sources:m.sources,heading:'Источники ответа',key:m.id+'-all'})}><Quote size={14} aria-hidden="true"/>{'Опирается на '+plural(materialCount(m.sources),'материал','материала','материалов')+(new Set(m.sources.map(x=>x.workspaceId)).size>1?' из '+plural(new Set(m.sources.map(x=>x.workspaceId)).size,'проекта','проектов','проектов'):'')}</button>:null}<div className="answer-sign"><Mascot mood={m.rating==='up'?'love':m.rating==='down'?'shy':!m.sources?.length?'puzzled':m.id===chatHistory.latestReplyId?'happy':'idle'} live={mi===globalMessages.length-1&&!globalTyping}/>Мнемодак</div><AnswerActions message={m} notify={notify} onRated={rating=>setAnswerRating(m.id,rating)}/></>}</article>)}</div>:null}
 {globalTyping?<ThinkingIndicator/>:null}<div ref={bottom}/></>;
}

export function GlobalChat(){const {real,state,user,workspaces,chatHistory,globalMessages,globalTyping,globalError,askGlobal,openGlobalSource,notify,setAnswerRating,go}=useApp();const [draft,setDraft]=useState(''),[context,setContext]=useState<any>({loading:true}),[contextRetry,setContextRetry]=useState(0);const bottom=useRef<HTMLDivElement>(null);const ready=state.studies.filter(s=>s.status==='ready').length;
 useEffect(()=>{let active=true;if(!real){setContext({loading:false,materials:ready,model:'Локальный пример'});return}setContext(c=>({...c,loading:true,error:''}));api('/api/research-context',undefined,'GET',false).then(data=>{if(active)setContext({...data,loading:false})}).catch(e=>{if(active)setContext({loading:false,error:e.message})});return()=>{active=false}},[real,user?.id,workspaces.length,state.workspace?.id,ready,contextRetry]);
 const available=Boolean(context.model)&&context.materials>0&&!context.loading&&!chatHistory.loading;
 const submit=async(question:string)=>{setDraft('');if(!await askGlobal(question))setDraft(question)};
 const hasMessages=globalMessages.length>0,project=workspaces.find(w=>w.id===chatHistory.chats.find(c=>c.id===chatHistory.activeId)?.projectId);
 return <section className={'global-chat research-chat'+(hasMessages?' has-messages':' is-new')} aria-labelledby="global-chat-title">
 <div className="chat-welcome"><Mascot mood={globalTyping?'thinking':draft.trim()?'listening':'idle'} size={56} live/><h1 id="global-chat-title">Чем вам помочь?</h1></div>
 {chatHistory.loading?<p role="status">Открываем переписку…</p>:null}
 {project?<a className="chat-project-link" href={routeHref('home',project.id)}><ArrowLeft size={16} aria-hidden="true"/>Проект «{project.name}»</a>:null}
 <ConversationLog label="Общий чат"/>
 <div className="research-chat-compose">{context.error?<div className="global-context-error"><p className="form-error" role="alert">{context.error}</p><Button view="outlined" onClick={()=>setContextRetry(n=>n+1)}>Повторить проверку</Button></div>:null}{globalError?<p className="form-error" role="alert">{globalError}</p>:null}
 <ChatComposer value={draft} onChange={setDraft} loading={globalTyping} available={available} inputLabel="Вопрос по всем исследованиям" sendLabel="Отправить вопрос по всем исследованиям" placeholder="Например, топ-5 проблем в чате Суточно.ру" suggestion="Топ-5 проблем в чате Суточно.ру" onSubmit={submit}/>
 {!hasMessages&&available?<div className="research-chat-suggestions">{['Какие проблемы повторяются?','Что мешает завершить бронирование?','Что мы знаем о чате с хозяином?'].map(question=><button key={question} type="button" disabled={globalTyping||!available} onClick={()=>void submit(question)}>{question}<ArrowRight size={14}/></button>)}</div>:null}
 {!available&&!context.error?<p className="composer-help" role="status">{context.loading?'Проверяем доступные исследования…':!context.materials?<><a href={appHref('research')}>Добавьте материалы</a> в проект и дождитесь расшифровки.</>:workspaces.some(w=>w.admin)?<><a href={appHref('models')}>Подключите модель</a>, чтобы задать вопрос.</>:'Попросите владельца проекта подключить модель.'}</p>:null}
 </div></section>
}

function Home(){const {state,projectName,reader,real,receive}=useApp();const ready=state.studies.some(s=>s.status==='ready'&&s.segments?.length);return <div className="project-overview"><PageHeading title={projectName} tabs/>{state.workspace&&<ProjectProfile key={state.workspace.id} project={state.workspace} editable={real&&!reader} onSave={receive}/>}<div className="overview-grid"><div className="overview-main"><ProjectSummary/><FindingsDigest/></div><ProjectMaterials/></div>{ready?<ProjectChatDock key={state.workspace?.id||'project'}/>:null}</div>}
const summaryQuestions=['Что исправить в первую очередь?','Какие проблемы повторяются?','Подготовь текст для презентации'];
const summaryDate=new Intl.DateTimeFormat('ru',{day:'numeric',month:'short'});
const isActive=(s:Study)=>['queued','running'].includes((s.activity||materialActivity(s)).state);
/** «Кратко»: the saved project summary from the model, with citations; questions under it go to the project chat. */
function ProjectSummary(){
 const {state,real,receive,notify,panel,setPanel}=useApp();const [busy,setBusy]=useState(false);
 const summary=state.projectSummary,ready=state.studies.filter(s=>s.status==='ready').length,pending=state.studies.filter(isActive);
 const canBuild=real&&!reader&&ready>0&&state.models.some(m=>m.enabled);
 if(!state.studies.length||!summary&&reader)return null;
 const build=async()=>{setBusy(true);try{receive(await api('/api/project-summary',{}))}catch(e){notify(e.message)}finally{setBusy(false)}};
 const ask=(question:string)=>window.dispatchEvent(new CustomEvent('mnema:project-ask',{detail:question}));
 return <section className="overview-summary" aria-labelledby="project-summary-title" aria-busy={busy}>
  <div className="section-heading"><h2 id="project-summary-title"><Sparkles size={20} aria-hidden="true"/>Кратко</h2>{summary?<span className="section-note">{'Сформировано '+summaryDate.format(summary.at).replace('.','')+' · по '+plural(summary.materials,'материалу','материалам','материалам')}</span>:null}</div>
  <div className="summary-card">
   {pending.length?<p className="summary-pending" role="status"><LoaderCircle size={16} className="activity-spinner" aria-hidden="true"/>{pending.length===1?'«'+pending[0].title+'» обрабатывается.':plural(pending.length,'материал обрабатывается','материала обрабатываются','материалов обрабатывается')+'.'} Обновите кратко, когда обработка закончится.</p>:null}
   {summary?<div className="summary-text"><AnswerText id="project-summary" text={summary.answer} sources={summary.sources} onCite={(list,key)=>setPanel({sources:list,heading:sourcesHeading(list),key})} active={panel?.key}/></div>:<p className="summary-empty">{canBuild?'Модель соберёт главные выводы по материалам проекта со ссылками на источники.':ready?'Подключите модель в настройках проекта, чтобы собрать главные выводы.':'Главные выводы появятся, когда материалы будут обработаны.'}</p>}
   {summary||canBuild?<div className="summary-actions">{summary?<div className="summary-questions">{summaryQuestions.map(q=><Button key={q} view="outlined" size="m" pin="circle-circle" disabled={!state.models.some(m=>m.enabled)} onClick={()=>ask(q)}>{q}</Button>)}</div>:<Button view="outlined" size="m" loading={busy} onClick={build}><Sparkles size={16}/>Собрать кратко</Button>}{summary&&canBuild?<IconButton icon={RefreshCw} label="Обновить кратко" size="m" disabled={busy} onClick={build}/>:null}</div>:null}
  </div>
 </section>;
}
/** The same file-type icons as the materials table. */
function MaterialIcon({study}:{study:Study}){const ext=study.fileName?.trim().match(/^.+\.([a-z0-9]{1,12})$/i)?.[1]?.toLowerCase();const Icon=ext&&Object.hasOwn(sourceIcons,ext)?sourceIcons[ext]:study.format==='Видео'?FileVideo:File;return <Icon className="material-rail-icon" size={20} aria-hidden="true"/>}
const materialMeta=(s:Study)=>[s.type,s.duration>=60?Math.round(s.duration/60)+' мин':s.processing?.pages?s.processing.pages+' стр.':'',formatFileSize(s.fileSize)].filter(x=>x&&x!=='—').join(' · ');
/** Second line of a material in the overview column: its facts, or what is happening to it, as plain text. */
function MaterialProgress({study:s}:{study:Study}){
 const activity=s.activity||materialActivity(s);
 if(s.status==='ready'&&!isActive(s))return <span className="material-rail-meta">{materialMeta(s)}</span>;
 if(activity.state==='error')return <span className="material-rail-meta material-rail-error">{activity.label}</span>;
 if(!isActive(s))return <span className="material-rail-meta">{activity.label}</span>;
 // The text says what is going on; the dots only show it is still moving.
 return <span className="material-rail-meta" role="status">{(activity.detail||activity.label).replace(/[.…]+$/u,'')}<span className="progress-dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span></span>;
}
// The overview column stays short: the full list lives on the materials tab.
const RAIL_LIMIT=8;
/** Right column of the overview: report, work in progress and freshest materials with download; one ZIP for all files. */
function ProjectMaterials(){
 const {state,open}=useApp(),compact=useCompactLayout(),mobileWeb=useCompactLayout(MOBILE_WEB_QUERY);const busy=(s:Study)=>isActive(s)||s.status==='error';
 const list=state.studies.toReversed().sort((a,b)=>Number(b.type==='Отчёт')-Number(a.type==='Отчёт')||Number(busy(b))-Number(busy(a))||b.date.localeCompare(a.date));
 const files=list.filter(s=>s.fileId&&s.status==='ready'),total=files.reduce((sum,s)=>sum+(s.fileSize||0),0);
 return <section className="overview-materials" aria-labelledby="project-materials-title">
  <div className="section-heading"><h2 id="project-materials-title">Материалы{list.length?<span className="section-count">{list.length}</span>:null}</h2>{list.length>RAIL_LIMIT?<a className="section-all" href={appHref('library')}>Все материалы</a>:null}</div>
  {reader?null:<Button className="material-rail-add" view="outlined" size={compact?'l':'m'} width="max" onClick={()=>open({type:'upload'})}><Plus size={16}/>Добавить файл</Button>}
  {list.length?<ul className="material-rail" aria-label="Материалы проекта">{list.slice(0,RAIL_LIMIT).map(s=><li key={s.id}>
   <MaterialIcon study={s}/>
   <div className="material-rail-text"><a href={appHref('study/'+s.id)} title={mobileWeb?undefined:s.title} onMouseEnter={e=>{if(!mobileWeb&&!matchMedia('(prefers-reduced-motion:reduce)').matches)e.currentTarget.scrollTo({left:e.currentTarget.scrollWidth,behavior:'smooth'})}} onMouseLeave={e=>e.currentTarget.scrollTo({left:0,behavior:'smooth'})}>{s.title}</a><MaterialProgress study={s}/></div>
   {s.fileId&&s.status==='ready'?<a className="table-download" href={projectFileDownload(s.fileId)} download={s.fileName||s.title} aria-label={'Скачать «'+(s.fileName||s.title)+'»'} title="Скачать файл"><Download size={16} aria-hidden="true"/></a>:null}
  </li>)}</ul>:(reader?<div className="project-empty material-rail-empty"><span className="project-folder"><Folder size={24} strokeWidth={1.5} aria-hidden="true"/></span><h3>Материалов пока нет</h3><p>Здесь появятся записи интервью, расшифровки и отчёт исследования.</p></div>:<button type="button" className="project-empty material-rail-empty" onClick={()=>open({type:'upload'})}><span className="project-folder"><Upload size={24} strokeWidth={1.5} aria-hidden="true"/></span><h3>Материалов пока нет</h3><p>Загрузите записи интервью, расшифровки или отчёт. Мнемодак расшифрует записи и предложит находки.</p><span className="material-rail-empty-action">Выбрать файлы</span></button>)}
  {files.length>1?<Button view="outlined" size="l" width="max" href={projectArchive()} download><Download size={16}/>{'Скачать всё'+(total?' · '+formatFileSize(total):'')}</Button>:null}
 </section>;
}
const sourceIcons:Record<string,LucideIcon>={mp4:FileVideo,mov:FileVideo,webm:FileVideo,mp3:FileAudio,wav:FileAudio,m4a:FileAudio,pdf:FileType,doc:FileText,docx:FileText,txt:FileText,xls:FileSpreadsheet,xlsx:FileSpreadsheet};
function MaterialLink({study}:{study:Study}){
 const ext=study.fileName?.trim().match(/^.+\.([a-z0-9]{1,12})$/i)?.[1]?.toLowerCase();
 const Icon=ext&&Object.hasOwn(sourceIcons,ext)?sourceIcons[ext]:File;
 const topic = study.project?.trim();
 const title=ext&&!study.title.trimEnd().toLowerCase().endsWith('.'+ext)?study.title+'.'+ext:study.title;
 return <a className="table-study" href={appHref('study/'+study.id)} title={title}><Icon size={20} aria-hidden="true" style={{flexShrink:0}}/><span><strong>{title}</strong>{topic && topic !== 'Без темы' && <small>{topic}</small>}</span></a>;
}
function StudyTable({studies}:{studies:Study[]}){const compact=useCompactLayout();if(compact)return <ul className="mobile-material-list" aria-label="Материалы проекта">{studies.toSorted((a,b)=>Number(b.type==='Отчёт')-Number(a.type==='Отчёт')).map(study=><li key={study.id}><div className="mobile-material-heading"><MaterialLink study={study}/>{study.fileId?<a className="mobile-download" href={projectFileDownload(study.fileId)} download={study.fileName||study.title} aria-label={'Скачать «'+(study.fileName||study.title)+'»'}><Download size={20} aria-hidden="true"/></a>:null}</div><div className="mobile-material-meta"><span>{study.type}</span><span>{formatFileSize(study.fileSize)}</span><time dateTime={study.date}>{materialDate.format(new Date(study.date+'T12:00:00')).replace(/\s*г\.$/u,'')}</time></div><Status study={study}/></li>)}</ul>;return <div className="table-scroll study-table" tabIndex={0} aria-label="Материалы. Таблицу можно прокрутить"><Table data={studies.toSorted((a,b)=>Number(b.type==='Отчёт')-Number(a.type==='Отчёт'))} columns={[
 {id:'title',name:'Материал',template:s=><MaterialLink study={s}/>},
 {id:'type',name:'Тип',width:112},
 {id:'date',name:'Добавлено',width:136,template:s=><time dateTime={s.date} style={{whiteSpace:'nowrap'}}>{materialDate.format(new Date(s.date+'T12:00:00')).replace(/\s*г\.$/u,'')}</time>},
 {id:'size',name:'Размер',width:104,align:'end',template:s=><span className="file-size" title={Number.isSafeInteger(s.fileSize)?s.fileSize.toLocaleString('ru-RU')+' байт':'Размер файла неизвестен'}>{formatFileSize(s.fileSize)}</span>},
 {id:'status',name:'Статус',width:160,className:'status-column',template:s=><Status study={s}/>},
 {id:'download',name:()=><span className="sr-only">Скачать</span>,width:56,align:'end',template:s=>s.fileId?<a className="table-download" href={projectFileDownload(s.fileId)} download={s.fileName||s.title} aria-label={'Скачать «'+(s.fileName||s.title)+'»'} title="Скачать файл"><Download size={16} aria-hidden="true"/></a>:<span/>}
 ]} getRowId={s=>s.id}/></div>}
function LibraryPage(){return <ResearchList/>}
function ResearchList({embedded=false}:{embedded?:boolean}){const {state,projectName}=useApp();const [filter,setFilter]=useState('Все');const list=state.studies.filter(s=>filter==='Все'||(filter==='Видео'?s.format==='Видео':filter==='Отчёты'?s.format!=='Видео':s.type==='Встреча'));return <>{embedded?<div className="section-heading research-heading"><h2>Материалы</h2><AddMaterial/></div>:<PageHeading title={projectName} action={<AddMaterial/>} tabs/>}<div className="toolbar material-filters"><SegmentedRadioGroup value={filter} onUpdate={setFilter} name="Тип материала" options={['Все','Видео','Отчёты','Встречи'].map(value=>({value,content:value}))}/></div>{!state.studies.length?<div className="project-empty"><span className="project-folder"><Folder size={32} strokeWidth={1.5}/></span><h2>Здесь будут ваши материалы</h2><p>PDF, DOCX, DOC, аудио и видео. Откройте запись, чтобы посмотреть текст, сводку и находки.</p>{reader?<p>Попросите участника с полным доступом добавить материалы.</p>:null}</div>:!list.length?<Empty title="Материалы не найдены" action={<Button onClick={()=>setFilter('Все')}>Сбросить фильтры</Button>}>Выберите другой тип материала.</Empty>:<StudyTable studies={list}/>}</>}

const backdropRoute={current:'library'};
const settingsBackdrop={current:'research'};
function SettingsModal({tab,tabs,ctx}:{tab:string;tabs:[string,string,LucideIcon][];ctx:any}){
 const [open,setOpen]=useState(true);const [scrolled,setScrolled]=useState(false);const body=useRef<HTMLDivElement>(null);
 const shown=tabs.some(([id])=>id===tab)?tab:tabs[0][0];
 useEffect(()=>{if(shown!==tab)navigate(shown,true)},[shown,tab]);
 // Leave after the close animation: back to the page under the modal, or to it directly from a deep link.
 const leave=()=>{if(history.state?.app)history.back();else navigate(settingsBackdrop.current,true)};
 return <Modal open={open} onOpenChange={setOpen} onTransitionOutComplete={leave} disableHeightTransition className="settings-modal" contentClassName="settings-sheet" aria-labelledby="settings-title">
  <nav className="settings-nav" aria-labelledby="settings-title"><div className="settings-nav-label" id="settings-title">Настройки</div>
   {tabs.map(([id,label,Icon])=><a key={id} href={appHref(id)} className="settings-nav-item" aria-label={label} aria-current={id===shown?'page':undefined} onClick={e=>{e.preventDefault();body.current?.scrollTo(0,0);setScrolled(false);navigate(id,true)}}><Icon size={18} aria-hidden="true"/><span>{label}</span></a>)}
  </nav>
  <div className="settings-main">
   {/* Title and close stay pinned; only the section below scrolls. */}
   <header className="settings-header" data-scrolled={scrolled||undefined}><h2>{tabs.find(([id])=>id===shown)?.[1]}</h2><IconButton icon={X} label="Закрыть настройки" className="settings-close" onClick={()=>setOpen(false)}/></header>
   <div className="settings-body" ref={body} onScroll={e=>setScrolled(e.currentTarget.scrollTop>0)}><div className="settings-pane" key={shown}>{shown==='models'?<Models/>:shown==='integrations'?<IntegrationsPage/>:shown==='users'?<UsersPage/>:shown==='feedback'?<AnswerFeedbackPage real={ctx.real}/>:<MCPSettings ctx={ctx}/>}</div></div>
  </div>
 </Modal>;
}
function StudyModal({back}:{back:string}) {
 const {route,state,projectName}=useApp();
 const study=state.studies.find(s=>route==='study/'+s.id);
 const finding=state.findings.find(f=>back==='finding/'+f.id);
 const box=useRef<HTMLDivElement>(null);
 const closeTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const [closing,setClosing]=useState(false);
 const close=()=>{
  if(closeTimer.current!==null)return;
  const leave=()=>history.state?.returnTo?history.back():navigate(back,true);
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){leave();return}
  setClosing(true);
  closeTimer.current=setTimeout(leave,120);
 };
 useEffect(()=>{
  const before=document.activeElement as HTMLElement|null;
  const root=document.documentElement;
  const overflow=root.style.overflow;
  root.style.overflow='hidden';
  // VoiceOver can still reach the page under an aria-modal sheet; make that page inert instead.
  // Live regions (toasts) stay reachable so status messages are still announced.
  const muted:HTMLElement[]=[];
  for(let node:HTMLElement|null=box.current?.parentElement||null;node&&node!==document.body;node=node.parentElement)
   for(const sibling of Array.from(node.parentElement?.children||[]) as HTMLElement[])
    if(sibling!==node&&!sibling.inert&&!sibling.matches('script,style,[role=status],[role=alert],[aria-live]')){sibling.inert=true;muted.push(sibling)}
  box.current?.focus({preventScroll:true});
  const key=(e:KeyboardEvent)=>{
   if(e.defaultPrevented||!['Escape','Tab'].includes(e.key))return;
   if(document.querySelector('.g-modal_open,.g-popup_open')&&!box.current?.contains(document.activeElement)&&document.activeElement!==document.body)return;
   if(document.querySelectorAll('[role=dialog]').length>1||document.querySelector('.source-panel'))return;
   if(e.key==='Escape'){close();return}
   const sheet=box.current;
   if(!sheet)return;
   const controls=Array.from(sheet.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,[controls],[contenteditable=true],[tabindex]:not([tabindex="-1"])'))
    .filter(node=>node.getClientRects().length>0&&!node.closest('[inert]')&&getComputedStyle(node).visibility!=='hidden');
   const first=controls[0],last=controls.at(-1),active=document.activeElement;
   if(!first){e.preventDefault();sheet.focus();return}
   if(!sheet.contains(active)||active===sheet||(e.shiftKey?active===first:active===last)){
    e.preventDefault();(e.shiftKey?last:first)?.focus();
   }
  };
  window.addEventListener('keydown',key);
  return()=>{
   window.removeEventListener('keydown',key);
   if(closeTimer.current!==null)clearTimeout(closeTimer.current);
   root.style.overflow=overflow;
   for(const node of muted)node.inert=false;
   if(before?.isConnected)before.focus({preventScroll:true});
  };
 },[]);
 return <div className="study-layer" data-closing={closing||undefined} onMouseDown={e=>{if(e.target===e.currentTarget)close()}}>
  <div ref={box} className="study-sheet" role="dialog" aria-modal="true" aria-label={study?.title||'Материал'} tabIndex={-1}>
   <div className="study-sheet-bar">{finding||history.state?.findingsRoot?<FindingsBreadcrumbs project={history.state?.findingsRoot?.startsWith('/all-findings')?undefined:projectName} finding={finding} studyTitle={study?.title||'Материал'}/>:<ProjectBreadcrumbs project={projectName} studyTitle={study?.title||'Материал'}/>}<IconButton icon={X} label="Закрыть материал" onClick={close}/></div>
   <div className="study-sheet-scroll"><Study key={route}/></div>
  </div>
 </div>;
}
function Study(){const ctx=useApp();const study=ctx.state.studies.find(s=>ctx.route==='study/'+s.id);if(!study)return <Empty title="Материал не найден" action={<Button href={appHref('library')}>Открыть исследования</Button>}>Выберите материал в исследованиях.</Empty>;const points=ctx.state.findings.filter(f=>f.studyId===study.id);return <StudyExperience key={study.id} ctx={ctx} study={study} reader={reader} demo={DEMO} findings={points.map(normalize)}/>}
function FindingMeta({f,showStatus=!reader,children}:{f:Finding;showStatus?:boolean;children?:React.ReactNode}){return <div className="finding-meta">{f.importSource?<Label size="s">Из Гипотениума</Label>:null}{showStatus?<Label size="s" theme={statusTheme(f)}>{statusLabel(f)}</Label>:null}<Label size="s" theme={importanceTheme(f.importance)}>{f.importance}</Label><Label size="s">{f.kind}</Label>{f.significant?<Label size="s" theme="utility">Статистически значимо</Label>:null}{f.basis==='raw'?<Label size="s" theme="warning">По сырым данным</Label>:null}{children}</div>}
function History({f}:{f:Finding}){return f.history?.length?<ol className="history" aria-label="История проверки">{f.history.map((h,i)=><li key={i}><strong>{h.by}</strong> {actionLabel[h.action]||h.action} · {stamp(h.at)}</li>)}</ol>:null}
export function FindingCard({f:raw,compact=false}:{f:Finding;compact?:boolean}){const {state,openPanel,reader}=useApp();const f=normalize(raw);const s=state.studies.find(s=>s.id===f.studyId);return <Card view="outlined" className="finding-card"><FindingMeta f={f} showStatus={!reader}/><h3><button className="text-action" onClick={()=>openPanel({studyId:f.studyId,segmentId:f.segmentId,findingId:f.id})}>{f.title}</button></h3>{compact?null:<p>{f.description}</p>}<div className="meta"><Folder size={13}/>{s?.title} · {s?.type}</div></Card>}
export function Findings({embedded=false}:{embedded?:boolean}){const compact=useCompactLayout();useLayoutEffect(()=>restoreRouteScroll(),[]);const {state,update,open,route,notify,real,reader,projectName}=useApp();const repeats=useRepeats();const params=new URLSearchParams(route.split('?')[1]||'');const study=params.get('study');const onlyDrafts=!reader&&params.get('status')==='draft';const all=state.findings.map(normalize).filter(f=>(!study||f.studyId===study)&&(!onlyDrafts||f.status==='draft'));const withoutDrafts=appHref('findings'+(study?'?study='+encodeURIComponent(study):''));const count=k=>all.filter(f=>k==='all'||f.status===k).length;
 const status='all';const routeKind=KINDS.includes(params.get('kind') as any)?params.get('kind')!:'Все';const [kind,setKind]=useState(routeKind);useEffect(()=>setKind(routeKind),[routeKind]);const changeKind=(value:string)=>{setKind(value);const query=new URLSearchParams(route.split('?')[1]||'');if(value==='Все')query.delete('kind');else query.set('kind',value);navigate('findings'+(query.size?'?'+query.toString():''),true)};const [picked,setPicked]=useState<Set<string>>(()=>new Set());const [confirm,setConfirm]=useState<'verified'|'rejected'|null>(null);
 const list=all.filter(f=>(reader||status==='all'||f.status===status)&&(kind==='Все'||f.kind===kind)).sort((a,b)=>importanceOrder[a.importance]-importanceOrder[b.importance]||(repeats.get(b.id)?.materials||1)-(repeats.get(a.id)?.materials||1));const studyInfo=study&&state.studies.find(s=>s.id===study);
 const setStatusOf=async(ids,next,message)=>{if(!await update(s=>({findings:s.findings.map(x=>ids.has(x.id)?{...normalize(x),status:next}:x)})))return false;setPicked(new Set());notify(message);return true};
 const toggle=id=>setPicked(p=>{const n=new Set(p);n.has(id)?n.delete(id):n.add(id);return n});const visibleIds=list.map(f=>f.id);const allPicked=visibleIds.length>0&&visibleIds.every(id=>picked.has(id));
 const actions=f=>reader?null:<div className="row-actions">{f.status==='draft'?<><Button size="s" view="normal" onClick={()=>setStatusOf(new Set([f.id]),'verified','Находка принята.')}><Check size={14} aria-hidden="true"/>Принять</Button><IconButton size="s" icon={Pencil} label={'Принять с правкой: '+f.title} onClick={()=>open({type:'finding',findingId:f.id,accept:true})}/><IconButton size="s" icon={X} label={'Отклонить: '+f.title} onClick={()=>setStatusOf(new Set([f.id]),'rejected','Находка отклонена.')}/></>:f.status==='verified'?<><IconButton size="s" icon={Pencil} label={'Изменить: '+f.title} onClick={()=>open({type:'finding',findingId:f.id})}/><IconButton size="s" icon={RotateCcw} label={'Вернуть на проверку: '+f.title} onClick={()=>setStatusOf(new Set([f.id]),'draft','Находка возвращена на проверку и скрыта от участников с просмотром.')}/></>:<Button size="s" view="flat" onClick={()=>setStatusOf(new Set([f.id]),'draft','Находка возвращена на проверку.')}><RotateCcw size={14} aria-hidden="true"/>Вернуть на проверку</Button>}</div>;
 const candidate=import.meta.env.VITE_DESIGN_WORKBENCH==='true'?new URLSearchParams(location.search).get('__variant'):null;const structure=['rows','cards'].includes(candidate)?candidate:'table';
 const columns=[...(reader?[]:[{id:'pick',name:()=> <Checkbox checked={allPicked} indeterminate={!allPicked&&visibleIds.some(id=>picked.has(id))} onUpdate={v=>setPicked(v?new Set(visibleIds):new Set())} controlProps={{'aria-label':'Выбрать все находки в списке'}}/>,template:f=><Checkbox checked={picked.has(f.id)} onUpdate={()=>toggle(f.id)} controlProps={{'aria-label':'Выбрать: '+f.title}}/>,width:44}]),{id:'title',name:'Находка',className:'finding-title-column',template:f=><div className="finding-cell"><a className="text-action" href={appHref('finding/'+f.id)}>{f.title}</a><small>{[f.kind,state.studies.find(s=>s.id===f.studyId)?.title,f.significant?'статистически значимо':'',f.basis==='raw'?'по сырым данным':''].filter(Boolean).join(' · ')}</small></div>},{id:'importance',name:'Важность',width:104,template:f=><Label size="s" theme={importanceTheme(f.importance)}>{f.importance}</Label>},{id:'repeats',name:'Повторы',width:112,template:f=>{const n=repeats.get(f.id)?.materials||1;return n>1?<span className="repeat-cell" title="Похожие находки по совпадению слов">{repeatPlace(n)}</span>:<span className="muted" aria-label="Повторов нет">—</span>}},...(reader?[]:[{id:'review',name:'Проверка',width:288,template:f=><div className="review-cell"><Label size="s" theme={statusTheme(f)}>{statusLabel(f)}</Label>{actions(f)}</div>}])];
 return <>{embedded?<div className="section-heading"><h2 id="project-findings-title">Находки <span className="heading-count">{all.length}</span></h2></div>:<PageHeading back={studyInfo?{href:appHref('home'),label:'К проекту'}:undefined} tabs={!studyInfo} overline={studyInfo?.title} title={studyInfo?'Находки':projectName} action={studyInfo?<a className="section-all" href={appHref('findings')}>Все находки</a>:null}>{reader?'Проверенные выводы со ссылками на исходные материалы.':'Находки, предложенные ИИ, участники с просмотром увидят после проверки.'}</PageHeading>}
 {all.length||onlyDrafts?<div className={compact?"toolbar mobile-finding-toolbar":"toolbar"}>{compact?<Select width="max" size="xl" value={[kind]} onUpdate={values=>changeKind(values[0]||'Все')} aria-label="Тип находки" options={['Все',...KINDS].map(value=>({value,content:value+' ('+all.filter(f=>value==='Все'||f.kind===value).length+')'}))}/>:<SegmentedRadioGroup value={kind} onUpdate={setKind} name="Тип находки" options={['Все',...KINDS].map(value=>({value,content:<>{value}<span className="kind-count">{all.filter(f=>value==='Все'||f.kind===value).length}</span></>}))}/>}{onlyDrafts?<Button size="m" view="normal" selected href={withoutDrafts} aria-label="Только находки, которые ждут проверки — снять фильтр">Ждут проверки<X size={14}/></Button>:null}{!compact||!list.length?<span className="muted" role="status">{plural(list.length,'находка','находки','находок')}</span>:null}</div>:null}
 {list.length?(compact?<><div className="mobile-finding-selection">{!reader?<Checkbox checked={allPicked} indeterminate={!allPicked&&visibleIds.some(id=>picked.has(id))} onUpdate={v=>setPicked(v?new Set(visibleIds):new Set())} content="Выбрать все"/>:null}<span role="status">{plural(list.length,'находка','находки','находок')}</span></div><ul className="mobile-finding-list project-mobile-findings" aria-label="Находки проекта">{list.map(f=><li key={f.id}><div className="mobile-finding-heading"><a className="mobile-finding-title" href={appHref('finding/'+f.id)}>{f.title}</a>{!reader?<span className="mobile-row-select"><Checkbox checked={picked.has(f.id)} onUpdate={()=>toggle(f.id)} controlProps={{'aria-label':'Выбрать: '+f.title}}/></span>:null}</div><div className="mobile-finding-meta"><Label size="s" theme={importanceTheme(f.importance)}>{f.importance}</Label><Label size="s" theme={statusTheme(f)}>{statusLabel(f)}</Label><span>{f.kind}</span></div><p className="mobile-finding-project">{state.studies.find(study=>study.id===f.studyId)?.title}</p><div className="mobile-finding-review"><span>{(repeats.get(f.id)?.materials||1)>1?repeatPlace(repeats.get(f.id)?.materials||1):'Один материал'}</span>{actions(f)}</div></li>)}</ul></>:structure==='table'?<div className={'table-scroll findings-table'+(reader?' findings-table_readonly':'')} tabIndex={0} aria-label="Находки. Таблицу можно прокрутить"><Table data={list} getRowId={f=>f.id} columns={columns}/></div>:<>{!reader?<div className="finding-collection-select"><Checkbox checked={allPicked} indeterminate={!allPicked&&visibleIds.some(id=>picked.has(id))} onUpdate={v=>setPicked(v?new Set(visibleIds):new Set())} content="Выбрать все" controlProps={{'aria-label':'Выбрать все находки в списке'}}/></div>:null}<div className={'finding-collection finding-collection-'+structure} role="list">{list.map(f=><article className="finding-collection-item" role="listitem" key={f.id}><div className="finding-collection-leading">{reader?null:<Checkbox checked={picked.has(f.id)} onUpdate={()=>toggle(f.id)} controlProps={{'aria-label':'Выбрать: '+f.title}}/>}<FindingCard f={f} compact/></div>{actions(f)}</article>)}</div></>):<Empty icon={Lightbulb} title={onlyDrafts&&!all.length?'Все находки проверены':all.length?'Нет находок с таким фильтром':'Находок пока нет'} action={onlyDrafts&&!all.length?<Button href={withoutDrafts}>Показать все находки</Button>:all.length?<Button onClick={()=>setKind('Все')}>Показать все находки</Button>:undefined}>{onlyDrafts&&!all.length?'Новые черновики появятся после анализа материалов.':all.length?'Выберите другой тип.':reader?'Здесь появятся находки, которые проверила команда проекта.':'После анализа материалов здесь появятся черновики со ссылками на источники.'}</Empty>}
 {!reader&&picked.size?<div className="bulk-bar" role="region" aria-label="Действия с выбранными находками"><div className="bulk-selection"><strong>Выбрано: {picked.size}</strong><Button view="flat" size="s" onClick={()=>setPicked(new Set())}>Снять выбор</Button></div><div className="bulk-actions"><Button view="action" onClick={()=>setConfirm('verified')}><Check size={16}/>Принять выбранные</Button><Button view="outlined" onClick={()=>setConfirm('rejected')}><X size={16}/>Отклонить выбранные</Button></div></div>:null}
 <Dialog open={Boolean(confirm)} onClose={()=>setConfirm(null)} size="s"><Dialog.Header caption={confirm==='verified'?'Принять находки?':'Отклонить находки?'}/><Dialog.Body><p className="dialog-copy">{confirm==='verified'?plural(picked.size,'находка станет видна всем участникам и попадёт','находки станут видны всем участникам и попадут','находок станут видны всем участникам и попадут')+' в паспорт исследования.':plural(picked.size,'находка не будет видна','находки не будут видны','находок не будут видны')+' участникам с просмотром. Их можно вернуть на проверку.'}</p></Dialog.Body><Dialog.Footer onClickButtonCancel={()=>setConfirm(null)} textButtonCancel="Отмена" onClickButtonApply={async()=>{if(await setStatusOf(new Set(picked),confirm,confirm==='verified'?'Находки приняты.':'Находки отклонены.'))setConfirm(null)}} textButtonApply={confirm==='verified'?'Принять · '+picked.size:'Отклонить · '+picked.size} propsButtonApply={{view:confirm==='verified'?'action':'outlined-danger'}}/></Dialog></>}
// Repeats are counted inside the current project among findings the viewer may see.
const repeatPlace=(n:number)=>'в '+n+' материалах';
function useRepeats(){const {state}=useApp();return useMemo(()=>findingRepeats(state.findings.map(normalize)),[state.findings])}
const segmentsOf=(s?:Study|null):Segment[]=>s?.segments?.length?s.segments:(DEMO&&s?transcript:[]);
const KIND_TABS:[string,string][]=[['Проблема','Проблемы'],['Инсайт','Инсайты'],['Рекомендация','Рекомендации'],['Цифра','Цифры']];
/** Five segments: the share of ready materials where the finding repeats, coloured by importance. */
function Strength({value,total,importance}:{value:number;total:number;importance:string}){const filled=Math.max(1,Math.min(5,Math.round(5*value/Math.max(total,1))));return <span className="strength" data-tone={importanceTheme(importance)} aria-hidden="true">{[0,1,2,3,4].map(i=><i key={i} data-on={i<filled?'':undefined}/>)}</span>}
function FindingsDigest() {
 const {state, reader} = useApp();
 const repeats = useRepeats();const [kind,setKind]=useState('Все');const compact=useCompactLayout();
 const shown = state.findings.map(normalize).filter(f => f.status !== 'rejected');
 const rank = f => (f.status === 'verified' ? 0 : 10) + importanceOrder[f.importance];
 const materialCount = f => repeats.get(f.id)?.materials || 1;
 const ready = state.studies.filter(s => s.status === 'ready').length;
 const repeatText = (n: number) => n + ' из ' + plural(Math.max(ready,n),'материала','материалов','материалов');
 const title = (id: string) => state.studies.find(s => s.id === id)?.title;
 const sources = f => {const names=[...new Set([f.studyId,...(repeats.get(f.id)?.similar||[]).map(id=>shown.find(x=>x.id===id)?.studyId)].map(title).filter(Boolean))];return names.length>2?names.slice(0,2).join(', ')+' и ещё '+(names.length-2):names.join(', ')};
 const tabs = KIND_TABS.filter(([k]) => shown.some(f => f.kind === k));
 const active = kind === 'Все' || tabs.some(([k]) => k === kind) ? kind : 'Все';
 const top = shown.filter(f => active === 'Все' || f.kind === active).sort((a, b) => rank(a) - rank(b) || materialCount(b) - materialCount(a)).slice(0, 5);
 return <section className="findings-digest" aria-labelledby="project-findings-title">
  <div className="section-heading">
   <h2 id="project-findings-title">Находки{shown.length?<span className="section-count">{shown.length}</span>:null}</h2>
   {shown.length > 0 && <a className="section-all" href={appHref('findings')}>Все находки</a>}
  </div>
  {tabs.length > 1 && (()=>{const options=[['Все','Все',shown.length],...tabs.map(([k,l])=>[k,l,shown.filter(f=>f.kind===k).length])] as [string,string,number][];
   // Phones get the same Select as the findings page: four segments do not fit 358 px.
   return <div className="toolbar digest-filters">{compact?<Select width="max" size="xl" label="Тип:" value={[active]} onUpdate={v=>setKind(v[0]||'Все')} options={options.map(([value,label,n])=>({value,content:label+' · '+n}))}/>:<SegmentedRadioGroup value={active} onUpdate={setKind} name="Тип находки" options={options.map(([value,label,n])=>({value,content:<>{label}<span className="segment-count">{n}</span></>}))}/>}</div>})()}
  {top.length ? <ol className="digest-list" role="list">
   {top.map(f => <li key={f.id}>
    <a href={appHref('finding/' + f.id)}>
     <span className="digest-title">{f.title}</span>
     <span className="digest-meta">
      {!reader && f.status !== 'verified' ? <Label size="s" theme={statusTheme(f)}>{statusLabel(f)}</Label> : null}
      <Label size="s" theme={importanceTheme(f.importance)}>{f.importance}</Label>
      <Strength value={materialCount(f)} total={ready} importance={f.importance}/>
      <span title="Повторяемость: похожие формулировки в разных материалах">{repeatText(materialCount(f))}</span>
      <span className="digest-sources">{sources(f)}</span>
     </span>
    </a>
   </li>)}
  </ol> : <p className="digest-empty">{reader ? 'Здесь появятся находки, которые проверила команда проекта.' : 'Находки появятся после анализа материалов.'}</p>}
 </section>;
}
function FindingPage(){const {state,route,openPanel,update,open,notify,projectName}=useApp();const repeats=useRepeats();const all=state.findings.map(normalize);const f=all.find(x=>'finding/'+x.id===route.split('?')[0]);
 const findingRoot=history.state?.findingsRoot||appHref('findings');
 if(!f)return <Empty title={reader?'Находка ещё не проверена':'Находка не найдена'} action={<Button href={findingRoot}>Открыть находки</Button>}>{reader?'Она появится здесь после проверки или была удалена.':'Возможно, её удалили.'}</Empty>;
 const study=state.studies.find(s=>s.id===f.studyId);const segs=segmentsOf(study);const evidence=[...new Set([f.segmentId,...(f.evidence||[])])].map(id=>segs.find(t=>t.id===id)).filter(Boolean) as Segment[];
 const info=repeats.get(f.id);const similar=(info?.similar||[]).map(id=>all.find(x=>x.id===id)).filter(Boolean) as Finding[];const materials=info?.materials||1;const ready=state.studies.filter(s=>s.status==='ready').length;
 const setStatus=async(next,message)=>{if(await update(s=>({findings:s.findings.map(x=>x.id===f.id?{...normalize(x),status:next}:x)})))notify(message)};
 const speaker=(seg:Segment)=>seg.speaker&&!['Запись','Документ'].includes(seg.speaker)&&!seg.speaker.startsWith('Страница ')?seg.speaker+' · ':'';
 return <article className="finding-page"><div className="page-title-row"><Tooltip content="Назад"><a className="page-back" href={findingRoot} aria-label="Назад к находкам" onClick={e=>{if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();if(history.state?.previous===findingRoot)history.back();else navigateHref(findingRoot,true)}}><ArrowLeft size={20} aria-hidden="true"/></a></Tooltip><h1>{f.title}</h1></div>
  <div className="finding-page-status"><FindingMeta f={f}/>{reader?null:<div className="row-actions">{f.status==='draft'?<><Button size="m" view="action" onClick={()=>setStatus('verified','Находка принята.')}><Check size={16}/>Принять</Button><Button size="m" view="outlined" onClick={()=>open({type:'finding',findingId:f.id,accept:true})}><Pencil size={16}/>Принять с правкой</Button><Button size="m" view="flat" onClick={()=>setStatus('rejected','Находка отклонена.')}><X size={16}/>Отклонить</Button></>:f.status==='verified'?<><Button size="m" view="outlined" onClick={()=>open({type:'finding',findingId:f.id})}><Pencil size={16}/>Изменить</Button><Button size="m" view="flat" onClick={()=>setStatus('draft','Находка возвращена на проверку и скрыта от участников с просмотром.')}><RotateCcw size={16}/>Вернуть на проверку</Button></>:<Button size="m" view="outlined" onClick={()=>setStatus('draft','Находка возвращена на проверку.')}><RotateCcw size={16}/>Вернуть на проверку</Button>}</div>}</div>
  <div className="finding-page-grid"><section className="finding-block" aria-labelledby="finding-evidence-title">{f.reason?<div className="finding-reason"><strong className={'importance-'+importanceTheme(f.importance)}>{f.importance}</strong><p>{f.reason}</p>{f.origin==='ai'?<small>Оценка ИИ. Изменится, если поменять важность.</small>:null}</div>:null}{f.description?<p className="finding-description">{f.description}</p>:null}<h2 id="finding-evidence-title">Доказательства</h2>
   {evidence.length?<ul className="evidence-list">{evidence.map(seg=><li key={seg.id}><button type="button" className="evidence-quote" onClick={()=>openPanel({studyId:f.studyId,segmentId:seg.id,findingId:f.id})}><span>«{seg.correctedText??seg.text}»</span><small>{speaker(seg)}{where(seg)} · {study?.title}</small></button></li>)}</ul>:<p className="muted">Фрагмент источника недоступен: материал удалён или обработан заново.</p>}
   {f.origin==='ai'&&f.status==='draft'?<p className="finding-hint">Формулировку предложил ИИ. Откройте цитату и сверьте вывод с источником, прежде чем принять.</p>:null}</section>
  <aside className="finding-side"><section className="finding-block" aria-labelledby="finding-repeat-title"><h2 id="finding-repeat-title">Повторяемость</h2>
   <p className="repeat-number">{materials>1?<><strong>{materials}</strong> из {ready} материалов</>:similar.length?'Только в этом материале':ready>1?<><strong>1</strong> из {ready} материалов</>:'Один материал'}</p>
   <p className="muted">{materials>1?'Похожие находки есть в других материалах проекта.':similar.length?'Похожие находки есть в этом же материале.':ready>1?'В других материалах похожих находок нет.':'В проекте один готовый материал — сравнивать не с чем.'}</p>
   {similar.length?<><ul className="similar-list">{similar.slice(0,6).map(x=><li key={x.id}><a href={appHref('finding/'+x.id)}>{x.title}</a><small>{state.studies.find(s=>s.id===x.studyId)?.title}</small></li>)}</ul>{similar.length>6?<p className="muted">И ещё {similar.length-6}.</p>:null}<p className="finding-hint">Сходство считается по совпадению слов в формулировках. Проверьте по источникам, что это одна и та же мысль.</p></>:null}</section>
   {study?<section className="finding-block" aria-labelledby="finding-study-title"><h2 id="finding-study-title">Материал</h2><a className="finding-study-link" href={appHref('study/'+study.id)}>{study.title}</a><p className="muted">{study.type} · {fullDate(study.date)}</p><a className="finding-project-link" href={appHref('home')}><Folder size={14} aria-hidden="true"/>Проект «{projectName}»</a>{f.basis==='raw'?<p className="finding-hint">Отчёта по этому исследованию нет: вывод сделан по сырым данным.</p>:null}</section>:null}
   {f.history?.length?<section className="finding-block" aria-label="История проверки"><h2>История</h2><History f={f}/></section>:null}</aside></div></article>}
/** Longer answers are uncovered for longer, like a streamed reply; capped so nobody waits. */
const revealMessage=(el:HTMLElement|null)=>{if(el&&!el.style.getPropertyValue('--reveal-ms'))el.style.setProperty('--reveal-ms',Math.round(Math.min(3200,Math.max(900,el.scrollHeight*3.5)))+'ms')};
function Models(){const {state,update,open,notify,user,real}=useApp();const [checks,setChecks]=useState<Record<string,string>>({});const [removing,setRemoving]=useState<any>(null);
 const check=async m=>{setChecks(s=>({...s,[m.id]:'Проверяем подключение…'}));try{const r=await api('/api/models/'+m.id+'/test',{});setChecks(s=>({...s,[m.id]:'Подключено: '+r.model+' · '+r.seconds+' с · '+(r.usage?.total_tokens||'?')+' токенов'}))}catch(e){setChecks(s=>({...s,[m.id]:e.message}))}};
 const toggle=(m,v)=>{if(!v&&state.models.filter(x=>x.enabled).length===1){notify('Оставьте включённой хотя бы одну модель.');return}update(s=>({models:s.models.map(x=>x.id===m.id?{...x,enabled:v}:x),modelId:!v&&s.modelId===m.id?s.models.find(x=>x.id!==m.id&&x.enabled).id:s.modelId}))};
 return <>
 <div className="settings-list"><div className="setting-row"><div className="setting-main"><h3>Модель по умолчанию</h3><p>Отвечает в чатах и готовит сводки</p></div><Select aria-label="Модель по умолчанию" value={[state.modelId]} options={state.models.filter(m=>m.enabled).map(m=>({value:m.id,content:m.name}))} onUpdate={v=>update({modelId:v[0]})}/></div></div>
 <h2 className="settings-group-label">Подключения</h2>
 <ul className="settings-list" aria-label="Подключённые модели">{state.models.map(m=>{const ready=Boolean(m.keyConfigured&&m.model);return <li className="setting-row" key={m.id}>
  <div className="setting-icon" data-status={!m.enabled?'off':ready?'on':'warn'} aria-hidden="true"><Box size={16}/></div>
  <div className="setting-main"><h3>{m.name}{m.id===state.modelId?<span className="setting-meta">По умолчанию</span>:null}{m.reserve?<span className="setting-meta">Резервная</span>:null}</h3><p aria-live="polite">{checks[m.id]||(ready?m.provider+' · '+m.model:'Нужен API-ключ — откройте «Настроить»')}</p></div>
  <div className="setting-actions"><Switch checked={m.enabled} controlProps={{'aria-label':(m.enabled?'Выключить ':'Включить ')+m.name}} onUpdate={v=>toggle(m,v)}/>
   <DropdownMenu popupProps={{placement:['bottom-end','top-end']}} renderSwitcher={props=><Button {...props} view="flat" size="m" aria-label={'Действия: '+m.name}><MoreHorizontal size={16} aria-hidden="true"/></Button>} items={[{text:'Проверить подключение',action:()=>check(m),disabled:!ready||checks[m.id]==='Проверяем подключение…'},{text:'Настроить',action:()=>open({type:'model',id:m.id})},...(m.builtin&&ready?[]:[{text:'Удалить',theme:'danger' as const,action:()=>setRemoving(m)}])]}/></div>
 </li>})}
  <li className="setting-row setting-add-row"><button type="button" className="setting-add" onClick={()=>open({type:'model'})}><span className="setting-icon" aria-hidden="true"><Plus size={16}/></span><span className="setting-main"><strong>Добавить модель</strong><span>OpenAI, Anthropic или совместимый API</span></span></button></li>
 </ul><Processors/><StorageStatus enabled={real&&Boolean(user?.owner)}/><Dialog open={Boolean(removing)} onClose={()=>setRemoving(null)} size="s"><Dialog.Header caption="Удалить подключение?"/><Dialog.Body><p className="dialog-copy">«{removing?.name}» исчезнет из списка моделей. {removing?.hasStoredKey?'Сохранённый API-ключ будет удалён с сервера.':'Ключ из настроек сервера останется.'} Ответы, уже полученные с этой моделью, останутся в чатах.</p></Dialog.Body><Dialog.Footer onClickButtonCancel={()=>setRemoving(null)} textButtonCancel="Отмена" textButtonApply="Удалить" propsButtonApply={{view:'outlined-danger'}} onClickButtonApply={async()=>{const id=removing.id;if(!await update(s=>{const models=s.models.filter(x=>x.id!==id);return {models,modelId:s.modelId===id?(models.find(x=>x.enabled)?.id||''):s.modelId}}))return;notify('Подключение удалено.');setRemoving(null)}}/></Dialog></>}
function Processors(){const {state}=useApp();return <section aria-labelledby="processors-title"><h2 className="settings-group-label" id="processors-title">Обработчики</h2><div className="settings-list" role="list">{state.processors.map(p=>{const Icon=p.id==='speakers'||p.id==='diarization'?Users:p.id==='tesseract'||p.id==='frames'?FileText:Mic;return <div className="setting-row processor-row" role="listitem" key={p.id}><div className="setting-icon" data-status={p.configured?'on':'off'} aria-hidden="true"><Icon size={16}/></div><div className="setting-main"><h3>{p.name}</h3><p>{p.description}</p></div><Label size="s" theme={p.configured?'success':'normal'}>{p.configured?'Подключён':'Не подключён'}</Label></div>})}</div></section>}

function UserStatus({user}){
 const labels={active:'Активен',invited:'Ожидает регистрации',expired:'Срок истёк',revoked:'Доступ отозван'};
 return <div className="user-status"><Label theme={user.status==='active'?'success':user.status==='expired'||user.status==='revoked'?'warning':'info'}>{labels[user.status]}</Label>{user.expires&&['invited','expired'].includes(user.status)?<small>{user.status==='expired'?'Истёк ':'До '}{stamp(user.expires)}</small>:null}</div>;
}
function UsersPage(){
 const {state,update,open,notify,user,projectName}=useApp();
 const canEdit=u=>u.id!==user?.id&&!u.admin&&!u.owner&&(u.scope==='all'?user?.manageUsers||DEMO:!u.projectIds||u.projectIds.length<=1);
 return <><div className="settings-toolbar"><Button view="action" size="l" onClick={()=>open({type:'invite'})}><Plus size={16}/>Добавить</Button></div>
 <p className="result-count">{plural(state.users.length,'пользователь','пользователя','пользователей')}{DEMO?' · демо-адреса':''}</p>
 <div className="table-scroll users-table" tabIndex={0} aria-label="Пользователи. Таблицу можно прокрутить"><Table<WorkspaceUser> data={state.users} getRowId={u=>u.id} columns={[
  {id:'name',name:'Пользователь',template:u=><div className="user-cell"><Avatar text={u.name[0]} size="m"/><div><strong title={u.name}>{u.name}{u.id===user?.id||DEMO&&u.owner?' · вы':''}</strong><small>{u.email}</small><div className="user-mobile-status"><UserStatus user={u}/></div></div></div>},
  {id:'status',name:'Статус',template:u=><UserStatus user={u}/>},
  {id:'scope',name:'Проекты',template:u=>u.scope==='all'?'Все проекты':u.projectNames?.join(', ')||projectName},
  {id:'role',name:'Уровень доступа',template:u=>canEdit(u)?<Select value={[u.role]} options={[{value:'view',content:'Просмотр'},{value:'full',content:'Полный доступ'}]} aria-label={'Доступ: '+u.name} onUpdate={v=>{update(s=>({users:s.users.map(x=>x.id===u.id?{...x,role:v[0]}:x)}));if(DEMO)notify('Уровень доступа изменён в прототипе.')}}/>:<span className="muted">{u.role==='full'?'Полный доступ':'Просмотр'}</span>},
  {id:'admin',name:'Администратор',template:u=>user?.owner&&!u.expires&&u.id!==user.id?<Checkbox className="user-admin-toggle" checked={Boolean(u.admin)} controlProps={{'aria-label':'Администратор: '+u.name}} onUpdate={value=>update(s=>({users:s.users.map(x=>x.id===u.id?{...x,admin:value}:x)}))}/>:u.admin?'Да':'Нет'},
  {id:'actions',name:'',template:u=>u.id!==user?.id&&(user?.owner||u.status==='expired'&&user?.manageUsers)?<IconButton icon={MoreHorizontal} label={'Действия: '+u.name} onClick={()=>open({type:'user',id:u.id})}/>:<ShieldCheck size={18}/>}
 ]}/></div>
 <p className="page-footnote">Новый участник активен после регистрации по приглашению. Для существующего аккаунта доступ открывается сразу. Общий доступ включает будущие проекты; назначать администраторов и отзывать доступ может только администратор.</p></>;
}
function SourcePanel(){const {panel,panelClosing,setPanel,state,go,openGlobalSource}=useApp();const list=useRef(null),media=useRef(null),closeButton=useRef(null);const [mediaError,setMediaError]=useState('');
 const study=panel&&state.studies.find(s=>s.id===panel.studyId);const segments=study?.segments?.length?study.segments:DEMO&&study?.id==='calendar'?transcript:[];const index=segments.findIndex(t=>t.id===panel?.segmentId);const seg=index>=0?segments[index]:null;
 const finding=panel?.findingId?state.findings.map(normalize).find(f=>f.id===panel.findingId):null;const isMedia=Boolean(study?.fileId&&study.format==='Видео');const isPDF=Boolean(study?.fileId&&/\.pdf$/i.test(study.fileName||''));
 useEffect(()=>{if(!panel)return;const before=document.activeElement as HTMLElement;closeButton.current?.focus();requestAnimationFrame(()=>list.current?.querySelector('.segment.selected')?.scrollIntoView({block:'nearest'}));return()=>{if(before?.isConnected)before.focus({preventScroll:true})}},[panel?.studyId,panel?.key]);
 if(!panel)return null;const close=()=>setPanel(null);
 // List mode: quotes come with the answer, so it opens instantly; «Открыть фрагмент» switches to the detailed view.
 if(panel.sources){const groups=[...new Map<string,ChatSource[]>(panel.sources.map(x=>[x.studyId,panel.sources!.filter(y=>y.studyId===x.studyId)])).values()];
  return <aside className="source-panel" data-closing={panelClosing||undefined} aria-label="Источники" aria-modal="false"><div className="source-panel-head"><div><div className="overline">{plural(panel.sources.length,'цитата','цитаты','цитат')}</div><h2>{panel.heading}</h2></div><Tooltip content="Закрыть источники"><Button ref={closeButton} view="flat" size="l" aria-label="Закрыть источники" onClick={close}><X size={18}/></Button></Tooltip></div>
  <div className="source-panel-body source-list">{groups.map(list=><section key={list[0].studyId} className="source-group">{groups.length>1||list[0].title!==panel.heading?<h3>{list[0].title}</h3>:null}{list[0].workspaceName?<p className="source-group-project">{list[0].workspaceName}</p>:null}
   {list.map(x=><figure key={x.segmentId} className="source-quote"><blockquote>«{x.correctedText??x.text}»</blockquote><figcaption><span>{x.speaker} · {where(x)}</span><Button view="flat" size="s" onClick={()=>openGlobalSource(x)}>Открыть фрагмент<ArrowRight size={14} aria-hidden="true"/></Button></figcaption></figure>)}</section>)}</div></aside>}
 const problem=!study?['Источник удалён','Материал, на который ссылается вывод, больше недоступен.']:!seg?['Фрагмент не найден','Материал мог быть обработан заново, и фрагмент изменился. Проверьте находку по всему материалу.']:mediaError?['Таймкод за пределами записи',mediaError]:null;
 return <aside className="source-panel" data-closing={panelClosing||undefined} aria-label="Источник" aria-modal="false"><div className="source-panel-head"><div><div className="overline">Источник</div><h2>{study?.title||'Материал'}</h2>{study?<div className="finding-meta"><Label size="s">{study.type}</Label><Label size="s" theme={reportOf(study)==='none'?'warning':'success'}>{reportOf(study)==='none'?'По сырым данным':'Отчёт исследователя'}</Label>{seg?<Label size="s" theme="info">{where(seg)}</Label>:null}</div>:null}</div><Tooltip content="Закрыть источник"><Button ref={closeButton} view="flat" size="l" aria-label="Закрыть источник" onClick={close}><X size={18}/></Button></Tooltip></div>
 <div className="source-panel-body">{finding?<section className="panel-finding"><FindingMeta f={finding}/><h3>{finding.title}</h3>{finding.description?<p>{finding.description}</p>:null}{reader?null:<History f={finding}/>}</section>:null}
 {problem?<div className="panel-error" role="alert"><strong>{problem[0]}</strong><p>{problem[1]}</p>{study?<Button onClick={()=>{close();go('study/'+study.id)}}>Открыть весь материал</Button>:null}</div>:null}
 {study&&seg?<>{isMedia?<video ref={media} src={projectFile(study.fileId)} controls preload="metadata" className="panel-media" onLoadedMetadata={e=>{const d=e.currentTarget.duration;if(Number.isFinite(d)&&seg.time>d)setMediaError('Фрагмент указывает на '+time(seg.time)+', а запись длится '+time(d)+'.');else e.currentTarget.currentTime=seg.time}}/>:null}
 {isPDF?<iframe title={'Исходный PDF, страница '+(seg.page||1)} className="panel-pdf" src={projectFile(study.fileId)+'#page='+(seg.page||1)}/>:null}
 <div className="panel-segments" ref={list}>{segments.slice(Math.max(0,index-2),index+3).map(t=><article key={t.id} className={'segment '+(t.id===seg.id?'selected':'')} aria-current={t.id===seg.id?'true':undefined}><div className="segment-head"><strong>{t.speaker}</strong><Button view="flat" size="s" onClick={()=>{if(media.current&&!t.page)media.current.currentTime=t.time;setPanel(p=>({...p,segmentId:t.id,number:t.id===panel.segmentId?p.number:undefined}))}} aria-label={'Перейти к '+where(t)}>{where(t)}</Button></div><p>{t.correctedText??t.text}{t.correctedText!==undefined?<small className="correction-label"> (исправлено)</small>:null}</p></article>)}</div>
 <Button view="outlined" width="max" onClick={()=>{close();go('study/'+study.id,seg.id)}}>Открыть в материале<ArrowRight size={16}/></Button></>:null}</div></aside>}
// Material titles read as "who said it"; «Тест чата · Респондент 1» keeps its last part.
const sourceName=(src:ChatSource)=>{const name=(src.title||'Материал').split(' · ').pop()!.trim();return name.length>22?name.slice(0,20)+'…':name};
const materialCount=(list:ChatSource[])=>new Set(list.map(x=>x.studyId)).size;
const sourceLabel=(list:ChatSource[])=>sourceName(list[0])+(materialCount(list)>1?' +'+(materialCount(list)-1):'');
const sourcesHeading=(list:ChatSource[])=>materialCount(list)===1?list[0].title:'Цитаты из '+plural(materialCount(list),'материала','материалов','материалов');
function AnswerText({id,text,sources,onCite,active}:{id:string;text:string;sources?:ChatSource[];onCite:(list:ChatSource[],key:string)=>void;active?:string}){
 // Adjacent [1][2][3] become one chip; the number is never shown, it read as "how often".
 const cite=(s,k)=>s.split(/((?:\s*\[\d+\])+)/g).map((part,i)=>{const nums=part.match(/\[(\d+)\]/g);if(!nums)return part;const list=[...new Set(nums.map(n=>Number(n.slice(1,-1))))].map(n=>sources?.find(x=>x.number===n)).filter(Boolean) as ChatSource[];if(!list.length)return part;const key=id+'-'+k+'-'+i,names=[...new Set(list.map(x=>x.title))].join(', ');
  return <button key={key} type="button" className="footnote" aria-expanded={active===key} title={'Цитаты: '+names} aria-label={'Цитаты: '+names} onClick={()=>onCite(list,key)}><Quote size={12} aria-hidden="true"/><span>{sourceLabel(list)}</span></button>});
 const blocks=answerBlocks(text),sectioned=blocks.some(b=>b.type==='heading');
 const render=(block:typeof blocks[number],i:number)=>block.type==='heading'?<h3 key={i}>{cite(block.text,i)}</h3>:block.type==='list'?<ul key={i}>{block.items.map((item,j)=><li key={j}>{item.lead?<><strong>{cite(item.lead,i+'-'+j+'l')}</strong> </>:null}{cite(item.text,i+'-'+j)}</li>)}</ul>:<p key={i}>{cite(block.text,i)}</p>;
 // A sectioned answer opens with «Главное»; «Выводы» and «Что осталось невыясненным» run until the next heading as cards.
 const groups:{kind?:string;items:[typeof blocks[number],number][]}[]=[];
 blocks.forEach((block,i)=>{const kind=block.type==='heading'?(block.text===METRICS_SECTION?'metrics':CARD_SECTIONS[block.text]):undefined;if(kind||block.type==='heading'||!groups.length)groups.push({kind,items:[]});groups[groups.length-1].items.push([block,i])});
 const metrics=(g:typeof groups[number],n:number)=><section key={n} className="answer-metrics">{g.items.map(([b,i])=>b.type==='heading'?render(b,i):b.type==='list'?<ul key={i}>{b.items.map((item,j)=>{const m=item.lead?{...answerMetric(item.text),label:item.lead}:answerMetric(item.text);return <li key={j}>{m.label?<span className="answer-metric-label">{m.label}</span>:null}<strong className="answer-metric-value">{cite(m.value,i+'-'+j+'v')}</strong>{m.note?<span className="answer-metric-note">{cite(m.note,i+'-'+j)}</span>:null}</li>})}</ul>:render(b,i))}</section>;
 const out=groups.map((g,n)=>g.kind==='metrics'?metrics(g,n):g.kind?<section key={n} className={'answer-card answer-card_'+g.kind}>{g.items.map(([b,i])=>render(b,i))}</section>:g.items.map(([b,i])=>i===0&&sectioned&&b.type==='paragraph'?<div key={i} className="answer-lead"><span>Главное</span>{render(b,i)}</div>:render(b,i)));
 return <div className={'answer'+(sectioned?' answer_sectioned':'')}>{out}</div>}

function FormField({label,children,help}:{label:string;children:React.ReactElement<any>;help?:string}){const id=React.useId();return <div className="form-field"><label htmlFor={id}>{label}</label>{React.cloneElement(children,{id})}{help?<small>{help}</small>:null}</div>}
function AppDialog(){const ctx=useApp();const {dialog:d,open,state,update,receive,real,notify,go,files}=ctx;const [form,setForm]=useState<Record<string,any>>({}),[uploading,setUploading]=useState(false),[error,setError]=useState(''),[query,setQuery]=useState('');const file=useRef(null);const first=useRef(null);const field=(name,value)=>setForm(s=>({...s,[name]:value}));const close=()=>{if(!uploading)open(null)};const model=state.models.find(m=>m.id===d?.id);const user=state.users.find(u=>u.id===d?.id);const finding=d?.findingId?state.findings.map(normalize).find(f=>f.id===d.findingId):null;const study=state.studies.find(s=>s.id===(d?.studyId||finding?.studyId||form.studyId));const segment=segmentsOf(study).find(t=>t.id===(d?.segmentId||finding?.segmentId||form.segmentId));useEffect(()=>{setForm(d?.initial||{});setError('')},[d?.type,d?.id,d?.findingId,d?.studyId,d?.segmentId]);const title={upload:'Добавить материал',finding:finding?(d.accept?'Принять с правкой':'Изменить находку'):d?.segmentId?'Сохранить находку':'Новая находка',passport:'Паспорт исследования',workspace:'Новый проект',whatsnew:'Что нового в версии '+APP_VERSION,invite:'Добавить пользователя',model:model?'Настройка модели':'Добавить модель',source:'Доказательство',search:'Найти в проекте',processor:'Параметры обработчика',user:user?.name}[d?.type]||'';
 async function submit(){if(uploading)return;setUploading(true);setError('');try{if(reader&&!['search','source','workspace'].includes(d.type))return;switch(d.type){
 case 'workspace':{const name=(form.name||'').trim();if(!name){setError('Назовите проект.');first.current?.focus();return}if(name.length>60){setError('Не длиннее 60 символов.');return}if(real){const created=await api('/api/workspaces',{name});await ctx.switchWorkspace(created.id);notify('Проект «'+name+'» создан.');break}notify('В демо-режиме проекты не создаются.');break}
 case 'invite':{if(real){const target=form.workspace||(ctx.user?.manageUsers?'all':ctx.user?.workspaceId);const payload={name:form.name||'',email:form.email||'',role:form.role||'view',scope:target==='all'?'all':'project'};const result=await api(target==='all'?'/api/invitations':'/api/workspaces/'+encodeURIComponent(target)+'/invitations',payload);if(target!=='all'&&target!==ctx.user?.workspaceId){await ctx.switchWorkspace(target);go('users')}else receive(await api('/api/state'));if(result.added){notify('Пользователь добавлен в проект.'+(result.emailStatus==='sent'?' Письмо передано почтовому серверу.':' Сообщите участнику о доступе.'));break}setForm(s=>({...s,inviteURL:result.inviteURL,emailStatus:result.emailStatus}));notify('Приглашение создано.');return}const name=(form.name||'').trim(),email=(form.email||'').trim().toLowerCase();if(!name||!/^\S+@\S+\.\S+$/.test(email)){setError('Введите имя и адрес почты в формате name@example.com.');first.current?.focus();return}if(state.users.some(x=>x.email.toLowerCase()===email)){setError('Этот адрес уже добавлен. Введите другой или измените права в таблице.');return}update(s=>({users:[...s.users,{id:uid(),name,email,role:form.role||'view',status:'invited'}]}));notify('Демо-приглашение создано. Письмо не отправлено.');break}
 case 'finding':{const title=(form.title??finding?.title??'').trim();if(!title){setError('Напишите короткий вывод.');first.current?.focus();return}if(title.length>160){setError('Сократите вывод до 160 символов.');return}const values={title,description:form.description??finding?.description??(d?.quote?'«'+d.quote+'»':''),kind:form.kind||finding?.kind||'Инсайт',importance:form.importance||finding?.importance||'Средняя',significant:form.significant??finding?.significant??false};if(finding){if(!await update(s=>({findings:s.findings.map(x=>x.id===finding.id?{...normalize(x),...values,...(d.accept?{status:'verified'}:{})}:x)})))return;notify(d.accept?'Находка принята с правкой.':'Находка изменена.');break}if(!study||!segment){setError('Выберите материал и цитату: находке нужно доказательство.');return}if(!await update(s=>({findings:[{id:uid(),...values,studyId:study.id,segmentId:segment.id,status:'verified',origin:'human',history:DEMO?[{action:'created',by:'Глеб',at:Date.now()}]:[]},...s.findings]})))return;notify('Находка сохранена со ссылкой на фрагмент.');break}
 case 'passport':{const st=study;const report=form.report||reportOf(st);const passport={title:(form.title??st.title).trim(),description:(form.description??st.description??'').trim(),type:form.type||st.type,conducted:(form.conducted??st.conducted??'').trim(),method:(form.method??st.method??'').trim(),audience:(form.audience??st.audience??'').trim(),author:(form.author??st.author??'').trim(),report,reportExpected:report==='none'?(form.reportExpected??st.reportExpected??''):''};if(!passport.title){setError('Укажите название исследования.');first.current?.focus();return}if(passport.reportExpected&&!/^\d{4}-\d{2}-\d{2}$/.test(passport.reportExpected)){setError('Укажите дату в формате ГГГГ-ММ-ДД.');return}if(real){receive(await api('/api/studies/'+st.id,{passport},'PATCH'));notify('Паспорт сохранён.');break}update(s=>({studies:s.studies.map(x=>x.id===st.id?{...x,...passport}:x)}));notify('Паспорт сохранён.');break}

 case 'upload':{const f=file.current;if(!f||!f.size||f.size>2*1024**3){setError('Выберите непустой файл размером до 2 ГБ.');return}if(!form.title?.trim()){setError('Укажите название материала.');return}const id=uid();files.current.set(id,{url:URL.createObjectURL(f),type:f.type});update(s=>({studies:[{id,title:form.title.trim(),description:'Локальный файл · демонстрация обработки',type:form.type||'Интервью',format:/\.(pdf|txt)$/i.test(f.name)?'PDF':'Видео',project:form.project?.trim()||'',date:new Date().toISOString().slice(0,10),duration:0,participants:0,status:'processing',step:0,tags:['Новый материал'],color:'sage',findings:0,summary:[],localFile:true,fileName:f.name},...s.studies]}));go('library');notify('Файл добавлен локально. Запущена демонстрация обработки.');break}
 default:return}close()}catch(e){setError(e.message)}finally{setUploading(false)}}
 return <><Dialog open={Boolean(d)&&!(real&&d?.type==='upload')&&d?.type!=='import'&&d?.type!=='model'} onClose={close} size="s" className={d?.type==='invite'?'invite-dialog':undefined} aria-labelledby="modal-title"><Dialog.Header caption={title}/><Dialog.Body><h2 className="sr-only" id="modal-title">{title}</h2>{d?.type==='search'?<><TextInput value={query} onUpdate={setQuery} placeholder="Название, тема или метка" controlProps={{'aria-label':'Поиск по исследованиям'}} autoFocus/><div className="command-results">{state.studies.filter(s=>(s.title+' '+s.project+' '+s.tags.join(' ')).toLowerCase().includes(query.toLowerCase())).map(s=><Button view="flat" width="max" key={s.id} onClick={()=>{close();go('study/'+s.id)}}><FileText size={16}/>{s.title}</Button>)}</div></>:null}
 {d?.type==='invite'?<>{form.inviteURL?<div className="invite-result"><p role="status">{invitationMailNotice(form.emailStatus)}</p><p>Ссылка действует 7 дней и используется один раз.</p><TextInput value={form.inviteURL} readOnly controlProps={{'aria-label':'Ссылка приглашения'}}/><Button onClick={()=>navigator.clipboard.writeText(form.inviteURL).then(()=>notify('Ссылка скопирована.')).catch(()=>notify('Выделите и скопируйте ссылку вручную.'))}>Скопировать ссылку</Button></div>:null}<FormField label="Имя"><TextInput value={form.name||''} onUpdate={v=>field('name',v)} controlRef={first} placeholder="Анна Иванова" autoComplete="off"/></FormField><FormField label="Электронная почта"><TextInput value={form.email||''} onUpdate={v=>field('email',v)} type="email" placeholder="name@example.com" autoComplete="off" validationState={error?'invalid':undefined} errorMessage={error}/></FormField><FormField label="Проекты"><Select aria-label="Проекты" value={[form.workspace||(ctx.user?.manageUsers||DEMO?'all':ctx.user?.workspaceId)]} options={[...(ctx.user?.manageUsers||DEMO?[{value:'all',content:'Все проекты'}]:[]),...(ctx.workspaces||[]).filter(w=>w.admin).map(w=>({value:w.id,content:w.name}))]} onUpdate={v=>field('workspace',v[0])}/></FormField><FormField label="Уровень доступа"><Select value={[form.role||'view']} options={[{value:'view',content:'Просмотр'},{value:'full',content:'Полный доступ'}]} onUpdate={v=>field('role',v[0])}/></FormField><Notice>Приглашение действует 7 дней. Новый участник получит ссылку регистрации, существующий — доступ сразу. «Все проекты» включает текущие и будущие проекты.</Notice></>:null}

 {d?.type==='finding'?<>{!finding&&!d.segmentId?<><FormField label="Материал"><Select width="max" filterable={state.studies.length>8} placeholder="Выберите материал" value={study?[study.id]:[]} disabled={Boolean(d.studyId)} options={state.studies.filter(s=>s.status==='ready'&&segmentsOf(s).length).map(s=>({value:s.id,content:s.title,text:s.title}))} onUpdate={v=>setForm(x=>({...x,studyId:v[0],segmentId:undefined}))}/></FormField><FormField label="Цитата-доказательство" help="Фрагмент материала, на который опирается вывод."><Select width="max" popupWidth="fit" filterable placeholder={study?'Найдите фрагмент по словам':'Сначала выберите материал'} disabled={!study} value={segment?[segment.id]:[]} options={segmentsOf(study).map(seg=>{const label=where(seg)+' · '+(seg.correctedText??seg.text).slice(0,140);return {value:seg.id,content:label,text:label}})} onUpdate={v=>field('segmentId',v[0])}/></FormField></>:null}<FormField label="Короткий вывод" help="До 160 символов. Одна мысль, которую можно проверить по фрагменту."><TextInput value={form.title??finding?.title??''} onUpdate={v=>field('title',v)} controlRef={first} placeholder="Что узнали из фрагмента?"/></FormField><FormField label="Контекст"><TextArea value={form.description??finding?.description??(d?.quote?'«'+d.quote+'»':'')} onUpdate={v=>field('description',v)} minRows={2}/></FormField><div className="form-row"><FormField label="Тип"><Select value={[form.kind||finding?.kind||'Инсайт']} options={KINDS.map(value=>({value,content:value}))} onUpdate={v=>field('kind',v[0])}/></FormField><FormField label="Важность"><Select value={[form.importance||finding?.importance||'Средняя']} options={IMPORTANCE.map(value=>({value,content:value}))} onUpdate={v=>field('importance',v[0])}/></FormField></div><Switch checked={form.significant??finding?.significant??false} onUpdate={v=>field('significant',v)} content="Статистически значимо"/>{segment?<blockquote>«{segment.correctedText??segment.text}»<footer>{study?.title} · {where(segment)}</footer></blockquote>:null}{finding?<History f={finding}/>:null}</>:null}
 {d?.type==='workspace'?<><FormField label="Название" help="Например, «Календарь цен». Материалы, участники и чат в каждом проекте свои."><TextInput value={form.name||''} onUpdate={v=>field('name',v)} controlRef={first} placeholder="Календарь цен" autoFocus/></FormField></>:null}
 {d?.type==='whatsnew'?<><ul className="whats-new">{[[Lightbulb,'Категории находок','Выбирайте проблемы, рекомендации и инсайты чипами. Важность показана первым столбцом, проверенные находки отмечены серым.'],[Sparkles,'Ожидание ответа','Пока готовится ответ, Мнемодак ищет по исследованиям и показывает время ожидания. Под готовыми ответами убрана служебная строка об охвате.'],[MessageSquare,'Главная с общим чатом','Задавайте вопросы по доступным исследованиям сразу после входа.'],[Clock,'История бесед','Продолжайте сохранённые чаты из меню. Корзина у строки открывает подтверждение удаления.'],[Folder,'Проекты','Все папки собраны в отдельном разделе. Материалы находятся внутри проекта.'],[Lightbulb,'Общие находки','Просматривайте находки из доступных проектов. Права на черновики сохраняются.'],[Quote,'Источники рядом с ответом','Сноска открывает фрагмент поверх переписки. Черновик вопроса остаётся на месте.'],[ShieldCheck,'Права для истории чата','История личная. Доступ к сохранённым ответам повторно проверяется по текущим источникам и правам.']].map(([Icon,title,text]:any)=><li key={title}><span className="whats-new-icon"><Icon size={18}/></span><div><strong>{title}</strong><p>{text}</p></div></li>)}</ul></>:null}
 {d?.type==='passport'&&study?<><FormField label="Название"><TextInput value={form.title??study.title} onUpdate={v=>field('title',v)} controlRef={first}/></FormField><FormField label="Описание"><TextArea value={form.description??study.description??''} onUpdate={v=>field('description',v)} minRows={2}/></FormField><div className="form-row"><FormField label="Тип источника"><Select value={[form.type||study.type]} options={['Интервью','Юзабилити-тест','Встреча','Отчёт'].map(value=>({value,content:value}))} onUpdate={v=>field('type',v[0])}/></FormField><FormField label="Проведено"><TextInput value={form.conducted??study.conducted??''} onUpdate={v=>field('conducted',v)} placeholder="Ноябрь 2026"/></FormField></div><FormField label="Метод"><TextInput value={form.method??study.method??''} onUpdate={v=>field('method',v)} placeholder="Юзабилити-тестирование"/></FormField><FormField label="Аудитория" help="Хозяева или гости, сегменты и размер выборки."><TextArea value={form.audience??study.audience??''} onUpdate={v=>field('audience',v)} minRows={2}/></FormField><FormField label="Автор"><TextInput value={form.author??study.author??''} onUpdate={v=>field('author',v)}/></FormField><div className="form-row"><FormField label="Отчёт исследователя"><Select value={[form.report||reportOf(study)]} options={[{value:'ready',content:'Отчёт есть'},{value:'none',content:'Отчёта нет'}]} onUpdate={v=>field('report',v[0])}/></FormField>{(form.report||reportOf(study))==='none'?<FormField label="Ожидаем отчёт"><TextInput type={"date" as "text"} value={form.reportExpected??study.reportExpected??''} onUpdate={v=>field('reportExpected',v)}/></FormField>:null}</div><Notice>Без отчёта находки и ответы чата по исследованию помечаются «по сырым данным».</Notice></>:null}
 {d?.type==='upload'?<><label className="file-drop"><Upload size={28}/><strong>{form.fileName||'Выберите исходный файл'}</strong><small>PDF, DOCX, DOC, XLS, XLSX, TXT, аудио и видео · до 2 ГБ</small><input type="file" accept=".mp4,.mov,.webm,.mp3,.wav,.m4a,.pdf,.txt,.docx,.doc,.xls,.xlsx" aria-label="Выбрать исходный файл" onChange={e=>{const f=e.target.files[0];file.current=f;if(f)setForm(s=>({...s,fileName:f.name,title:s.title||f.name.replace(/\.[^.]+$/,'')}))}}/></label><FormField label="Название"><TextInput value={form.title||''} onUpdate={v=>field('title',v)}/></FormField><div className="form-row"><FormField label="Тип источника"><Select value={[form.type||'Интервью']} options={['Интервью','Юзабилити-тест','Встреча','Отчёт'].map(value=>({value,content:value}))} onUpdate={v=>field('type',v[0])}/></FormField><FormField label="Тема"><TextInput value={form.project||''} onUpdate={v=>field('project',v)} placeholder="Календарь и цены"/></FormField></div><Switch checked={form.autoSummary!==false} onUpdate={v=>field('autoSummary',v)} content="Создать сводку после обработки"/><p className="upload-summary-note">{form.autoSummary!==false?'После обработки текст будет отправлен выбранной модели: '+(state.models.find(m=>m.id===state.modelId)?.name||'модель не выбрана')+'. Сводка сохранится как черновик ИИ.':'Текст останется в проекте. Сводку можно будет создать на странице материала.'}</p><Notice>Файл сохранится в проекте. Текст из TXT, PDF и Word станет доступен для поиска. {state.processors.some(p=>p.id==='whisper'&&p.configured)?'После загрузки запись автоматически попадёт в очередь распознавания.':'Распознавание речи на этом сервере пока не установлено. Запись можно сохранить для обработки позже.'} Сводку можно создать на странице материала.</Notice></>:null}
 {d?.type==='source'?<><div className="meta"><Folder size={14}/>{study?.title} · {study?.type}</div>{segment?<><blockquote>«{segment.correctedText??segment.text}»<footer>{segment.speaker} · {segment.page?'Стр. '+segment.page:time(segment.time)}</footer></blockquote><Button view="action" onClick={()=>{close();go('study/'+d.studyId,d.segmentId)}}>Открыть фрагмент {segment.page?'Стр. '+segment.page:time(segment.time)}<ArrowRight size={16}/></Button></>:<><p className="dialog-copy">У этой находки нет прямой цитаты. Это вопрос из демонстрационной внутренней встречи.</p><Button href={appHref('study/'+d.studyId)} onClick={close}>Открыть материал</Button></>}</>:null}
 {d?.type==='processor'?<><p className="dialog-copy">{state.processors.find(p=>p.id===d.id)?.name}: распознавание речи и LLM подключаются независимо. В этом прототипе модуль не установлен и не запускается.</p><Notice>Параметры сервера и скорость обработки нужно проверять на реальном корпусе.</Notice></>:null}
 {d?.type==='user'&&user?<div className="stack"><p>{user.email}</p><UserStatus user={user}/>{user.scope==='all'?<Notice>Изменение затронет все текущие и будущие проекты.</Notice>:null}{user.status==='expired'?<Button view="action" onClick={()=>open({type:'invite',initial:{name:user.name,email:user.email,role:user.role,workspace:user.scope==='all'?'all':ctx.user?.workspaceId}})}>Создать новое приглашение</Button>:null}{ctx.user?.owner?<Button view={user.status==='revoked'?'action':'outlined-danger'} onClick={async()=>{if(!await update(s=>({users:s.users.map(x=>x.id===user.id?{...x,status:x.status==='revoked'?'active':'revoked'}:x)})))return;if(!real)notify(user.status==='revoked'?'Доступ восстановлен в прототипе.':'Доступ отозван в прототипе.');close()}}>{user.status==='revoked'?'Восстановить доступ':'Отозвать доступ'}</Button>:null}</div>:null}
 {error&&d?.type!=='invite'?<p className={uploading?"muted":"form-error"} role={uploading?"status":"alert"}>{error}</p>:null}</Dialog.Body><Dialog.Footer onClickButtonCancel={close} textButtonCancel={d?.type==='whatsnew'?'Понятно':['search','source','processor','user'].includes(d?.type)?'Закрыть':'Отмена'} {...(['upload','finding','model','invite','passport','workspace'].includes(d?.type)?{onClickButtonApply:submit,propsButtonApply:{loading:uploading,disabled:uploading},textButtonApply:({upload:state.processors.some(p=>p.id==='whisper'&&p.configured)?'Загрузить и распознать':'Загрузить файл',finding:finding?(d.accept?'Принять с правкой':'Сохранить'):'Сохранить находку',model:'Сохранить настройки',invite:'Создать приглашение',passport:'Сохранить паспорт',workspace:'Создать и перейти'})[d.type]}:{})}/></Dialog><ModelConnectionDialog open={d?.type==='model'} model={model} ctx={ctx} onClose={close}/></>
}
