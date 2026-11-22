import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { configureDatabase, createCoreTables } from './db.ts';
import { initializeWorkspaceProjection } from './projects/projection.ts';
import {
  auditWorkspaceProjection,
  projectionAuditIntervalMs,
} from './projects/projection-audit.ts';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'mnema-projection-audit-'));
  const db = new DatabaseSync(join(dir, 'mnema.sqlite'));
  configureDatabase(db);
  createCoreTables(db);
  db.exec('CREATE TABLE mnema_migrations(name TEXT PRIMARY KEY)');
  db.prepare("INSERT INTO mnema_workspaces VALUES('demo','Synthetic',0,?,0,NULL)").run(
    JSON.stringify({ studies: [{ id: 's', title: 'Synthetic', segments: [] }], findings: [] }),
  );
  initializeWorkspaceProjection(db);
  return {
    dir,
    db,
    close() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('regular checks preserve 72 hours of clean observations before closing the window', () => {
  const { dir, close } = fixture();
  const start = Date.UTC(2026, 10, 22);
  const steps = (72 * 60 * 60_000) / projectionAuditIntervalMs;
  try {
    for (let i = 0; i <= steps; i++) {
      const event = auditWorkspaceProjection(
        dir,
        'test-build',
        start + i * projectionAuditIntervalMs,
      );
      assert.equal(event.status, 'ok');
      assert.equal(event.healthySince, new Date(start).toISOString());
      assert.equal(event.cleanChecks, i + 1);
      assert.equal(event.windowComplete, i === steps);
    }
  } finally {
    close();
  }
});

test('drift, read errors, missed cycles, and build changes interrupt the observation window', () => {
  const { dir, db, close } = fixture();
  const start = Date.UTC(2026, 10, 22);
  const interval = projectionAuditIntervalMs;
  const check = (i: number, build = 'first-build') =>
    auditWorkspaceProjection(dir, build, start + i * interval);
  try {
    assert.equal(check(0).cleanChecks, 1);
    assert.equal(check(1).cleanChecks, 2);
    assert.equal(check(3).cleanChecks, 1);
    assert.equal(check(4, 'new-build').cleanChecks, 1);

    db.exec("UPDATE mnema_studies SET title='Drift'");
    const drift = check(5, 'new-build');
    assert.equal(drift.status, 'drift');
    assert.equal(drift.healthySince, null);
    assert.deepEqual('differences' in drift && drift.differences, [
      { id: 'demo', tables: ['mnema_studies'] },
    ]);
    assert.equal(db.prepare('SELECT title FROM mnema_studies').get().title, 'Drift');
    assert.equal(
      db
        .prepare("SELECT json_extract(data, '$.studies[0].title') AS title FROM mnema_workspaces")
        .get().title,
      'Synthetic',
    );

    db.exec('DROP TABLE mnema_studies');
    assert.equal(check(6, 'new-build').status, 'error');
    const auditDb = new DatabaseSync(join(dir, '.workspace-projection-audit.sqlite'), {
      readOnly: true,
    });
    try {
      const stored = auditDb
        .prepare('SELECT result FROM runs ORDER BY id DESC LIMIT 1')
        .get().result;
      assert.equal(JSON.parse(String(stored)).status, 'error');
    } finally {
      auditDb.close();
    }
  } finally {
    close();
  }
});
