// Internal screen names stay stable while public URLs include the project.
export function readRoute(url:URL){
 const legacy=url.hash.startsWith('#/');
 let path=legacy?url.hash.slice(2):url.pathname.replace(/^\//,'');
 const [pathname,query='']=path.split('?');
 const parts=pathname.split('/');let workspace=url.searchParams.get('workspace');
 path=pathname||'chat';
 if(!legacy&&parts[0]==='projects'){
  if(parts.length===1)path='research';
  else{try{workspace=decodeURIComponent(parts[1])}catch{workspace=parts[1]}path=parts.slice(2).join('/')||'home';
   if(path==='research')path='library';
   else if(path.startsWith('studies/'))path='study/'+path.slice(8);
   else if(path.startsWith('findings/'))path='finding/'+path.slice(9);
  }
 }
 if(path==='overview')path='home';
 if(path==='processing')path='models';
 if(path==='settings/mcp')path='mcp';
 if(url.pathname==='/mcp/consent')path='mcp-consent';
 if(url.pathname==='/mcp/login'&&url.searchParams.has('sig'))path='login';
 const routeQuery=legacy?query:path==='findings'?url.search.slice(1):'';
 return {route:path+(routeQuery?'?'+routeQuery:''),workspace};
}

export function routeHref(route:string,workspace?:string|null){
 const [screen,query='']=route.replace(/^#?\//,'').split('?');
 let path=screen==='research'||screen==='projects'?'projects':screen==='mcp'?'settings/mcp':screen;
 const projectScreen=['home','overview','library','findings','models','processing','integrations','mcp'].includes(screen)||/^(study|finding|file)\//.test(screen);
 if(workspace&&projectScreen){
  path=screen==='home'||screen==='overview'?'':screen==='library'?'research':screen==='processing'?'models':screen.replace(/^study\//,'studies/').replace(/^finding\//,'findings/');
  path='projects/'+encodeURIComponent(workspace)+(path?'/'+path:'');
 }
 return '/'+path+(query?'?'+query:'');
}

let currentWorkspace:string|null=null;
export const setRouteWorkspace=(id:string|null)=>{currentWorkspace=id};
export const appHref=(route:string)=>routeHref(route,currentWorkspace);
export const appRoute=()=>readRoute(new URL(location.href)).route;
export const requestedWorkspace=()=>readRoute(new URL(location.href)).workspace;
export function canonicalHref(url:URL,workspace?:string|null){
 const target=new URL(routeHref(readRoute(url).route,workspace),url.origin);
 for(const [key,value]of url.searchParams)if(key!=='workspace'&&!target.searchParams.has(key))target.searchParams.append(key,value);
 return target.pathname+target.search;
}
export function canonicalizeRoute(){
 if(location.pathname==='/mcp/login'||location.pathname==='/mcp/consent')return;
 history.replaceState(null,'',canonicalHref(new URL(location.href),currentWorkspace));
}
export function navigate(route:string,replace=false){
 const href=appHref(route);if(location.pathname+location.search+location.hash===href)return;
 history[replace?'replaceState':'pushState'](null,'',href);window.dispatchEvent(new PopStateEvent('popstate'));
}
