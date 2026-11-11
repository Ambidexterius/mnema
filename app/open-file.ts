export function openFileWindow(studyId:string,workspaceId:string){
 const url=new URL(location.href);url.search='';if(workspaceId)url.searchParams.set('workspace',workspaceId);url.hash='/file/'+encodeURIComponent(studyId);
 const width=Math.min(840,screen.availWidth),height=Math.min(960,screen.availHeight);
 const left=Math.max(0,Math.min(window.screenX+window.outerWidth,screen.availWidth-width));
 const popup=window.open(url.href,'mnemonika-file-'+studyId,`popup,width=${width},height=${height},left=${left},top=${Math.max(0,window.screenY)}`);
 if(popup){popup.opener=null;popup.focus();return true}return false;
}
