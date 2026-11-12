import type {KeyboardEvent} from 'react';
export function submitChatOnEnter(event:KeyboardEvent<HTMLTextAreaElement>){
 if(event.key!=='Enter'||event.shiftKey||event.altKey||event.nativeEvent.isComposing||event.nativeEvent.keyCode===229)return;
 event.preventDefault();
 if(!event.repeat)event.currentTarget.form?.requestSubmit();
}

/** Accept the visible example only from an empty, focused composer. */
export function acceptChatSuggestion(event:KeyboardEvent<HTMLTextAreaElement>,value:string,suggestion:string|undefined,onChange:(text:string)=>void){
 if(event.key!=='Tab'||event.shiftKey||event.altKey||event.ctrlKey||event.metaKey||event.repeat||event.nativeEvent.isComposing||event.nativeEvent.keyCode===229||value.trim()||!suggestion)return false;
 event.preventDefault();onChange(suggestion);return true;
}
