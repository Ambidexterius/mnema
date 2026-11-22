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
 const routeQuery=legacy?query:path==='findings'||path==='all-findings'?url.search.slice(1):'';
 return {route:path+(routeQuery?'?'+routeQuery:''),workspace};
}

export const projectExtensionRoutes=new Set<string>();

export function routeHref(route:string,workspace?:string|null){
 const [screen,query='']=route.replace(/^#?\//,'').split('?');
 let path=screen==='research'||screen==='projects'?'projects':screen==='mcp'?'settings/mcp':screen;
 const projectScreen=['home','overview','library','findings','models','processing','integrations','mcp'].includes(screen)||projectExtensionRoutes.has(screen)||/^(study|finding|file)\//.test(screen);
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
 history.replaceState(history.state,'',canonicalHref(new URL(location.href),currentWorkspace));
}
export interface NavigationState{app?:number;previous?:string;findingsRoot?:string;returnTo?:string;scrollTop?:number;findingsScroll?:number}
export function navigationState(current:URL,next:URL,previous:NavigationState={}):NavigationState{
 const before=readRoute(current),after=readRoute(next),path=current.pathname+current.search;
 const beforeScreen=before.route.split('?')[0];
 const finding=after.route.startsWith('finding/'),material=after.route.startsWith('study/');
 const settings=['models','integrations','mcp','users','feedback'].includes(after.route);
 let findingsRoot:string|undefined;
 if(finding||material||settings){
  findingsRoot=beforeScreen==='all-findings'||beforeScreen==='findings'?path:previous.findingsRoot;
  if(finding&&!findingsRoot)findingsRoot=routeHref('findings',after.workspace||before.workspace);
 }
 const findingsScroll=beforeScreen==='all-findings'||beforeScreen==='findings'?previous.scrollTop:previous.findingsScroll;
 const returningToList=previous.findingsRoot===next.pathname+next.search;
 return {app:1,previous:path,...(findingsRoot?{findingsRoot,findingsScroll:findingsScroll||0}:{}),...(returningToList?{scrollTop:previous.findingsScroll||0}:{}),...(material?{returnTo:path}:{})};
}
export function restoreRouteScroll(){const top=history.state?.scrollTop;if(Number.isFinite(top)&&top>=0)requestAnimationFrame(()=>document.querySelector('.content-shell')?.scrollTo({top}))}
export function navigateHref(href:string,replace=false,animateStudy=false){
 const current=new URL(location.href),next=new URL(href,current);
 if(next.origin!==current.origin)throw new Error('Внутренний переход должен оставаться в Мнемодаке.');
 const target=next.pathname+next.search+next.hash;
 if(current.pathname+current.search+current.hash===target)return;
 if(readRoute(current).route.startsWith('study/')&&history.state?.returnTo===target){history.back();return}
 history.replaceState({...history.state,scrollTop:document.querySelector('.content-shell')?.scrollTop||0},'');
 history[replace?'replaceState':'pushState'](navigationState(current,next,history.state||{}),'',target);
 window.dispatchEvent(new PopStateEvent('popstate',{state:animateStudy&&readRoute(next).route.startsWith('study/')?{animateStudy:true}:null}));
}
export function navigate(route:string,replace=false,animateStudy=false){navigateHref(appHref(route),replace,animateStudy)}

/** Auth return is limited to a project on this origin; never accept an external redirect. */
export function projectReturnPath(url:URL):string|null{
 let target:URL;
 try{target=url.searchParams.has('returnTo')?new URL(url.searchParams.get('returnTo')||'',url.origin):url}catch{return null}
 if(target.origin!==url.origin||!target.pathname.startsWith('/projects/')||!readRoute(target).workspace)return null;
 target=new URL(target);target.searchParams.delete('returnTo');return target.pathname+target.search;
}
export function authPageHref(path:string,url=new URL(location.href)){
 const target=new URL(path,url.origin),back=projectReturnPath(url);if(back)target.searchParams.set('returnTo',back);return target.pathname+target.search;
}
