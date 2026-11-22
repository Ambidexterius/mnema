import { createHash } from 'node:crypto';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { WorkspaceState } from '../../app/types.ts';
import {
  decodeWorkspaceProjection,
  encodeWorkspaceReadMeta,
  workspaceReadMetaTable,
} from './projection-read.ts';

const tables = [
  {
    name: 'mnema_studies',
    key: 1,
    fields: {
      id: 'TEXT NOT NULL',
      seq: 'INTEGER NOT NULL',
      title: 'TEXT',
      kind: 'TEXT',
      status: 'TEXT',
      created_at: 'INTEGER',
      updated_at: 'INTEGER',
      meta: 'TEXT NOT NULL',
    },
  },
  {
    name: 'mnema_segments',
    key: 2,
    fields: {
      study_id: 'TEXT NOT NULL',
      seq: 'INTEGER NOT NULL',
      id: 'TEXT NOT NULL',
      speaker: 'TEXT',
      start_seconds: 'REAL',
      end_seconds: 'REAL',
      text: 'TEXT',
      uncertain: 'INTEGER',
      corrected_text: 'TEXT',
      meta: 'TEXT NOT NULL',
    },
  },
  {
    name: 'mnema_findings',
    key: 1,
    fields: {
      id: 'TEXT NOT NULL',
      seq: 'INTEGER NOT NULL',
      study_id: 'TEXT',
      kind: 'TEXT',
      status: 'TEXT',
      title: 'TEXT',
      text: 'TEXT',
      created_at: 'INTEGER',
      updated_at: 'INTEGER',
      meta: 'TEXT NOT NULL',
    },
  },
  {
    name: 'mnema_finding_evidence',
    key: 2,
    fields: { finding_id: 'TEXT NOT NULL', seq: 'INTEGER NOT NULL', segment_id: 'TEXT NOT NULL' },
  },
  {
    name: 'mnema_summaries',
    key: 2,
    fields: {
      scope: 'TEXT NOT NULL',
      study_id: 'TEXT NOT NULL',
      revision: 'TEXT',
      model: 'TEXT',
      status: 'TEXT',
      body: 'TEXT NOT NULL',
      meta: 'TEXT NOT NULL',
      created_at: 'INTEGER',
    },
  },
  {
    name: 'mnema_analysis_jobs',
    key: 2,
    fields: {
      study_id: 'TEXT NOT NULL',
      kind: 'TEXT NOT NULL',
      status: 'TEXT',
      attempts: 'INTEGER',
      next_at: 'INTEGER',
      error: 'TEXT',
      meta: 'TEXT NOT NULL',
    },
  },
  {
    name: 'mnema_highlights',
    key: 1,
    fields: {
      id: 'TEXT NOT NULL',
      seq: 'INTEGER NOT NULL',
      study_id: 'TEXT',
      segment_id: 'TEXT',
      text: 'TEXT',
      meta: 'TEXT NOT NULL',
    },
  },
] as const;

type ProjectionTable = (typeof tables)[number]['name'];
type Row = SQLInputValue[];
export type ProjectionRows = Record<ProjectionTable, Row[]>;
type Rows = ProjectionRows;
type StoredState = Pick<WorkspaceState, 'studies' | 'findings' | 'highlights'> & {
  projectSummary?: { at?: number; model?: string };
};
type LegacyFindings = WorkspaceState['findings'][number] & { updatedAt?: number };
type Source = { id: string; data: string };
const hash = (data: string) => createHash('sha256').update(data).digest('hex');
const tablesOnlyMigration = 'workspace-tables-only-v1';
// Invalid JSON makes older images fail at startup instead of rebuilding from stale data.
export const tableOnlyPlaceholder = 'workspace stored in tables';
const canonical = (value: unknown) =>
  JSON.stringify(value, (_name, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );

function projectRows(data: string): Rows {
  const state: StoredState = JSON.parse(data);
  const rows: Rows = {
    mnema_studies: [],
    mnema_segments: [],
    mnema_findings: [],
    mnema_finding_evidence: [],
    mnema_summaries: [],
    mnema_analysis_jobs: [],
    mnema_highlights: [],
  };

  for (const [seq, study] of (state.studies ?? []).entries()) {
    const { id, title, type, status, segments, summary, summaryInfo, findingsInfo, ...meta } =
      study;
    const { createdAt, updatedAt } = study as typeof study & {
      createdAt?: number;
      updatedAt?: number;
    };
    rows.mnema_studies.push([
      id,
      seq,
      title ?? null,
      type ?? null,
      status ?? null,
      createdAt ?? null,
      updatedAt ?? null,
      canonical(meta),
    ]);
    for (const [index, part] of (segments ?? []).entries()) {
      const { id: partId, speaker, time, end, text, uncertain, correctedText, ...details } = part;
      rows.mnema_segments.push([
        id,
        index,
        partId,
        speaker ?? null,
        time ?? null,
        end ?? null,
        text ?? null,
        uncertain === undefined ? null : Number(uncertain),
        correctedText ?? null,
        canonical(details),
      ]);
    }
    if (summaryInfo || summary?.length)
      rows.mnema_summaries.push([
        'study',
        id,
        summaryInfo?.revision ?? null,
        summaryInfo?.model ?? summaryInfo?.modelId ?? null,
        summaryInfo?.state ?? null,
        canonical(summary ?? []),
        canonical(summaryInfo ?? null),
        summaryInfo?.startedAt ?? null,
      ]);
    for (const [kind, info] of [
      ['summary', summaryInfo],
      ['findings', findingsInfo],
    ] as const) {
      if (!info) continue;
      const { attempts, nextAt } = info as typeof info & { attempts?: number; nextAt?: number };
      rows.mnema_analysis_jobs.push([
        id,
        kind,
        info.state ?? null,
        attempts ?? null,
        nextAt ?? null,
        info.error ?? null,
        canonical(info),
      ]);
    }
  }
  if (state.projectSummary)
    rows.mnema_summaries.push([
      'project',
      '',
      null,
      state.projectSummary.model ?? null,
      null,
      canonical(state.projectSummary),
      canonical(null),
      state.projectSummary.at ?? null,
    ]);
  for (const [seq, finding] of (state.findings ?? []).entries()) {
    const {
      id,
      studyId,
      kind,
      status,
      title,
      description,
      createdAt,
      updatedAt,
      segmentId,
      evidence,
      ...meta
    } = finding as LegacyFindings;
    rows.mnema_findings.push([
      id,
      seq,
      studyId ?? null,
      kind ?? null,
      status ?? null,
      title ?? null,
      description ?? null,
      createdAt ?? null,
      updatedAt ?? null,
      canonical(meta),
    ]);
    // A reprocessed transcript may leave an older citation without a matching segment.
    for (const [index, segment] of [segmentId, ...(evidence ?? [])].entries())
      if (typeof segment === 'string') rows.mnema_finding_evidence.push([id, index, segment]);
  }
  for (const [seq, highlight] of (state.highlights ?? []).entries()) {
    const { id, studyId, segmentId, text, ...meta } = highlight;
    rows.mnema_highlights.push([
      id,
      seq,
      studyId ?? null,
      segmentId ?? null,
      text ?? null,
      canonical(meta),
    ]);
  }
  return rows;
}

function createProjectionTables(db: DatabaseSync) {
  for (const { name, key, fields } of tables) {
    const columns = Object.entries(fields).map(([field, type]) => field + ' ' + type);
    const primary = Object.keys(fields).slice(0, key);
    db.exec(
      'CREATE TABLE IF NOT EXISTS ' +
        name +
        ' (' +
        'workspace_id TEXT NOT NULL REFERENCES mnema_workspaces(id) ON DELETE CASCADE,' +
        columns.join(',') +
        ',PRIMARY KEY(workspace_id,' +
        primary.join(',') +
        ')) WITHOUT ROWID',
    );
  }
  db.exec(
    'CREATE INDEX IF NOT EXISTS mnema_findings_by_status ON mnema_findings(workspace_id,status);' +
      'CREATE INDEX IF NOT EXISTS mnema_analysis_jobs_by_status ON mnema_analysis_jobs(status,next_at);' +
      'CREATE TABLE IF NOT EXISTS mnema_projection_source (' +
      'workspace_id TEXT PRIMARY KEY REFERENCES mnema_workspaces(id) ON DELETE CASCADE,' +
      'data_hash TEXT NOT NULL) WITHOUT ROWID;' +
      'CREATE TABLE IF NOT EXISTS ' +
      workspaceReadMetaTable +
      ' (' +
      'workspace_id TEXT PRIMARY KEY REFERENCES mnema_workspaces(id) ON DELETE CASCADE,' +
      'data_hash TEXT NOT NULL, meta TEXT NOT NULL) WITHOUT ROWID',
  );
}

function readTables(db: DatabaseSync) {
  return tables.map(({ name, fields, key }) => {
    const columns = Object.keys(fields);
    const primary = columns.slice(0, key);
    const select = db.prepare(
      'SELECT ' + columns.join(',') + ' FROM ' + name + ' WHERE workspace_id=?',
    );
    const rowKey = (row: Row) => JSON.stringify(row.slice(0, key));
    function read(workspace: string) {
      const rows = select.all(workspace).map((item) => columns.map((field) => item[field]) as Row);
      return new Map(rows.map((row) => [rowKey(row), row]));
    }
    return { name, key, columns, primary, rowKey, read };
  });
}

function rowsMatch(left: ReadonlyMap<string, Row>, right: ReadonlyMap<string, Row>) {
  return (
    left.size === right.size &&
    [...left].every(([key, row]) => JSON.stringify(row) === JSON.stringify(right.get(key)))
  );
}

export function workspaceTablesOnly(db: DatabaseSync) {
  return Boolean(
    db.prepare('SELECT 1 FROM mnema_migrations WHERE name=?').get(tablesOnlyMigration),
  );
}

/** A read-only check of all populated columns and ordered child rows. It emits counts and IDs only. */
export function compareWorkspaceProjection(db: DatabaseSync) {
  const tablesOnly = workspaceTablesOnly(db);
  const reads = readTables(db);
  const readMeta = db.prepare(
    'SELECT meta,data_hash FROM ' + workspaceReadMetaTable + ' WHERE workspace_id=?',
  );
  const sourceHash = db.prepare(
    'SELECT data_hash FROM mnema_projection_source WHERE workspace_id=?',
  );
  const sources = db
    .prepare(
      tablesOnly
        ? 'SELECT id FROM mnema_workspaces ORDER BY id'
        : 'SELECT id,data FROM mnema_workspaces ORDER BY id',
    )
    .iterate() as Iterable<Source>;
  const projects: {
    id: string;
    counts: Record<string, number>;
    differences: (ProjectionTable | typeof workspaceReadMetaTable)[];
  }[] = [];
  for (const source of sources) {
    const differences: (ProjectionTable | typeof workspaceReadMetaTable)[] = [];
    const actual = {} as Rows;
    const counts: Record<string, number> = {};
    const storedRows = reads.map((table) => {
      const rows = table.read(source.id);
      counts[table.name] = rows.size;
      actual[table.name] = [...rows.values()];
      return rows;
    });
    const supplemental = readMeta.get(source.id);
    const decoded =
      supplemental && canonical(decodeWorkspaceProjection(String(supplemental.meta), actual));
    const data = tablesOnly ? decoded : source.data;
    const expected = data && projectRows(data);
    for (const [index, table] of reads.entries()) {
      const stored = storedRows[index];
      const rows = expected ? expected[table.name] : [];
      if (
        !rowsMatch(new Map(rows.map((row) => [table.rowKey(row), row])), stored) ||
        rows.length !== stored.size
      )
        differences.push(table.name);
    }
    if (
      !supplemental ||
      !data ||
      (tablesOnly
        ? supplemental.data_hash !== hash(data) ||
          sourceHash.get(source.id)?.data_hash !== supplemental.data_hash
        : !differences.length && decoded !== canonical(JSON.parse(data)))
    )
      differences.push(workspaceReadMetaTable);
    projects.push({ id: source.id, counts, differences });
  }
  // A write from an older connection with foreign keys off must also be detectable.
  const orphans = [
    ...tables.map(({ name }) => name),
    workspaceReadMetaTable,
    'mnema_projection_source',
  ].flatMap((name) =>
    db
      .prepare(
        'SELECT 1 FROM ' +
          name +
          ' t LEFT JOIN mnema_workspaces w ON w.id=t.workspace_id WHERE w.id IS NULL LIMIT 1',
      )
      .get()
      ? [name]
      : [],
  );
  return {
    ok: !orphans.length && projects.every((project) => !project.differences.length),
    projects,
    orphans,
  };
}

/** Install and fill once, then reconcile workspaces modified while an older release was active. */
export function initializeWorkspaceProjection(db: DatabaseSync, target?: 'dual' | 'tables') {
  const started = performance.now();
  db.exec('BEGIN IMMEDIATE');
  try {
    createProjectionTables(db);
    const wasTablesOnly = workspaceTablesOnly(db);
    const tablesOnly = target === undefined ? wasTablesOnly : target === 'tables';
    const writers = readTables(db).map((table) => ({
      ...table,
      remove: db.prepare(
        'DELETE FROM ' +
          table.name +
          ' WHERE workspace_id=? AND ' +
          table.primary.map((field) => field + '=?').join(' AND '),
      ),
      upsert: db.prepare(
        'INSERT INTO ' +
          table.name +
          '(workspace_id,' +
          table.columns.join(',') +
          ') VALUES (' +
          Array(table.columns.length + 1)
            .fill('?')
            .join(',') +
          ')' +
          ' ON CONFLICT(workspace_id,' +
          table.primary.join(',') +
          ') DO UPDATE SET ' +
          table.columns
            .slice(table.key)
            .map((field) => field + '=excluded.' + field)
            .join(','),
      ),
    }));
    const sourceHash = db.prepare(
      'SELECT data_hash FROM mnema_projection_source WHERE workspace_id=?',
    );
    const recordHash = db.prepare(
      'INSERT INTO mnema_projection_source(workspace_id,data_hash) VALUES(?,?) ' +
        'ON CONFLICT(workspace_id) DO UPDATE SET data_hash=excluded.data_hash',
    );
    const readShapeHash = db.prepare(
      'SELECT data_hash FROM ' + workspaceReadMetaTable + ' WHERE workspace_id=?',
    );
    const saveReadMeta = db.prepare(
      'INSERT INTO ' +
        workspaceReadMetaTable +
        '(workspace_id,data_hash,meta) VALUES(?,?,?) ' +
        'ON CONFLICT(workspace_id) DO UPDATE SET data_hash=excluded.data_hash,meta=excluded.meta',
    );
    // The checksum covers the logical state when there is no JSON snapshot.
    function write(workspace: string, data: string) {
      if (!db.isTransaction) throw new Error('Workspace projection requires a transaction');
      const state = JSON.parse(data);
      const checksum = hash(tablesOnly ? canonical(state) : data);
      const expected = projectRows(data);
      for (const table of writers) {
        const existing = table.read(workspace);
        for (const row of expected[table.name]) {
          const key = table.rowKey(row);
          if (JSON.stringify(row) !== JSON.stringify(existing.get(key)))
            table.upsert.run(workspace, ...row);
          existing.delete(key);
        }
        for (const row of existing.values())
          table.remove.run(workspace, ...row.slice(0, table.key));
      }
      recordHash.run(workspace, checksum);
      saveReadMeta.run(workspace, checksum, encodeWorkspaceReadMeta(state, expected));
    }

    let rebuilt = 0;
    if (wasTablesOnly !== tablesOnly) {
      if (!compareWorkspaceProjection(db).ok)
        throw new Error('Workspace projection drift before switch');
      const read = createWorkspaceProjectionReader(db);
      const saveJson = db.prepare('UPDATE mnema_workspaces SET data=? WHERE id=?');
      for (const { id } of db.prepare('SELECT id FROM mnema_workspaces ORDER BY id').all() as {
        id: string;
      }[]) {
        const data = canonical(read(id));
        write(id, data);
        saveJson.run(tablesOnly ? tableOnlyPlaceholder : data, id);
      }
      if (tablesOnly)
        db.prepare('INSERT INTO mnema_migrations(name) VALUES(?)').run(tablesOnlyMigration);
      else db.prepare('DELETE FROM mnema_migrations WHERE name=?').run(tablesOnlyMigration);
    } else if (!tablesOnly) {
      const sources = db
        .prepare('SELECT id,data FROM mnema_workspaces ORDER BY id')
        .iterate() as Iterable<Source>;
      for (const source of sources) {
        const checksum = hash(source.data);
        if (
          sourceHash.get(source.id)?.data_hash !== checksum ||
          readShapeHash.get(source.id)?.data_hash !== checksum
        ) {
          write(source.id, source.data);
          rebuilt++;
        }
      }
    }
    const report = compareWorkspaceProjection(db);
    if (!report.ok)
      throw new Error(
        tablesOnly
          ? 'Workspace table integrity check failed'
          : 'Workspace projection differs from JSON',
      );
    if (tablesOnly) {
      // The old initializer also writes this marker when there are no projects to read.
      db.exec(`CREATE TRIGGER IF NOT EXISTS mnema_projection_requires_json
        BEFORE INSERT ON mnema_migrations WHEN NEW.name='workspace-projection-v1'
        BEGIN SELECT RAISE(ABORT, 'Restore workspace JSON before starting the older version'); END`);
    } else {
      db.exec('DROP TRIGGER IF EXISTS mnema_projection_requires_json');
      db.prepare('INSERT OR IGNORE INTO mnema_migrations(name) VALUES(?)').run(
        'workspace-projection-v1',
      );
    }
    db.exec('COMMIT');
    return {
      write,
      report,
      rebuilt,
      tablesOnly,
      elapsedMs: Math.round(performance.now() - started),
    };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function projectionTotals(report: ReturnType<typeof compareWorkspaceProjection>) {
  const counts: Record<string, number> = {};
  for (const table of tables) counts[table.name] = 0;
  for (const project of report.projects)
    for (const [table, count] of Object.entries(project.counts)) counts[table] += count;
  return { projects: report.projects.length, counts };
}

export function createWorkspaceProjectionReader(db: DatabaseSync) {
  const tables = readTables(db);
  const meta = db.prepare('SELECT meta FROM ' + workspaceReadMetaTable + ' WHERE workspace_id=?');
  return (id: string) => {
    const row = meta.get(id);
    if (!row) throw new Error('Missing workspace table read metadata');
    const data = Object.fromEntries(
      tables.map((table) => [table.name, [...table.read(id).values()]]),
    ) as Rows;
    return decodeWorkspaceProjection(String(row.meta), data);
  };
}
