// Finding quotes inside rendered text (transcript, PDF text layer, Word preview) and painting them
// with the CSS Custom Highlight API, so the DOM of third-party renderers is never rewritten.

import {compactText,wordBounds} from './highlight-text.ts';
export {compactText};

/** Text-node positions of every comparable character under `root`. */
function charMap(root:Node){
 const nodes:Text[]=[],offsets:number[]=[];let text='';
 const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
 for(let node=walker.nextNode() as Text|null;node;node=walker.nextNode() as Text|null){
  const value=node.data;
  for(let i=0;i<value.length;i++){const c=compactText(value[i]);if(!c)continue;text+=c;nodes.push(node);offsets.push(i)}
 }
 return {text,nodes,offsets};
}

/** Range of the `occurrence`-th (0-based) match of `quote` under `root`; long quotes are matched by their start and end. */
export function findTextRange(root:Node|null,quote:string,occurrence=0):Range|null{
 if(!root)return null;const needle=compactText(quote);if(needle.length<3)return null;
 const map=charMap(root);let start=map.text.indexOf(needle);for(let i=0;i<occurrence&&start>=0;i++){const next=map.text.indexOf(needle,start+1);if(next<0)break;start=next}let end=start+needle.length-1;
 if(start<0&&needle.length>80){start=map.text.indexOf(needle.slice(0,40));const tail=start<0?-1:map.text.indexOf(needle.slice(-40),start);end=tail<0?-1:tail+39;if(end<0)start=-1}
 if(start<0)return null;
 const range=document.createRange();range.setStart(map.nodes[start],map.offsets[start]);range.setEnd(map.nodes[end],map.offsets[end]+1);return range;
}

/** Which repeat of `quote` under `root` starts at `range` (0 = first): selected text that repeats in a document. */
export function occurrenceAt(root:Node,range:Range,quote:string){
 const needle=compactText(quote);if(needle.length<3)return 0;const before=document.createRange();before.selectNodeContents(root);before.setEnd(range.startContainer,range.startOffset);
 const text=compactText(before.toString());let count=0;for(let at=text.indexOf(needle);at>=0;at=text.indexOf(needle,at+1))count++;
 // The selection itself may start mid-needle in the compact text; matches that begin before it are earlier repeats.
 return count;
}

/** A copy of the range widened to whole words at both ends; words are not joined across separate text nodes. */
export function expandToWords(range:Range):Range{
 const out=range.cloneRange();
 if(out.startContainer.nodeType===Node.TEXT_NODE){const text=(out.startContainer as Text).data;const [a]=wordBounds(text,out.startOffset,out.startOffset);out.setStart(out.startContainer,a)}
 if(out.endContainer.nodeType===Node.TEXT_NODE){const text=(out.endContainer as Text).data;const [,b]=wordBounds(text,out.endOffset,out.endOffset);out.setEnd(out.endContainer,b)}
 return out;
}

type HighlightRegistry={set(name:string,value:unknown):void;delete(name:string):void};
const registry=():HighlightRegistry|null=>(globalThis as any).CSS?.highlights??null;
export const canPaint=()=>Boolean(registry())&&typeof (globalThis as any).Highlight==='function';

/** Paints ranges under one highlight name; an empty list clears it. Browsers without the API keep the panel list only. */
export function paintRanges(name:string,ranges:Range[]){
 const css=registry();if(!css)return;
 if(!ranges.length){css.delete(name);return}
 css.set(name,new (globalThis as any).Highlight(...ranges));
}
