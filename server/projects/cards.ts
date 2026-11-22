import { studiesForReader } from '../analysis/evidence.ts';
import type { WorkspaceReader } from './store.ts';

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
  const projectCard = (m: any) => {
    const key = m.version + ':' + m.data_length + ':' + m.role;
    const cached = projectCards.get(m.id);
    if (cached?.key === key) return cached.card;
    const state = readWorkspace(m.id)?.state;
    const files = (
      m.role === 'full' ? state.studies : studiesForReader(state.studies, state.findings)
    ).filter((study) => study.fileId);
    const processingOwners = new Set<string>();
    for (const study of files)
      if (
        study.format === 'Видео' &&
        study.uploadedById &&
        (study.status === 'processing' || ['queued', 'running'].includes(study.speakerInfo?.state))
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
