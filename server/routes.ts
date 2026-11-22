import { handleProcessing, isProcessingPath } from './processing/routes.ts';
import { handleImports } from './materials/import-route.ts';
import { handleFiles, handleStorage } from './materials/file-route.ts';
import { handleStudy, handleHighlights } from './materials/study-route.ts';
import { handleMaterialSummary, handleFindings, handleProjectSummary } from './analysis/routes.ts';
import { handleGlobalChat, handleProjectChat, isGlobalChatPath } from './chat/routes.ts';
import { handleWorkspace } from './projects/workspace-route.ts';
import { handleProjectState } from './projects/state-route.ts';
import { handleDirectory, handleMembers } from './projects/membership-route.ts';
import { handleAuth, handleProfile, isAuthPath } from './auth/routes.ts';
import { handleMcpManagement, handlePublicMcp, matchPublicMcpRoute } from './mcp/routes.ts';
import { handleModeration, isModerationPath } from './admin/moderation-route.ts';
import { handleModels } from './admin/models-route.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { toNodeHandler } from 'better-auth/node';
import { fail, json } from './http.ts';
import { findingStatuses, importanceLevels, reviewFinding } from './analysis/review.ts';
import { jobKey } from './processing/queue.ts';
import { initialState } from './projects/store.ts';
import { roles } from './auth/invitations.ts';
import type { createRuntime, MnemaServerOptions } from './runtime.ts';

export function createRequestHandler(
  runtime: Awaited<ReturnType<typeof createRuntime>>,
  options: MnemaServerOptions,
  version: string,
  buildId: string,
) {
  const {
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
    readWorkspace,
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
  } = runtime;
  return async function handler(req: IncomingMessage, res: ServerResponse) {
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
      if (path === '/healthz') return json(res, 200, { ok: true, version, build: buildId });
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
          version,
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
            readWorkspace,
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
            readWorkspace,
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
      await serveStatic(req, res, path);
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
}
