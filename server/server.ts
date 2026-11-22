import { createMembership } from './auth/membership.ts';
import { createSession } from './auth/session.ts';
import { createProjectCards } from './projects/cards.ts';
import { createProjectView } from './projects/view.ts';
import { createAccountRegistration } from './auth/account-registration.ts';
import { createModelCaller } from './admin/model-provider.ts';
import { createFileProcessor } from './processing/processor.ts';
import { createProcessingQueue, jobKey } from './processing/queue.ts';
import { handleProcessing, isProcessingPath } from './processing/routes.ts';
import { createAnalysisWorker } from './analysis/worker.ts';
import { handleImports } from './materials/import-route.ts';
import { handleFiles, handleStorage } from './materials/file-route.ts';
import { handleStudy, handleHighlights } from './materials/study-route.ts';
import { createUploads } from './materials/uploads.ts';
import { handleMaterialSummary, handleFindings, handleProjectSummary } from './analysis/routes.ts';
import { handleGlobalChat, handleProjectChat, isGlobalChatPath } from './chat/routes.ts';
import { handleWorkspace } from './projects/workspace-route.ts';
import { handleProjectState } from './projects/state-route.ts';
import { handleDirectory, handleMembers } from './projects/membership-route.ts';
import { backendBuildId } from './build-id.ts';
import { handleAuth, handleProfile, isAuthPath } from './auth/routes.ts';
import { handleMcpManagement, handlePublicMcp, matchPublicMcpRoute } from './mcp/routes.ts';
import { handleModeration, isModerationPath } from './admin/moderation-route.ts';
import { handleModels } from './admin/models-route.ts';
import type { Person } from './request-context.ts';
import { fail, json, readJsonBody, text } from './http.ts';
import { createProductNews } from './product-news.ts';
import { createRegistration } from './registration.ts';
import { createProjectSharing } from './project-sharing.ts';
import { createChatHistory } from './chat-history.ts';
import { createAnswerFeedback } from './answer-feedback.ts';
import { loadExtension, type ServerExtension } from './extension.ts';
import { mcpPlugins, createMcpService } from './mcp.ts';
import { keySlot, modelBase, cleanModel, modelKeyStore } from './model-connections.ts';
import { createS3Mirror, s3Config } from './s3-storage.ts';
import { collectGlobalResearch } from './global-research.ts';
import {
  createCompletionMailer,
  sendSmtp,
  smtpConfigured,
  type CompletionMail,
} from './completion-mail.ts';
import { createIdeas } from './ideas.ts';
import type { FeedbackLocation } from '../app/feedback-context.ts';
import { sendInvitationEmail } from './invitation-mail.ts';
import { sendBody, encode, pickEncoding, compressible, MIN_COMPRESS_BYTES } from './compression.ts';
import { resumePendingSummaries } from './summaries.ts';
import http from 'node:http';
import { configureDatabase, createCoreTables, openDatabase } from './db.ts';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdir, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import {
  type transcribeRecording,
  processingReadiness,
  type detectSpeakers,
} from './processing.ts';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { betterAuth } from 'better-auth';
import { toNodeHandler } from 'better-auth/node';
import { getMigrations } from 'better-auth/db/migration';
import type { Finding } from '../app/types.ts';

export interface MnemaServerOptions {
  extension?: Awaited<ReturnType<typeof loadExtension>>;
  registrationCode?: () => string;
  corporateRegistration?: boolean;
  sendRegistrationMail?: (message: CompletionMail) => Promise<void>;
  sendInvitationMail?: (message: CompletionMail) => Promise<void>;
  sendCompletionMail?: (message: CompletionMail) => Promise<void>;
  recordingProcessor?: typeof transcribeRecording;
  speakerProcessor?: typeof detectSpeakers;
  production?: boolean;
  dataDir?: string;
  publicDir?: string;
  baseURL?: string;
  authSecret?: string;
  authCookiePrefix?: string;
  setupToken?: string;
  providerFetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}
// Built-in connections can be switched off but not deleted; models a user added can be deleted.
const builtinModels = new Set(['deepseek', 'amvera-deepseek-v4', 'local-stub']);
const isBuiltin = (m: any) => builtinModels.has(m.id) || Boolean(m.builtin);
process.umask(0o077);
const packageInfo = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const VERSION: string = packageInfo.version;
// Identify the loaded backend even when several fixes share one product version.
const bundledExtension = await loadExtension(process.env.MNEMA_APP_EXTENSION === '1');
export const BUILD_ID = backendBuildId(
  new URL('.', import.meta.url),
  VERSION,
  packageInfo.dependencies,
  Boolean(bundledExtension),
);
const hash = (v) => createHash('sha256').update(v).digest('hex');
const roles = new Set(['view', 'full']);
// Stage 1 of the UX brief: findings are reviewed by a person; readers only ever receive verified ones.
const findingStatuses = new Set(['draft', 'verified', 'rejected']);
const importanceLevels = ['Критично', 'Высокая', 'Средняя', 'Низкая'];
const findingKinds = ['Проблема', 'Инсайт', 'Рекомендация', 'Цифра'];
const legacyKinds = {
  Наблюдение: 'Инсайт',
  Гипотеза: 'Инсайт',
  'Открытый вопрос': 'Инсайт',
  Решение: 'Рекомендация',
};
const reportOf = (study) =>
  study?.report === 'ready' || study?.report === 'none'
    ? study.report
    : study?.type === 'Отчёт'
      ? 'ready'
      : 'none';
const legacyFinding = (f) =>
  f.status
    ? f
    : {
        ...f,
        status: f.verified ? 'verified' : 'draft',
        importance: importanceLevels.includes(f.importance)
          ? f.importance
          : importanceLevels.includes(f.priority)
            ? f.priority
            : 'Средняя',
        kind: findingKinds.includes(f.kind) ? f.kind : legacyKinds[f.kind] || 'Инсайт',
        origin: f.origin || 'human',
        significant: Boolean(f.significant),
        history: Array.isArray(f.history) ? f.history : [],
      };
const historyAction = (prev, next) =>
  !prev
    ? next.origin === 'ai'
      ? 'suggested'
      : 'created'
    : prev.status !== next.status
      ? {
          verified: prev.status === 'draft' ? 'accepted' : 'restored',
          rejected: 'rejected',
          draft: 'reopened',
        }[next.status]
      : prev.title !== next.title ||
          prev.description !== next.description ||
          prev.kind !== next.kind ||
          prev.importance !== next.importance ||
          prev.significant !== next.significant
        ? 'edited'
        : null;
// Further evidence fragments of a finding: up to 8 distinct segment ids besides the main one.
const evidenceOf = (f: any, base: any): string[] =>
  [
    ...new Set<string>(
      (Array.isArray(f.evidence) ? f.evidence : base?.evidence || []).filter(
        (id: unknown): id is string =>
          typeof id === 'string' && id.length <= 120 && id !== f.segmentId,
      ),
    ),
  ].slice(0, 8);
// The model's reason explains its importance; once a person changes the importance the old reason no longer applies.
const reasonOf = (f: any, base: any): string =>
  typeof f.reason === 'string'
    ? f.reason.trim().slice(0, 240)
    : base?.reason && (!f.importance || f.importance === base.importance)
      ? base.reason
      : '';
function reviewFinding(f: any, prev: any, person: { name: string }, now: number): Finding {
  const base = prev ? legacyFinding(prev) : null;
  const next: Finding = {
    id: text(f.id, 80) || randomUUID(),
    studyId: f.studyId,
    segmentId: f.segmentId,
    title: text(f.title, 160),
    description: String(f.description || '')
      .trim()
      .slice(0, base?.importSource ? 28000 : 4000),
    kind: findingKinds.includes(f.kind) ? f.kind : legacyKinds[f.kind] || base?.kind || 'Инсайт',
    importance: importanceLevels.includes(f.importance)
      ? f.importance
      : importanceLevels.includes(f.priority)
        ? f.priority
        : base?.importance || 'Средняя',
    significant: Boolean(f.significant),
    origin: base?.origin || 'human',
    ...(evidenceOf(f, base).length ? { evidence: evidenceOf(f, base) } : {}),
    ...(reasonOf(f, base) ? { reason: reasonOf(f, base) } : {}),
    // A person who creates a finding has reviewed it; AI drafts are only created by the server.
    status: base ? (findingStatuses.has(f.status) ? f.status : base.status) : 'verified',
    ...(base?.importSource ? { importSource: base.importSource } : {}),
    createdAt: base?.createdAt || now,
    createdBy: base?.createdBy || person.name,
    history: [...(base?.history || [])].slice(-49),
  };
  const action = historyAction(base, next);
  if (action) next.history.push({ action, status: next.status, by: person.name, at: now });
  return next;
}
const slotPattern = keySlot;
const mimes = {
  '.mp3': 'audio/mpeg',
  '.svg': 'image/svg+xml',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ttf': 'font/ttf',
};
const emptyState = () => ({
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
export { answerTemplate } from './chat/prompt.ts';

export async function createMnemaServer(options: MnemaServerOptions = {}) {
  const production = options.production ?? process.env.NODE_ENV === 'production';
  const dir = resolve(options.dataDir || process.env.MNEMA_DATA_DIR || '/data');
  const publicDir = resolve(
    options.publicDir ||
      process.env.MNEMA_PUBLIC_DIR ||
      join(dirname(fileURLToPath(import.meta.url)), '../dist'),
  );
  const baseURL = options.baseURL || process.env.APP_URL || 'http://127.0.0.1:4180';
  const origin = new URL(baseURL).origin;
  if (
    options.registrationCode &&
    (production || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseURL).hostname))
  )
    throw new Error('Fixed registration codes are allowed only in a local non-production stand');
  const authSecret = options.authSecret || process.env.BETTER_AUTH_SECRET;
  if (!authSecret || authSecret.length < 32)
    throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters');
  const setupToken = options.setupToken || process.env.MNEMA_SETUP_TOKEN || '';
  const quota = Number(process.env.MNEMA_STORAGE_LIMIT_BYTES || 4 * 1024 ** 3);
  await mkdir(join(dir, 'uploads'), { recursive: true, mode: 0o700 });
  const { db, q } = openDatabase(join(dir, 'mnema.sqlite'));
  const factory = options.extension ?? bundledExtension;
  const extensionMarker = 'app-extension-v1';
  if (
    !factory &&
    q("SELECT 1 FROM sqlite_master WHERE type='table' AND name='mnema_migrations'").get() &&
    q('SELECT 1 FROM mnema_migrations WHERE name=?').get(extensionMarker)
  ) {
    db.close();
    throw new Error('The database requires the application extension');
  }
  let extension: ServerExtension | undefined;
  configureDatabase(db);
  const auth = betterAuth({
    database: db,
    secret: authSecret,
    baseURL,
    basePath: '/api/auth',
    trustedOrigins: [origin],
    disabledPaths: ['/token'],
    plugins: mcpPlugins(baseURL, db),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      requireEmailVerification: false,
    },
    session: { expiresIn: 7 * 86400, updateAge: 86400, cookieCache: { enabled: false } },
    advanced: {
      useSecureCookies: production,
      ...(options.authCookiePrefix ? { cookiePrefix: options.authCookiePrefix } : {}),
    },
    rateLimit: { enabled: true, window: 60, max: 20 },
  });
  await (await getMigrations(auth.options)).runMigrations();
  createCoreTables(db);
  const readableStudies = (person, workspaceId) => {
    const project = person.workspaces.find((w) => w.id === workspaceId);
    return project
      ? wsStore.run(
          workspaceId,
          () =>
            view({ ...person, workspaceId, role: project.role, admin: Boolean(project.admin) })
              .state.studies,
        )
      : [];
  };
  const chats = createChatHistory(db, readableStudies);
  const feedback = createAnswerFeedback(db, authSecret, BUILD_ID, readableStudies);
  const news = createProductNews(db, factory?.news);
  const ideas = createIdeas(db, {
    baseURL,
    send: options.sendCompletionMail || (smtpConfigured() ? sendSmtp : undefined),
  });
  const ratedReply = (
    person: Person,
    question: string,
    scope: 'global' | 'project',
    reply: any,
    modelId?: string,
  ) => {
    person = scopedPerson(person);
    const references = reply.sources.map((source) => ({
      workspaceId: source.workspaceId || person.workspaceId,
      studyId: source.studyId,
      segmentId: source.segmentId || source.id,
      text: source.text,
    }));
    const projectIds =
      scope === 'project'
        ? [person.workspaceId]
        : references.length
          ? references.map((ref) => ref.workspaceId)
          : person.workspaces.map((project) => project.id);
    const feedbackToken = feedback.issue(person, {
      scope,
      question,
      answer: reply.answer,
      model: reply.model,
      modelId,
      projectIds: [...new Set<string>(projectIds)],
      references,
      kind: references.length ? 'generated' : 'no-evidence',
    });
    return { ...reply, feedbackToken };
  };
  const modelKeys = modelKeyStore(db, authSecret);
  const columns = (table: string) =>
    q('PRAGMA table_info(' + table + ')')
      .all()
      .map((c: any) => c.name);
  if (!columns('mnema_access').includes('self_registered'))
    db.exec('ALTER TABLE mnema_access ADD COLUMN self_registered INTEGER NOT NULL DEFAULT 0');
  if (!columns('mnema_access').includes('welcome_pending'))
    db.exec('ALTER TABLE mnema_access ADD COLUMN welcome_pending INTEGER NOT NULL DEFAULT 0');
  const signup = createRegistration(
    db,
    authSecret,
    production,
    options.sendRegistrationMail || (smtpConfigured() ? sendSmtp : undefined),
    options.registrationCode,
  );
  if (!columns('mnema_access').includes('all_projects'))
    db.exec('ALTER TABLE mnema_access ADD COLUMN all_projects INTEGER NOT NULL DEFAULT 0');
  if (!columns('mnema_invites').includes('workspace_id'))
    db.exec("ALTER TABLE mnema_invites ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'main'");
  if (!columns('mnema_jobs').includes('workspace_id'))
    db.exec("ALTER TABLE mnema_jobs ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'main'");
  const amveraPreset = {
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
  const initialState = () => {
    const st: any = emptyState();
    if (process.env.MNEMA_LLM_PRESET === 'amvera-deepseek-v4') {
      st.models = st.models.map((m) => ({ ...m, enabled: false }));
      st.models.push(amveraPreset as any);
      st.modelId = amveraPreset.id;
    }
    return st;
  };
  // One-time migration: the single legacy workspace becomes «Команда»; existing access rows become its members.
  db.exec('CREATE TABLE IF NOT EXISTS mnema_migrations(name TEXT PRIMARY KEY)');
  if (
    !q("SELECT 1 FROM mnema_migrations WHERE name='workspaces-v1'").get() &&
    !q('SELECT 1 FROM mnema_workspaces LIMIT 1').get()
  ) {
    const legacy = q('SELECT * FROM mnema_workspace WHERE id=1').get();
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
  const sharing = createProjectSharing(db, baseURL, authSecret);
  const createProject = (name: string, person: Person, mode = 'all', state = initialState()) => {
    const id = randomUUID();
    db.exec('BEGIN IMMEDIATE');
    try {
      q('INSERT INTO mnema_workspaces VALUES(?,?,?,?,?,?)').run(
        id,
        name,
        0,
        JSON.stringify(state),
        Date.now(),
        person.id,
      );
      q('INSERT INTO mnema_members(workspace_id,user_id,role,admin) VALUES(?,?,?,1)').run(
        id,
        person.id,
        'full',
      );
      sharing.init(id, person.id, mode);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    const source = q('SELECT id FROM mnema_workspaces WHERE id<>? ORDER BY created LIMIT 1').get(
      id,
    );
    if (source) copyModels(source.id, id);
    return id;
  };
  const completionMail = createCompletionMailer({
    db,
    baseURL,
    send: options.sendCompletionMail,
    getAccess: (userId, workspaceId) => sharing.projects(userId).find((p) => p.id === workspaceId),
  });
  const wsStore = new AsyncLocalStorage<string>();
  const currentWs = () => wsStore.getStore() || 'main';
  const interruptedJobs = q("SELECT count(*) AS count FROM mnema_jobs WHERE status='running'").get()
    .count;
  q("UPDATE mnema_jobs SET status='queued' WHERE status='running'").run();
  if (interruptedJobs)
    console.info('Processing recovery', JSON.stringify({ requeued: interruptedJobs }));
  const getState = () => {
    const row = q('SELECT * FROM mnema_workspaces WHERE id=?').get(currentWs());
    if (!row) fail(404, 'Пространство не найдено.');
    return { version: row.version, state: JSON.parse(row.data) };
  };
  const mutate = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const { state, version } = getState();
      fn(state);
      const next = state;
      q('UPDATE mnema_workspaces SET version=?,data=? WHERE id=?').run(
        version + 1,
        JSON.stringify(next),
        currentWs(),
      );
      db.exec('COMMIT');
      return { version: version + 1, state: next };
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
    for (const w of q('SELECT id FROM mnema_workspaces WHERE id<>?').all(from))
      copyModels(from, w.id);
  };
  // One-time migration: boolean `verified` becomes a review status. Unverified legacy findings wait for review.
  for (const w of q('SELECT id FROM mnema_workspaces').all())
    wsStore.run(w.id, () => {
      if (getState().state.findings.some((f) => !f.status))
        mutate((s) => {
          s.findings = s.findings.map(legacyFinding).map(({ verified, priority, ...f }) => f);
        });
    });
  for (const w of q('SELECT id FROM mnema_workspaces').all())
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
    for (const w of q('SELECT id FROM mnema_workspaces').all())
      wsStore.run(w.id, () => {
        if (!getState().state.models.some((m) => m.id === amveraPreset.id))
          mutate((s) => {
            s.models = s.models.map((m) => ({ ...m, enabled: false }));
            s.models.push(amveraPreset);
            s.modelId = amveraPreset.id;
          });
      });
  const storageMirror = createS3Mirror(db, dir, s3Config());
  const processors = () => {
    const r = processingReadiness();
    return [
      {
        id: 'whisper',
        name: r.model,
        description: r.diarization
          ? 'Локальная речь, таймкоды и разделение спикеров'
          : 'Локальная речь и таймкоды, без разделения спикеров',
        mode: 'Локально',
        enabled: true,
        configured: r.asr,
      },
      {
        id: 'speakers',
        name: 'Разделение спикеров',
        description: 'pyannote segmentation 3.0 и WeSpeaker, локально на CPU',
        mode: 'Локально',
        enabled: true,
        configured: Boolean(options.speakerProcessor) || r.diarization,
      },
      {
        id: 'tesseract',
        name: 'Tesseract + Poppler',
        description: 'PDF и сканы, русский и английский, номера страниц',
        mode: 'Локально',
        enabled: true,
        configured: r.ocr,
      },
    ];
  };
  const { ownerExists, users, grantAllProjects, userDirectory } = createMembership({
    db,
    q,
    currentWs,
  });
  const projectCard = createProjectCards(q);
  const session = createSession({ auth, q, sharing, projectCard, news });
  const view = createProjectView({
    q,
    getState,
    currentWs,
    getExtension: () => extension,
    isBuiltin,
    modelKeys,
    sharing,
    users,
    userDirectory,
    processors,
    legacyFinding,
    reportOf,
  });
  const modelKey = (model: any, workspace = currentWs()) =>
    modelKeys.get(workspace, model.id) ||
    (slotPattern.test(model.keyRef || '') ? process.env[model.keyRef] : null);
  const scopedPerson = (person: Person): Person =>
    person.sharedProject && !person.workspaces.some((w) => w.id === person.sharedProject.id)
      ? { ...person, workspaces: [...person.workspaces, person.sharedProject] }
      : person;
  const ideaLocationAccess = (person: Person) => {
    const viewer = scopedPerson(person);
    const projects = new Map<string, { studies: Set<string>; findings: Set<string> }>();
    return ({ path }: FeedbackLocation) => {
      const [, section, id, tab, resourceId] = path.split('/');
      if (section === 'conversation') {
        try {
          chats.get(viewer, id);
          return true;
        } catch (error) {
          if (error.status === 404 || error.status === 409) return false;
          throw error;
        }
      }
      if (!id) return true;
      const project = viewer.workspaces.find((workspace) => workspace.id === id);
      if (!project) return false;
      if (!resourceId) return true;
      let visible = projects.get(id);
      if (!visible) {
        const { state } = wsStore.run(id, () =>
          view({ ...viewer, workspaceId: id, role: project.role, admin: project.admin }),
        );
        visible = {
          studies: new Set(state.studies.map((study) => study.id)),
          findings: new Set(state.findings.map((finding) => finding.id)),
        };
        projects.set(id, visible);
      }
      return (tab === 'studies' ? visible.studies : visible.findings).has(resourceId);
    };
  };
  const globalResearch = (person: Person) =>
    collectGlobalResearch(person, (project) =>
      wsStore.run(
        project.id,
        () =>
          view({ ...person, workspaceId: project.id, role: project.role, admin: project.admin })
            .state,
      ),
    );
  const mcpService = createMcpService({
    db,
    auth,
    baseURL,
    version: VERSION,
    getPerson: (id) => {
      const user = q(
        'SELECT u.id,u.name,u.email FROM user u JOIN mnema_access a ON a.user_id=u.id WHERE u.id=? AND a.revoked=0',
      ).get(id);
      if (!user) return null;
      const workspaces = sharing.projects(id).map((w) => ({ ...w, admin: false }));
      return {
        ...user,
        workspaces,
        workspaceId: workspaces[0]?.id || null,
        role: workspaces[0]?.role || 'view',
        admin: false,
        owner: false,
      };
    },
    readProject: (person, project) => wsStore.run(project.id, () => view(person).state),
  });
  const mcpNodeHandler = toNodeHandler(mcpService.fetch);

  const staticCache = new Map<string, Buffer>();
  const writingUsers = new WeakMap<object, Person>();
  const recheckWrite = async (req) => {
    const before = writingUsers.get(req);
    if (!before) return;
    const now = await session(req);
    if (!now) fail(401, 'Войдите в Мнемодак.');
    if (
      before.workspaceId !== now.workspaceId ||
      (before.role === 'full' && now.role !== 'full') ||
      (before.admin && !now.admin) ||
      (before.owner && !now.owner) ||
      (before.manageUsers && !now.manageUsers)
    )
      fail(403, 'Доступ изменился. Обновите страницу и повторите действие.');
  };
  const body = async (req, max?: number) => {
    const value = await readJsonBody(req, max);
    await recheckWrite(req);
    return value;
  };
  const limits = new Map();
  const limit = (key, max = 30) => {
    const now = Date.now();
    const l = limits.get(key);
    if (!l || now - l.time > 60000) {
      limits.set(key, { time: now, n: 1 });
      return;
    }
    if (++l.n > max) fail(429, 'Слишком много запросов. Подождите минуту.');
    if (limits.size > 10000)
      for (const [k, v] of limits) if (now - v.time > 60000) limits.delete(k);
  };
  const { hmacRemovedEmail, register, withRegistration } = createAccountRegistration({
    options,
    authSecret,
    setupToken,
    hash,
    signup,
    auth,
    body,
    limit,
    ownerExists,
    q,
    db,
    sharing,
    grantAllProjects,
  });
  const callModel = createModelCaller({
    q,
    sharing,
    currentWs,
    modelKey,
    wsStore,
    getState,
    options,
  });
  const { processStudy, transcriptPreviews } = createFileProcessor({
    q,
    dir,
    currentWs,
    mutate,
    jobKey,
    extension: () => extension,
    recordingProcessor: options.recordingProcessor,
    speakerProcessor: options.speakerProcessor,
  });
  const deletingStudies = new Set<string>();
  const runAnalysis = createAnalysisWorker({
    q,
    wsStore,
    getState,
    mutate,
    currentWs,
    callModel,
    sharing,
    deletingStudies,
    jobKey,
    hash,
  });
  const { stopWorker, activeCPU, activeStudyJob, enqueue, queueStudy } = createProcessingQueue({
    q,
    dir,
    currentWs,
    getState,
    mutate,
    wsStore,
    deletingStudies,
    runAnalysis,
    processStudy,
    completionMail,
  });
  const { uploadBusy, handleUpload } = createUploads({
    q,
    db,
    dir,
    quota,
    currentWs,
    getState,
    mutate,
    recordingProcessor: options.recordingProcessor,
    deletingStudies,
    jobKey,
    activeStudyJob,
    queueStudy,
    body,
    limit,
    view,
    recheckWrite,
  });
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
  if (factory) {
    extension = factory.activate({
      db,
      q,
      dir,
      getState,
      mutate,
      currentWs,
      session,
      body,
      json,
      view,
      fail,
      canManage: sharing.canManage,
      deletingStudies,
      jobKey,
      forgetStudy: feedback.forgetStudy,
      localStorage: !s3Config(),
    });
    q('INSERT OR IGNORE INTO mnema_migrations(name) VALUES(?)').run(extensionMarker);
  }
  const handler = async (req, res) => {
    try {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'same-origin');
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; media-src 'self' blob:; frame-src 'self' blob:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'",
      );
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      if (path === '/healthz')
        return json(res, 200, { ok: true, version: VERSION, build: BUILD_ID });
      const publicMcp = matchPublicMcpRoute(path);
      if (publicMcp)
        return await handlePublicMcp(req, res, path, publicMcp, {
          transport: mcpNodeHandler,
          auth: (request, response) => toNodeHandler(auth)(request, response),
          limit,
        });
      if (path.startsWith('/api/') && !['GET', 'HEAD'].includes(req.method)) {
        if (req.headers.origin && req.headers.origin !== origin)
          fail(403, 'Запрос с другого сайта запрещён.');
        if (req.headers['x-mnema-request'] !== '1') fail(403, 'Некорректный запрос приложения.');
      }
      if (
        isAuthPath(path) &&
        (await handleAuth(req, res, path, {
          auth,
          signup,
          body,
          session,
          limit,
          ownerExists,
          register,
          withRegistration,
          enterWorkspace: (id) => wsStore.enterWith(id),
          corporateRegistration: options.corporateRegistration,
          setupEnabled: Boolean(setupToken),
          version: VERSION,
        }))
      )
        return;
      if (path.startsWith('/api/')) {
        const person = await session(req);
        if (!person) fail(401, 'Войдите в Мнемодак.');
        writingUsers.set(req, person);
        if (
          (path === '/api/welcome/dismiss' || path.startsWith('/api/profile/avatar/')) &&
          handleProfile(req, res, path, person, { q, sharing })
        )
          return;
        if (
          isModerationPath(path) &&
          (await handleModeration(req, res, path, person, {
            feedback,
            ideas,
            news,
            scopedPerson,
            ideaLocationAccess,
            body,
            session,
            limit,
          }))
        )
          return;
        if (
          (path === '/api/users' || path.startsWith('/api/users/')) &&
          (await handleDirectory(req, res, path, person, {
            q,
            db,
            userDirectory,
            session,
            withRegistration,
            hmacRemovedEmail,
          }))
        )
          return;
        if (
          path.startsWith('/api/mcp/') &&
          (await handleMcpManagement(req, res, path, person, { mcpService, body, limit }))
        )
          return;

        if (
          (path === '/api/workspaces' || path.startsWith('/api/workspaces/')) &&
          (await handleWorkspace(req, res, path, person, {
            body,
            session,
            limit,
            production,
            sharing,
            wsStore,
            inviteToProject,
            q,
            db,
            dir,
            uploadBusy,
            feedback,
            extension,
            initialState,
            createProject,
          }))
        )
          return;
        if (
          isGlobalChatPath(path) &&
          (await handleGlobalChat(req, res, path, person, {
            chats,
            body,
            session,
            limit,
            scopedPerson,
            wsStore,
            view,
            globalResearch,
            ratedReply,
            callModel,
          }))
        )
          return;
        if (!person.workspaceId) {
          if (path === '/api/state' && req.method === 'GET')
            return json(res, 200, {
              version: 0,
              state: {
                studies: [],
                findings: [],
                models: [],
                processors: [],
                users: person.manageUsers ? userDirectory(person) : [],
                modelId: '',
              },
              user: person,
            });
          fail(409, 'Сначала создайте проект.');
        }
        // Everything below reads and writes the workspace chosen by the mnema_ws cookie.
        wsStore.enterWith(person.workspaceId);
        if (extension && (await extension.handle(req, res, person, path))) return;
        if (
          path.startsWith('/api/imports/source/') &&
          (await handleImports(req, res, path, person, {
            q,
            quota,
            currentWs,
            getState,
            body,
            initialState,
            createProject,
            mutate,
            modelKey,
            limit,
            deletingStudies,
            jobKey,
          }))
        )
          return;
        if (
          (path === '/api/storage' || path.startsWith('/api/storage/')) &&
          (await handleStorage(req, res, path, person, { storageMirror, body }))
        )
          return;
        if (
          (path === '/api/state' || path === '/api/workspaces/' + currentWs() + '/profile') &&
          (await handleProjectState(req, res, path, person, {
            body,
            session,
            currentWs,
            getState,
            mutate,
            view,
            transcriptPreviews,
            jobKey,
            findingStatuses,
            importanceLevels,
            modelKeys,
            isBuiltin,
            reviewFinding,
            syncModels,
          }))
        )
          return;
        if (
          (path === '/api/invitations' || path.startsWith('/api/users/')) &&
          (await handleMembers(req, res, path, person, {
            body,
            session,
            currentWs,
            inviteToProject,
            view,
            roles,
            q,
            db,
            grantAllProjects,
            sharing,
          }))
        )
          return;
        if (
          (path === '/api/uploads' ||
            path === '/api/upload-sessions' ||
            path.startsWith('/api/upload-sessions/')) &&
          (await handleUpload(req, res, url, person))
        )
          return;
        if (
          path.startsWith('/api/files/') &&
          (await handleFiles(req, res, url, person, {
            view,
            session,
            q,
            dir,
            currentWs,
            storageMirror,
          }))
        )
          return;
        if (
          path.startsWith('/api/studies/') &&
          (await handleStudy(req, res, path, person, {
            body,
            session,
            getState,
            mutate,
            view,
            q,
            currentWs,
            jobKey,
            deletingStudies,
            activeCPU,
            dir,
            extension,
            feedback,
          }))
        )
          return;
        if (
          isProcessingPath(path) &&
          (await handleProcessing(req, res, path, person, {
            body,
            getState,
            mutate,
            view,
            enqueue,
            extension,
            recordingProcessor: options.recordingProcessor,
            speakerProcessor: options.speakerProcessor,
          }))
        )
          return;
        if (
          path.startsWith('/api/studies/') &&
          path.includes('/summary') &&
          (await handleMaterialSummary(req, res, path, person, {
            body,
            getState,
            currentWs,
            deletingStudies,
            jobKey,
            mutate,
            view,
            modelKey,
            limit,
          }))
        )
          return;
        if (
          path.startsWith('/api/studies/') &&
          (await handleHighlights(req, res, path, person, { body, limit, getState, mutate, view }))
        )
          return;
        if (
          path.startsWith('/api/studies/') &&
          path.includes('/suggest-findings') &&
          (await handleFindings(req, res, path, person, {
            body,
            getState,
            currentWs,
            deletingStudies,
            jobKey,
            mutate,
            view,
            limit,
          }))
        )
          return;
        if (
          (path === '/api/models' || path.startsWith('/api/models/')) &&
          (await handleModels(req, res, path, person, {
            body,
            limit,
            getState,
            modelKey,
            modelKeys,
            currentWs,
            mutate,
            syncModels,
            view,
            providerFetch: options.providerFetch || fetch,
            callModel,
          }))
        )
          return;
        if (
          path === '/api/project-summary' &&
          (await handleProjectSummary(req, res, path, person, {
            body,
            getState,
            view,
            modelKey,
            limit,
            session,
            reportOf,
            legacyFinding,
            callModel,
            mutate,
          }))
        )
          return;
        if (
          path === '/api/chat' &&
          (await handleProjectChat(req, res, path, person, {
            limit,
            body,
            session,
            getState,
            view,
            reportOf,
            ratedReply,
            modelKey,
            callModel,
          }))
        )
          return;
        fail(404, 'Метод не найден.');
      }
      if (!['GET', 'HEAD'].includes(req.method)) fail(405, 'Метод недоступен.');
      const name =
        path === '/' || !path.split('/').at(-1).includes('.')
          ? 'index.html'
          : path.replace(/^\//, '');
      const abs = resolve(publicDir, name);
      if (!abs.startsWith(publicDir + '/')) fail(404, 'Страница не найдена.');
      let data;
      try {
        data = await readFile(abs);
      } catch {
        fail(404, 'Страница не найдена.');
      }
      const suffix = name.slice(name.lastIndexOf('.'));
      const type = mimes[suffix] || 'application/octet-stream';
      const headers = {
        'Content-Type': type,
        'Cache-Control': name === 'index.html' ? 'no-cache' : 'public, max-age=3600',
      };
      // Hashed assets are immutable: compress once per encoding. index.html stays fresh on every request.
      const encoding =
        name !== 'index.html' && compressible(type) && data.length >= MIN_COMPRESS_BYTES
          ? pickEncoding(req.headers['accept-encoding'])
          : null;
      if (encoding) {
        const key = encoding + ':' + abs;
        let encoded = staticCache.get(key);
        if (!encoded) {
          encoded = await encode(data, encoding);
          staticCache.set(key, encoded);
        }
        res.writeHead(200, {
          ...headers,
          Vary: 'Accept-Encoding',
          'Content-Encoding': encoding,
          'Content-Length': encoded.length,
        });
        res.end(req.method === 'HEAD' ? undefined : encoded);
        return;
      }
      await sendBody(req, res, 200, headers, data);
    } catch (e) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const status = Number(e.statusCode || e.status);
      const known = Number.isInteger(status) && status >= 400 && status < 600;
      json(res, known ? status : 500, {
        error: known ? e.message : 'Не удалось выполнить действие. Повторите попытку.',
        ...(e.uploadCode
          ? { code: e.uploadCode }
          : known && e.publicCode
            ? { code: e.publicCode }
            : {}),
      });
      if (!known)
        console.error(
          'Request failed:',
          req.method,
          new URL(req.url, 'http://localhost').pathname,
          e.name,
        );
    }
  };
  const server = http.createServer((req, res) => {
    handler(req, res).catch(() => {
      if (!res.headersSent) json(res, 500, { error: 'Не удалось выполнить запрос.' });
    });
  });
  server.once('close', () => {
    storageMirror.close();
    stopWorker();
    mcpService.close().catch(() => {});
  });
  server.requestTimeout = 30 * 60 * 1000;
  server.headersTimeout = 30000;
  return {
    server,
    db,
    auth,
    storage: storageMirror,
    notifications: completionMail,
    close: () => {
      storageMirror.close();
      completionMail.close();
      stopWorker();
      server.close();
      db.close();
    },
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await createMnemaServer({
    corporateRegistration: process.env.MNEMA_CORPORATE_REGISTRATION === '1',
  });
  const port = Number(process.env.PORT || 4180);
  app.server.listen(port, '0.0.0.0', () =>
    console.log('Mnema ' + VERSION + ' listening on ' + port),
  );
  for (const signal of ['SIGTERM', 'SIGINT'])
    process.on(signal, () => {
      app.server.close(() => {
        app.db.close();
        process.exit(0);
      });
    });
}
