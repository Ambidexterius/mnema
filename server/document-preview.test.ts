import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {documentPreview} from './document-preview.ts';
import {extractDocument} from './processing.ts';

test('XLS preview preserves sheets, sparse cell positions, dates and escaped text; extraction keeps coordinates',async()=>{
 const file=fileURLToPath(new URL('./fixtures/preview.xls',import.meta.url));
 const html=await documentPreview(file,'preview.xls');
 assert.match(html,/<summary>Данные &lt;тест&gt;<\/summary>/);
 assert.match(html,/<th scope="col">B<\/th>/);
 assert.match(html,/<td>Анна<\/td><td><\/td><td>&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/td>/);
 assert.match(html,/<th scope="row">4<\/th><td><\/td><td>42<\/td><td>Да<\/td>/);
 assert.match(html,/2026-11-13 00:00:00/);assert.match(html,/<summary>Итоги<\/summary>/);assert.match(html,/<summary>Пустой<\/summary><p>Лист пуст<\/p>/);
 assert.doesNotMatch(html,/<script|<a\s|<img\s/i);
 const result=await extractDocument({filePath:file,fileName:'preview.xls',fileId:'fixture'});
 assert(result.segments.some(s=>s.text.includes('C2: <script>alert(1)</script>')));
 assert(result.segments.some(s=>s.text.includes('Лист «Итоги»')));
});

test('XLSX preview is a grid instead of extracted paragraphs and rejects malformed workbooks',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mnema-sheet-')),file=join(dir,'fixture.xlsx');
 try{
  const files={
   'xl/workbook.xml':'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Лист 1" r:id="r1"/></sheets></workbook>',
   'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>',
   'xl/worksheets/sheet1.xml':'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="2"><c r="A2" t="inlineStr"><is><t>&lt;img src=x&gt;</t></is></c><c r="C2"><v>0</v></c></row><row r="5"><c r="B5"><f>1+2</f><v>3</v></c></row></sheetData></worksheet>',
  };
  await promisify(execFile)(process.env.DOC_PYTHON||'python3',['-c','import sys,json,zipfile;z=zipfile.ZipFile(sys.argv[1],"w");[z.writestr(k,v) for k,v in json.loads(sys.argv[2]).items()];z.close()',file,JSON.stringify(files)]);
  const html=await documentPreview(file,'fixture.XLSX');
  assert.match(html,/<table class="sheet">/);assert.match(html,/<th scope="row">2<\/th><td>&lt;img src=x&gt;<\/td><td><\/td><td>0<\/td>/);
  assert.match(html,/3 \[формула: 1\+2\]/);assert.doesNotMatch(html,/<img\s/);
  await writeFile(file,'not a workbook');await assert.rejects(documentPreview(file,'fixture.xlsx'));
  await assert.rejects(documentPreview(file,'fixture.xls'));
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('DOCX preview reads the original archive, preserves paragraphs and tables, and cannot inject markup or external links',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mnema-preview-'));const file=join(dir,'fixture.docx');
 try{
  const xml='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Fixture title</w:t></w:r></w:p><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>&lt;script&gt;alert(1)&lt;/script&gt;</w:t></w:r><w:hyperlink><w:r><w:t>Visible link text</w:t></w:r></w:hyperlink></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Source cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>';
  await promisify(execFile)(process.env.DOC_PYTHON||'python3',['-c','import sys,zipfile; z=zipfile.ZipFile(sys.argv[1],"w");z.writestr("word/document.xml",sys.argv[2]);z.close()',file,xml]);
  const html=await documentPreview(file,'<fixture>.docx');
  assert.match(html,/<h1>Fixture title<\/h1>/);assert.match(html,/<strong>&lt;script&gt;/);assert.match(html,/<td><p>Source cell<\/p><\/td>/);
  assert.doesNotMatch(html,/<script|<a\s|href=|onerror=/i);assert.match(html,/&lt;fixture&gt;/);
  await writeFile(join(dir,'plain.txt'),'<img src=x onerror=alert(1)>');
  assert.match(await documentPreview(join(dir,'plain.txt'),'plain.txt'),/&lt;img src=x onerror=alert\(1\)&gt;/);
  await promisify(execFile)(process.env.DOC_PYTHON||'python3',['-c','import sys,zipfile;z=zipfile.ZipFile(sys.argv[1],"w");z.writestr("word/document.xml","<!DOCTYPE bad><bad/>");z.close()',file]);
  await assert.rejects(documentPreview(file,'bad.docx'));
 }finally{await rm(dir,{recursive:true,force:true})}
});
