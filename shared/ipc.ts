import type { Snapshot, Message, FileMessage, Mention, Reaction, PeerProfile, ReminderRecord, ReminderAction, ReminderFields, CallPacket, CallSignal, CallState, SendResult, FileOffer, FileTransfer, FileProgress } from './model.js';
import type { NotchAction, NotchSnapshot } from './notch.js';

export type Unsubscribe = () => void;
export interface VoiceState { id: string; peerId: string; phase: 'incoming' | 'preparing' | 'ringing' | 'connecting' | 'active'; muted: boolean; audioBlocked: boolean; audioIssue?: string | undefined }
export interface NotificationSettings { enabled: boolean; preview: boolean; silent: boolean; background: boolean; notch: boolean; notchSupported: boolean; supported: boolean; error?: string | undefined; notchPosition?: import('./notch.js').NotchPosition | undefined; tray: boolean; version: string; platform: string; language: string; languageMode: 'auto' | 'manual' }
export interface StartupSettings { supported: boolean; enabled: boolean }
export interface ReminderSource { thread: string; id: string; messages: Message[] }
export interface ReminderContext { title?: string | undefined; sourceId?: string | undefined; sourceThread?: string | undefined }
export interface IncomingTransfer extends Partial<Omit<FileOffer, 'id'>>, FileTransfer { name: string; size: number; fromName: string; thread: string }
export interface LumilanBridge {
  state(): Promise<Snapshot>;
  windowVisible(): Promise<boolean>;
  onWindowVisible(callback: (visible: boolean) => void): Unsubscribe;
  reminders(): Promise<ReminderRecord[]>;
  onReminder(callback: (event: {type: 'due' | 'request'; missed?: boolean | undefined}) => void): Unsubscribe;
  reminderSource(id: string): Promise<ReminderSource>;
  createReminder(value: ReminderFields & {to?: string | undefined}): Promise<ReminderRecord[]>;
  changeReminder(id: string, action: ReminderAction, value?: Partial<ReminderFields> | undefined): Promise<ReminderRecord[]>;
  rename(name: string): Promise<Snapshot>;
  setProfile(profile: PeerProfile): Promise<Snapshot>;
  setContactLabel(id: string, label: string): Promise<Snapshot>;
  checkUpdates(): Promise<void>;
  testNotification(): Promise<{shown: boolean; error?: string | undefined}>;
  message(text: string, to: string, replyTo?: string | null | undefined): Promise<SendResult>;
  roomMessage(text: string, id: string, replyTo?: string | null | undefined, mentions?: Mention[] | undefined): Promise<SendResult>;
  note(text: string, replyTo?: string | null | undefined): Promise<SendResult>;
  react(thread: string, id: string, emoji: Reaction | null): Promise<{delivered: number; failed: number}>;
  typing(thread: string, active: boolean): Promise<void>;
  callState(): Promise<CallState | null>;
  reportCall(state: VoiceState | null): Promise<boolean>;
  onNotchAcceptCall(callback: (id: string) => void): Unsubscribe;
  call(packet: CallPacket): Promise<boolean>;
  callMicrophone(): Promise<boolean>;
  onCall(callback: (signal: CallSignal) => void): Unsubscribe;
  announcement(text: string, replyTo?: string | null | undefined): Promise<SendResult>;
  createAnnouncementRoom(): Promise<boolean>;
  deleteAnnouncementRoom(): Promise<void>;
  createRoom(name: string, members: string[]): Promise<{id: string; failed: number}>;
  updateRoom(id: string, members: string[]): Promise<void>;
  acceptRoom(id: string): Promise<string>;
  declineRoom(id: string): Promise<void>;
  leaveRoom(id: string): Promise<void>;
  deleteRoom(id: string): Promise<void>;
  archiveThread(id: string): Promise<void>;
  restoreThread(id: string): Promise<void>;
  deleteArchivedHistory(id: string): Promise<number>;
  deleteMessages(thread: string, ids: string[]): Promise<number>;
  connectAddress(value: string): Promise<string>;
  setAnnouncements(enabled: boolean): Promise<void>;
  muteAnnouncementsFrom(id: string, muted: boolean): Promise<void>;
  setThreadMuted(thread: string, muted: boolean): Promise<void>;
  file(file: File, to: string, id?: string | undefined): Promise<SendResult>;
  clipboardImage(file: Blob): Promise<{width: number; height: number; frames: number}>;
  cancelFile(id?: string | undefined): Promise<boolean>;
  fileOffers(): Promise<IncomingTransfer[]>;
  decideFile(id: string, accepted: boolean): Promise<boolean>;
  onFileOffer(callback: (offer: FileOffer & {thread: string}) => void): Unsubscribe;
  onFileTransfer(callback: (transfer: FileTransfer) => void): Unsubscribe;
  onFileProgress(callback: (progress: FileProgress) => void): Unsubscribe;
  onTyping(callback: (entries: Snapshot['typing']) => void): Unsubscribe;
  saveFile(id: string): Promise<boolean>;
  previewImage(id: string): Promise<string>;
  listFiles(thread: string, offset: number): Promise<{items: FileMessage[]; total: number}>;
  listMessages(thread: string, before: string | null): Promise<Message[]>;
  currentThread(thread: string | null): Promise<void>;
  notificationSettings(): Promise<NotificationSettings>;
  startupSettings(): Promise<StartupSettings>;
  setStartup(enabled: boolean): Promise<StartupSettings>;
  setLanguage(language: string): Promise<{language: string; languageMode: 'auto' | 'manual'}>;
  setNotificationSettings(value: Pick<NotificationSettings, 'enabled' | 'preview' | 'silent' | 'background' | 'notch'>): Promise<Partial<NotificationSettings>>;
  quit(): Promise<void>;
  onOpenThread(callback: (thread: string) => void): Unsubscribe;
  onState(callback: (state: Snapshot) => void): Unsubscribe;
}
export interface LumiBridge {
  state(): Promise<NotchSnapshot>;
  action(value: NotchAction): Promise<boolean | void>;
  pointer(inside: boolean): void;
  onState(callback: (state: NotchSnapshot) => void): Unsubscribe;
}

export interface LumilanInvokeResults {
  'state': Awaited<ReturnType<LumilanBridge['state']>>;
  'window-visible': Awaited<ReturnType<LumilanBridge['windowVisible']>>;
  'reminders': Awaited<ReturnType<LumilanBridge['reminders']>>;
  'reminder-source': Awaited<ReturnType<LumilanBridge['reminderSource']>>;
  'create-reminder': Awaited<ReturnType<LumilanBridge['createReminder']>>;
  'change-reminder': Awaited<ReturnType<LumilanBridge['changeReminder']>>;
  'rename': Awaited<ReturnType<LumilanBridge['rename']>>;
  'set-profile': Awaited<ReturnType<LumilanBridge['setProfile']>>;
  'set-contact-label': Awaited<ReturnType<LumilanBridge['setContactLabel']>>;
  'check-updates': Awaited<ReturnType<LumilanBridge['checkUpdates']>>;
  'test-notification': Awaited<ReturnType<LumilanBridge['testNotification']>>;
  'message': Awaited<ReturnType<LumilanBridge['message']>>;
  'room-message': Awaited<ReturnType<LumilanBridge['roomMessage']>>;
  'note': Awaited<ReturnType<LumilanBridge['note']>>;
  'react': Awaited<ReturnType<LumilanBridge['react']>>;
  'typing': Awaited<ReturnType<LumilanBridge['typing']>>;
  'call-state': Awaited<ReturnType<LumilanBridge['callState']>>;
  'report-call': Awaited<ReturnType<LumilanBridge['reportCall']>>;
  'call': Awaited<ReturnType<LumilanBridge['call']>>;
  'call-microphone': Awaited<ReturnType<LumilanBridge['callMicrophone']>>;
  'announcement': Awaited<ReturnType<LumilanBridge['announcement']>>;
  'create-announcement-room': Awaited<ReturnType<LumilanBridge['createAnnouncementRoom']>>;
  'delete-announcement-room': Awaited<ReturnType<LumilanBridge['deleteAnnouncementRoom']>>;
  'create-room': Awaited<ReturnType<LumilanBridge['createRoom']>>;
  'update-room': Awaited<ReturnType<LumilanBridge['updateRoom']>>;
  'accept-room': Awaited<ReturnType<LumilanBridge['acceptRoom']>>;
  'decline-room': Awaited<ReturnType<LumilanBridge['declineRoom']>>;
  'leave-room': Awaited<ReturnType<LumilanBridge['leaveRoom']>>;
  'delete-room': Awaited<ReturnType<LumilanBridge['deleteRoom']>>;
  'archive-thread': Awaited<ReturnType<LumilanBridge['archiveThread']>>;
  'restore-thread': Awaited<ReturnType<LumilanBridge['restoreThread']>>;
  'delete-archived-history': Awaited<ReturnType<LumilanBridge['deleteArchivedHistory']>>;
  'delete-messages': Awaited<ReturnType<LumilanBridge['deleteMessages']>>;
  'connect-address': Awaited<ReturnType<LumilanBridge['connectAddress']>>;
  'set-announcements': Awaited<ReturnType<LumilanBridge['setAnnouncements']>>;
  'mute-announcements-from': Awaited<ReturnType<LumilanBridge['muteAnnouncementsFrom']>>;
  'set-thread-muted': Awaited<ReturnType<LumilanBridge['setThreadMuted']>>;
  'file': Awaited<ReturnType<LumilanBridge['file']>>;
  'clipboard-image': Awaited<ReturnType<LumilanBridge['clipboardImage']>>;
  'cancel-file': Awaited<ReturnType<LumilanBridge['cancelFile']>>;
  'file-offers': Awaited<ReturnType<LumilanBridge['fileOffers']>>;
  'decide-file': Awaited<ReturnType<LumilanBridge['decideFile']>>;
  'save-file': Awaited<ReturnType<LumilanBridge['saveFile']>>;
  'preview-image': Awaited<ReturnType<LumilanBridge['previewImage']>>;
  'list-files': Awaited<ReturnType<LumilanBridge['listFiles']>>;
  'list-messages': Awaited<ReturnType<LumilanBridge['listMessages']>>;
  'current-thread': Awaited<ReturnType<LumilanBridge['currentThread']>>;
  'notification-settings': Awaited<ReturnType<LumilanBridge['notificationSettings']>>;
  'startup-settings': Awaited<ReturnType<LumilanBridge['startupSettings']>>;
  'set-startup': Awaited<ReturnType<LumilanBridge['setStartup']>>;
  'set-language': Awaited<ReturnType<LumilanBridge['setLanguage']>>;
  'set-notification-settings': Awaited<ReturnType<LumilanBridge['setNotificationSettings']>>;
  'quit': Awaited<ReturnType<LumilanBridge['quit']>>;
}
