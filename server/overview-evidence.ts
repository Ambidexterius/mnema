import type {Study} from '../app/types.ts';
import {mentionedProducts,requestedProduct} from './product-scope.ts';

type Source={id:string;studyId:string;text:string;score:number;speaker?:string;page?:number;time?:number};
type Hint={boost:number;keys:string[];title:string;status?:string};
const normalized=(text:string)=>text.toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const words=(text:string)=>new Set(normalized(text).split(' ').filter(w=>w.length>3).map(w=>w.slice(0,5)));
const overlap=(a:Set<string>,b:Set<string>)=>!a.size||!b.size?0:[...a].filter(w=>b.has(w)).length/Math.min(a.size,b.size);
const problems=/непонят\w*|неудоб\w*|невозмож\w*|нельзя|ошиб\w*|сбо[ий]\w*|проблем\w*|сложн\w*|затруд\w*|меша\w*|теря\w*|пропус\w*|завис\w*|задерж\w*|долг\w*|ждал\w*|пришлось|не (?:мог\w*|мож\w*|работ\w*|приход\w*|поним\w*|вид\w*|получ\w*|загруж\w*|отображ\w*|наш\w*|хват\w*)/giu;

/** Overview sampling has its own budget: reports and every accessible project get a turn
 * before linked quotes can fill it. All returned text remains an unchanged original. */
export function overviewSources<T extends Source>(groups:T[][],studies:Study[],hints:Hint[],issueOnly:boolean,question=''){
 const limit=issueOnly?48:24,maxChars=issueOnly?36000:24000;
 const originals=new Map(groups.flatMap(group=>group.map(source=>[source.studyId+'\0'+source.id,source] as const)));
 const target=requestedProduct(question),excluded=new Set<string>();
 const foreign=(text:string)=>{const names=mentionedProducts(text);return Boolean(target&&names.length&&!names.includes(target))};
 if(target){
  for(const [key,source] of originals)if(foreign(source.text))excluded.add(key);
  // Carry explicit counterparty context across every original of a linked finding.
  for(const hint of hints){const packet=hint.keys.map(k=>originals.get(k)?.text||'').join('\n');if(foreign(packet))for(const k of hint.keys)excluded.add(k)}
 }
 const hintByKey=new Map<string,Hint>();for(const hint of hints)for(const key of hint.keys)if((hintByKey.get(key)?.boost||0)<hint.boost)hintByKey.set(key,hint);
 const key=(s:T)=>s.studyId+'\0'+s.id;
 const plans=groups.map((group,index)=>{
  const study=studies[index] as Study&{workspaceId?:string};
  const project=study.workspaceId||'project';
  const family=project+'\0'+(normalized(study.title.replace(/\.[a-z0-9]{2,5}$/i,'').replace(/\s*\(\d+\)\s*$/,''))||study.id);
  const report=study.type==='Отчёт'||study.report==='ready';
  const candidates=group.map((source,index)=>{
   const hint=hintByKey.get(key(source)),signals=new Set(source.text.match(problems)||[]).size;
   const moderator=/модератор|интервьюер/i.test(source.speaker||'');
   const intro=/^(?:содержание|план интервью|цели исследования|методология|титульный)/i.test(source.text.trim());
   const score=(hint?.boost||0)+Math.min(signals,6)*9+(report?24:0)+Math.min(source.text.length/80,10)-(moderator?70:source.text.includes('?')?10:0)-(intro?50:0);
   return{source,index,hint,signals,score,topic:words(hint?.title||source.text)};
  });
  // Uniform fallback is used only when there are no semantic hints or problem cues.
  const spread:number[]=[];for(let i=0;i<Math.min(12,group.length);i++)spread.push(Math.round(i*(group.length-1)/Math.max(1,Math.min(12,group.length)-1)));
  const ranked=candidates.filter(c=>!excluded.has(key(c.source))).sort((a,b)=>b.score-a.score||a.index-b.index);
  const informative=ranked.some(c=>c.hint||(issueOnly&&c.signals));
  const anchors=informative?ranked.slice(0,80):[...new Set([0,group.length-1,...spread])].map(i=>candidates[i]).filter(c=>!excluded.has(key(c.source)));
  return{group,study,project,family,report,candidates:anchors};
 });
 type Plan=typeof plans[number];type Candidate=Plan['candidates'][number];
 const projects=[...new Set(plans.filter(p=>p.candidates.length).map(p=>p.project))];
 const sources:T[]=[],seen=new Set<string>(),texts=new Set<string>(),chosen:{plan:Plan;candidate:Candidate}[]=[];
 const familyCounts=new Map<string,number>();let chars=0;
 const available=(plan:Plan,c:Candidate)=>!excluded.has(key(c.source))&&!seen.has(key(c.source))&&!texts.has(plan.family+'\0'+normalized(c.source.text))&&chars+c.source.text.length<=maxChars;
 const add=(plan:Plan,c:Candidate)=>{if(sources.length>=limit||!available(plan,c))return false;sources.push(c.source);seen.add(key(c.source));texts.add(plan.family+'\0'+normalized(c.source.text));chars+=c.source.text.length;familyCounts.set(plan.family,(familyCounts.get(plan.family)||0)+1);chosen.push({plan,candidate:c});return true};
 const pick=(project:string,reportsOnly=false)=>{
  let best:{plan:Plan;candidate:Candidate;value:number}|undefined;
  for(const plan of plans){if(plan.project!==project||(reportsOnly&&!plan.report))continue;
   for(const candidate of plan.candidates){if(!available(plan,candidate))continue;
    const similarity=Math.max(0,...chosen.filter(x=>x.plan.project===project).map(x=>overlap(x.candidate.topic,candidate.topic)));
    const familyUse=familyCounts.get(plan.family)||0;
    const nearby=chosen.some(x=>x.plan===plan&&Math.abs(x.candidate.index-candidate.index)<2);
    const value=candidate.score-similarity*45-familyUse*9-(nearby?12:0);
    if(!best||value>best.value)best={plan,candidate,value};
   }
  }
  return best&&add(best.plan,best.candidate);
 };
 // Reserve report coverage even in projects whose interview findings are numerous.
 const reportRounds=issueOnly?Math.min(4,Math.max(1,Math.floor(limit/Math.max(1,projects.length)/2))):1;
 for(let round=0;round<reportRounds&&sources.length<limit;round++)for(const project of projects)pick(project,true);
 // Projects without a report also get representation before any project gets more.
 for(const project of projects)if(!chosen.some(x=>x.plan.project===project))pick(project);
 const anchorLimit=Math.max(projects.length,Math.floor(limit*.75));
 while(sources.length<anchorLimit){let added=false;for(const project of projects){if(sources.length>=anchorLimit)break;added=Boolean(pick(project))||added}if(!added)break}
 const packets=[...chosen].filter(x=>x.candidate.hint).sort((a,b)=>b.candidate.hint!.boost-a.candidate.hint!.boost);
 for(const {plan,candidate} of packets){
  const needed=[...new Set(candidate.hint!.keys)].map(k=>originals.get(k)).filter((source):source is T=>Boolean(source)&&source.studyId===candidate.source.studyId&&!seen.has(key(source)));
  if(needed.length+sources.length>limit||chars+needed.reduce((n,s)=>n+s.text.length,0)>maxChars)continue;
  for(const source of needed)add(plan,{...candidate,source,index:plan.group.indexOf(source),topic:words(source.text)});
 }
 // Add necessary surrounding originals only after thematic/project coverage is secured.
 for(const {plan,candidate} of [...chosen]){
  if(sources.length>=limit)break;
  const s=candidate.source;
  if(candidate.hint||/модератор|интервьюер/i.test(s.speaker||'')||s.text.length<120){
   for(const index of [candidate.index-1,candidate.index+1]){const next=plan.group[index];if(next&&(!s.page||s.page===next.page))add(plan,{...candidate,source:next,index,topic:words(next.text)})}
  }
 }
 while(sources.length<limit){let added=false;for(const project of projects){if(sources.length>=limit)break;added=Boolean(pick(project))||added}if(!added)break}
 return{sources,limit,characters:chars,maxCharacters:maxChars,scopeExcluded:excluded.size,repeatedMaterials:plans.length-new Set(plans.map(p=>p.family)).size};
}
