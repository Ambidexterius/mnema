import {
  createContext,
  useContext,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import type { ChatSource, ModelConnection, WorkspaceState } from './types.ts';
import type { ProjectRef } from './ProjectActions.tsx';
import type { useResearchChats } from './useResearchChats.ts';

export interface AppState extends WorkspaceState {
  models: (ModelConnection & { builtin?: boolean })[];
  [key: string]: any;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: 'view' | 'full';
  admin: boolean;
  owner: boolean;
  workspaceId: string | null;
  workspaces: (ProjectRef & { emptyDefault?: boolean })[];
  newsId?: string;
  manageUsers?: boolean;
  recordingProcessing?: boolean;
  welcomePending?: boolean;
}

export interface SourcePanelState {
  studyId?: string;
  segmentId?: string;
  findingId?: string;
  number?: number;
  sources?: ChatSource[];
  heading?: string;
  key?: string;
}

type Chats = ReturnType<typeof useResearchChats>;

export interface AppContext {
  chatHistory: Chats;
  removeUser: (id: string) => Promise<boolean | void>;
  projectAction: (action: string, project: ProjectRef) => void;
  setAnswerRating: (id: string, rating: 'up' | 'down' | null) => void;
  globalMessages: Chats['messages'];
  globalTyping: Chats['typing'];
  globalError: Chats['error'];
  askGlobal: Chats['ask'];
  clearGlobalChat: Chats['newChat'];
  openGlobalSource: (source: ChatSource) => Promise<void>;
  projectName: string;
  workspaces: ProjectRef[];
  switchingProject: boolean;
  switchWorkspace: (id: string, navigate?: boolean) => Promise<void> | undefined;
  markSeen: (id: string) => void;
  state: AppState;
  update: (patch: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => Promise<boolean>;
  receive: (data: any, onlyCurrentProject?: boolean, fromPoll?: boolean) => void;
  user: SessionUser | null;
  real: boolean;
  reader: boolean;
  route: string;
  go: (path: string, segment?: string | null, animateStudy?: boolean) => void;
  dialog: any;
  open: Dispatch<SetStateAction<any>>;
  notify: (message: string) => void;
  selected: string | null;
  setSelected: Dispatch<SetStateAction<string | null>>;
  files: RefObject<Map<string, File | { url: string; name?: string }>>;
  panel: SourcePanelState | null;
  panelClosing: boolean;
  setPanel: Dispatch<SetStateAction<SourcePanelState | null>>;
  openPanel: (panel: SourcePanelState) => void;
}

export const Context = createContext<AppContext>(null);
export const useApp = () => useContext(Context);
