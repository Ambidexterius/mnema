import React,{useEffect,useRef,useState} from 'react';
import {Button,Tooltip} from '@gravity-ui/uikit';
import {Check,Copy,ThumbsDown,ThumbsUp} from 'lucide-react';
import {api} from './api.ts';

type Rating='up'|'down'|null;
export default function AnswerActions({message,notify,onRated,children}:{
  message:{answer:string;feedbackToken?:string;rating?:Rating};
  notify:(message:string)=>void;
  onRated:(rating:Rating)=>void;
  children?:React.ReactNode;
}){
  const lock=useRef(false);
  const [busy,setBusy]=useState(false);
  const [copied,setCopied]=useState(false);
  useEffect(()=>{
    if(!copied)return;
    const timer=setTimeout(()=>setCopied(false),1800);
    return ()=>clearTimeout(timer);
  },[copied]);
  async function rate(value:Exclude<Rating,null>){
    if(lock.current)return;
    lock.current=true;setBusy(true);
    const rating=message.rating===value?null:value;
    try{
      await api('/api/chat/feedback',{token:message.feedbackToken,rating},'POST',false);
      onRated(rating);
    }catch{notify('Не удалось сохранить оценку. Попробуйте ещё раз.')}
    finally{lock.current=false;setBusy(false)}
  }
  async function copy(){
    try{await navigator.clipboard.writeText(message.answer);setCopied(true);notify('Ответ скопирован.')}
    catch{notify('Выделите ответ и скопируйте его вручную.')}
  }
  return <div className="answer-actions">
    <Tooltip content="Скопировать ответ"><Button view="flat" size="m" aria-label="Скопировать ответ" onClick={copy}>{copied?<Check size={16}/>:<Copy size={16}/>}</Button></Tooltip>
    {message.feedbackToken&&([['up','Полезный ответ',ThumbsUp],['down','Неполезный ответ',ThumbsDown]] as const).map(([value,label,Icon])=>
      <Tooltip key={value} content={label}><Button view="flat" size="m" selected={message.rating===value} disabled={busy} aria-label={label} aria-pressed={message.rating===value} onClick={()=>rate(value)}><Icon size={16}/></Button></Tooltip>)}
    {children}
  </div>;
}
