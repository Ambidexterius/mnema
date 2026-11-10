import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractDocument} from './processing.ts';
test('mixed PDF uses OCR only for scanned pages and preserves stable page citations',async()=>{
 const calls=[];const run=async(cmd:string,args:string[]):Promise<{stdout:string}>=>{calls.push([cmd,args]);if(cmd==='pdfinfo')return{stdout:'Pages: 2\n'};if(cmd==='pdftotext')return{stdout:args[1]==='1'?'Достаточный текст первого листа. Пользователь проверяет календарь.':''};if(cmd==='tesseract')return{stdout:'Распознанный скан второго листа.'};return{stdout:''}};
 const first=await extractDocument({filePath:'/tmp/neutral.pdf',fileName:'neutral.pdf',fileId:'fixture',run});
 assert.equal(first.ocrPages,1);assert.deepEqual(first.segments.map(s=>s.page),[1,2]);assert.equal(calls.filter(c=>c[0]==='tesseract').length,1);
 const again=await extractDocument({filePath:'/tmp/neutral.pdf',fileName:'neutral.pdf',fileId:'fixture',run});assert.equal(first.segments[1].id,again.segments[1].id);
});
test('PDF page limit stops before rendering',async()=>{let rendered=false;await assert.rejects(extractDocument({filePath:'/tmp/huge.pdf',fileName:'huge.pdf',fileId:'x',run:async(cmd:string):Promise<{stdout:string}>=>{if(cmd==='pdfinfo')return{stdout:'Pages: 101'};rendered=true;return{stdout:''}}}),/100/);assert.equal(rendered,false)});
