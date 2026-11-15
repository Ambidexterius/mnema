import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formatFileSize} from '../app/file-size.ts';
test('file size distinguishes missing metadata from zero and formats byte units',()=>{
 for(const input of [undefined,null,-1,NaN,Infinity,'1000',1.5])assert.equal(formatFileSize(input),'—');
 for(const [bytes,expected] of [[0,'0 Б'],[999,'999 Б'],[1000,'1 КБ'],[1536,'1,5 КБ'],[1000000,'1 МБ'],[1500000000,'1,5 ГБ'],[1000000000000,'1 ТБ']] as const)assert.equal(formatFileSize(bytes),expected);
});
