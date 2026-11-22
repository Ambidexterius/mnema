import React, { useLayoutEffect, useRef, useState } from 'react';
import { Tooltip } from '@gravity-ui/uikit';
import { Folder, Link, Lock } from 'lucide-react';
import { fileCount, ProjectMenu, type ProjectRef } from './ProjectActions.tsx';

export function CatalogProjectAccess({
  mode,
  inTable = false,
}: {
  mode: ProjectRef['sharingMode'];
  inTable?: boolean;
}) {
  if (mode === 'private')
    return (
      <span
        className="project-catalog-access"
        aria-label={inTable ? undefined : 'Приватный проект'}
        role={inTable ? undefined : 'img'}
      >
        <Lock size={14} aria-hidden="true" />
        {inTable ? 'Закрытый доступ' : null}
      </span>
    );
  if (mode === 'link')
    return (
      <span className="project-catalog-access">
        <Link size={14} aria-hidden="true" />
        По ссылке
      </span>
    );
  return inTable ? (mode === 'all' ? 'Команда' : '—') : null;
}

export default function ProjectCatalogCard({
  project,
  onOpen,
  onAction,
}: {
  project: ProjectRef;
  onOpen: () => void;
  onAction?: (action: string, project: ProjectRef) => void;
}) {
  const titleRef = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);
  useLayoutEffect(() => {
    const title = titleRef.current;
    if (!title) return;
    const measure = () => setTruncated(title.scrollHeight > title.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(title);
    return () => observer.disconnect();
  }, [project.name]);

  const access =
    project.sharingMode === 'private'
      ? ' · Приватный'
      : project.sharingMode === 'link'
        ? ' · По ссылке'
        : '';
  return (
    <article
      className="project-card project-catalog-card"
      data-access={project.sharingMode}
      data-has-menu={Boolean(onAction)}
    >
      <div className="project-catalog-surface">
        <Tooltip
          content={<span className="project-full-name">{project.name}</span>}
          disabled={!truncated}
          strategy="fixed"
          placement={['bottom-start', 'top-start']}
          openDelay={400}
        >
          <button
            className="project-catalog-open"
            type="button"
            onClick={onOpen}
            aria-label={'Открыть проект «' + project.name + '»' + access}
          >
            <span className="project-catalog-header">
              <span className="project-catalog-icon">
                <Folder size={18} aria-hidden="true" />
              </span>
              <span className="project-catalog-title" ref={titleRef} dir="auto">
                {project.name}
              </span>
            </span>
            <span className="project-catalog-footer">
              <span>{fileCount(project.fileCount ?? 0)}</span>
              <CatalogProjectAccess mode={project.sharingMode} />
            </span>
          </button>
        </Tooltip>
        {onAction ? <ProjectMenu project={project} onAction={onAction} /> : null}
      </div>
    </article>
  );
}
