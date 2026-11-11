import {useEffect,useRef,useState} from 'react';
import {finishedRecordings} from './completion.ts';
import {APP_VERSION} from './version.ts';
import type {Study} from './types.ts';
type Unread={workspace:string;id:string};

/** A completion marker belongs to this tab; initial ready records are not notifications. */
export function useCompletionFavicon(studies:Study[],workspace:string|undefined,user:string|undefined,route:string,allowed:string[]){
 const [unread,setUnread]=useState<Unread[]>([]);
 const previous=useRef<{workspace?:string;user?:string;statuses:Map<string,string>}>({statuses:new Map()});
 const original=useRef('');const allowedKey=allowed.join('|');
 useEffect(()=>{const icon=document.querySelector<HTMLLinkElement>('link[rel~="icon"]');if(!icon)return;original.current=icon.getAttribute('href')||'/brand-mark.svg';return()=>{icon.href=original.current;delete icon.dataset.completionDot}},[]);
 useEffect(()=>{const before=previous.current;previous.current={workspace,user,statuses:new Map(studies.map(s=>[s.id,s.status]))};
  if(before.user!==user){setUnread(items=>items.length?[]:items);return}if(!workspace||!user||before.workspace!==workspace)return;
  const finished=finishedRecordings(before.statuses,studies);if(!finished.length)return;
  setUnread(current=>{const result=[...current];for(const study of finished)if(!result.some(x=>x.workspace===workspace&&x.id===study.id))result.push({workspace,id:study.id});return result.length===current.length?current:result});
 },[studies,workspace,user]);
 useEffect(()=>{const permitted=new Set(allowedKey.split('|'));setUnread(items=>{const next=items.filter(x=>permitted.has(x.workspace));return next.length===items.length?items:next})},[allowedKey]);
 useEffect(()=>{const acknowledge=()=>{if(document.visibilityState!=='visible'||!route.startsWith('study/'))return;const id=route.slice(6);setUnread(items=>{const next=items.filter(x=>x.workspace!==workspace||x.id!==id);return next.length===items.length?items:next})};acknowledge();window.addEventListener('focus',acknowledge);document.addEventListener('visibilitychange',acknowledge);document.addEventListener('pointerdown',acknowledge);return()=>{window.removeEventListener('focus',acknowledge);document.removeEventListener('visibilitychange',acknowledge);document.removeEventListener('pointerdown',acknowledge)}},[route,workspace]);
 useEffect(()=>{const icon=document.querySelector<HTMLLinkElement>('link[rel~="icon"]');if(!icon)return;icon.href=unread.length?'/brand-mark-unread.svg?v='+APP_VERSION:original.current||'/brand-mark.svg';icon.dataset.completionDot=unread.length?'true':'false'},[unread.length]);
}
