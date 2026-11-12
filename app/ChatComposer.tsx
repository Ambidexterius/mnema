import React, {useRef} from 'react';
import {Button, TextArea} from '@gravity-ui/uikit';
import {ArrowUp, Library} from 'lucide-react';
import {acceptChatSuggestion,submitChatOnEnter} from './chat-keyboard.ts';

interface ChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => unknown | Promise<unknown>;
  placeholder: string;
  suggestion?: string;
  inputLabel: string;
  sendLabel: string;
  scopeLabel?: string;
  scopeAction?: React.ReactNode;
  modelControl?: React.ReactNode;
  available: boolean;
  loading: boolean;
}

/** One presentation for global and project chat; each caller owns its data scope. */
export default function ChatComposer({value,onChange,onSubmit,placeholder,suggestion,inputLabel,
  sendLabel,scopeLabel,scopeAction,modelControl,available,loading}:ChatComposerProps) {
  const submitting=useRef(false);
  return <form className="composer composer-animated-edge shared-composer"
    onSubmit={async event=>{
      event.preventDefault();
      if(!available||loading||submitting.current||!value.trim())return;
      submitting.current=true;
      try{await onSubmit(value)}finally{submitting.current=false}
    }}>
    <span className="composer-edge" aria-hidden="true"><span className="composer-edge__paint"/></span>
    <TextArea value={value} onUpdate={onChange} onKeyDown={event=>{if(available&&!loading&&acceptChatSuggestion(event,value,suggestion,onChange))return;submitChatOnEnter(event)}}
      disabled={loading} placeholder={placeholder} minRows={2} maxRows={6}
      controlProps={{'aria-label':inputLabel,'aria-keyshortcuts':suggestion?'Tab Enter Shift+Enter':'Enter Shift+Enter','aria-description':suggestion?'Tab — использовать пример вопроса; Enter — отправить; Shift+Enter — новая строка.':undefined,maxLength:2000}}/>
    <div className="composer-footer">
      {scopeLabel?<span className="scope"><Library size={14} aria-hidden="true"/>{scopeLabel}</span>:null}
      {scopeAction}
      {modelControl?<div className="composer-model">{modelControl}</div>:null}
      <Button type="submit" view="action" size="m" loading={loading}
        disabled={!available||!value.trim()||loading} aria-label={sendLabel}
        title="Enter — отправить, Shift+Enter — новая строка">
        <ArrowUp size={18} aria-hidden="true"/>
      </Button>
    </div>
  </form>;
}
