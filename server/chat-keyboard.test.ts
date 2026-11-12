import {test} from 'node:test';
import assert from 'node:assert/strict';
import {acceptChatSuggestion,submitChatOnEnter} from '../app/chat-keyboard.ts';
test('Enter submits, Shift+Enter and IME composition do not, held Enter cannot submit twice',()=>{
 let submits=0,prevented=0;
 const event:any={key:'Enter',shiftKey:false,altKey:false,repeat:false,nativeEvent:{isComposing:false},preventDefault:()=>prevented++,currentTarget:{form:{requestSubmit:()=>submits++}}};
 submitChatOnEnter(event);assert.equal(submits,1);assert.equal(prevented,1);
 event.shiftKey=true;submitChatOnEnter(event);assert.equal(submits,1);assert.equal(prevented,1);
 event.shiftKey=false;event.nativeEvent.isComposing=true;submitChatOnEnter(event);assert.equal(submits,1);
 event.nativeEvent.isComposing=false;event.repeat=true;submitChatOnEnter(event);assert.equal(submits,1);assert.equal(prevented,2);
});

test('Tab accepts the empty composer example without submitting and preserves normal navigation elsewhere',()=>{
 let accepted='',prevented=0,submits=0;
 const event:any={key:'Tab',shiftKey:false,altKey:false,ctrlKey:false,metaKey:false,repeat:false,nativeEvent:{isComposing:false},preventDefault:()=>prevented++,currentTarget:{form:{requestSubmit:()=>submits++}}};
 assert.equal(acceptChatSuggestion(event,'','Example question',value=>accepted=value),true);assert.equal(accepted,'Example question');assert.equal(prevented,1);assert.equal(submits,0);
 assert.equal(acceptChatSuggestion(event,accepted,'Example question',()=>assert.fail()),false);
 for(const flag of ['shiftKey','altKey','ctrlKey','metaKey','repeat']){event[flag]=true;assert.equal(acceptChatSuggestion(event,'','Example question',()=>assert.fail()),false);event[flag]=false}
 event.nativeEvent.isComposing=true;assert.equal(acceptChatSuggestion(event,'','Example question',()=>assert.fail()),false);event.nativeEvent.isComposing=false;
 event.nativeEvent.keyCode=229;assert.equal(acceptChatSuggestion(event,'','Example question',()=>assert.fail()),false);event.nativeEvent.keyCode=0;
 assert.equal(acceptChatSuggestion(event,'',undefined,()=>assert.fail()),false);event.key='Enter';assert.equal(acceptChatSuggestion(event,'','Example question',()=>assert.fail()),false);
 assert.equal(prevented,1);assert.equal(submits,0);
});
