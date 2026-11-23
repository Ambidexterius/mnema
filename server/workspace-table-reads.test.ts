import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { configureDatabase, createCoreTables, openDatabase } from './db.ts';
import { modelKeyStore } from './model-connections.ts';
import {
  compareWorkspaceProjection,
  initializeWorkspaceProjection,
  tableOnlyPlaceholder,
} from './projects/projection.ts';
import {
  createProjectStore,
  createWorkspaceFactory,
  createWorkspaceReader,
} from './projects/store.ts';

test('table reads preserve old shapes, serve real table values and support rollback writes', () => {
  const { db, q } = openDatabase(':memory:');
  try {
    configureDatabase(db);
    createCoreTables(db);
    db.exec('CREATE TABLE mnema_migrations(name TEXT PRIMARY KEY)');
    const original = {
      projectProfile: { category: 'test', extra: null },
      processors: [],
      models: [],
      studies: [
        {
          id: 'b',
          title: 'Second name',
          type: null,
          fileId: 'original-file',
          segments: [
            {
              id: 's2',
              text: 'old text',
              correctedText: null,
              time: 1.05,
              end: null,
              uncertain: false,
            },
            { id: 's1', text: 'first number', time: 0, meta: ['extra'] },
          ],
          summary: [],
          summaryInfo: null,
          findingsInfo: { error: null, state: 'queued' },
        },
        { id: 'a', title: 'First name' },
      ],
      findings: [
        {
          id: 'l',
          studyId: 'b',
          description: 'Text',
          segmentId: 's2',
          evidence: ['s1', 'stale', 's1'],
        },
        { id: 'm', studyId: 'a', segmentId: null, evidence: [], status: null },
      ],
      projectSummary: null,
    };
    q('INSERT INTO mnema_workspaces VALUES(?,?,?,?,?,NULL)').run(
      'main',
      'Team',
      3,
      JSON.stringify(original),
      0,
    );
    const projection = initializeWorkspaceProjection(db);
    const read = createWorkspaceReader(db, q, true);
    const legacy = createWorkspaceReader(db, q, false);
    assert.deepEqual(read('main'), legacy('main'));
    assert.equal(read('absent'), undefined);

    q(
      "UPDATE mnema_segments SET text='From the table' WHERE workspace_id='main' AND id='s2'",
    ).run();
    assert.equal(read('main')?.state.studies[0].segments[0].text, 'From the table');
    assert.equal(legacy('main')?.state.studies[0].segments[0].text, 'old text');
    assert.equal(compareWorkspaceProjection(db).ok, false);
    q("UPDATE mnema_segments SET text='old text' WHERE id='s2'").run();

    const wsStore = new AsyncLocalStorage<string>();
    const current = createProjectStore({
      db,
      q,
      currentWs: () => 'main',
      wsStore,
      modelKeys: modelKeyStore(db, 'fixture-secret'),
      readWorkspace: read,
      writeProjection: projection.write,
    });
    current.mutate((state) => {
      state.studies[0].segments[0].correctedText = 'New version';
    });
    assert.equal(legacy('main')?.state.studies[0].segments[0].correctedText, 'New version');
    assert.equal(compareWorkspaceProjection(db).ok, true);

    // The 7.2 image updates the v1 projection and its hash, but has no knowledge of read metadata.
    const updated = legacy('main')!.state;
    updated.studies[0].segments[0].correctedText = 'Old image wrote';
    const json = JSON.stringify(updated);
    q("UPDATE mnema_workspaces SET data=?,version=version+1 WHERE id='main'").run(json);
    q("UPDATE mnema_segments SET corrected_text='Old image wrote' WHERE id='s2'").run();
    q("UPDATE mnema_projection_source SET data_hash=? WHERE workspace_id='main'").run(
      createHash('sha256').update(json).digest('hex'),
    );
    assert.equal(initializeWorkspaceProjection(db).rebuilt, 1);
    assert.deepEqual(read('main'), legacy('main'));
    assert.equal(compareWorkspaceProjection(db).ok, true);
    assert.equal(initializeWorkspaceProjection(db).rebuilt, 0);
  } finally {
    db.close();
  }
});

test('table-only writes survive restarts and can be restored for an older image', () => {
  const { db, q } = openDatabase(':memory:');
  try {
    configureDatabase(db);
    createCoreTables(db);
    db.exec('CREATE TABLE mnema_migrations(name TEXT PRIMARY KEY)');
    const data = JSON.stringify({
      models: [],
      findings: [],
      studies: [{ id: 'a', segments: [{ id: 's', text: 'original', correctedText: null }] }],
    });
    q('INSERT INTO mnema_workspaces VALUES(?,?,?,?,?,NULL)').run('main', 'Team', 3, data, 0);
    initializeWorkspaceProjection(db);

    q("UPDATE mnema_segments SET text='drift' WHERE id='s'").run();
    assert.throws(() => initializeWorkspaceProjection(db, 'tables'), /drift before switch/);
    const legacy = createWorkspaceReader(db, q, false);
    assert.equal(legacy('main')?.state.studies[0].segments[0].text, 'original');
    q("UPDATE mnema_segments SET text='original' WHERE id='s'").run();

    const projection = initializeWorkspaceProjection(db, 'tables');
    assert.equal(projection.tablesOnly, true);
    const read = createWorkspaceReader(db, q, true);
    const modelKeys = modelKeyStore(db, 'fixture-secret');
    const store = createProjectStore({
      db,
      q,
      tablesOnly: true,
      currentWs: () => 'main',
      wsStore: new AsyncLocalStorage<string>(),
      modelKeys,
      writeProjection: projection.write,
    });
    store.mutate((state) => {
      state.studies[0].segments[0].correctedText = 'new edit';
    });
    const createProject = createWorkspaceFactory({
      db,
      q,
      tablesOnly: true,
      copyModels: () => {},
      sharing: { init: () => {} },
      writeProjection: projection.write,
    });
    const newId = createProject('New project', { id: 'author' } as Parameters<
      typeof createProject
    >[1]);
    const placeholder = q('SELECT data FROM mnema_workspaces WHERE id=?');
    assert.equal(placeholder.get('main').data, tableOnlyPlaceholder);
    assert.equal(placeholder.get(newId).data, tableOnlyPlaceholder);
    assert.equal(initializeWorkspaceProjection(db).tablesOnly, true);
    assert.throws(() => legacy('main'), SyntaxError);

    const before = [read('main'), read(newId)];
    assert.equal(before[0]?.state.studies[0].segments[0].correctedText, 'new edit');
    q("UPDATE mnema_segments SET corrected_text='corrupted' WHERE id='s'").run();
    assert.equal(compareWorkspaceProjection(db).ok, false);
    assert.throws(() => initializeWorkspaceProjection(db, 'dual'), /drift before switch/);
    q("UPDATE mnema_segments SET corrected_text='new edit' WHERE id='s'").run();

    assert.equal(initializeWorkspaceProjection(db, 'dual').tablesOnly, false);
    assert.deepEqual([legacy('main'), legacy(newId)], before);
    assert.equal(compareWorkspaceProjection(db).ok, true);
    const updated = JSON.stringify({
      ...before[0]?.state,
      highlights: [{ id: 'h', text: 'legacy write' }],
    });
    q("UPDATE mnema_workspaces SET data=?,version=version+1 WHERE id='main'").run(updated);
    assert.equal(initializeWorkspaceProjection(db).rebuilt, 1);
    assert.deepEqual(read('main'), legacy('main'));
  } finally {
    db.close();
  }
});

test('older initializers require restored JSON even with no workspaces', () => {
  const { db, q } = openDatabase(':memory:');
  try {
    configureDatabase(db);
    createCoreTables(db);
    db.exec('CREATE TABLE mnema_migrations(name TEXT PRIMARY KEY)');
    initializeWorkspaceProjection(db);
    const oldInitialize = () =>
      q("INSERT OR IGNORE INTO mnema_migrations(name) VALUES('workspace-projection-v1')").run();
    assert.equal(initializeWorkspaceProjection(db, 'tables').report.projects.length, 0);
    assert.throws(oldInitialize, /Restore workspace JSON/);
    assert.equal(initializeWorkspaceProjection(db).tablesOnly, true);
    assert.throws(oldInitialize, /Restore workspace JSON/);
    assert.equal(initializeWorkspaceProjection(db, 'dual').report.projects.length, 0);
    assert.doesNotThrow(oldInitialize);
  } finally {
    db.close();
  }
});

test('restoring after a physical drop is atomic and preserves the old column and row order', () => {
  const { db, q } = openDatabase(':memory:');
  try {
    configureDatabase(db);
    createCoreTables(db);
    db.exec('CREATE TABLE mnema_migrations(name TEXT PRIMARY KEY)');
    const insert = q(
      'INSERT INTO mnema_workspaces(rowid,id,name,version,data,created) VALUES(?,?,?,?,?,?)',
    );
    const empty = JSON.stringify({ studies: [], findings: [], models: [] });
    insert.run(13, 'first', 'First', 7, empty, 1);
    insert.run(26, 'second', 'Second', 9, empty, 2);
    initializeWorkspaceProjection(db);
    initializeWorkspaceProjection(db, 'tables');
    db.exec('ALTER TABLE mnema_workspaces DROP COLUMN data');
    const tables = initializeWorkspaceProjection(db);
    const newer = JSON.stringify({
      studies: [{ id: 'new', title: 'New after drop' }],
      findings: [],
    });
    db.exec('BEGIN IMMEDIATE');
    tables.write('second', newer);
    db.exec('COMMIT');

    db.exec(`CREATE TRIGGER reject_restore BEFORE UPDATE ON mnema_projection_source
      BEGIN SELECT RAISE(ABORT, 'test restore failure'); END`);
    assert.throws(() => initializeWorkspaceProjection(db, 'dual'), /test restore failure/);
    assert.equal(
      q("SELECT name FROM pragma_table_info('mnema_workspaces') WHERE name='data'").get(),
      undefined,
    );
    assert.equal(q('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.equal(compareWorkspaceProjection(db).ok, true);
    db.exec('DROP TRIGGER reject_restore');

    const restored = initializeWorkspaceProjection(db, 'dual');
    assert.equal(restored.report.ok, true);
    assert.deepEqual(
      q("PRAGMA table_info('mnema_workspaces')")
        .all()
        .map((row) => row.name),
      ['id', 'name', 'version', 'data', 'created', 'created_by'],
    );
    assert.deepEqual(
      q('SELECT rowid FROM mnema_workspaces ORDER BY rowid')
        .all()
        .map((row) => row.rowid),
      [13, 26],
    );
    assert.equal(
      JSON.parse(q("SELECT data FROM mnema_workspaces WHERE id='second'").get().data).studies[0]
        .title,
      'New after drop',
    );
    assert.equal(q('PRAGMA integrity_check').get().integrity_check, 'ok');
  } finally {
    db.close();
  }
});
