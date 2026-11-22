import type { IncomingMessage } from 'node:http';

interface WorkspaceRef {
  id: string;
  name: string;
  role: 'view' | 'full';
  admin: boolean;
  sharingMode?: string;
  shareVersion?: string;
  fileCount?: number;
  filePreviews?: { name: string; format: string }[];
}
export interface Person {
  newsId?: string;
  id: string;
  name: string;
  email: string;
  role: 'view' | 'full';
  admin: boolean;
  owner: boolean;
  manageUsers?: boolean;
  recordingProcessing?: boolean;
  welcomePending: boolean;
  workspaceId: string | null;
  workspaces: WorkspaceRef[];
  sharedProject?: WorkspaceRef;
}

export interface RequestServices {
  body: (request: IncomingMessage, max?: number) => Promise<any>;
  session: (request: IncomingMessage) => Promise<Person | null>;
  limit: (key: string, max?: number) => void;
}
