import { routeHref } from '../app/routes.ts';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import type { WorkspaceReader } from './projects/store.ts';
import type { Segment, Study } from '../app/types.ts';
export interface CompletionMail {
  to: string;
  subject: string;
  text: string;
  html: string;
  messageId: string;
}
const htmlCharacters = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => htmlCharacters[c as keyof typeof htmlCharacters]);
export const smtpConfigured = () =>
  ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'].every((k) => Boolean(process.env[k]));
export function completionEmail({
  study,
  workspaceId,
  workspaceName,
  baseURL,
  to,
  jobId,
  canReadDraft,
}: {
  study: Pick<Study, 'id' | 'title' | 'date' | 'addedBy' | 'summary'> & {
    segments: Pick<Segment, 'id' | 'page' | 'time'>[];
    summaryInfo?: Pick<NonNullable<Study['summaryInfo']>, 'state' | 'review'>;
  };
  workspaceId: string;
  workspaceName: string;
  baseURL: string;
  to: string;
  jobId: string;
  canReadDraft: boolean;
}): CompletionMail {
  const link = (segment?: string) => {
    const url = new URL(routeHref('study/' + encodeURIComponent(study.id), workspaceId), baseURL);
    if (segment) url.searchParams.set('segment', segment);
    return url.href;
  };
  const summary =
    study.summaryInfo?.state === 'ready' &&
    (canReadDraft || study.summaryInfo.review === 'verified')
      ? study.summary || []
      : [];
  const title = summary.length ? 'Расшифровка и сводка готовы' : 'Расшифровка готова';
  const draft = summary.length && study.summaryInfo?.review !== 'verified';
  const note = draft
    ? 'Сводка — черновик ИИ. Проверьте выводы по исходной записи.'
    : study.summaryInfo?.state === 'error'
      ? 'Сводку пока не удалось создать. Расшифровка сохранена.'
      : '';
  const blocks = summary.map((block) => {
    const sources = (block.segments || [])
      .map((id: string) => study.segments?.find((s) => s.id === id))
      .filter((source) => source !== undefined);
    return { ...block, sources };
  });
  const where = (s: Pick<Segment, 'page' | 'time'>) =>
    s.page
      ? 'стр. ' + s.page
      : Math.floor((s.time || 0) / 60) +
        ':' +
        String(Math.floor((s.time || 0) % 60)).padStart(2, '0');
  const text = [
    workspaceName,
    title + ': ' + study.title,
    note,
    ...blocks.flatMap((b) => [
      b.title,
      b.text,
      ...b.sources.map((s) => where(s) + ' — ' + link(s.id)),
    ]),
    'Открыть материал: ' + link(),
  ]
    .filter(Boolean)
    .join('\n\n');
  const body = blocks
    .map(
      (b) =>
        '<h2 style="font-size:16px;line-height:24px;margin:28px 0 8px">' +
        escape(b.title) +
        '</h2><p style="margin:0;line-height:24px">' +
        escape(b.text).replace(/\n/g, '<br>') +
        '</p><p style="font-size:13px;line-height:20px">' +
        b.sources
          .map(
            (s) =>
              '<a href="' +
              escape(link(s.id)) +
              '" style="color:#7252a3">' +
              escape(where(s)) +
              '</a>',
          )
          .join(' · ') +
        '</p>',
    )
    .join('');
  const html =
    '<!doctype html><html lang="ru"><meta charset="utf-8"><body style="margin:0;padding:32px 16px;background:#fafafa;color:#242424;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto"><tr><td style="padding:0 0 24px;font-size:20px;font-weight:bold">Мнемодак <span style="color:#EE204D">β</span></td></tr><tr><td style="padding:0 0 16px;font-size:14px;color:#656565">' +
    escape(workspaceName) +
    '</td></tr><tr><td style="border:1px solid #e5e5e5;border-radius:8px;padding:24px;background:#fff"><p style="color:#656565;font-size:13px;margin:0 0 8px">' +
    escape(title) +
    '</p><h1 style="font-size:22px;line-height:30px;margin:0 0 8px">' +
    escape(study.title) +
    '</h1><p style="font-size:13px;color:#656565">' +
    escape(study.date) +
    ' · ' +
    escape(study.addedBy || '') +
    '</p>' +
    (note
      ? '<p style="font-size:14px;line-height:22px;color:#656565">' + escape(note) + '</p>'
      : '') +
    body +
    '<p style="margin:28px 0 0"><a href="' +
    escape(link()) +
    '" style="display:inline-block;padding:12px 20px;background:#EE204D;border-radius:8px;color:#fff;text-decoration:none">Открыть материал</a></p></td></tr></table></body></html>';
  return {
    to,
    subject:
      title +
      ': ' +
      String(study.title)
        .replace(/[\r\n]/g, ' ')
        .slice(0, 140),
    text,
    html,
    messageId:
      '<mnemonika-' + jobId.replace(/[^a-zA-Z0-9-]/g, '') + '@' + new URL(baseURL).hostname + '>',
  };
}
export function sendSmtp(message: CompletionMail): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.env.MAIL_PYTHON || 'python3',
      [join(dirname(fileURLToPath(import.meta.url)), 'send-mail.py')],
      { stdio: ['pipe', 'ignore', 'ignore'], timeout: 30000 },
    );
    child.on('error', () => reject(new Error('smtp_process_failed')));
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error('smtp_delivery_failed')),
    );
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(message));
  });
}
export function createCompletionMailer({
  db,
  baseURL,
  send,
  getAccess,
  readWorkspace,
}: {
  db: DatabaseSync;
  baseURL: string;
  send?: (message: CompletionMail) => Promise<void>;
  getAccess?: (userId: string, workspaceId: string) => { role: string } | undefined;
  readWorkspace?: WorkspaceReader;
}) {
  const enabled = Boolean(send) || smtpConfigured();
  const deliver = send || sendSmtp;
  const q = (sql: string) => db.prepare(sql) as any;
  const lookup =
    readWorkspace ??
    ((id: string) => {
      const row = q('SELECT name,data FROM mnema_workspaces WHERE id=?').get(id);
      return row
        ? { name: String(row.name), state: JSON.parse(row.data) as { studies: Study[] } }
        : undefined;
    });
  db.exec(
    "CREATE TABLE IF NOT EXISTS mnema_completion_mail(job_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,study_id TEXT NOT NULL,user_id TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0)",
  );
  q("UPDATE mnema_completion_mail SET status='pending' WHERE status='sending'").run();
  const queue = (jobId: string, workspaceId: string, studyId: string, userId: string) => {
    if (enabled && userId)
      q(
        'INSERT OR IGNORE INTO mnema_completion_mail(job_id,workspace_id,study_id,user_id) VALUES(?,?,?,?)',
      ).run(jobId, workspaceId, studyId, userId);
  };
  let busy = false,
    closed = false;
  const tick = async () => {
    if (!enabled || busy || closed) return;
    busy = true;
    try {
      for (const job of q(
        "SELECT * FROM mnema_completion_mail WHERE status='pending' AND next_at<=? LIMIT 20",
      ).all(Date.now())) {
        const ws = lookup(job.workspace_id);
        const study = ws?.state.studies.find((s) => s.id === job.study_id);
        const person = getAccess
          ? q(
              'SELECT u.email FROM user u JOIN mnema_access a ON a.user_id=u.id WHERE u.id=? AND a.revoked=0',
            ).get(job.user_id)
          : q(
              'SELECT u.email,m.role FROM user u JOIN mnema_access a ON a.user_id=u.id JOIN mnema_members m ON m.user_id=u.id WHERE u.id=? AND m.workspace_id=? AND a.revoked=0 AND m.revoked=0',
            ).get(job.user_id, job.workspace_id);
        const access = person && (getAccess ? getAccess(job.user_id, job.workspace_id) : person);
        if (!ws || !study || !person || !access || ['error', 'cancelled'].includes(study.status)) {
          q("UPDATE mnema_completion_mail SET status='skipped' WHERE job_id=?").run(job.job_id);
          continue;
        }
        if (
          study.status !== 'ready' ||
          study.summaryInfo?.state === 'queued' ||
          study.summaryInfo?.state === 'running'
        ) {
          q('UPDATE mnema_completion_mail SET next_at=? WHERE job_id=?').run(
            Date.now() + 5000,
            job.job_id,
          );
          continue;
        }
        q(
          "UPDATE mnema_completion_mail SET status='sending',attempts=attempts+1 WHERE job_id=?",
        ).run(job.job_id);
        try {
          await deliver(
            completionEmail({
              study,
              workspaceId: job.workspace_id,
              workspaceName: ws.name,
              baseURL,
              to: person.email,
              jobId: job.job_id,
              canReadDraft: access.role === 'full',
            }),
          );
          if (!closed)
            q("UPDATE mnema_completion_mail SET status='sent' WHERE job_id=?").run(job.job_id);
        } catch {
          if (!closed) {
            q('UPDATE mnema_completion_mail SET status=?,next_at=? WHERE job_id=?').run(
              job.attempts >= 4 ? 'failed' : 'pending',
              Date.now() + Math.min(3600000, 60000 * 2 ** job.attempts),
              job.job_id,
            );
            console.error('Completion email delivery failed');
          }
        }
      }
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(
    () => void tick().catch(() => console.error('Completion email queue failed')),
    1000,
  );
  timer.unref();
  return {
    queue,
    tick,
    close() {
      closed = true;
      clearInterval(timer);
    },
  };
}
