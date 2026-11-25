import { appHref } from '../routes.ts';
import { invitationMailNotice } from '../invitation-mail-status.ts';
import { CreateProjectPrivacy } from '../ProjectSharing.tsx';
import ModelConnectionDialog from '../ModelConnectionDialog.tsx';
import { api } from '../api.ts';
import { useApp } from '../app-context.ts';
import React, { useEffect, useRef, useState } from 'react';
import { Button, Dialog, Select, Switch, TextArea, TextInput } from '@gravity-ui/uikit';
import { ArrowRight, FileText, Folder, Upload } from 'lucide-react';
import { DEMO, KINDS, IMPORTANCE } from '../state/constants.ts';
import { normalize, reportOf } from '../state/normalize.ts';
import { segmentsOf, where, time, uid } from '../shared/format.ts';
import { FormField, Notice } from '../shared/ui.tsx';
import { History } from './Findings.tsx';

const NewsDialog = React.lazy(() => import('../NewsDialog.tsx'));

export function AppDialog() {
  const ctx = useApp();
  const { dialog: d, open, state, update, receive, real, notify, go, files, reader } = ctx;
  const [form, setForm] = useState<Record<string, any>>({}),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState(''),
    [query, setQuery] = useState('');
  const file = useRef<File | null>(null);
  const first = useRef<HTMLInputElement>(null);
  const field = (name: string, value: unknown) => setForm((s) => ({ ...s, [name]: value }));
  const close = () => {
    if (!uploading) open(null);
  };
  const model = state.models.find((m) => m.id === d?.id);
  const finding = d?.findingId
    ? state.findings.map(normalize).find((f) => f.id === d.findingId)
    : null;
  const study = state.studies.find(
    (s) => s.id === (d?.studyId || finding?.studyId || form.studyId),
  );
  const segment = segmentsOf(study).find(
    (t) => t.id === (d?.segmentId || finding?.segmentId || form.segmentId),
  );
  useEffect(() => {
    setForm(d?.initial || {});
    setError('');
  }, [d?.type, d?.id, d?.findingId, d?.studyId, d?.segmentId]);
  const title =
    (
      {
        upload: 'Добавить материал',
        finding: finding
          ? d.accept
            ? 'Принять с правкой'
            : 'Изменить находку'
          : d?.segmentId
            ? 'Сохранить находку'
            : 'Новая находка',
        passport: 'Паспорт исследования',
        workspace: 'Новый проект',
        whatsnew: 'Что нового',
        invite: 'Добавить пользователя',
        model: model ? 'Настройка модели' : 'Добавить модель',
        source: 'Доказательство',
        search: 'Найти в проекте',
        processor: 'Параметры обработчика',
      } as Partial<Record<string, string>>
    )[d?.type] || '';
  async function submit() {
    if (uploading) return;
    setUploading(true);
    setError('');
    try {
      if (reader && !['search', 'source', 'workspace'].includes(d.type)) return;
      switch (d.type) {
        case 'workspace': {
          const name = (form.name || '').trim();
          if (!name) {
            setError('Назовите проект.');
            first.current?.focus();
            return;
          }
          if (name.length > 60) {
            setError('Не длиннее 60 символов.');
            return;
          }
          if (real) {
            const created = await api('/api/workspaces', { name, mode: form.sharingMode || 'all' });
            await ctx.switchWorkspace(created.id);
            notify('Проект «' + name + '» создан.');
            break;
          }
          notify('В демо-режиме проекты не создаются.');
          break;
        }
        case 'invite': {
          if (real) {
            const target =
              form.workspace || (ctx.user?.manageUsers ? 'all' : ctx.user?.workspaceId);
            const payload = {
              name: form.name || '',
              email: form.email || '',
              role: form.role || 'view',
              scope: target === 'all' ? 'all' : 'project',
            };
            const result = await api(
              target === 'all'
                ? '/api/invitations'
                : '/api/workspaces/' + encodeURIComponent(target) + '/invitations',
              payload,
            );
            if (target !== 'all' && target !== ctx.user?.workspaceId) {
              await ctx.switchWorkspace(target);
              go('users');
            } else receive(await api('/api/state'));
            if (result.added) {
              notify(
                'Пользователь добавлен в проект.' +
                  (result.emailStatus === 'sent'
                    ? ' Письмо передано почтовому серверу.'
                    : ' Сообщите участнику о доступе.'),
              );
              break;
            }
            setForm((s) => ({
              ...s,
              inviteURL: result.inviteURL,
              emailStatus: result.emailStatus,
            }));
            notify('Приглашение создано.');
            return;
          }
          const name = (form.name || '').trim(),
            email = (form.email || '').trim().toLowerCase();
          if (!name || !/^\S+@\S+\.\S+$/.test(email)) {
            setError('Введите имя и адрес почты в формате name@example.com.');
            first.current?.focus();
            return;
          }
          if (state.users.some((x) => x.email.toLowerCase() === email)) {
            setError('Этот адрес уже добавлен. Введите другой или измените права в таблице.');
            return;
          }
          update((s) => ({
            users: [
              ...s.users,
              { id: uid(), name, email, role: form.role || 'view', status: 'invited' },
            ],
          }));
          notify('Демо-приглашение создано. Письмо не отправлено.');
          break;
        }
        case 'finding': {
          const title = (form.title ?? finding?.title ?? '').trim();
          if (!title) {
            setError('Напишите короткий вывод.');
            first.current?.focus();
            return;
          }
          if (title.length > 160) {
            setError('Сократите вывод до 160 символов.');
            return;
          }
          const values = {
            title,
            description:
              form.description ?? finding?.description ?? (d?.quote ? '«' + d.quote + '»' : ''),
            kind: form.kind || finding?.kind || 'Инсайт',
            importance: form.importance || finding?.importance || 'Средняя',
            significant: form.significant ?? finding?.significant ?? false,
          };
          if (finding) {
            if (
              !(await update((s) => ({
                findings: s.findings.map((x) =>
                  x.id === finding.id
                    ? { ...normalize(x), ...values, ...(d.accept ? { status: 'verified' } : {}) }
                    : x,
                ),
              })))
            )
              return;
            notify(d.accept ? 'Находка принята с правкой.' : 'Находка изменена.');
            break;
          }
          if (!study || !segment) {
            setError('Выберите материал и цитату: находке нужно доказательство.');
            return;
          }
          if (
            !(await update((s) => ({
              findings: [
                {
                  id: uid(),
                  ...values,
                  studyId: study.id,
                  segmentId: segment.id,
                  status: 'verified',
                  origin: 'human',
                  history: DEMO ? [{ action: 'created', by: 'Глеб', at: Date.now() }] : [],
                },
                ...s.findings,
              ],
            })))
          )
            return;
          notify('Находка сохранена со ссылкой на фрагмент.');
          break;
        }
        case 'passport': {
          const st = study;
          if (!st) throw new Error('Материал больше недоступен.');
          const report = form.report || reportOf(st);
          const passport = {
            title: (form.title ?? st.title).trim(),
            description: (form.description ?? st.description ?? '').trim(),
            type: form.type || st.type,
            conducted: (form.conducted ?? st.conducted ?? '').trim(),
            method: (form.method ?? st.method ?? '').trim(),
            audience: (form.audience ?? st.audience ?? '').trim(),
            author: (form.author ?? st.author ?? '').trim(),
            report,
            reportExpected:
              report === 'none' ? (form.reportExpected ?? st.reportExpected ?? '') : '',
          };
          if (!passport.title) {
            setError('Укажите название исследования.');
            first.current?.focus();
            return;
          }
          if (passport.reportExpected && !/^\d{4}-\d{2}-\d{2}$/.test(passport.reportExpected)) {
            setError('Укажите дату в формате ГГГГ-ММ-ДД.');
            return;
          }
          if (real) {
            receive(await api('/api/studies/' + st.id, { passport }, 'PATCH'));
            notify('Паспорт сохранён.');
            break;
          }
          update((s) => ({
            studies: s.studies.map((x) => (x.id === st.id ? { ...x, ...passport } : x)),
          }));
          notify('Паспорт сохранён.');
          break;
        }

        case 'upload': {
          const f = file.current;
          if (!f || !f.size || f.size > 2 * 1024 ** 3) {
            setError('Выберите непустой файл размером до 2 ГБ.');
            return;
          }
          if (!form.title?.trim()) {
            setError('Укажите название материала.');
            return;
          }
          const id = uid();
          files.current.set(id, { url: URL.createObjectURL(f), type: f.type });
          update((s) => ({
            studies: [
              {
                id,
                title: form.title.trim(),
                description: 'Локальный файл · демонстрация обработки',
                type: form.type || 'Интервью',
                format: /\.(pdf|txt)$/i.test(f.name) ? 'PDF' : 'Видео',
                project: form.project?.trim() || '',
                date: new Date().toISOString().slice(0, 10),
                duration: 0,
                participants: 0,
                status: 'processing',
                step: 0,
                tags: ['Новый материал'],
                color: 'sage',
                findings: 0,
                summary: [],
                localFile: true,
                fileName: f.name,
              },
              ...s.studies,
            ],
          }));
          go('library');
          notify('Файл добавлен локально. Запущена демонстрация обработки.');
          break;
        }
        default:
          return;
      }
      close();
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  }
  if (d?.type === 'whatsnew')
    return (
      <React.Suspense fallback={null}>
        <NewsDialog
          real={real}
          canEdit={real ? Boolean(ctx.user?.owner) : !ctx.reader}
          onSeen={ctx.markSeen}
          onClose={close}
        />
      </React.Suspense>
    );
  return (
    <>
      <Dialog
        open={
          Boolean(d) &&
          !(real && d?.type === 'upload') &&
          d?.type !== 'import' &&
          d?.type !== 'model'
        }
        onClose={close}
        size="s"
        className={d?.type === 'invite' ? 'invite-dialog' : undefined}
        aria-labelledby="modal-title"
      >
        <Dialog.Header caption={title} />
        <Dialog.Body>
          <h2 className="sr-only" id="modal-title">
            {title}
          </h2>
          {d?.type === 'search' ? (
            <>
              <TextInput
                value={query}
                onUpdate={setQuery}
                placeholder="Название, тема или метка"
                controlProps={{ 'aria-label': 'Поиск по исследованиям' }}
                autoFocus
              />
              <div className="command-results">
                {state.studies
                  .filter((s) =>
                    (s.title + ' ' + s.project + ' ' + s.tags.join(' '))
                      .toLowerCase()
                      .includes(query.toLowerCase()),
                  )
                  .map((s) => (
                    <Button
                      view="flat"
                      width="max"
                      key={s.id}
                      onClick={() => {
                        close();
                        go('study/' + s.id);
                      }}
                    >
                      <FileText size={16} />
                      {s.title}
                    </Button>
                  ))}
              </div>
            </>
          ) : null}
          {d?.type === 'invite' ? (
            <>
              {form.inviteURL ? (
                <div className="invite-result">
                  <p role="status">{invitationMailNotice(form.emailStatus)}</p>
                  <p>
                    Коллега получит доступ после регистрации по этой ссылке. Ссылка действует 7 дней
                    и используется один раз.
                  </p>
                  <TextInput
                    value={form.inviteURL}
                    readOnly
                    controlProps={{ 'aria-label': 'Ссылка приглашения' }}
                  />
                  <Button
                    onClick={() =>
                      navigator.clipboard
                        .writeText(form.inviteURL)
                        .then(() => notify('Ссылка скопирована.'))
                        .catch(() => notify('Выделите и скопируйте ссылку вручную.'))
                    }
                  >
                    Скопировать ссылку
                  </Button>
                </div>
              ) : null}
              <FormField label="Имя">
                <TextInput
                  value={form.name || ''}
                  onUpdate={(v) => field('name', v)}
                  controlRef={first}
                  placeholder="Анна Иванова"
                  autoComplete="off"
                />
              </FormField>
              <FormField label="Электронная почта">
                <TextInput
                  value={form.email || ''}
                  onUpdate={(v) => field('email', v)}
                  type="email"
                  placeholder="name@example.com"
                  autoComplete="off"
                  validationState={error ? 'invalid' : undefined}
                  errorMessage={error}
                />
              </FormField>
              <FormField label="Проекты">
                <Select
                  aria-label="Проекты"
                  value={[
                    form.workspace ||
                      (ctx.user?.manageUsers || DEMO ? 'all' : ctx.user?.workspaceId),
                  ]}
                  options={[
                    ...(ctx.user?.manageUsers || DEMO
                      ? [{ value: 'all', content: 'Общие проекты' }]
                      : []),
                    ...(ctx.workspaces || [])
                      .filter((w) => w.admin)
                      .map((w) => ({ value: w.id, content: w.name })),
                  ]}
                  onUpdate={(v) => field('workspace', v[0])}
                />
              </FormField>
              <FormField label="Уровень доступа">
                <Select
                  value={[form.role || 'view']}
                  options={[
                    { value: 'view', content: 'Просмотр' },
                    { value: 'full', content: 'Полный доступ' },
                  ]}
                  onUpdate={(v) => field('role', v[0])}
                />
              </FormField>
              {!form.inviteURL ? (
                <Notice>
                  Если аккаунт уже есть, доступ откроется сразу. «Общие проекты» включает текущие
                  и будущие общие проекты. Для закрытых проектов нужен отдельный доступ.
                </Notice>
              ) : null}
            </>
          ) : null}

          {d?.type === 'finding' ? (
            <>
              {!finding && !d.segmentId ? (
                <>
                  <FormField label="Материал">
                    <Select
                      width="max"
                      filterable={state.studies.length > 8}
                      placeholder="Выберите материал"
                      value={study ? [study.id] : []}
                      disabled={Boolean(d.studyId)}
                      options={state.studies
                        .filter((s) => s.status === 'ready' && segmentsOf(s).length)
                        .map((s) => ({ value: s.id, content: s.title, text: s.title }))}
                      onUpdate={(v) =>
                        setForm((x) => ({ ...x, studyId: v[0], segmentId: undefined }))
                      }
                    />
                  </FormField>
                  <FormField
                    label="Цитата-доказательство"
                    help="Фрагмент материала, на который опирается вывод."
                  >
                    <Select
                      width="max"
                      popupWidth="fit"
                      filterable
                      placeholder={
                        study ? 'Найдите фрагмент по словам' : 'Сначала выберите материал'
                      }
                      disabled={!study}
                      value={segment ? [segment.id] : []}
                      options={segmentsOf(study).map((seg) => {
                        const label =
                          where(seg) + ' · ' + (seg.correctedText ?? seg.text).slice(0, 140);
                        return { value: seg.id, content: label, text: label };
                      })}
                      onUpdate={(v) => field('segmentId', v[0])}
                    />
                  </FormField>
                </>
              ) : null}
              <FormField
                label="Короткий вывод"
                help="До 160 символов. Одна мысль, которую можно проверить по фрагменту."
              >
                <TextInput
                  value={form.title ?? finding?.title ?? ''}
                  onUpdate={(v) => field('title', v)}
                  controlRef={first}
                  placeholder="Что узнали из фрагмента?"
                />
              </FormField>
              <FormField label="Контекст">
                <TextArea
                  value={
                    form.description ??
                    finding?.description ??
                    (d?.quote ? '«' + d.quote + '»' : '')
                  }
                  onUpdate={(v) => field('description', v)}
                  minRows={2}
                />
              </FormField>
              <div className="form-row">
                <FormField label="Тип">
                  <Select
                    value={[form.kind || finding?.kind || 'Инсайт']}
                    options={KINDS.map((value) => ({ value, content: value }))}
                    onUpdate={(v) => field('kind', v[0])}
                  />
                </FormField>
                <FormField label="Важность">
                  <Select
                    value={[form.importance || finding?.importance || 'Средняя']}
                    options={IMPORTANCE.map((value) => ({ value, content: value }))}
                    onUpdate={(v) => field('importance', v[0])}
                  />
                </FormField>
              </div>
              <Switch
                checked={form.significant ?? finding?.significant ?? false}
                onUpdate={(v) => field('significant', v)}
                content="Статистически значимо"
              />
              {segment ? (
                <blockquote>
                  «{segment.correctedText ?? segment.text}»
                  <footer>
                    {study?.title} · {where(segment)}
                  </footer>
                </blockquote>
              ) : null}
              {finding ? <History f={finding} /> : null}
            </>
          ) : null}
          {d?.type === 'workspace' ? (
            <>
              <FormField
                label="Название"
                help="Например, «Календарь цен». Материалы, участники и чат в каждом проекте свои."
              >
                <TextInput
                  value={form.name || ''}
                  onUpdate={(v) => field('name', v)}
                  controlRef={first}
                  placeholder="Календарь цен"
                  autoFocus
                />
              </FormField>
              <CreateProjectPrivacy
                value={form.sharingMode || 'all'}
                onChange={(value) => field('sharingMode', value)}
              />
            </>
          ) : null}

          {d?.type === 'passport' && study ? (
            <>
              <FormField label="Название">
                <TextInput
                  value={form.title ?? study.title}
                  onUpdate={(v) => field('title', v)}
                  controlRef={first}
                />
              </FormField>
              <FormField label="Описание">
                <TextArea
                  value={form.description ?? study.description ?? ''}
                  onUpdate={(v) => field('description', v)}
                  minRows={2}
                />
              </FormField>
              <div className="form-row">
                <FormField label="Тип источника">
                  <Select
                    value={[form.type || study.type]}
                    options={['Интервью', 'Юзабилити-тест', 'Встреча', 'Отчёт'].map((value) => ({
                      value,
                      content: value,
                    }))}
                    onUpdate={(v) => field('type', v[0])}
                  />
                </FormField>
                <FormField label="Проведено">
                  <TextInput
                    value={form.conducted ?? study.conducted ?? ''}
                    onUpdate={(v) => field('conducted', v)}
                    placeholder="Ноябрь 2026"
                  />
                </FormField>
              </div>
              <FormField label="Метод">
                <TextInput
                  value={form.method ?? study.method ?? ''}
                  onUpdate={(v) => field('method', v)}
                  placeholder="Юзабилити-тестирование"
                />
              </FormField>
              <FormField label="Аудитория" help="Хозяева или гости, сегменты и размер выборки.">
                <TextArea
                  value={form.audience ?? study.audience ?? ''}
                  onUpdate={(v) => field('audience', v)}
                  minRows={2}
                />
              </FormField>
              <FormField label="Автор">
                <TextInput
                  value={form.author ?? study.author ?? ''}
                  onUpdate={(v) => field('author', v)}
                />
              </FormField>
              <div className="form-row">
                <FormField label="Отчёт исследователя">
                  <Select
                    value={[form.report || reportOf(study)]}
                    options={[
                      { value: 'ready', content: 'Отчёт есть' },
                      { value: 'none', content: 'Отчёта нет' },
                    ]}
                    onUpdate={(v) => field('report', v[0])}
                  />
                </FormField>
                {(form.report || reportOf(study)) === 'none' ? (
                  <FormField label="Ожидаем отчёт">
                    <TextInput
                      type={'date' as 'text'}
                      value={form.reportExpected ?? study.reportExpected ?? ''}
                      onUpdate={(v) => field('reportExpected', v)}
                    />
                  </FormField>
                ) : null}
              </div>
              <Notice>
                Без отчёта находки и ответы чата по исследованию помечаются «по сырым данным».
              </Notice>
            </>
          ) : null}
          {d?.type === 'upload' ? (
            <>
              <label className="file-drop">
                <Upload size={28} />
                <strong>{form.fileName || 'Выберите исходный файл'}</strong>
                <small>PDF, DOCX, DOC, XLS, XLSX, TXT, аудио и видео · до 2 ГБ</small>
                <input
                  type="file"
                  accept=".mp4,.mov,.webm,.mp3,.wav,.m4a,.pdf,.txt,.docx,.doc,.xls,.xlsx"
                  aria-label="Выбрать исходный файл"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    file.current = f;
                    if (f)
                      setForm((s) => ({
                        ...s,
                        fileName: f.name,
                        title: s.title || f.name.replace(/\.[^.]+$/, ''),
                      }));
                  }}
                />
              </label>
              <FormField label="Название">
                <TextInput value={form.title || ''} onUpdate={(v) => field('title', v)} />
              </FormField>
              <div className="form-row">
                <FormField label="Тип источника">
                  <Select
                    value={[form.type || 'Интервью']}
                    options={['Интервью', 'Юзабилити-тест', 'Встреча', 'Отчёт'].map((value) => ({
                      value,
                      content: value,
                    }))}
                    onUpdate={(v) => field('type', v[0])}
                  />
                </FormField>
                <FormField label="Тема">
                  <TextInput
                    value={form.project || ''}
                    onUpdate={(v) => field('project', v)}
                    placeholder="Календарь и цены"
                  />
                </FormField>
              </div>
              <Switch
                checked={form.autoSummary !== false}
                onUpdate={(v) => field('autoSummary', v)}
                content="Создать сводку после обработки"
              />
              <p className="upload-summary-note">
                {form.autoSummary !== false
                  ? 'После обработки текст будет отправлен выбранной модели: ' +
                    (state.models.find((m) => m.id === state.modelId)?.name ||
                      'модель не выбрана') +
                    '. Сводка сохранится как черновик ИИ.'
                  : 'Текст останется в проекте. Сводку можно будет создать на странице материала.'}
              </p>
              <Notice>
                Файл сохранится в проекте. Текст из TXT, PDF и Word станет доступен для поиска.{' '}
                {state.processors.some((p) => p.id === 'whisper' && p.configured)
                  ? 'После загрузки запись автоматически попадёт в очередь распознавания.'
                  : 'Распознавание речи на этом сервере пока не установлено. Запись можно сохранить для обработки позже.'}{' '}
                Сводку можно создать на странице материала.
              </Notice>
            </>
          ) : null}
          {d?.type === 'source' ? (
            <>
              <div className="meta">
                <Folder size={14} />
                {study?.title} · {study?.type}
              </div>
              {segment ? (
                <>
                  <blockquote>
                    «{segment.correctedText ?? segment.text}»
                    <footer>
                      {segment.speaker} ·{' '}
                      {segment.page ? 'Стр. ' + segment.page : time(segment.time)}
                    </footer>
                  </blockquote>
                  <Button
                    view="action"
                    onClick={(e) => {
                      close();
                      go('study/' + d.studyId, d.segmentId, e.detail > 0);
                    }}
                  >
                    Открыть фрагмент {segment.page ? 'Стр. ' + segment.page : time(segment.time)}
                    <ArrowRight size={16} />
                  </Button>
                </>
              ) : (
                <>
                  <p className="dialog-copy">
                    У этой находки нет прямой цитаты. Это вопрос из демонстрационной внутренней
                    встречи.
                  </p>
                  <Button href={appHref('study/' + d.studyId)} onClick={close}>
                    Открыть материал
                  </Button>
                </>
              )}
            </>
          ) : null}
          {d?.type === 'processor' ? (
            <>
              <p className="dialog-copy">
                {state.processors.find((p) => p.id === d.id)?.name}: распознавание речи и LLM
                подключаются независимо. В этом прототипе модуль не установлен и не запускается.
              </p>
              <Notice>
                Параметры сервера и скорость обработки нужно проверять на реальном корпусе.
              </Notice>
            </>
          ) : null}
          {error && d?.type !== 'invite' ? (
            <p className={uploading ? 'muted' : 'form-error'} role={uploading ? 'status' : 'alert'}>
              {error}
            </p>
          ) : null}
        </Dialog.Body>
        <Dialog.Footer
          onClickButtonCancel={close}
          textButtonCancel={
            ['search', 'source', 'processor'].includes(d?.type) ? 'Закрыть' : 'Отмена'
          }
          {...(['upload', 'finding', 'model', 'invite', 'passport', 'workspace'].includes(d?.type)
            ? {
                onClickButtonApply: submit,
                propsButtonApply: { loading: uploading, disabled: uploading },
                textButtonApply: (
                  {
                    upload: state.processors.some((p) => p.id === 'whisper' && p.configured)
                      ? 'Загрузить и распознать'
                      : 'Загрузить файл',
                    finding: finding
                      ? d.accept
                        ? 'Принять с правкой'
                        : 'Сохранить'
                      : 'Сохранить находку',
                    model: 'Сохранить настройки',
                    invite: 'Создать приглашение',
                    passport: 'Сохранить паспорт',
                    workspace: 'Создать и перейти',
                  } as Partial<Record<string, string>>
                )[d.type],
              }
            : {})}
        />
      </Dialog>
      <ModelConnectionDialog open={d?.type === 'model'} model={model} ctx={ctx} onClose={close} />
    </>
  );
}
