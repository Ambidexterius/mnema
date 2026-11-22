import React, { useEffect, useRef, useState } from 'react';
import {
  Button,
  Checkbox,
  Dialog,
  DropdownMenu,
  Loader,
  RadioGroup,
  Select,
  TextInput,
} from '@gravity-ui/uikit';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Globe,
  Link as LinkIcon,
  Lock,
  MoreHorizontal,
  RefreshCw,
  Share2,
  Users,
  X,
} from 'lucide-react';
import { api } from './api.ts';
import './project-sharing.css';

type SharingMode = 'private' | 'all' | 'link' | 'legacy';
type Member = {
  id: string;
  name?: string;
  email: string;
  role: 'view' | 'full';
  status: 'active' | 'invited' | 'expired';
  accessSource?: 'all' | 'explicit';
  accountRevoked?: boolean | number;
};
type Sharing = {
  mode: SharingMode;
  canManage: boolean;
  owner: { id: string; email: string; name?: string };
  members: Member[];
  link: { url: string; enabled: boolean };
  inviteURL?: string;
  emailStatus?: string;
};
const roleOptions = [
  { value: 'view', content: 'Просмотр' },
  { value: 'full', content: 'Полный доступ' },
];
const audienceOptions = [
  { value: 'private', content: 'Только приглашённые' },
  { value: 'all', content: 'Команда Суточно.ру' },
  { value: 'link', content: 'По ссылке' },
];
const modeHelp = {
  private: 'Только вы и приглашённые',
  all: 'Проект могут просматривать все, у кого есть доступ к рабочему пространству Суточно.ру.',
  link: 'После входа в Мнемодак · Просмотр. Ссылку можно переслать.',
  legacy: 'Сохранены прежние права участников.',
};
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function CreateProjectPrivacy({
  value = 'all',
  onChange,
}: {
  value?: 'all' | 'private';
  onChange: (mode: 'all' | 'private') => void;
}) {
  return (
    <div className="new-project-sharing">
      <Checkbox
        size="l"
        content="Только приглашённые"
        checked={value === 'private'}
        onUpdate={(checked) => onChange(checked ? 'private' : 'all')}
      />
      <p className="sharing-create-note">
        {value === 'private'
          ? 'Пока проект виден только вам. Пригласить коллег можно после создания.'
          : 'Проект увидят все участники рабочего пространства Суточно.ру'}
      </p>
    </div>
  );
}
export function ProjectShareButton({
  mode,
  canManage,
  onOpen,
  url,
  notify,
}: {
  mode?: SharingMode;
  canManage: boolean;
  onOpen: () => void;
  url: string;
  notify: (message: string) => void;
}) {
  const Icon =
    mode === 'private' ? Lock : mode === 'link' ? LinkIcon : mode === 'all' ? Users : Globe;
  const status =
    mode === 'private'
      ? 'Только приглашённые'
      : mode === 'all'
        ? 'Команда Суточно.ру'
        : mode === 'link'
          ? 'По ссылке'
          : mode === 'legacy'
            ? 'Прежние права доступа'
            : '';
  const details =
    mode === 'private'
      ? 'Проект доступен только приглашённым.'
      : mode === 'all'
        ? 'Проект доступен всей команде Суточно.ру.'
        : mode === 'link'
          ? 'Проект доступен после входа по действующей ссылке.'
          : 'Действуют прежние права участников.';
  const action = () => {
    if (canManage) {
      onOpen();
      return;
    }
    navigator.clipboard.writeText(url).then(
      () => notify('Ссылка скопирована. ' + details),
      () => notify('Не удалось скопировать ссылку. Скопируйте адрес из строки браузера.'),
    );
  };
  const label = canManage ? 'Поделиться проектом' : 'Скопировать адрес проекта';
  const shortStatus =
    mode === 'private'
      ? 'Приватный'
      : mode === 'all'
        ? 'Для команды'
        : mode === 'legacy'
          ? 'Прежний доступ'
          : status;
  return (
    <>
      {status && (
        <span
          className={'project-access-status' + (mode === 'private' ? ' is-private' : '')}
          title={status}
        >
          <Icon size={16} aria-hidden="true" />
          <span className="access-full">{status}</span>
          <span className="access-short">{shortStatus}</span>
        </span>
      )}
      <Button
        className="project-share-trigger"
        view="outlined"
        size="m"
        aria-label={label}
        title={label}
        onClick={action}
      >
        {canManage ? (
          <Share2 size={16} aria-hidden="true" />
        ) : (
          <LinkIcon size={16} aria-hidden="true" />
        )}
        <span className="project-share-action">{canManage ? 'Поделиться' : 'Скопировать'}</span>
      </Button>
    </>
  );
}

export function ProjectSharingDialog({
  id,
  open,
  onClose,
  onChanged,
}: {
  id: string;
  open: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [sharing, setSharing] = useState<Sharing | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [email, setEmail] = useState(''),
    [role, setRole] = useState('view'),
    [fieldError, setFieldError] = useState(''),
    [notice, setNotice] = useState(''),
    [copied, setCopied] = useState(false),
    [manualLink, setManualLink] = useState(false),
    [inviteURL, setInviteURL] = useState('');
  const [confirm, setConfirm] = useState<{ title: string; text: string; apply: () => void } | null>(
      null,
    ),
    alive = useRef(true),
    request = useRef(0);
  const [view, setView] = useState<'main' | 'access'>('main');
  const inviteField = useRef<HTMLInputElement>(null),
    backButton = useRef<HTMLButtonElement>(null);
  const path = '/api/workspaces/' + encodeURIComponent(id) + '/sharing';
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      request.current++;
    };
  }, []);
  const load = async () => {
    const epoch = ++request.current;
    setLoading(true);
    setError('');
    try {
      const next = await api<Sharing>(path, undefined, 'GET', false);
      if (alive.current && epoch === request.current) setSharing(next);
    } catch (e) {
      if (alive.current && epoch === request.current) setError((e as Error).message);
    } finally {
      if (alive.current && epoch === request.current) setLoading(false);
    }
  };
  useEffect(() => {
    if (open) void load();
  }, [id, open]);
  useEffect(() => {
    if (loading) return;
    const frame = requestAnimationFrame(() =>
      (view === 'access' ? backButton.current : inviteField.current)?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [view, loading]);
  const close = () => {
    if (!busy) onClose();
  };
  const mutate = async (
    endpoint: string,
    body?: unknown,
    method = body === undefined ? 'DELETE' : 'POST',
  ) => {
    if (busy) return false;
    setBusy(true);
    setError('');
    try {
      const result = await api<Sharing>(endpoint, body, method, false);
      if (!alive.current) return false;
      setSharing(result);
      setCopied(false);
      setNotice('Изменения сохранены.');
      if (result.inviteURL && result.emailStatus !== 'sent') setInviteURL(result.inviteURL);
      await onChanged();
      return true;
    } catch (e) {
      if (alive.current) setError((e as Error).message);
      return false;
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const copy = async () => {
    if (!sharing) return;
    try {
      await navigator.clipboard.writeText(sharing.link.url);
      setCopied(true);
      setManualLink(false);
      setNotice('Ссылка скопирована.');
    } catch {
      setCopied(false);
      setManualLink(true);
      setNotice('Скопируйте ссылку вручную.');
    }
  };
  const invite = async () => {
    if (!sharing || busy) return;
    const address = email.trim().toLowerCase();
    setFieldError('');
    if (!emailPattern.test(address)) {
      setFieldError('Введите рабочую почту в формате name@example.com.');
      return;
    }
    if (address === sharing.owner.email.toLowerCase()) {
      setFieldError('У владельца уже есть доступ.');
      return;
    }
    if (sharing.members.some((m) => m.email.toLowerCase() === address && m.status !== 'expired')) {
      setFieldError('Этот человек уже есть в списке. Измените его роль ниже.');
      return;
    }
    if (await mutate(path + '/members', { email: address, role })) {
      setEmail('');
      setRole('view');
      setNotice('Приглашение создано.');
    }
  };
  const changeMode = (mode: SharingMode) => {
    if (!sharing || busy || mode === sharing.mode) return;
    const apply = () => {
      setConfirm(null);
      void mutate(path, { mode }, 'PATCH');
    };
    if (sharing.mode !== 'private')
      setConfirm({
        title: 'Изменить общий доступ?',
        text:
          sharing.mode === 'legacy'
            ? 'Прежний общий доступ будет отключён. Доступ останется у владельца и людей, добавленных лично. Чтобы сохранить доступ конкретному человеку, назначьте ему роль в списке участников.'
            : mode === 'private'
              ? 'Доступ останется у владельца и приглашённых участников. Остальные пользователи больше не смогут открыть проект.'
              : 'Прежний способ доступа перестанет работать. Приглашённые участники сохранят свои права.',
        apply,
      });
    else apply();
  };
  const remove = (member: Member) => {
    if (!sharing) return;
    setConfirm({
      title: 'Убрать участника?',
      text:
        'Личный доступ ' +
        member.email +
        ' будет закрыт.' +
        (sharing.mode === 'all'
          ? ' Он всё ещё сможет смотреть проект, потому что открыт доступ всем пользователям.'
          : sharing.mode === 'link'
            ? ' Он всё ещё сможет смотреть проект по действующей ссылке. Чтобы закрыть и этот доступ, выключите или пересоздайте ссылку.'
            : ''),
      apply: () => {
        setConfirm(null);
        void mutate(path + '/members/' + encodeURIComponent(member.id));
      },
    });
  };
  const rotate = () =>
    setConfirm({
      title: 'Пересоздать ссылку?',
      text: 'Старая ссылка перестанет открывать проект. Приглашённые участники сохранят доступ.',
      apply: () => {
        setConfirm(null);
        void mutate(path + '/link/rotate', {});
      },
    });
  const ModeIcon =
    sharing?.mode === 'private'
      ? Lock
      : sharing?.mode === 'link'
        ? LinkIcon
        : sharing?.mode === 'all'
          ? Users
          : Globe;
  const popupProps = { disableTransition: true, placement: ['bottom-end', 'top-end'] as any };
  const audience = {
    private: 'Только приглашённые',
    all: 'Команда Суточно.ру',
    link: 'Пользователи со ссылкой',
    legacy: 'Прежние права доступа',
  };
  return (
    <>
      <Dialog
        open={open && !confirm}
        onClose={close}
        initialFocus={view === 'access' ? backButton : inviteField}
        size="m"
        className="project-sharing-dialog sharing-figma-dialog"
        contentOverflow="auto"
        aria-label="Поделиться проектом"
        hasCloseButton
        disableOutsideClick={busy}
        disableEscapeKeyDown={busy}
      >
        <Dialog.Header
          className="sharing-dialog-header"
          caption={view === 'main' ? 'Поделиться проектом' : 'Общий доступ'}
          insertBefore={
            view === 'access' ? (
              <Button
                ref={backButton}
                view="flat"
                aria-label="Назад к участникам"
                disabled={busy}
                onClick={() => setView('main')}
              >
                <ArrowLeft size={18} />
              </Button>
            ) : null
          }
          insertAfter={
            <div className="sharing-header-actions">
              {sharing && !loading ? (
                <Button
                  className="sharing-header-copy"
                  size="m"
                  aria-label="Скопировать ссылку"
                  title={copied ? 'Ссылка скопирована' : 'Скопировать ссылку'}
                  view="flat"
                  disabled={busy}
                  onClick={() => void copy()}
                >
                  {copied ? <Check size={16} /> : <LinkIcon size={16} />}
                  <span className="sharing-copy-label">
                    {copied ? 'Скопировано' : 'Копировать'}
                  </span>
                </Button>
              ) : null}
              <Button
                className="sharing-header-close"
                size="m"
                aria-label="Закрыть"
                view="flat"
                disabled={busy}
                onClick={close}
              >
                <X size={14} viewBox="5 5 14 14" aria-hidden="true" />
              </Button>
            </div>
          }
        />
        <Dialog.Body>
          {loading ? (
            <div className="sharing-loading" role="status">
              <Loader size="s" />
              Открываем настройки доступа…
            </div>
          ) : sharing ? (
            <>
              {view === 'main' ? (
                <>
                  <div className="sharing-invite-row">
                    <div className="sharing-field">
                      <label htmlFor={'sharing-invite-' + id}>Рабочая почта</label>
                      <TextInput
                        id={'sharing-invite-' + id}
                        controlRef={inviteField}
                        controlProps={{ 'aria-label': 'Рабочая почта участника' }}
                        placeholder="name@sutochno.ru"
                        value={email}
                        onUpdate={(value) => {
                          setEmail(value);
                          setFieldError('');
                        }}
                        disabled={busy}
                        validationState={fieldError ? 'invalid' : undefined}
                        errorMessage={fieldError}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void invite();
                        }}
                        endContent={
                          email.trim() ? (
                            <Select
                              className="sharing-invite-role"
                              renderSelectedOption={(option) => (
                                <span className="sharing-role-label">
                                  {roleOptions.map((item) => (
                                    <span
                                      key={item.value}
                                      style={{
                                        visibility:
                                          item.value === option.value ? 'visible' : 'hidden',
                                      }}
                                      aria-hidden={item.value !== option.value}
                                    >
                                      {item.content}
                                    </span>
                                  ))}
                                </span>
                              )}
                              size="s"
                              view="normal"
                              aria-label="Роль нового участника"
                              value={[role]}
                              options={roleOptions}
                              disabled={busy}
                              onUpdate={(v) => setRole(v[0])}
                            />
                          ) : undefined
                        }
                      />
                    </div>
                    <Button
                      view="action"
                      disabled={busy || !email.trim()}
                      loading={busy}
                      onClick={() => void invite()}
                    >
                      Пригласить
                    </Button>
                  </div>
                  <h3 className="sharing-access-heading">Кто имеет доступ</h3>
                  <Button
                    className="sharing-audience-row"
                    view="flat"
                    width="max"
                    aria-label="Настроить общий доступ"
                    disabled={busy}
                    onClick={() => setView('access')}
                  >
                    <span className="sharing-audience-icon">
                      <ModeIcon size={20} />
                    </span>
                    <span className="sharing-audience-name">{audience[sharing.mode]}</span>
                    <span className="sharing-audience-permission">
                      <span className="sharing-audience-role">
                        {sharing.mode === 'private'
                          ? 'Ограничен'
                          : sharing.mode === 'legacy'
                            ? 'Сохранён'
                            : 'Просмотр'}
                      </span>
                      <ChevronRight size={16} />
                    </span>
                  </Button>
                  <div className="sharing-people" aria-label="Участники проекта">
                    <div className="sharing-person">
                      <span className="sharing-avatar">
                        {(sharing.owner.name || sharing.owner.email)[0]?.toUpperCase()}
                      </span>
                      <div className="sharing-person-details">
                        <strong>{sharing.owner.name || sharing.owner.email}</strong>
                        <small>{sharing.owner.email}</small>
                      </div>
                      <span className="sharing-owner">Владелец</span>
                    </div>
                    {sharing.members
                      .filter((member) => member.id !== sharing.owner.id)
                      .map((member) => (
                        <div className="sharing-person" key={member.id}>
                          <span className="sharing-avatar">
                            {(member.name || member.email)[0]?.toUpperCase()}
                          </span>
                          <div className="sharing-person-details">
                            <strong>{member.name || member.email}</strong>
                            {member.name ? (
                              <small title={member.email}>{member.email}</small>
                            ) : null}
                            {member.accountRevoked ? (
                              <small>Доступ к Мнемодаку закрыт</small>
                            ) : null}
                            {sharing.mode === 'legacy' && member.accessSource === 'all' ? (
                              <small>Прежний общий доступ</small>
                            ) : null}
                            {member.status !== 'active' ? (
                              <small>
                                {member.status === 'expired'
                                  ? 'Срок приглашения истёк'
                                  : 'Приглашён'}
                              </small>
                            ) : null}
                          </div>
                          <DropdownMenu
                            size="m"
                            disabled={busy}
                            popupProps={popupProps}
                            renderSwitcher={(props) => (
                              <Button
                                {...props}
                                view="flat"
                                size="m"
                                aria-label={'Роль ' + member.email}
                              >
                                {member.role === 'full' ? 'Полный доступ' : 'Просмотр'}
                                <ChevronDown size={16} aria-hidden="true" />
                              </Button>
                            )}
                            items={[
                              roleOptions.map((option) => ({
                                text: option.content,
                                iconStart: (
                                  <Check
                                    size={14}
                                    style={{
                                      visibility:
                                        member.role === option.value ? 'visible' : 'hidden',
                                    }}
                                    aria-hidden="true"
                                  />
                                ),
                                action: () =>
                                  void mutate(
                                    path + '/members/' + encodeURIComponent(member.id),
                                    { role: option.value },
                                    'PATCH',
                                  ),
                              })),
                              [
                                {
                                  text: 'Убрать доступ',
                                  iconStart: (
                                    <Check
                                      size={14}
                                      style={{ visibility: 'hidden' }}
                                      aria-hidden="true"
                                    />
                                  ),
                                  theme: 'danger',
                                  action: () => remove(member),
                                },
                              ],
                            ]}
                          />
                        </div>
                      ))}
                  </div>
                  {sharing.mode === 'link' ? (
                    <p className="sharing-link-auth">
                      После входа в Мнемодак. Ссылку можно переслать.
                    </p>
                  ) : null}
                </>
              ) : (
                <div className="sharing-access-settings">
                  <RadioGroup
                    aria-label="Общий доступ к проекту"
                    value={sharing.mode}
                    disabled={busy}
                    options={[
                      ...audienceOptions,
                      ...(sharing.mode === 'legacy'
                        ? [{ value: 'legacy', content: 'Прежние права доступа', disabled: true }]
                        : []),
                    ]}
                    onUpdate={(value) => changeMode(value as SharingMode)}
                  />
                  <p>{modeHelp[sharing.mode]}</p>
                  {sharing.mode === 'link' ? (
                    <div className="sharing-access-link-row">
                      <span>Ссылка для просмотра</span>
                      <DropdownMenu
                        size="m"
                        disabled={busy}
                        popupProps={popupProps}
                        renderSwitcher={(props) => (
                          <Button {...props} view="flat" aria-label="Действия ссылки">
                            <MoreHorizontal size={18} />
                          </Button>
                        )}
                        items={[
                          [
                            {
                              text: 'Пересоздать ссылку',
                              iconStart: <RefreshCw size={16} />,
                              action: rotate,
                            },
                          ],
                          [
                            {
                              text: 'Выключить ссылку',
                              theme: 'danger',
                              action: () => changeMode('private'),
                            },
                          ],
                        ]}
                      />
                    </div>
                  ) : null}
                </div>
              )}
              {manualLink ? (
                <label className="sharing-field sharing-manual-link">
                  Ссылка на проект
                  <TextInput
                    value={sharing.link.url}
                    readOnly
                    controlProps={{ 'aria-label': 'Ссылка на проект' }}
                  />
                  <small>Скопируйте ссылку вручную.</small>
                </label>
              ) : null}
              {inviteURL ? (
                <label className="sharing-field sharing-manual-link">
                  Ссылка приглашения
                  <TextInput
                    value={inviteURL}
                    readOnly
                    controlProps={{ 'aria-label': 'Ссылка приглашения' }}
                  />
                  <small>Письмо не отправлено. Передайте эту ссылку участнику.</small>
                </label>
              ) : null}
            </>
          ) : null}
          {error ? (
            <p role="alert" className="form-error sharing-error">
              {error}
            </p>
          ) : null}
          {!loading && !sharing ? (
            <Button view="outlined" onClick={() => void load()}>
              Повторить
            </Button>
          ) : null}
          <span className="sr-only" role="status">
            {notice}
          </span>
        </Dialog.Body>
      </Dialog>
      <Dialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        size="s"
        aria-label={confirm?.title}
        hasCloseButton
      >
        <Dialog.Header caption={confirm?.title} />
        <Dialog.Body>
          <p className="sharing-confirm-copy">{confirm?.text}</p>
        </Dialog.Body>
        <Dialog.Footer
          textButtonCancel="Отмена"
          onClickButtonCancel={() => setConfirm(null)}
          textButtonApply="Подтвердить"
          onClickButtonApply={() => confirm?.apply()}
        />
      </Dialog>
    </>
  );
}
