import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { routeHref } from '../app/routes.ts';

const fail = (status: number, message: string): never => {
  throw Object.assign(new Error(message), { status });
};
export function createProjectSharing(db: any, baseURL: string, secret: string, fromTables = false) {
  const q = (sql: string) => db.prepare(sql);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(
      `CREATE TABLE IF NOT EXISTS mnema_project_sharing(workspace_id TEXT PRIMARY KEY,mode TEXT NOT NULL CHECK(mode IN ('legacy','private','all','link')),owner_id TEXT,nonce TEXT NOT NULL,FOREIGN KEY(workspace_id) REFERENCES mnema_workspaces(id) ON DELETE CASCADE)`,
    );
    if (
      !q('PRAGMA table_info(mnema_members)')
        .all()
        .some((c) => c.name === 'grant_source')
    )
      db.exec("ALTER TABLE mnema_members ADD COLUMN grant_source TEXT NOT NULL DEFAULT 'explicit'");
    // Existing grants keep their reach; their origin matters only after the owner changes sharing.
    if (!q("SELECT 1 FROM mnema_migrations WHERE name='project-sharing-v1'").get())
      q(
        "UPDATE mnema_members SET grant_source='all' WHERE admin=0 AND user_id IN(SELECT user_id FROM mnema_access WHERE all_projects=1)",
      ).run();
    q(
      `INSERT OR IGNORE INTO mnema_project_sharing SELECT w.id,'legacy',coalesce(w.created_by,(SELECT user_id FROM mnema_members m WHERE m.workspace_id=w.id AND m.admin=1 ORDER BY rowid LIMIT 1),(SELECT a.user_id FROM mnema_access a JOIN mnema_members m ON m.user_id=a.user_id WHERE m.workspace_id=w.id AND a.admin=1 ORDER BY a.rowid LIMIT 1)),lower(hex(randomblob(32))) FROM mnema_workspaces w`,
    ).run();
    q("INSERT OR IGNORE INTO mnema_migrations VALUES('project-sharing-v1')").run();
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  const row = (id: string) => {
    const r = q('SELECT * FROM mnema_project_sharing WHERE workspace_id=?').get(id);
    if (!r) fail(404, 'Проект не найден.');
    return r;
  };
  const claimUnowned = (userId: string) =>
    q("UPDATE mnema_project_sharing SET owner_id=? WHERE owner_id IS NULL AND mode='legacy'").run(
      userId,
    );
  const canManage = (id: string, userId: string) =>
    Boolean(
      q('SELECT 1 FROM mnema_project_sharing WHERE workspace_id=? AND owner_id=?').get(id, userId),
    );
  const own = (id: string, userId: string) => {
    if (!canManage(id, userId)) fail(403, 'Управлять доступом может только владелец проекта.');
    return row(id);
  };
  const token = (id: string, r = row(id)) =>
    createHmac('sha256', secret)
      .update('project-share:' + id + ':' + r.nonce)
      .digest('base64url');
  const validLink = (id: string, value: string) => {
    const r = q('SELECT * FROM mnema_project_sharing WHERE workspace_id=?').get(id);
    if (!r || r.mode !== 'link' || typeof value !== 'string') return false;
    const a = Buffer.from(value),
      b = Buffer.from(token(id, r));
    return a.length === b.length && timingSafeEqual(a, b);
  };
  const revision = fromTables
    ? '(SELECT data_hash FROM mnema_projection_source WHERE workspace_id=w.id)'
    : 'length(w.data)';
  const projects = (userId: string) =>
    q(`SELECT w.id,w.name,w.version,${revision} AS data_length,s.mode,s.owner_id,m.role AS member_role,m.admin AS member_admin,m.grant_source,
 CASE WHEN s.owner_id=? THEN 'full' WHEN m.revoked=0 AND (m.grant_source='explicit' OR s.mode='legacy') THEN m.role ELSE 'view' END AS role,
 CASE WHEN s.owner_id=? THEN 1 ELSE 0 END AS admin,
 (SELECT count(*) FROM mnema_members members WHERE members.workspace_id=w.id AND members.revoked=0) AS member_count
 FROM mnema_workspaces w JOIN mnema_project_sharing s ON s.workspace_id=w.id LEFT JOIN mnema_members m ON m.workspace_id=w.id AND m.user_id=?
 WHERE (s.owner_id=? OR m.revoked=0 AND (m.grant_source='explicit' OR s.mode='legacy') OR s.mode='all') AND EXISTS(SELECT 1 FROM mnema_access a WHERE a.user_id=? AND a.revoked=0) ORDER BY w.created`).all(
      userId,
      userId,
      userId,
      userId,
      userId,
    );
  const linkProject = (id: string) => {
    const r = q(
      `SELECT w.id,w.name,w.version,${revision} AS data_length,s.mode,s.owner_id,s.nonce,'view' AS role,0 AS admin,0 AS member_count FROM mnema_workspaces w JOIN mnema_project_sharing s ON s.workspace_id=w.id WHERE w.id=?`,
    ).get(id);
    return r;
  };
  const validRevision = (id: string, nonce: string) =>
    Boolean(
      q("SELECT 1 FROM mnema_project_sharing WHERE workspace_id=? AND mode='link' AND nonce=?").get(
        id,
        nonce,
      ),
    );
  const info = (id: string, userId: string) => {
    const r = own(id, userId),
      owner = q('SELECT id,name,email FROM user WHERE id=?').get(r.owner_id);
    const members = q(
      `SELECT u.id,u.name,u.email,m.role,m.grant_source AS accessSource,a.revoked AS accountRevoked,'active' AS status FROM mnema_members m JOIN user u ON u.id=m.user_id JOIN mnema_access a ON a.user_id=u.id WHERE m.workspace_id=? AND m.user_id!=? AND m.revoked=0 AND (m.grant_source='explicit' OR ?='legacy')`,
    ).all(id, r.owner_id, r.mode);
    const invites = q(
      `SELECT id,name,email,role,CASE WHEN expires>? THEN 'invited' ELSE 'expired' END AS status FROM mnema_invites i WHERE workspace_id=? AND used=0 AND revoked=0 AND NOT EXISTS(SELECT 1 FROM mnema_invites n WHERE n.workspace_id=i.workspace_id AND n.email=i.email AND n.used=0 AND n.rowid>i.rowid)`,
    )
      .all(Date.now(), id)
      .filter((i) => !members.some((m) => m.email.toLowerCase() === i.email.toLowerCase()));
    const url = new URL(routeHref('home', id), baseURL);
    if (r.mode === 'link') url.searchParams.set('share', token(id, r));
    return {
      mode: r.mode,
      canManage: true,
      owner,
      members: [...members, ...invites],
      link: { url: url.href, enabled: r.mode === 'link' },
    };
  };
  const init = (id: string, ownerId: string, mode = 'all') => {
    if (!['private', 'all', 'link'].includes(mode)) fail(400, 'Выберите способ доступа к проекту.');
    q('INSERT INTO mnema_project_sharing VALUES(?,?,?,?)').run(
      id,
      mode,
      ownerId,
      randomBytes(32).toString('hex'),
    );
  };
  const setMode = (id: string, userId: string, mode: unknown) => {
    const previous = own(id, userId);
    if (typeof mode !== 'string' || !['private', 'all', 'link'].includes(mode))
      fail(400, 'Выберите способ доступа к проекту.');
    if (previous.mode === mode) return info(id, userId);
    q('UPDATE mnema_project_sharing SET mode=?,nonce=? WHERE workspace_id=?').run(
      mode,
      randomBytes(32).toString('hex'),
      id,
    );
    return info(id, userId);
  };
  const rotate = (id: string, userId: string) => {
    const r = own(id, userId);
    if (r.mode !== 'link') fail(409, 'Сначала включите доступ по ссылке.');
    q('UPDATE mnema_project_sharing SET nonce=? WHERE workspace_id=?').run(
      randomBytes(32).toString('hex'),
      id,
    );
    return info(id, userId);
  };
  const member = (id: string, userId: string, memberId: string, role?: unknown) => {
    const r = own(id, userId);
    if (memberId === r.owner_id) fail(403, 'Доступ владельца не изменяется.');
    if (role !== undefined && (typeof role !== 'string' || !['view', 'full'].includes(role)))
      fail(400, 'Выберите уровень доступа.');
    const account = q(
        'SELECT 1 FROM mnema_members WHERE workspace_id=? AND user_id=? AND revoked=0',
      ).get(id, memberId),
      invite = q(
        'SELECT 1 FROM mnema_invites WHERE workspace_id=? AND id=? AND used=0 AND revoked=0',
      ).get(id, memberId);
    if (!account && !invite) fail(404, 'Участник не найден.');
    if (account) {
      if (role === undefined)
        q('UPDATE mnema_members SET revoked=1 WHERE workspace_id=? AND user_id=?').run(
          id,
          memberId,
        );
      else
        q(
          "UPDATE mnema_members SET role=?,grant_source='explicit' WHERE workspace_id=? AND user_id=?",
        ).run(role, id, memberId);
    }
    if (invite) {
      if (role === undefined)
        q('UPDATE mnema_invites SET revoked=1 WHERE workspace_id=? AND id=?').run(id, memberId);
      else
        q('UPDATE mnema_invites SET role=? WHERE workspace_id=? AND id=?').run(role, id, memberId);
    }
    return info(id, userId);
  };
  return {
    projects,
    linkProject,
    canManage,
    claimUnowned,
    validLink,
    validRevision,
    info,
    init,
    setMode,
    rotate,
    member,
  };
}
