import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createProductNews} from './product-news.ts';
import {initialNews} from '../app/product-news.ts';

test('product news preserves the original feed, edits, Markdown and publication order across startup',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  const news=createProductNews(db);
  assert.deepEqual(news.list().map(p=>({...p})),initialNews);
  const original=initialNews[0];const markdown='    пример\n\n- **Решение**';
  news.edit(original.id,{title:'Обновили текст',description:markdown,revision:1});
  assert.throws(()=>news.edit(original.id,{title:'Поздняя правка',description:'текст',revision:1}),{status:409});
  news.create({title:' Новая запись ',description:'## Описание'});
  const reopened=createProductNews(db),posts=reopened.list();
  assert.equal(posts.length,initialNews.length+1);assert.equal(reopened.latest(),posts[0].id);
  assert.equal(posts[0].title,'Новая запись');assert.match(posts[0].date!,/^\d{4}-\d\d-\d\d$/);
  assert.equal(posts[1].revision,2);assert.equal(posts[1].description,markdown);assert.equal(posts[1].date,original.date);
  assert.throws(()=>news.create({title:' ',description:'текст'}),{status:400});
  assert.throws(()=>news.edit('missing',{title:'Заголовок',description:'текст',revision:1}),{status:404});
 }finally{db.close()}
});
