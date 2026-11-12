import {folderPaths} from './folder-geometry.ts';
import React,{useId,useLayoutEffect,useRef,useState} from 'react';
import {Tooltip} from '@gravity-ui/uikit';
import type {ProjectRef} from './ProjectActions.tsx';
import {fileCount} from './ProjectActions.tsx';

// Keep the folder silhouette while using the same visible radius as the chat.
export default function ProjectFolder({project,disabled,onOpen}:{project:ProjectRef;disabled?:boolean;onOpen:()=>void}){
 const id=useId().replace(/[^a-zA-Z0-9_-]/g,''),rim='folder-rim-'+id;
 const button=useRef<HTMLButtonElement>(null),title=useRef<HTMLElement>(null),[scale,setScale]=useState(1),[displayRadius,setDisplayRadius]=useState(12),[truncated,setTruncated]=useState(false);
 const measureTitle=()=>{const label=title.current;setTruncated(Boolean(label&&label.scrollHeight>label.clientHeight+1))};
 useLayoutEffect(()=>{const element=button.current;if(!element)return;const resize=()=>{setScale(element.getBoundingClientRect().width/340);setDisplayRadius(parseFloat(getComputedStyle(element).getPropertyValue('--mn-home-radius'))||12);measureTitle()};resize();const observer=new ResizeObserver(resize);observer.observe(element);if(title.current)observer.observe(title.current);return()=>observer.disconnect()},[project.name]);
 const count=project.fileCount||0;
 const paths=folderPaths(displayRadius,scale);
 return <Tooltip strategy="fixed" disabled={!truncated} content={<span className="project-full-name">{project.name}</span>} placement={['bottom-start','top-start']} openDelay={500}><button ref={button} type="button" className="project-card-link glass-folder" onFocus={measureTitle} onPointerEnter={measureTitle} aria-label={'Открыть проект «'+project.name+'»'} disabled={disabled} onClick={onOpen}>
  <span className="glass-folder-shadow" aria-hidden="true"/>
  <span className="glass-folder-geometry" style={{transform:`scale(${scale})`,'--folder-native-radius':`${paths.radius}px`} as React.CSSProperties} aria-hidden="true">
   <span className="glass-folder-back" style={{clipPath:`path('${paths.back}')`}}/>
   <span className="glass-folder-pages">{Array.from({length:Math.min(3,count)},(_,i)=><span className={'glass-folder-paper paper-'+i} key={i}><span/><span/><span/><span/></span>)}</span>
   <span className="glass-folder-preview">{Array.from({length:Math.min(3,count)},(_,i)=><span className={'glass-folder-paper preview-paper-'+i} key={i}><span className="folder-document-heading"><b>{project.filePreviews?.[i]?.name||''}</b><small>{project.filePreviews?.[i]?.format||''}</small></span><span/><span/><span/><span/></span>)}</span>
   <span className="glass-folder-front" style={{clipPath:`path('${paths.front}')`}}><span className="glass-folder-frost"/></span>
   <svg className="glass-folder-rim" viewBox="0 0 340 272"><defs><linearGradient id={rim} x1="0" y1="74" x2="0" y2="272" gradientUnits="userSpaceOnUse"><stop stopColor="var(--g-color-line-generic-accent)" stopOpacity="1"/><stop offset=".35" stopColor="var(--g-color-line-generic-accent)" stopOpacity=".65"/><stop offset="1" stopColor="var(--g-color-line-generic-accent)" stopOpacity=".3"/></linearGradient></defs><path d={paths.back} className="glass-folder-back-rim"/><path d={paths.front} fill="none" stroke={'url(#'+rim+')'} strokeWidth="1"/></svg>
  </span>
  <span className="project-card-info"><strong ref={title}>{project.name}</strong><span>{fileCount(count)}</span></span>
 </button></Tooltip>;
}
