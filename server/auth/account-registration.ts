import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { betterAuth } from 'better-auth';
import { fromNodeHeaders } from 'better-auth/node';
import type { openDatabase } from '../db.ts';
import { fail, text, transferResponse } from '../http.ts';
import type { createProjectSharing } from '../project-sharing.ts';
import { corporateEmail, type createRegistration } from '../registration.ts';
import type { RequestServices } from '../request-context.ts';

interface AccountRegistrationServices extends Pick<RequestServices, 'body' | 'limit'> {
  q: ReturnType<typeof openDatabase>['q'];
  db: Pick<ReturnType<typeof openDatabase>['db'], 'exec'>;
  auth: { api: Pick<ReturnType<typeof betterAuth>['api'], 'signUpEmail'> };
  options: { corporateRegistration?: boolean };
  authSecret: string;
  setupToken: string;
  hash: (value: string) => string;
  ownerExists: () => boolean;
  signup: ReturnType<typeof createRegistration>;
  sharing: Pick<ReturnType<typeof createProjectSharing>, 'claimUnowned'>;
  grantAllProjects: (id: string, role: string) => void;
}

const safeEqual = (a: unknown, b: unknown) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function createAccountRegistration({
  options,
  authSecret,
  setupToken,
  hash,
  signup,
  auth,
  body,
  limit,
  ownerExists,
  q,
  db,
  sharing,
  grantAllProjects,
}: AccountRegistrationServices) {
  const hmacRemovedEmail = (email: string) =>
    createHmac('sha256', authSecret)
      .update('removed-user:' + email.toLowerCase())
      .digest('hex');
  let registration: Promise<unknown> = Promise.resolve();
  const withRegistration = <T>(fn: () => T | Promise<T>) => {
    const result = registration.then(fn, fn);
    registration = result.catch(() => {});
    return result;
  };
  const register = async (req: IncomingMessage, res: ServerResponse) => {
    limit('registration:' + req.socket.remoteAddress, 10);
    const b = await body(req, 8 * 1024 ** 2);
    return withRegistration(async () => {
      const self = Boolean(
        options.corporateRegistration && ownerExists() && !text(b.inviteToken, 256),
      );
      const email = self ? corporateEmail(b.email) : text(b.email, 150).toLowerCase(),
        providedName = text(b.name, 70);
      if (!/^\S+@\S+\.\S+$/.test(email))
        fail(400, 'Введите рабочую почту, например name@company.ru.');
      let invitation = null,
        admin = false,
        role = 'view',
        profile = null,
        photo = null;
      if (!ownerExists()) {
        if (!setupToken || !safeEqual(hash(text(b.setupToken, 256)), hash(setupToken)))
          fail(403, 'Для первого входа нужен ключ настройки владельца.');
        admin = true;
        role = 'full';
      } else if (self) {
        signup.verified(req, email);
        if (q('SELECT 1 FROM mnema_removed_emails WHERE email_hash=?').get(hmacRemovedEmail(email)))
          fail(403, 'Попросите администратора прислать новое приглашение.');
        profile = signup.profile(b);
        photo = await signup.photo(b.photo);
        signup.verified(req, email);
        if (q('SELECT 1 FROM user WHERE lower(email)=?').get(email))
          fail(409, 'У вас уже есть аккаунт. Войдите со своим паролем.', {
            publicCode: 'ACCOUNT_EXISTS',
          });
        role = 'full';
      } else {
        invitation = q(
          'SELECT * FROM mnema_invites WHERE token_hash=? AND used=0 AND revoked=0 AND expires>?',
        ).get(hash(text(b.inviteToken, 256)), Date.now());
        if (!invitation || invitation.email !== email)
          fail(
            403,
            'Приглашение недействительно или выдано на другую почту. Проверьте рабочую почту или попросите новое приглашение у управляющего.',
          );
        role = invitation.role;
      }
      const name = profile
        ? profile.firstName + ' ' + profile.lastName
        : text(invitation?.name || providedName || email.split('@')[0], 70);
      const response = await auth.api.signUpEmail({
        body: { email, name, password: b.password },
        headers: fromNodeHeaders(req.headers),
        asResponse: true,
      });
      if (response.ok) {
        const u = q('SELECT id FROM user WHERE lower(email)=?').get(email);
        if (!u) fail(500, 'Аккаунт не создан. Повторите попытку.');
        db.exec('BEGIN');
        try {
          q(
            'INSERT INTO mnema_access(user_id,role,admin,self_registered,welcome_pending) VALUES(?,?,?,?,1)',
          ).run(u.id, role, admin ? 1 : 0, self ? 1 : 0);
          if (self || admin || invitation?.workspace_id === '*') grantAllProjects(u.id, role);
          else
            q(
              'INSERT OR IGNORE INTO mnema_members(workspace_id,user_id,role,admin) VALUES(?,?,?,?)',
            ).run(invitation?.workspace_id || 'main', u.id, role, admin ? 1 : 0);
          if (admin) sharing.claimUnowned(u.id);
          if (invitation) q('UPDATE mnema_invites SET used=1 WHERE id=?').run(invitation.id);
          if (profile) {
            q('INSERT INTO mnema_profiles VALUES(?,?,?,?,?)').run(
              u.id,
              profile.firstName,
              profile.lastName,
              photo,
              photo ? 'image/png' : null,
            );
            q('UPDATE user SET emailVerified=1,image=? WHERE id=?').run(
              photo ? '/api/profile/avatar/' + u.id : null,
              u.id,
            );
            signup.consume(req, res);
          }
          db.exec('COMMIT');
        } catch (e) {
          db.exec('ROLLBACK');
          q('DELETE FROM user WHERE id=?').run(u.id);
          throw e;
        }
      }
      return transferResponse(res, response);
    });
  };
  return { hmacRemovedEmail, register, withRegistration };
}
