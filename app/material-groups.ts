// One interview often arrives as a recording plus its text, sometimes with a «(1)» copy: they share a row.
export const materialName=(title:string)=>title.trim().replace(/\.[a-z0-9]{1,5}$/i,'').replace(/\s*\(\d+\)$/,'');
/** Groups materials with the same name, keeping the order of the first file of each group. */
export function groupMaterials<T extends {title:string}>(list:T[]):T[][]{
 const groups=new Map<string,T[]>();
 for(const s of list){const k=materialName(s.title).toLocaleLowerCase('ru');groups.set(k,[...(groups.get(k)||[]),s])}
 return [...groups.values()];
}
