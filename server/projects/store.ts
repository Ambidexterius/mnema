import type { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { Person } from '../request-context.ts';
import type { openDatabase } from '../db.ts';
import { fail } from '../http.ts';
import { legacyFinding } from '../analysis/review.ts';
import type { modelKeyStore } from '../model-connections.ts';
import type { createProjectSharing } from '../project-sharing.ts';
import { resumePendingSummaries } from '../summaries.ts';
import type { StoredModel, StoredWorkspace } from './types.ts';
import {
  createWorkspaceProjectionReader,
  hasWorkspaceJsonColumn,
  tableOnlyPlaceholder,
  type initializeWorkspaceProjection,
} from './projection.ts';

type Database = Pick<ReturnType<typeof openDatabase>['db'], 'exec'>;
type Prepare = ReturnType<typeof openDatabase>['q'];
type WriteProjection = ReturnType<typeof initializeWorkspaceProjection>['write'];

export interface ProjectSnapshot {
  version: number;
  state: StoredWorkspace;
}

type WorkspaceMetadata = { version: number; name: string };
export type WorkspaceReader = (id: string) => (ProjectSnapshot & { name: string }) | undefined;

export function createWorkspaceReader(
  db: ReturnType<typeof openDatabase>['db'],
  q: Prepare,
  fromTables: boolean,
): WorkspaceReader {
  if (!fromTables) {
    const original = q<WorkspaceMetadata & { data: string }>(
      'SELECT version,name,data FROM mnema_workspaces WHERE id=?',
    );
    return (id) => {
      const row = original.get(id);
      return (
        row && {
          version: row.version,
          name: row.name,
          state: JSON.parse(row.data) as StoredWorkspace,
        }
      );
    };
  }
  const metadata = q<WorkspaceMetadata>('SELECT version,name FROM mnema_workspaces WHERE id=?');
  const readState = createWorkspaceProjectionReader(db);
  return (id) => {
    const isolated = !db.isTransaction;
    if (isolated) db.exec('BEGIN');
    try {
      const row = metadata.get(id);
      if (!row) return;
      const state: unknown = readState(id);
      return { version: row.version, name: row.name, state: state as StoredWorkspace };
    } finally {
      if (isolated) db.exec('ROLLBACK');
    }
  };
}

const emptyState = (): StoredWorkspace => ({
  studies: [],
  findings: [],
  processors: [],
  models: [
    {
      id: 'deepseek',
      name: 'DeepSeek',
      provider: 'Совместимый API',
      url: 'https://api.deepseek.com/v1',
      model: process.env.LLM_MODEL_DEEPSEEK || '',
      keyRef: 'LLM_KEY_DEEPSEEK',
      enabled: true,
      description: 'Укажите модель и настройте серверный ключ',
    },
  ],
  modelId: 'deepseek',
});
const amveraPreset: StoredModel = {
  id: 'amvera-deepseek-v4',
  name: 'DeepSeek V4 · Amvera',
  provider: 'Amvera',
  url: 'https://inference.waw0.amvera.ru/v1',
  model: 'deepseek-V4',
  keyRef: 'LLM_KEY_DEEPSEEK',
  enabled: true,
  description: 'Подписка Amvera, серверный ключ',
  builtin: true,
};
export const initialState = () => {
  const st = emptyState();
  if (process.env.MNEMA_LLM_PRESET === 'amvera-deepseek-v4') {
    st.models = st.models.map((m) => ({ ...m, enabled: false }));
    st.models.push(amveraPreset);
    st.modelId = amveraPreset.id;
  }
  return st;
};

export function migrateLegacyWorkspace(db: Database, q: Prepare) {
  // One-time migration: the single legacy workspace becomes «Команда»; existing access rows become its members.
  db.exec('CREATE TABLE IF NOT EXISTS mnema_migrations(name TEXT PRIMARY KEY)');
  if (
    !q("SELECT 1 FROM mnema_migrations WHERE name='workspaces-v1'").get() &&
    !q('SELECT 1 FROM mnema_workspaces LIMIT 1').get()
  ) {
    const legacy = q<{ version: number; data: string }>(
      'SELECT * FROM mnema_workspace WHERE id=1',
    ).get();
    q('INSERT INTO mnema_workspaces VALUES(?,?,?,?,?,NULL)').run(
      'main',
      'Команда',
      legacy?.version || 0,
      legacy?.data || JSON.stringify(initialState()),
      Date.now(),
    );
  }
  if (!q("SELECT 1 FROM mnema_migrations WHERE name='workspaces-v1'").get())
    q(
      "INSERT OR IGNORE INTO mnema_members(workspace_id,user_id,role,admin,revoked) SELECT 'main',user_id,role,admin,revoked FROM mnema_access WHERE EXISTS(SELECT 1 FROM mnema_workspaces w WHERE w.id='main') AND NOT EXISTS(SELECT 1 FROM mnema_members m WHERE m.user_id=mnema_access.user_id)",
    ).run();
  q("INSERT OR IGNORE INTO mnema_migrations(name) VALUES('workspaces-v1')").run();
}

interface WorkspaceFactoryServices {
  db: ReturnType<typeof openDatabase>['db'];
  q: Prepare;
  sharing: Pick<ReturnType<typeof createProjectSharing>, 'init'>;
  copyModels: (from: string, to: string) => void;
  writeProjection: WriteProjection;
  tablesOnly?: boolean;
}

export function createWorkspaceFactory({
  db,
  q,
  sharing,
  copyModels,
  writeProjection,
  tablesOnly = false,
}: WorkspaceFactoryServices) {
  const hasJson = !tablesOnly || hasWorkspaceJsonColumn(db);
  const insert = q(
    hasJson
      ? 'INSERT INTO mnema_workspaces(id,name,version,data,created,created_by) VALUES(?,?,?,?,?,?)'
      : 'INSERT INTO mnema_workspaces(id,name,version,created,created_by) VALUES(?,?,?,?,?)',
  );
  const createProject = (name: string, person: Person, mode = 'all', state = initialState()) => {
    const id = randomUUID();
    const data = JSON.stringify(state);
    db.exec('BEGIN IMMEDIATE');
    try {
      insert.run(
        id,
        name,
        0,
        ...(hasJson ? [tablesOnly ? tableOnlyPlaceholder : data] : []),
        Date.now(),
        person.id,
      );
      q('INSERT INTO mnema_members(workspace_id,user_id,role,admin) VALUES(?,?,?,1)').run(
        id,
        person.id,
        'full',
      );
      sharing.init(id, person.id, mode);
      writeProjection(id, data);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    const source = q<{ id: string }>(
      'SELECT id FROM mnema_workspaces WHERE id<>? ORDER BY created LIMIT 1',
    ).get(id);
    if (source) copyModels(source.id, id);
    return id;
  };
  return createProject;
}

interface ProjectStoreServices {
  db: ReturnType<typeof openDatabase>['db'];
  q: Prepare;
  currentWs: () => string;
  wsStore: Pick<AsyncLocalStorage<string>, 'run'>;
  modelKeys: ReturnType<typeof modelKeyStore>;
  writeProjection: WriteProjection;
  readWorkspace?: WorkspaceReader;
  tablesOnly?: boolean;
}

export function createProjectStore({
  q,
  db,
  currentWs,
  wsStore,
  modelKeys,
  writeProjection,
  tablesOnly = false,
  readWorkspace = createWorkspaceReader(db, q, tablesOnly),
}: ProjectStoreServices) {
  const getState = () => {
    const row = readWorkspace(currentWs());
    if (!row) fail(404, 'Пространство не найдено.');
    return { version: row.version, state: row.state };
  };
  const mutate = (fn: (state: StoredWorkspace) => void): ProjectSnapshot => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const { state, version } = getState();
      fn(state);
      const workspace = currentWs();
      const data = JSON.stringify(state);
      if (tablesOnly)
        q('UPDATE mnema_workspaces SET version=? WHERE id=?').run(version + 1, workspace);
      else
        q('UPDATE mnema_workspaces SET version=?,data=? WHERE id=?').run(
          version + 1,
          data,
          workspace,
        );
      writeProjection(workspace, data);
      db.exec('COMMIT');
      return { version: version + 1, state };
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };
  // Model connections, the default model and their keys are one team-wide setting: the account owner's change reaches every project.
  const copyModels = (from: string, to: string) => {
    const { state: source } = wsStore.run(from, getState);
    wsStore.run(to, () =>
      mutate((s) => {
        for (const old of s.models)
          if (!source.models.some((m) => m.id === old.id)) modelKeys.remove(to, old.id);
        s.models = source.models;
        s.modelId = source.modelId;
      }),
    );
    for (const m of source.models) {
      const key = modelKeys.get(from, m.id);
      if (key) modelKeys.set(to, m.id, key);
      else modelKeys.remove(to, m.id);
    }
  };
  const syncModels = (from: string) => {
    for (const w of q<{ id: string }>('SELECT id FROM mnema_workspaces WHERE id<>?').all(from))
      copyModels(from, w.id);
  };
  // One-time migration: boolean `verified` becomes a review status. Unverified legacy findings wait for review.
  const workspaceIds = q<{ id: string }>('SELECT id FROM mnema_workspaces');
  for (const w of workspaceIds.all())
    wsStore.run(w.id, () => {
      if (getState().state.findings.some((f) => !f.status))
        mutate((s) => {
          s.findings = s.findings.map(legacyFinding).map(({ verified, priority, ...f }) => f);
        });
    });
  for (const w of workspaceIds.all())
    wsStore.run(w.id, () => {
      if (
        getState().state.studies.some(
          (s) => s.summaryInfo?.state === 'running' || s.findingsInfo?.state === 'running',
        )
      )
        mutate((s) => {
          resumePendingSummaries(s.studies);
          for (const study of s.studies)
            if (study.findingsInfo?.state === 'running')
              study.findingsInfo = {
                ...study.findingsInfo,
                state: 'queued',
                progress: 'В очереди после перезапуска',
              };
        });
    });
  if (process.env.MNEMA_LLM_PRESET === 'amvera-deepseek-v4')
    for (const w of workspaceIds.all())
      wsStore.run(w.id, () => {
        if (!getState().state.models.some((m) => m.id === amveraPreset.id))
          mutate((s) => {
            s.models = s.models.map((m) => ({ ...m, enabled: false }));
            s.models.push(amveraPreset);
            s.modelId = amveraPreset.id;
          });
      });
  return { getState, mutate, copyModels, syncModels };
}
