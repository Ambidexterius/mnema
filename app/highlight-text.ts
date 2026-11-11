// Which transcript fragment a selected quote belongs to. Shared by the browser and the server,
// so a highlight is only saved for text that really is in the material.
import type {Segment} from './types.ts';

/** Comparable form of a quote: lower case, ё→е, no whitespace or quotes. Layout breaks lines and spaces differently. */
export const compactText=(value:string)=>String(value||'').toLowerCase().replace(/ё/g,'е').replace(/[\s«»"“”„'’\u00ad]/g,'');

const wordChar=/[\p{L}\p{N}\u00ad’']/u;
/** Selection bounds widened to whole words: a highlight never starts or ends mid-word. */
export function wordBounds(text:string,start:number,end:number):[number,number]{
 let a=Math.max(0,Math.min(start,text.length)),b=Math.max(a,Math.min(end,text.length));
 while(a>0&&wordChar.test(text[a-1])&&wordChar.test(text[a]??''))a--;
 while(b<text.length&&b>0&&wordChar.test(text[b-1])&&wordChar.test(text[b]))b++;
 return [a,b];
}
const textOf=(s:Segment)=>s.correctedText??s.text;
/** A quote may run past its fragment: it is compared with the fragment and up to five following ones. */
const WINDOW=6;

/** True when `quote` is inside the fragment `index` (with its continuation) and starts in it. */
export function quoteStartsIn(segments:Segment[],index:number,quote:string){
 const needle=compactText(quote);if(needle.length<3||index<0||index>=segments.length)return false;
 const own=compactText(textOf(segments[index]));const window=segments.slice(index,index+WINDOW).map(s=>compactText(textOf(s))).join('');
 const at=window.indexOf(needle);
 return at>=0&&at<own.length;
}

/** How many times the quote occurs in the text before the fragment: tells which repeat in a rendered document is meant. */
export function quoteOccurrence(segments:Segment[],segmentId:string,quote:string){
 const needle=compactText(quote);const index=segments.findIndex(s=>s.id===segmentId);if(needle.length<3||index<=0)return 0;
 const before=segments.slice(0,index).map(s=>compactText(textOf(s))).join('');let count=0;for(let at=before.indexOf(needle);at>=0;at=before.indexOf(needle,at+1))count++;return count;
}

/** The fragment a quote starts in; a known fragment or page narrows the search. */
export function quoteSegment(segments:Segment[],quote:string,hint:{segmentId?:string;page?:number;occurrence?:number}={}):string|null{
 if(hint.occurrence&&hint.page==null&&!hint.segmentId){const all=segments.map((s,i)=>i).filter(i=>quoteStartsIn(segments,i,quote));if(all.length)return segments[all[Math.min(hint.occurrence,all.length-1)]].id}
 if(hint.segmentId){const i=segments.findIndex(s=>s.id===hint.segmentId);if(i>=0&&quoteStartsIn(segments,i,quote))return hint.segmentId}
 const order=segments.map((s,i)=>i).sort((a,b)=>Number(hint.page!=null&&segments[b].page===hint.page)-Number(hint.page!=null&&segments[a].page===hint.page));
 for(const i of order)if(quoteStartsIn(segments,i,quote))return segments[i].id;
 return null;
}
