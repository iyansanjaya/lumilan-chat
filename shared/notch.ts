export type NotchMode = 'hidden' | 'compact' | 'expanded';
export type NotchKind = 'message' | 'notice' | 'file' | 'call' | 'reminder';
export type NotchAction =
  | { type: 'resize'; height: number; revision: number }
  | { type: 'activity'; revision: number }
  | { type: 'collapse'; revision?: number }
  | { type: 'move'; delta: number }
  | { type: 'select' | 'open' | 'accept' | 'decline'; key: string }
  | { type: 'peek' | 'expand' | 'launch' | 'pause' | 'reset' };

export interface NotchVisibleItem {
  key: string;
  kind: NotchKind;
  status: string | undefined;
  count: number;
  title: string;
  body: string;
  progress: number | undefined;
  actionable: boolean;
}

export interface NotchSnapshot {
  mode: NotchMode;
  revision: number;
  width: number | undefined;
  language: string;
  silent: boolean;
  selected: NotchVisibleItem | undefined;
  items: NotchVisibleItem[];
  count: number;
}

export interface NotchPosition { display: number; fraction: number }
export interface NotchSettings {
  notch: boolean;
  enabled: boolean;
  preview: boolean;
  silent: boolean;
  language: string;
  notchPosition?: NotchPosition | undefined;
}
