import type {Study} from '../app/types.ts';

/** Balanced evidence for project questions; a summary is a sample, never a claim to cover every word. */
export function selectEvidence(studies:Study[],question:string,scope='all'){
 const eligible=studies.filter(s=>(scope==='all'||scope===s.id)&&s.status==='ready'&&s.segments?.length);
 const overview=/основн\S* (иде|мысл|вывод)|инсайт|итог|что.{0,16}(узнал|нашл|выясн)|проблем\S* повтор|осталось невыясн|общ\S* (информац|вывод|картин)|все\S* (исследован|проект)|что.{0,10}исследова/i.test(question);
 const terms=question.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)||[];
 const groups=eligible.map(s=>(s.segments||[]).map(seg=>({studyId:s.id,title:s.title,...seg,text:seg.correctedText??seg.text,score:terms.filter(t=>(s.title+' '+(seg.correctedText??seg.text)).toLowerCase().includes(t)).length})));
 let sources:typeof groups[number]=[];
 if(overview){
  // Spread the excerpts over each recording instead of taking only the opening.
  const perStudy=Math.max(1,Math.floor(24/Math.max(groups.length,1)));
  const spread=groups.map(g=>Array.from({length:Math.min(g.length,perStudy)},(_,i)=>g[Math.floor(i*g.length/Math.min(g.length,perStudy))]));
  for(let i=0;sources.length<24&&spread.some(g=>g[i]);i++)for(const group of spread)if(group[i]&&sources.length<24)sources.push(group[i]);
 }else sources=groups.flat().filter(s=>s.score>0).sort((a,b)=>b.score-a.score).slice(0,12);
 return {sources,coverage:{materials:eligible.length,included:new Set(sources.map(s=>s.studyId)).size,fragments:sources.length,totalFragments:groups.reduce((n,g)=>n+g.length,0),sampled:overview}};
}
