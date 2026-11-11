// Floating toolbar over selected text in the material: mark the quote, make it a finding, copy it.
// Works for the transcript and for the rendered document pages; follows the selection while scrolling.
import React,{useEffect,useRef,useState} from 'react';
import {Copy,Highlighter,Lightbulb} from 'lucide-react';
import {expandToWords,occurrenceAt} from './text-ranges.ts';

export interface TextSelection {text:string;segmentId?:string;page?:number;occurrence?:number}
type Props={roots:()=>(HTMLElement|null)[];canEdit:boolean;onHighlight:(s:TextSelection)=>void;onFinding:(s:TextSelection)=>void;onCopy:(s:TextSelection)=>void};

function readSelection(roots:(HTMLElement|null)[]):{selection:TextSelection;rect:DOMRect}|null{
 const sel=window.getSelection();if(!sel||sel.isCollapsed||!sel.rangeCount)return null;
 // The quote is widened to whole words, so a quick drag does not cut words at the edges.
 const range=expandToWords(sel.getRangeAt(0));
 const text=range.toString().replace(/\u00ad/g,'').replace(/\s+/g,' ').trim();if(text.length<3)return null;const start=range.startContainer instanceof Element?range.startContainer:range.startContainer.parentElement;
 const root=roots.find(r=>r?.contains(start??null));if(!start||!root)return null;
 const rect=range.getBoundingClientRect();if(!rect.width&&!rect.height)return null;
 const segment=start.closest('[id^="segment-"]');const page=start.closest<HTMLElement>('[data-page]');
 return {selection:{text,segmentId:segment?segment.id.slice('segment-'.length):undefined,page:page?Number(page.dataset.page):undefined,occurrence:segment?undefined:occurrenceAt(root,range,text)},rect};
}

export default function SelectionToolbar({roots,canEdit,onHighlight,onFinding,onCopy}:Props){
 const [current,setCurrent]=useState<{selection:TextSelection;rect:DOMRect}|null>(null);const bar=useRef<HTMLDivElement>(null);
 useEffect(()=>{let frame=0;
  const update=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>setCurrent(readSelection(roots())))};
  const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape'&&window.getSelection()?.toString()){window.getSelection()?.removeAllRanges();setCurrent(null)}};
  document.addEventListener('selectionchange',update);document.addEventListener('scroll',update,true);window.addEventListener('resize',update);document.addEventListener('keydown',onKey);
  return()=>{cancelAnimationFrame(frame);document.removeEventListener('selectionchange',update);document.removeEventListener('scroll',update,true);window.removeEventListener('resize',update);document.removeEventListener('keydown',onKey)};
 },[roots]);
 if(!current)return null;
 const width=canEdit?248:132,top=current.rect.top>56?current.rect.top-48:current.rect.bottom+8;
 const left=Math.min(Math.max(8,current.rect.left+current.rect.width/2-width/2),innerWidth-width-8);
 const act=(fn:(s:TextSelection)=>void)=>()=>{const s=current.selection;fn(s);if(fn!==onCopy){window.getSelection()?.removeAllRanges();setCurrent(null)}};
 // mousedown is prevented so the click keeps the selection the action works on.
 return <div ref={bar} className="selection-toolbar" role="toolbar" aria-label="Действия с выделенным текстом" style={{top,left,width}} onMouseDown={e=>e.preventDefault()}>
  {canEdit?<button type="button" onClick={act(onHighlight)}><Highlighter size={16} aria-hidden="true"/>Хайлайт</button>:null}
  {canEdit?<button type="button" onClick={act(onFinding)}><Lightbulb size={16} aria-hidden="true"/>Находка</button>:null}
  <button type="button" onClick={act(onCopy)} aria-label="Копировать выделенный текст" title="Копировать"><Copy size={16} aria-hidden="true"/>{canEdit?null:'Копировать'}</button>
 </div>;
}
