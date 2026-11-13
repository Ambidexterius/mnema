import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,stat} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
const execute=promisify(execFile);
const escape=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function documentPreview(filePath:string,name:string){
 if((await stat(filePath)).size>20*1024**2)throw new Error('Preview too large');
 const options={timeout:30000,maxBuffer:10*1024**2};let content:string;
 if(/\.docx$/i.test(name))content=(await execute(process.env.DOC_PYTHON||'python3',[join(dirname(fileURLToPath(import.meta.url)),'preview-word.py'),filePath],options)).stdout;
 else if(/\.doc$/i.test(name)){
  const {stdout}=process.platform==='darwin'?await execute('textutil',['-convert','txt','-stdout',filePath],options):await execute('antiword',['-m','UTF-8.txt',filePath],options);
  content='<pre>'+escape(stdout)+'</pre>';
 }else if(/\.txt$/i.test(name))content='<pre>'+escape(await readFile(filePath,'utf8'))+'</pre>';
 else if(/\.xlsx?$/i.test(name)){
  const python=process.env.DOC_PYTHON||process.env.ASR_PYTHON||(existsSync('/opt/asr/bin/python')?'/opt/asr/bin/python':'python3');
  const result=await execute(python,[join(dirname(fileURLToPath(import.meta.url)),/\.xlsx$/i.test(name)?'extract-xlsx.py':'extract-xls.py'),filePath,'--json'],{...options,maxBuffer:24*1024**2});
  const sheets=JSON.parse(result.stdout) as {name:string;rows:{number:number;cells:{coordinate:string;value:string}[]}[]}[];
  const column=(n:number):string=>n?column(Math.floor((n-1)/26))+String.fromCharCode(65+(n-1)%26):'';
  content='<p>Значения из исходной таблицы. Откройте нужный лист. Формулы не пересчитываются.</p>'+sheets.map((sheet,index)=>{
   const rows=sheet.rows.slice(0,1000),letters=[...new Set(rows.flatMap(r=>r.cells.map(c=>c.coordinate.replace(/\d+$/,''))))];
   const indexOf=(s:string)=>[...s].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
   const width=Math.min(100,Math.max(0,...letters.map(indexOf))),columns=Array.from({length:width},(_,i)=>column(i+1));
   const limited=sheet.rows.length>1000||letters.some(c=>indexOf(c)>100);
   return '<details'+(index===0?' open':'')+'><summary>'+escape(sheet.name)+'</summary>'+(limited?'<p>Показаны первые 1 000 заполненных строк и 100 колонок. Скачайте исходник, чтобы посмотреть всю таблицу.</p>':'')+(rows.length?'<div class="sheet-scroll" tabindex="0" role="region" aria-label="Лист '+escape(sheet.name)+'"><table class="sheet"><caption>'+escape(sheet.name)+'</caption><thead><tr><th scope="col" aria-label="Строка">№</th>'+columns.map(c=>'<th scope="col">'+c+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>{const values=new Map(row.cells.map(c=>[c.coordinate.replace(/\d+$/,''),c.value]));return '<tr><th scope="row">'+row.number+'</th>'+columns.map(c=>'<td>'+escape(values.get(c)||'')+'</td>').join('')+'</tr>'}).join('')+'</tbody></table></div>':'<p>Лист пуст</p>')+'</details>';
  }).join('');
 }else throw new Error('Unsupported preview format');
 return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'"><title>'+escape(name)+'</title><style>body{margin:0;padding:24px;color:#222;background:#fff;font:16px/1.65 system-ui,sans-serif;overflow-wrap:anywhere}p{margin:0 0 16px}pre{white-space:pre-wrap;font:inherit}table{border-collapse:collapse;max-width:100%;display:block;overflow:auto}td{border:1px solid #ccc;padding:8px;vertical-align:top}td p:last-child{margin:0}details{margin:16px 0;border:1px solid #ccc;border-radius:8px;padding:12px}summary{cursor:pointer;font-weight:600;min-height:32px}summary:focus-visible,.sheet-scroll:focus-visible{outline:2px solid #EE204D;outline-offset:2px}.sheet-scroll{overflow:auto;max-height:70vh}.sheet{display:table;max-width:none;font-size:14px;line-height:1.5}.sheet caption{text-align:left;padding:8px;font-weight:600}.sheet th{border:1px solid #ccc;padding:8px;background:#f2f2f2}.sheet thead th{position:sticky;top:0}.sheet td{min-width:120px;max-width:360px;white-space:pre-wrap}.sheet tbody th{position:sticky;left:0}.sheet td:empty{min-width:48px}h1,h2,h3{line-height:1.3}h1{font-size:26px}h2{font-size:22px}h3{font-size:18px}</style></head><body>'+content+'</body></html>';
}
