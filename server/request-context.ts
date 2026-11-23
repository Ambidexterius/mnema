import type { IncomingMessage } from 'node:http';
import { fail, readJsonBody } from './http.ts';

interface WorkspaceRef {
  id: string;
  name: string;
  role: 'view' | 'full';
  admin: boolean;
  sharingMode?: string;
  shareVersion?: string;
  fileCount?: number;
  filePreviews?: { name: string; format: string }[];
}
export interface Person {
  newsId?: string;
  id: string;
  name: string;
  email: string;
  role: 'view' | 'full';
  admin: boolean;
  owner: boolean;
  manageUsers?: boolean;
  recordingProcessing?: boolean;
  welcomePending: boolean;
  workspaceId: string | null;
  workspaces: WorkspaceRef[];
  sharedProject?: WorkspaceRef;
}

export interface RequestServices {
  body: (request: IncomingMessage, max?: number) => Promise<any>;
  session: (request: IncomingMessage) => Promise<Person | null>;
  limit: (key: string, max?: number) => void;
}

export function createRequestContext(session: RequestServices['session']) {
  const writingUsers = new WeakMap<IncomingMessage, Person>();
  const recheckWrite = async (req: IncomingMessage) => {
    const before = writingUsers.get(req);
    if (!before) return;
    const now = await session(req);
    if (!now) fail(401, 'Войдите в Мнемодак.');
    if (
      before.workspaceId !== now.workspaceId ||
      (before.role === 'full' && now.role !== 'full') ||
      (before.admin && !now.admin) ||
      (before.owner && !now.owner) ||
      (before.manageUsers && !now.manageUsers)
    )
      fail(403, 'Доступ изменился. Обновите страницу и повторите действие.');
  };
  const body = async (req: IncomingMessage, max?: number) => {
    const value = await readJsonBody(req, max);
    await recheckWrite(req);
    return value;
  };
  const limits = new Map<string, { time: number; n: number }>();
  const limit = (key: string, max = 30) => {
    const now = Date.now();
    const l = limits.get(key);
    if (!l || now - l.time > 60000) {
      limits.set(key, { time: now, n: 1 });
      return;
    }
    if (++l.n > max) fail(429, 'Слишком много запросов. Подождите минуту.');
    if (limits.size > 10000)
      for (const [k, v] of limits) if (now - v.time > 60000) limits.delete(k);
  };
  return { writingUsers, recheckWrite, body, limit };
}
