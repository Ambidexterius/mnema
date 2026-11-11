// Lexical grouping of similar findings: shows how often a conclusion repeats across materials.
// A heuristic by shared word stems, not a semantic match: the interface says so next to the number.
export interface RepeatInput {id:string;studyId:string;title:string;status?:string}
export interface RepeatInfo {materials:number;similar:string[]}
const STOP=new Set(['котор','такой','также','может','могут','будет','очень','этого','этому','после','перед','между','когда','чтобы','потом','тольк','более','менее','свой','своей','своих','пользо','респон','участ','нужно','нужна','нужен','всего','всегда','почти','через','какой','какие','какая','хотя','если','либо','даже','около','далее']);
/** Word stems of a finding title: words from 4 letters, cut to 5 letters so that case endings do not matter. */
export function findingStems(title:string):Set<string>{
 const words=String(title||'').toLowerCase().replace(/ё/g,'е').match(/[a-zа-я0-9]{4,}/g)||[];
 return new Set(words.map(w=>w.slice(0,5)).filter(w=>!STOP.has(w)));
}
/** Similar when at least three stems are shared and they cover half of the shorter title. */
export function similarStems(a:Set<string>,b:Set<string>):boolean{
 if(a.size<3||b.size<3)return false;let shared=0;for(const w of a)if(b.has(w))shared++;
 return shared>=3&&shared/Math.min(a.size,b.size)>=.5;
}
/** For each finding: similar findings in the same list and the number of distinct materials they come from. Rejected findings are ignored. */
export function findingRepeats(findings:RepeatInput[]):Map<string,RepeatInfo>{
 const live=findings.filter(f=>f.status!=='rejected').map(f=>({f,stems:findingStems(f.title)}));
 const result=new Map<string,RepeatInfo>(findings.map(f=>[f.id,{materials:1,similar:[]}]));
 for(let i=0;i<live.length;i++)for(let j=i+1;j<live.length;j++)if(similarStems(live[i].stems,live[j].stems)){result.get(live[i].f.id)!.similar.push(live[j].f.id);result.get(live[j].f.id)!.similar.push(live[i].f.id)}
 const study=new Map(findings.map(f=>[f.id,f.studyId]));
 for(const [id,info] of result)info.materials=new Set([study.get(id),...info.similar.map(x=>study.get(x))]).size;
 return result;
}
