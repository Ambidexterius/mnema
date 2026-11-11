import {useEffect,useRef} from 'react';
import type {Study} from './types.ts';

export function finishedRecordings(before:ReadonlyMap<string,string>,after:Study[]){
 return after.filter(s=>s.format==='Видео'&&s.status==='ready'&&['processing','uploaded'].includes(before.get(s.id)||''));
}

export function useCompletionSound(studies:Study[],workspaceId:string|undefined,enabled:boolean,onComplete:(studies:Study[])=>void){
 const previous=useRef<{workspaceId:string|undefined;statuses:Map<string,string>}>({workspaceId:undefined,statuses:new Map()});
 const play=useRef<()=>void>(()=>{});
 const callback=useRef(onComplete);callback.current=onComplete;
 useEffect(()=>{
  let context:AudioContext|undefined,buffer:AudioBuffer|undefined,loading:Promise<void>|undefined,disposed=false;
  const activate=()=>{try{context??=new AudioContext();void context.resume().catch(()=>{});loading??=fetch('/sounds/transcription-complete.mp3').then(r=>{if(!r.ok)throw new Error('Audio unavailable');return r.arrayBuffer()}).then(b=>context!.decodeAudioData(b)).then(b=>{if(!disposed)buffer=b}).catch(()=>{});}catch{}};
  document.addEventListener('pointerdown',activate,{capture:true});document.addEventListener('keydown',activate,{capture:true});
  play.current=()=>{if(!buffer||context?.state!=='running')return;const source=context.createBufferSource();source.buffer=buffer;source.connect(context.destination);source.start()};
  return()=>{disposed=true;play.current=()=>{};document.removeEventListener('pointerdown',activate,true);document.removeEventListener('keydown',activate,true);void context?.close().catch(()=>{})};
 },[]);
 useEffect(()=>{
  const before=previous.current;previous.current={workspaceId,statuses:new Map(studies.map(s=>[s.id,s.status]))};
  if(!workspaceId||before.workspaceId!==workspaceId)return;
  const finished=finishedRecordings(before.statuses,studies);if(!finished.length)return;
  callback.current(finished);if(enabled)play.current();
 },[studies,workspaceId,enabled]);
}
