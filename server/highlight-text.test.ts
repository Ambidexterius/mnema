import test from 'node:test';
import assert from 'node:assert/strict';
import {quoteOccurrence,quoteSegment,quoteStartsIn} from '../app/highlight-text.ts';
const seg=(id:string,text:string,page?:number)=>({id,time:0,speaker:'Документ',text,...(page?{page}:{})});
const segments=[seg('a','Сначала смотрю загрузку на месяц.',1),seg('b','Потом поднимаю цены сразу для всех квартир.',1),seg('c','Сначала смотрю загрузку на месяц.',2),seg('d','Ёлка и «кавычки» не мешают.',2)];

test('quotes: whitespace, case, ё and quote marks do not matter; a quote may continue into the next fragment',()=>{
 assert.equal(quoteSegment(segments,'Ёлка и кавычки'),'d');
 assert.equal(quoteSegment(segments,'на месяц. Потом   поднимаю ЦЕНЫ'),'a');
 assert.equal(quoteSegment(segments,'нет такого текста'),null);
 assert.equal(quoteStartsIn(segments,1,'Сначала смотрю'),false,'the quote must start in its fragment');
});

test('quotes: a repeated phrase is resolved by page, explicit fragment or occurrence',()=>{
 assert.equal(quoteSegment(segments,'Сначала смотрю загрузку',{page:2}),'c');
 assert.equal(quoteSegment(segments,'Сначала смотрю загрузку',{segmentId:'c'}),'c');
 assert.equal(quoteSegment(segments,'Сначала смотрю загрузку',{occurrence:1}),'c');
 assert.equal(quoteSegment(segments,'Сначала смотрю загрузку',{occurrence:5}),'c','an occurrence beyond the list falls back to the last');
 assert.equal(quoteOccurrence(segments,'c','Сначала смотрю загрузку'),1);assert.equal(quoteOccurrence(segments,'a','Сначала смотрю загрузку'),0);
});

import {wordBounds,compactText} from '../app/highlight-text.ts';
test('quotes: a selection is widened to whole words, spaces and punctuation stay as they are',()=>{
 const text='Подошел, ввел код подъезда, поднялся на этаж, взял ключ.';
 const cut=(a:number,b:number)=>{const [x,y]=wordBounds(text,a,b);return text.slice(x,y)};
 assert.equal(cut(text.indexOf('одъезда'),text.indexOf('ял ключ')+2),'подъезда, поднялся на этаж, взял');
 assert.equal(cut(text.indexOf(' ввел'),text.indexOf('ввел')+4),' ввел','a selection starting on a space keeps its start');
 assert.equal(cut(0,3),'Подошел');
 assert.equal(cut(text.length-2,text.length),'ключ.');
 assert.equal(compactText('встре­чаться'),'встречаться','soft hyphens are ignored');
});
