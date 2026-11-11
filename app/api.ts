let activeWorkspace:string|null=null;
export const setApiWorkspace=(id:string|null)=>{activeWorkspace=id};
export const projectFile=(id:string)=>'/api/files/'+encodeURIComponent(id)+(activeWorkspace?'?workspace='+encodeURIComponent(activeWorkspace):'');
export class ApiError extends Error{status:number;constructor(message:string,status:number){super(message);this.status=status}}
export async function api<T=any>(path:string,body?:unknown,method:string=body===undefined?'GET':'POST'):Promise<T>{
 const response=await fetch(path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json','X-Mnema-Request':'1',...(activeWorkspace?{'X-Mnema-Workspace':activeWorkspace}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 let result:any;try{result=await response.json()}catch{throw new Error('Сервер вернул неожиданный ответ. Обновите страницу.')}
 if(!response.ok)throw new ApiError(result.error||result.message||'Не удалось выполнить действие.',response.status);return result;
}
export async function uploadFile(file:File,metadata:Record<string,unknown>,onProgress:(percent:number)=>void=()=>{}){
 if(!file.size||file.size>2*1024**3)throw new Error('Выберите непустой файл размером до 2 ГБ.');
 const sample=await new Blob([file.slice(0,65536),file.slice(Math.max(0,file.size-65536))]).arrayBuffer();const signature=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',sample))).map(x=>x.toString(16).padStart(2,'0')).join('');
 const key='mnemonio.upload.'+metadata.workspaceId+'.'+encodeURIComponent(file.name)+'.'+file.size+'.'+file.lastModified+'.'+signature;
 let upload:any;try{const stored=JSON.parse(localStorage.getItem(key)||'null');if(stored){try{upload=await api('/api/upload-sessions/'+stored.id)}catch(e){if(e.status!==404)throw e;localStorage.removeItem(key)}}}catch(e){if(e instanceof SyntaxError)localStorage.removeItem(key);else throw e}
 if(upload?.completedStudyId){const result=await api('/api/state');localStorage.removeItem(key);return {...result,createdStudyId:upload.completedStudyId}}
 if(!upload){upload=await api('/api/upload-sessions',{name:file.name,mime:file.type,size:file.size,...metadata});try{localStorage.setItem(key,JSON.stringify({id:upload.id}))}catch{}}
 let offset=upload.offset||0;onProgress(Math.round(offset/file.size*100));
 while(offset<file.size){const end=Math.min(offset+upload.chunkSize,file.size);let done=false;
  for(let attempt=0;attempt<3&&!done;attempt++){
   try{const r=await fetch('/api/upload-sessions/'+upload.id,{method:'PUT',credentials:'same-origin',headers:{'X-Mnema-Request':'1',...(metadata.workspaceId?{'X-Mnema-Workspace':String(metadata.workspaceId)}:{}),'X-Upload-Offset':String(offset),'Content-Type':'application/octet-stream'},body:file.slice(offset,end)});let data;try{data=await r.json()}catch{throw new Error(r.status===413?'Сервер отклонил часть файла. Повторите загрузку.':'Не удалось передать часть файла. Проверьте соединение и повторите.')}if(!r.ok)throw new ApiError(data.error||'Не удалось загрузить часть файла. Повторите.',r.status);offset=data.offset;done=true;onProgress(Math.round(offset/file.size*100))}catch(e){if(attempt===2||e.status===401||e.status===403)throw e;await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)))}
  }
 }
 const result=await api('/api/upload-sessions/'+upload.id+'/complete',{});try{localStorage.removeItem(key)}catch{}return result;
}
