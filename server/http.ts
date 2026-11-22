import type { OutgoingHttpHeaders, ServerResponse } from 'node:http';
import { sendBody } from './compression.ts';

export function fail(status: number, message: string, extra = {}): never {
  throw Object.assign(new Error(message), { status, ...extra });
}

export function json(
  res: ServerResponse,
  status: number,
  data: unknown,
  extra: OutgoingHttpHeaders = {},
) {
  void sendBody(
    res.req,
    res,
    status,
    { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
    Buffer.from(JSON.stringify(data)),
  ).catch(() => {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
}

export async function readJsonBody(chunks: AsyncIterable<Buffer>, max = 2 * 1024 ** 2) {
  let size = 0;
  const buffers: Buffer[] = [];
  for await (const chunk of chunks) {
    size += chunk.length;
    if (size > max) fail(413, 'Слишком большой запрос.');
    buffers.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(buffers).toString() || '{}');
  } catch {
    fail(400, 'Не удалось прочитать запрос.');
  }
}
