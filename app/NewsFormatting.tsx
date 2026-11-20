import React,{useLayoutEffect,useRef,useState} from 'react';
import {Button,TextInput} from '@gravity-ui/uikit';
import {Bold,Check,ChevronDown,Italic,Link2} from 'lucide-react';

const formats=[
 ['text','Текст'],['h1','Заголовок 1'],['h2','Заголовок 2'],['h3','Заголовок 3'],
 ['ordered','Нумерованный список'],['unordered','Маркированный список']
] as const;
type Format=(typeof formats)[number][0];
const blockPrefix=/^(?:#{1,6}|[-+*]|\d+[.)])[ \t]+/;
const lineStart=(value:string,offset:number)=>offset===0?0:value.lastIndexOf('\n',offset-1)+1;
function currentFormat(line:string):Format{
 const prefix=line.match(blockPrefix)?.[0].trim();
 if(prefix==='#')return 'h1';
 if(prefix==='##')return 'h2';
 if(prefix==='###')return 'h3';
 if(prefix&&/^\d/.test(prefix))return 'ordered';
 if(prefix&&/^[-+*]$/.test(prefix))return 'unordered';
 return 'text';
}
type Selection={start:number;end:number;x:number;y:number;space:number};

function selectionPosition(input:HTMLTextAreaElement,offset:number){
 const box=input.getBoundingClientRect();
 const style=getComputedStyle(input),mirror=document.createElement('div');
 Object.assign(mirror.style,{
  position:'fixed',visibility:'hidden',pointerEvents:'none',left:box.left+'px',top:box.top+'px',
  boxSizing:'border-box',width:input.clientWidth+'px',padding:style.padding,
  font:style.font,letterSpacing:style.letterSpacing,tabSize:style.tabSize,
  whiteSpace:'pre-wrap',overflowWrap:'break-word'
 });
 const text=document.createTextNode(input.value+'\u200b');
 mirror.append(text);document.body.append(mirror);
 const range=document.createRange();range.setStart(text,offset);range.setEnd(text,offset+1);
 const rect=range.getBoundingClientRect();mirror.remove();
 return {x:rect.left,y:Math.max(box.top,Math.min(box.bottom,rect.top-input.scrollTop))};
}

export default function NewsFormatting({input,value,onUpdate,children}:{
 input:React.RefObject<HTMLTextAreaElement|null>;value:string;onUpdate:(value:string)=>void;children:React.ReactNode
}){
 const field=useRef<HTMLDivElement>(null),flyout=useRef<HTMLElement|null>(null),pending=useRef<{start:number;end:number}|null>(null);
 const [selection,setSelection]=useState<Selection|null>(null);
 const [panel,setPanel]=useState<'link'|'formats'|null>(null),[url,setUrl]=useState(''),[invalid,setInvalid]=useState(false);

 function dismiss(){setSelection(null);setPanel(null)}
 function readSelection(){
  const control=input.current;
  if(!control||document.activeElement!==control)return;
  const {selectionStart:start,selectionEnd:end}=control;
  if(start===end){dismiss();return}
  const wrapper=field.current;
  if(!wrapper)return;
  const rect=wrapper.getBoundingClientRect(),pos=selectionPosition(control,start);
  const dialogBottom=wrapper.closest('.updates-dialog')?.getBoundingClientRect().bottom??window.innerHeight;
  setSelection({start,end,x:pos.x-rect.left,y:pos.y-rect.top,space:Math.max(0,dialogBottom-rect.bottom-16)});
 }
 useLayoutEffect(()=>{
  if(!pending.current||!input.current)return;
  const {start,end}=pending.current;pending.current=null;
  input.current.focus();input.current.setSelectionRange(start,end);readSelection();
 },[value]);

 useLayoutEffect(()=>{
  const popup=flyout.current;
  if(panel&&popup?.closest('.news-edit-inline'))popup.scrollIntoView({block:'nearest'});
 },[panel]);

 function replace(start:number,end:number,text:string,from=0,to=text.length){
  const next=value.slice(0,start)+text+value.slice(end);
  if(next.length>24000)return;
  setPanel(null);
  if(next===value){input.current?.focus();return}
  pending.current={start:start+from,end:start+to};onUpdate(next);
 }
 function emphasize(marker:string){
  if(!selection)return;
  const selected=value.slice(selection.start,selection.end),sample=selected.trim();
  if(!sample)return;
  const start=selection.start+selected.length-selected.trimStart().length,end=start+sample.length;
  if(sample.startsWith(marker)&&sample.endsWith(marker)&&sample.length>2*marker.length){
   replace(start,end,sample.slice(marker.length,-marker.length));return;
  }
  if(value.slice(start-marker.length,start)===marker&&value.slice(end,end+marker.length)===marker){
   replace(start-marker.length,end+marker.length,sample);return;
  }
  replace(start,end,marker+sample+marker,marker.length,marker.length+sample.length);
 }
 function applyBlock(format:Format){
  if(!selection)return;
  const start=lineStart(value,selection.start);
  const nextLine=value.indexOf('\n',selection.end-1),end=nextLine<0?value.length:nextLine;
  const lines=value.slice(start,end).split('\n').map(line=>line.replace(blockPrefix,''));
  const text=lines.map((line,index)=>{
   if(!line.trim()||format==='text')return line;
   if(format==='ordered')return (index+1)+'. '+line;
   if(format==='unordered')return '- '+line;
   return '#'.repeat(Number(format[1]))+' '+line;
  }).join('\n');
  replace(start,end,text);
 }
 function addLink(event:React.FormEvent){
  event.preventDefault();
  if(!selection)return;
  let href:URL;
  try{
   href=new URL(url.trim());
   if(!['https:','http:','mailto:'].includes(href.protocol))throw Error();
  }catch{setInvalid(true);return}
  const {start,end}=selection;
  const label=value.slice(start,end).replace(/[\\\[\]]/g,'\\$&').replace(/\s*\n\s*/g,' ');
  const target=href.href.replace(/[()]/g,char=>char==='('? '%28':'%29');
  replace(start,end,'['+label+']('+target+')',1,label.length+1);
 }

 const activeFormat=selection?currentFormat(value.slice(lineStart(value,selection.start))):'text';
 return <div className="news-format-field" ref={field}
  onSelect={readSelection}
  onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))dismiss()}}
  onScrollCapture={event=>{if(event.target===input.current)readSelection()}}
  onKeyDown={event=>{
   if(event.key!=='Escape'||!selection)return;
   event.preventDefault();event.stopPropagation();
   if(panel){setPanel(null);input.current?.focus()}else{input.current?.focus();input.current?.setSelectionRange(selection.end,selection.end);dismiss()}
  }}>
  {children}
  {selection?<div className="news-format-layer" style={{'--news-selection-x':selection.x+'px','--news-selection-y':selection.y+'px','--news-format-space':selection.space+'px'} as React.CSSProperties}>
   <div className="news-format-buttons" role="group" aria-label="Форматирование текста"
    onMouseDown={event=>{if(event.button===0)event.preventDefault()}}>
    <Button view="flat-secondary" size="m" aria-label="Добавить ссылку" aria-expanded={panel==='link'}
     onClick={()=>{setPanel(panel==='link'?null:'link');setUrl('');setInvalid(false)}}><Link2 size={16}/></Button>
    <Button view="flat-secondary" size="m" aria-label="Жирный" onClick={()=>emphasize('**')}><Bold size={16}/></Button>
    <Button view="flat-secondary" size="m" aria-label="Курсив" onClick={()=>emphasize('_')}><Italic size={16}/></Button>
    <Button view="flat-secondary" size="m" aria-label="Стиль текста" aria-expanded={panel==='formats'}
     onClick={()=>setPanel(panel==='formats'?null:'formats')}>Текст <ChevronDown size={16}/></Button>
   </div>
   {panel==='formats'?<div ref={node=>{flyout.current=node}} className="news-format-options" role="group" aria-label="Стиль текста"
    onMouseDown={event=>{if(event.button===0)event.preventDefault()}}>
    {formats.map(([format,label])=><Button key={format} view="flat-secondary" size="m" aria-pressed={activeFormat===format} onClick={()=>applyBlock(format)}>{label}{activeFormat===format?<Check size={16}/>:null}</Button>)}
   </div>:null}
   {panel==='link'?<form ref={node=>{flyout.current=node}} className="news-format-link" onSubmit={addLink}>
    <TextInput autoFocus value={url} onUpdate={next=>{setUrl(next);setInvalid(false)}} placeholder="https://"
     controlProps={{'aria-label':'Адрес ссылки'}} validationState={invalid?'invalid':undefined}
     errorMessage={invalid?'Введите адрес ссылки':undefined} errorPlacement="outside"/>
    <Button type="submit" view="normal">Добавить</Button>
   </form>:null}
  </div>:null}
 </div>;
}
