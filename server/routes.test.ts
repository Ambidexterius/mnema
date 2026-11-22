import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRoute, routeHref, canonicalHref, navigationState } from '../app/routes.ts';

test('project URLs round-trip with a stable ID, nested screens and filters', () => {
  for (const screen of [
    'home',
    'library',
    'findings',
    'study/material',
    'finding/result',
    'file/material',
    'models',
    'integrations',
    'mcp',
    'findings?study=material&status=draft',
  ]) {
    const href = routeHref(screen, 'project-a');
    assert(!href.includes('#'));
    assert.deepEqual(readRoute(new URL(href, 'https://example.test')), {
      route: screen,
      workspace: 'project-a',
    });
  }
  assert.equal(routeHref('users', 'project-a'), '/users');
  assert.equal(routeHref('chat', 'project-a'), '/chat');
  assert.deepEqual(readRoute(new URL('https://example.test/users')), {
    route: 'users',
    workspace: null,
  });
  assert.equal(routeHref('home', 'renamed-project'), '/projects/renamed-project');
  assert.deepEqual(readRoute(new URL('https://example.test/projects')), {
    route: 'research',
    workspace: null,
  });
  assert.deepEqual(readRoute(new URL('https://example.test/projects/a%20b')), {
    route: 'home',
    workspace: 'a b',
  });
});
test('finding navigation preserves its list and material parent until an explicit project exit', () => {
  const url = (path: string) => new URL(path, 'https://example.test');
  const list = '/all-findings?kind=' + encodeURIComponent('Проблема');
  const finding = '/projects/a/findings/result';
  const entry = navigationState(url(list), url(finding), { scrollTop: 1200 });
  assert.equal(entry.findingsRoot, list);
  assert.equal(entry.previous, list);
  assert.equal(entry.findingsScroll, 1200);
  assert.equal(
    navigationState(url('/all-findings#main'), url(finding)).findingsRoot,
    '/all-findings',
  );
  const material = navigationState(url(finding), url('/projects/a/studies/source'), entry);
  assert.equal(material.findingsRoot, list);
  assert.equal(material.returnTo, finding);
  assert.equal(
    navigationState(url(finding), url('/projects/a/findings/similar'), entry).findingsRoot,
    list,
  );
  assert.equal(navigationState(url(finding), url('/projects/a/models'), entry).findingsRoot, list);
  assert.equal(navigationState(url(finding), url('/projects/a'), entry).findingsRoot, undefined);
  assert.equal(navigationState(url(finding), url(list), entry).scrollTop, 1200);
  assert.equal(
    navigationState(url('/projects/a'), url(finding)).findingsRoot,
    '/projects/a/findings',
  );
  assert.equal(
    navigationState(url('/projects/a/findings?status=draft'), url(finding)).findingsRoot,
    '/projects/a/findings?status=draft',
  );
  assert.equal(readRoute(url(list)).route, 'all-findings?kind=' + encodeURIComponent('Проблема'));
});
test('legacy links, invitation parameters, source fragments and MCP login remain readable', () => {
  assert.deepEqual(
    readRoute(new URL('https://example.test/?workspace=other&segment=part#/study/material')),
    { route: 'study/material', workspace: 'other' },
  );
  assert.deepEqual(readRoute(new URL('https://example.test/#/processing')), {
    route: 'models',
    workspace: null,
  });
  assert.deepEqual(readRoute(new URL('https://example.test/?workspace=other#/overview')), {
    route: 'home',
    workspace: 'other',
  });
  assert.equal(
    readRoute(new URL('https://example.test/#/signup?invite=token&email=a%40example.test')).route,
    'signup?invite=token&email=a%40example.test',
  );
  assert.equal(readRoute(new URL('https://example.test/signup?invite=token')).route, 'signup');
  assert.equal(readRoute(new URL('https://example.test/mcp/login?sig=signed')).route, 'login');
  assert.equal(readRoute(new URL('https://example.test/mcp/consent')).route, 'mcp-consent');
  assert.equal(
    canonicalHref(
      new URL('https://example.test/?workspace=other&segment=part#/study/material'),
      'other',
    ),
    '/projects/other/studies/material?segment=part',
  );
  assert.equal(canonicalHref(new URL('https://example.test/#/chat'), 'other'), '/chat');
  assert.equal(routeHref('mcp'), '/settings/mcp');
  assert.equal(readRoute(new URL('https://example.test/settings/mcp')).route, 'mcp');
});
