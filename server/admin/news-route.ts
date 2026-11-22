import type { IncomingMessage, ServerResponse } from 'node:http';
import { fail, json } from '../http.ts';
import type { createProductNews } from '../product-news.ts';

interface NewsServices {
  news: ReturnType<typeof createProductNews>;
  body: (request: IncomingMessage) => Promise<any>;
  session: (request: IncomingMessage) => Promise<{ owner: boolean } | null>;
}

export async function handleNews(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  owner: boolean,
  { news, body, session }: NewsServices,
) {
  if (path === '/api/news' && req.method === 'GET') {
    json(res, 200, { posts: news.list() });
    return true;
  }
  const changeNews =
    (req.method === 'PATCH' || req.method === 'DELETE') &&
    path.match(/^\/api\/news\/([a-zA-Z0-9.-]+)$/);
  if (!(path === '/api/news' && req.method === 'POST') && !changeNews) return false;
  if (!owner) fail(403, 'Только администратор аккаунта может менять новости.');
  const changes = await body(req);
  if (!(await session(req))?.owner)
    fail(403, 'Только администратор аккаунта может менять новости.');
  if (!changeNews) news.create(changes);
  else if (req.method === 'DELETE') news.remove(changeNews[1], changes);
  else news.edit(changeNews[1], changes);
  json(res, changeNews ? 200 : 201, { posts: news.list() });
  return true;
}
