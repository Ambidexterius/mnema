import test from 'node:test';
import assert from 'node:assert/strict';
import {findingRepeats,findingStems,similarStems} from '../app/finding-repeats.ts';

test('finding repeats: endings do not matter, unrelated findings stay apart',()=>{
 const a=findingStems('Непонятно, почему меняются условия бронирования');
 const b=findingStems('Пользователю непонятно, почему владелец изменил условия брони');
 assert.equal(similarStems(a,b),true);
 assert.equal(similarStems(a,findingStems('Первая фотография квартиры — решающий фактор клика')),false);
 assert.equal(similarStems(findingStems('Нет отмены'),findingStems('Нет отмены')),false,'short titles are not matched by two words');
});

test('finding repeats: counts distinct materials and skips rejected findings',()=>{
 const repeats=findingRepeats([
  {id:'1',studyId:'s1',title:'Непонятно, почему меняются условия бронирования',status:'verified'},
  {id:'2',studyId:'s2',title:'Непонятно, почему владелец изменил условия брони',status:'draft'},
  {id:'3',studyId:'s2',title:'Почему изменились условия бронирования — непонятно',status:'draft'},
  {id:'4',studyId:'s3',title:'Непонятно, почему меняются условия бронирования',status:'rejected'},
  {id:'5',studyId:'s4',title:'Таймер предоплаты спрятан в длинном системном сообщении',status:'verified'},
 ]);
 assert.deepEqual(repeats.get('1'),{materials:2,similar:['2','3']});
 assert.deepEqual(repeats.get('4'),{materials:1,similar:[]});
 assert.deepEqual(repeats.get('5'),{materials:1,similar:[]});
});
