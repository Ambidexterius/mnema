import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { initialNews, type NewsPost } from '../app/product-news.ts';

function invalid(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}

function newsFields(body: any) {
  const title = body?.title ?? '';
  if (typeof title !== 'string' || title.trim().length > 160) invalid('Заголовок слишком длинный.');
  if (
    typeof body?.description !== 'string' ||
    !body.description.trim() ||
    body.description.length > 24000
  )
    invalid('Введите текст новости до 24 000 символов.');
  return { title: title.trim(), description: body.description };
}

export function createProductNews(db: DatabaseSync, extend?: (posts: NewsPost[]) => NewsPost[]) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS mnema_news(seq INTEGER PRIMARY KEY,id TEXT UNIQUE NOT NULL,date TEXT,title TEXT NOT NULL,description TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1)',
  );
  const insert = db.prepare('INSERT INTO mnema_news(id,date,title,description) VALUES(?,?,?,?)');
  const exists = db.prepare('SELECT 1 FROM mnema_news WHERE id=?');
  db.exec('BEGIN IMMEDIATE');
  try {
    if (
      !db
        .prepare('PRAGMA table_info(mnema_news)')
        .all()
        .some((column) => column.name === 'deleted')
    ) {
      db.exec('ALTER TABLE mnema_news ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0');
    }
    for (const post of [...(extend?.(initialNews) ?? initialNews)].reverse())
      if (!exists.get(post.id)) insert.run(post.id, post.date, post.title, post.description);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  const list = db.prepare(
    'SELECT id,date,title,description,revision FROM mnema_news WHERE deleted=0 ORDER BY seq DESC',
  );
  const latest = db.prepare('SELECT id FROM mnema_news WHERE deleted=0 ORDER BY seq DESC LIMIT 1');
  const update = db.prepare(
    'UPDATE mnema_news SET title=?,description=?,revision=revision+1 WHERE id=? AND revision=? AND deleted=0',
  );
  const visible = db.prepare('SELECT 1 FROM mnema_news WHERE id=? AND deleted=0');
  const remove = db.prepare(
    'UPDATE mnema_news SET deleted=1 WHERE id=? AND revision=? AND deleted=0',
  );
  function revisionOf(body: any) {
    if (!Number.isSafeInteger(body?.revision) || body.revision < 1)
      invalid('Откройте новость заново.');
    return body.revision as number;
  }
  return {
    list: () => list.all() as unknown as NewsPost[],
    latest: () => (latest.get()?.id ?? '') as string,
    create(body: unknown) {
      const { title, description } = newsFields(body);
      const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(
        new Date(),
      );
      insert.run(randomUUID(), date, title, description);
    },
    edit(id: string, body: any) {
      const { title, description } = newsFields(body);
      if (update.run(title, description, id, revisionOf(body)).changes) return;
      if (!visible.get(id)) invalid('Новость не найдена.', 404);
      invalid('Новость уже изменили. Ваш текст остался в редакторе.', 409);
    },
    remove(id: string, body: unknown) {
      if (remove.run(id, revisionOf(body)).changes) return;
      if (!visible.get(id)) return;
      invalid('Новость уже изменили. Обновите ленту перед удалением.', 409);
    },
  };
}
