import React,{useEffect,useRef,useState} from 'react';
import {Button} from '@gravity-ui/uikit';
import {LoaderCircle,RefreshCw} from 'lucide-react';
import {api} from './api.ts';

export default function DocumentPreview({fileId,file,name,standalone=false,page}:{fileId?:string;file:string;name:string;standalone?:boolean;page?:number}){
 const pdf=/\.pdf$/i.test(name);const [attempt,retry]=useState(0),[html,setHtml]=useState(''),[state,setState]=useState<'loading'|'ready'|'error'>('loading');
 const frame=useRef<HTMLIFrameElement>(null);
 useEffect(()=>{let active=true;setState('loading');setHtml('');
  if(!fileId){setState('error');return}
  api('/api/files/'+encodeURIComponent(fileId)+'/preview').then(result=>{if(active){setHtml(result.html);setState('ready')}}).catch(()=>{if(active)setState('error')});
  return()=>{active=false};
 },[fileId,file,pdf,attempt]);
 return <section className="document-preview" aria-label="Предпросмотр исходного файла">
  {!standalone?<><h2>Исходный файл</h2><p className="document-preview-name">{name}</p></>:null}
  {!pdf?<p className="document-preview-caption">Текст, заголовки и таблицы из исходного файла.</p>:null}
  {state==='loading'?<div className="document-preview-message" role="status"><LoaderCircle className="activity-spinner" size={20} aria-hidden="true"/>Загружаем предпросмотр…</div>:null}
  {state==='error'?<div className="document-preview-message" role="alert"><strong>Не удалось открыть предпросмотр</strong><p>Исходный файл сохранён. Попробуйте ещё раз.</p><Button view="outlined" onClick={()=>retry(x=>x+1)}><RefreshCw size={16}/>Повторить</Button><Button view="flat" href={file} download>Скачать исходник</Button></div>:null}
  {state==='ready'?(pdf?<iframe ref={frame} key={attempt} title={'Предпросмотр: '+name} src={file+(page?'#page='+page:'')} className="document-preview-frame" onError={()=>setState('error')}/>:<iframe ref={frame} title={'Предпросмотр: '+name} srcDoc={html} sandbox="" className="document-preview-frame"/>):null}
 </section>;
}
