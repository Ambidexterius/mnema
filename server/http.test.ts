import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { readJsonBody } from './http.ts';

test('JSON body preserves empty requests and rejects malformed or oversized payloads', async () => {
  const body = (...chunks: string[]) => Readable.from(chunks.map((chunk) => Buffer.from(chunk)));
  assert.deepEqual(await readJsonBody(body()), {});
  assert.deepEqual(await readJsonBody(body('{"ok":', 'true}')), { ok: true });
  await assert.rejects(readJsonBody(body('{')), { status: 400 });
  await assert.rejects(readJsonBody(body('{}'), 1), { status: 413 });
});
