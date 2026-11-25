import { useCompactLayout } from '../useCompactLayout.ts';
import {
  findingStatusLabel as statusLabel,
  findingStatusTheme as statusTheme,
} from '../finding-status.ts';
import { appHref, navigate, restoreRouteScroll } from '../routes.ts';
import { findingRepeats } from '../finding-repeats.ts';
import { useApp } from '../app-context.ts';
import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Checkbox,
  Dialog,
  Label,
  SegmentedRadioGroup,
  Select,
  Table,
} from '@gravity-ui/uikit';
import { ArrowRight, Check, Folder, Lightbulb, Pencil, RotateCcw, X } from 'lucide-react';
import type { Finding } from '../types.ts';
import { KINDS, importanceOrder } from '../state/constants.ts';
import { normalize } from '../state/normalize.ts';
import { plural, importanceTheme, actionLabel, stamp } from '../shared/format.ts';
import { IconButton, Empty } from '../shared/ui.tsx';
import { PageHeading } from '../shared/ProjectNavigation.tsx';

export function FindingMeta({
  f,
  showStatus,
  children,
}: {
  f: Finding;
  showStatus?: boolean;
  children?: React.ReactNode;
}) {
  const { reader } = useApp();
  return (
    <div className="finding-meta">
      {f.importSource ? <Label size="s">Из Гипотениума</Label> : null}
      {(showStatus === undefined ? !reader : showStatus) ? (
        <Label size="s" theme={statusTheme(f)}>
          {statusLabel(f)}
        </Label>
      ) : null}
      <Label size="s" theme={importanceTheme(f.importance)}>
        {f.importance}
      </Label>
      <Label size="s">{f.kind}</Label>
      {f.significant ? (
        <Label size="s" theme="utility">
          Статистически значимо
        </Label>
      ) : null}
      {f.basis === 'raw' ? (
        <Label size="s" theme="warning">
          По сырым данным
        </Label>
      ) : null}
      {children}
    </div>
  );
}

export function History({ f }: { f: Finding }) {
  return f.history?.length ? (
    <ol className="history" aria-label="История проверки">
      {f.history.map((h, i) => (
        <li key={i}>
          <strong>{h.by}</strong> {actionLabel[h.action] || h.action} · {stamp(h.at)}
        </li>
      ))}
    </ol>
  ) : null;
}

export function FindingCard({ f: raw, compact = false }: { f: Finding; compact?: boolean }) {
  const { state, openPanel, reader } = useApp();
  const f = normalize(raw);
  const s = state.studies.find((s) => s.id === f.studyId);
  return (
    <Card view="outlined" className="finding-card">
      <FindingMeta f={f} showStatus={!reader} />
      <h3>
        <button
          className="text-action"
          onClick={() => openPanel({ studyId: f.studyId, segmentId: f.segmentId, findingId: f.id })}
        >
          {f.title}
        </button>
      </h3>
      {compact ? null : <p>{f.description}</p>}
      <div className="meta">
        <Folder size={13} />
        {s?.title} · {s?.type}
      </div>
    </Card>
  );
}

export function Findings({ embedded = false }: { embedded?: boolean }) {
  const compact = useCompactLayout();
  useLayoutEffect(() => restoreRouteScroll(), []);
  const { state, update, open, route, notify, real, reader, projectName } = useApp();
  const repeats = useRepeats();
  const params = new URLSearchParams(route.split('?')[1] || '');
  const study = params.get('study');
  const onlyDrafts = !reader && params.get('status') === 'draft';
  const all = state.findings
    .map(normalize)
    .filter((f) => (!study || f.studyId === study) && (!onlyDrafts || f.status === 'draft'));
  const withoutDrafts = appHref('findings' + (study ? '?study=' + encodeURIComponent(study) : ''));
  const count = (k: Finding['status'] | 'all') =>
    all.filter((f) => k === 'all' || f.status === k).length;
  const status = 'all';
  const routeKind = KINDS.includes(params.get('kind') as any) ? params.get('kind')! : 'Все';
  const [kind, setKind] = useState(routeKind);
  useEffect(() => setKind(routeKind), [routeKind]);
  const changeKind = (value: string) => {
    setKind(value);
    const query = new URLSearchParams(route.split('?')[1] || '');
    if (value === 'Все') query.delete('kind');
    else query.set('kind', value);
    navigate('findings' + (query.size ? '?' + query.toString() : ''), true);
  };
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [confirm, setConfirm] = useState<'verified' | 'rejected' | null>(null);
  const list = all
    .filter(
      (f) =>
        (reader || status === 'all' || f.status === status) && (kind === 'Все' || f.kind === kind),
    )
    .sort(
      (a, b) =>
        importanceOrder[a.importance] - importanceOrder[b.importance] ||
        (repeats.get(b.id)?.materials || 1) - (repeats.get(a.id)?.materials || 1),
    );
  const studyInfo = study ? state.studies.find((s) => s.id === study) : undefined;
  const setStatusOf = async (ids: Set<string>, next: Finding['status'], message: string) => {
    if (
      !(await update((s) => ({
        findings: s.findings.map((x) => (ids.has(x.id) ? { ...normalize(x), status: next } : x)),
      })))
    )
      return false;
    setPicked(new Set());
    notify(message);
    return true;
  };
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const visibleIds = list.map((f) => f.id);
  const allPicked = visibleIds.length > 0 && visibleIds.every((id) => picked.has(id));
  const actions = (f: Finding) =>
    reader ? null : (
      <div className="row-actions">
        {f.status === 'draft' ? (
          <>
            <Button
              size="s"
              view="normal"
              onClick={() => setStatusOf(new Set([f.id]), 'verified', 'Находка принята.')}
            >
              <Check size={14} aria-hidden="true" />
              Принять
            </Button>
            <IconButton
              size="s"
              icon={Pencil}
              label={'Принять с правкой: ' + f.title}
              onClick={() => open({ type: 'finding', findingId: f.id, accept: true })}
            />
            <IconButton
              size="s"
              icon={X}
              label={'Отклонить: ' + f.title}
              onClick={() => setStatusOf(new Set([f.id]), 'rejected', 'Находка отклонена.')}
            />
          </>
        ) : f.status === 'verified' ? (
          <>
            <IconButton
              size="s"
              icon={Pencil}
              label={'Изменить: ' + f.title}
              onClick={() => open({ type: 'finding', findingId: f.id })}
            />
            <IconButton
              size="s"
              icon={RotateCcw}
              label={'Вернуть на проверку: ' + f.title}
              onClick={() =>
                setStatusOf(
                  new Set([f.id]),
                  'draft',
                  'Находка возвращена на проверку и скрыта от участников с просмотром.',
                )
              }
            />
          </>
        ) : (
          <Button
            size="s"
            view="flat"
            onClick={() => setStatusOf(new Set([f.id]), 'draft', 'Находка возвращена на проверку.')}
          >
            <RotateCcw size={14} aria-hidden="true" />
            Вернуть на проверку
          </Button>
        )}
      </div>
    );
  const candidate =
    import.meta.env.VITE_DESIGN_WORKBENCH === 'true'
      ? new URLSearchParams(location.search).get('__variant')
      : null;
  const structure = candidate && ['rows', 'cards'].includes(candidate) ? candidate : 'table';
  const columns = [
    ...(reader
      ? []
      : [
          {
            id: 'pick',
            name: () => (
              <Checkbox
                checked={allPicked}
                indeterminate={!allPicked && visibleIds.some((id) => picked.has(id))}
                onUpdate={(v) => setPicked(v ? new Set(visibleIds) : new Set())}
                controlProps={{ 'aria-label': 'Выбрать все находки в списке' }}
              />
            ),
            template: (f: Finding) => (
              <Checkbox
                checked={picked.has(f.id)}
                onUpdate={() => toggle(f.id)}
                controlProps={{ 'aria-label': 'Выбрать: ' + f.title }}
              />
            ),
            width: 44,
          },
        ]),
    {
      id: 'title',
      name: 'Находка',
      className: 'finding-title-column',
      template: (f: Finding) => (
        <div className="finding-cell">
          <a className="text-action" href={appHref('finding/' + f.id)}>
            {f.title}
          </a>
          <small>
            {[
              f.kind,
              state.studies.find((s) => s.id === f.studyId)?.title,
              f.significant ? 'статистически значимо' : '',
              f.basis === 'raw' ? 'по сырым данным' : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </small>
        </div>
      ),
    },
    {
      id: 'importance',
      name: 'Важность',
      width: 104,
      template: (f: Finding) => (
        <Label size="s" theme={importanceTheme(f.importance)}>
          {f.importance}
        </Label>
      ),
    },
    {
      id: 'repeats',
      name: 'Повторы',
      width: 112,
      align: 'end' as const,
      className: 'table-secondary table-number',
      template: (f: Finding) => {
        const n = repeats.get(f.id)?.materials || 1;
        return n > 1 ? (
          <span className="repeat-cell" title="Похожие находки по совпадению слов">
            {repeatPlace(n)}
          </span>
        ) : (
          <span className="muted" aria-label="Повторов нет">
            —
          </span>
        );
      },
    },
    ...(reader
      ? []
      : [
          {
            id: 'review',
            name: 'Проверка',
            width: 288,
            template: (f: Finding) => (
              <div className="review-cell">
                <Label size="s" theme={statusTheme(f)}>
                  {statusLabel(f)}
                </Label>
                {actions(f)}
              </div>
            ),
          },
        ]),
  ];
  return (
    <>
      {embedded ? (
        <div className="section-heading">
          <h2 id="project-findings-title">
            Находки <span className="heading-count">{all.length}</span>
          </h2>
        </div>
      ) : (
        <PageHeading
          back={studyInfo ? { href: appHref('home'), label: 'К проекту' } : undefined}
          tabs={!studyInfo}
          overline={studyInfo?.title}
          title={studyInfo ? 'Находки' : projectName}
          action={
            studyInfo ? (
              <a className="section-all" href={appHref('findings')}>
                Все находки
                <ArrowRight size={14} aria-hidden="true" />
              </a>
            ) : null
          }
        >
          {reader
            ? 'Проверенные выводы со ссылками на исходные материалы.'
            : 'Находки, предложенные ИИ, участники с просмотром увидят после проверки.'}
        </PageHeading>
      )}
      {all.length || onlyDrafts ? (
        <div className={compact ? 'toolbar mobile-finding-toolbar' : 'toolbar'}>
          {compact ? (
            <Select
              width="max"
              size="xl"
              value={[kind]}
              onUpdate={(values) => changeKind(values[0] || 'Все')}
              aria-label="Тип находки"
              options={['Все', ...KINDS].map((value) => ({
                value,
                content:
                  value +
                  ' (' +
                  all.filter((f) => value === 'Все' || f.kind === value).length +
                  ')',
              }))}
            />
          ) : (
            <SegmentedRadioGroup
              value={kind}
              onUpdate={setKind}
              name="Тип находки"
              options={['Все', ...KINDS].map((value) => ({
                value,
                content: (
                  <>
                    {value}
                    <span className="kind-count">
                      {all.filter((f) => value === 'Все' || f.kind === value).length}
                    </span>
                  </>
                ),
              }))}
            />
          )}
          {onlyDrafts ? (
            <Button
              size="m"
              view="normal"
              selected
              href={withoutDrafts}
              aria-label="Только находки, которые ждут проверки — снять фильтр"
            >
              Ждут проверки
              <X size={14} />
            </Button>
          ) : null}
          {!compact || !list.length ? (
            <span className="muted" role="status">
              {plural(list.length, 'находка', 'находки', 'находок')}
            </span>
          ) : null}
        </div>
      ) : null}
      {list.length ? (
        compact ? (
          <>
            <div className="mobile-finding-selection">
              {!reader ? (
                <Checkbox
                  checked={allPicked}
                  indeterminate={!allPicked && visibleIds.some((id) => picked.has(id))}
                  onUpdate={(v) => setPicked(v ? new Set(visibleIds) : new Set())}
                  content="Выбрать все"
                />
              ) : null}
              <span role="status">{plural(list.length, 'находка', 'находки', 'находок')}</span>
            </div>
            <ul
              className="mobile-finding-list project-mobile-findings"
              aria-label="Находки проекта"
            >
              {list.map((f) => (
                <li key={f.id}>
                  <div className="mobile-finding-heading">
                    <a className="mobile-finding-title" href={appHref('finding/' + f.id)}>
                      {f.title}
                    </a>
                    {!reader ? (
                      <span className="mobile-row-select">
                        <Checkbox
                          checked={picked.has(f.id)}
                          onUpdate={() => toggle(f.id)}
                          controlProps={{ 'aria-label': 'Выбрать: ' + f.title }}
                        />
                      </span>
                    ) : null}
                  </div>
                  <div className="mobile-finding-meta">
                    <Label size="s" theme={importanceTheme(f.importance)}>
                      {f.importance}
                    </Label>
                    <Label size="s" theme={statusTheme(f)}>
                      {statusLabel(f)}
                    </Label>
                    <span>{f.kind}</span>
                  </div>
                  <p className="mobile-finding-project">
                    {state.studies.find((study) => study.id === f.studyId)?.title}
                  </p>
                  <div className="mobile-finding-review">
                    <span>
                      {(repeats.get(f.id)?.materials || 1) > 1
                        ? repeatPlace(repeats.get(f.id)?.materials || 1)
                        : 'Один материал'}
                    </span>
                    {actions(f)}
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : structure === 'table' ? (
          <div
            className={'table-scroll findings-table' + (reader ? ' findings-table_readonly' : '')}
            tabIndex={0}
            aria-label="Находки. Таблицу можно прокрутить"
          >
            <Table
              aria-label="Находки проекта"
              data={list}
              getRowId={(f) => f.id}
              columns={columns}
            />
          </div>
        ) : (
          <>
            {!reader ? (
              <div className="finding-collection-select">
                <Checkbox
                  checked={allPicked}
                  indeterminate={!allPicked && visibleIds.some((id) => picked.has(id))}
                  onUpdate={(v) => setPicked(v ? new Set(visibleIds) : new Set())}
                  content="Выбрать все"
                  controlProps={{ 'aria-label': 'Выбрать все находки в списке' }}
                />
              </div>
            ) : null}
            <div className={'finding-collection finding-collection-' + structure} role="list">
              {list.map((f) => (
                <article className="finding-collection-item" role="listitem" key={f.id}>
                  <div className="finding-collection-leading">
                    {reader ? null : (
                      <Checkbox
                        checked={picked.has(f.id)}
                        onUpdate={() => toggle(f.id)}
                        controlProps={{ 'aria-label': 'Выбрать: ' + f.title }}
                      />
                    )}
                    <FindingCard f={f} compact />
                  </div>
                  {actions(f)}
                </article>
              ))}
            </div>
          </>
        )
      ) : (
        <Empty
          icon={Lightbulb}
          title={
            onlyDrafts && !all.length
              ? 'Все находки проверены'
              : all.length
                ? 'Нет находок с таким фильтром'
                : 'Находок пока нет'
          }
          action={
            onlyDrafts && !all.length ? (
              <Button href={withoutDrafts}>Показать все находки</Button>
            ) : all.length ? (
              <Button onClick={() => setKind('Все')}>Показать все находки</Button>
            ) : undefined
          }
        >
          {onlyDrafts && !all.length
            ? 'Новые черновики появятся после анализа материалов.'
            : all.length
              ? 'Выберите другой тип.'
              : reader
                ? 'Здесь появятся находки, которые проверила команда проекта.'
                : 'После анализа материалов здесь появятся черновики со ссылками на источники.'}
        </Empty>
      )}
      {!reader && picked.size ? (
        <div className="bulk-bar" role="region" aria-label="Действия с выбранными находками">
          <div className="bulk-selection">
            <strong>Выбрано: {picked.size}</strong>
            <Button view="flat" size="s" onClick={() => setPicked(new Set())}>
              Снять выбор
            </Button>
          </div>
          <div className="bulk-actions">
            <Button view="action" onClick={() => setConfirm('verified')}>
              <Check size={16} />
              Принять выбранные
            </Button>
            <Button view="outlined" onClick={() => setConfirm('rejected')}>
              <X size={16} />
              Отклонить выбранные
            </Button>
          </div>
        </div>
      ) : null}
      <Dialog open={Boolean(confirm)} onClose={() => setConfirm(null)} size="s">
        <Dialog.Header
          caption={confirm === 'verified' ? 'Принять находки?' : 'Отклонить находки?'}
        />
        <Dialog.Body>
          <p className="dialog-copy">
            {confirm === 'verified'
              ? plural(
                  picked.size,
                  'находка станет видна всем участникам и попадёт',
                  'находки станут видны всем участникам и попадут',
                  'находок станут видны всем участникам и попадут',
                ) + ' в паспорт исследования.'
              : plural(
                  picked.size,
                  'находка не будет видна',
                  'находки не будут видны',
                  'находок не будут видны',
                ) + ' участникам с просмотром. Их можно вернуть на проверку.'}
          </p>
        </Dialog.Body>
        <Dialog.Footer
          onClickButtonCancel={() => setConfirm(null)}
          textButtonCancel="Отмена"
          onClickButtonApply={async () => {
            if (!confirm) return;
            if (
              await setStatusOf(
                new Set(picked),
                confirm,
                confirm === 'verified' ? 'Находки приняты.' : 'Находки отклонены.',
              )
            )
              setConfirm(null);
          }}
          textButtonApply={
            confirm === 'verified' ? 'Принять · ' + picked.size : 'Отклонить · ' + picked.size
          }
          propsButtonApply={{ view: confirm === 'verified' ? 'action' : 'outlined-danger' }}
        />
      </Dialog>
    </>
  );
}

// Repeats are counted inside the current project among findings the viewer may see.
const repeatPlace = (n: number) => 'в ' + n + ' материалах';

export function useRepeats() {
  const { state } = useApp();
  return useMemo(() => findingRepeats(state.findings.map(normalize)), [state.findings]);
}

const KIND_TABS: [string, string][] = [
  ['Проблема', 'Проблемы'],
  ['Инсайт', 'Инсайты'],
  ['Рекомендация', 'Рекомендации'],
  ['Цифра', 'Цифры'],
];

/** Five segments: the share of ready materials where the finding repeats, coloured by importance. */
function Strength({
  value,
  total,
  importance,
}: {
  value: number;
  total: number;
  importance: string;
}) {
  const filled = Math.max(1, Math.min(5, Math.round((5 * value) / Math.max(total, 1))));
  return (
    <span className="strength" data-tone={importanceTheme(importance)} aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <i key={i} data-on={i < filled ? '' : undefined} />
      ))}
    </span>
  );
}

export function FindingsDigest() {
  const { state, reader } = useApp();
  const repeats = useRepeats();
  const [kind, setKind] = useState('Все');
  const compact = useCompactLayout();
  const shown = state.findings.map(normalize).filter((f) => f.status !== 'rejected');
  const rank = (f: Finding) => (f.status === 'verified' ? 0 : 10) + importanceOrder[f.importance];
  const materialCount = (f: Finding) => repeats.get(f.id)?.materials || 1;
  const ready = state.studies.filter((s) => s.status === 'ready').length;
  const repeatText = (n: number) =>
    n + ' из ' + plural(Math.max(ready, n), 'материала', 'материалов', 'материалов');
  const title = (id?: string) => state.studies.find((s) => s.id === id)?.title;
  const sources = (f: Finding) => {
    const names = [
      ...new Set(
        [
          f.studyId,
          ...(repeats.get(f.id)?.similar || []).map(
            (id) => shown.find((x) => x.id === id)?.studyId,
          ),
        ]
          .map(title)
          .filter(Boolean),
      ),
    ];
    return names.length > 2
      ? names.slice(0, 2).join(', ') + ' и ещё ' + (names.length - 2)
      : names.join(', ');
  };
  const tabs = KIND_TABS.filter(([k]) => shown.some((f) => f.kind === k));
  const active = kind === 'Все' || tabs.some(([k]) => k === kind) ? kind : 'Все';
  const top = shown
    .filter((f) => active === 'Все' || f.kind === active)
    .sort((a, b) => rank(a) - rank(b) || materialCount(b) - materialCount(a))
    .slice(0, 5);
  return (
    <section className="findings-digest" aria-labelledby="project-findings-title">
      <div className="section-heading">
        <h2 id="project-findings-title">
          Находки{shown.length ? <span className="section-count">{shown.length}</span> : null}
        </h2>
        {shown.length > 0 && (
          <a className="section-all" href={appHref('findings')}>
            Все находки
            <ArrowRight size={14} aria-hidden="true" />
          </a>
        )}
      </div>
      {tabs.length > 1 &&
        (() => {
          const options = [
            ['Все', 'Все', shown.length],
            ...tabs.map(([k, l]) => [k, l, shown.filter((f) => f.kind === k).length]),
          ] as [string, string, number][];
          // Phones get the same Select as the findings page: four segments do not fit 358 px.
          return (
            <div className="toolbar digest-filters">
              {compact ? (
                <Select
                  width="max"
                  size="xl"
                  label="Тип:"
                  value={[active]}
                  onUpdate={(v) => setKind(v[0] || 'Все')}
                  options={options.map(([value, label, n]) => ({
                    value,
                    content: label + ' · ' + n,
                  }))}
                />
              ) : (
                <SegmentedRadioGroup
                  value={active}
                  onUpdate={setKind}
                  name="Тип находки"
                  options={options.map(([value, label, n]) => ({
                    value,
                    content: (
                      <>
                        {label}
                        <span className="segment-count">{n}</span>
                      </>
                    ),
                  }))}
                />
              )}
            </div>
          );
        })()}
      {top.length ? (
        <ol className="digest-list" role="list">
          {top.map((f) => (
            <li key={f.id}>
              <a href={appHref('finding/' + f.id)}>
                <span className="digest-title">{f.title}</span>
                <span className="digest-meta">
                  {!reader && f.status !== 'verified' ? (
                    <Label size="s" theme={statusTheme(f)}>
                      {statusLabel(f)}
                    </Label>
                  ) : null}
                  <Label size="s" theme={importanceTheme(f.importance)}>
                    {f.importance}
                  </Label>
                  <Strength value={materialCount(f)} total={ready} importance={f.importance} />
                  <span title="Повторяемость: похожие формулировки в разных материалах">
                    {repeatText(materialCount(f))}
                  </span>
                  <span className="digest-sources">{sources(f)}</span>
                </span>
              </a>
            </li>
          ))}
        </ol>
      ) : (
        <p className="digest-empty">
          {reader
            ? 'Здесь появятся находки, которые проверила команда проекта.'
            : 'Находки появятся после анализа материалов.'}
        </p>
      )}
    </section>
  );
}
