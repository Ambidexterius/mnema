import React,{useEffect,useRef,useState} from 'react';
import {Button,Dialog,Select,TextArea,TextInput} from '@gravity-ui/uikit';
import {api} from './api.ts';
import type {ModelConnection} from './types.ts';

const providers=[{value:'openai',content:'OpenAI — модели GPT'},{value:'anthropic',content:'Claude — Anthropic'},{value:'deepseek',content:'DeepSeek API'},{value:'compatible',content:'Совместимый API'}];
const urls={openai:'https://api.openai.com/v1',anthropic:'https://api.anthropic.com/v1',deepseek:'https://api.deepseek.com/v1',compatible:''};
const labels={openai:'OpenAI',anthropic:'Claude',deepseek:'DeepSeek',compatible:'Совместимый API'};
export const UX_RESEARCHER_RULES='Отвечай как UX-исследователь. Начинай с короткого ответа на вопрос. Пиши простым русским языком: конкретный участник, его действие, трудность и последствие. Отделяй наблюдения, интерпретации и гипотезы. Для каждого содержательного вывода указывай источник. Не считай пожелание участника доказанным решением. Не обобщай единичный случай на всю аудиторию. Отмечай ограничения выборки и противоречия. Если данных не хватает, прямо скажи, чего мы пока не знаем. Не придумывай цитаты, цифры и причинно-следственные связи.';
const providerOf=(model?:ModelConnection)=>model?.apiType==='openai'||model?.url?.includes('api.openai.com')?'openai':model?.apiType==='anthropic'||model?.url?.includes('api.anthropic.com')?'anthropic':model?.url?.includes('api.deepseek.com')?'deepseek':model?'compatible':'openai';
function Field({label,children,help}:{label:string;children:React.ReactNode;help?:string}){return <div className="form-field"><span className="model-field-label">{label}</span>{children}{help?<small>{help}</small>:null}</div>}

export default function ModelConnectionDialog({open,model,ctx,onClose}:{open:boolean;model?:ModelConnection;ctx:any;onClose:()=>void}){
 const [provider,setProvider]=useState('openai'),[name,setName]=useState(''),[identifier,setIdentifier]=useState(''),[url,setURL]=useState('');
 const [apiKey,setAPIKey]=useState(''),[keySource,setKeySource]=useState('api'),[keyRef,setKeyRef]=useState('LLM_KEY_CUSTOM1');
 const [instructions,setInstructions]=useState(''),[models,setModels]=useState<{id:string;name:string}[]>([]),[manual,setManual]=useState(false);
 const [loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState('');const epoch=useRef(0);
 useEffect(()=>{epoch.current++;setAPIKey('');setModels([]);setError('');setLoading(false);setSaving(false);
  if(open){setProvider(providerOf(model));setName(model?.name||'');setIdentifier(model?.model||'');setURL(model?.url||'');setKeySource(model?.hasStoredKey?'api':model?.keyRef?'server':'api');setKeyRef(model?.keyRef||'LLM_KEY_CUSTOM1');setInstructions(model?.instructions||'');setManual(Boolean(model?.model))}
 },[open,model?.id]);
 const apiType=provider==='openai'?'openai':provider==='anthropic'?'anthropic':'compatible';
 const baseURL=provider==='compatible'?url:urls[provider];
 const sameProvider=Boolean(model&&providerOf(model)===provider&&model.url.replace(/\/$/,'')===baseURL.replace(/\/$/,''));
 const savedKey=Boolean(sameProvider&&model?.hasStoredKey);
 const credentials={apiType,url:baseURL,keyRef:keySource==='server'?keyRef:'',...(keySource==='api'&&apiKey.trim()?{apiKey:apiKey.trim()}:{}),...(sameProvider&&model?{connectionId:model.id}:{})};
 const close=()=>{if(!saving){epoch.current++;setAPIKey('');onClose()}};
 const loadModels=async()=>{
  setError('');if(!ctx.real){setError('В локальном демо запрос к провайдеру не отправляется. Укажите ID модели вручную.');setManual(true);return}
  const requestEpoch=++epoch.current;setLoading(true);
  try{const result=await api('/api/models/catalog',credentials);if(requestEpoch!==epoch.current)return;setModels(result.models);setIdentifier(current=>result.models.some(m=>m.id===current)?current:'');setManual(false);if(!result.models.length)setError('Доступные текстовые модели не найдены. Проверьте права ключа или укажите ID вручную.')}
  catch(e){if(requestEpoch===epoch.current)setError(e.message)}finally{if(requestEpoch===epoch.current)setLoading(false)}
 };
 const save=async()=>{
  if(saving)return;setError('');
  if(!identifier.trim()){setError('Выберите модель или укажите её ID.');return}
  if(keySource==='api'&&!apiKey.trim()&&!savedKey){setError('Введите API-ключ.');return}
  const values={name:name.trim()||labels[provider]+' · '+identifier.trim(),model:identifier.trim(),provider:sameProvider?model.provider:labels[provider],...credentials,keySource,instructions:instructions.trim()};
  setSaving(true);
  try{
   if(ctx.real)ctx.receive(await api(model?'/api/models/'+model.id:'/api/models',values,model?'PUT':'POST'));
   else ctx.update(s=>({models:model?s.models.map(m=>m.id===model.id?{...m,name:values.name,model:values.model,provider:values.provider,url:baseURL,apiType,instructions:values.instructions}:m):[...s.models,{id:crypto.randomUUID(),name:values.name,model:values.model,provider:values.provider,url:baseURL,apiType,instructions:values.instructions,keyRef:'',enabled:true,description:'Демо: реальный ключ не сохранён',keyConfigured:false}]}));
   setAPIKey('');ctx.notify(ctx.real?'Подключение сохранено. API-ключ не возвращается в браузер.':'Настройки сохранены в демо. API-ключ не сохранялся.');onClose();
  }catch(e){setError(e.message)}finally{setSaving(false)}
 };
 return <Dialog open={open} onClose={close} size="m" className="model-connection-dialog" aria-label={model?'Настройка модели':'Подключить модель'}>
  <Dialog.Header caption={model?'Настройка модели':'Подключить модель'}/>
  <Dialog.Body><div className="model-connection-form">
   <Field label="Поставщик"><Select width="max" aria-label="Поставщик модели" value={[provider]} options={providers} disabled={saving||loading} onUpdate={v=>{epoch.current++;setProvider(v[0]);setAPIKey('');setModels([]);setIdentifier('');setManual(false);setKeySource('api');setError('')}}/></Field>
   <Field label="Название подключения" help="Можно оставить пустым — используем поставщика и ID модели."><TextInput controlProps={{'aria-label':'Название подключения',maxLength:60}} value={name} onUpdate={setName} disabled={saving} placeholder="Например, Claude для исследований"/></Field>
   {provider==='compatible'?<Field label="Адрес API"><TextInput controlProps={{'aria-label':'Адрес API'}} value={url} onUpdate={v=>{setURL(v);setModels([])}} disabled={saving||loading} placeholder="https://api.example.com/v1"/></Field>:null}
   <Field label="Авторизация"><Select width="max" aria-label="Способ авторизации" value={[keySource]} disabled={saving||loading} options={[{value:'api',content:'API-ключ'},{value:'server',content:'Ключ в настройках сервера'}]} onUpdate={v=>{setKeySource(v[0]);setAPIKey('');setModels([])}}/></Field>
   {keySource==='api'?<Field label="API-ключ" help={savedKey?'Ключ уже сохранён. Оставьте поле пустым, чтобы сохранить его.':'Ключ хранится зашифрованным на сервере. После сохранения не показывается.'}><TextInput type="password" autoComplete="new-password" controlProps={{'aria-label':'API-ключ',maxLength:4096,spellCheck:false}} value={apiKey} onUpdate={v=>{setAPIKey(v);setModels([])}} disabled={saving||loading} placeholder={savedKey?'Ключ сохранён':'Вставьте API-ключ'}/></Field>:<Field label="Серверный ключ"><Select width="max" aria-label="Серверный ключ" value={[keyRef]} disabled={saving||loading} options={['LLM_KEY_DEEPSEEK','LLM_KEY_CUSTOM1','LLM_KEY_CUSTOM2'].map(value=>({value,content:value}))} onUpdate={v=>{setKeyRef(v[0]);setModels([])}}/></Field>}
   <div className="model-catalog-actions"><Button view="outlined" onClick={loadModels} loading={loading} disabled={saving||keySource==='api'&&!apiKey.trim()&&!savedKey}>Загрузить модели</Button><Button view="flat" onClick={()=>setManual(v=>!v)} disabled={saving||loading}>{manual?'Выбрать из списка':'Указать ID вручную'}</Button></div>
   <Field label="Модель" help={provider==='openai'?'Используется API OpenAI. Подписка ChatGPT не заменяет API-ключ. Доступ зависит от прав ключа и региона сервера.':provider==='anthropic'?'Доступ зависит от прав ключа и региона сервера.':undefined}>{manual?<TextInput value={identifier} onUpdate={setIdentifier} disabled={saving} placeholder="ID модели из документации провайдера" controlProps={{'aria-label':'Идентификатор модели',maxLength:120}}/>:<Select width="max" filterable aria-label="Модель провайдера" placeholder={models.length?'Выберите модель':'Сначала загрузите доступные модели'} value={identifier?[identifier]:[]} disabled={saving||loading||!models.length} options={models.map(m=>({value:m.id,content:m.name,text:m.name+' '+m.id}))} onUpdate={v=>setIdentifier(v[0]||'')}/>}</Field>
   <Field label="Правила ответов в чате" help="Применяются в общем чате и проекте. Ссылки на источники, права доступа и форматы сводок задаёт сервис."><TextArea value={instructions} onUpdate={setInstructions} disabled={saving} minRows={4} maxRows={8} placeholder="Как модели анализировать материалы и формулировать ответы" controlProps={{'aria-label':'Правила ответов в чате',maxLength:4000}}/></Field>
   <Button view="outlined" onClick={()=>setInstructions(UX_RESEARCHER_RULES)} disabled={saving}>Шаблон «UX-исследователь»</Button>
   {error?<p role="alert" className="form-error">{error}</p>:null}
  </div></Dialog.Body>
  <Dialog.Footer textButtonCancel="Отмена" onClickButtonCancel={close} textButtonApply="Сохранить подключение" onClickButtonApply={save} propsButtonApply={{loading:saving,disabled:saving||loading}}/>
 </Dialog>;
}
