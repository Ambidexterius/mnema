import { useCompactLayout } from '../useCompactLayout.ts';
import { appHref, readRoute } from '../routes.ts';
import { useApp } from '../app-context.ts';
import React from 'react';
import { Button, Tab, TabList, Tooltip } from '@gravity-ui/uikit';
import { ArrowLeft, Folder, Lightbulb, Plus } from 'lucide-react';
import type { Finding } from '../types.ts';

export function PageHeading({
  overline,
  title,
  children,
  action,
  back,
  tabs,
}: {
  overline?: string;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  back?: { href: string; label: string };
  tabs?: boolean;
}) {
  const navigation =
    back || (tabs ? { href: appHref('research'), label: 'Назад к проектам' } : undefined);
  return (
    <div className="page-heading">
      <div>
        {overline ? <div className="overline">{overline}</div> : null}
        <div className="page-title-row">
          {navigation ? (
            <Tooltip content={navigation.label}>
              <a className="page-back" href={navigation.href} aria-label={navigation.label}>
                <ArrowLeft size={20} aria-hidden="true" />
              </a>
            </Tooltip>
          ) : null}
          <h1>{title}</h1>
        </div>
        {tabs ? <ProjectTabs /> : null}
        {children ? <p>{children}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** Sections of a project, under the page title: overview, findings, materials with counts. */
function ProjectTabs() {
  const { state, route } = useApp();
  const mobile = useCompactLayout();
  const path = route.split('?')[0];
  const current = path.startsWith('study/')
    ? 'library'
    : path.startsWith('finding/')
      ? 'findings'
      : path;
  const findings = state.findings.filter((f) => f.status !== 'rejected').length;
  const tabs = [
    { id: 'home', label: 'Обзор' },
    { id: 'findings', label: 'Находки', count: findings },
    { id: 'library', label: mobile ? 'Документы' : 'Материалы', count: state.studies.length },
  ];
  return (
    <TabList
      className="project-tabs"
      aria-label="Разделы проекта"
      value={current}
      size={mobile ? 'l' : 'm'}
      contentOverflow="scroll"
    >
      {tabs.map(({ id, label, count }) => (
        <Tab
          key={id}
          value={id}
          href={appHref(id)}
          counter={count || undefined}
          onKeyDown={(e) => {
            if (e.key === ' ') {
              e.preventDefault();
              e.currentTarget.click();
            }
          }}
        >
          {label}
        </Tab>
      ))}
    </TabList>
  );
}

export function ProjectBreadcrumbs({
  project,
  studyTitle,
}: {
  project?: string;
  studyTitle?: string;
}) {
  const compact = useCompactLayout();
  if (compact) {
    if (!studyTitle)
      return (
        <nav className="mobile-path mobile-path-parent" aria-label="Путь">
          <a href={appHref('research')}>
            <Folder size={16} aria-hidden="true" />
            <span>Проекты</span>
          </a>
        </nav>
      );
    const back = history.state?.returnTo || appHref('library'),
      label = readRoute(new URL(back, location.href)).route.startsWith('finding/')
        ? 'Находка'
        : 'Документы';
    return (
      <nav className="mobile-path" aria-label="Путь">
        <a href={back} aria-label={label === 'Находка' ? 'Назад к находке' : 'Назад к документам'}>
          <ArrowLeft size={24} aria-hidden="true" />
          <span>{label}</span>
        </a>
      </nav>
    );
  }
  return (
    <nav className="breadcrumbs" aria-label="Путь">
      <Folder size={16} aria-hidden="true" />
      {project ? (
        <a className="breadcrumb-root" href={appHref('research')}>
          Проекты
        </a>
      ) : (
        <span className="breadcrumb-root" aria-current="page">
          Проекты
        </span>
      )}
      {project ? (
        <>
          <span
            className={'breadcrumb-separator' + (studyTitle ? ' breadcrumb-project-separator' : '')}
            aria-hidden="true"
          >
            /
          </span>
          {studyTitle ? (
            <a className="breadcrumb-project" href={appHref('home')} title={project}>
              {project}
            </a>
          ) : (
            <span aria-current="page" title={project}>
              {project}
            </span>
          )}
        </>
      ) : null}
      {studyTitle ? (
        <>
          <span className="breadcrumb-separator" aria-hidden="true">
            /
          </span>
          <span aria-current="page" title={studyTitle}>
            {studyTitle}
          </span>
        </>
      ) : null}
    </nav>
  );
}

export function FindingsBreadcrumbs({
  project,
  finding,
  studyTitle,
}: {
  project?: string;
  finding?: Finding;
  studyTitle?: string;
}) {
  const rootIcon = project ? null : <Lightbulb size={16} aria-hidden="true" />;
  const root = history.state?.findingsRoot || (project ? appHref('findings') : '/all-findings');
  const compact = useCompactLayout();
  if (compact) {
    if (!studyTitle)
      return project ? (
        <nav className="mobile-path mobile-path-parent" aria-label="Путь">
          <a href={appHref('research')}>
            <Folder size={16} aria-hidden="true" />
            <span>Проекты</span>
          </a>
        </nav>
      ) : (
        <nav className="mobile-path" aria-label="Путь">
          <a href={root}>
            {rootIcon}
            <span>Находки</span>
          </a>
        </nav>
      );
    const back = finding ? appHref('finding/' + finding.id) : root,
      label = finding ? 'Находка' : 'Находки';
    return (
      <nav className="mobile-path" aria-label="Путь">
        <a href={back} aria-label={finding ? 'Назад к находке' : 'Назад к находкам'}>
          <ArrowLeft size={24} aria-hidden="true" />
          <span>{label}</span>
        </a>
      </nav>
    );
  }
  return (
    <nav className="breadcrumbs" aria-label="Путь">
      {project ? (
        <>
          <Folder size={16} aria-hidden="true" />
          <a className="breadcrumb-root" href={appHref('research')}>
            Проекты
          </a>
          <span className="breadcrumb-separator" aria-hidden="true">
            /
          </span>
          <a className="breadcrumb-project" href={appHref('home')}>
            {project}
          </a>
          <span className="breadcrumb-separator" aria-hidden="true">
            /
          </span>
        </>
      ) : null}
      {rootIcon}
      {!project || finding || studyTitle ? (
        <a href={root}>Находки</a>
      ) : (
        <span aria-current="page">Находки</span>
      )}
      {finding ? (
        <>
          <span className="breadcrumb-separator" aria-hidden="true">
            /
          </span>
          {studyTitle ? (
            <a href={appHref('finding/' + finding.id)}>{finding.title}</a>
          ) : (
            <span aria-current="page">{finding.title}</span>
          )}
        </>
      ) : null}
      {studyTitle ? (
        <>
          <span className="breadcrumb-separator" aria-hidden="true">
            /
          </span>
          <span aria-current="page">{studyTitle}</span>
        </>
      ) : null}
    </nav>
  );
}

export function AddMaterial() {
  const compact = useCompactLayout();
  const { open, reader } = useApp();
  return reader ? null : (
    <Button view="action" size="l" onClick={() => open({ type: 'upload' })}>
      <Plus size={16} />
      Добавить
    </Button>
  );
}
