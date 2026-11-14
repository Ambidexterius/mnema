import React,{useEffect,useId,useState} from 'react';

export type MascotMood='idle'|'listening'|'thinking'|'happy'|'puzzled'|'sad';

// Mnemonika's agent: the brand mark extruded into a small 3D body (stacked slices + CSS preserve-3d).
// Front: four overlapping petals with the face. Back: the logo itself, so a full turn reveals it.
// Poses and motion live in gravity.css (.mascot-*); everything stops under reduced motion.
const PETALS=[
 ['tl','M30 25C30 27.76 27.76 30 25 30L0 30L0 25C0 11.19 11.19 0 25 0L30 0Z'],
 ['tr','M39 0C52.81 0 64 11.19 64 25L64 30L39 30C36.24 30 34 27.76 34 25L34 0Z'],
 ['bl','M25 34C27.76 34 30 36.24 30 39L30 64L25 64C11.19 64 0 52.81 0 39L0 34Z'],
 ['br','M64 64L34 64L34 39C34 36.24 36.24 34 39 34L64 34Z'],
] as const;
const SILHOUETTE='M25 0H39C52.81 0 64 11.19 64 25V64H25C11.19 64 0 52.81 0 39V25C0 11.19 11.19 0 25 0Z';
// Front petals overlap 3.5 units inward at rest, so slices and the back logo use the same inset outline.
const INSET='translate(3.5 3.5) scale(.890625)';
const DEPTH=[-4,-3,-2,-1,0,1,2,3]; // slice offsets in 1/64 of the size
const EYES=[[21,22],[39,21]] as const;
const INK='#2b1218';

// While a live agent rests it now and then shows a short emotion, so it never freezes after an answer.
const MOMENTS:MascotMood[]=['happy','puzzled','listening'];

export default function Mascot({mood:asked='idle',size=20,live=false}:{mood?:MascotMood;size?:number;live?:boolean}){
 const id='m'+useId().replace(/[^a-z0-9]/gi,''),fill=`url(#${id}f)`;
 const [settled,setSettled]=useState(false),[moment,setMoment]=useState<MascotMood|null>(null);
 // The joy of a new answer lasts 2.6 s, then the agent calms down into its live rest.
 useEffect(()=>{setSettled(false);if(!live||asked!=='happy')return;const t=setTimeout(()=>setSettled(true),2600);return()=>clearTimeout(t)},[live,asked]);
 const base=settled?'idle':asked;
 useEffect(()=>{
  if(!live||base!=='idle'||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  let t=0;const next=()=>{t=window.setTimeout(()=>{setMoment(MOMENTS[Math.floor(Math.random()*MOMENTS.length)]);t=window.setTimeout(()=>{setMoment(null);next()},1800)},8000+Math.random()*6000)};
  next();return()=>{clearTimeout(t);setMoment(null)};
 },[live,base]);
 const mood=moment||base;
 const layer=(z:number,children:React.ReactNode,cls='')=><svg key={z+cls} className={'mascot-layer '+cls} style={{transform:`translateZ(calc(var(--u) * ${z}))`}} viewBox="-4 -4 72 72">{children}</svg>;
 const eye=([x,y]:readonly [number,number],i:number)=>{
  if(mood==='happy')return <path key={i} d={`M${x-5} ${y+2}Q${x} ${y-6} ${x+5} ${y+2}`} fill="none" stroke={INK} strokeWidth="3.6" strokeLinecap="round"/>;
  const ry=mood==='puzzled'&&i===1?4.8:8,cy=mood==='puzzled'&&i===1?y+1.4:y;
  return <g key={i} className="mascot-eye">
   <clipPath id={id+'e'+i}><ellipse cx={x} cy={cy} rx={4.8} ry={ry}/></clipPath>
   <ellipse cx={x} cy={cy} rx={4.8} ry={ry} fill={INK}/>
   <circle cx={x-1.6} cy={cy-ry/2} r={1.6} fill="#fff" opacity=".9"/>
   {mood==='sad'?<path d={i===0?`M${x-6} ${y-10}H${x+6}L${x-6} ${y-1}Z`:`M${x+6} ${y-10}H${x-6}L${x+6} ${y-1}Z`} fill="#f04a6c" clipPath={`url(#${id}e${i})`}/>:null}
  </g>;
 };
 return <span className="mascot" data-mood={mood} data-live={live||undefined} style={{'--u':size/64+'px',width:size,height:size} as React.CSSProperties} aria-hidden="true">
  <span className="mascot-figure"><span className="mascot-spin">
   {layer(-5,<g className="mascot-logo" transform={INSET}>{PETALS.map(([k,d])=><path key={k} d={d}/>)}</g>,'mascot-back')}
   {DEPTH.map(z=>layer(z,<path d={SILHOUETTE} transform={INSET}/>,'mascot-slice'))}
   {layer(4,<>
    <defs>
     <linearGradient id={id+'f'} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#ff7792"/><stop offset="1" stopColor="#ee204d"/></linearGradient>
     <filter id={id+'g'} x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="7" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0.35 0 0 0 0 0.05 0 0 0 0 0.12 0 0 0 0.5 -0.12" result="t"/><feComposite in="t" in2="SourceGraphic" operator="in" result="c"/><feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="c"/></feMerge></filter>
    </defs>
    <g fill={fill} filter={`url(#${id}g)`}>{PETALS.map(([k,d])=><path key={k} className={'mascot-petal mascot-petal-'+k} d={d}/>)}</g>
   </>,'mascot-front')}
   {layer(5.5,<g className="mascot-face" key={mood}>{EYES.map(eye)}</g>,'mascot-face-layer')}
  </span></span>
 </span>;
}
