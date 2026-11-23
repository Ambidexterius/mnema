import type { IncomingMessage, ServerResponse } from 'node:http';
import { fail, handledJson, isRecord } from '../http.ts';
import type { Person, RequestServices } from '../request-context.ts';
import type { openDatabase } from '../db.ts';
import type { createProjectSharing } from '../project-sharing.ts';
import type { InviteToProject } from './types.ts';
import type { Role } from '../../app/types.ts';

interface DirectoryServices extends Pick<RequestServices, 'session'> {
  q: ReturnType<typeof openDatabase>['q'];
  db: Pick<ReturnType<typeof openDatabase>['db'], 'exec'>;
  userDirectory: (person: Person) => unknown;
  withRegistration: <T>(work: () => T | Promise<T>) => Promise<T>;
  hmacRemovedEmail: (email: string) => string;
}
export async function handleDirectory(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  person: Person,
  { q, db, userDirectory, session, withRegistration, hmacRemovedEmail }: DirectoryServices,
) {
  if (path === '/api/users' && req.method === 'GET') {
    if (!person.manageUsers)
      fail(403, 'Список пользователей доступен участникам с полным доступом.');
    return handledJson(res, 200, { users: userDirectory(person) });
  }
  if (/^\/api\/users\/[^/]+$/.test(path) && req.method === 'DELETE')
    return await withRegistration(async () => {
      const latest = await session(req);
      if (!latest?.owner) fail(403, 'Удалять пользователей может только администратор.');
      const id = path.split('/').at(-1);
      if (id === latest.id) fail(403, 'Свой аккаунт удалить нельзя.');
      const account = q(
        'SELECT u.email FROM user u JOIN mnema_access a ON a.user_id=u.id WHERE u.id=?',
      ).get(id);
      const invite = account
        ? null
        : q('SELECT email,workspace_id FROM mnema_invites WHERE id=? AND used=0').get(id);
      if (!account && !invite) return handledJson(res, 200, { users: userDirectory(latest) });
      if (account && q('SELECT 1 FROM mnema_project_sharing WHERE owner_id=?').get(id))
        fail(409, 'Этот пользователь владеет проектом. Его аккаунт пока нельзя удалить.');
      if (
        invite &&
        invite.workspace_id !== '*' &&
        !latest.workspaces.some((w) => w.id === invite.workspace_id)
      )
        fail(404, 'Приглашение не найдено.');
      db.exec('BEGIN IMMEDIATE');
      try {
        if (account) {
          q('INSERT OR IGNORE INTO mnema_removed_emails VALUES(?)').run(
            hmacRemovedEmail(account.email),
          );
          q('DELETE FROM mnema_invites WHERE lower(email)=?').run(account.email.toLowerCase());
          q('DELETE FROM mnema_registration WHERE email=?').run(account.email.toLowerCase());
          q('DELETE FROM mnema_members WHERE user_id=?').run(id);
          q('DELETE FROM mnema_access WHERE user_id=?').run(id);
          q('DELETE FROM mnema_chats WHERE user_id=?').run(id);
          q('DELETE FROM user WHERE id=?').run(id);
        } else {
          // Remove superseded links, but keep any invitation created after this one.
          q(
            'DELETE FROM mnema_invites WHERE email=? AND workspace_id=? AND used=0 AND rowid<=(SELECT rowid FROM mnema_invites WHERE id=?)',
          ).run(invite.email, invite.workspace_id, id);
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return handledJson(res, 200, { users: userDirectory(latest) });
    });
  return false;
}

interface MembershipServices extends Pick<RequestServices, 'body' | 'session'> {
  q: ReturnType<typeof openDatabase>['q'];
  db: Pick<ReturnType<typeof openDatabase>['db'], 'exec'>;
  currentWs: () => string;
  inviteToProject: InviteToProject;
  view: (person: Person) => object;
  roles: ReadonlySet<string>;
  grantAllProjects: (user: string, role: 'view' | 'full') => void;
  sharing: Pick<ReturnType<typeof createProjectSharing>, 'canManage'>;
}
export async function handleMembers(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  person: Person,
  {
    q,
    db,
    currentWs,
    inviteToProject,
    view,
    roles,
    grantAllProjects,
    sharing,
    body,
    session,
  }: MembershipServices,
) {
  if (path === '/api/invitations' && req.method === 'POST') {
    const b: unknown = await body(req),
      fresh = await session(req);
    if (!fresh) fail(401, 'Войдите в Мнемодак.');
    if (!isRecord(b)) fail(400, 'Укажите имя, почту и уровень доступа.');
    const result = await inviteToProject(fresh, b);
    const latest = await session(req),
      access = latest?.workspaces.find((w) => w.id === currentWs());
    if (!latest || !access || (!latest.manageUsers && !access.admin))
      fail(403, 'Доступ к проекту изменился.');
    return handledJson(res, 201, {
      ...view({
        ...latest,
        workspaceId: currentWs(),
        role: access.role,
        admin: access.admin,
      }),
      ...result,
    });
  }
  const userMatch = path.match(/^\/api\/users\/([^/]+)$/);
  if (userMatch && req.method === 'PATCH') {
    const [, id] = userMatch;
    if (id === person.id) fail(403, 'Собственный доступ изменять нельзя.');
    const b: unknown = await body(req);
    if (!isRecord(b)) fail(400, 'Неверные права или статус участника.');
    const requestedRole = b.role === 'view' || b.role === 'full' ? b.role : undefined;
    if (
      (b.role !== undefined && (!requestedRole || !roles.has(requestedRole))) ||
      (b.admin !== undefined && typeof b.admin !== 'boolean') ||
      (b.status !== undefined &&
        (typeof b.status !== 'string' ||
          !['active', 'invited', 'expired', 'revoked'].includes(b.status)))
    )
      fail(400, 'Неверные права или статус участника.');
    const latest = await session(req);
    if (!latest || (!latest.admin && !latest.manageUsers))
      fail(403, 'Управление пользователями недоступно.');
    if ((b.admin !== undefined || b.status !== undefined) && !latest.owner)
      fail(403, 'Назначать администраторов и отзывать доступ может только администратор.');
    const account = q<{ admin: number; all_projects: number; role: Role; revoked: number }>(
      'SELECT * FROM mnema_access WHERE user_id=?',
    ).get(id);
    if (account) {
      if (account.admin && !latest.owner)
        fail(403, 'Права администратора изменяет только администратор.');
      if (account.all_projects && !latest.manageUsers)
        fail(403, 'Недостаточно прав для изменения общего доступа.');
      const admin = b.admin === undefined ? Boolean(account.admin) : b.admin,
        role = admin ? 'full' : (requestedRole ?? account.role);
      if (admin || account.all_projects || b.admin !== undefined || b.status !== undefined) {
        if (!latest.manageUsers) fail(403, 'Недостаточно прав для изменения общего доступа.');
        const revoked = b.status === undefined ? account.revoked : b.status === 'revoked' ? 1 : 0;
        db.exec('BEGIN');
        try {
          q('UPDATE mnema_access SET admin=?,role=?,revoked=? WHERE user_id=?').run(
            admin ? 1 : 0,
            role,
            revoked,
            id,
          );
          if (!revoked && (admin || account.all_projects || b.admin !== undefined))
            grantAllProjects(id, role);
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      } else {
        const workspace = typeof b.workspaceId === 'string' ? b.workspaceId : currentWs();
        if (!sharing.canManage(workspace, latest.id))
          fail(403, 'Управление этим проектом недоступно.');
        const member = q('SELECT * FROM mnema_members WHERE workspace_id=? AND user_id=?').get(
          workspace,
          id,
        );
        if (!member) fail(404, 'Участник не найден.');
        if (sharing.canManage(workspace, id)) fail(403, 'Доступ владельца проекта не изменяется.');
        q('UPDATE mnema_members SET role=?,revoked=? WHERE workspace_id=? AND user_id=?').run(
          requestedRole ?? member.role,
          b.status === undefined ? member.revoked : b.status === 'revoked' ? 1 : 0,
          workspace,
          id,
        );
      }
    } else {
      const invite = q('SELECT * FROM mnema_invites WHERE id=? AND used=0').get(id);
      if (!invite) fail(404, 'Участник не найден.');
      if (b.admin !== undefined) fail(400, 'Назначить администратора можно после регистрации.');
      if (b.status === 'active' && invite.expires <= Date.now())
        fail(409, 'Срок приглашения истёк. Создайте новое приглашение.');
      if (
        invite.workspace_id === '*'
          ? !latest.manageUsers
          : !sharing.canManage(invite.workspace_id, latest.id)
      )
        fail(403, 'Управление приглашением недоступно.');
      q('UPDATE mnema_invites SET role=?,revoked=? WHERE id=?').run(
        requestedRole ?? invite.role,
        b.status === undefined ? invite.revoked : b.status === 'revoked' ? 1 : 0,
        id,
      );
    }
    return handledJson(res, 200, view(latest));
  }
  return false;
}
