import React,{useEffect,useState} from 'react';
import {Sparkle} from 'lucide-react';

// Stars variant reference: https://www.boardui.com/components/agent-thinking
// Original CSS/Lucide implementation; elapsed time is real waiting time, not progress.
export default function ThinkingIndicator(){
 const [seconds,setSeconds]=useState(0);
 useEffect(()=>{const started=Date.now();const timer=setInterval(()=>setSeconds(Math.floor((Date.now()-started)/1000)),1000);return()=>clearInterval(timer)},[]);
 return <div className="thinking-indicator" role="status" aria-live="polite">
  <span className="thinking-stars" aria-hidden="true">{[0,1,2,3,4].map(index=><Sparkle key={index} className={'thinking-star thinking-star-'+index} fill="currentColor" strokeWidth={0}/>)}</span>
  <span className="thinking-label">Готовлю ответ…</span>
  <span className="thinking-elapsed" aria-hidden="true">{seconds} с</span>
 </div>;
}
