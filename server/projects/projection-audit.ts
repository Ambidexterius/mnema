import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { compareWorkspaceProjection, projectionTotals } from './projection.ts';

export const projectionAuditIntervalMs = 5 * 60_000;
const maxGapMs = projectionAuditIntervalMs + 60_000;
const windowMs = 72 * 60 * 60_000;
const program = fileURLToPath(import.meta.url);

export function readWorkspaceProjection(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    // JSON and its projection must be read from one SQLite snapshot.
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000; BEGIN');
    return compareWorkspaceProjection(db);
  } finally {
    db.close();
  }
}

function checkProjection(path: string) {
  try {
    const report = readWorkspaceProjection(path);
    return {
      status: report.ok ? ('ok' as const) : ('drift' as const),
      ...projectionTotals(report),
      differences: report.projects
        .filter(({ differences }) => differences.length)
        .map(({ id, differences }) => ({ id, tables: differences })),
      orphans: report.orphans,
    };
  } catch (error) {
    return {
      status: 'error' as const,
      error: error instanceof Error ? error.name : 'UnknownError',
    };
  }
}

function recordAudit(
  dir: string,
  build: string,
  checkedAt: number,
  check: ReturnType<typeof checkProjection>,
  started: number,
) {
  const journal = new DatabaseSync(join(dir, '.workspace-projection-audit.sqlite'));
  try {
    journal.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
    journal.exec(
      'CREATE TABLE IF NOT EXISTS runs (' +
        'id INTEGER PRIMARY KEY, checked_at INTEGER NOT NULL, build TEXT NOT NULL,' +
        'healthy_since INTEGER, clean_checks INTEGER NOT NULL, result TEXT NOT NULL)',
    );
    const previous = journal
      .prepare(
        'SELECT checked_at,build,healthy_since,clean_checks FROM runs ORDER BY id DESC LIMIT 1',
      )
      .get();
    const gapMs = typeof previous?.checked_at === 'number' ? checkedAt - previous.checked_at : null;
    const previousHealthy =
      typeof previous?.healthy_since === 'number' ? previous.healthy_since : null;
    const continues =
      previous?.build === build &&
      previousHealthy !== null &&
      gapMs != null &&
      gapMs >= 0 &&
      gapMs <= maxGapMs;
    const healthySince = check.status === 'ok' ? (continues ? previousHealthy : checkedAt) : null;
    const cleanChecks =
      check.status === 'ok' ? (continues ? Number(previous.clean_checks) + 1 : 1) : 0;
    const windowComplete = healthySince !== null && checkedAt - healthySince >= windowMs;
    const event = {
      ...check,
      build,
      checkedAt: new Date(checkedAt).toISOString(),
      healthySince: healthySince === null ? null : new Date(healthySince).toISOString(),
      cleanChecks,
      gapMs,
      windowComplete,
      elapsedMs: Math.round(performance.now() - started),
    };
    journal
      .prepare(
        'INSERT INTO runs(checked_at,build,healthy_since,clean_checks,result) VALUES(?,?,?,?,?)',
      )
      .run(checkedAt, build, healthySince, cleanChecks, JSON.stringify(event));
    journal.exec('COMMIT');
    return event;
  } finally {
    journal.close();
  }
}

export function auditWorkspaceProjection(dir: string, build: string, checkedAt = Date.now()) {
  const started = performance.now();
  return recordAudit(dir, build, checkedAt, checkProjection(join(dir, 'mnema.sqlite')), started);
}

export function startWorkspaceProjectionAudit(dir: string, build: string) {
  let stopRun: (() => void) | undefined;

  function run() {
    if (stopRun) return;
    const child = spawn(process.execPath, [program, dir, build], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    let stopped = false;
    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, 60_000);
    deadline.unref();
    stopRun = () => {
      stopped = true;
      clearTimeout(deadline);
      child.kill();
    };
    child.on('error', (error) =>
      console.error('Workspace projection audit worker failed', error.name),
    );
    child.once('close', (code, signal) => {
      clearTimeout(deadline);
      stopRun = undefined;
      if (stopped || (!signal && (code === 0 || code === 1 || code === 2))) return;
      const error = timedOut ? 'WorkerTimeout' : 'WorkerExit';
      try {
        const failure = recordAudit(
          dir,
          build,
          Date.now(),
          { status: 'error', error },
          performance.now(),
        );
        console.error('Workspace projection audit', JSON.stringify(failure));
      } catch {
        console.error('Workspace projection audit journal unavailable after worker failure', error);
      }
    });
  }

  run();
  const timer = setInterval(run, projectionAuditIntervalMs);
  timer.unref();
  return () => {
    clearInterval(timer);
    stopRun?.();
  };
}

if (process.argv[1] && resolve(process.argv[1]) === program) {
  process.umask(0o077);
  const [dir, build] = process.argv.slice(2);
  try {
    if (!dir || !build) throw new Error('Missing audit arguments');
    const event = auditWorkspaceProjection(dir, build);
    const line = JSON.stringify(event);
    if (event.status === 'ok') console.info('Workspace projection audit', line);
    else console.error('Workspace projection audit', line);
    process.exitCode = event.status === 'ok' ? 0 : event.status === 'drift' ? 1 : 2;
  } catch (error) {
    console.error(
      'Workspace projection audit journal failed',
      error instanceof Error ? error.name : 'UnknownError',
    );
    process.exitCode = 3;
  }
}
