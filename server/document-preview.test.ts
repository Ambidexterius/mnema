import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {documentPreview} from './document-preview.ts';
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
