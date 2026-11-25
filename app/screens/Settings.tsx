import { useCompactLayout } from '../useCompactLayout.ts';
import { appHref, navigate } from '../routes.ts';
import EmptyState from '../EmptyState.tsx';
import StorageStatus from '../StorageStatus.tsx';
import MCPSettings from '../MCPSettings.tsx';
import { settingsExtensions } from '../extension.tsx';
import IntegrationsPage from '../IntegrationsPage.tsx';
import AnswerFeedbackPage from '../AnswerFeedbackPage.tsx';
import { api } from '../api.ts';
import { useApp } from '../app-context.ts';
import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Avatar,
  Button,
  Dialog,
  DropdownMenu,
  Label,
  Select,
  Switch,
  Table,
} from '@gravity-ui/uikit';
import {
  BrainCircuit,
  FileText,
  Cable,
  Mic,
  MoreHorizontal,
  Plug,
  Plus,
  ThumbsUp,
  Users,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ModelConnection, WorkspaceUser } from '../types.ts';
import { DEMO } from '../state/constants.ts';
import { settingsBackdrop } from '../state/overlay-routes.ts';
import { stamp } from '../shared/format.ts';
import { IconButton } from '../shared/ui.tsx';

export const extraSettings = new Map(settingsExtensions.map((section) => [section.id, section]));

export const management: [string, string, LucideIcon][] = [
  ['models', 'Модели', BrainCircuit],
  ['integrations', 'Интеграции', Plug],
  ['mcp', 'MCP', Cable],
  ...settingsExtensions.map(({ id, label, Icon }): [string, string, LucideIcon] => [
    id,
    label,
    Icon,
  ]),
  ['feedback', 'Оценки ответов', ThumbsUp],
  ['users', 'Пользователи', Users],
];

export function SettingsModal({
  tab,
  tabs,
  ctx,
  origin,
  returnFocus,
}: {
  tab: string;
  tabs: [string, string, LucideIcon][];
  ctx: any;
  origin: { x: number; y: number } | null;
  returnFocus: React.RefObject<HTMLElement | null>;
}) {
  const [open, setOpen] = useState(true),
    [animate, setAnimate] = useState(Boolean(origin));
  const [scrolled, setScrolled] = useState(false);
  const body = useRef<HTMLDivElement>(null),
    nav = useRef<HTMLElement>(null);
  const shown = tabs.some(([id]) => id === tab) ? tab : tabs[0][0];
  useEffect(() => {
    if (!matchMedia('(max-width:639px)').matches) return;
    const frame = requestAnimationFrame(() => {
      const menu = nav.current,
        active = menu?.querySelector('[aria-current="page"]');
      if (menu && active) {
        const { left, right } = active.getBoundingClientRect(),
          bounds = menu.getBoundingClientRect();
        if (left < bounds.left || right > bounds.right) menu.scrollLeft += left - bounds.left - 16;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [shown]);
  useEffect(() => {
    if (shown !== tab) navigate(shown, true);
  }, [shown, tab]);
  // Leave after the close animation: back to the page under the modal, or to it directly from a deep link.
  const leave = () => {
    if (history.state?.app) history.back();
    else navigate(settingsBackdrop.current, true);
  };
  const close = (keyboard = false) => {
    if (keyboard) setAnimate(false);
    setOpen(false);
  };
  const style = origin
    ? ({
        '--settings-origin-x': origin.x + 'px',
        '--settings-origin-y': origin.y + 'px',
      } as React.CSSProperties)
    : undefined;
  return (
    <Modal
      open={open}
      onOpenChange={(next, event, reason) => {
        if (!next) close(reason === 'escape-key' || event instanceof KeyboardEvent);
      }}
      onTransitionOutComplete={leave}
      returnFocus={returnFocus}
      disableHeightTransition
      className={'settings-modal' + (animate ? ' settings-modal_anchored' : '')}
      style={style}
      contentClassName="settings-sheet"
      aria-labelledby="settings-title"
    >
      <nav ref={nav} className="settings-nav" aria-labelledby="settings-title">
        <div className="settings-nav-label" id="settings-title">
          Настройки
        </div>
        {tabs.map(([id, label, Icon]) => (
          <a
            key={id}
            href={appHref(id)}
            className="settings-nav-item"
            aria-label={label}
            aria-current={id === shown ? 'page' : undefined}
            onClick={(e) => {
              e.preventDefault();
              body.current?.scrollTo(0, 0);
              setScrolled(false);
              navigate(id, true);
            }}
          >
            <Icon size={18} aria-hidden="true" />
            <span>{label}</span>
          </a>
        ))}
      </nav>
      <div className="settings-main">
        {/* Title and close stay pinned; only the section below scrolls. */}
        <header className="settings-header" data-scrolled={scrolled || undefined}>
          <h2>
            {tabs.find(([id]) => id === shown)?.[1]}
            {shown === 'users' ? (
              <span className="heading-count" role="status">
                {ctx.state.users.length}
              </span>
            ) : null}
          </h2>
          <IconButton
            icon={X}
            label="Закрыть настройки"
            className="settings-close"
            onClick={(e) => close(e.detail === 0)}
          />
        </header>
        <div
          className="settings-body"
          ref={body}
          onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 0)}
        >
          <div className="settings-pane" key={shown}>
            {shown === 'models' ? (
              <Models />
            ) : shown === 'integrations' ? (
              <IntegrationsPage />
            ) : extraSettings.has(shown) ? (
              extraSettings.get(shown)!.render(ctx)
            ) : shown === 'users' ? (
              <UsersPage />
            ) : shown === 'feedback' ? (
              <AnswerFeedbackPage real={ctx.real} />
            ) : (
              <MCPSettings ctx={ctx} />
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Models() {
  const { state, update, open, notify, user, real } = useApp();
  const [checks, setChecks] = useState<Record<string, string>>({});
  const [removing, setRemoving] = useState<any>(null);
  const check = async (m: ModelConnection) => {
    setChecks((s) => ({ ...s, [m.id]: 'Проверяем подключение…' }));
    try {
      const r = await api('/api/models/' + m.id + '/test', {});
      setChecks((s) => ({
        ...s,
        [m.id]:
          'Подключено: ' +
          r.model +
          ' · ' +
          r.seconds +
          ' с · ' +
          (r.usage?.total_tokens || '?') +
          ' токенов',
      }));
    } catch (e) {
      setChecks((s) => ({ ...s, [m.id]: e.message }));
    }
  };
  const toggle = (m: ModelConnection, v: boolean) => {
    if (!v && state.models.filter((x) => x.enabled).length === 1) {
      notify('Оставьте включённой хотя бы одну модель.');
      return;
    }
    update((s) => ({
      models: s.models.map((x) => (x.id === m.id ? { ...x, enabled: v } : x)),
      modelId:
        !v && s.modelId === m.id
          ? (s.models.find((x) => x.id !== m.id && x.enabled)?.id ?? s.modelId)
          : s.modelId,
    }));
  };
  return (
    <>
      {state.models.length ? (
        <>
          <div className="settings-list">
            <div className="setting-row">
              <div className="setting-main">
                <h3>Модель по умолчанию</h3>
                <p>Отвечает в чатах и готовит сводки во всех проектах</p>
              </div>
              <Select
                aria-label="Модель по умолчанию"
                value={[state.modelId]}
                options={state.models
                  .filter((m) => m.enabled)
                  .map((m) => ({ value: m.id, content: m.name }))}
                onUpdate={(v) => update({ modelId: v[0] })}
              />
            </div>
          </div>
          <h2 className="settings-group-label">Подключения</h2>
        </>
      ) : (
        <EmptyState
          icon={<BrainCircuit size={28} />}
          title="Моделей пока нет"
          description="Добавьте модель, чтобы задавать вопросы и создавать сводки."
        />
      )}
      <ul className="settings-list" aria-label="Подключённые модели">
        {state.models.map((m) => {
          const ready = Boolean(m.keyConfigured && m.model);
          return (
            <li className="setting-row" key={m.id}>
              <div
                className="setting-icon"
                data-status={!m.enabled ? 'off' : ready ? 'on' : 'warn'}
                aria-hidden="true"
              >
                <BrainCircuit size={16} />
              </div>
              <div className="setting-main">
                <h3>
                  {m.name}
                  {m.id === state.modelId ? (
                    <span className="setting-meta">По умолчанию</span>
                  ) : null}
                  {m.reserve ? <span className="setting-meta">Резервная</span> : null}
                </h3>
                <p aria-live="polite">
                  {checks[m.id] ||
                    (ready
                      ? m.provider + ' · ' + m.model
                      : 'Нужен API-ключ — откройте «Настроить»')}
                </p>
              </div>
              <div className="setting-actions">
                <Switch
                  checked={m.enabled}
                  controlProps={{ 'aria-label': (m.enabled ? 'Выключить ' : 'Включить ') + m.name }}
                  onUpdate={(v) => toggle(m, v)}
                />
                <DropdownMenu
                  popupProps={{ placement: ['bottom-end', 'top-end'] }}
                  renderSwitcher={(props) => (
                    <Button {...props} view="flat" size="m" aria-label={'Действия: ' + m.name}>
                      <MoreHorizontal size={16} aria-hidden="true" />
                    </Button>
                  )}
                  items={[
                    {
                      text: 'Проверить подключение',
                      action: () => check(m),
                      disabled: !ready || checks[m.id] === 'Проверяем подключение…',
                    },
                    { text: 'Настроить', action: () => open({ type: 'model', id: m.id }) },
                    ...(m.builtin && ready
                      ? []
                      : [
                          {
                            text: 'Удалить',
                            theme: 'danger' as const,
                            action: () => setRemoving(m),
                          },
                        ]),
                  ]}
                />
              </div>
            </li>
          );
        })}
        <li className="setting-row setting-add-row">
          <button type="button" className="setting-add" onClick={() => open({ type: 'model' })}>
            <span className="setting-icon" aria-hidden="true">
              <Plus size={16} />
            </span>
            <span className="setting-main">
              <strong>Добавить модель</strong>
              <span>OpenAI, Anthropic или совместимый API</span>
            </span>
          </button>
        </li>
      </ul>
      <Processors />
      <StorageStatus enabled={real && Boolean(user?.owner)} />
      <Dialog open={Boolean(removing)} onClose={() => setRemoving(null)} size="s">
        <Dialog.Header caption="Удалить подключение?" />
        <Dialog.Body>
          <p className="dialog-copy">
            «{removing?.name}» исчезнет из списка моделей.{' '}
            {removing?.hasStoredKey
              ? 'Сохранённый API-ключ будет удалён с сервера.'
              : 'Ключ из настроек сервера останется.'}{' '}
            Ответы, уже полученные с этой моделью, останутся в чатах.
          </p>
        </Dialog.Body>
        <Dialog.Footer
          onClickButtonCancel={() => setRemoving(null)}
          textButtonCancel="Отмена"
          textButtonApply="Удалить"
          propsButtonApply={{ view: 'outlined-danger' }}
          onClickButtonApply={async () => {
            const id = removing.id;
            if (
              !(await update((s) => {
                const models = s.models.filter((x) => x.id !== id);
                return {
                  models,
                  modelId: s.modelId === id ? models.find((x) => x.enabled)?.id || '' : s.modelId,
                };
              }))
            )
              return;
            notify('Подключение удалено.');
            setRemoving(null);
          }}
        />
      </Dialog>
    </>
  );
}

function Processors() {
  const { state } = useApp();
  return (
    <section aria-labelledby="processors-title">
      <h2 className="settings-group-label" id="processors-title">
        Обработчики
      </h2>
      <div className="settings-list" role="list">
        {state.processors.map((p) => {
          const Icon =
            p.id === 'speakers' || p.id === 'diarization'
              ? Users
              : p.id === 'tesseract' || p.id === 'frames'
                ? FileText
                : Mic;
          return (
            <div className="setting-row processor-row" role="listitem" key={p.id}>
              <div
                className="setting-icon"
                data-status={p.configured ? 'on' : 'off'}
                aria-hidden="true"
              >
                <Icon size={16} />
              </div>
              <div className="setting-main">
                <h3>{p.name}</h3>
                <p>{p.description}</p>
              </div>
              <Label size="s" theme={p.configured ? 'success' : 'normal'}>
                {p.configured ? 'Подключён' : 'Не подключён'}
              </Label>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function UserStatus({ user }: { user: WorkspaceUser }) {
  const labels = {
    active: 'Активен',
    invited: 'Ожидает регистрации',
    expired: 'Срок истёк',
    revoked: 'Доступ отозван',
  };
  return (
    <div className="user-status">
      {user.admin || user.owner ? <Label size="xs">Администратор</Label> : null}
      <Label
        size="xs"
        theme={
          user.status === 'active'
            ? 'success'
            : user.status === 'expired' || user.status === 'revoked'
              ? 'warning'
              : 'info'
        }
      >
        {labels[user.status]}
      </Label>
      {user.expires && ['invited', 'expired'].includes(user.status) ? (
        <small>
          {user.status === 'expired' ? 'Истёк ' : 'До '}
          {stamp(user.expires)}
        </small>
      ) : null}
    </div>
  );
}

type UserAction = 'grant-admin' | 'remove-admin' | 'revoke' | 'restore' | 'delete';

function UsersPage() {
  const { state, update, removeUser, open, notify, user, projectName } = useApp();
  const compact = useCompactLayout('(max-width: 850px)');
  const addButton = useRef<HTMLButtonElement>(null),
    actionTrigger = useRef<HTMLElement | null>(null);
  const [action, setAction] = useState<{ mode: UserAction; target: WorkspaceUser } | null>(null);
  const [actionOpen, setActionOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const canEdit = (u: WorkspaceUser) =>
    u.id !== user?.id &&
    !u.admin &&
    !u.owner &&
    u.status !== 'revoked' &&
    (u.scope === 'all' ? user?.manageUsers || DEMO : !u.projectIds || u.projectIds.length <= 1);
  const scope = (u: WorkspaceUser) =>
    u.scope === 'all' ? 'Общие проекты' : u.projectNames?.join(', ') || projectName;
  const role = (u: WorkspaceUser) =>
    canEdit(u) ? (
      <Select
        value={[u.role]}
        options={[
          { value: 'view', content: 'Просмотр' },
          { value: 'full', content: 'Полный доступ' },
        ]}
        aria-label={'Доступ: ' + u.name}
        onUpdate={(v) => {
          update((s) => ({
            users: s.users.map((x) => (x.id === u.id ? { ...x, role: v[0] } : x)),
          }));
          if (DEMO) notify('Уровень доступа изменён в прототипе.');
        }}
      />
    ) : (
      <span className="muted">{u.role === 'full' ? 'Полный доступ' : 'Просмотр'}</span>
    );
  const inviteAgain = (u: WorkspaceUser) =>
    open({
      type: 'invite',
      initial: {
        name: u.name,
        email: u.email,
        role: u.role,
        workspace: u.scope === 'all' ? 'all' : u.projectIds?.[0] || user?.workspaceId,
      },
    });
  const start = (mode: UserAction, target: WorkspaceUser) => {
    actionTrigger.current = document.getElementById('user-actions-' + target.id);
    setError('');
    setAction({ mode, target });
    setActionOpen(true);
  };
  const target = action?.target;
  const copy =
    action && target
      ? (
          {
            'grant-admin': {
              title: 'Назначить администратором?',
              apply: 'Назначить',
              view: 'action',
              consequence:
                'Пользователь сможет назначать администраторов, отзывать доступ и удалять пользователей.' +
                (target.scope === 'project'
                  ? ' Получит «Полный доступ» к общим проектам.'
                  : target.role === 'view'
                    ? ' Уровень доступа изменится на «Полный доступ».'
                    : ''),
              success: 'Администратор назначен',
            },
            'remove-admin': {
              title: 'Снять права администратора?',
              apply: 'Снять права',
              view: 'outlined',
              consequence: 'У пользователя сохранится «Полный доступ» к общим проектам.',
              success: 'Права администратора сняты',
            },
            revoke: {
              title: target.expires ? 'Отозвать приглашение?' : 'Отозвать доступ?',
              apply: 'Отозвать',
              view: 'outlined-danger',
              consequence: target.expires
                ? 'По этой ссылке больше нельзя будет зарегистрироваться.'
                : 'Пользователь потеряет доступ к Мнемодаку, в том числе в открытых сессиях. Доступ можно восстановить здесь.',
              success: target.expires ? 'Приглашение отозвано' : 'Доступ отозван',
            },
            restore: {
              title: 'Восстановить доступ?',
              apply: 'Восстановить',
              view: 'action',
              consequence: target.expires
                ? 'Ссылка снова будет действовать до конца срока.'
                : 'Пользователь снова сможет войти в Мнемодак.',
              success: 'Доступ восстановлен',
            },
            delete: {
              title: target.expires ? 'Удалить приглашение?' : 'Удалить пользователя?',
              apply: 'Удалить',
              view: 'outlined-danger',
              consequence: target.expires
                ? 'Ссылка перестанет работать.'
                : 'Аккаунт и личные чаты удалятся. Материалы и находки останутся в проектах.',
              success: target.expires ? 'Приглашение удалено' : 'Пользователь удалён',
            },
          } as const
        )[action.mode]
      : null;
  const confirm = async () => {
    if (!action || !copy || busy) return;
    const { mode, target } = action;
    setBusy(true);
    setError('');
    try {
      if (mode === 'delete') {
        await removeUser(target.id);
        actionTrigger.current = addButton.current;
      } else {
        const changes =
          mode === 'grant-admin' || mode === 'remove-admin'
            ? { admin: mode === 'grant-admin' }
            : { status: mode === 'revoke' ? 'revoked' : 'active' };
        if (
          !(await update((s) => ({
            users: s.users.map((u) => (u.id === target.id ? { ...u, ...changes } : u)),
          })))
        ) {
          setError('Не удалось изменить доступ. Попробуйте ещё раз.');
          return;
        }
      }
      notify(copy.success);
      setActionOpen(false);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="settings-toolbar">
        <Button ref={addButton} view="action" size="l" onClick={() => open({ type: 'invite' })}>
          <Plus size={16} />
          Добавить
        </Button>
      </div>
      <div className="table-scroll users-table">
        <Table<WorkspaceUser>
          aria-label="Пользователи"
          data={state.users}
          getRowId={(u) => u.id}
          columns={[
            {
              id: 'name',
              name: 'Пользователь',
              template: (u) => (
                <div className="user-cell">
                  <Avatar text={u.name[0]} size="m" />
                  <div>
                    <strong title={u.name}>
                      {u.name}
                      {u.id === user?.id || (DEMO && u.owner) ? ' · вы' : ''}
                    </strong>
                    <small className="user-email" title={u.email}>
                      {u.email}
                    </small>
                    <UserStatus user={u} />
                    {compact ? (
                      <div className="user-compact-details">
                        <span>{scope(u)}</span>
                        {role(u)}
                      </div>
                    ) : null}
                  </div>
                </div>
              ),
            },
            ...(!compact
              ? [
                  {
                    id: 'scope',
                    name: 'Проекты',
                    width: 124,
                    className: 'user-scope-col',
                    template: scope,
                  },
                  {
                    id: 'role',
                    name: 'Доступ',
                    width: 152,
                    className: 'user-role-col',
                    template: role,
                  },
                ]
              : []),
            {
              id: 'actions',
              name: () => <span className="sr-only">Действия</span>,
              width: 44,
              align: 'end',
              template: (u) => {
                if (u.id === user?.id || (DEMO && u.owner)) return <span />;
                const expired = u.expires && u.expires <= Date.now();
                const items = [
                  ...(expired && (user?.owner || user?.manageUsers)
                    ? [{ text: 'Создать новое приглашение', action: () => inviteAgain(u) }]
                    : []),
                  ...(user?.owner
                    ? [
                        ...(!u.expires && u.status === 'active'
                          ? [
                              {
                                text: u.admin
                                  ? 'Снять права администратора'
                                  : 'Назначить администратором',
                                action: () => start(u.admin ? 'remove-admin' : 'grant-admin', u),
                              },
                            ]
                          : []),
                        ...(u.status === 'revoked'
                          ? expired
                            ? []
                            : [{ text: 'Восстановить доступ', action: () => start('restore', u) }]
                          : u.status === 'expired'
                            ? []
                            : [
                                {
                                  text: u.expires ? 'Отозвать приглашение' : 'Отозвать доступ',
                                  action: () => start('revoke', u),
                                },
                              ]),
                        {
                          text: u.expires ? 'Удалить приглашение' : 'Удалить пользователя',
                          theme: 'danger' as const,
                          action: () => start('delete', u),
                        },
                      ]
                    : []),
                ];
                return items.length ? (
                  <DropdownMenu
                    popupProps={{ placement: ['bottom-end', 'top-end'] }}
                    renderSwitcher={(props) => (
                      <Button
                        {...props}
                        id={'user-actions-' + u.id}
                        className="user-actions"
                        view="flat"
                        size="m"
                        aria-label={'Действия: ' + u.name}
                      >
                        <MoreHorizontal size={18} aria-hidden="true" />
                      </Button>
                    )}
                    items={items}
                  />
                ) : (
                  <span />
                );
              },
            },
          ]}
        />
      </div>
      <Dialog
        open={actionOpen}
        onClose={() => {
          if (!busy) setActionOpen(false);
        }}
        size="s"
        aria-label={copy?.title}
        initialFocus="cancel"
        returnFocus={actionTrigger}
        className="user-action-dialog"
        modalClassName="user-action-modal"
        hasCloseButton={false}
        disableHeightTransition
        onTransitionOutComplete={() => requestAnimationFrame(() => actionTrigger.current?.focus())}
      >
        <Dialog.Header caption={copy?.title} />
        <Dialog.Body>
          <div className="user-action-copy">
            <div className="user-action-person">
              <strong>{target?.name}</strong>
              <span>{target?.email}</span>
            </div>
            <p>{copy?.consequence}</p>
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        </Dialog.Body>
        <Dialog.Footer
          textButtonCancel="Отмена"
          onClickButtonCancel={() => setActionOpen(false)}
          propsButtonCancel={{ disabled: busy }}
          textButtonApply={copy?.apply}
          propsButtonApply={{ view: copy?.view, loading: busy, disabled: busy }}
          onClickButtonApply={confirm}
        />
      </Dialog>
    </>
  );
}
