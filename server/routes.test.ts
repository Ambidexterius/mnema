import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readRoute,routeHref,canonicalHref} from '../app/routes.ts';

test('project URLs round-trip with a stable ID, nested screens and filters',()=>{
 for(const screen of ['home','library','findings','study/material','finding/result','file/material','users','models','integrations','mcp','findings?study=material&status=draft']){
  const href=routeHref(screen,'project-a');assert(!href.includes('#'));
  assert.deepEqual(readRoute(new URL(href,'https://example.test')),{route:screen,workspace:'project-a'});
 }
 assert.equal(routeHref('home','renamed-project'),'/projects/renamed-project');
 assert.deepEqual(readRoute(new URL('https://example.test/projects')),{route:'research',workspace:null});
 assert.deepEqual(readRoute(new URL('https://example.test/projects/a%20b')),{route:'home',workspace:'a b'});
});
test('legacy links, invitation parameters, source fragments and MCP login remain readable',()=>{
 assert.deepEqual(readRoute(new URL('https://example.test/?workspace=other&segment=part#/study/material')),{route:'study/material',workspace:'other'});
 assert.deepEqual(readRoute(new URL('https://example.test/#/processing')),{route:'models',workspace:null});
 assert.deepEqual(readRoute(new URL('https://example.test/?workspace=other#/overview')),{route:'home',workspace:'other'});
 assert.equal(readRoute(new URL('https://example.test/#/signup?invite=token&email=a%40example.test')).route,'signup?invite=token&email=a%40example.test');
 assert.equal(readRoute(new URL('https://example.test/signup?invite=token')).route,'signup');
 assert.equal(readRoute(new URL('https://example.test/mcp/login?sig=signed')).route,'login');
 assert.equal(readRoute(new URL('https://example.test/mcp/consent')).route,'mcp-consent');
 assert.equal(canonicalHref(new URL('https://example.test/?workspace=other&segment=part#/study/material'),'other'),'/projects/other/studies/material?segment=part');
 assert.equal(canonicalHref(new URL('https://example.test/#/chat'),'other'),'/chat');
 assert.equal(routeHref('mcp'),'/settings/mcp');
 assert.equal(readRoute(new URL('https://example.test/settings/mcp')).route,'mcp');
});
