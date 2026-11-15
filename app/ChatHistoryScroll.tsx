import {useLayoutEffect,useRef,useState,type ReactNode} from 'react';

export default function ChatHistoryScroll({children}:{children:ReactNode}){
 const viewport=useRef<HTMLDivElement>(null),content=useRef<HTMLDivElement>(null);
 const [moreBelow,setMoreBelow]=useState(false);
 useLayoutEffect(()=>{
  const box=viewport.current,items=content.current;
  const update=()=>setMoreBelow(box.scrollHeight-box.clientHeight-box.scrollTop>1);
  const observer=new ResizeObserver(update);observer.observe(box);observer.observe(items);
  box.addEventListener('scroll',update,{passive:true});update();
  return()=>{observer.disconnect();box.removeEventListener('scroll',update)};
 },[]);
 return <div className="chat-history-scroll" data-more-below={moreBelow||undefined}>
  <div className="project-list recent-chats" ref={viewport}><div className="recent-chats-content" ref={content}>{children}</div></div>
 </div>;
}
