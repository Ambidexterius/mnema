// Document preview inside the material window, page by page, as Dovetail shows it:
// PDF through pdf.js (canvas + selectable text layer), Word .docx through docx-preview.
// Pages render lazily; quotes are found and painted in the rendered text, the DOM is not rewritten.
import React,{useEffect,useImperativeHandle,useRef,useState,forwardRef} from 'react';
import {Button,DropdownMenu,Select} from '@gravity-ui/uikit';
import {Download,ExternalLink,FileText,LoaderCircle,MoreHorizontal,RefreshCw} from 'lucide-react';
import {findTextRange,paintRanges} from './text-ranges.ts';

export interface DocumentPagesHandle {
 /** Scrolls to the quote (or the page when the quote is not found) and flashes it. */
 reveal(quote:string,page?:number,occurrence?:number):boolean;
 /** Root of the rendered text, for selection handling. */
 root():HTMLElement|null;
}
type Props={file:string;name:string;kind:'pdf'|'docx';highlights:{id:string;text:string;page?:number;occurrence?:number}[];onOpenWindow?:()=>void};
type PdfDoc={numPages:number;getPage(n:number):Promise<any>};

const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
const pdfModule=()=>import('pdfjs-dist').then(async pdf=>{const worker=(await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;pdf.GlobalWorkerOptions.workerSrc=worker;return pdf});

const DocumentPages=forwardRef<DocumentPagesHandle,Props>(function DocumentPages({file,name,kind,highlights,onOpenWindow},ref){
 const body=useRef<HTMLDivElement>(null),docx=useRef<HTMLDivElement>(null),styles=useRef<HTMLDivElement>(null);
 const pdf=useRef<PdfDoc|null>(null),loading=useRef<{destroy():Promise<void>}|null>(null),rendered=useRef(new Map<number,Promise<void>>());
 const [state,setState]=useState<'loading'|'ready'|'error'>('loading'),[pages,setPages]=useState(0),[current,setCurrent]=useState(1),[attempt,retry]=useState(0),[paintTick,repaint]=useState(0);
 // Word pages keep their real width in points; a narrower column scales them down instead of scrolling sideways.
 const fitDocx=()=>{const host=docx.current;if(!host)return;const width=host.clientWidth;host.querySelectorAll<HTMLElement>('section.docx').forEach(section=>{section.style.zoom='';const own=section.offsetWidth;if(own>width&&width>0)section.style.zoom=String(width/own)})};
 useEffect(()=>{if(kind!=='docx'||state!=='ready'||!docx.current)return;const o=new ResizeObserver(()=>fitDocx());o.observe(docx.current);return()=>o.disconnect()},[kind,state]);
 const pageEl=(n:number)=>body.current?.querySelector<HTMLElement>(`[data-page="${n}"]`)??null;

 // PDF: open the document, lay out page shells at their real size, render pages as they approach the viewport.
 async function renderPdfPage(n:number){
  if(rendered.current.has(n))return rendered.current.get(n);
  const task=(async()=>{const doc=pdf.current;const shell=pageEl(n);if(!doc||!shell)return;
   const lib=await pdfModule();const page=await doc.getPage(n);const width=shell.clientWidth||720;
   const viewport=page.getViewport({scale:width/page.getViewport({scale:1}).width});const ratio=Math.min(2,devicePixelRatio||1);
   const canvas=document.createElement('canvas');canvas.width=Math.floor(viewport.width*ratio);canvas.height=Math.floor(viewport.height*ratio);canvas.setAttribute('aria-hidden','true');
   const layer=document.createElement('div');layer.className='textLayer';layer.style.setProperty('--total-scale-factor',String(viewport.scale));layer.dataset.base=String(viewport.width/viewport.scale);
   const canvasBox=shell.querySelector('.document-page-canvas')!;canvasBox.replaceChildren(canvas,layer);
   await page.render({canvas,viewport,transform:ratio!==1?[ratio,0,0,ratio,0,0]:undefined}).promise;
   await new lib.TextLayer({textContentSource:page.streamTextContent(),container:layer,viewport}).render();
   shell.classList.add('rendered');repaint(x=>x+1);
  })();
  rendered.current.set(n,task);return task;
 }
 useEffect(()=>{let active=true;setState('loading');setPages(0);rendered.current=new Map();
  (async()=>{try{
   if(kind==='pdf'){const lib=await pdfModule();const task=lib.getDocument({url:file,withCredentials:true});loading.current=task;const doc=await task.promise;if(!active){task.destroy();return}pdf.current=doc;
    const first=await doc.getPage(1);const v=first.getViewport({scale:1});body.current?.style.setProperty('--page-ratio',String(v.height/v.width));setPages(doc.numPages);setState('ready')}
   else{const [{renderAsync},response]=await Promise.all([import('docx-preview'),fetch(file,{credentials:'same-origin'})]);if(!response.ok)throw new Error('HTTP '+response.status);const blob=await response.blob();if(!active||!docx.current||!styles.current)return;
    await renderAsync(blob,docx.current,styles.current,{className:'docx',inWrapper:false,breakPages:true,ignoreLastRenderedPageBreak:false,renderAltChunks:false,renderComments:false,renderChanges:false,useBase64URL:true,experimental:false});
    const sections=[...docx.current.querySelectorAll<HTMLElement>('section.docx')];sections.forEach((section,i)=>{section.dataset.page=String(i+1);section.classList.add('document-page','rendered')});
    // Links inside a document open in a new tab and never replace the app.
    docx.current.querySelectorAll('a[href]').forEach(a=>{a.setAttribute('target','_blank');a.setAttribute('rel','noopener noreferrer')});
    fitDocx();setPages(sections.length);setState('ready');repaint(x=>x+1)}
  }catch(e){console.error('Preview failed',(e as Error).name);if(active)setState('error')}})();
  return()=>{active=false;loading.current?.destroy().catch(()=>{});loading.current=null;pdf.current=null;paintRanges('mnema-quote',[]);paintRanges('mnema-flash',[])};
 },[file,kind,attempt]);

 // The canvas stretches with the page; the text layer follows through its scale factor, so selections and highlights stay on the glyphs.
 useEffect(()=>{if(kind!=='pdf'||state!=='ready'||!body.current)return;const o=new ResizeObserver(()=>{body.current?.querySelectorAll<HTMLElement>('.textLayer').forEach(layer=>{const base=Number(layer.dataset.base);const width=layer.parentElement?.clientWidth||0;if(base&&width)layer.style.setProperty('--total-scale-factor',String(width/base))})});o.observe(body.current);return()=>o.disconnect()},[kind,state]);
 // Lazy rendering and the current page number.
 useEffect(()=>{if(state!=='ready'||!body.current)return;const root=body.current.closest('.study-sheet-scroll')||null;
  const lazy=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting&&kind==='pdf')renderPdfPage(Number((e.target as HTMLElement).dataset.page))},{root,rootMargin:'600px 0px'});
  const visible=new Map<number,number>();
  const track=new IntersectionObserver(entries=>{for(const e of entries)visible.set(Number((e.target as HTMLElement).dataset.page),e.intersectionRatio);const best=[...visible.entries()].sort((a,b)=>b[1]-a[1])[0];if(best&&best[1]>0)setCurrent(best[0])},{root,threshold:[0,.25,.5,.75,1]});
  body.current.querySelectorAll<HTMLElement>('[data-page]').forEach(el=>{lazy.observe(el);track.observe(el)});
  return()=>{lazy.disconnect();track.disconnect()};
 },[state,pages,kind]);

 // Saved highlights are painted wherever their text is already rendered.
 useEffect(()=>{if(state!=='ready')return;const root=body.current;paintRanges('mnema-quote',highlights.map(h=>h.page&&kind==='pdf'?findTextRange(pageEl(h.page),h.text):findTextRange(root,h.text,h.occurrence||0)).filter((r):r is Range=>Boolean(r)))},[highlights,paintTick,state]);

 const goTo=async(n:number,quote?:string,known?:Range|null)=>{const el=pageEl(n);if(!el)return false;if(kind==='pdf')await renderPdfPage(n);
  const range=known??(quote?findTextRange(el,quote):null);
  (range?(range.startContainer.parentElement||el):el).scrollIntoView({block:range?'center':'start',behavior:reduced()?'auto':'smooth'});
  if(range){paintRanges('mnema-flash',[range]);setTimeout(()=>paintRanges('mnema-flash',[]),2400)}return Boolean(range)};
 useImperativeHandle(ref,()=>({
  reveal(quote,page,occurrence=0){if(state!=='ready')return false;
   if(page&&page<=pages&&kind==='pdf'){goTo(page,quote);return true}
   const range=findTextRange(body.current,quote,occurrence);if(!range)return false;
   const host=(range.startContainer.parentElement?.closest('[data-page]') as HTMLElement|null);goTo(Number(host?.dataset.page||1),quote,range);return true},
  root:()=>body.current
 }),[state,pages,kind]);

 const download=<a className="document-pages-download" href={file} download={name}><Download size={16}/>Скачать</a>;
 return <section className="document-pages" aria-label={'Предпросмотр: '+name}>
  <header className="document-pages-bar">
   <span className="document-pages-name" title={name}><FileText size={16} aria-hidden="true"/>{name}</span>
   {state==='ready'&&pages>1?<Select size="s" width={128} value={[String(current)]} options={Array.from({length:pages},(_,i)=>({value:String(i+1),content:'Стр. '+(i+1)+' из '+pages}))} onUpdate={v=>goTo(Number(v[0]))} aria-label="Перейти к странице" filterable={pages>20}/>:state==='ready'?<span className="muted document-pages-count">1 страница</span>:null}
   <DropdownMenu renderSwitcher={props=><Button {...props} view="flat" size="s" aria-label="Действия с файлом"><MoreHorizontal size={16}/></Button>} items={[...(onOpenWindow?[{text:'Открыть в отдельном окне',iconStart:<ExternalLink size={16}/>,action:onOpenWindow}]:[]),{text:'Скачать',iconStart:<Download size={16}/>,href:file,extraProps:{download:name}}]}/>
  </header>
  {state==='loading'?<div className="document-pages-message" role="status"><LoaderCircle className="activity-spinner" size={20} aria-hidden="true"/>Загружаем страницы…</div>:null}
  {state==='error'?<div className="document-pages-message" role="alert"><strong>Не удалось показать страницы</strong><p>Исходный файл сохранён. Попробуйте ещё раз или скачайте его.</p><div className="document-pages-actions"><Button view="outlined" onClick={()=>retry(x=>x+1)}><RefreshCw size={16}/>Повторить</Button>{download}</div></div>:null}
  <div ref={body} className={'document-pages-body '+kind} hidden={state==='error'}>
   {kind==='pdf'?Array.from({length:pages},(_,i)=><div key={i} className="document-page" data-page={i+1} role="region" aria-label={'Страница '+(i+1)}><div className="document-page-canvas"/></div>):<><div ref={styles} className="docx-styles"/><div ref={docx} className="docx-host"/></>}
  </div>
 </section>;
});
export default DocumentPages;
