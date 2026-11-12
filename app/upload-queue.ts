import {uploadFile} from './api.ts';

export type UploadItem={file:File;title:string;type:string;project:string;autoSummary:boolean};
type State='queued'|'uploading'|'saving'|'ready'|'error'|'cancelling'|'cancel-error'|'cancelled';
export type UploadRow={id:string;name:string;size:number;percent:number;state:State;error?:string;studyId?:string};
type Source={item:UploadItem;workspace:string;key:string;discard?:()=>Promise<any>};
export const fileKey=(file:File)=>JSON.stringify([file.name,file.size,file.lastModified]);

export class UploadQueue{
 private rows:UploadRow[]=[];
 private sources=new Map<string,Source>();
 private listeners=new Set<()=>void>();
 private active?:{id:string;controller:AbortController};
 private saved:(result:any)=>void;
 private transfer:typeof uploadFile;
 constructor(saved:(result:any)=>void,transfer=uploadFile){this.saved=saved;this.transfer=transfer}
 snapshot=()=>this.rows;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return ()=>{this.listeners.delete(listener)}};
 get busy(){return this.rows.some(r=>['queued','uploading','saving','cancelling'].includes(r.state))}
 private emit(){for(const listener of this.listeners)listener()}
 private patch(id:string,values:Partial<UploadRow>){
   this.rows=this.rows.map(row=>row.id===id?{...row,...values}:row);this.emit();
 }
 add(items:UploadItem[],workspace:string){
   for(const item of items){
     const key=fileKey(item.file);
     if([...this.sources.values()].some(s=>s.key===key&&s.workspace===workspace))continue;
     const id=crypto.randomUUID();
     this.sources.set(id,{item,workspace,key});
     this.rows=[...this.rows,{id,name:item.file.name,size:item.file.size,state:'queued',percent:0}];
   }
   this.emit();void this.pump();
 }
 private finish(id:string,result:any){
   if(!this.sources.has(id))return;
   this.sources.delete(id);
   this.patch(id,{state:'ready',percent:100,studyId:result.createdStudyId});this.saved(result);
 }
 private async discard(id:string,source:Source){
   try{
     const completed=await source.discard?.();
     if(completed){this.finish(id,completed);return}
     this.sources.delete(id);this.patch(id,{state:'cancelled'});
   }catch{this.patch(id,{state:'cancel-error',error:'Не удалось отменить загрузку. Повторите отмену.'})}
 }
 private async pump(){
   if(this.active)return;
   const row=this.rows.find(r=>r.state==='queued');if(!row)return;
   const source=this.sources.get(row.id)!;
   const controller=new AbortController();
   this.active={id:row.id,controller};this.patch(row.id,{state:'uploading',error:undefined});
   try{
     const {file,...fields}=source.item;
     const result=await this.transfer(file,{...fields,autoProcess:true,workspaceId:source.workspace},
       percent=>this.patch(row.id,{percent}),{signal:controller.signal,onSession:fn=>{source.discard=fn},onSaving:()=>this.patch(row.id,{state:'saving'})});
     this.finish(row.id,result);
   }catch(e){
     if(controller.signal.aborted)await this.discard(row.id,source);
     else this.patch(row.id,{state:'error',error:e.message||'Не удалось загрузить файл.'});
   }finally{this.active=undefined;void this.pump()}
 }
 cancel(id:string){
   const row=this.rows.find(r=>r.id===id),source=this.sources.get(id);
   if(!row||!source||!['queued','uploading','error','cancel-error'].includes(row.state))return;
   this.patch(id,{state:'cancelling'});
   if(this.active?.id===id)this.active.controller.abort();
   else void this.discard(id,source);
 }
 retry(id:string){if(this.rows.find(r=>r.id===id)?.state==='error'){this.patch(id,{state:'queued'});void this.pump()}}
 clear(){if(!this.busy){this.rows=[];this.sources.clear();this.emit()}}
 dispose(){this.active?.controller.abort();this.rows=[];this.sources.clear();this.emit()}
}
