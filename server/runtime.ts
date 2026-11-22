import { createInvitations } from './auth/invitations.ts';
import { initializeWorkspaceProjection, projectionTotals } from './projects/projection.ts';
import { createStaticHandler } from './static.ts';
import {
  createProjectStore,
  createWorkspaceFactory,
  migrateLegacyWorkspace,
} from './projects/store.ts';
import { legacyFinding, reportOf } from './analysis/review.ts';
import { createMembership } from './auth/membership.ts';
import { createSession } from './auth/session.ts';
import { createProjectCards } from './projects/cards.ts';
import { createProjectView } from './projects/view.ts';
import { createAccountRegistration } from './auth/account-registration.ts';
import { createModelCaller } from './admin/model-provider.ts';
import { createFileProcessor } from './processing/processor.ts';
import { createProcessingQueue, jobKey } from './processing/queue.ts';
import { createAnalysisWorker } from './analysis/worker.ts';
import { createUploads } from './materials/uploads.ts';
import { createRequestContext, type Person } from './request-context.ts';
import { fail, json } from './http.ts';
import { createProductNews } from './product-news.ts';
import { createRegistration } from './registration.ts';
import { createProjectSharing } from './project-sharing.ts';
import { createChatHistory } from './chat-history.ts';
import { createAnswerFeedback } from './answer-feedback.ts';
import type { loadExtension, ServerExtension } from './extension.ts';
import { mcpPlugins, createMcpService } from './mcp.ts';
import { keySlot, modelKeyStore } from './model-connections.ts';
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
import { configureDatabase, createCoreTables, openDatabase } from './db.ts';
import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdir } from 'node:fs/promises';
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
const hash = (v) => createHash('sha256').update(v).digest('hex');
const slotPattern = keySlot;

interface RuntimeConfig {
  version: string;
  buildId: string;
  bundledExtension: Awaited<ReturnType<typeof loadExtension>>;
}

export async function createRuntime(
  options: MnemaServerOptions,
  { version: VERSION, buildId: BUILD_ID, bundledExtension }: RuntimeConfig,
) {
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
  migrateLegacyWorkspace(db, q);
  const projection = initializeWorkspaceProjection(db);
  console.info(
    'Workspace projection verified',
    JSON.stringify({
      rebuilt: projection.rebuilt,
      elapsedMs: projection.elapsedMs,
      ...projectionTotals(projection.report),
    }),
  );
  const sharing = createProjectSharing(db, baseURL, authSecret);
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
  const { getState, mutate, copyModels, syncModels } = createProjectStore({
    q,
    db,
    currentWs,
    wsStore,
    modelKeys,
    writeProjection: projection.write,
  });
  const createProject = createWorkspaceFactory({
    db,
    q,
    sharing,
    copyModels,
    writeProjection: projection.write,
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

  const serveStatic = createStaticHandler(publicDir);
  const { writingUsers, body, recheckWrite, limit } = createRequestContext(session);
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
  const inviteToProject = createInvitations({
    currentWs,
    sharing,
    limit,
    q,
    users,
    grantAllProjects,
    baseURL,
    origin,
    hash,
    options,
  });
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
  return {
    origin,
    auth,
    signup,
    body,
    session,
    limit,
    ownerExists,
    register,
    withRegistration,
    wsStore,
    writingUsers,
    q,
    sharing,
    feedback,
    ideas,
    news,
    scopedPerson,
    ideaLocationAccess,
    userDirectory,
    db,
    hmacRemovedEmail,
    mcpService,
    mcpNodeHandler,
    production,
    inviteToProject,
    dir,
    uploadBusy,
    extension,
    createProject,
    chats,
    view,
    globalResearch,
    ratedReply,
    callModel,
    quota,
    currentWs,
    getState,
    mutate,
    modelKey,
    deletingStudies,
    storageMirror,
    transcriptPreviews,
    modelKeys,
    isBuiltin,
    syncModels,
    grantAllProjects,
    handleUpload,
    activeCPU,
    enqueue,
    reportOf,
    legacyFinding,
    serveStatic,
    setupToken,
    stopWorker,
    completionMail,
  };
}
