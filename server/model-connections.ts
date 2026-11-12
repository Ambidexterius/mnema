import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';

export type ModelAPI='compatible'|'openai'|'anthropic';
export const keySlot=/^LLM_KEY_(DEEPSEEK|CUSTOM1|CUSTOM2)$/;
const official={openai:'https://api.openai.com/v1',anthropic:'https://api.anthropic.com/v1'};
function invalid(message:string,status=400):never{throw Object.assign(new Error(message),{status})}
export function modelBase(model:any){
 const type:ModelAPI=model.apiType||'compatible';
 if(!['compatible','openai','anthropic'].includes(type))invalid('Выберите поставщика модели.');
 if(type!=='compatible')return official[type];
 let url:URL;try{url=new URL(model.url)}catch{invalid('Укажите корректный адрес API.')}
 const allowed=(process.env.LLM_ALLOWED_HOSTS||'api.deepseek.com,api.openai.com,openrouter.ai').split(',').map(x=>x.trim());
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.port&&!['443'].includes(url.port)||!allowed.includes(url.hostname))invalid('Этот адрес API не разрешён на сервере. Добавьте домен в LLM_ALLOWED_HOSTS.');
 return url.href.replace(/\/$/,'');
}
export function cleanModel(value:any,previous?:any,allowEmpty=false){
 if(!value||typeof value!=='object')invalid('Проверьте параметры подключения.');
 const name=String(value.name??previous?.name??'').trim(),model=String(value.model??previous?.model??'').trim();
 const instructions=String(value.instructions??previous?.instructions??'').trim();
 if(!name||name.length>60||!model&&!allowEmpty||model.length>120||instructions.length>4000)invalid('Укажите название до 60 символов, ID модели до 120 и правила до 4000 символов.');
 const apiType=value.apiType??previous?.apiType??'compatible';
 const keyRef=value.keyRef??previous?.keyRef??'';
 if(keyRef&&!keySlot.test(keyRef))invalid('Выберите допустимый серверный ключ.');
 const result={id:previous?.id||String(value.id||''),name,model,apiType,keyRef,
  url:modelBase({...value,apiType}),provider:String(value.provider??previous?.provider??'Совместимый API').slice(0,60),
  enabled:Boolean(value.enabled??previous?.enabled??true),description:String(value.description??previous?.description??'Подключение по API').slice(0,240),instructions,
  ...(previous?.builtin?{builtin:true}:{})};
 return result;
}
/** Only ciphertext is persisted. Workspace/model AAD prevents moving a key to another connection. */
export function modelKeyStore(db:any,secret:string){
 const key=createHash('sha256').update('mnemonika-model-keys-v1\0'+secret).digest();
 db.exec('CREATE TABLE IF NOT EXISTS mnema_model_keys(workspace_id TEXT NOT NULL,model_id TEXT NOT NULL,sealed TEXT NOT NULL,PRIMARY KEY(workspace_id,model_id),FOREIGN KEY(workspace_id) REFERENCES mnema_workspaces(id) ON DELETE CASCADE)');
 const aad=(workspace:string,id:string)=>Buffer.from(JSON.stringify([workspace,id]));
 return {
  has:(workspace:string,id:string)=>Boolean(db.prepare('SELECT 1 FROM mnema_model_keys WHERE workspace_id=? AND model_id=?').get(workspace,id)),
  get(workspace:string,id:string):string|null{
   const row=db.prepare('SELECT sealed FROM mnema_model_keys WHERE workspace_id=? AND model_id=?').get(workspace,id);if(!row)return null;
   try{const data=Buffer.from(row.sealed,'base64');const decipher=createDecipheriv('aes-256-gcm',key,data.subarray(0,12));decipher.setAAD(aad(workspace,id));decipher.setAuthTag(data.subarray(12,28));return Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString()}
   catch{invalid('Не удалось прочитать сохранённый API-ключ. Введите его заново.',503)}
  },
  set(workspace:string,id:string,value:string){
   if(!/^[\x21-\x7e]{8,4096}$/.test(value))invalid('Проверьте API-ключ: пробелы и переносы строк не допускаются.');
   const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(aad(workspace,id));
   const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
   db.prepare('INSERT INTO mnema_model_keys VALUES(?,?,?) ON CONFLICT(workspace_id,model_id) DO UPDATE SET sealed=excluded.sealed').run(workspace,id,Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64'));
  },
  remove:(workspace:string,id:string)=>db.prepare('DELETE FROM mnema_model_keys WHERE workspace_id=? AND model_id=?').run(workspace,id),
 };
}
export function providerHeaders(model:any,key:string){return {'Content-Type':'application/json',Authorization:'Bearer '+key,...(model.apiType==='anthropic'?{'anthropic-version':'2026-10-21'}:{})}}
export function providerRequest(model:any,payload:any){
 const base=modelBase(model),messages=payload.messages||[];
 if(model.apiType==='anthropic')return {url:base+'/messages',body:{model:payload.model,max_tokens:payload.max_tokens,stream:false,system:messages.filter(m=>m.role==='system').map(m=>m.content).join('\n'),messages:messages.filter(m=>m.role!=='system')}};
 if(model.apiType==='openai')return {url:base+'/responses',body:{model:payload.model,store:false,max_output_tokens:payload.max_tokens,input:messages.map(m=>({...m,role:m.role==='system'?'developer':m.role}))}};
 return {url:base+'/chat/completions',body:{...payload,stream:false}};
}
export function providerResult(model:any,result:any){
 if(model.apiType==='anthropic'){const content=(result.content||[]).filter(p=>p.type==='text'&&typeof p.text==='string').map(p=>p.text).join('\n');return {choices:[{message:{content},finish_reason:result.stop_reason==='max_tokens'?'length':'stop'}],usage:{total_tokens:(result.usage?.input_tokens||0)+(result.usage?.output_tokens||0),completion_tokens:result.usage?.output_tokens||0}}}
 if(model.apiType==='openai'){const content=(result.output||[]).filter(p=>p.type==='message').flatMap(p=>p.content||[]).filter(p=>p.type==='output_text'&&typeof p.text==='string').map(p=>p.text).join('\n');return {choices:[{message:{content},finish_reason:result.status==='incomplete'?'length':result.status==='failed'?'error':'stop'}],usage:{...result.usage,completion_tokens:result.usage?.output_tokens||0}}}
 return result;
}
export async function availableModels(model:any,key:string,fetcher:typeof fetch){
 const base=modelBase(model),models:Map<string,{id:string;name:string}>=new Map();let after='';
 for(let page=0;page<3;page++){
  const suffix=model.apiType==='anthropic'?'?limit=100'+(after?'&after_id='+encodeURIComponent(after):''):'';
  let response:Response;try{response=await fetcher(base+'/models'+suffix,{headers:providerHeaders(model,key),redirect:'error',signal:AbortSignal.timeout(20000)})}catch{invalid('Не удалось загрузить модели. Проверьте соединение с провайдером.',502)}
  if(!response.ok)invalid('Провайдер вернул HTTP '+response.status+'. '+(response.status===403?'Проверьте права ключа, доступ к модели и регион сервера.':'Проверьте API-ключ и доступ к моделям.'),502);
  let result:any;try{result=await response.json()}catch{invalid('Провайдер вернул неожиданный список моделей.',502)}
  if(!Array.isArray(result.data))invalid('Провайдер вернул неожиданный список моделей.',502);
  for(const item of result.data){if(typeof item.id!=='string'||item.id.length>120)continue;
   if(model.apiType==='openai'&&(!/^(gpt-|o\d|chatgpt-)/.test(item.id)||/(embed|image|audio|realtime|transcrib|tts|codex)/i.test(item.id)))continue;
   if(item.lifecycle==='retired'||item.shutdown_date&&Date.parse(item.shutdown_date)<=Date.now())continue;
   models.set(item.id,{id:item.id,name:String(item.display_name||item.id).slice(0,160)});
  }
  if(model.apiType!=='anthropic'||!result.has_more||!result.last_id)break;after=result.last_id;
 }
 return [...models.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
export function answerSystem(base:string,instructions?:string){return base+'\nПиши простыми русскими фразами: кто, что делает и с какой трудностью сталкивается. Не заменяй действия отглагольными существительными. Не используй пустые ярлыки «Проблема 1», «Проблема 2». Формулируй вывод законченным предложением.'+(instructions?'\nДополнительные правила стиля и исследовательского подхода:\n'+instructions:'')+'\nОбязательные правила сервиса имеют приоритет: только доступные источники, ссылки [N], никаких вымышленных данных или цитат; отделяй гипотезы от наблюдений. Сохраняй заданную структуру ответа и ограничения выборки.'}
/** A cut-off generation must never be presented as a finished research answer. */
export async function requestChatAnswer(model:any,payload:any,call:(payload:any)=>Promise<any>){
 for(let attempt=0;attempt<2;attempt++){
  const result=await call({...payload,max_tokens:attempt?8192:4096,...(/deepseek/i.test(model.model)?{thinking:{type:'disabled'},reasoning_effort:'none'}:{})});
  const choice=result.choices?.[0];if(choice?.finish_reason==='length')continue;
  if(choice?.finish_reason!=='error'&&typeof choice?.message?.content==='string'&&choice.message.content.trim()){
   if(choice.message.content.length>32000)invalid('Ответ получился слишком длинным. Задайте более узкий вопрос.',502);
   return result;
  }
  invalid('Модель не вернула полный ответ. Повторите вопрос.',502);
 }
 invalid('Ответ остановился по лимиту модели. Сократите вопрос или выберите другую модель.',502);
}
