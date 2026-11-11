import {randomUUID} from 'node:crypto';
import type {Finding,Segment} from '../app/types.ts';
/** Origin of the external research system allowed as import provenance, e.g. https://research.example.com. Import is disabled when unset. */
const sourceOrigin=()=>String(process.env.MNEMA_IMPORT_SOURCE_ORIGIN||'').replace(/\/+$/,'');
export function sourceURL(value:unknown){try{const url=new URL(String(value));if(sourceOrigin()&&url.origin===sourceOrigin()&&/^\/(studies|insights|api\/files)\//.test(url.pathname))return url.href}catch{}throw Object.assign(new Error('Укажите ссылку на материал в исходной системе. Адрес системы задаётся в MNEMA_IMPORT_SOURCE_ORIGIN.'),{status:400})}
export function importedSegments(value:unknown):Segment[]{
 if(!Array.isArray(value)||!value.length||value.length>5000)throw Object.assign(new Error('В материале должно быть от 1 до 5000 фрагментов.'),{status:400});
 const ids=new Set();return value.map(s=>{if(!s||typeof s.id!=='string'||s.id.length>160||ids.has(s.id)||typeof s.text!=='string'||!s.text.trim()||s.text.length>12000||!Number.isFinite(s.time)||s.time<0||s.page!=null&&(!Number.isInteger(s.page)||s.page<1))throw Object.assign(new Error('Проверьте текст, ID и координаты фрагментов.'),{status:400});ids.add(s.id);return {id:s.id,time:s.time,text:s.text,speaker:typeof s.speaker==='string'?s.speaker.slice(0,100):'Документ',...(s.page?{page:s.page}:{}),...(Number.isFinite(s.end)&&s.end>s.time?{end:s.end}:{})}})
}
const clean=(s:unknown)=>String(s||'').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]+/gu,' ').trim();
/** Imported acknowledgement is not equivalent to research verification. */
export function importFindings(state:any,items:any[],person:{id:string;name:string}){
 if(!Array.isArray(items)||items.length>2000)throw Object.assign(new Error('Слишком много находок в одном проекте.'),{status:400});
 const now=Date.now();let catalog=state.studies.find(s=>s.importSource?.catalog===true);if(!catalog){catalog={id:randomUUID(),title:'Импортированные карточки находок',description:'Сохранённые карточки источника. Ссылки и цитаты перенесены без подтверждения исследователем.',project:'',type:'Отчёт',report:'none',format:'TXT',date:new Date().toISOString().slice(0,10),duration:0,participants:0,status:'ready',tags:['Импорт'],color:'sage',findings:0,summary:[],segments:[],addedBy:person.name,importSource:{provider:'external',catalog:true}};state.studies.push(catalog)}
 let added=0,direct=0;for(const item of items){const url=sourceURL(item.url);if(state.findings.some(f=>f.importSource?.url===url))continue;if(typeof item.title!=='string'||!item.title.trim()||String(item.text||'').length>30000)throw Object.assign(new Error('Проверьте карточку находки.'),{status:400});
  const segmentId='import-card-'+url.split('/').at(-1);const raw=String(item.text||item.title);catalog.segments.push({id:segmentId,time:0,speaker:'Документ',text:(raw+'\n\nИсточник: '+url).slice(0,32000)});
  let target={studyId:catalog.id,segmentId},matched=false;
  for(const evidence of item.evidence||[]){const quote=clean(String(evidence).replace(/^«/,'').split(/»\s*стр\./)[0]);const name=String(evidence).split(/стр\.\s*\d+\s*·\s*/).at(-1)?.trim();const page=Number(String(evidence).match(/стр\.\s*(\d+)/)?.[1]);const material=state.studies.find(s=>s.importSource?.provider==='external'&&clean(s.fileName)===clean(name));if(!material)continue;
   const exact=material.segments?.find(s=>quote.length>=20&&clean(s.text).includes(quote.slice(0,100)));const byPage=material.format==='PDF'&&page?material.segments?.find(s=>s.page===page):null;const segment=exact||byPage;if(segment){target={studyId:material.id,segmentId:segment.id};matched=Boolean(exact);direct++;break}
  }
  const importance=['Критично','Высокая','Средняя','Низкая'].includes(item.importance)?item.importance:'Средняя';const kind=['Проблема','Инсайт','Рекомендация','Цифра'].includes(item.kind)?item.kind:'Инсайт';
  const finding:Finding={id:randomUUID(),...target,title:item.title.slice(0,160),description:(item.title+'\n\n'+raw).slice(0,28000),kind,importance,significant:item.importance==='Значимо',status:'draft',origin:'import',createdAt:now,createdBy:person.name,history:[{action:'created',status:'draft',by:person.name,at:now}],importSource:{provider:'external',url,originalStatus:String(item.originalStatus||''),confidence:String(item.confidence||''),originalImportance:String(item.importance||''),evidence:item.evidence||[],exactQuoteMatched:matched}};state.findings.push(finding);added++;
 }return {added,direct,catalogId:catalog.id};
}
