import {useCallback,useEffect,useRef,useState} from 'react';
import {api} from './api.ts';
type Chat={id:string;title:string;projectId?:string|null;messages:any[];updated:number};
const demoKey='mnemonika.local-research-chats.v1';
export function useResearchChats({demo,userId,route,go,notify,state,accessKey}:{demo:boolean;userId?:string;route:string;go:(path:string)=>void;notify:(text:string)=>void;state:any;accessKey:string}){
 const [chats,setChats]=useState<Chat[]>([]),[messages,setMessages]=useState<any[]>([]),[typing,setTyping]=useState(false),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const [latestReplyId,setLatestReplyId]=useState<string|null>(null);
 // A project page pins its chat without navigating; the conversation route always wins.
 const [pinned,pin]=useState<string|null>(null);
 const routeId=route.startsWith('conversation/')?route.slice(13):null,activeId=routeId??pinned;
 const pendingChat=useRef<string|null>(null);
 const epoch=useRef(0),busy=useRef(false),active=useRef(activeId),loaded=useRef<string|null>(null);active.current=activeId;
 const refresh=useCallback(async()=>{const requestEpoch=epoch.current;const result=demo?JSON.parse(localStorage.getItem(demoKey)||'[]'):(await api('/api/chats',undefined,'GET',false)).chats;if(requestEpoch===epoch.current)setChats(result);return result},[demo,userId,accessKey]);
 useEffect(()=>{epoch.current++;setLatestReplyId(null);setChats([]);setMessages([]);setError('');loaded.current=null;refresh().catch(e=>setError(e.message))},[refresh]);
 useEffect(()=>{let live=true;if(busy.current&&pendingChat.current===activeId){setLoading(false);return}setLatestReplyId(null);setError('');setMessages([]);loaded.current=null;if(!activeId){setLoading(false);return}setLoading(true);
 (demo?Promise.resolve(JSON.parse(localStorage.getItem(demoKey)||'[]').find(c=>c.id===activeId)):api('/api/chats/'+encodeURIComponent(activeId),undefined,'GET',false)).then(chat=>{if(!chat)throw Error('Чат не найден.');if(live){setMessages(chat.messages);loaded.current=chat.id}}).catch(e=>{if(live)setError(e.message)}).finally(()=>{if(live)setLoading(false)});return()=>{live=false}
 },[activeId,demo,userId,accessKey]);
 const saveDemo=(chat:Chat)=>{const list=JSON.parse(localStorage.getItem(demoKey)||'[]').filter(c=>c.id!==chat.id);list.unshift(chat);localStorage.setItem(demoKey,JSON.stringify(list));setChats(list)};
 async function ask(question:string,projectId?:string){
  if(busy.current||loading||!question.trim()||(activeId&&loaded.current!==activeId))return false;
  busy.current=true;setTyping(true);setError('');const requestEpoch=epoch.current;
  try{
   let id=activeId;
   if(!id){const chat=demo?{id:crypto.randomUUID(),title:'Новый чат',projectId:projectId||null,messages:[],updated:Date.now()}:await api('/api/chats',projectId?{projectId}:{},'POST',false);id=chat.id;if(demo)saveDemo(chat);else setChats(list=>[{...chat,title:question.slice(0,80)},...list]);pendingChat.current=id;loaded.current=id;if(projectId)pin(id);else go('conversation/'+id);active.current=id}
   pendingChat.current=id;
   const previous=messages;setMessages([...previous,{id:crypto.randomUUID(),role:'user',text:question}]);
   let chat:Chat;
   if(demo){
    const terms=question.toLowerCase().match(/[а-яё]{4,}/g)||[];
    const findings=state.findings.filter(f=>f.status==='verified').map(f=>({f,score:terms.filter(t=>f.title.toLowerCase().includes(t.slice(0,4))).length})).sort((a,b)=>b.score-a.score).filter(x=>x.score).slice(0,5);
    const sources=findings.map(({f},i)=>{const study=state.studies.find(s=>s.id===f.studyId);const seg=study?.segments?.find(s=>s.id===f.segmentId);return {...seg,number:i+1,studyId:f.studyId,segmentId:f.segmentId,title:study?.title,workspaceId:'local-demo',workspaceName:'Демонстрационный проект'}}).filter(s=>s.text);
    chat={id,projectId:chats.find(c=>c.id===id)?.projectId||projectId||null,title:previous.length?chats.find(c=>c.id===id)?.title||question.slice(0,80):question.slice(0,80),updated:Date.now(),messages:[...previous,{id:crypto.randomUUID(),role:'user',text:question},{id:crypto.randomUUID(),role:'assistant',model:'Локальный пример',answer:'Демонстрационный ответ по тестовым данным.\n\n'+(sources.length?findings.slice(0,sources.length).map(({f},i)=>`${i+1}. ${f.title} [${i+1}]`).join('\n'):'В тестовой подборке нет совпадений. Попробуйте спросить о календаре или цене.'),sources}]};saveDemo(chat);
   }else{const answer=await api('/api/chat/global',{question,chatId:id},'POST',false);chat=answer.chat;await refresh()}
   if(requestEpoch===epoch.current&&active.current===id){loaded.current=id;setLatestReplyId(chat.messages.at(-1)?.id||null);setMessages(chat.messages)}return true;
  }catch(e){if(requestEpoch===epoch.current){setError(e.message);if(e.status===409){setMessages([]);loaded.current=null}await refresh().catch(()=>{})}return false}finally{pendingChat.current=null;busy.current=false;setTyping(false)}
 }
 async function remove(id:string){try{if(!demo)await api('/api/chats/'+encodeURIComponent(id),undefined,'DELETE',false);else localStorage.setItem(demoKey,JSON.stringify(JSON.parse(localStorage.getItem(demoKey)||'[]').filter(c=>c.id!==id)));await refresh();if(pinned===id)pin(null);if(routeId===id)go('chat');notify('Чат удалён.')}catch(e){notify(e.message)}}
 return {chats,messages,setMessages,typing,error,loading,ask,remove,activeId:routeId,pin,latestReplyId:loaded.current===activeId?latestReplyId:null,newChat:()=>go('chat'),refresh};
}
