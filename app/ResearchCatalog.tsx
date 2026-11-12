import React,{useContext,useEffect,useState} from 'react';
import {Button,Label,Select,Table,TextInput} from '@gravity-ui/uikit';
import {Folder,Lightbulb,Plus,Search} from 'lucide-react';
import {Context} from './main.tsx';
import {api} from './api.ts';
import ProjectFolder from './ProjectFolder.tsx';
import {ProjectMenu} from './ProjectActions.tsx';

export default function ResearchCatalog({findings=false}:{findings?:boolean}){
 return findings?<FindingsCatalog/>:<ProjectsCatalog/>;
}

function ProjectsCatalog(){
 const {real,state,workspaces,open,switchWorkspace,go,projectAction}=useContext(Context);
 const [error,setError]=useState('');
 const projects=real?workspaces:[{id:'local-demo',name:state.workspace?.name||'Демонстрационный проект',fileCount:state.studies.length}];
 const openProject=async(id:string)=>{setError('');try{if(real)await switchWorkspace(id);else go('home')}catch(e){setError(e.message)}};
 return <>
  <div className="page-heading"><div><h1>Проекты</h1><p>Проекты с материалами исследований.</p></div><Button view="outlined" size="l" onClick={()=>open({type:'workspace'})}><Plus size={16}/>Создать проект</Button></div>
  {error?<p className="form-error" role="alert">{error}</p>:null}
  {projects.length?<div className="projects-grid">{projects.map(project=><article className="project-card" key={project.id}><div className="project-folder-stage"><ProjectFolder project={project} onOpen={()=>openProject(project.id)}/>{real?<ProjectMenu project={project} onAction={projectAction}/>:null}</div></article>)}</div>:<div className="empty"><Folder size={28}/><h2>Проектов пока нет</h2><p>Создайте проект, затем добавьте интервью, документы или видео.</p><Button onClick={()=>open({type:'workspace'})}>Создать проект</Button></div>}
 </>;
}

function FindingsCatalog(){
 const {real,state,workspaces,switchWorkspace,go}=useContext(Context);
 const [projects,setProjects]=useState<any[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[filter,setFilter]=useState('all'),[query,setQuery]=useState('');
 const accessKey=workspaces.map(w=>w.id+':'+w.name+':'+w.role).join('|');
 useEffect(()=>{
  let live=true;setLoading(true);setError('');
  const request=real?api('/api/research-library',undefined,'GET',false):Promise.resolve({projects:[{id:'local-demo',name:'Демонстрационный проект',...state}]});
  request.then(data=>{if(live)setProjects(data.projects)}).catch(e=>{if(live)setError(e.message)}).finally(()=>{if(live)setLoading(false)});
  return()=>{live=false};
 },[real,accessKey,state.studies.length,state.findings.length,attempt]);
 const rows=projects.filter(p=>filter==='all'||p.id===filter).flatMap(p=>p.findings.map(item=>({...item,projectId:p.id,projectName:p.name}))).filter(item=>(item.title+' '+item.projectName).toLowerCase().includes(query.toLowerCase()));
 const openItem=async(item:any)=>{try{if(real)await switchWorkspace(item.projectId);go('finding/'+item.id)}catch(e){setError(e.message)}};
 return <>
  <div className="page-heading"><div><h1>Находки</h1><p>Выводы по всем доступным исследованиям.</p></div></div>
  {loading?<p role="status">Открываем находки…</p>:error?<div role="alert"><p className="form-error">{error}</p><Button onClick={()=>setAttempt(n=>n+1)}>Повторить</Button></div>:<>
   <div className="toolbar catalog-filters"><TextInput value={query} onUpdate={setQuery} placeholder="Найти находку" controlProps={{'aria-label':'Найти находку'}} startContent={<Search size={16}/>}/><Select value={[filter]} onUpdate={v=>setFilter(v[0])} aria-label="Проект" options={[{value:'all',content:'Все проекты'},...projects.map(p=>({value:p.id,content:p.name}))]}/></div>
   {rows.length?<div className="table-scroll catalog-table" tabIndex={0} aria-label="Все находки"><Table data={rows} getRowId={row=>row.projectId+':'+row.id} columns={[
    {id:'title',name:'Находка',template:row=><button className="catalog-link" onClick={()=>openItem(row)}><Lightbulb size={18}/><span>{row.title}</span></button>},
    {id:'projectName',name:'Проект'},{id:'importance',name:'Важность'},
    {id:'status',name:'Статус',template:row=><Label theme={row.status==='verified'?'success':'info'}>{row.status==='verified'?'Проверено':row.status==='rejected'?'Отклонено':'Черновик ИИ'}</Label>}
   ]}/></div>:<div className="empty"><Lightbulb size={28}/><h2>{query||filter!=='all'?'Ничего не найдено':'Находок пока нет'}</h2><p>{query||filter!=='all'?'Измените запрос или выберите другой проект.':'Они появятся после анализа материалов и проверки командой.'}</p></div>}
  </>}
 </>;
}
