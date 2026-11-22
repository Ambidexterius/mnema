import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FeedbackLocation } from '../../app/feedback-context.ts';
import type { createAnswerFeedback } from '../answer-feedback.ts';
import type { createIdeas } from '../ideas.ts';
import type { createProductNews } from '../product-news.ts';
import type { Person, RequestServices } from '../request-context.ts';
import { handledJson, fail } from '../http.ts';
import { handleNews } from './news-route.ts';

interface ModerationServices extends RequestServices {
  feedback: ReturnType<typeof createAnswerFeedback>;
  ideas: ReturnType<typeof createIdeas>;
  news: ReturnType<typeof createProductNews>;
  scopedPerson: (person: Person) => Person;
  ideaLocationAccess: (person: Person) => (location: FeedbackLocation) => boolean;
}

export function isModerationPath(path: string) {
  return (
    path === '/api/chat/feedback' ||
    path === '/api/interface-rating' ||
    path === '/api/news' ||
    path.startsWith('/api/news/') ||
    path === '/api/ideas' ||
    path.startsWith('/api/ideas/')
  );
}

export async function handleModeration(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  person: Person,
  {
    feedback,
    ideas,
    news,
    scopedPerson,
    ideaLocationAccess,
    body,
    session,
    limit,
  }: ModerationServices,
) {
  if (path === '/api/chat/feedback' && req.method === 'POST') {
    limit('answer-feedback:' + person.id, 60);
    const input = await body(req);
    const current = await session(req);
    if (!current) fail(401, 'Войдите в Мнемодак.');
    return handledJson(res, 200, feedback.rate(scopedPerson(current), input.token, input.rating));
  }
  if (path === '/api/chat/feedback' && req.method === 'GET') {
    if (!(person.owner || person.manageUsers)) fail(403, 'Оценки ответов доступны администратору.');
    return handledJson(res, 200, { feedback: feedback.list(person) });
  }
  if (
    (path === '/api/news' || path.startsWith('/api/news/')) &&
    (await handleNews(req, res, path, person.owner, { news, body, session }))
  )
    return true;
  if (path === '/api/ideas' && req.method === 'GET')
    return handledJson(res, 200, {
      ideas: ideas.list(person, ideaLocationAccess(person)),
      admin: person.owner,
    });
  if (path === '/api/ideas' && req.method === 'POST') {
    limit('ideas:' + person.id, 20);
    const b = await body(req);
    const latest = await session(req);
    if (!latest) fail(401, 'Войдите в Мнемодак.');
    return handledJson(res, 200, ideas.create(latest, b, ideaLocationAccess(latest)));
  }
  if (/^\/api\/ideas\/[\w-]{1,64}$/.test(path) && req.method === 'PATCH') {
    limit('ideas:' + person.id, 60);
    return handledJson(res, 200, ideas.edit(person, path.split('/').pop(), await body(req)));
  }
  if (/^\/api\/ideas\/[\w-]{1,64}$/.test(path) && req.method === 'DELETE') {
    limit('ideas:' + person.id, 60);
    return handledJson(res, 200, ideas.remove(person, path.split('/').pop()));
  }
  if (path === '/api/interface-rating' && req.method === 'POST') {
    limit('rating:' + person.id, 20);
    return handledJson(res, 200, ideas.rate(person, (await body(req)).rating));
  }
  {
    const m = path.match(/^\/api\/ideas\/([\w-]{1,64})\/(vote|comments|status)$/);
    if (m) {
      const [, id, action] = m;
      if (action === 'comments' && req.method === 'GET')
        return handledJson(res, 200, { comments: ideas.comments(person, id) });
      if (req.method !== 'POST') fail(405, 'Метод недоступен.');
      limit('ideas:' + person.id, 60);
      const b = await body(req);
      if (action === 'vote') return handledJson(res, 200, ideas.vote(person, id, b.vote));
      if (action === 'comments') return handledJson(res, 200, ideas.comment(person, id, b));
      return handledJson(res, 200, await ideas.moderate(person, id, b));
    }
  }
  return false;
}
