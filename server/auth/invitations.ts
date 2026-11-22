import { randomBytes, randomUUID } from 'node:crypto';
import type { createMembership } from './membership.ts';
import type { openDatabase } from '../db.ts';
import { fail, text } from '../http.ts';
import { sendInvitationEmail } from '../invitation-mail.ts';
import type { createProjectSharing } from '../project-sharing.ts';
import type { Person, RequestServices } from '../request-context.ts';
import type { CompletionMail } from '../completion-mail.ts';

export const roles = new Set(['view', 'full']);

interface InvitationServices
  extends
    Pick<RequestServices, 'limit'>,
    Pick<ReturnType<typeof createMembership>, 'users' | 'grantAllProjects'> {
  q: ReturnType<typeof openDatabase>['q'];
  sharing: Pick<ReturnType<typeof createProjectSharing>, 'canManage'>;
  currentWs: () => string;
  baseURL: string;
  origin: string;
  hash: (value: string) => string;
  options: { sendInvitationMail?: (message: CompletionMail) => Promise<void> };
}

export function createInvitations({
  currentWs,
  sharing,
  limit,
  q,
  users,
  grantAllProjects,
  baseURL,
  origin,
  hash,
  options,
}: InvitationServices) {
  const inviteToProject = async (person: Person, b: any) => {
    const all = b.scope === 'all' || (b.scope === undefined && person.manageUsers),
      workspace = all ? '*' : currentWs();
    if (all ? !person.manageUsers : !sharing.canManage(currentWs(), person.id))
      fail(403, 'Приглашать во все проекты может администратор или участник с полным доступом.');
    limit('invitation:' + person.id, 10);
    const email = text(b.email, 150).toLowerCase(),
      name = text(b.name, 70);
    if (!/^\S+@\S+\.\S+$/.test(email) || !name || !roles.has(b.role))
      fail(400, 'Укажите имя, почту и уровень доступа.');
    const existing = q(
      'SELECT u.id,a.all_projects,a.admin,a.revoked FROM user u JOIN mnema_access a ON a.user_id=u.id WHERE lower(u.email)=?',
    ).get(email);
    if (existing?.revoked) fail(403, 'Доступ к аккаунту закрыт. Обратитесь к администратору.');
    if (existing?.id && sharing.canManage(currentWs(), existing.id) && !all)
      fail(409, 'У владельца уже есть доступ к проекту.');
    if (existing?.admin && all) fail(403, 'Доступ владельца не изменяется.');
    const duplicate = all
      ? existing?.all_projects ||
        q(
          "SELECT 1 FROM mnema_invites WHERE email=? AND workspace_id='*' AND used=0 AND revoked=0 AND expires>?",
        ).get(email, Date.now())
      : users().some(
          (u) => u.email.toLowerCase() === email && !['expired', 'revoked'].includes(u.status),
        );
    if (duplicate) fail(409, 'Этот адрес уже добавлен. Измените доступ в таблице пользователей.');
    const mailArgs = {
      to: email,
      name,
      workspaceId: workspace,
      workspaceName: all
        ? 'Все проекты'
        : q('SELECT name FROM mnema_workspaces WHERE id=?').get(currentWs()).name,
      inviterName: person.name,
      role: b.role,
      baseURL,
    };
    if (existing) {
      if (all) grantAllProjects(existing.id, b.role);
      else
        q(
          "INSERT INTO mnema_members(workspace_id,user_id,role,admin,revoked) VALUES(?,?,?,0,0) ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=excluded.role,revoked=0,grant_source='explicit'",
        ).run(currentWs(), existing.id, b.role);
      const emailStatus = await sendInvitationEmail(mailArgs, options.sendInvitationMail);
      return { added: true, emailStatus };
    }
    const token = randomBytes(32).toString('base64url');
    q(
      'INSERT INTO mnema_invites(id,token_hash,email,name,role,expires,used,revoked,workspace_id) VALUES(?,?,?,?,?,?,0,0,?)',
    ).run(randomUUID(), hash(token), email, name, b.role, Date.now() + 7 * 86400000, workspace);
    const inviteURL =
      origin +
      '/signup?invite=' +
      token +
      '&email=' +
      encodeURIComponent(email) +
      (all ? '' : '&returnTo=' + encodeURIComponent('/projects/' + encodeURIComponent(workspace)));
    const emailStatus = await sendInvitationEmail(
      { ...mailArgs, inviteURL },
      options.sendInvitationMail,
    );
    return { inviteURL, emailStatus };
  };
  return inviteToProject;
}
