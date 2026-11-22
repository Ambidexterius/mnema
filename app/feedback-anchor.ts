import {
  feedbackElements,
  feedbackPages,
  isFeedbackPath,
  type FeedbackContext,
} from './feedback-context.ts';

const control = 'button,[role="button"],a[href],[role="tab"],select,input,textarea';
const staticControls = {
  'create-project': ['Создать', '.projects-heading'],
  'create-first-project': ['Создать', '#main .empty'],
  'add-file': ['Добавить файл', '.overview-materials'],
  upload: ['Выбрать файлы', '.overview-materials'],
  'all-materials': ['Все материалы', '.overview-materials'],
  'all-findings': ['Все находки', '#main'],
  'project-summary': ['Создать сводку', '.overview-summary'],
  'refresh-summary': ['Обновить сводку', '.overview-summary'],
  'back-to-projects': ['Назад к проектам', '#main'],
  'back-to-findings': ['Назад к находкам', '#main'],
  'search-projects': ['Поиск по проектам', '#main'],
  'nav-projects': ['Проекты', '.sidebar'],
  'nav-chat': ['Новый чат', '.sidebar'],
  'nav-findings': ['Находки', '.sidebar'],
  'nav-settings': ['Настройки', '.sidebar'],
  'tab-overview': ['Обзор', '.project-tabs'],
  'tab-findings': ['Находки', '.project-tabs'],
  'tab-materials': ['Материалы', '.project-tabs'],
  'tab-documents': ['Документы', '.project-tabs'],
} as const;

const roots = {
  study: '.study-sheet',
  source: '.source-panel',
  main: '#main',
  topbar: '.topbar',
  sidebar: '.sidebar',
} as const;

function normalize(text: string | null | undefined) {
  return (text || '').replace(/\s+/gu, ' ').trim();
}

function visible(node: HTMLElement) {
  return (
    node.getClientRects().length > 0 &&
    !node.closest('[inert],[aria-hidden="true"]') &&
    getComputedStyle(node).visibility === 'visible'
  );
}

function staticMatches(shell: HTMLElement, key: keyof typeof staticControls) {
  const [label, selector] = staticControls[key];
  return Array.from(shell.querySelectorAll<HTMLElement>(selector))
    .flatMap((root) => Array.from(root.querySelectorAll<HTMLElement>(control)))
    .filter(
      (node) =>
        visible(node) &&
        (normalize(node.getAttribute('aria-label')) === label ||
          normalize(node.textContent) === label),
    );
}

export function namedFeedbackAnchor(
  origin: Element,
  shell = origin.closest<HTMLElement>('.app-shell'),
) {
  const node = origin.closest<HTMLElement>(control);
  if (!shell || !node || !visible(node)) return;
  for (const [key, [label, scope]] of Object.entries(staticControls)) {
    if (
      !node.closest(scope) ||
      (normalize(node.getAttribute('aria-label')) !== label &&
        normalize(node.textContent) !== label)
    )
      continue;
    const matches = staticMatches(shell, key as keyof typeof staticControls);
    if (matches.length !== 1 || matches[0] !== node) continue;
    const element = node.matches('a')
      ? 'link'
      : node.matches('[role="tab"]')
        ? 'tabs'
        : node.matches('select,input,textarea')
          ? 'field'
          : 'button';
    return { node, anchor: 'ui-' + key, label, element } as const;
  }
}

function localLink(node: HTMLElement) {
  const href =
    node.closest('a[href]')?.getAttribute('href') ??
    node.querySelector('a[href]')?.getAttribute('href');
  if (!href) return '';
  try {
    const url = new URL(href, location.href);
    return url.origin === location.origin ? url.pathname : '';
  } catch {
    return '';
  }
}

function fingerprint(node: HTMLElement) {
  const container = node.closest('tr,[role="row"],li,.project-catalog-card,.project-card');
  return JSON.stringify([
    node.localName,
    node.getAttribute('role'),
    node.getAttribute('aria-label'),
    node.getAttribute('name'),
    node.getAttribute('type'),
    localLink(node),
    node.matches('input,textarea,[contenteditable]') ? '' : normalize(node.textContent),
    container && container !== node ? normalize(container.textContent) : '',
  ]);
}

async function digest(value: string) {
  if (!globalThis.crypto?.subtle) return '';
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  );
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function unique(root: HTMLElement, node: HTMLElement, value: string) {
  return (
    fingerprint(node) === value &&
    [root, ...root.getElementsByTagName(node.localName)].filter(
      (candidate) =>
        candidate instanceof HTMLElement &&
        candidate.localName === node.localName &&
        fingerprint(candidate) === value &&
        visible(candidate),
    ).length === 1
  );
}

export async function captureFeedbackAnchor(node: HTMLElement) {
  const named = namedFeedbackAnchor(node);
  if (named?.node === node) return { anchor: named.anchor, label: named.label };
  const scope = Object.entries(roots).find(([, selector]) => node.closest(selector));
  if (!scope || !node.isConnected) return { anchor: 'unavailable' };
  const [key, selector] = scope,
    root = node.closest<HTMLElement>(selector)!;
  const value = fingerprint(node),
    steps: string[] = [];
  for (let child = node; child !== root && child.parentElement; child = child.parentElement) {
    steps.unshift(
      child.localName + '-' + Array.prototype.indexOf.call(child.parentElement.children, child),
    );
  }
  const hash = await digest(value);
  const anchor = ['dom-' + key, ...steps, hash].join('_');
  return {
    anchor: hash && anchor.length <= 512 && unique(root, node, value) ? anchor : 'unavailable',
  };
}

export async function resolveFeedbackAnchor(anchor: string, shell: HTMLElement) {
  if (anchor.startsWith('ui-')) {
    const key = anchor.slice(3) as keyof typeof staticControls;
    if (!Object.hasOwn(staticControls, key)) return;
    const matches = staticMatches(shell, key);
    return matches.length === 1 ? matches[0] : undefined;
  }
  const [scope, ...steps] = anchor.split('_');
  const key = scope.slice(4) as keyof typeof roots,
    hash = steps.pop();
  if (
    !scope.startsWith('dom-') ||
    !Object.hasOwn(roots, key) ||
    !hash ||
    !/^[a-f0-9]{64}$/.test(hash)
  )
    return;
  const root = shell.querySelector<HTMLElement>(roots[key]);
  if (!root) return;
  let node = root;
  for (const step of steps) {
    const match = /^([a-z][a-z0-9-]*)-(\d+)$/.exec(step);
    if (!match) return;
    const child = node.children[Number(match[2])];
    if (!(child instanceof HTMLElement) || child.localName !== match[1]) return;
    node = child;
  }
  if (!visible(node)) return;
  const value = fingerprint(node);
  if ((await digest(value)) === hash && unique(root, node, value)) return node;
}

export function feedbackAnchorCaption(feedback: FeedbackContext) {
  return (
    feedbackPages[feedback.page] +
    ' → ' +
    (feedback.location?.label || feedbackElements[feedback.element])
  );
}

export async function revealFeedbackLocation(feedback: FeedbackContext, signal: AbortSignal) {
  const where = feedback.location;
  if (!where || !isFeedbackPath(where.path)) return false;
  let readyAt: number | undefined;
  const deadline = performance.now() + 6000;
  while (!signal.aborted && performance.now() < deadline) {
    const shell = document.querySelector<HTMLElement>('.app-shell[data-feedback-path]');
    if (
      shell?.dataset.feedbackPath === where.path &&
      location.pathname === where.path &&
      !document.querySelector('.project-loading,.ideas-modal.g-modal_open')
    ) {
      readyAt ??= performance.now();
      const anchor = where.anchor ? await resolveFeedbackAnchor(where.anchor, shell) : undefined;
      if (signal.aborted) return false;
      if (anchor?.isConnected && location.pathname === where.path && visible(anchor)) {
        anchor.scrollIntoView({ block: 'center', inline: 'nearest' });
        const temporaryFocus = !anchor.matches(
          'a[href],button,input,select,textarea,[contenteditable],[tabindex]',
        );
        if (temporaryFocus) anchor.setAttribute('tabindex', '-1');
        if (!anchor.matches('input,textarea,[contenteditable]'))
          anchor.focus({ preventScroll: true });
        anchor.setAttribute('data-feedback-located', '');
        const clear = () => {
          anchor.removeAttribute('data-feedback-located');
          if (temporaryFocus && anchor.getAttribute('tabindex') === '-1')
            anchor.removeAttribute('tabindex');
        };
        signal.addEventListener('abort', clear, { once: true });
        window.setTimeout(() => {
          signal.removeEventListener('abort', clear);
          clear();
        }, 4500);
        return true;
      }
      if (!where.anchor && feedback.element === 'page') {
        const sheet = shell.querySelector<HTMLElement>('.study-sheet');
        (
          sheet?.querySelector<HTMLElement>('.study-sheet-body') ||
          shell.querySelector('.content-shell')
        )?.scrollTo({ top: 0 });
        (sheet || shell.querySelector<HTMLElement>('#main'))?.focus({ preventScroll: true });
        return true;
      }
      if (performance.now() - readyAt > 1400 || where.anchor === 'unavailable') return false;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 80));
  }
  return false;
}
