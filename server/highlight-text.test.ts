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
