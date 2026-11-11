import {test} from 'node:test';
import assert from 'node:assert/strict';
import {submitChatOnEnter} from '../app/chat-keyboard.ts';
test('Enter submits, Shift+Enter and IME composition do not, held Enter cannot submit twice',()=>{
 let submits=0,prevented=0;
 const event:any={key:'Enter',shiftKey:false,altKey:false,repeat:false,nativeEvent:{isComposing:false},preventDefault:()=>prevented++,currentTarget:{form:{requestSubmit:()=>submits++}}};
 submitChatOnEnter(event);assert.equal(submits,1);assert.equal(prevented,1);
 event.shiftKey=true;submitChatOnEnter(event);assert.equal(submits,1);assert.equal(prevented,1);
 event.shiftKey=false;event.nativeEvent.isComposing=true;submitChatOnEnter(event);assert.equal(submits,1);
 event.nativeEvent.isComposing=false;event.repeat=true;submitChatOnEnter(event);assert.equal(submits,1);assert.equal(prevented,2);
});
