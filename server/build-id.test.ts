import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { backendBuildId } from './build-id.ts';

test('backend identity follows nested code while public builds exclude the private module', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'mnema-build-id-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'admin'));
  await mkdir(join(directory, 'private'));
  await writeFile(join(directory, 'admin', 'routes.ts'), 'const route = 1;');
  await writeFile(join(directory, 'private', 'index.ts'), 'const addon = 1;');
  const url = pathToFileURL(directory);
  const id = (includePrivate: boolean) => backendBuildId(url, '0.10.14', {}, includePrivate);
  const publicBefore = id(false),
    privateBefore = id(true);

  await writeFile(join(directory, 'admin', 'routes.test.ts'), 'fixture only');
  assert.equal(id(false), publicBefore);
  await writeFile(join(directory, 'private', 'index.ts'), 'const addon = 2;');
  assert.equal(id(false), publicBefore);
  assert.notEqual(id(true), privateBefore);
  await writeFile(join(directory, 'admin', 'routes.ts'), 'const route = 2;');
  assert.notEqual(id(false), publicBefore);
});
