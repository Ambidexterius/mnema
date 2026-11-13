let activeWorkspace:string|null=null;
export const setApiWorkspace=(id:string|null)=>{activeWorkspace=id};
export const projectFile=(id:string)=>'/api/files/'+encodeURIComponent(id)+(activeWorkspace?'?workspace='+encodeURIComponent(activeWorkspace):'');
/** Same file, served as an attachment so the browser saves it instead of opening it. */
export const projectFileDownload=(id:string)=>projectFile(id)+(activeWorkspace?'&':'?')+'download=1';
export class ApiError extends Error{status:number;code?:string;constructor(message:string,status:number,code?:string){super(message);this.status=status;this.code=code}}
export async function api<T=any>(path:string,body?:unknown,method:string=body===undefined?'GET':'POST',useWorkspace=true):Promise<T>{
 const response=await fetch(path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json','X-Mnema-Request':'1',...(useWorkspace&&activeWorkspace?{'X-Mnema-Workspace':activeWorkspace}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 let result:any;try{result=await response.json()}catch{throw new Error('Сервер вернул неожиданный ответ. Обновите страницу.')}
 if(!response.ok)throw new ApiError(result.error||result.message||'Не удалось выполнить действие.',response.status,result.code);return result;
}
export type UploadControl={
 signal?:AbortSignal;
 onSession?:(discard:()=>Promise<any>)=>void;
 onSaving?:()=>void;
};
export async function uploadFile(file:File,metadata:Record<string,unknown>,onProgress:(percent:number)=>void,control:UploadControl={}){
 const {signal}=control;
 if(!file.size||file.size>2*1024**3)throw new Error('Выберите непустой файл до 2 ГБ.');
 const workspace=String(metadata.workspaceId||activeWorkspace||'');
 if(!workspace)throw new Error('Выберите проект для загрузки.');
 const request=(path:string,body?:unknown,method=body===undefined?'GET':'POST')=>
   api(path+'?workspace='+encodeURIComponent(workspace),body,method,false);
 const sample=await new Blob([file.slice(0,65536),file.slice(Math.max(0,file.size-65536))]).arrayBuffer();
 const signature=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',sample))).map(x=>x.toString(16).padStart(2,'0')).join('');
 const key='mnemonio.upload.'+workspace+'.'+encodeURIComponent(file.name)+'.'+file.size+'.'+file.lastModified+'.'+signature;
 const clear=()=>{try{localStorage.removeItem(key)}catch{}};
 let storedId:string|undefined;
 try{storedId=JSON.parse(localStorage.getItem(key)||'null')?.id}catch{}
 let upload:any;
 if(storedId){
   try{upload=await request('/api/upload-sessions/'+encodeURIComponent(storedId))}
   catch(e){if(e.status!==404)throw e;clear()}
 }
 const ready=async(id:string)=>({...await request('/api/state'),createdStudyId:id});
 if(upload?.completedStudyId){const result=await ready(upload.completedStudyId);clear();return result}
 if(!upload){
   signal?.throwIfAborted();
   // Receive the ID even when the user cancels during creation, so we can release the reservation.
   upload=await request('/api/upload-sessions',{name:file.name,mime:file.type,size:file.size,...metadata});
   try{localStorage.setItem(key,JSON.stringify({id:upload.id}))}catch{}
 }
 const path='/api/upload-sessions/'+encodeURIComponent(upload.id);
 control.onSession?.(async()=>{
   for(let attempt=0;;attempt++){
     try{await request(path,undefined,'DELETE');clear();return null}
     catch(e){
       if(e.status===404){clear();return null}
       if(e.status!==409||attempt>=8)throw e;
       const status=await request(path);
       if(status.completedStudyId){const result=await ready(status.completedStudyId);clear();return result}
       await new Promise(r=>setTimeout(r,200));
     }
   }
 });
 signal?.throwIfAborted();
 let offset=upload.offset||0;onProgress(Math.round(offset/file.size*100));
 while(offset<file.size){
   const end=Math.min(offset+upload.chunkSize,file.size);
   for(let attempt=0;;attempt++){
     signal?.throwIfAborted();
     try{
       const response=await fetch(path,{method:'PUT',credentials:'same-origin',signal,headers:{'X-Mnema-Request':'1','X-Mnema-Workspace':workspace,'X-Upload-Offset':String(offset),'Content-Type':'application/octet-stream'},body:file.slice(offset,end)});
       const data=await response.json();
       if(!response.ok)throw new ApiError(data.error||'Не удалось передать часть файла.',response.status);
       if(!Number.isSafeInteger(data.offset)||data.offset<end||data.offset>file.size)throw new Error('Сервер вернул неверную позицию загрузки.');
       offset=data.offset;onProgress(Math.round(offset/file.size*100));break;
     }catch(e){
       signal?.throwIfAborted();
       if(attempt>=2||[401,403,404,413].includes(e.status))throw e;
       await new Promise(r=>setTimeout(r,300*(attempt+1)));
     }
   }
 }
 signal?.throwIfAborted();control.onSaving?.();
 const result=await request(path+'/complete',{});clear();return result;
}
