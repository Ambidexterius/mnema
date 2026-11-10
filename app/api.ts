export class ApiError extends Error{status:number;constructor(message:string,status:number){super(message);this.status=status}}
export async function api<T=any>(path:string,body?:unknown,method:string=body===undefined?'GET':'POST'):Promise<T>{
 const response=await fetch(path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json','X-Mnema-Request':'1'},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 let result:any;try{result=await response.json()}catch{throw new Error('Сервер вернул неожиданный ответ. Обновите страницу.')}
 if(!response.ok)throw new ApiError(result.error||result.message||'Не удалось выполнить действие.',response.status);return result;
}

export async function uploadFile(file:File,metadata:Record<string,string>,onProgress:(percent:number)=>void=()=>{}){
 if(!file.size||file.size>2*1024**3)throw new Error('Выберите непустой файл размером до 2 ГБ.');
 const upload=await api('/api/upload-sessions',{name:file.name,mime:file.type,size:file.size,...metadata});
 try{
  let offset=0;
  while(offset<file.size){const end=Math.min(offset+upload.chunkSize,file.size);let done=false;
   for(let attempt=0;attempt<3&&!done;attempt++){
    try{const r=await fetch('/api/upload-sessions/'+upload.id,{method:'PUT',credentials:'same-origin',headers:{'X-Mnema-Request':'1','X-Upload-Offset':String(offset),'Content-Type':'application/octet-stream'},body:file.slice(offset,end)});const raw=await r.text();let data;try{data=JSON.parse(raw)}catch{throw new Error(r.status===413?'Сервер отклонил часть файла.':'Ошибка загрузки HTTP '+r.status)}if(!r.ok)throw new Error(data.error||'Не удалось загрузить часть файла.');offset=data.offset;done=true;onProgress(Math.round(offset/file.size*100))}catch(e){if(attempt===2)throw e;await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)))}
   }
  }
  return await api('/api/upload-sessions/'+upload.id+'/complete',{});
 }catch(e){await api('/api/upload-sessions/'+upload.id,undefined,'DELETE').catch(()=>{});throw e}
}
