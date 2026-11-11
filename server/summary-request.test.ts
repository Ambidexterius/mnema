import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requestSummary} from './summary-request.ts';
test('summary disables DeepSeek thinking, avoids gateway JSON mode and retries a cut-off part once without accepting it',async()=>{
 const calls:any[]=[];let retries=0;
 const result=await requestSummary('deepseek-V4',{system:'Return JSON',fragments:[{id:'real-id',text:'Source'}]},async request=>{calls.push(request);return calls.length===1?{choices:[{finish_reason:'length',message:{content:'{"summary":[',reasoning_content:'private reasoning'}}]}:{choices:[{finish_reason:'stop',message:{content:'{"summary":[]}'}}]}},()=>retries++);
 assert.equal(result,'{"summary":[]}');assert.deepEqual(calls.map(x=>x.max_tokens),[8192,16384]);assert.equal(retries,1);assert.equal(calls[0].thinking.type,'disabled');assert.equal(calls[0].reasoning_effort,'none');assert.equal(calls[0].response_format,undefined);assert(!result.includes('private reasoning'));
});
test('summary retries remain bounded and do not affect other model protocols',async()=>{
 let calls=0;await assert.rejects(requestSummary('other-model',{system:'JSON'},async payload=>{calls++;assert.equal(payload.thinking,undefined);return {choices:[{finish_reason:'length',message:{content:'partial'}}]}}),(error:any)=>error.code==='truncated');assert.equal(calls,2);
});
