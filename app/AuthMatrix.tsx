import {useEffect,useRef} from 'react';
import {createRain} from './vendor/matrix/matrix-rain.js';

/** Decorative login background; the form and keyboard focus remain independent. */
export default function AuthMatrix({theme}:{theme:string}){
 const canvas=useRef<HTMLCanvasElement>(null);
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
  return ()=>effect.destroy();
 },[theme]);
 return <canvas ref={canvas} className="auth-matrix" aria-hidden="true"/>;
}
