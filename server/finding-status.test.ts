import {test} from 'node:test';
import assert from 'node:assert/strict';
import {findingStatusLabel} from '../app/finding-status.ts';

test('draft labels keep imported and human findings separate from AI drafts',()=>{
 assert.equal(findingStatusLabel({status:'draft',origin:'ai'}),'Предложено ИИ');
 for(const origin of ['human','import'] as const){
  assert.equal(findingStatusLabel({status:'draft',origin}),'Ждёт проверки');
 }
});

test('reviewed and rejected labels are independent of origin',()=>{
 for(const origin of ['ai','human','import'] as const){
  assert.equal(findingStatusLabel({status:'verified',origin}),'Проверено');
  assert.equal(findingStatusLabel({status:'rejected',origin}),'Отклонено');
 }
});
