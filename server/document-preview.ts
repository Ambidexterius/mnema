import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,stat} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {extractDocument} from './processing.ts';
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
 else if(/\.xlsx$/i.test(name)){
  const result=await extractDocument({filePath,fileName:name,fileId:'preview'});
  content=result.segments.map(s=>'<pre>'+escape(s.text)+'</pre>').join('');
 }else throw new Error('Unsupported preview format');
 return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'"><title>'+escape(name)+'</title><style>body{margin:0;padding:24px;color:#222;background:#fff;font:16px/1.65 system-ui,sans-serif;overflow-wrap:anywhere}p{margin:0 0 16px}pre{white-space:pre-wrap;font:inherit}table{border-collapse:collapse;max-width:100%;display:block;overflow:auto}td{border:1px solid #ccc;padding:8px;vertical-align:top}td p:last-child{margin:0}h1,h2,h3{line-height:1.3}h1{font-size:26px}h2{font-size:22px}h3{font-size:18px}</style></head><body>'+content+'</body></html>';
}
