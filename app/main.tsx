import { useProjectSync, type AuthInfo } from './state/useProjectSync.ts';
import { initialNews, demoNews } from './product-news.ts';
import { useCompactLayout, MOBILE_WEB_QUERY } from './useCompactLayout.ts';
import ChatHistoryScroll from './ChatHistoryScroll.tsx';
import {
  appHref,
  appRoute,
  navigate,
  readRoute,
  requestedWorkspace,
  canonicalizeRoute,
  routeHref,
  navigateHref,
} from './routes.ts';
import ResearchCatalog from './ResearchCatalog.tsx';
import { useResearchChats } from './useResearchChats.ts';
import { ProjectMenu, ProjectDialog } from './ProjectActions.tsx';
import { ProjectShareButton, ProjectSharingDialog } from './ProjectSharing.tsx';
import BatchUpload from './BatchUpload.tsx';
import { useCompletionFavicon } from './completion-favicon.ts';
import './overview-cards.css';
import { MCPConsent } from './MCPSettings.tsx';
import { settingsExtensions } from './extension.tsx';
import { projectExtensionRoutes } from './routes.ts';
import { IdeasPanel } from './Ideas.tsx';
import { FeedbackMode } from './Feedback.tsx';
import { revealFeedbackLocation } from './feedback-anchor.ts';
import { isFeedbackPath, type FeedbackContext } from './feedback-context.ts';
import { APP_VERSION } from './version.ts';
import { useCompletionSound } from './completion.ts';
import ProjectImporter from './ProjectImporter.tsx';
import BrandMark, { BetaMark } from './BrandMark.tsx';
import WelcomeDialog from './WelcomeDialog.tsx';
import AuthPage from './AuthPage.tsx';
import RegistrationPage from './RegistrationPage.tsx';
import { api, setApiWorkspace, rememberWorkspace, redeemWorkspaceLink } from './api.ts';
import { Context, type AppContext, type AppState, type SourcePanelState } from './app-context.ts';
import { NavigationHint } from './shared/NavigationHint.tsx';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  configure,
  Modal,
  Avatar,
  Button,
  Dialog,
  Popup,
  Hotkey,
  Loader,
  SegmentedRadioGroup,
  Switch,
  ThemeProvider,
} from '@gravity-ui/uikit';
import {
  Megaphone,
  Files,
  Folder,
  House,
  Library,
  Lightbulb,
  Menu,
  MessageSquare,
  Moon,
  Newspaper,
  PanelLeftClose,
  PanelLeftOpen,
  Monitor,
  Settings,
  Trash2,
  UserPlus,
  Plus,
  Sun,
  LogOut,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ChatSource } from './types.ts';
import '@gravity-ui/uikit/styles/styles.css';
import './gravity.css';
import './theme-wipe.css';
import { initialStudies } from './data.ts';
import { DEMO, load, qa, storage } from './state/constants.ts';
import { settingsBackdrop, backdropRoute } from './state/overlay-routes.ts';
import { normalize } from './state/normalize.ts';
import { IconButton, Empty } from './shared/ui.tsx';
import { FindingsBreadcrumbs, ProjectBreadcrumbs } from './shared/ProjectNavigation.tsx';
import { management, extraSettings, SettingsModal } from './screens/Settings.tsx';
import { Findings } from './screens/Findings.tsx';
import { FindingPage } from './screens/FindingPage.tsx';
import { GlobalChat } from './screens/GlobalChat.tsx';
import { Home } from './screens/Home.tsx';
import { LibraryPage } from './screens/Library.tsx';
import { FileWindow, StudyScreen, StudyModal, SourcePanel } from './screens/Study.tsx';
import { AppDialog } from './screens/AppDialog.tsx';

configure({ lang: 'ru' });

for (const { id } of settingsExtensions) projectExtensionRoutes.add(id);

export function App() {
  const [authInfo, setAuthInfo] = useState<AuthInfo>({
    loading: !DEMO,
    user: null,
    setupRequired: false,
    setupEnabled: false,
  });
  const authInfoRef = useRef(authInfo.user);
  authInfoRef.current = authInfo.user;
  const switchWorkspaceRef = useRef<((id: string, navigate?: boolean) => Promise<void>) | null>(
    null,
  );
  const [state, setState] = useState<AppState>(load);
  const serverVersion = useRef(0),
    stateRef = useRef(state),
    pending = useRef(Promise.resolve());
  const [route, setRoute] = useState(appRoute);
  const routeRef = useRef(route);
  const [animateStudy, setAnimateStudy] = useState(false);

  const [dialog, open] = useState<any>(() =>
    new URLSearchParams(location.search).get('open') === 'whatsnew' ? { type: 'whatsnew' } : null,
  );
  const [projectAction, setProjectAction] = useState<any>(null);
  const [sharedProject, setSharedProject] = useState<{ id: string; name: string } | null>(null);
  const [toast, setToast] = useState('');
  const [mobile, setMobile] = useState(() => innerWidth < 960);
  const mobileWeb = useCompactLayout(MOBILE_WEB_QUERY);
  const navs: [string, string, LucideIcon][] = [
    ['home', 'Обзор проекта', House],
    ['library', mobile ? 'Документы' : 'Материалы', mobile ? Files : Library],
  ];
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const settingsTrigger = useRef<HTMLAnchorElement>(null);
  const settingsOrigin = useRef<{ x: number; y: number } | null>(null);
  const sidebarShift = useRef<{ left: number; animation?: Animation } | null>(null);
  const [selected, setSelected] = useState<string | null>(() =>
    new URLSearchParams(location.search).get('segment'),
  );
  const importOpen = useRef(false);
  importOpen.current = dialog?.type === 'import';
  const switching = useRef(false);
  const [switchingProject, setSwitchingProject] = useState(false);
  const uploadingBatch = useRef(false);
  const [panel, setPanel] = useState<{
    studyId?: string;
    segmentId?: string;
    findingId?: string;
    number?: number;
    sources?: ChatSource[];
    heading?: string;
    key?: string;
  } | null>(null);
  // The panel stays mounted briefly after closing so it can slide out while the content slides back.
  const [shownPanel, setShownPanel] = useState<typeof panel>(null),
    [panelClosing, setPanelClosing] = useState(false);
  useEffect(() => {
    if (panel) {
      setShownPanel(panel);
      setPanelClosing(false);
      return;
    }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShownPanel(null);
      return;
    }
    setPanelClosing(true);
    const t = setTimeout(() => {
      setShownPanel(null);
      setPanelClosing(false);
    }, 160);
    return () => clearTimeout(t);
  }, [panel]);
  // Gleap-style navigation: a narrow rail that opens over the content on hover; the pin keeps it open.
  const [accountOpen, setAccountOpen] = useState(false),
    [accountEl, setAccountEl] = useState<HTMLElement | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false),
    [ideasOpen, setIdeasOpen] = useState<'all' | 'mine' | null>(() =>
      location.hash === '#ideas' ? 'all' : null,
    );
  const feedbackTrigger = useRef<HTMLElement | null>(null);
  const feedbackJump = useRef<AbortController | null>(null);
  useEffect(() => () => feedbackJump.current?.abort(), []);
  const closeFeedback = React.useCallback(() => {
    setFeedbackOpen(false);
    requestAnimationFrame(() =>
      (feedbackTrigger.current?.isConnected ? feedbackTrigger.current : menuTrigger.current)?.focus(
        { preventScroll: true },
      ),
    );
  }, []);
  const [systemDark, setSystemDark] = useState(
    () => matchMedia('(prefers-color-scheme: dark)').matches,
  );
  useEffect(() => {
    const m = matchMedia('(prefers-color-scheme: dark)');
    const h = () => setSystemDark(m.matches);
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, []);
  const effectiveTheme = state.theme === 'system' ? (systemDark ? 'dark' : 'light') : state.theme;
  const themeTransition = useRef<ViewTransition | null>(null);
  const [seen, setSeen] = useState(() => {
    try {
      return localStorage.getItem('mnema.whatsnew');
    } catch {
      return null;
    }
  });
  const [newsId, setNewsId] = useState(() => (DEMO ? demoNews() : initialNews)[0]?.id ?? '');
  const markSeen = React.useCallback((id: string) => {
    setNewsId(id);
    setSeen(id);
    try {
      localStorage.setItem('mnema.whatsnew', id);
    } catch {}
  }, []);
  const main = useRef<HTMLElement>(null),
    files = useRef(new Map<string, { url: string; name?: string; type?: string }>());
  stateRef.current = state;
  const reader = DEMO
    ? qa && new URLSearchParams(location.search).get('role') === 'view'
    : authInfo.user?.role !== 'full';

  const { receive, update, removeUser, refresh, completeAuth } = useProjectSync({
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
    closeProject: () => closeProject(),
    go: (path) => go(path),
  });
  const go = (path: string, segment: string | null = null, animateStudy = false) => {
    setSelected(segment);
    navigate(
      path +
        (segment
          ? (path.includes('?') ? '&' : '?') + 'segment=' + encodeURIComponent(segment)
          : ''),
      false,
      animateStudy,
    );
    if (appRoute() === path && segment)
      requestAnimationFrame(() =>
        document.getElementById('segment-' + segment)?.scrollIntoView({ block: 'center' }),
      );
  };
  const notify = (text: string) => setToast(text);
  const locateFeedback = (feedback: FeedbackContext) => {
    const path = feedback.location?.path;
    if (!isFeedbackPath(path)) return;
    setIdeasOpen(null);
    feedbackJump.current?.abort();
    const jump = new AbortController();
    feedbackJump.current = jump;
    navigateHref(path);
    void revealFeedbackLocation(feedback, jump.signal).then((found) => {
      if (!found && !jump.signal.aborted) notify('Элемент изменился или больше недоступен');
    });
  };
  const chatHistory = useResearchChats({
    demo: DEMO,
    userId: authInfo.user?.id,
    route,
    go,
    notify,
    state,
    accessKey: (authInfo.user?.workspaces || [])
      .map((w) => w.id + ':' + w.role)
      .sort()
      .join('|'),
  });
  const {
    messages: globalMessages,
    setMessages: setGlobalMessages,
    typing: globalTyping,
    error: globalError,
    ask: askGlobal,
  } = chatHistory;
  const closeProject = () => {
    setPanel(null);
    setSelected(null);
    setGlobalMessages([]);
    setSharedProject(null);
    setState((previous) => ({
      ...previous,
      workspace: undefined,
      studies: [],
      findings: [],
      highlights: [],
      users: [],
      models: [],
    }));
    setAuthInfo((previous) => ({
      ...previous,
      loading: false,
      error:
        'Доступ к проекту закрыт. Попросите владельца добавить вас в проект или прислать действующую ссылку.',
    }));
  };

  const recordingProcessing = Boolean(authInfo.user?.recordingProcessing && !authInfo.error);
  useCompletionFavicon(
    state.studies,
    authInfo.user?.workspaceId ?? undefined,
    authInfo.user?.id,
    route,
    (authInfo.user?.workspaces || []).map((w) => w.id),
    recordingProcessing,
  );
  useCompletionSound(
    state.studies,
    authInfo.user?.workspaceId ?? undefined,
    state.soundEnabled !== false,
    (finished) =>
      notify(
        finished.length === 1
          ? 'Расшифровка готова: ' + finished[0].title
          : 'Расшифровки готовы: ' + finished.length,
      ),
  );
  useEffect(() => {
    try {
      localStorage.setItem(
        storage,
        JSON.stringify({
          version: 1,
          data: DEMO
            ? state
            : {
                theme: state.theme,
                sidebarCollapsed: state.sidebarCollapsed,
                soundEnabled: state.soundEnabled !== false,
              },
        }),
      );
    } catch {
      setToast('Изменения не сохранились. Освободите место в хранилище браузера.');
    }
  }, [state]);
  useEffect(() => {
    const h = async (e: Event) => {
      if (location.hash === '#main' && appRoute() === routeRef.current) {
        main.current?.focus();
        return;
      }
      const next = appRoute(),
        requested = requestedWorkspace();
      if (requested && authInfoRef.current?.workspaceId !== requested && authInfoRef.current) {
        try {
          await switchWorkspaceRef.current?.(requested, false);
          if (authInfoRef.current?.workspaceId !== requested) {
            history.replaceState(null, '', appHref(routeRef.current));
            return;
          }
        } catch {
          history.replaceState(null, '', appHref(routeRef.current));
          return;
        }
      } else if (
        requested &&
        authInfoRef.current &&
        new URL(location.href).searchParams.has('share')
      ) {
        try {
          await redeemWorkspaceLink(requested);
        } catch {
          history.replaceState(null, '', appHref(routeRef.current));
          notify('Не удалось открыть проект. Проверьте ссылку.');
          return;
        }
      }
      const overlayRoute = (r: string) =>
        r.startsWith('study/') || management.some(([id]) => id === r.split('?')[0]);
      const overlay = overlayRoute(next) || overlayRoute(routeRef.current);
      routeRef.current = next;
      setRoute(next);
      setAnimateStudy(e instanceof PopStateEvent && e.state?.animateStudy === true);
      canonicalizeRoute();
      setSelected(new URLSearchParams(location.search).get('segment'));
      setMenuOpen(false);
      setFeedbackOpen(false);
      setPanel(null);
      if (!overlay) {
        window.scrollTo(0, 0);
        main.current?.parentElement?.scrollTo({ top: 0 });
        requestAnimationFrame(() => {
          main.current?.focus({ preventScroll: true });
          if (next === 'chat')
            main.current?.querySelector<HTMLTextAreaElement>('.shared-composer textarea')?.focus();
        });
      }
    };
    const click = (e: MouseEvent) => {
      const a = (e.target as Element).closest?.<HTMLAnchorElement>('a[href]');
      if (
        !a ||
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey ||
        a.hasAttribute('download') ||
        a.getAttribute('target')
      )
        return;
      const url = new URL(a.href, location.href);
      if (
        url.origin !== location.origin ||
        /^\/(api|mcp)(?:\/|$)/.test(url.pathname) ||
        (url.hash && !url.hash.startsWith('#/'))
      )
        return;
      e.preventDefault();
      if (url.hash.startsWith('#/')) navigate(readRoute(url).route, false, e.detail > 0);
      else navigateHref(url.pathname + url.search + url.hash, false, e.detail > 0);
    };
    window.addEventListener('hashchange', h);
    window.addEventListener('popstate', h);
    document.addEventListener('click', click);
    return () => {
      window.removeEventListener('hashchange', h);
      window.removeEventListener('popstate', h);
      document.removeEventListener('click', click);
    };
  }, []);
  useEffect(() => {
    if (authInfo.user) canonicalizeRoute();
  }, [authInfo.user?.workspaceId, route]);
  useEffect(() => {
    const m = matchMedia('(min-width:960px)');
    const resize = () => {
      setMobile(!m.matches);
      setMenuOpen(false);
    };
    m.addEventListener('change', resize);
    resize();
    return () => m.removeEventListener('change', resize);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (menuOpen) {
        setMenuOpen(false);
        return;
      }
      if (document.querySelector('.g-modal_open,.g-popup_open')) return;
      setPanel(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (root.dataset.theme === effectiveTheme && root.style.colorScheme === effectiveTheme) return;
    root.classList.add('theme-changing');
    root.dataset.theme = effectiveTheme;
    root.style.colorScheme = effectiveTheme;
    getComputedStyle(root).colorScheme;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => root.classList.remove('theme-changing'));
    });
    return () => {
      cancelAnimationFrame(frame);
      root.classList.remove('theme-changing');
    };
  }, [effectiveTheme]);
  useEffect(() => {
    const label =
      route === 'chat' || route.startsWith('conversation/')
        ? chatHistory.activeTitle
        : route === 'research' || route === 'projects'
          ? 'Проекты'
          : route.split('?')[0] === 'all-findings'
            ? 'Находки'
            : route.split('?')[0] === 'findings'
              ? 'Находки'
              : [...navs, ...management].find((x) => x[0] === route.split('?')[0])?.[1] ||
                state.studies.find((s) => route === 'study/' + s.id)?.title ||
                (route.startsWith('finding/')
                  ? state.findings.find((f) => route === 'finding/' + f.id)?.title || 'Находка'
                  : null) ||
                (route.startsWith('file/')
                  ? state.studies.find((s) => route === 'file/' + s.id)?.fileName || 'Исходный файл'
                  : route === 'signup'
                    ? 'Регистрация'
                    : route === 'login'
                      ? 'Вход'
                      : route === 'reset'
                        ? 'Восстановление пароля'
                        : 'Материал');
    document.title =
      (recordingProcessing ? 'Обработка · ' : '') +
      (label
        ? label +
          (['home', 'library', 'findings', 'users', 'models', 'integrations', 'mcp'].includes(
            route.split('?')[0],
          ) && state.workspace?.name
            ? ' · ' + state.workspace.name
            : '') +
          ' — '
        : '') +
      'Мнемодак';
  }, [route, state.studies, state.workspace?.name, recordingProcessing, chatHistory.activeTitle]);
  useEffect(
    () => () => {
      for (const f of files.current.values()) URL.revokeObjectURL(f.url);
    },
    [],
  );
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 6000);
    return () => clearTimeout(t);
  }, [toast]);
  // Only a local processing simulation. This interval never contacts an ASR service.
  useEffect(() => {
    if (!DEMO) return;
    const t = setInterval(
      () =>
        setState((s) => {
          if (!s.studies.some((x) => x.status === 'processing')) return s;
          return {
            ...s,
            studies: s.studies.map((x) =>
              x.status === 'processing'
                ? {
                    ...x,
                    step: Math.min((x.step || 0) + 1, 4),
                    status: (x.step || 0) >= 3 ? 'ready' : 'processing',
                    summary:
                      (x.step || 0) >= 3 ? structuredClone(initialStudies[0].summary) : x.summary,
                  }
                : x,
            ),
          };
        }),
      2200,
    );
    return () => clearInterval(t);
  }, []);
  function changeTheme(value: 'system' | 'light' | 'dark') {
    const root = document.documentElement;
    const next = value === 'system' ? (systemDark ? 'dark' : 'light') : value;
    themeTransition.current?.skipTransition();
    themeTransition.current = null;
    if (
      next === effectiveTheme ||
      !document.startViewTransition ||
      matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      root.classList.remove('theme-wiping');
      void update({ theme: value });
      return;
    }
    root.classList.add('theme-wiping');
    const transition = document.startViewTransition(() => {
      if (themeTransition.current === transition)
        flushSync(() => {
          void update({ theme: value });
        });
    });
    themeTransition.current = transition;
    const finish = () => {
      if (themeTransition.current !== transition) return;
      themeTransition.current = null;
      root.classList.remove('theme-wiping');
    };
    void transition.ready.catch(() => {});
    void transition.finished.then(finish, finish);
  }
  const theme = () => changeTheme(effectiveTheme === 'dark' ? 'light' : 'dark');
  const openPanel = (p: SourcePanelState) => setPanel(p);
  const setAnswerRating = (id: string, rating: 'up' | 'down' | null) => {
    const apply = (messages: any[]) =>
      messages.map((message) => (message.id === id ? { ...message, rating } : message));
    setGlobalMessages(apply);
  };
  // Settings open as a modal over the last page; that page keeps its own route.
  const settingsTab = management.some(([id]) => id === route.split('?')[0])
    ? route.split('?')[0]
    : null;
  if (!settingsTab) settingsBackdrop.current = route;
  const pageRoute = settingsTab ? settingsBackdrop.current : route;
  useEffect(() => {
    if (!settingsTab) settingsOrigin.current = null;
  }, [settingsTab]);
  const context: AppContext = {
    chatHistory,
    removeUser,
    projectAction: (action, project) => {
      setMenuOpen(false);
      if (action === 'share' || action === 'invite') {
        setSharedProject(project);
        return;
      }
      if (action === 'files') {
        if (uploadingBatch.current) {
          notify('Дождитесь завершения загрузки перед сменой проекта.');
          return;
        }
        switchWorkspaceRef
          .current?.(project.id)
          .then(() => go('library'))
          .catch(() => {});
        return;
      }
      setProjectAction({ action, project });
    },
    setAnswerRating,
    globalMessages,
    globalTyping,
    globalError,
    askGlobal,
    clearGlobalChat: chatHistory.newChat,
    openGlobalSource: async (source) => {
      try {
        if (!DEMO) {
          if (source.workspaceId && source.workspaceId !== authInfo.user?.workspaceId)
            await switchWorkspaceRef.current?.(source.workspaceId, false);
          else await refresh();
        }
        setPanel({ studyId: source.studyId, segmentId: source.segmentId, number: source.number });
      } catch {
        notify('Не удалось открыть источник. Проверьте доступ к проекту.');
      }
    },
    projectName: state.workspace?.name || 'Проект',
    workspaces: (authInfo.user?.workspaces || []).filter((w) => !w.emptyDefault),
    switchingProject,
    switchWorkspace: (id: string, navigate = true) => switchWorkspaceRef.current?.(id, navigate),
    markSeen,
    state,
    update,
    receive,
    user: authInfo.user,
    real: !DEMO,
    reader,
    route: pageRoute,
    go,
    dialog,
    open,
    notify,
    selected,
    setSelected,
    files,
    panel: shownPanel,
    panelClosing,
    setPanel,
    openPanel,
  };
  const studyOpen = pageRoute.startsWith('study/');
  const returnRoute = history.state?.returnTo
    ? readRoute(new URL(history.state.returnTo, location.origin)).route
    : backdropRoute.current;
  const contentRoute = studyOpen ? returnRoute : pageRoute;
  if (!studyOpen) backdropRoute.current = pageRoute;
  const base = contentRoute.split('?')[0],
    view = base;
  const globalFindingFlow = history.state?.findingsRoot?.startsWith('/all-findings');
  const findingsView =
    globalFindingFlow || base === 'all-findings' || contentRoute.startsWith('finding/');
  const breadcrumbFinding = state.findings.find((f) => contentRoute === 'finding/' + f.id);
  const rootCatalog = ['research', 'projects', 'all-findings'].includes(base);
  const conversationView = base === 'chat' || base.startsWith('conversation/');
  const globalView = globalFindingFlow || rootCatalog || conversationView;
  const findingCounts = state.findings
    .map(normalize)
    .reduce<Partial<Record<string, number>>>((counts, finding) => {
      counts[finding.status] = (counts[finding.status] ?? 0) + 1;
      return counts;
    }, {});
  const canManage = !reader && (DEMO || authInfo.user?.admin);
  const canUseSettings = DEMO || Boolean(authInfo.user);
  const visibleManagement = management.filter(([id]) =>
    extraSettings.has(id)
      ? extraSettings.get(id)!.visible(state)
      : ['feedback', 'users'].includes(id)
        ? DEMO || Boolean(authInfo.user?.manageUsers)
        : id === 'models'
          ? DEMO || Boolean(authInfo.user?.owner)
          : canManage || id === 'mcp',
  );
  const userName = authInfo.user?.name || 'Глеб';
  const signOut = async () => {
    setAccountOpen(false);
    setGlobalMessages([]);
    await api('/api/auth/sign-out', {});
    setApiWorkspace(null);
    setState((s) => ({ ...s, messages: [] }));
    setAuthInfo((info) => ({
      ...info,
      user: null,
      loading: false,
      setupRequired: false,
      error: undefined,
    }));
    navigate('login');
  };
  const workspaces = (authInfo.user?.workspaces || []).filter((w) => !w.emptyDefault);
  const currentProject = workspaces.find((w) => w.id === state.workspace?.id);
  const workspaceName =
    state.workspace?.name ||
    workspaces.find((w) => w.id === authInfo.user?.workspaceId)?.name ||
    'Команда';
  const switchWorkspace = async (id: string, navigate = true) => {
    if (switching.current) return;
    if (uploadingBatch.current) {
      notify('Дождитесь завершения загрузки перед сменой проекта.');
      return;
    }
    const previous = authInfo.user?.workspaceId;
    switching.current = true;
    setSwitchingProject(true);
    try {
      await pending.current;
      await redeemWorkspaceLink(id);
      setApiWorkspace(id);
      rememberWorkspace(id);
      setPanel(null);
      receive(await api('/api/state'));
      if (navigate) go('home');
    } catch (e) {
      setApiWorkspace(previous || null);
      rememberWorkspace(previous || null);
      notify('Не удалось открыть проект. Попробуйте ещё раз.');
      throw e;
    } finally {
      switching.current = false;
      setSwitchingProject(false);
    }
  };

  const collapsed = state.sidebarCollapsed && !mobile;
  const unseen = Boolean(newsId && seen !== newsId);
  const toggleSidebar = (event: React.MouseEvent) => {
    const el = main.current?.parentElement;
    const left = el?.getBoundingClientRect().left;
    sidebarShift.current?.animation?.cancel();
    sidebarShift.current =
      event.detail && left !== undefined && !matchMedia('(prefers-reduced-motion: reduce)').matches
        ? { left }
        : null;
    update({ sidebarCollapsed: !state.sidebarCollapsed });
  };
  useLayoutEffect(() => {
    const el = main.current?.parentElement,
      previous = sidebarShift.current;
    if (!el || !previous || mobile) return;
    const delta = previous.left - el.getBoundingClientRect().left;
    const css = getComputedStyle(el),
      timing = css.getPropertyValue('--mn-motion-fast').trim();
    previous.animation = el.animate(
      [{ transform: 'translateX(' + delta + 'px)' }, { transform: 'translateX(0)' }],
      {
        duration: parseFloat(timing) * (timing.endsWith('ms') ? 1 : 1000) || 160,
        easing: css.getPropertyValue('--mn-ease-out').trim() || 'cubic-bezier(0.23,1,0.32,1)',
      },
    );
    return () => previous.animation?.cancel();
  }, [collapsed, mobile]);

  useEffect(() => {
    if (mobileWeb || (!DEMO && (!authInfo.user || authInfo.loading)) || authInfo.error) return;
    const onKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.keyCode === 229 ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey
      )
        return;
      if (event.code !== 'KeyC' && event.code !== 'KeyT') return;
      if (!document.querySelector('.app-shell')) return;
      const target = event.target instanceof Element ? event.target : null;
      if (
        target?.closest(
          'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"]',
        ) ||
        document.querySelector('.g-modal_open,.g-popup_open') ||
        dialog ||
        projectAction ||
        settingsTab ||
        studyOpen ||
        menuOpen ||
        accountOpen ||
        feedbackOpen ||
        ideasOpen
      )
        return;
      event.preventDefault();
      if (event.code === 'KeyC') open({ type: 'workspace' });
      else chatHistory.newChat();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [
    mobileWeb,
    authInfo.user?.id,
    authInfo.loading,
    authInfo.error,
    dialog,
    projectAction,
    settingsTab,
    studyOpen,
    menuOpen,
    accountOpen,
    feedbackOpen,
    ideasOpen,
    route,
  ]);

  const brand = (
    <a className="brand" href={appHref('chat')} aria-label="Мнемодак, бета-версия — новый чат">
      <BrandMark />
      <span className="brand-text">
        <strong>Мнемодак</strong>
        <span className="brand-beta" title="Бета-версия">
          <BetaMark />
          <span className="sr-only">бета-версия</span>
        </span>
      </span>
      <span className="app-version">{APP_VERSION}</span>
    </a>
  );
  switchWorkspaceRef.current = switchWorkspace;
  const navContent = (
    <>
      <div className="sidebar-head">
        <div className="brand-lockup">
          <NavigationHint label="Мнемодак" enabled={collapsed}>
            {brand}
          </NavigationHint>
        </div>
        {mobile ? (
          <IconButton
            icon={X}
            label="Закрыть меню"
            className="mobile-close"
            onClick={() => setMenuOpen(false)}
          />
        ) : (
          <IconButton
            icon={collapsed ? PanelLeftOpen : PanelLeftClose}
            label={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
            aria-expanded={!collapsed}
            className="collapse-button"
            onClick={toggleSidebar}
          />
        )}
      </div>
      <nav className="project-navigation" aria-label="Основная навигация">
        {(
          [
            ['chat', 'Новый чат', Plus, 'T'],
            ['research', 'Проекты', Folder, 'C'],
            ['all-findings', 'Находки', Lightbulb],
          ] as [string, string, LucideIcon, string?][]
        ).map(([id, label, Icon, shortcut]) => (
          <NavigationHint
            key={id}
            label={id === 'research' ? 'Создать новый проект' : label}
            shortcut={shortcut}
            enabled={Boolean(shortcut) || collapsed}
          >
            <a
              className="nav-item"
              href={appHref('' + id)}
              aria-label={label}
              aria-description={
                !mobileWeb && id === 'research' ? 'C — создать новый проект' : undefined
              }
              aria-keyshortcuts={!mobileWeb && id === 'chat' ? 'T' : undefined}
              aria-current={
                id !== 'chat' &&
                (base === id ||
                  (id === 'research' && (base === 'projects' || !globalView)) ||
                  (id === 'all-findings' && globalFindingFlow))
                  ? 'page'
                  : undefined
              }
            >
              <Icon size={18} />
              <span>{label}</span>
              {shortcut && !mobileWeb ? (
                <Hotkey className="shortcut-hint" value={shortcut} aria-hidden="true" />
              ) : null}
            </a>
          </NavigationHint>
        ))}
        <div className="project-list-label">Чаты</div>
        <ChatHistoryScroll>
          {chatHistory.chats.map((chat) => (
            <div
              className={
                'recent-chat-row' + (chatHistory.activeId === chat.id ? ' is-selected' : '')
              }
              key={chat.id}
            >
              <NavigationHint label={chat.title} enabled={collapsed}>
                <a
                  className="nav-item"
                  href={appHref('conversation/' + chat.id)}
                  aria-label={chat.title}
                  aria-current={chatHistory.activeId === chat.id ? 'page' : undefined}
                >
                  <MessageSquare size={18} />
                  <span>{chat.title}</span>
                </a>
              </NavigationHint>
              <IconButton
                icon={Trash2}
                label={'Удалить чат: ' + chat.title}
                size="m"
                className="recent-chat-delete"
                disabled={globalTyping}
                onClick={() => open({ type: 'delete-chat', chat })}
              />
            </div>
          ))}
          {!chatHistory.chats.length && !collapsed ? (
            <p className="recent-chats-empty">Здесь появятся ваши беседы</p>
          ) : null}
        </ChatHistoryScroll>
      </nav>

      <div className="sidebar-bottom">
        {DEMO ? null : (
          <NavigationHint label="Оставить отзыв" enabled={collapsed}>
            <button
              type="button"
              className="nav-item"
              aria-label="Оставить отзыв"
              aria-pressed={feedbackOpen}
              data-feedback-ui
              onClick={(event) => {
                if (feedbackOpen) {
                  closeFeedback();
                  return;
                }
                feedbackTrigger.current = mobile ? menuTrigger.current : event.currentTarget;
                setMenuOpen(false);
                setFeedbackOpen(true);
              }}
            >
              <Megaphone size={20} />
              <span>Оставить отзыв</span>
            </button>
          </NavigationHint>
        )}
        {canUseSettings ? (
          <NavigationHint label="Настройки" enabled={collapsed}>
            <a
              ref={settingsTrigger}
              className="nav-item"
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                const rect = e.currentTarget.getBoundingClientRect();
                settingsOrigin.current =
                  e.detail > 0
                    ? {
                        x: rect.left + Math.min(rect.width / 2, 20) - innerWidth / 2,
                        y: rect.top + rect.height / 2 - innerHeight / 2,
                      }
                    : null;
              }}
              href={appHref(
                DEMO || authInfo.user?.owner ? 'models' : canManage ? 'integrations' : 'mcp',
              )}
              aria-label="Настройки"
              aria-haspopup="dialog"
              aria-current={settingsTab ? 'page' : undefined}
            >
              <Settings size={20} />
              <span>Настройки</span>
            </a>
          </NavigationHint>
        ) : null}
        <div className="account-wrap">
          <NavigationHint label={'Профиль: ' + userName} enabled={collapsed && !accountOpen}>
            <button
              type="button"
              ref={setAccountEl}
              className="account"
              aria-label={'Профиль: ' + userName}
              aria-haspopup="menu"
              aria-expanded={accountOpen}
              onClick={() => setAccountOpen((o) => !o)}
            >
              <Avatar imgUrl={authInfo.user?.image || undefined} text={userName[0]} size="m" />
              <div>
                <strong>{userName}</strong>
              </div>
              {unseen ? (
                <span className="account-dot" aria-label="Есть новое в интерфейсе" />
              ) : null}
            </button>
          </NavigationHint>
        </div>
      </div>
      <Popup
        open={accountOpen}
        onOpenChange={setAccountOpen}
        anchorElement={accountEl}
        placement={mobile ? ['top-start', 'top'] : ['right-end', 'top-start']}
        className="account-popup"
      >
        <div className="account-menu" role="menu" aria-label="Профиль">
          <div className="account-menu-row">
            <span>Тема</span>
            <SegmentedRadioGroup
              size="m"
              value={
                state.theme === 'system' || state.theme === 'light' || state.theme === 'dark'
                  ? state.theme
                  : 'light'
              }
              onUpdate={changeTheme}
              name="Тема интерфейса"
              options={[
                {
                  value: 'system',
                  content: (
                    <>
                      <Monitor size={14} />
                      <span className="sr-only">Как в системе</span>
                    </>
                  ),
                  title: 'Как в системе',
                },
                {
                  value: 'light',
                  content: (
                    <>
                      <Sun size={14} />
                      <span className="sr-only">Светлая</span>
                    </>
                  ),
                  title: 'Светлая',
                },
                {
                  value: 'dark',
                  content: (
                    <>
                      <Moon size={14} />
                      <span className="sr-only">Тёмная</span>
                    </>
                  ),
                  title: 'Тёмная',
                },
              ]}
            />
          </div>
          <div className="account-menu-row">
            <span>Звук уведомлений</span>
            <Switch
              checked={state.soundEnabled !== false}
              controlProps={{ 'aria-label': 'Звук уведомлений' }}
              onUpdate={(v) => update({ soundEnabled: v })}
            />
          </div>
          <div className="account-menu-sep" role="separator" />
          {authInfo.user?.manageUsers && !DEMO ? (
            <button
              type="button"
              role="menuitem"
              className="account-menu-item"
              onClick={() => {
                setAccountOpen(false);
                setTimeout(() => open({ type: 'invite' }), 0);
              }}
            >
              <UserPlus size={16} />
              Пригласить людей
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className="account-menu-item"
            onClick={() => {
              setAccountOpen(false);
              setMenuOpen(false);
              setTimeout(() => open({ type: 'whatsnew' }), 0);
            }}
          >
            <Newspaper size={16} aria-hidden="true" />
            Что нового{unseen ? <span className="account-dot inline" aria-hidden="true" /> : null}
          </button>
          {DEMO ? null : (
            <button
              type="button"
              role="menuitem"
              className="account-menu-item"
              onClick={() => {
                setAccountOpen(false);
                setMenuOpen(false);
                setIdeasOpen('all');
              }}
            >
              <Lightbulb size={16} />
              Идеи и отзывы
            </button>
          )}
          {DEMO ? null : (
            <>
              <div className="account-menu-sep" role="separator" />
              <button
                type="button"
                role="menuitem"
                className="account-menu-item danger"
                onClick={signOut}
              >
                <LogOut size={16} />
                Выйти
              </button>
            </>
          )}
        </div>
      </Popup>
    </>
  );
  if (authInfo.error)
    return (
      <ThemeProvider theme={effectiveTheme}>
        <main className="page">
          <Empty
            title={
              /доступ|ссылк/i.test(authInfo.error)
                ? 'Доступ к проекту закрыт'
                : 'Не удалось открыть страницу'
            }
            action={
              <Button
                view="action"
                href="/projects"
                onClick={(event) => {
                  event.preventDefault();
                  setApiWorkspace(null);
                  rememberWorkspace(null);
                  location.assign('/projects');
                }}
              >
                К проектам
              </Button>
            }
          >
            {authInfo.error}
          </Empty>
        </main>
      </ThemeProvider>
    );
  if (route === 'mcp-consent' && authInfo.user)
    return (
      <ThemeProvider theme={effectiveTheme}>
        <MCPConsent user={authInfo.user} />
      </ThemeProvider>
    );
  if (route.startsWith('file/') && authInfo.user)
    return (
      <ThemeProvider theme={effectiveTheme}>
        <Context.Provider value={context}>
          <FileWindow />
        </Context.Provider>
      </ThemeProvider>
    );
  return (
    <ThemeProvider theme={effectiveTheme}>
      <Context.Provider value={context}>
        {(!DEMO && !authInfo.user) || ['signup', 'login', 'reset'].includes(route.split('?')[0]) ? (
          authInfo.loading ? (
            <div className="auth-loading" role="status">
              <Loader size="m" />
              <span>Открываем Мнемодак…</span>
            </div>
          ) : route === 'reset' ? (
            <RegistrationPage
              key="reset"
              reset
              theme={effectiveTheme}
              onTheme={theme}
              onComplete={completeAuth}
            />
          ) : route.split('?')[0] === 'signup' &&
            authInfo.registrationEnabled &&
            !new URLSearchParams(location.search).has('invite') ? (
            <RegistrationPage theme={effectiveTheme} onTheme={theme} onComplete={completeAuth} />
          ) : (
            <AuthPage
              key={route}
              registrationEnabled={authInfo.registrationEnabled}
              theme={effectiveTheme}
              login={route.split('?')[0] !== 'signup'}
              onTheme={theme}
              setupRequired={authInfo.setupRequired}
              setupEnabled={authInfo.setupEnabled}
              onComplete={completeAuth}
            />
          )
        ) : (
          <>
            <a className="skip-link" href="#main">
              К содержимому
            </a>
            <div
              className={
                'app-shell' +
                (collapsed ? ' rail-collapsed' : '') +
                (shownPanel && !panelClosing ? ' has-source-panel' : '') +
                (feedbackOpen ? ' feedback-active' : '')
              }
              data-feedback-path={routeHref(route, authInfo.user?.workspaceId).split('?')[0]}
            >
              {feedbackOpen ? (
                <FeedbackMode
                  route={route}
                  onClose={closeFeedback}
                  onIdeas={() => {
                    setFeedbackOpen(false);
                    setIdeasOpen('mine');
                  }}
                />
              ) : null}
              {!mobile ? <aside className="sidebar">{navContent}</aside> : null}
              <div className="content-shell">
                <header
                  className="topbar"
                  aria-hidden={
                    !mobile && (rootCatalog || (conversationView && !chatHistory.activeTitle))
                      ? true
                      : undefined
                  }
                >
                  {mobile ? (
                    <IconButton
                      ref={menuTrigger}
                      icon={Menu}
                      label="Открыть меню"
                      aria-expanded={menuOpen}
                      onClick={() => setMenuOpen(true)}
                    />
                  ) : null}
                  {rootCatalog ? null : findingsView ? (
                    <FindingsBreadcrumbs
                      project={globalFindingFlow ? undefined : workspaceName}
                      finding={breadcrumbFinding}
                    />
                  ) : globalView ? (
                    chatHistory.activeTitle ? (
                      <div className="hub-topbar-title">{chatHistory.activeTitle}</div>
                    ) : null
                  ) : (
                    <ProjectBreadcrumbs project={workspaceName} />
                  )}
                  {!globalView && state.workspace ? (
                    <div className="topbar-actions">
                      <ProjectShareButton
                        mode={state.workspace.sharingMode}
                        canManage={Boolean(state.workspace.canManageSharing)}
                        url={
                          location.origin +
                          routeHref('home', state.workspace.id) +
                          (state.workspace.sharingMode === 'link' &&
                          new URLSearchParams(location.search).get('share')
                            ? '?share=' +
                              encodeURIComponent(
                                new URLSearchParams(location.search).get('share') ?? '',
                              )
                            : '')
                        }
                        notify={notify}
                        onOpen={() =>
                          setSharedProject({ id: state.workspace.id, name: workspaceName })
                        }
                      />
                      {currentProject ? (
                        <ProjectMenu project={currentProject} onAction={context.projectAction} />
                      ) : null}
                    </div>
                  ) : null}
                </header>
                <Context.Provider value={studyOpen ? { ...context, route: contentRoute } : context}>
                  <main
                    id="main"
                    ref={main}
                    tabIndex={-1}
                    className={
                      'page ' +
                      (base === 'chat' || contentRoute.startsWith('conversation/')
                        ? 'research-chat-page'
                        : '')
                    }
                  >
                    {switchingProject && !globalView ? (
                      <div className="project-loading" role="status">
                        Открываем проект…
                      </div>
                    ) : base === 'chat' || contentRoute.startsWith('conversation/') ? (
                      <GlobalChat key={chatHistory.activeId || 'new'} />
                    ) : base === 'research' || base === 'projects' ? (
                      <ResearchCatalog key="materials" />
                    ) : base === 'all-findings' ? (
                      <ResearchCatalog key="findings" findings />
                    ) : !DEMO && authInfo.user && !authInfo.user.workspaceId ? null : view ===
                      'home' ? (
                      <Home />
                    ) : view === 'library' ? (
                      <LibraryPage />
                    ) : view === 'findings' ? (
                      <Findings key={(state.workspace?.id || '') + ':' + contentRoute} />
                    ) : contentRoute.startsWith('finding/') ? (
                      <FindingPage key={contentRoute} />
                    ) : base === 'chat' ? (
                      <Home />
                    ) : !DEMO && authInfo.user && !authInfo.user.workspaceId ? (
                      <Empty
                        title="Создайте первый проект"
                        action={
                          <Button
                            view="action"
                            size="l"
                            onClick={() => open({ type: 'workspace' })}
                          >
                            <Plus size={16} />
                            Создать проект
                          </Button>
                        }
                      >
                        Создайте папку для материалов по одной теме, затем добавьте файлы.
                      </Empty>
                    ) : (
                      <StudyScreen key={pageRoute} />
                    )}
                    {!globalView && !DEMO && authInfo.user && !authInfo.user.workspaceId ? (
                      <Empty
                        title="Создайте первый проект"
                        action={
                          <Button
                            view="action"
                            size="l"
                            onClick={() => open({ type: 'workspace' })}
                          >
                            <Plus size={16} />
                            Создать проект
                          </Button>
                        }
                      >
                        Создайте папку для материалов по одной теме, затем добавьте файлы.
                      </Empty>
                    ) : null}
                  </main>
                </Context.Provider>
              </div>
              {studyOpen ? <StudyModal back={returnRoute} animateEntry={animateStudy} /> : null}
              {settingsTab ? (
                <SettingsModal
                  tab={settingsTab}
                  tabs={visibleManagement}
                  ctx={context}
                  origin={settingsOrigin.current}
                  returnFocus={mobile ? menuTrigger : settingsTrigger}
                />
              ) : null}
              <SourcePanel
                key={shownPanel ? shownPanel.studyId + ':' + shownPanel.segmentId : 'none'}
              />
              {DEMO ? null : (
                <>
                  <IdeasPanel
                    open={Boolean(ideasOpen)}
                    mine={ideasOpen === 'mine'}
                    onLocate={locateFeedback}
                    onClose={() => {
                      setIdeasOpen(null);
                      if (location.hash === '#ideas')
                        history.replaceState(
                          history.state,
                          '',
                          location.pathname + location.search,
                        );
                    }}
                  />
                </>
              )}
            </div>
            <Modal
              open={mobile && menuOpen}
              onOpenChange={setMenuOpen}
              returnFocus={feedbackOpen ? false : menuTrigger}
              onTransitionOutComplete={() => {
                if (!feedbackOpen && !document.querySelector('.g-modal_open'))
                  menuTrigger.current?.focus();
              }}
              aria-label="Основная навигация"
              className="mobile-nav-modal"
              contentClassName="mobile-nav-sheet"
            >
              <div className="mobile-nav">{navContent}</div>
            </Modal>
            {authInfo.user?.id && (
              <WelcomeDialog
                key={authInfo.user.id}
                pending={Boolean(authInfo.user.welcomePending && !studyOpen && !settingsTab)}
                returnFocus={main}
                onExplore={() => go('research')}
              />
            )}
          </>
        )}
        {!DEMO && authInfo.user?.workspaceId && authInfo.user.role === 'full' && (
          <BatchUpload
            key={authInfo.user.id + ':' + authInfo.user.workspaceId}
            studies={state.studies}
            files={dialog?.type === 'upload' ? dialog.files : undefined}
            workspace={authInfo.user.workspaceId}
            open={dialog?.type === 'upload'}
            close={() => open(null)}
            model={state.models.find((m) => m.id === state.modelId)?.name || 'проекта'}
            receive={receive}
            openStudy={(id) => go('study/' + id)}
            busy={uploadingBatch}
          />
        )}
        <ProjectImporter
          open={dialog?.type === 'import'}
          onClose={() => {
            setApiWorkspace(authInfo.user?.workspaceId || null);
            open(null);
          }}
          onComplete={async (id) => {
            await switchWorkspace(id);
          }}
        />
        {sharedProject ? (
          <ProjectSharingDialog
            key={sharedProject.id}
            id={sharedProject.id}
            open
            onClose={() => setSharedProject(null)}
            onChanged={refresh}
          />
        ) : null}
        {projectAction && (
          <ProjectDialog
            returnFocus={mobile ? main : undefined}
            key={projectAction.project.id + projectAction.action}
            {...projectAction}
            notify={notify}
            onClose={() => setProjectAction(null)}
            onChanged={async (id, deleted) => {
              await pending.current;
              if (deleted) {
                setGlobalMessages([]);
                chatHistory.refresh().catch(() => {});
                if (authInfo.user?.workspaceId === id) {
                  setApiWorkspace(null);
                  rememberWorkspace(null);
                  setState((s) => ({ ...s, messages: [] }));
                  go('projects');
                }
              }
              await refresh();
            }}
          />
        )}
        {dialog?.type === 'delete-chat' ? (
          <Dialog open onClose={() => open(null)} aria-label="Удалить чат" hasCloseButton>
            <Dialog.Header caption="Удалить чат?" />
            <Dialog.Body>
              <p>
                Переписка «{dialog.chat.title}» будет удалена. Исследования и находки сохранятся.
              </p>
            </Dialog.Body>
            <Dialog.Footer
              onClickButtonCancel={() => open(null)}
              textButtonCancel="Отмена"
              textButtonApply="Удалить чат"
              propsButtonApply={{ view: 'outlined-danger' }}
              onClickButtonApply={async () => {
                await chatHistory.remove(dialog.chat.id);
                open(null);
              }}
            />
          </Dialog>
        ) : (
          <AppDialog key={dialog?.key || dialog?.type || 'closed'} />
        )}
        <div className={'toast ' + (toast ? 'shown' : '')} role="status">
          {toast}
        </div>
      </Context.Provider>
    </ThemeProvider>
  );
}

export { Context } from './app-context.ts';
export { NavigationHint } from './shared/NavigationHint.tsx';
export { FindingCard, Findings } from './screens/Findings.tsx';
export { GlobalChat } from './screens/GlobalChat.tsx';
