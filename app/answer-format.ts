type AnswerItem={lead:string;text:string};
type AnswerBlock={type:'heading'|'paragraph';text:string}|{type:'list';items:AnswerItem[]};
const LEGACY_SECTIONS=['Цифры','Прямые данные','Перенос и аналогии','Выводы','Что осталось невыясненным'];
/** «## Цифры» items are shown as metric cards. */
export const METRICS_SECTION='Цифры';
/** Sections shown as tinted cards in chat. */
export const CARD_SECTIONS:Record<string,'ok'|'open'>={'Выводы':'ok','Что осталось невыясненным':'open'};

/** A small text format shared by chat and print; model output is never treated as HTML. */
export function answerBlocks(text:string):AnswerBlock[]{
 const blocks:AnswerBlock[]=[];let list:Extract<AnswerBlock,{type:'list'}>|null=null;
 for(const raw of String(text||'').split('\n')){
  const line=raw.trim();if(!line){list=null;continue}
  const marked=line.match(/^#{1,6}\s+(.+?)\s*#*$/)||line.match(/^\*\*(.+?)\*\*\s*:?$/);
  const plain=line.replace(/\*\*/g,'');
  const legacy=LEGACY_SECTIONS.find(h=>plain.replace(/[:.]$/,'').toLocaleLowerCase('ru')===h.toLocaleLowerCase('ru'));
  if(marked||legacy){list=null;blocks.push({type:'heading',text:legacy||(marked![1].replace(/\*\*/g,'').trim())});continue}
  // «- **Тезис.** пояснение»: only a leading bold phrase survives as the item's lead.
  const item=line.match(/^(?:[-•*]|\d+[.)])\s+(.+)$/),lead=item?.[1].match(/^\*\*(.+?)\*\*:?\s*(.*)$/);
  if(item){if(!list){list={type:'list',items:[]};blocks.push(list)}list.items.push({lead:lead?lead[1].replace(/\*\*/g,'').trim():'',text:(lead?lead[2]:item[1]).replace(/\*\*/g,'')});continue}
  list=null;blocks.push({type:'paragraph',text:plain});
 }
 return blocks;
}

const escapeHTML=(text:string)=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
export function answerHTML(text:string){return answerBlocks(text).map(block=>block.type==='list'?'<ul>'+block.items.map(item=>'<li>'+(item.lead?'<strong>'+escapeHTML(item.lead)+'</strong> ':'')+escapeHTML(item.text)+'</li>').join('')+'</ul>':block.type==='heading'?'<h2>'+escapeHTML(block.text)+'</h2>':'<p>'+escapeHTML(block.text)+'</p>').join('')}

/** «Метка: значение — откуда [1]» → card parts; without «:» the whole text is the value. */
export function answerMetric(text:string){
 const colon=text.indexOf(': '),label=colon>0?text.slice(0,colon).trim():'',rest=colon>0?text.slice(colon+2):text;
 const dash=rest.search(/\s[—–-]\s/);
 return {label,value:(dash>0?rest.slice(0,dash):rest).trim(),note:dash>0?rest.slice(dash+3).trim():''};
}
