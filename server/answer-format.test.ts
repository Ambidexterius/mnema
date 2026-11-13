import {test} from 'node:test';
import assert from 'node:assert/strict';
import {answerBlocks,answerHTML} from '../app/answer-format.ts';

test('thematic headings and evidence lists have the same structure in chat and print',()=>{
 const text='Есть трудности на двух этапах [1].\n\n## Переписка с хозяином и чаты\n- Долго ждут ответа [1].\n- Теряют инструкции [2].\n\n**Сайт и приложение**\n1. Не загружается карта [3].\n\nПрямые данные:\nОграничение выборки [3].';
 assert.deepEqual(answerBlocks(text),[{type:'paragraph',text:'Есть трудности на двух этапах [1].'},{type:'heading',text:'Переписка с хозяином и чаты'},{type:'list',items:['Долго ждут ответа [1].','Теряют инструкции [2].']},{type:'heading',text:'Сайт и приложение'},{type:'list',items:['Не загружается карта [3].']},{type:'heading',text:'Прямые данные'},{type:'paragraph',text:'Ограничение выборки [3].'}]);
 const html=answerHTML(text);assert.equal((html.match(/<h2>/g)||[]).length,3);assert.equal((html.match(/<ul>/g)||[]).length,2);assert(html.includes('<li>Не загружается карта [3].</li>'));assert(!html.includes('**'));assert(!html.includes('##'));
});
test('model text cannot inject markup into thematic headings or printed lists; short answers stay paragraphs',()=>{
 const text='## <img src=x onerror=alert(1)>\n- <script>alert(1)</script> [1]\n\nОбычный ответ с **выделением** [2].';
 const html=answerHTML(text);assert(!/<(?:img|script)\b/.test(html));assert(html.includes('&lt;img'));assert(html.includes('&lt;script&gt;'));assert(html.includes('[1]'));assert.deepEqual(answerBlocks('Короткий ответ [2].'),[{type:'paragraph',text:'Короткий ответ [2].'}]);
});
