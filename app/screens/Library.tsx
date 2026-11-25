import { useCompactLayout } from '../useCompactLayout.ts';
import { formatFileSize } from '../file-size.ts';
import { appHref } from '../routes.ts';
import { projectFileDownload } from '../api.ts';
import { useApp } from '../app-context.ts';
import { useState } from 'react';
import { Button, SegmentedRadioGroup, Table } from '@gravity-ui/uikit';
import {
  Download,
  File,
  FileAudio,
  FileSpreadsheet,
  FileText,
  FileType,
  FileVideo,
  Folder,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Study } from '../types.ts';
import { materialDate } from '../shared/format.ts';
import { Empty, Status } from '../shared/ui.tsx';
import { PageHeading, AddMaterial } from '../shared/ProjectNavigation.tsx';

export const sourceIcons: Record<string, LucideIcon> = {
  mp4: FileVideo,
  mov: FileVideo,
  webm: FileVideo,
  mp3: FileAudio,
  wav: FileAudio,
  m4a: FileAudio,
  pdf: FileType,
  doc: FileText,
  docx: FileText,
  txt: FileText,
  xls: FileSpreadsheet,
  xlsx: FileSpreadsheet,
};

function MaterialLink({ study }: { study: Study }) {
  const ext = study.fileName
    ?.trim()
    .match(/^.+\.([a-z0-9]{1,12})$/i)?.[1]
    ?.toLowerCase();
  const Icon = ext && Object.hasOwn(sourceIcons, ext) ? sourceIcons[ext] : File;
  const topic = study.project?.trim();
  const title =
    ext &&
    !study.title
      .trimEnd()
      .toLowerCase()
      .endsWith('.' + ext)
      ? study.title + '.' + ext
      : study.title;
  return (
    <a className="table-study" href={appHref('study/' + study.id)} title={title}>
      <Icon size={20} aria-hidden="true" style={{ flexShrink: 0 }} />
      <span>
        <strong>{title}</strong>
        {topic && topic !== 'Без темы' && <small>{topic}</small>}
      </span>
    </a>
  );
}

function StudyTable({ studies }: { studies: Study[] }) {
  const compact = useCompactLayout();
  if (compact)
    return (
      <ul className="mobile-material-list" aria-label="Материалы проекта">
        {studies
          .toSorted((a, b) => Number(b.type === 'Отчёт') - Number(a.type === 'Отчёт'))
          .map((study) => (
            <li key={study.id}>
              <div className="mobile-material-heading">
                <MaterialLink study={study} />
                {study.fileId ? (
                  <a
                    className="mobile-download"
                    href={projectFileDownload(study.fileId)}
                    download={study.fileName || study.title}
                    aria-label={'Скачать «' + (study.fileName || study.title) + '»'}
                  >
                    <Download size={20} aria-hidden="true" />
                  </a>
                ) : null}
              </div>
              <div className="mobile-material-meta">
                <span>{study.type}</span>
                <span>{formatFileSize(study.fileSize)}</span>
                <time dateTime={study.date}>
                  {materialDate.format(new Date(study.date + 'T12:00:00')).replace(/\s*г\.$/u, '')}
                </time>
              </div>
              <Status study={study} />
            </li>
          ))}
      </ul>
    );
  return (
    <div
      className="table-scroll study-table"
      tabIndex={0}
      aria-label="Материалы. Таблицу можно прокрутить"
    >
      <Table
        aria-label="Материалы"
        data={studies.toSorted((a, b) => Number(b.type === 'Отчёт') - Number(a.type === 'Отчёт'))}
        columns={[
          { id: 'title', name: 'Материал', template: (s) => <MaterialLink study={s} /> },
          { id: 'type', name: 'Тип', width: 112, className: 'table-secondary' },
          {
            id: 'date',
            name: 'Добавлено',
            width: 136,
            className: 'table-secondary',
            template: (s) => (
              <time dateTime={s.date} style={{ whiteSpace: 'nowrap' }}>
                {materialDate.format(new Date(s.date + 'T12:00:00')).replace(/\s*г\.$/u, '')}
              </time>
            ),
          },
          {
            id: 'size',
            name: 'Размер',
            width: 104,
            align: 'end',
            className: 'table-secondary table-number',
            template: (s) => (
              <span
                className="file-size"
                title={
                  typeof s.fileSize === 'number' && Number.isSafeInteger(s.fileSize)
                    ? s.fileSize.toLocaleString('ru-RU') + ' байт'
                    : 'Размер файла неизвестен'
                }
              >
                {formatFileSize(s.fileSize)}
              </span>
            ),
          },
          {
            id: 'status',
            name: 'Статус',
            width: 160,
            className: 'status-column',
            template: (s) => <Status study={s} />,
          },
          {
            id: 'download',
            name: () => <span className="sr-only">Скачать</span>,
            width: 56,
            align: 'end',
            template: (s) =>
              s.fileId ? (
                <a
                  className="table-download"
                  href={projectFileDownload(s.fileId)}
                  download={s.fileName || s.title}
                  aria-label={'Скачать «' + (s.fileName || s.title) + '»'}
                  title="Скачать файл"
                >
                  <Download size={16} aria-hidden="true" />
                </a>
              ) : (
                <span />
              ),
          },
        ]}
        getRowId={(s) => s.id}
      />
    </div>
  );
}

export function LibraryPage() {
  return <ResearchList />;
}

function ResearchList({ embedded = false }: { embedded?: boolean }) {
  const { state, projectName, reader } = useApp();
  const [filter, setFilter] = useState('Все');
  const list = state.studies.filter(
    (s) =>
      filter === 'Все' ||
      (filter === 'Видео'
        ? s.format === 'Видео'
        : filter === 'Отчёты'
          ? s.format !== 'Видео'
          : s.type === 'Встреча'),
  );
  return (
    <>
      {embedded ? (
        <div className="section-heading research-heading">
          <h2>Материалы</h2>
          <AddMaterial />
        </div>
      ) : (
        <PageHeading title={projectName} tabs />
      )}
      <div className="toolbar material-filters">
        <div className="material-filter-strip">
          <SegmentedRadioGroup
            size="m"
            value={filter}
            onUpdate={setFilter}
            name="Тип материала"
            options={['Все', 'Видео', 'Отчёты', 'Встречи'].map((value) => ({
              value,
              content: value,
            }))}
          />
        </div>
        {!embedded ? <AddMaterial /> : null}
      </div>
      {!state.studies.length ? (
        <div className="project-empty">
          <span className="project-folder">
            <Folder size={32} strokeWidth={1.5} />
          </span>
          <h2>Здесь будут ваши материалы</h2>
          <p>
            PDF, DOCX, DOC, аудио и видео. Откройте запись, чтобы посмотреть текст, сводку и
            находки.
          </p>
          {reader ? <p>Попросите участника с полным доступом добавить материалы.</p> : null}
        </div>
      ) : !list.length ? (
        <Empty
          title="Материалы не найдены"
          action={<Button onClick={() => setFilter('Все')}>Сбросить фильтры</Button>}
        >
          Выберите другой тип материала.
        </Empty>
      ) : (
        <StudyTable studies={list} />
      )}
    </>
  );
}
