import type {
  ChatSource,
  Finding,
  ModelConnection,
  ReportStatus,
  Study,
  WorkspaceState,
} from '../../app/types.ts';
import type { Person } from '../request-context.ts';

export type InviteToProject = (
  person: Person,
  input: Record<string, unknown>,
) => Promise<{ emailStatus: string; inviteURL?: string; added?: boolean }>;

export type StoredModel = ModelConnection & { builtin?: boolean };
export type StoredStudy = Study & {
  importSource?: {
    provider: string;
    fileId?: string;
    catalog?: boolean;
    sha256?: string;
    url?: string;
    transcriptImported?: boolean;
  };
  autoSummary?: { modelId: string; requestedBy: string };
};
export type StoredFinding = Finding & { verified?: boolean; priority?: string };

export interface ProjectProfile {
  category: string;
  conducted: string;
  method: string;
  audience: string;
  contact: string;
  report: ReportStatus | '';
  tags?: string[];
  revision: number;
}

interface ProjectSummary {
  answer: string;
  sources?: (Pick<ChatSource, 'studyId' | 'segmentId' | 'text'> & Partial<ChatSource>)[];
  reviewedRevision?: string | null;
  model?: string;
  at?: number;
  materials?: number;
  fragments?: number;
  totalFragments?: number;
}

export interface StoredWorkspace extends Omit<
  WorkspaceState,
  'users' | 'studies' | 'models' | 'findings'
> {
  studies: StoredStudy[];
  models: StoredModel[];
  findings: StoredFinding[];
  projectProfile?: ProjectProfile;
  projectSummary?: ProjectSummary | null;
  importSource?: {
    provider: string;
    url: string;
    text?: string;
    importedBy?: string;
    importedAt: number;
  };
}
