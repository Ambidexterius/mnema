import {useEffect,useRef} from 'react';
import {createRain} from './vendor/matrix/matrix-rain.js';

/** Decorative login background; the form and keyboard focus remain independent. */
export default function AuthMatrix({theme,paused}:{theme:string;paused:boolean}){
 const canvas=useRef<HTMLCanvasElement>(null);
 const rain=useRef<ReturnType<typeof createRain>|null>(null);
 const pausedRef=useRef(paused);
 const runningPaused=useRef(false);
 pausedRef.current=paused;
 useEffect(()=>{
  const element=canvas.current;
  if(!element?.getContext('2d'))return;
  const colors=getComputedStyle(element);
  const effect=createRain(element,{
   color:colors.getPropertyValue('--g-color-text-primary').trim(),
   glowColor:colors.getPropertyValue('--g-color-base-brand').trim(),
   fontSize:12,lineHeight:20,density:0.8,interval:90,speed:0.6,
   opacity:1,mask:false,radius:140,glowBrightness:1,
   characters:'МНЕМОНИКАИССЛЕДОВАНИЯ0123456789<>+=*',
  });
  rain.current=effect;
  runningPaused.current=pausedRef.current;
  if(runningPaused.current)effect.pause();
  return()=>{effect.destroy();rain.current=null};
 },[theme]);
 useEffect(()=>{
  const effect=rain.current;
  if(effect&&runningPaused.current!==paused){
   runningPaused.current=effect.pause();
  }
 },[paused]);
 return <canvas ref={canvas} className="auth-matrix" aria-hidden="true"/>;
}
