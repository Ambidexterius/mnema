// Shared domain types for the Mnema client and server.

export type Role = 'view' | 'full';
export type FindingStatus = 'draft' | 'verified' | 'rejected';
export type Importance = 'Критично' | 'Высокая' | 'Средняя' | 'Низкая';
export type FindingKind = 'Проблема' | 'Инсайт' | 'Рекомендация' | 'Цифра';
export type SourceType = 'Интервью' | 'Юзабилити-тест' | 'Встреча' | 'Отчёт';
export type ReportStatus = 'ready' | 'none';
export type Basis = 'report' | 'raw';
export interface MaterialActivity {state:'queued'|'running'|'ready'|'error'|'uploaded'|'cancelled';label:string;detail?:string}

export interface Segment {
  id: string;
  time: number;
  end?: number;
  page?: number | null;
  speaker: string;
  text: string;
  correctedText?: string;
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
  /** Further evidence fragments from the same material, besides `segmentId`. */
  evidence?: string[];
  title: string;
  description: string;
  kind: FindingKind;
  importance: Importance;
  /** Why the model chose this importance; dropped when a person changes the importance. */
  reason?: string;
  significant: boolean;
  status: FindingStatus;
  origin: 'human' | 'ai' | 'import';
  importSource?: {provider:string;url:string;originalStatus:string;confidence:string;originalImportance:string;evidence:string[];exactQuoteMatched:boolean};
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
  format: 'PDF' | 'TXT' | 'Word' | 'XLS' | 'XLSX' | 'Видео';
  date: string;
  duration: number;
  participants: number;
  status: 'uploaded' | 'processing' | 'ready' | 'error' | 'cancelled';
  tags: string[];
  color: string;
  findings: number;
  drafts?: number;
  activity?: MaterialActivity;
  summaryInfo?: {state:'queued'|'running'|'ready'|'error'; review:'draft'|'verified'; revision:string; modelId:string; model?:string; requestedBy:string; startedAt:number; finishedAt?:number; progress?:string; errorCode?:string; error?:string};
  summary: { title: string; text: string; segments: string[] }[];
  segments: Segment[];
  fileName?: string;
  mime?: string;
  addedBy?: string;
  uploadedById?: string;
  conducted?: string;
  method?: string;
  audience?: string;
  author?: string;
  report?: ReportStatus;
  reportExpected?: string;
  processing?: { pages?: number; ocrPages?: number; engine?: string; model?: string; processingSeconds: number; duration?: number };
  transcriptEdits?: {segmentId:string;before:string;after:string;by:string;at:number}[];
  findingsInfo?: {state:'queued'|'running'|'ready'|'error'; progress?:string|null; found?:number; added?:number; merged?:number; dedupe?:'model'|'words'; model?:string; error?:string; errorCode?:string; startedAt?:number; finishedAt?:number};
  speakerInfo?: {state:'queued'|'running'|'ready'|'error'; count?:number; engine?:string; progress?:string|null; error?:string; startedAt?:number; finishedAt?:number};
  speakerEdits?: {action:'detected'|'renamed'|'reassigned'; from?:string; to?:string; count?:number; changed:number; by:string; at:number}[];
  processingState?: 'queued' | 'running';
  processingUpdatedAt?: number;
  processingStartedAt?: number;
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
  hasStoredKey?: boolean;
  apiType?: 'compatible'|'openai'|'anthropic';
  instructions?: string;
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
  status: 'active' | 'invited' | 'expired' | 'revoked';
  scope?: 'all' | 'project';
  expires?: number;
}

export interface ChatSource extends Segment {
  workspaceId?: string;
  workspaceName?: string;
  number: number;
  studyId: string;
  segmentId: string;
  title: string;
  studyType?: SourceType;
  basis?: Basis;
}

/** A quote a person marked in a material. Unlike a finding, it is evidence without a conclusion. */
export interface Highlight {
  id: string;
  studyId: string;
  segmentId: string;
  text: string;
  page?: number;
  by: string;
  byId?: string;
  at: number;
}

export interface WorkspaceState {
  studies: Study[];
  findings: Finding[];
  highlights?: Highlight[];
  models: ModelConnection[];
  processors: Processor[];
  users: WorkspaceUser[];
  modelId: string;
}
