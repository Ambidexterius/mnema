import {SummaryFailure} from './summaries.ts';
/** Some compatible gateways mix reasoning and final output under one token cap. */
export async function requestSummary(model:string,payload:any,call:(request:any)=>Promise<any>,onRetry:()=>void=()=>{}){
 const deepseek=/deepseek/i.test(model);let maxTokens=8192;
 for(let attempt=0;attempt<2;attempt++){
  let result;try{result=await call({model,temperature:.1,max_tokens:maxTokens,...(deepseek?{thinking:{type:'disabled'},reasoning_effort:'none'}:{}),messages:[{role:'system',content:payload.system},{role:'user',content:JSON.stringify(Object.fromEntries(Object.entries(payload).filter(([key])=>key!=='system')))}]})}catch(error){if(attempt===0&&error.retryable){onRetry();await new Promise(resolve=>setTimeout(resolve,500));continue}throw error}
  const choice=result.choices?.[0];const value=choice?.message?.content;
  const content=Array.isArray(value)?value.filter(p=>p.type==='text'&&typeof p.text==='string').map(p=>p.text).join('\n'):String(value||'');
  if(choice?.finish_reason!=='length'&&content.trim())return content;
  if(attempt===0){onRetry();if(choice?.finish_reason==='length')maxTokens=16384;continue}
  throw new SummaryFailure(choice?.finish_reason==='length'?'truncated':'empty','Модель не вернула полный ответ. Текст материала сохранён. Повторите анализ.');
 }
 throw new SummaryFailure('empty','Модель не вернула ответ.');
}
