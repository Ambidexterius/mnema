type AnswerBlock={type:'heading'|'paragraph';text:string}|{type:'list';items:string[]};
const LEGACY_SECTIONS=['Прямые данные','Перенос и аналогии','Выводы','Что осталось невыясненным'];

/** A small text format shared by chat and print; model output is never treated as HTML. */
export function answerBlocks(text:string):AnswerBlock[]{
 const blocks:AnswerBlock[]=[];let list:Extract<AnswerBlock,{type:'list'}>|null=null;
 for(const raw of String(text||'').split('\n')){
  const line=raw.trim();if(!line){list=null;continue}
  const marked=line.match(/^#{1,6}\s+(.+?)\s*#*$/)||line.match(/^\*\*(.+?)\*\*\s*:?$/);
  const plain=line.replace(/\*\*/g,'');
  const legacy=LEGACY_SECTIONS.find(h=>plain.replace(/[:.]$/,'').toLocaleLowerCase('ru')===h.toLocaleLowerCase('ru'));
  if(marked||legacy){list=null;blocks.push({type:'heading',text:legacy||(marked![1].replace(/\*\*/g,'').trim())});continue}
  const item=plain.match(/^(?:[-•*]|\d+[.)])\s+(.+)$/);
  if(item){if(!list){list={type:'list',items:[]};blocks.push(list)}list.items.push(item[1]);continue}
  list=null;blocks.push({type:'paragraph',text:plain});
 }
 return blocks;
}

const escapeHTML=(text:string)=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
export function answerHTML(text:string){return answerBlocks(text).map(block=>block.type==='list'?'<ul>'+block.items.map(item=>'<li>'+escapeHTML(item)+'</li>').join('')+'</ul>':block.type==='heading'?'<h2>'+escapeHTML(block.text)+'</h2>':'<p>'+escapeHTML(block.text)+'</p>').join('')}
