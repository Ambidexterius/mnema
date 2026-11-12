import type {Study} from '../app/types.ts';
import {selectEvidence} from './retrieval.ts';
interface Project{id:string;name:string;role:'view'|'full';admin:boolean}
export function collectGlobalResearch(person:{workspaceId:string|null;workspaces:Project[]},read:(project:Project)=>any){
 const studies:any[]=[];const groups:any[][]=[];const sourceHints:any[]=[];let model:any=null,modelWorkspaceId:string|null=null;
 const projects=[...person.workspaces].sort((a,b)=>Number(b.id===person.workspaceId)-Number(a.id===person.workspaceId));
 for(const project of projects){const state=read(project);const selected=state.models.find(m=>m.id===state.modelId&&m.enabled&&m.keyConfigured)||state.models.find(m=>m.enabled&&m.keyConfigured);if(!model&&selected){model=selected;modelWorkspaceId=project.id}
  groups.push(state.studies.map(study=>({...study,actualStudyId:study.id,id:project.id+':'+study.id,workspaceId:project.id,workspaceName:project.name})));
  sourceHints.push(...(state.findings||[]).map(f=>({...f,studyId:project.id+':'+f.studyId})));
 }
 // Interleave projects before evidence sampling so a large project cannot take every slot.
 for(let index=0;groups.some(group=>group[index]);index++)for(const group of groups)if(group[index])studies.push(group[index]);
 return{studies,model,modelWorkspaceId,sourceHints,projects:projects.length,materials:studies.filter(s=>s.status==='ready'&&s.segments?.length).length};
}
export function globalEvidence(research:ReturnType<typeof collectGlobalResearch>,question:string){
 const selected=selectEvidence(research.studies as Study[],question,'all',research.sourceHints);
 return{coverage:{...selected.coverage,totalProjects:new Set(research.studies.filter(s=>s.status==='ready'&&s.segments?.length).map(s=>s.workspaceId)).size,projects:new Set(selected.sources.map(s=>research.studies.find(m=>m.id===s.studyId)?.workspaceId)).size},sources:selected.sources.map(({score,...source},i)=>{const material=research.studies.find(s=>s.id===source.studyId)!;return{...source,number:i+1,segmentId:source.id,studyId:material.actualStudyId,workspaceId:material.workspaceId,workspaceName:material.workspaceName,studyType:material.type,basis:material.report==='ready'?'report':'raw'}})};
}
