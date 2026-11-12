import {test} from 'node:test';
import assert from 'node:assert/strict';
import {folderPaths} from '../app/folder-geometry.ts';

test('folder corners keep the requested screen radius after scaling and stay within the folder outline',()=>{
 for(const width of [160,232,340])for(const radius of [8,12]){
  const scale=width/340,paths=folderPaths(radius,scale);
  for(const path of [paths.back,paths.front]){
   assert.doesNotMatch(path,/NaN|Infinity/);
   const arcs=[...path.matchAll(/A([\d.]+) ([\d.]+) 0 0 ([01]) ([\d.]+) ([\d.]+)/g)];
   assert.equal(arcs.length,6);
   assert(arcs.some(arc=>arc[3]==='0'),'the folder notch must retain its concave corner');
   for(const arc of arcs){
    assert(Math.abs(Number(arc[1])*scale-radius)<.00002);
    assert(Math.abs(Number(arc[2])*scale-radius)<.00002);
    assert(Number(arc[4])>=0&&Number(arc[4])<=340);
    assert(Number(arc[5])>=0&&Number(arc[5])<=272);
   }
   assert(path.endsWith('Z'));
  }
 }
});
