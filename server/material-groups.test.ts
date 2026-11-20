import test from 'node:test';
import assert from 'node:assert/strict';
import {groupMaterials,materialName} from '../app/material-groups.ts';

test('recording, text and its «(1)» copy share one row; order follows the first file', () => {
 const titles=['2026-UX-тест Чаты - Суточно.ру','Интервью 01-Чаты-Ольга-Новичок-iOS (1)','Интервью 01-Чаты-Ольга-Новичок-iOS','Интервью 02-Чаты-Алена-Новичок-Web','интервью 01-чаты-ольга-новичок-ios.txt'];
 assert.deepEqual(groupMaterials(titles.map(title=>({title}))).map(g=>g.map(s=>s.title)),[[titles[0]],[titles[1],titles[2],titles[4]],[titles[3]]]);
 assert.equal(materialName(titles[1]),'Интервью 01-Чаты-Ольга-Новичок-iOS');
 assert.equal(materialName('Галерея new'),'Галерея new');
});
