import type { openDatabase } from '../db.ts';
import type { Person } from '../request-context.ts';

interface MembershipServices {
  db: Pick<ReturnType<typeof openDatabase>['db'], 'exec'>;
  q: ReturnType<typeof openDatabase>['q'];
  currentWs: () => string;
}

export function createMembership({ db, q, currentWs }: MembershipServices) {
  const ownerExists = () => Boolean(q('SELECT 1 FROM mnema_access WHERE admin=1 LIMIT 1').get());
  const users = () =>
    q(
      `SELECT u.id,u.name,u.email,m.role,m.admin,m.revoked,a.all_projects FROM user u JOIN mnema_members m ON m.user_id=u.id JOIN mnema_access a ON a.user_id=u.id JOIN mnema_project_sharing s ON s.workspace_id=m.workspace_id WHERE m.workspace_id=? AND (m.grant_source='explicit' OR s.mode='legacy' OR s.owner_id=m.user_id)`,
    )
      .all(currentWs())
      .map((u) => ({
        ...u,
        owner: Boolean(u.admin),
        scope: u.all_projects ? 'all' : 'project',
        status: u.revoked ? 'revoked' : 'active',
      }))
      .concat(
        q(`SELECT i.id,i.name,i.email,i.role,i.expires,i.revoked,i.workspace_id FROM mnema_invites i
   WHERE i.workspace_id IN (?,'*') AND i.used=0
   AND NOT EXISTS(SELECT 1 FROM mnema_invites newer WHERE newer.workspace_id=i.workspace_id AND newer.email=i.email AND newer.used=0 AND newer.rowid>i.rowid)
   AND NOT EXISTS(SELECT 1 FROM user u JOIN mnema_members m ON m.user_id=u.id WHERE lower(u.email)=i.email AND m.workspace_id=?)`)
          .all(currentWs(), currentWs())
          .map((u) => ({
            ...u,
            scope: u.workspace_id === '*' ? 'all' : 'project',
            status: u.revoked ? 'revoked' : u.expires <= Date.now() ? 'expired' : 'invited',
          })),
      );
  // Account-wide grants apply only to projects that retain their legacy access policy.
  const grantAllProjects = (id: string, role: string) => {
    q('UPDATE mnema_access SET all_projects=1,role=?,revoked=0 WHERE user_id=?').run(role, id);
    q(`INSERT INTO mnema_members(workspace_id,user_id,role,admin,revoked,grant_source) SELECT w.id,?,?,0,0,'all' FROM mnema_workspaces w JOIN mnema_project_sharing s ON s.workspace_id=w.id WHERE s.mode='legacy'
   ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=CASE WHEN mnema_members.admin=1 THEN 'full' WHEN mnema_members.grant_source='explicit' THEN mnema_members.role ELSE excluded.role END`).run(
      id,
      role,
    );
  };
  // Apply the explicitly requested widening once; later explicit project-only invitations stay scoped.
  if (!q("SELECT 1 FROM mnema_migrations WHERE name='all-existing-users-2026-11-13'").get()) {
    db.exec('BEGIN');
    try {
      for (const user of q('SELECT user_id,role FROM mnema_access WHERE revoked=0').all())
        grantAllProjects(user.user_id, user.role);
      q("UPDATE mnema_invites SET workspace_id='*' WHERE used=0 AND revoked=0").run();
      q("INSERT INTO mnema_migrations(name) VALUES('all-existing-users-2026-11-13')").run();
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  const userDirectory = (person: Person) => {
    const visible = new Set(person.workspaces.map((w) => w.id));
    const members = q(
      'SELECT m.*,w.name FROM mnema_members m JOIN mnema_workspaces w ON w.id=m.workspace_id ORDER BY w.created',
    ).all();
    const accounts = q(
      'SELECT u.id,u.name,u.email,a.role,a.admin,a.revoked,a.all_projects FROM user u JOIN mnema_access a ON a.user_id=u.id',
    )
      .all()
      .map((user) => {
        const grants = members.filter((m) => m.user_id === user.id),
          active = grants.filter((m) => !m.revoked),
          shown = (active.length ? active : grants).filter((m) => visible.has(m.workspace_id));
        return {
          ...user,
          admin: Boolean(user.admin),
          owner: Boolean(user.admin),
          scope: user.all_projects ? 'all' : 'project',
          role: user.all_projects ? user.role : shown[0]?.role || user.role,
          projectIds: shown.map((m) => m.workspace_id),
          projectNames: shown.map((m) => m.name),
          status: user.revoked ? 'revoked' : 'active',
        };
      });
    const invites = q(
      `SELECT i.* FROM mnema_invites i WHERE used=0 AND NOT EXISTS(SELECT 1 FROM mnema_invites newer WHERE newer.email=i.email AND newer.workspace_id=i.workspace_id AND newer.used=0 AND newer.rowid>i.rowid) ORDER BY i.rowid DESC`,
    )
      .all()
      .filter(
        (invite) =>
          (invite.workspace_id === '*' || visible.has(invite.workspace_id)) &&
          !accounts.some((account) => account.email.toLowerCase() === invite.email.toLowerCase()),
      )
      .map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        scope: user.workspace_id === '*' ? 'all' : 'project',
        expires: user.expires,
        projectIds: user.workspace_id === '*' ? [] : [user.workspace_id],
        projectNames:
          user.workspace_id === '*'
            ? []
            : [
                q('SELECT name FROM mnema_workspaces WHERE id=?').get(user.workspace_id)?.name ||
                  'Удалённый проект',
              ],
        status: user.revoked ? 'revoked' : user.expires <= Date.now() ? 'expired' : 'invited',
      }));
    return [...accounts, ...invites];
  };
  return { ownerExists, users, grantAllProjects, userDirectory };
}
