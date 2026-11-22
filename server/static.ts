import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fail } from './http.ts';
import { sendBody, encode, pickEncoding, compressible, MIN_COMPRESS_BYTES } from './compression.ts';

const mimes = {
  '.mp3': 'audio/mpeg',
  '.svg': 'image/svg+xml',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ttf': 'font/ttf',
};

export function createStaticHandler(publicDir: string) {
  const staticCache = new Map<string, Buffer>();
  return async function serveStatic(req: IncomingMessage, res: ServerResponse, path: string) {
    if (!['GET', 'HEAD'].includes(req.method)) fail(405, 'Метод недоступен.');
    const name =
      path === '/' || !path.split('/').at(-1).includes('.')
        ? 'index.html'
        : path.replace(/^\//, '');
    const abs = resolve(publicDir, name);
    if (!abs.startsWith(publicDir + '/')) fail(404, 'Страница не найдена.');
    let data;
    try {
      data = await readFile(abs);
    } catch {
      fail(404, 'Страница не найдена.');
    }
    const suffix = name.slice(name.lastIndexOf('.'));
    const type = mimes[suffix] || 'application/octet-stream';
    const headers = {
      'Content-Type': type,
      'Cache-Control': name === 'index.html' ? 'no-cache' : 'public, max-age=3600',
    };
    // Hashed assets are immutable: compress once per encoding. index.html stays fresh on every request.
    const encoding =
      name !== 'index.html' && compressible(type) && data.length >= MIN_COMPRESS_BYTES
        ? pickEncoding(req.headers['accept-encoding'])
        : null;
    if (encoding) {
      const key = encoding + ':' + abs;
      let encoded = staticCache.get(key);
      if (!encoded) {
        encoded = await encode(data, encoding);
        staticCache.set(key, encoded);
      }
      res.writeHead(200, {
        ...headers,
        Vary: 'Accept-Encoding',
        'Content-Encoding': encoding,
        'Content-Length': encoded.length,
      });
      res.end(req.method === 'HEAD' ? undefined : encoded);
      return;
    }
    await sendBody(req, res, 200, headers, data);
  };
}
