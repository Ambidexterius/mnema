import React,{useEffect,useRef,useState} from 'react';

export type MascotMood='idle'|'listening'|'thinking'|'happy'|'puzzled'|'sad'|'surprised'|'love'|'shy'|'angry'|'dizzy'|'sleepy'|'wink';

// Keep the existing chat reactions, using the supplied duck poses.
const POSES:Record<MascotMood,string>={idle:'idle',listening:'listening',thinking:'thinking',happy:'joy',puzzled:'question',sad:'error',surprised:'surprise',love:'love',shy:'calm',angry:'error',dizzy:'error',sleepy:'calm',wink:'wink'};

// While a live agent rests it now and then shows a short emotion, so it never freezes after an answer.
const MOMENTS:MascotMood[]=['happy','puzzled','listening','wink','surprised'];
// Reactions that pass: after 2.6 s the agent calms down into rest.
const TRANSIENT:MascotMood[]=['happy','love','shy','surprised','wink'];
const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function Mascot({mood:asked='idle',size=20,live=false}:{mood?:MascotMood;size?:number;live?:boolean}){
 const pokeTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 useEffect(()=>()=>clearTimeout(pokeTimer.current),[]);
 const [settled,setSettled]=useState(false),[moment,setMoment]=useState<MascotMood|null>(null);
 useEffect(()=>{setSettled(false);if(!TRANSIENT.includes(asked))return;const t=setTimeout(()=>setSettled(true),2600);return()=>clearTimeout(t)},[asked]);
 const base=settled?'idle':asked;
 // Live rest: random moments, dozes off after 45 s of no activity and startles awake.
 useEffect(()=>{
  if(!live||base!=='idle'||reduced())return;
  let t=0,quiet=0,asleep=false;
  const show=(m:MascotMood,ms:number,then:()=>void)=>{setMoment(m);t=window.setTimeout(()=>{setMoment(null);then()},ms)};
  const next=()=>{t=window.setTimeout(()=>show(MOMENTS[Math.floor(Math.random()*MOMENTS.length)],1800,next),8000+Math.random()*6000)};
  const doze=()=>{clearTimeout(quiet);quiet=window.setTimeout(()=>{clearTimeout(t);asleep=true;setMoment('sleepy')},45000)};
  const wake=()=>{if(asleep){asleep=false;clearTimeout(t);show('surprised',900,next)}doze()};
  next();doze();addEventListener('pointermove',wake);addEventListener('keydown',wake);
  return()=>{clearTimeout(t);clearTimeout(quiet);removeEventListener('pointermove',wake);removeEventListener('keydown',wake);setMoment(null)};
 },[live,base]);
 // A poke on a live agent: it giggles with love eyes for a moment.
 const poke=()=>{if(!live||reduced())return;clearTimeout(pokeTimer.current);setMoment('love');pokeTimer.current=setTimeout(()=>setMoment(null),1400)};
 const mood=moment||base;
 const pose=POSES[mood],assetSize=size<=20?10:56;
 const still=`/mnemoduck/static/${assetSize}/${pose}.svg`;
 const source=live||mood!=='idle'?`/mnemoduck/animated/${assetSize}/${pose}.svg`:still;
 return <picture className="mascot" data-mood={mood} data-live={live||undefined} onClick={poke} style={{width:size,height:size}} aria-hidden="true">
  <source media="(prefers-reduced-motion: reduce)" srcSet={still}/>
  <img src={source} alt="" width={size} height={size}/>
 </picture>;
}
