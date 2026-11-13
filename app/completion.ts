import {useEffect,useRef} from 'react';
import type {Study} from './types.ts';

export const COMPLETION_SOUND_URL='/sounds/transcription-complete.mp3?v=20261113';
/** Unlock audio on a user gesture; failed loads can retry and completion waits for decoding. */
export function createCompletionAudio(createContext:()=>AudioContext=()=>new AudioContext(),request:()=>Promise<Response>=()=>fetch(COMPLETION_SOUND_URL)){
 let context:AudioContext|undefined,buffer:AudioBuffer|undefined,loading:Promise<void>|undefined,disposed=false;
 const load=()=>{
  if(buffer||disposed)return Promise.resolve();
  return loading??=request().then(r=>{if(!r.ok)throw new Error('Audio unavailable');return r.arrayBuffer()}).then(b=>context!.decodeAudioData(b)).then(b=>{if(!disposed)buffer=b}).finally(()=>{loading=undefined});
 };
 return {
  async activate(){if(disposed)return;context??=createContext();await context.resume();await load()},
  async play(){if(disposed||!context)return;await context.resume();await load();if(disposed||!buffer||context.state!=='running')return;const source=context.createBufferSource();source.buffer=buffer;source.connect(context.destination);source.start()},
  dispose(){disposed=true;void context?.close().catch(()=>{})},
 };
}

export function finishedRecordings(before:ReadonlyMap<string,string>,after:Study[]){
 return after.filter(s=>s.format==='Видео'&&s.status==='ready'&&['processing','uploaded'].includes(before.get(s.id)||''));
}

export function useCompletionSound(studies:Study[],workspaceId:string|undefined,enabled:boolean,onComplete:(studies:Study[])=>void){
 const previous=useRef<{workspaceId:string|undefined;statuses:Map<string,string>}>({workspaceId:undefined,statuses:new Map()});
 const play=useRef<()=>void>(()=>{});
 const callback=useRef(onComplete);callback.current=onComplete;
 useEffect(()=>{
  const audio=createCompletionAudio();const activate=()=>{void audio.activate().catch(()=>{})};
  document.addEventListener('pointerdown',activate,{capture:true});document.addEventListener('keydown',activate,{capture:true});
  play.current=()=>{void audio.play().catch(()=>{})};
  return()=>{play.current=()=>{};document.removeEventListener('pointerdown',activate,true);document.removeEventListener('keydown',activate,true);audio.dispose()};
 },[]);
 useEffect(()=>{
  const before=previous.current;previous.current={workspaceId,statuses:new Map(studies.map(s=>[s.id,s.status]))};
  if(!workspaceId||before.workspaceId!==workspaceId)return;
  const finished=finishedRecordings(before.statuses,studies);if(!finished.length)return;
  callback.current(finished);if(enabled)play.current();
 },[studies,workspaceId,enabled]);
}
