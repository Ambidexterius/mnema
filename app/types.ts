// Shared domain types for the Mnema client and server.

export type Role = 'view' | 'full';
export type FindingStatus = 'draft' | 'verified' | 'rejected';
export type Importance = 'Критично' | 'Высокая' | 'Средняя' | 'Низкая';
export type FindingKind = 'Проблема' | 'Инсайт' | 'Рекомендация' | 'Цифра';
export type SourceType = 'Интервью' | 'Юзабилити-тест' | 'Встреча' | 'Отчёт';
export type ReportStatus = 'ready' | 'none';
export type Basis = 'report' | 'raw';

export interface Segment {
  id: string;
  time: number;
  page?: number | null;
  speaker: string;
  text: string;
}

export interface HistoryEntry {
  action: 'created' | 'suggested' | 'accepted' | 'rejected' | 'restored' | 'reopened' | 'edited';
  status: FindingStatus;
  by: string;
  at: number;
}

export interface Finding {
  id: string;
  studyId: string;
  segmentId: string;
  title: string;
  description: string;
  kind: FindingKind;
  importance: Importance;
  significant: boolean;
  status: FindingStatus;
  origin: 'human' | 'ai';
  createdAt?: number;
  createdBy?: string;
  history: HistoryEntry[];
  /** Derived by the server from the study's report status. */
  basis?: Basis;
}

export interface Study {
  id: string;
  fileId?: string;
  title: string;
  description: string;
  project: string;
  type: SourceType;
  format: 'PDF' | 'TXT' | 'Видео';
  date: string;
  duration: number;
  participants: number;
  status: 'uploaded' | 'processing' | 'ready' | 'error' | 'cancelled';
  tags: string[];
  color: string;
  findings: number;
  drafts?: number;
  summary: { title: string; text: string; segments: string[] }[];
  segments: Segment[];
  fileName?: string;
  mime?: string;
  addedBy?: string;
  conducted?: string;
  method?: string;
  audience?: string;
  author?: string;
  report?: ReportStatus;
  reportExpected?: string;
  processing?: { pages?: number; ocrPages?: number; engine?: string; model?: string; processingSeconds: number; duration?: number };
  progress?: string | null;
  error?: string | null;
  step?: number;
}

export interface ModelConnection {
  id: string;
  name: string;
  provider: string;
  url: string;
  model: string;
  keyRef: string;
  enabled: boolean;
  description: string;
  keyConfigured?: boolean;
}

export interface Processor {
  id: string;
  name: string;
  description: string;
  mode?: string;
  enabled: boolean;
  configured?: boolean;
}

export interface WorkspaceUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  owner?: boolean;
  status: 'active' | 'invited' | 'revoked';
}

export interface ChatSource extends Segment {
  number: number;
  studyId: string;
  segmentId: string;
  title: string;
  studyType?: SourceType;
  basis?: Basis;
}

export interface WorkspaceState {
  studies: Study[];
  findings: Finding[];
  models: ModelConnection[];
  processors: Processor[];
  users: WorkspaceUser[];
  modelId: string;
}
