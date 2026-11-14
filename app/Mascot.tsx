import React,{useEffect,useId,useRef,useState} from 'react';

export type MascotMood='idle'|'listening'|'thinking'|'happy'|'puzzled'|'sad'|'surprised'|'love'|'shy'|'angry'|'dizzy'|'sleepy'|'wink';

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
const MOMENTS:MascotMood[]=['happy','puzzled','listening','wink','surprised'];
// Reactions that pass: after 2.6 s the agent calms down into rest.
const TRANSIENT:MascotMood[]=['happy','love','shy','surprised','wink'];
const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function Mascot({mood:asked='idle',size=20,live=false}:{mood?:MascotMood;size?:number;live?:boolean}){
 const id='m'+useId().replace(/[^a-z0-9]/gi,''),fill=`url(#${id}f)`,root=useRef<HTMLSpanElement>(null);
 const [settled,setSettled]=useState(false),[moment,setMoment]=useState<MascotMood|null>(null);
 useEffect(()=>{setSettled(false);if(!TRANSIENT.includes(asked))return;const t=setTimeout(()=>setSettled(true),2600);return()=>clearTimeout(t)},[asked]);
 const base=settled?'idle':asked;
 // Live rest: random moments, eyes follow the pointer, dozes off after 45 s of no activity and startles awake.
 useEffect(()=>{
  if(!live||base!=='idle'||reduced())return;
  let t=0,quiet=0,asleep=false;
  const show=(m:MascotMood,ms:number,then:()=>void)=>{setMoment(m);t=window.setTimeout(()=>{setMoment(null);then()},ms)};
  const next=()=>{t=window.setTimeout(()=>show(MOMENTS[Math.floor(Math.random()*MOMENTS.length)],1800,next),8000+Math.random()*6000)};
  const doze=()=>{clearTimeout(quiet);quiet=window.setTimeout(()=>{clearTimeout(t);asleep=true;setMoment('sleepy')},45000)};
  const gaze=(e:PointerEvent)=>{const el=root.current;if(!el||!matchMedia('(hover: hover)').matches)return;const r=el.getBoundingClientRect(),dx=e.clientX-r.left-r.width/2,dy=e.clientY-r.top-r.height/2,d=Math.hypot(dx,dy)||1,k=Math.min(1,d/240)*3.5;el.style.setProperty('--gx',(dx/d*k).toFixed(2)+'px');el.style.setProperty('--gy',(dy/d*k).toFixed(2)+'px')};
  const wake=(e:Event)=>{if(e instanceof PointerEvent)gaze(e);if(asleep){asleep=false;clearTimeout(t);show('surprised',900,next)}doze()};
  next();doze();addEventListener('pointermove',wake);addEventListener('keydown',wake);
  return()=>{clearTimeout(t);clearTimeout(quiet);removeEventListener('pointermove',wake);removeEventListener('keydown',wake);setMoment(null);root.current?.style.removeProperty('--gx');root.current?.style.removeProperty('--gy')};
 },[live,base]);
 // A poke on a live agent: it giggles with love eyes for a moment.
 const poke=()=>{if(!live||reduced())return;setMoment('love');window.setTimeout(()=>setMoment(null),1400)};
 const mood=moment||base;
 // Cross-fade faces: the previous one fades out for 180 ms while the new one fades in (see .mascot-swap).
 const [prev,setPrev]=useState<MascotMood|null>(null),shownRef=useRef(mood);
 useEffect(()=>{if(shownRef.current===mood)return;setPrev(shownRef.current);shownRef.current=mood;const t=setTimeout(()=>setPrev(null),180);return()=>clearTimeout(t)},[mood]);
 const layer=(z:number,children:React.ReactNode,cls='')=><svg key={z+cls} className={'mascot-layer '+cls} style={{transform:`translateZ(calc(var(--u) * ${z}))`}} viewBox="-4 -4 72 72">{children}</svg>;
 const brow=(x:number,y:number,i:number,tilt:number)=>{const d=i?-1:1;return <path key={'b'+i} d={`M${x-5.5} ${y-12+tilt*d}L${x+5.5} ${y-12-tilt*d}`} stroke={INK} strokeWidth="2.6" strokeLinecap="round"/>};
 const arc=(x:number,y:number,up:boolean,i:number)=><path key={i} d={up?`M${x-5} ${y+2}Q${x} ${y-6} ${x+5} ${y+2}`:`M${x-5} ${y-1}Q${x} ${y+5} ${x+5} ${y-1}`} fill="none" stroke={INK} strokeWidth="3.6" strokeLinecap="round"/>;
 const open=(x:number,y:number,i:number,rx=4.8,ry=8,sad=false)=><g key={i} className="mascot-eye">
  <clipPath id={id+'e'+i}><ellipse cx={x} cy={y} rx={rx} ry={ry}/></clipPath>
  <ellipse cx={x} cy={y} rx={rx} ry={ry} fill={INK}/>
  <circle cx={x-1.6} cy={y-ry/2} r={1.6} fill="#fff" opacity=".9"/>
  {sad?<path d={i===0?`M${x-6} ${y-10}H${x+6}L${x-6} ${y-1}Z`:`M${x+6} ${y-10}H${x-6}L${x+6} ${y-1}Z`} fill="var(--m-lid)" clipPath={`url(#${id}e${i})`}/>:null}
 </g>;
 const heart=(x:number,y:number,i:number)=><path key={i} className="mascot-heart" d={`M${x} ${y+6}C${x-9} ${y-1} ${x-6} ${y-9} ${x} ${y-4}C${x+6} ${y-9} ${x+9} ${y-1} ${x} ${y+6}Z`} fill="var(--m-heart)"/>;
 const cross=(x:number,y:number,i:number)=><path key={i} d={`M${x-4.5} ${y-4.5}L${x+4.5} ${y+4.5}M${x+4.5} ${y-4.5}L${x-4.5} ${y+4.5}`} stroke={INK} strokeWidth="3.2" strokeLinecap="round"/>;
 const blush=EYES.map(([x,y],i)=><ellipse key={'c'+i} cx={x+(i?2:-2)} cy={y+11} rx={4.6} ry={2.4} fill="var(--m-blush)" opacity=".85"/>);
 const mouth=(d:string)=><path key="m" d={d} fill="none" stroke={INK} strokeWidth="2.4" strokeLinecap="round"/>;
 // Each mood is eyes + optional brows, mouth and blush; mouth sits between the eyes at y≈35.
 const face=(mood:MascotMood):React.ReactNode=>{
  const each=(f:(x:number,y:number,i:number)=>React.ReactNode)=>EYES.map(([x,y],i)=>f(x,y,i));
  switch(mood){
   case 'happy':return [...each((x,y,i)=>arc(x,y,true,i)),mouth('M25 34Q30 39 35 34')];
   case 'wink':return [open(EYES[0][0],EYES[0][1],0),arc(EYES[1][0],EYES[1][1],true,1),mouth('M26 35Q31 38 35 34')];
   case 'love':return [...blush,...each(heart),mouth('M25 34Q30 39 35 34')];
   case 'shy':return [...blush,...each((x,y,i)=>arc(x,y+2,false,i)),mouth('M27 37Q29 35 31 37Q33 39 35 37')];
   case 'surprised':return [...each((x,y,i)=>open(x,y,i,5.6,5.6)),...each((x,y,i)=>brow(x,y+1,i,0)),<ellipse key="m" cx={30} cy={37} rx={2.8} ry={3.4} fill={INK}/>];
   case 'angry':return [...each((x,y,i)=>open(x,y+1,i,4.6,6.6)),...each((x,y,i)=>brow(x,y+3,i,-2.6)),mouth('M26 37H34')];
   case 'sad':return [...each((x,y,i)=>open(x,y,i,4.8,8,true)),...each((x,y,i)=>brow(x,y,i,2.2)),mouth('M26 38Q30 34 34 38')];
   case 'dizzy':return [...each(cross),mouth('M24 37Q26 35 28 37Q30 39 32 37Q34 35 36 37')];
   case 'sleepy':return [...each((x,y,i)=>arc(x,y,false,i)),<text key="z" className="mascot-z" x="46" y="8" fontSize="11" fontWeight="700" fill="var(--m-z)">z</text>];
   case 'puzzled':return [open(EYES[0][0],EYES[0][1],0),open(EYES[1][0],EYES[1][1]+1.4,1,4.8,4.8),brow(EYES[0][0],EYES[0][1]+2,0,-1.5)];
   default:return each((x,y,i)=>open(x,y,i));
  }
 };
 return <span ref={root} onClick={poke} className="mascot" data-mood={mood} data-live={live||undefined} style={{'--u':size/64+'px',width:size,height:size} as React.CSSProperties} aria-hidden="true">
  <span className="mascot-figure"><span className="mascot-sway"><span className="mascot-spin">
   {layer(-5,<g className="mascot-logo" transform={INSET}>{PETALS.map(([k,d])=><path key={k} d={d}/>)}</g>,'mascot-back')}
   {DEPTH.map(z=>layer(z,<path d={SILHOUETTE} transform={INSET}/>,'mascot-slice'))}
   {layer(4,<>
    <defs>
     <linearGradient id={id+'f'} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse"><stop offset="0" style={{stopColor:'var(--m-top)'}}/><stop offset="1" style={{stopColor:'var(--m-bottom)'}}/></linearGradient>
     <filter id={id+'g'} x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="7" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0.35 0 0 0 0 0.05 0 0 0 0 0.12 0 0 0 0.5 -0.12" result="t"/><feComposite in="t" in2="SourceGraphic" operator="in" result="c"/><feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="c"/></feMerge></filter>
    </defs>
    <g fill={fill} filter={`url(#${id}g)`}>{PETALS.map(([k,d])=><path key={k} className={'mascot-petal mascot-petal-'+k} d={d}/>)}</g>
   </>,'mascot-front')}
   {layer(5.5,<g className="mascot-gaze"><g className="mascot-glance"><g className="mascot-face">{prev?<g className="mascot-swap mascot-out" key={'o'+prev}>{face(prev)}</g>:null}<g className="mascot-swap mascot-in" key={mood}>{face(mood)}</g></g></g></g>,'mascot-face-layer')}
  </span></span></span>
 </span>;
}
