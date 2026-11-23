import { studiesForReader } from '../analysis/evidence.ts';
import { fail } from '../http.ts';
import type { WorkspaceReader } from './store.ts';
import type { Role } from '../../app/types.ts';

export function createProjectCards(readWorkspace: WorkspaceReader) {
  // Every request lists the user's projects. Parsing each project's full transcripts here made
  // project switching and polling slow, so folder cards are cached per stored revision and role.
  const projectCards = new Map<
    string,
    {
      key: string;
      card: {
        fileCount: number;
        filePreviews: { name: string; format: string }[];
        studyCount: number;
        processingOwners: Set<string>;
      };
    }
  >();
  const projectCard = (m: {
    id: string;
    version: number;
    data_length: number | string | null;
    role: Role;
  }) => {
    const key = m.version + ':' + m.data_length + ':' + m.role;
    const cached = projectCards.get(m.id);
    if (cached?.key === key) return cached.card;
    const state = readWorkspace(m.id)?.state;
    if (!state) fail(404, 'Проект не найден.');
    const files = (
      m.role === 'full' ? state.studies : studiesForReader(state.studies, state.findings)
    ).filter((study) => study.fileId);
    const processingOwners = new Set<string>();
    for (const study of files)
      if (
        study.format === 'Видео' &&
        study.uploadedById &&
        (study.status === 'processing' ||
          study.speakerInfo?.state === 'queued' ||
          study.speakerInfo?.state === 'running')
      )
        processingOwners.add(study.uploadedById);
    const card = {
      fileCount: files.length,
      filePreviews: files.slice(0, 3).map((study) => ({
        name: study.fileName || study.title || 'Материал',
        format: (study.fileName?.split('.').at(-1) || study.format || '').toUpperCase(),
      })),
      studyCount: state.studies.length,
      processingOwners,
    };
    projectCards.set(m.id, { key, card });
    return card;
  };
  return projectCard;
}
