import type {Study} from '../app/types.ts';
import {overviewSources} from './overview-evidence.ts';

interface FindingHint{studyId:string;segmentId:string;evidence?:string[];title:string;kind?:string;status?:string;importance?:string;origin?:string}
interface EvidenceCoverage{materials:number;included:number;fragments:number;totalFragments:number;sampled:boolean;linkedFragments?:number;includedLinkedFragments?:number;strategy?:string;sourceBudget?:number;characters?:number;maxCharacters?:number;repeatedMaterials?:number;scopeExcluded?:number}
const STOP=new Set(['каки','како','кака','как','что','это','этот','ест','есть','был','были','было','мне','нам','нас','топ','очен','сфор','коро','конк','поль','учас','респ','иссл','инте','мате','фраг','расс','пожа','стал','осно','глав','опиш']);
const ISSUE=new Set(['проб','ошиб','труд','барь','неуд']);
const SCOPE=new Set(['суто','серв','наш','наше','всех','всем','все','дай','обзо','общ','сост','найд','повт']);
const FACETS=new Set(['чат','отве','хозя','опла','пред','плат','бону','кэшб','кешб','филь','карт','гале','отме','цен','увед','брон','пере']);
const normal=(text:string)=>String(text||'').toLocaleLowerCase('ru').replace(/ё/g,'е');
/** Small lexical stems, not semantic search: match ответ/ответом and хозяин/хозяйка. */
const stems=(text:string)=>new Set((normal(text).match(/[\p{L}\p{N}]{3,}/gu)||[]).map(w=>w.replace(/(?:ами|ями|ого|его|ому|ему|ов|ев|ах|ях|ая|яя|ые|ие|ый|ий|ой|ы|и|а|я|у|ю|е|о|ь)$/u,'').slice(0,4)).filter(w=>w.length>=3&&!STOP.has(w)));
const hits=(haystack:Set<string>,query:Set<string>)=>[...query].filter(term=>haystack.has(term)).length;
const questionLike=(source:{text:string;speaker?:string})=>/модератор|интервьюер/i.test((source.speaker||'')+' '+source.text.slice(0,120))||source.text.includes('?');
const importance:Record<string,number>={'Критично':4,'Высокая':3,'Средняя':2,'Низкая':1};

/** Findings rank originals; only reviewed titles with selected original links become interpretation context. */
export function selectEvidence(studies:Study[],question:string,scope='all',hints:FindingHint[]=[]){
 const eligible=studies.filter(s=>(scope==='all'||scope===s.id)&&s.status==='ready'&&s.segments?.length);
 const terms=stems(question),specific=new Set([...stems(question.replace(/(?:сервис|продукт|платформ)[а-яё]*/giu,''))].filter(term=>!ISSUE.has(term)&&!SCOPE.has(term)));
 const broadIssue=/проблем|ошиб|трудност|барьер|неудобств/i.test(question)&&(!specific.size||/(?:топ|top)\s*[-–]?\s*\d+/i.test(question)&&![...specific].some(term=>FACETS.has(term)));
 const overview=!terms.size||broadIssue||/основн\S* (иде|мысл|вывод)|инсайт|итог|обзор|резюм|что.{0,16}(узнал|нашл|выясн)|проблем\S* повтор|осталось невыясн|общ\S* (информац|вывод|картин)|все\S* (исследован|проект)|что.{0,10}исследова/i.test(question);
 const boosts=new Map<string,number>();
 const linkedHints:{boost:number;keys:string[];title:string;status?:string}[]=[];
 for(const hint of hints){
  if(hint.status==='rejected'||hint.origin==='import')continue;
  const matched=hits(stems(hint.title),specific)+(broadIssue&&hint.kind==='Проблема'?1:0);if(!matched)continue;
  const boost=30+10*matched+(hint.status==='verified'?20:0)+(importance[hint.importance||'']||0);
  const keys=[...new Set([hint.segmentId,...hint.evidence||[]])].map(id=>hint.studyId+'\0'+id);
  linkedHints.push({boost,keys,title:hint.title,status:hint.status});
  for(const key of keys)boosts.set(key,Math.max(boosts.get(key)||0,boost));
 }
 const groups=eligible.map(study=>{const titleScore=2*hits(stems(study.title),terms);return study.segments.map(segment=>{
  const text=segment.correctedText??segment.text,key=study.id+'\0'+segment.id;
  return {...segment,studyId:study.id,title:study.title,text,score:10*hits(stems(text),terms)+titleScore+(boosts.get(key)||0)};
 })});
 if(overview){
  const chosen=overviewSources(groups,eligible,linkedHints,broadIssue,question),sources=chosen.sources;
  const numbers=new Map(sources.map((source,index)=>[source.studyId+'\0'+source.id,index+1]));
  const availableKeys=new Set(groups.flatMap(group=>group.map(source=>source.studyId+'\0'+source.id)));
  const relevant=linkedHints.filter(hint=>hint.status==='verified'&&hint.keys.filter(key=>availableKeys.has(key)).every(key=>numbers.has(key))).sort((a,b)=>b.boost-a.boost).map(hint=>({title:hint.title.trim().slice(0,160),sourceNumbers:hint.keys.map(key=>numbers.get(key)).filter((n):n is number=>n!==undefined)})).filter(hint=>hint.title&&hint.sourceNumbers.length);
  // Interpretation context follows selected source order instead of the largest project's order.
  const reviewedFindings:typeof relevant=[];for(let number=1;number<=sources.length;number++)for(const hint of relevant)if(hint.sourceNumbers.includes(number)&&!reviewedFindings.includes(hint)&&reviewedFindings.length<(broadIssue?24:6))reviewedFindings.push(hint);
  const linkedKeys=new Set(linkedHints.flatMap(hint=>hint.keys).filter(key=>availableKeys.has(key)));
  const coverage:EvidenceCoverage={materials:eligible.length,included:new Set(sources.map(s=>s.studyId)).size,fragments:sources.length,totalFragments:groups.reduce((n,g)=>n+g.length,0),sampled:true,strategy:'diverse-overview-v2',sourceBudget:chosen.limit,characters:chosen.characters,maxCharacters:chosen.maxCharacters,repeatedMaterials:chosen.repeatedMaterials,scopeExcluded:chosen.scopeExcluded,...(linkedKeys.size?{linkedFragments:linkedKeys.size,includedLinkedFragments:sources.filter(s=>linkedKeys.has(s.studyId+'\0'+s.id)).length}:{})};
  return{sources,reviewedFindings,coverage};
 }
 type Source=typeof groups[number][number];
 const byKey=new Map(groups.flat().map(source=>[source.studyId+'\0'+source.id,source]));
 // A finding may point to several distant excerpts. Reserve those exact originals before
 // question/answer windows: two windows from one top study can miss the actual event.
 const relevant=linkedHints.sort((a,b)=>b.boost-a.boost).map(hint=>({boost:hint.boost,sources:hint.keys.map(key=>byKey.get(key)).filter((source):source is Source=>Boolean(source))})).filter(hint=>hint.sources.length);
 const linked=groups.map(group=>{
  const hints=relevant.filter(hint=>hint.sources[0].studyId===group[0].studyId),originals:Source[]=[];
  // Keep each finding together: many weaker primary quotes must not displace its late evidence.
  for(const hint of hints)originals.push(...hint.sources);
  return {boost:hints[0]?.boost||0,sources:[...new Map(originals.map(source=>[source.id,source])).values()]};
 }).filter(plan=>plan.sources.length).sort((a,b)=>b.boost-a.boost).map(plan=>plan.sources);
 const linkedKeys=new Set(linked.flat().map(source=>source.studyId+'\0'+source.id));
 const sources:Source[]=[],seen=new Set<string>(),limit=overview?24:Math.max(12,Math.min(24,linkedKeys.size));
 const window=(group:Source[],index:number)=>{
  const anchor=group[index],indices=new Set([index]);
  if(boosts.has(anchor.studyId+'\0'+anchor.id)){
   if(index>0)indices.add(index-1);if(index+1<group.length)indices.add(index+1);
  }else if(questionLike(anchor)){
   let response=index+1;
   if(anchor.speaker&&!/документ|запись/i.test(anchor.speaker))for(let next=index+1;next<Math.min(group.length,index+12);next++)if(group[next].speaker&&group[next].speaker!==anchor.speaker){response=next;break}
   if(response<group.length){indices.add(response);if(questionLike(group[response])&&response+1<group.length)indices.add(response+1)}
  }else if(anchor.text.length>180&&/^[а-яё]/u.test(anchor.text)&&index>0)indices.add(index-1);
  return [...indices].sort((a,b)=>a-b).map(i=>group[i]);
 };
 const plans=groups.map(group=>{
  const ranked=group.map((source,index)=>({source,index})).filter(x=>x.source.score>0).sort((a,b)=>b.source.score-a.source.score||Number(questionLike(a.source))-Number(questionLike(b.source))||a.index-b.index);
  const hinted=ranked.filter(x=>boosts.has(x.source.studyId+'\0'+x.source.id)).map(x=>x.index);
  if(!overview)return {score:ranked[0]?.source.score||0,hinted:hinted.length>0,windows:ranked.slice(0,12).map(x=>window(group,x.index))};
  const perStudy=Math.min(group.length,Math.max(1,Math.floor(24/Math.max(groups.length,1))));
  const spread=Array.from({length:perStudy},(_,i)=>Math.floor(i*group.length/perStudy));
  // Keep both early and late excerpts even when question/answer context takes extra slots.
  const edges:number[]=[];while(spread.length){edges.push(spread.shift()!);if(spread.length)edges.push(spread.pop()!)}
  return {score:ranked[0]?.source.score||0,hinted:hinted.length>0,windows:[...new Set([...hinted,...edges])].map(index=>window(group,index))};
 }).filter(plan=>plan.windows.length);
 if(!overview||broadIssue)plans.sort((a,b)=>b.score-a.score);
 const add=(items:Source[]=[])=>{
  const fresh=items.filter(source=>!seen.has(source.studyId+'\0'+source.id));
  const room=limit-sources.length;const chosen=fresh.length>room?[...fresh.filter(s=>!questionLike(s)),...fresh.filter(questionLike)].slice(0,room):fresh;
  for(const source of chosen){seen.add(source.studyId+'\0'+source.id);sources.push(source)}
 };
 // Interleave materials and their findings so one interview cannot take every linked slot.
 for(let round=0;sources.length<limit&&linked.some(items=>items[round]);round++)for(const items of linked){
  if(sources.length>=limit)break;if(items[round])add([items[round]]);
 }
 for(let round=0;sources.length<limit&&plans.some(p=>p.windows[round]);round++)for(const plan of plans){
  if(sources.length>=limit)break;add(plan.windows[round]);
 }
 const selectedNumbers=new Map(sources.map((source,index)=>[source.studyId+'\0'+source.id,index+1]));
 // A reviewed interpretation is never substituted for a raw quote. Every supplied
 // number must refer to an already selected original of this exact scoped study.
 const reviewedFindings=linkedHints.filter(hint=>hint.status==='verified').map(hint=>({title:hint.title.trim().slice(0,160),sourceNumbers:hint.keys.map(key=>selectedNumbers.get(key)).filter((number):number is number=>number!==undefined)})).filter(hint=>hint.title&&hint.sourceNumbers.length).slice(0,6);
 const totalFragments=groups.reduce((n,g)=>n+g.length,0);
 const coverage:EvidenceCoverage={materials:eligible.length,included:new Set(sources.map(s=>s.studyId)).size,fragments:sources.length,totalFragments,sampled:overview||sources.length<totalFragments,...(linkedKeys.size?{linkedFragments:linkedKeys.size,includedLinkedFragments:sources.filter(source=>linkedKeys.has(source.studyId+'\0'+source.id)).length}:{})};
 return {sources,reviewedFindings,coverage};
}
