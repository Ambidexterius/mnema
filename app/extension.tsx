import type { ReactNode, RefObject } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { Segment, Study, WorkspaceState } from './types.ts';
import type { SelectionAction } from './SelectionToolbar.tsx';

export interface SettingsExtension {
  id: string;
  label: string;
  Icon: LucideIcon;
  visible: (state: WorkspaceState) => boolean;
  render: (context: { state: WorkspaceState; receive: (value: any) => void }) => ReactNode;
}
export interface StudyExtensionOptions {
  study: Study;
  segments: Segment[];
  reader: boolean;
  player: RefObject<HTMLVideoElement | null>;
  readerRef: RefObject<HTMLElement | null>;
  workspace: string;
  receive: (value: any) => void;
  notify: (message: string) => void;
  where: (segment: Segment) => string;
}
export interface StudyExtension {
  onMediaReady?: (video: HTMLVideoElement) => void;
  actions?: (segments: Segment[]) => ReactNode;
  renderSegment?: (segment: Segment) => ReactNode;
  review?: ReactNode;
  dialogs?: ReactNode;
  selectionAction?: SelectionAction;
}

export const settingsExtensions: SettingsExtension[] = [];
export const renderText = (text: string): ReactNode => text;
export const useStudyExtension = (_options: StudyExtensionOptions): StudyExtension => ({});
