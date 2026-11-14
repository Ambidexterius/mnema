import React,{useEffect,useState} from 'react';
import Mascot from './Mascot.tsx';

// The steps every answer goes through; they rotate by time, not by real server progress.
// After the first pass the last four repeat, so a long answer never claims to be "reading the question" again.
const STEPS=['Читаю вопрос','Ищу в исследованиях','Перечитываю интервью','Сверяю цитаты','Собираю находки','Проверяю источники','Формулирую ответ'];
const step=(seconds:number)=>{const i=Math.floor(seconds/3);return STEPS[i<STEPS.length?i:3+(i-STEPS.length)%4]};
const elapsed=(s:number)=>s<60?s+' с':Math.floor(s/60)+' мин '+s%60+' с';

// Elapsed time is real waiting time, not progress.
export default function ThinkingIndicator(){
 const [seconds,setSeconds]=useState(0);
 useEffect(()=>{const started=Date.now();const timer=setInterval(()=>setSeconds(Math.floor((Date.now()-started)/1000)),1000);return()=>clearInterval(timer)},[]);
 const label=step(seconds);
 return <div className="thinking-indicator">
  <span className="sr-only" role="status">Готовлю ответ</span>
  <Mascot mood="thinking"/>
  <span className="thinking-label" key={label} aria-hidden="true">{label}…</span>
  <span className="thinking-elapsed" aria-hidden="true">{elapsed(seconds)}</span>
 </div>;
}
