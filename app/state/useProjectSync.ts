import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { api, redeemWorkspaceLink, rememberWorkspace, setApiWorkspace } from '../api.ts';
import type { AppContext, AppState, SessionUser } from '../app-context.ts';
import { navigate, projectReturnPath, requestedWorkspace } from '../routes.ts';
import type { WorkspaceUser } from '../types.ts';
import { DEMO } from './constants.ts';

export interface AuthInfo {
  loading: boolean;
  user: SessionUser | null;
  setupRequired?: boolean;
  setupEnabled?: boolean;
  registrationEnabled?: boolean;
  error?: string;
}

interface ProjectSyncOptions {
  authInfo: AuthInfo;
  authInfoRef: RefObject<SessionUser | null>;
  serverVersion: RefObject<number>;
  stateRef: RefObject<AppState>;
  pending: RefObject<Promise<void>>;
  switching: RefObject<boolean>;
  importOpen: RefObject<boolean>;
  route: string;
  setState: Dispatch<SetStateAction<AppState>>;
  setAuthInfo: Dispatch<SetStateAction<AuthInfo>>;
  setNewsId: (id: string) => void;
  setToast: (message: string) => void;
  closeProject: () => void;
  go: (path: string) => void;
}

export function useProjectSync({
  authInfo,
  authInfoRef,
  serverVersion,
  stateRef,
  pending,
  switching,
  importOpen,
  route,
  setState,
  setAuthInfo,
  setNewsId,
  setToast,
  closeProject,
  go,
}: ProjectSyncOptions) {
  const appliedSnapshot = useRef<{ version: number; body: string } | null>(null);
  const receive: AppContext['receive'] = (data, onlyCurrentProject = false, fromPoll = false) => {
    if (
      onlyCurrentProject &&
      (switching.current || data.user?.workspaceId !== authInfoRef.current?.workspaceId)
    )
      return;
    const body = JSON.stringify(data),
      previous = appliedSnapshot.current;
    // Previews, activity and access can change outside the stored workspace version.
    if (fromPoll && previous && previous.version === data.version && previous.body === body) return;
    appliedSnapshot.current = { version: data.version, body };
    if (typeof data.user?.newsId === 'string') setNewsId(data.user.newsId);
    authInfoRef.current = data.user;
    setApiWorkspace(data.user?.workspaceId || null);
    serverVersion.current = data.version;
    setAuthInfo((a) => ({ ...a, user: data.user }));
    setState((s) => ({
      ...s,
      ...data.state,
      ...(!data.user?.workspaceId ? { workspace: undefined } : {}),
    }));
  };
  const linkWorkspaceApplied = useRef(false);
  const refresh = async () => {
    const info = await api('/api/session');
    if (info.user) {
      if (!linkWorkspaceApplied.current) {
        const requested = requestedWorkspace();
        if (requested) {
          await redeemWorkspaceLink(requested);
          setApiWorkspace(requested);
          rememberWorkspace(requested);
        }
        linkWorkspaceApplied.current = true;
      }
      receive(await api('/api/state'));
      setAuthInfo((a) => ({
        ...a,
        registrationEnabled: info.registrationEnabled,
        loading: false,
        error: undefined,
      }));
    } else setAuthInfo({ ...info, loading: false });
  };
  const completeAuth = async () => {
    const back = projectReturnPath(new URL(location.href));
    if (back && back !== location.pathname + location.search) {
      if (new URL(back, location.origin).searchParams.has('share')) location.replace(back);
      else location.assign(back);
      return;
    }
    try {
      await refresh();
    } catch (error) {
      if (error.status === 403 || error.status === 404) {
        closeProject();
        return;
      }
      throw error;
    }
    if (!back) go('research');
  };
  useEffect(() => {
    const screen = route.split('?')[0];
    if (
      authInfo.user &&
      (screen === 'reset' || (screen === 'signup' && authInfo.registrationEnabled))
    )
      navigate('research');
  }, [route, authInfo.user?.id, authInfo.registrationEnabled]);
  useEffect(() => {
    if (DEMO) return;
    refresh().catch((e) => setAuthInfo({ loading: false, user: null, error: e.message }));
  }, []);
  useEffect(() => {
    if (DEMO || !authInfo.user) return;
    let queued = false;
    const poll = () => {
      if (queued || switching.current || importOpen.current) return;
      queued = true;
      pending.current = pending.current.then(async () => {
        try {
          if (!switching.current && !importOpen.current && authInfoRef.current)
            receive(await api('/api/state'), false, true);
        } catch (e) {
          if (e.status === 401)
            setAuthInfo((info) => ({
              ...info,
              user: null,
              loading: false,
              setupRequired: false,
              error: undefined,
            }));
          else if (e.status === 403 || e.status === 404) closeProject();
          else setToast(e.message);
        } finally {
          queued = false;
        }
      });
    };
    const onVisible = () => {
      if (!document.hidden) poll();
    };
    const timer = setInterval(() => {
      if (
        !document.hidden ||
        authInfoRef.current?.recordingProcessing ||
        stateRef.current.studies.some((s) => s.status === 'processing')
      )
        poll();
    }, 5000);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [authInfo.user?.id]);
  const update: AppContext['update'] = (patch) => {
    const changes = typeof patch === 'function' ? patch(stateRef.current) : patch;
    const before = stateRef.current;
    const next = { ...before, ...changes };
    stateRef.current = next;
    setState(next);
    if (DEMO) return Promise.resolve(true);
    const remote = Object.fromEntries(
      Object.entries(changes).filter(([k]) =>
        ['findings', 'models', 'processors', 'modelId'].includes(k),
      ),
    );
    const changedUser = changes.users?.find((u) => {
      const old = before.users.find((x) => x.id === u.id);
      return (
        old &&
        (u.role !== old.role || u.status !== old.status || Boolean(u.admin) !== Boolean(old.admin))
      );
    });
    if (!Object.keys(remote).length && !changedUser) return Promise.resolve(true);
    const saved = pending.current.then(async () => {
      try {
        const data = changedUser
          ? await api(
              '/api/users/' + changedUser.id,
              {
                ...Object.fromEntries(
                  (['role', 'status', 'admin'] as const)
                    .filter(
                      (key) =>
                        changedUser[key] !==
                        before.users.find((u) => u.id === changedUser.id)?.[key],
                    )
                    .map((key) => [key, changedUser[key]]),
                ),
                workspaceId:
                  changedUser.projectIds?.length === 1 ? changedUser.projectIds[0] : undefined,
              },
              'PATCH',
            )
          : await api('/api/state', { version: serverVersion.current, changes: remote }, 'PATCH');
        receive(data);
        return true;
      } catch (e) {
        setToast(e.message);
        try {
          receive(await api('/api/state'));
        } catch {}
        return false;
      }
    });
    pending.current = saved.then(() => {});
    return saved;
  };
  const removeUser = (id: string) => {
    if (DEMO) return update((s) => ({ users: s.users.filter((u) => u.id !== id) }));
    const saved = pending.current.then(async () => {
      const { users } = await api<{ users: WorkspaceUser[] }>(
        '/api/users/' + encodeURIComponent(id),
        undefined,
        'DELETE',
        false,
      );
      stateRef.current = { ...stateRef.current, users };
      setState((s) => ({ ...s, users }));
    });
    pending.current = saved.catch(() => {});
    return saved;
  };
  return { receive, update, removeUser, refresh, completeAuth };
}
