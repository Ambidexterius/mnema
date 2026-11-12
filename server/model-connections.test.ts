import {test} from 'node:test';
import {answerTemplate} from './server.ts';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {modelKeyStore,modelBase,cleanModel,providerHeaders,providerRequest,providerResult,availableModels,answerSystem,requestChatAnswer} from './model-connections.ts';

test('API keys are encrypted, authenticated, isolated by workspace/model and decrypt after restart',()=>{
 const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE mnema_workspaces(id TEXT PRIMARY KEY);INSERT INTO mnema_workspaces VALUES('a'),('b')");
 const store=modelKeyStore(db,'fixture-master-secret-only'),plain='fixture-provider-key-not-real';store.set('a','connection',plain);
 const sealed=String(db.prepare('SELECT sealed FROM mnema_model_keys').get().sealed);
 assert(!sealed.includes(plain));assert.equal(store.get('a','connection'),plain);assert.equal(store.get('b','connection'),null);
 assert.equal(modelKeyStore(db,'fixture-master-secret-only').get('a','connection'),plain);
 assert.throws(()=>modelKeyStore(db,'different-fixture-master-secret').get('a','connection'),/Введите его заново/);
 db.prepare('INSERT INTO mnema_model_keys VALUES(?,?,?)').run('b','connection',sealed);
 assert.throws(()=>store.get('b','connection'),/Введите его заново/);store.remove('a','connection');assert.equal(store.has('a','connection'),false);db.close();
});
test('official providers have fixed origins; custom origins and metadata are validated',()=>{
 assert.equal(modelBase({apiType:'openai',url:'https://evil.example'}),'https://api.openai.com/v1');
 assert.equal(modelBase({apiType:'anthropic'}),'https://api.anthropic.com/v1');
 for(const url of ['http://127.0.0.1/v1','https://evil.example/v1','https://user:pass@api.deepseek.com/v1','https://api.deepseek.com/v1?key=oops'])assert.throws(()=>modelBase({url}));
 const m=cleanModel({id:'fixture',name:'GPT',model:'gpt-fixture',apiType:'openai',url:'https://evil.example',apiKey:'not-persisted',sealed:'not-persisted',instructions:'Коротко'});
 assert.equal(m.url,'https://api.openai.com/v1');assert.equal('apiKey' in m,false);assert.equal('sealed' in m,false);
 assert.throws(()=>cleanModel({...m,instructions:'x'.repeat(4001)}));
});
test('native OpenAI Responses and Claude Messages preserve system instructions and normalise text, usage and cutoff',()=>{
 const payload={model:'fixture',temperature:.2,max_tokens:4096,messages:[{role:'system',content:'Only sources'},{role:'user',content:'Question'}]};
 const openai={apiType:'openai'};const request=providerRequest(openai,payload);
 assert.equal(request.url,'https://api.openai.com/v1/responses');assert.equal(request.body.store,false);assert.equal(request.body.max_output_tokens,4096);
 assert.equal(request.body.input[0].role,'developer');assert.equal('temperature' in request.body,false);
 const claude={apiType:'anthropic'},c=providerRequest(claude,payload);
 assert.equal(c.url,'https://api.anthropic.com/v1/messages');assert.equal(c.body.system,'Only sources');assert.deepEqual(c.body.messages,[payload.messages[1]]);
 assert.equal(providerHeaders(claude,'fixture-key')['anthropic-version'],'2026-10-21');
 const a=providerResult(openai,{status:'incomplete',output:[{type:'reasoning'},{type:'message',content:[{type:'output_text',text:'Answer'}]}],usage:{input_tokens:8,output_tokens:12,total_tokens:20}});
 assert.equal(a.choices[0].message.content,'Answer');assert.equal(a.choices[0].finish_reason,'length');assert.equal(a.usage.total_tokens,20);
 const b=providerResult(claude,{stop_reason:'max_tokens',content:[{type:'thinking',thinking:'private'},{type:'text',text:'Answer'}],usage:{input_tokens:8,output_tokens:12}});
 assert.equal(b.choices[0].message.content,'Answer');assert.equal(b.choices[0].finish_reason,'length');assert.equal(b.usage.total_tokens,20);
});
test('catalogue uses provider credentials, bounds pages and filters non-chat OpenAI models',async()=>{
 const calls:any[]=[];const fetcher=async(url,init)=>{calls.push({url,init});return Response.json({data:[{id:'gpt-fixture'},{id:'text-embedding-fixture'},{id:'gpt-image-fixture'},{id:'gpt-audio-fixture'}]})};
 assert.deepEqual(await availableModels({apiType:'openai'},'fixture-key',fetcher),[{id:'gpt-fixture',name:'gpt-fixture'}]);
 assert.equal(calls[0].init.redirect,'error');assert.equal(calls[0].init.headers.Authorization,'Bearer fixture-key');
 const c=await availableModels({apiType:'anthropic'},'fixture-key',async()=>Response.json({data:[{id:'claude-fixture',display_name:'Claude fixture'}],has_more:true,last_id:'fixture'}));assert.equal(c.length,1);
 await assert.rejects(()=>availableModels({apiType:'openai'},'fixture-key',async()=>new Response('private provider body',{status:401})),/HTTP 401/);
});
test('chat rules keep source constraints, disable DeepSeek thinking and never accept a truncated answer',async()=>{
 const prompt=answerSystem('Service source rules','Как UX-исследователь');assert(prompt.includes('Как UX-исследователь'));assert(prompt.endsWith('Сохраняй заданную структуру ответа и ограничения выборки.'));assert(prompt.includes('Не используй пустые ярлыки'));
 const calls:any[]=[];const full='A'.repeat(17000);
 const result=await requestChatAnswer({model:'deepseek-V4'},{messages:[]},async p=>{calls.push(p);return {choices:[{finish_reason:calls.length===1?'length':'stop',message:{content:calls.length===1?'Незаконченное предло':full}}]}});
 assert.equal(calls.length,2);assert.deepEqual(calls.map(p=>p.max_tokens),[4096,8192]);assert.deepEqual(calls[0].thinking,{type:'disabled'});assert.equal(result.choices[0].message.content.length,17000);
 let count=0;await assert.rejects(()=>requestChatAnswer({model:'fixture'},{},async()=>{count++;return {choices:[{finish_reason:'length',message:{content:'partial'}}]}}),/лимиту/);assert.equal(count,2);
 await assert.rejects(()=>requestChatAnswer({model:'fixture'},{},async()=>({choices:[{finish_reason:'stop',message:{content:'x'.repeat(32001)}}]})),/более узкий/);
});


test('default research instructions separate participant experience from the mentioned counterparty and raw evidence from verification',()=>{
 const custom='Сохраняй наш исследовательский стиль и пиши коротко.';
 const prompt=answerSystem(answerTemplate,custom),mandatory=prompt.slice(prompt.indexOf('Обязательные правила сервиса имеют приоритет:'));
 // The previous rule treated every guest/host mention as a transfer. The actual service
 // template must now ground an unspecified audience in the available participants.
 assert(!answerTemplate.includes('Хозяева и гости, экстранет и гостевой продукт — разные аудитории.'));
 for(const text of [
  'Если аудитория или интерфейс в вопросе не названы явно, отвечай об опыте участников доступных материалов',
  'Рассказ гостя об ответе хозяина — прямые данные о пережитом гостем взаимодействии',
  'не доказывает причины действий хозяина или проблемы его внутреннего интерфейса',
  'basis=raw обозначает исходные реплики, а не отсутствие прямых данных',
  'Статус проверки сводки или находки не меняет происхождение исходной цитаты',
 ])assert(answerTemplate.includes(text),text);
 assert(mandatory.includes('Собственный эпизод участника в basis=raw — прямые данные по теме вопроса'));
 assert(mandatory.includes('другую явно запрошенную аудиторию или продукт'));
 assert(mandatory.includes('Каждое содержательное утверждение и вывод должны иметь ссылку на переданный источник'));
 assert(mandatory.includes('Вопрос интервьюера не является доказательством события'));
 assert(prompt.includes(custom));assert(prompt.indexOf(custom)<prompt.indexOf('Обязательные правила сервиса имеют приоритет:'));
 for(const heading of ['Прямые данные','Перенос и аналогии','Выводы','Что осталось невыясненным'])assert(prompt.includes(heading));
 assert(prompt.includes('только по приложенным фрагментам'));assert(prompt.includes('(по сырым данным)'));assert(prompt.includes('ограничения выборки'));
 // All native adapters must preserve the same grounding and privacy contract.
 const payload={model:'fixture',max_tokens:4096,messages:[{role:'system',content:prompt},{role:'user',content:JSON.stringify({question:'Какие трудности описаны?',sources:[{number:1,basis:'raw',text:'Синтетическая реплика участника.'}]})}]};
 for(const apiType of ['compatible','openai','anthropic']){
  const request=providerRequest({apiType,url:'https://api.deepseek.com/v1'},payload);
  const system=apiType==='anthropic'?request.body.system:apiType==='openai'?request.body.input[0].content:request.body.messages[0].content;
  assert.equal(system,prompt);assert(JSON.stringify(request.body).includes('Синтетическая реплика участника.'));
 }
});
