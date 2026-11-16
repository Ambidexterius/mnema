import {useEffect,useState} from 'react';
export const MOBILE_WEB_QUERY='(max-width:959px), (pointer:coarse)';
export function useCompactLayout(query='(max-width:959px)'){
 const [compact,setCompact]=useState(()=>matchMedia(query).matches);
 useEffect(()=>{const media=matchMedia(query),update=()=>setCompact(media.matches);media.addEventListener('change',update);return()=>media.removeEventListener('change',update)},[query]);
 return compact;
}
