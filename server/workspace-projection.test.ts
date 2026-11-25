import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { test } from 'node:test';
import { configureDatabase, createCoreTables, openDatabase } from './db.ts';
import {
  compareWorkspaceProjection,
  initializeWorkspaceProjection,
} from './projects/projection.ts';
import { createProjectStore, createWorkspaceFactory } from './projects/store.ts';
import { modelKeyStore } from './model-connections.ts';
import type { Person } from './request-context.ts';
import type { StoredWorkspace } from './projects/types.ts';

const fixture = (): StoredWorkspace => ({
  studies: [
    {
      id: 'sample',
      title: 'Synthetic sample',
      description: '',
      project: 'Synthetic',
      format: 'Видео',
      date: '',
      duration: 2,
      participants: 1,
      color: '',
      findings: 1,
      type: 'Интервью',
      status: 'ready',
      tags: ['fixture'],
      segments: [
        { id: 'part', time: 0.25, end: 1.6, speaker: 'Voice', text: 'Synthetic text', page: 1 },
      ],
      summary: [{ title: 'Block', text: 'Summary', segments: ['part'] }],
      summaryInfo: {
        state: 'ready',
        revision: 'r1',
        modelId: 'fixture',
        requestedBy: 'owner',
        startedAt: 1,
        review: 'verified',
      },
      findingsInfo: { state: 'ready', progress: null },
    },
  ],
  findings: [
    {
      id: 'finding',
      studyId: 'sample',
      segmentId: 'part',
      evidence: ['stale-reference'],
      title: 'Finding',
      kind: 'Инсайт',
      importance: 'Средняя',
      origin: 'human',
      significant: false,
      history: [],
      description: 'Finding text',
      status: 'verified',
    },
  ],
  highlights: [
    { id: 'h1', studyId: 'sample', segmentId: 'part', text: 'Synthetic', by: 'Owner', at: 1 },
  ],
  projectSummary: { answer: 'Project overview', at: 1, model: 'fixture' },
  models: [],
  processors: [],
  modelId: '',
});
function database() {
  const { db, q } = openDatabase(':memory:');
  configureDatabase(db);
  createCoreTables(db);
  db.exec('CREATE TABLE mnema_migrations(name TEXT PRIMARY KEY)');
  const insert = db.prepare('INSERT INTO mnema_workspaces VALUES (?, ?, 0, ?, 1, NULL)');
  for (const id of ['a', 'b']) insert.run(id, id, JSON.stringify(fixture()));
  return { db, q };
}

test('backfill checks every entity and leaves existing JSON unchanged', () => {
  const { db } = database();
  try {
    const select = db.prepare('SELECT * FROM mnema_workspaces ORDER BY id');
    const before = select.all();
    const first = initializeWorkspaceProjection(db);
    assert.equal(first.rebuilt, 2);
    assert.deepEqual(select.all(), before);
    assert.equal(first.report.ok, true);
    assert.deepEqual(first.report.projects[0].counts, {
      mnema_studies: 1,
      mnema_segments: 1,
      mnema_findings: 1,
      mnema_finding_evidence: 2,
      mnema_summaries: 2,
      mnema_analysis_jobs: 2,
      mnema_highlights: 1,
    });
    const evidence = db.prepare(
      "SELECT segment_id FROM mnema_finding_evidence WHERE workspace_id='a' ORDER BY seq",
    );
    assert.deepEqual(
      evidence.all().map((row) => row.segment_id),
      ['part', 'stale-reference'],
    );
    assert.equal(initializeWorkspaceProjection(db).rebuilt, 0);
    db.exec("UPDATE mnema_findings SET title='Different content' WHERE workspace_id='b'");
    const bad = compareWorkspaceProjection(db);
    assert.equal(bad.ok, false);
    assert.deepEqual(
      bad.projects.map((p) => p.differences),
      [[], ['mnema_findings']],
    );
    assert.throws(() => initializeWorkspaceProjection(db), /differs from JSON/);
  } finally {
    db.close();
  }
});

test('double write commits and rolls back with JSON, and startup replays old-version changes', () => {
  const { db, q } = database();
  try {
    const { write } = initializeWorkspaceProjection(db);
    const wsStore = new AsyncLocalStorage<string>();
    const { getState, mutate } = createProjectStore({
      db,
      q,
      currentWs: () => wsStore.getStore() || 'a',
      wsStore,
      modelKeys: modelKeyStore(db, 'synthetic-test-secret'),
      writeProjection: write,
    });
    const source = db.prepare("SELECT data FROM mnema_workspaces WHERE id='a'");
    const part = db.prepare("SELECT corrected_text FROM mnema_segments WHERE workspace_id='a'");
    const before = source.get()!.data;
    db.exec(
      "CREATE TEMP TRIGGER fail_projection BEFORE UPDATE ON mnema_segments BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END",
    );
    assert.throws(
      () =>
        mutate((s) => {
          s.studies[0].segments[0].correctedText = 'Not committed';
        }),
      /synthetic failure/,
    );
    assert.equal(source.get()!.data, before);
    assert.equal(part.get()!.corrected_text, null);
    db.exec('DROP TRIGGER fail_projection');
    mutate((s) => {
      s.studies[0].segments[0].correctedText = 'Dual write';
    });
    assert.equal(getState().state.studies[0].segments[0].correctedText, 'Dual write');
    assert.equal(part.get()!.corrected_text, 'Dual write');
    assert.equal(compareWorkspaceProjection(db).ok, true);

    const edit = getState().state;
    edit.studies[0].segments[0].correctedText = 'Old release wrote JSON only';
    edit.findings = [];
    db.prepare("UPDATE mnema_workspaces SET data=?,version=version+1 WHERE id='a'").run(
      JSON.stringify(edit),
    );
    db.exec("DELETE FROM mnema_workspaces WHERE id='b'");
    assert.equal(part.get()!.corrected_text, 'Dual write');
    assert.equal(
      getState().state.studies[0].segments[0].correctedText,
      'Old release wrote JSON only',
    );
    assert.equal(compareWorkspaceProjection(db).ok, false);
    const repaired = initializeWorkspaceProjection(db);
    assert.equal(repaired.rebuilt, 1);
    assert.equal(repaired.report.ok, true);
    assert.equal(repaired.report.projects.length, 1);
    assert.equal(part.get()!.corrected_text, 'Old release wrote JSON only');
    assert.equal(repaired.report.projects[0].counts.mnema_finding_evidence, 0);
  } finally {
    db.close();
  }
});

test('new projects start with both representations in the same transaction', () => {
  const { db, q } = database();
  try {
    const { write } = initializeWorkspaceProjection(db);
    const create = createWorkspaceFactory({
      db,
      q,
      sharing: { init: () => {} },
      copyModels: () => {},
      writeProjection: write,
    });
    const created = create('Test project', { id: 'owner' } as Person, 'private', fixture());
    const report = compareWorkspaceProjection(db);
    assert.equal(report.ok, true);
    assert.equal(report.projects.find((p) => p.id === created)?.counts.mnema_studies, 1);
    db.prepare('DELETE FROM mnema_workspaces WHERE id=?').run(created);
    assert.equal(
      db.prepare('SELECT count(*) AS n FROM mnema_segments WHERE workspace_id=?').get(created)!.n,
      0,
    );
  } finally {
    db.close();
  }
});
