import type { IncomingMessage } from 'node:http';
import type { betterAuth } from 'better-auth';
import { fromNodeHeaders } from 'better-auth/node';
import type { openDatabase } from '../db.ts';
import { fail } from '../http.ts';
import type { createProjectSharing } from '../project-sharing.ts';
import type { createProjectCards } from '../projects/cards.ts';
import type { createProductNews } from '../product-news.ts';
import type { Person } from '../request-context.ts';

interface SessionServices {
  auth: { api: Pick<ReturnType<typeof betterAuth>['api'], 'getSession'> };
  q: ReturnType<typeof openDatabase>['q'];
  sharing: Pick<ReturnType<typeof createProjectSharing>, 'projects' | 'validLink' | 'linkProject'>;
  projectCard: ReturnType<typeof createProjectCards>;
  news: Pick<ReturnType<typeof createProductNews>, 'latest'>;
}

const cookieValue = (req: IncomingMessage, name: string) =>
  String(req.headers.cookie || '')
    .split(';')
    .map((c: string) => c.trim())
    .find((c: string) => c.startsWith(name + '='))
    ?.slice(name.length + 1) || '';

export function createSession({ auth, q, sharing, projectCard, news }: SessionServices) {
  const session = async (req: IncomingMessage): Promise<Person | null> => {
    const s = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!s) return null;
    const access = q('SELECT * FROM mnema_access WHERE user_id=?').get(s.user.id);
    if (!access || access.revoked) return null;
    const active = sharing.projects(s.user.id);
    const requestURL = new URL(req.url, 'http://localhost'),
      redeeming = /^\/api\/workspaces\/[^/]+\/share$/.test(requestURL.pathname),
      explicit = redeeming
        ? ''
        : String(
            req.headers['x-mnema-workspace'] || requestURL.searchParams.get('workspace') || '',
          );
    const wanted = explicit || cookieValue(req, 'mnema_ws');
    let current = active.find((m: any) => m.id === wanted) || (!explicit ? active[0] : null),
      sharedProject;
    if (wanted && !active.some((m) => m.id === wanted)) {
      const share = String(
        req.headers['x-mnema-share'] ||
          requestURL.searchParams.get('share') ||
          cookieValue(req, 'mnema_share_' + wanted),
      );
      if (sharing.validLink(wanted, share)) {
        current = sharing.linkProject(wanted);
        sharedProject = {
          id: current.id,
          name: current.name,
          role: 'view' as const,
          admin: false,
          sharingMode: 'link',
          shareVersion: current.nonce,
        };
      } else if (explicit) fail(403, 'Доступ к проекту закрыт. Обновите список проектов.');
    }
    const recordingProcessing = active.some((project) =>
      projectCard(project).processingOwners.has(s.user.id),
    );
    return {
      ...s.user,
      newsId: news.latest(),
      recordingProcessing,
      welcomePending: Boolean(access.welcome_pending),
      role: current?.role || 'view',
      admin: Boolean(current?.role === 'full'),
      owner: Boolean(access.admin),
      manageUsers: Boolean(
        access.admin || (!access.self_registered && access.all_projects && access.role === 'full'),
      ),
      workspaceId: current?.id || null,
      ...(sharedProject ? { sharedProject } : {}),
      workspaces: active.map((m: any) => {
        const card = projectCard(m);
        return {
          id: m.id,
          name: m.name,
          role: m.role,
          admin: Boolean(m.admin),
          sharingMode: m.mode,
          fileCount: card.fileCount,
          filePreviews: card.filePreviews,
          emptyDefault:
            m.id === 'main' && m.name === 'Команда' && card.studyCount === 0 && m.member_count <= 1,
        };
      }),
    };
  };
  return session;
}
