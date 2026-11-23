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

export function handledJson(...args: Parameters<typeof json>): true {
  json(...args);
  return true;
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

export const text = (v: unknown, max = 200) =>
  typeof v === 'string' ? v.trim().slice(0, max) : '';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export async function transferResponse(res: ServerResponse, response: Response) {
  const headers: OutgoingHttpHeaders = {};
  for (const [k, v] of response.headers) if (k !== 'set-cookie') headers[k] = v;
  const cookies = response.headers.getSetCookie();
  const earlier = res.getHeader('Set-Cookie') as string | string[] | undefined;
  if (cookies.length || earlier)
    headers['set-cookie'] = [
      ...(Array.isArray(earlier) ? earlier : earlier ? [earlier] : []),
      ...cookies,
    ];
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}
