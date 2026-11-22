import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import type { Segment, Study, WorkspaceState } from '../app/types.ts';
import type { NewsPost } from '../app/product-news.ts';

type ProjectViewer = {
  id: string;
  workspaceId: string | null;
  role: 'view' | 'full';
  owner: boolean;
};
type StoredWorkspace = WorkspaceState & { projectSummary?: unknown };
export interface ExtensionContext {
  db: DatabaseSync;
  q: (sql: string) => {
    get: (...values: unknown[]) => any;
    all: (...values: unknown[]) => any[];
    run: (...values: unknown[]) => unknown;
  };
  dir: string;
  getState: () => { version: number; state: StoredWorkspace };
  mutate: (change: (state: StoredWorkspace) => void) => unknown;
  currentWs: () => string;
  session: (request: IncomingMessage) => Promise<ProjectViewer | null>;
  body: (request: IncomingMessage) => Promise<any>;
  json: (response: ServerResponse, status: number, value: unknown) => void;
  view: (person: ProjectViewer) => unknown;
  fail: (status: number, message: string) => never;
  canManage: (workspace: string, user: string) => boolean;
  deletingStudies: ReadonlySet<string>;
  jobKey: (workspace: string, study: string) => string;
  forgetStudy: (workspace: string, study: string) => void;
  localStorage: boolean;
}

export interface ServerExtension {
  wordTimes: boolean;
  stateFields: (raw: WorkspaceState, person: ProjectViewer) => Partial<WorkspaceState>;
  studyFields: (
    study: Study,
    raw: WorkspaceState,
    person: ProjectViewer,
    version: number,
  ) => Partial<Study>;
  beforeEditTranscript: (segment: Segment) => void;
  afterEditTranscript: (segment: Segment) => void;
  beforeProcess: (study: Study) => void;
  forget: (workspace: string, study: string) => void;
  removeFiles: (study: Study) => Promise<void>;
  handle: (
    req: IncomingMessage,
    res: ServerResponse,
    person: ProjectViewer,
    path: string,
  ) => Promise<boolean>;
}

export interface ExtensionFactory {
  news?: (posts: NewsPost[]) => NewsPost[];
  activate: (context: ExtensionContext) => ServerExtension;
}

export async function loadExtension(required: boolean): Promise<ExtensionFactory | undefined> {
  if (!required) return;
  const entry = new URL('./private/index.ts', import.meta.url);
  const extension: ExtensionFactory = await import(entry.href);
  if (typeof extension.activate !== 'function') throw new Error('Invalid application extension');
  return extension;
}
