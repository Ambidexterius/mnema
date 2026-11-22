import type { IncomingMessage, ServerResponse } from 'node:http';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import { fail, handledJson } from '../http.ts';
import type { openDatabase } from '../db.ts';
import type { createProjectSharing } from '../project-sharing.ts';
import type { createRegistration } from '../registration.ts';
import type { Person, RequestServices } from '../request-context.ts';

interface AuthServices extends RequestServices {
  auth: {
    handler: (request: Request) => Promise<Response>;
    $context: Promise<{
      internalAdapter: {
        updatePassword: (userId: string, hash: string) => Promise<unknown>;
        deleteUserSessions: (userId: string) => Promise<unknown>;
      };
      password: { hash: (password: string) => Promise<string> };
    }>;
    api: {
      signInEmail: (input: {
        body: { email: string; password: string; rememberMe: true };
        headers: Headers;
        asResponse: true;
      }) => Promise<Response>;
    };
  };
  signup: ReturnType<typeof createRegistration>;
  ownerExists: () => boolean;
  register: (req: IncomingMessage, res: ServerResponse) => Promise<unknown>;
  withRegistration: <T>(work: () => T | Promise<T>) => Promise<T>;
  transfer: (res: ServerResponse, response: Response) => Promise<unknown>;
  enterWorkspace: (id: string) => void;
  corporateRegistration?: boolean;
  setupEnabled: boolean;
  version: string;
}

export function isAuthPath(path: string) {
  return (
    path === '/api/session' ||
    path === '/api/register' ||
    path.startsWith('/api/auth/') ||
    path.startsWith('/api/registration/') ||
    path.startsWith('/api/password-reset/')
  );
}

export async function handleAuth(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  {
    auth,
    signup,
    body,
    session,
    limit,
    ownerExists,
    register,
    withRegistration,
    transfer,
    enterWorkspace,
    corporateRegistration,
    setupEnabled,
    version,
  }: AuthServices,
) {
  // Password reset reuses the mailed-code steps of registration and works without self-registration.
  const reset = path.startsWith('/api/password-reset/');
  if (reset || path.startsWith('/api/registration/')) {
    const step = path.split('/')[3];
    if (!ownerExists() || (!reset && !corporateRegistration)) fail(404, 'Регистрация недоступна.');
    if (step === 'status' && req.method === 'GET') return handledJson(res, 200, signup.status(req));
    if (req.method !== 'POST') fail(405, 'Метод недоступен.');
    if (step === 'request-code') {
      limit('registration-mail:' + req.socket.remoteAddress, 10);
      const input = await body(req);
      return await withRegistration(async () =>
        handledJson(res, 200, await signup.request(req, res, input.email, reset)),
      );
    }
    if (step === 'verify-code') {
      limit('registration-verify:' + req.socket.remoteAddress, 30);
      const input = await body(req);
      return await withRegistration(async () =>
        handledJson(res, 200, signup.verify(req, res, input)),
      );
    }
    if (step === 'cancel') {
      return await withRegistration(() => {
        signup.consume(req, res);
        return handledJson(res, 200, { ok: true });
      });
    }
    if (reset && step === 'complete') {
      limit('password-reset:' + req.socket.remoteAddress, 10);
      const input = await body(req);
      return await withRegistration(async () => {
        const { email, userId } = signup.confirmed(req),
          password = input.password;
        if (typeof password !== 'string' || password.length < 8 || password.length > 128)
          fail(400, 'Пароль должен быть от 8 до 128 символов', { publicCode: 'PASSWORD' });
        const ctx = await auth.$context;
        await ctx.internalAdapter.updatePassword(userId, await ctx.password.hash(password));
        await ctx.internalAdapter.deleteUserSessions(userId);
        signup.consume(req, res);
        signup.notifyPasswordChanged(email);
        await transfer(
          res,
          await auth.api.signInEmail({
            body: { email, password, rememberMe: true },
            headers: fromNodeHeaders(req.headers),
            asResponse: true,
          }),
        );
        return true;
      });
    }
    fail(404, 'Метод недоступен.');
  }
  if (path === '/api/register' && req.method === 'POST') {
    await register(req, res);
    return true;
  }
  if (['/api/auth/sign-in/email', '/api/auth/sign-out', '/api/auth/get-session'].includes(path)) {
    if (req.method === 'POST') limit('auth:' + req.socket.remoteAddress, 20);
    await toNodeHandler(auth)(req, res);
    return true;
  }
  if (path.startsWith('/api/auth/')) fail(404, 'Метод недоступен.');
  if (path === '/api/session') {
    const person = await session(req);
    if (person?.workspaceId) enterWorkspace(person.workspaceId);
    return handledJson(res, 200, {
      user: person,
      setupRequired: !ownerExists(),
      setupEnabled,
      registrationEnabled: Boolean(corporateRegistration && ownerExists()),
      version,
    });
  }
  return false;
}

interface ProfileServices {
  q: ReturnType<typeof openDatabase>['q'];
  sharing: Pick<ReturnType<typeof createProjectSharing>, 'projects'>;
}

export function handleProfile(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  person: Person,
  { q, sharing }: ProfileServices,
) {
  if (path === '/api/welcome/dismiss' && req.method === 'POST') {
    q('UPDATE mnema_access SET welcome_pending=0 WHERE user_id=? AND welcome_pending=1').run(
      person.id,
    );
    return handledJson(res, 200, { ok: true });
  }
  if (path.startsWith('/api/profile/avatar/') && req.method === 'GET') {
    const id = path.slice('/api/profile/avatar/'.length);
    if (!/^[\w-]{1,80}$/.test(id)) fail(404, 'Фотография не найдена.');
    const shared =
      id === person.id ||
      (q('SELECT 1 FROM mnema_access WHERE user_id=? AND revoked=0').get(id) &&
        sharing
          .projects(id)
          .some((project) => person.workspaces.some((own) => own.id === project.id)));
    const profile =
      shared && q('SELECT photo,photo_mime FROM mnema_profiles WHERE user_id=?').get(id);
    if (!profile?.photo) fail(404, 'Фотография не найдена.');
    res.writeHead(200, {
      'Content-Type': profile.photo_mime,
      'Content-Length': profile.photo.length,
      'Cache-Control': 'no-store',
    });
    res.end(Buffer.from(profile.photo));
    return true;
  }
  return false;
}
