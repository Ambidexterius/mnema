import {useCompactLayout,MOBILE_WEB_QUERY} from './useCompactLayout.ts';
import type {Finding} from './types.ts';
import {findingStatusLabel} from './finding-status.ts';
import React,{useContext,useEffect,useState} from 'react';
import {Button,Hotkey,Label,SegmentedRadioGroup,Select,Table} from '@gravity-ui/uikit';
import {Folder,Lightbulb,Plus} from 'lucide-react';
import {Context,NavigationHint} from './main.tsx';
import {api} from './api.ts';
import {navigate,restoreRouteScroll} from './routes.ts';
import ProjectFolder from './ProjectFolder.tsx';
import {ProjectMenu} from './ProjectActions.tsx';

export default function ResearchCatalog({findings=false}:{findings?:boolean}){
 return findings?<FindingsCatalog/>:<ProjectsCatalog/>;
}

function ProjectsCatalog(){
 const mobileWeb=useCompactLayout(MOBILE_WEB_QUERY);
 const {real,state,workspaces,open,switchWorkspace,go,projectAction}=useContext(Context);
 const [error,setError]=useState('');
 const projects=real?workspaces:[{id:'local-demo',name:state.workspace?.name||'Демонстрационный проект',fileCount:state.studies.length}];
 const openProject=async(id:string)=>{setError('');try{if(real)await switchWorkspace(id);else go('home')}catch(e){setError(e.message)}};
 return <>
  <div className="page-heading projects-heading"><div className="page-title-row"><h1>Проект</h1><NavigationHint label="Создать новый проект" shortcut="C" enabled><Button view="outlined" size="l" aria-label="Создать" aria-keyshortcuts={mobileWeb?undefined:'C'} onClick={()=>open({type:'workspace'})}><Plus size={16}/>Создать{!mobileWeb?<Hotkey className="shortcut-hint" value="C" aria-hidden="true"/>:null}</Button></NavigationHint></div><p>Храните интервью, документы и находки команды.</p></div>
  {error?<p className="form-error" role="alert">{error}</p>:null}
  {projects.length?<div className="projects-grid">{projects.map(project=><article className="project-card" key={project.id}><div className="project-folder-stage"><ProjectFolder project={project} onOpen={()=>openProject(project.id)}/>{real?<ProjectMenu project={project} onAction={projectAction}/>:null}</div></article>)}</div>:<div className="empty"><Folder size={28}/><h2>Проектов пока нет</h2><p>Создайте проект, затем добавьте интервью, документы или видео.</p><Button onClick={()=>open({type:'workspace'})}>Создать</Button></div>}
 </>;
}

const priorityTheme=(importance:string):'danger'|'warning'|'info'|'normal'=>importance==='Критично'?'danger':importance==='Высокая'?'warning':importance==='Средняя'?'info':'normal';
function FindingStatus({finding}:{finding:Pick<Finding,'status'|'origin'>}){return <Label size="s" theme={finding.status==='draft'?'info':'normal'}>{findingStatusLabel(finding)}</Label>}

function FindingsCatalog(){
 const compact=useCompactLayout();
 const {real,state,workspaces,switchWorkspace,go}=useContext(Context);
 const [projects,setProjects]=useState<any[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 const selectedKind=new URLSearchParams(location.search).get('kind');
 const [kind,setKind]=useState(['Проблема','Рекомендация','Инсайт'].includes(selectedKind)?selectedKind:'all');
 useEffect(()=>setKind(['Проблема','Рекомендация','Инсайт'].includes(selectedKind)?selectedKind:'all'),[selectedKind]);
 useEffect(()=>{if(!loading)restoreRouteScroll()},[loading]);
 const accessKey=workspaces.map(w=>w.id+':'+w.name+':'+w.role).join('|');
 useEffect(()=>{
  let live=true;setLoading(true);setError('');
  const request=real?api('/api/research-library',undefined,'GET',false):Promise.resolve({projects:[{id:'local-demo',name:'Демонстрационный проект',...state}]});
  request.then(data=>{if(live)setProjects(data.projects)}).catch(e=>{if(live)setError(e.message)}).finally(()=>{if(live)setLoading(false)});
  return()=>{live=false};
 },[real,accessKey,state.studies.length,state.findings.length,attempt]);
 const rows=projects.flatMap(p=>p.findings.map(item=>({...item,projectId:p.id,projectName:p.name}))).filter(item=>kind==='all'||item.kind===kind);
 const openItem=async(item:any)=>{try{if(real)await switchWorkspace(item.projectId,false);go('finding/'+item.id)}catch(e){setError(e.message)}};
 return <>
  <div className="page-heading"><div><h1>Находки</h1><p>Выводы по всем доступным исследованиям.</p></div></div>
  {loading?<p role="status">Открываем находки…</p>:error?<div role="alert"><p className="form-error">{error}</p><Button onClick={()=>setAttempt(n=>n+1)}>Повторить</Button></div>:<>
   <div className="toolbar findings-type-tabs">{compact?<Select width="max" size="xl" aria-label="Тип находки" value={[kind]} onUpdate={values=>{const value=values[0]||'all';setKind(value);navigate('all-findings'+(value==='all'?'':'?kind='+encodeURIComponent(value)),true)}} options={[["all","Все находки"],["Проблема","Проблемы"],["Рекомендация","Рекомендации"],["Инсайт","Инсайты"]].map(([value,content])=>({value,content}))}/>:<SegmentedRadioGroup name="Тип находки" size="m" value={kind} onUpdate={value=>{setKind(value);navigate('all-findings'+(value==='all'?'':'?kind='+encodeURIComponent(value)),true)}} options={[["all","Все"],["Проблема","Проблемы"],["Рекомендация","Рекомендации"],["Инсайт","Инсайты"]].map(([value,content])=>({value,content}))}/>}</div>
   {rows.length?(compact?<ul className="mobile-finding-list" aria-label="Все находки">{rows.map(row=><li key={row.projectId+':'+row.id}><button className="mobile-finding-open" onClick={()=>openItem(row)}><span className="mobile-finding-title">{row.title}</span><span className="mobile-finding-meta"><Label size="s" theme={priorityTheme(row.importance)}>{row.importance||'Не указана'}</Label><FindingStatus finding={row}/></span><span className="mobile-finding-project">{row.projectName}</span></button></li>)}</ul>:<div className="table-scroll catalog-table findings-table" tabIndex={0} aria-label="Все находки"><Table data={rows} getRowId={row=>row.projectId+':'+row.id} columns={[
    {id:'importance',name:'Важность',width:120,template:row=><Label size="s" theme={priorityTheme(row.importance)}>{row.importance||'Не указана'}</Label>},
    {id:'title',name:'Находка',template:row=><button className="catalog-link finding-open" onClick={()=>openItem(row)}><span className="finding-title"><span>{row.title}</span><span className="finding-mobile-meta"><span>{row.projectName}</span><FindingStatus finding={row}/></span></span></button>},
    {id:'projectName',name:'Проект',width:'22%'},
    {id:'status',name:'Статус',width:160,className:'status-column',template:row=><FindingStatus finding={row}/>}

   ]}/></div>):<div className="empty"><Lightbulb size={28}/><h2>{kind==='all'?'Находок пока нет':'В этой категории пока нет находок'}</h2><p>{kind==='all'?'Они появятся после анализа материалов и проверки командой.':'Выберите другую категорию или посмотрите все находки.'}</p></div>}
  </>}
 </>;
}
