export type Status = 'active' | 'busy' | 'away' | 'dnd';
export type Reaction = '👍' | '❤️' | '😂' | '😮' | '😢' | '🙏';
export interface PeerIdentity { id: string; name: string; status?: Status | undefined; about?: string | undefined; avatar?: string | undefined }
export interface PeerProfile { name: string; status?: Status | undefined; about?: string | undefined; avatar?: string | undefined; fileChunks?: boolean | undefined; maxFileSize?: number | undefined; roomFiles?: boolean | undefined; reactions?: boolean | undefined; voiceCalls?: boolean | undefined; callErrorReason?: boolean | undefined; reminders?: boolean | undefined; announcements?: boolean | undefined }
export interface Contact extends PeerIdentity, Omit<PeerProfile, 'name'> { addresses?: string[] | undefined; online?: boolean | undefined }
export interface Mention { id: string; start: number; end: number }
export interface MessageBase { id: string; from: string; fromName?: string | undefined; to: string | null; at: number; roomId?: string | undefined; version?: number | undefined; replyTo?: string | undefined; reactions?: Record<string, Reaction> | undefined; mentions?: Mention[] | undefined; note?: boolean | undefined; text?: string | undefined; name?: string | undefined; size?: number | undefined; sha256?: string | undefined }
export interface TextMessage extends MessageBase { kind: 'text' | 'note' | 'announcement'; text: string }
export interface FileMessage extends MessageBase { kind: 'file'; name: string; size: number }
export type Message = TextMessage | FileMessage;
export interface RoomPacket { id: string; name: string; owner: string; version: number; members: string[] }
export interface Room extends RoomPacket { invited: string[]; pending: boolean; removed?: Record<string, number> | undefined }
export interface RoomSummary { id: string; name: string; owner: string; pending: boolean; members: string[]; onlineMembers: string[]; invited?: string[] | undefined }
export type ReminderStatus = 'queued' | 'pending' | 'scheduled' | 'due' | 'done' | 'canceled' | 'accepted' | 'declined' | 'expired';
export type ReminderDecision = 'pending' | 'accepted' | 'declined' | 'expired' | 'canceled';
export type ReminderAction = 'accept' | 'decline' | 'edit' | 'snooze' | 'done' | 'cancel' | 'delete';
export interface ReminderFields { title: string; note: string; dueAt: number; sourceThread?: string | undefined; sourceId?: string | undefined }
export interface ReminderRecord extends ReminderFields { id: string; kind: 'local' | 'incoming' | 'outgoing'; from: string; to: string; createdAt: number; status: ReminderStatus; expiresAt?: number | undefined; decision?: ReminderDecision | undefined; receivedAt?: number | undefined; decidedAt?: number | undefined; acceptedDueAt?: number | undefined; proposedDueAt?: number | undefined; recipientDueAt?: number | undefined; requestTitle?: string | undefined; requestNote?: string | undefined; replyPending?: boolean | undefined; cancelPending?: boolean | undefined; deliveryPending?: boolean | undefined; firedAt?: number | undefined; completedAt?: number | undefined; ackPending?: boolean | undefined }
export interface ReminderTombstone { id: string; from: string; expiresAt: number; decision: ReminderDecision; acceptedDueAt?: number | undefined; decidedAt?: number | undefined; receivedAt?: number | undefined }
export interface ReminderResponse { id: string; status: ReminderDecision; dueAt?: number | undefined; decidedAt?: number | undefined }
export interface ReminderEvent { type: 'due' | 'request'; items: ReminderRecord[]; missed?: boolean | undefined }
export interface PeerState { name: string; status: Status; about: string; avatar: string; trusted: Contact[]; contactLabels: Record<string, string>; reminders: ReminderRecord[]; reminderTombstones: ReminderTombstone[]; rooms: Room[]; declinedRooms: string[]; leftRooms: {id: string; owner: string}[]; roomTombstones: {id: string; version: number; members: string[]}[]; archivedThreads: Record<string, string>; pendingFileDeletes: string[]; messages: Message[]; unread: Record<string, number>; announcementsEnabled: boolean; announcementRoomCreated: boolean; mutedAnnouncements: string[]; mutedThreads: string[] }
export interface Snapshot { stats: Record<string, {messages: number; files: number}>; recentFiles: Record<string, FileMessage[]>; reminders: ReminderRecord[]; me: PeerIdentity; addresses: string[]; rooms: RoomSummary[]; contacts: Contact[]; contactLabels: Record<string, string>; archivedThreads: {id: string; name: string}[]; announcementsEnabled: boolean; announcementRoomCreated: boolean; mutedAnnouncements: string[]; mutedThreads: string[]; peers: Contact[]; messages: Message[]; typing: {from: string; thread: string}[]; unread: Record<string, number> }
export interface FileDescriptor { name: string; path: string }
export interface FileOffer { id: string; from: string; fromName: string; name: string; size: number; roomId?: string | null | undefined; roomName?: string | undefined; thread?: string | undefined }
export interface FileTransfer { id: string; status: 'offered' | 'receiving' | 'complete' | 'canceled'; received?: number | undefined; total?: number | undefined }
export interface FileProgress { id: string; status?: 'preparing' | 'waiting' | undefined; sent?: number | undefined; total?: number | undefined }
export type CallReason = 'ended' | 'declined' | 'timeout' | 'device-error' | 'offline';
export interface CallState { id: string; peerId: string; phase: 'incoming' | 'outgoing' | 'connecting'; sdp?: string | undefined }
export type CallPacket = { id: string; peerId: string; action: 'offer' | 'answer'; sdp: string } | { id: string; peerId: string; action: 'end'; reason?: CallReason | undefined };
export type CallSignal = { type: 'offer' | 'answer'; id: string; peerId: string; sdp: string } | {type: 'end'; id: string; peerId: string; reason: CallReason};
export interface FileStart { id: string; to: string | null; name: string; size: number; roomId?: string | undefined; version?: number | undefined }
export type ReactionPacket = {type: 'reaction'; id: string; emoji: Reaction | null; roomId?: string | undefined; version?: number | undefined};
export type WireTextMessage = Omit<TextMessage, 'from' | 'at'> & {from?: string | undefined; at?: number | undefined};
export type LegacyFileMessage = FileStart & {sha256: string; from?: string | undefined; fromName?: string | undefined; kind?: 'file' | undefined; at?: number | undefined};
export type DataPacket = ({type: 'hello'} & PeerProfile) | {type: 'message' | 'announcement' | 'room-message'; message: WireTextMessage} | {type: 'room-invite' | 'room-state'; room: RoomPacket} | {type: 'room-accept' | 'room-leave' | 'room-decline' | 'file-cancel'; id: string} | {type: 'room-remove'; id: string; version: number} | ReactionPacket | {type: 'typing'; active: boolean; roomId?: string | undefined} | {type: 'call'; action: 'offer' | 'answer'; id: string; sdp: string} | {type: 'call'; action: 'end'; id: string; reason: CallReason} | {type: 'reminder-request'; id: string; to: string; title: string; note: string; dueAt: number; createdAt: number; expiresAt: number} | ({type: 'reminder-status'} & ReminderResponse) | {type: 'reminder-cancel'; id: string; expiresAt: number} | {type: 'file'; message: LegacyFileMessage; bytes: string} | {type: 'file-start'; message: FileStart} | {type: 'file-chunk'; id: string; offset: number; bytes: string} | {type: 'file-end'; id: string; sha256: string};
export type ProfilePacket = {type: 'profile'; addresses: string[]} & PeerProfile;
export interface PeerResponse { ok: true; name?: string | undefined; status?: Status | undefined; about?: string | undefined; avatar?: string | undefined; fileChunks?: boolean | undefined; maxFileSize?: number | undefined; roomFiles?: boolean | undefined; reactions?: boolean | undefined; voiceCalls?: boolean | undefined; callErrorReason?: boolean | undefined; reminders?: boolean | undefined; announcements?: boolean | undefined; reminder?: unknown }
export interface SendOptions { responseTimeout?: number | undefined; signal?: AbortSignal | undefined }
export interface FileOptions extends SendOptions { onProgress?: ((bytes: number, total: number) => void) | undefined; onStatus?: ((status: 'preparing' | 'waiting') => void) | undefined; onPreparationProgress?: ((bytes: number, total: number) => void) | undefined }
export interface SendResult { message: Message; delivered: number; failed: number; canceled?: boolean | undefined }
export const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export const record = (value: unknown): Record<string, unknown> => isRecord(value) ? value : {};
export const safeInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);
export const errorCode = (value: unknown): unknown => isRecord(value) ? value.code : undefined;
export const errorMessage = (value: unknown): string => value instanceof Error ? value.message : String(value);
export const asError = (value: unknown): Error => value instanceof Error ? value : new Error(String(value));

const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
const stringValue = (value: unknown): value is string => typeof value === 'string';
const numberValue = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const dictionary = <T>(value: unknown, check: (item: unknown) => item is T): value is Record<string, T> => isRecord(value) && Object.values(value).every(check);
const optionalFields = (value: Record<string, unknown>, keys: string[], check: (item: unknown) => boolean) => keys.every(key => value[key] === undefined || check(value[key]));
const optionalStrings = (value: Record<string, unknown>, keys: string[]) => optionalFields(value, keys, stringValue);
const optionalNumbers = (value: Record<string, unknown>, keys: string[]) => optionalFields(value, keys, numberValue);
const optionalBooleans = (value: Record<string, unknown>, keys: string[]) => optionalFields(value, keys, item => typeof item === 'boolean');
const reaction = (value: unknown): value is Reaction => typeof value === 'string' && ['👍', '❤️', '😂', '😮', '😢', '🙏'].includes(value);
const reminderDecision = (value: unknown): value is ReminderDecision => typeof value === 'string' && ['pending', 'accepted', 'declined', 'expired', 'canceled'].includes(value);
const mention = (value: unknown): value is Mention => isRecord(value) && typeof value.id === 'string' && safeInteger(value.start) && safeInteger(value.end);
function storedMessage(value: unknown): value is Message {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.from !== 'string' || !(value.to === null || typeof value.to === 'string') || !numberValue(value.at) ||
      !optionalStrings(value, ['fromName', 'roomId', 'replyTo', 'sha256', 'text', 'name']) || !optionalNumbers(value, ['version', 'size']) || !optionalBooleans(value, ['note']) ||
      value.reactions !== undefined && !dictionary(value.reactions, reaction) || value.mentions !== undefined && !(Array.isArray(value.mentions) && value.mentions.every(mention))) return false;
  return value.kind === 'file' ? typeof value.name === 'string' && numberValue(value.size) :
    ['text', 'note', 'announcement'].includes(String(value.kind)) && typeof value.text === 'string';
}
function storedContact(value: unknown): value is Contact {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string' && optionalStrings(value, ['about', 'avatar']) &&
    (value.status === undefined || typeof value.status === 'string' && ['active', 'busy', 'away', 'dnd'].includes(value.status)) &&
    optionalBooleans(value, ['online', 'fileChunks', 'roomFiles', 'reactions', 'voiceCalls', 'callErrorReason', 'reminders', 'announcements']) &&
    optionalNumbers(value, ['maxFileSize']) && (value.addresses === undefined || strings(value.addresses));
}
function storedRoom(value: unknown): value is Room {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string' && typeof value.owner === 'string' && numberValue(value.version) &&
    strings(value.members) && strings(value.invited) && typeof value.pending === 'boolean' && (value.removed === undefined || dictionary(value.removed, numberValue));
}
function storedReminder(value: unknown): value is ReminderRecord {
  return isRecord(value) && typeof value.id === 'string' && ['local', 'incoming', 'outgoing'].includes(String(value.kind)) && typeof value.from === 'string' && typeof value.to === 'string' &&
    typeof value.title === 'string' && typeof value.note === 'string' && numberValue(value.dueAt) && numberValue(value.createdAt) &&
    ['queued', 'pending', 'scheduled', 'due', 'done', 'canceled', 'accepted', 'declined', 'expired'].includes(String(value.status)) &&
    (value.decision === undefined || reminderDecision(value.decision)) && optionalStrings(value, ['sourceThread', 'sourceId', 'requestTitle', 'requestNote']) &&
    optionalNumbers(value, ['expiresAt', 'receivedAt', 'decidedAt', 'acceptedDueAt', 'proposedDueAt', 'recipientDueAt', 'firedAt', 'completedAt']) &&
    optionalBooleans(value, ['replyPending', 'cancelPending', 'deliveryPending', 'ackPending']);
}
function storedTombstone(value: unknown): value is ReminderTombstone {
  return isRecord(value) && typeof value.id === 'string' && typeof value.from === 'string' && numberValue(value.expiresAt) && reminderDecision(value.decision) &&
    optionalNumbers(value, ['acceptedDueAt', 'decidedAt', 'receivedAt']);
}
function storedList<T>(value: unknown, check: (item: unknown) => item is T, fallback: T[]): T[] {
  if (value === undefined) return fallback;
  if (!Array.isArray(value) || !value.every(check)) throw new Error('Data percakapan lokal tidak valid.');
  return value;
}
/** Narrow disk JSON before it enters the typed domain; reminder business checks still run on start. */
export function readPeerState(input: unknown, defaults: PeerState): PeerState {
  if (!isRecord(input) || typeof input.name !== 'string') throw new Error('Data percakapan lokal tidak valid.');
  const left = (value: unknown): value is {id: string; owner: string} => isRecord(value) && typeof value.id === 'string' && typeof value.owner === 'string';
  const roomTombstone = (value: unknown): value is {id: string; version: number; members: string[]} => isRecord(value) && typeof value.id === 'string' && numberValue(value.version) && strings(value.members);
  return {
    ...input,
    name: input.name,
    status: typeof input.status === 'string' && ['active', 'busy', 'away', 'dnd'].includes(input.status) ? input.status as Status : defaults.status,
    about: typeof input.about === 'string' ? input.about : defaults.about,
    avatar: typeof input.avatar === 'string' ? input.avatar : defaults.avatar,
    trusted: storedList(input.trusted, storedContact, defaults.trusted), messages: storedList(input.messages, storedMessage, defaults.messages),
    rooms: storedList(input.rooms, storedRoom, []), declinedRooms: storedList(input.declinedRooms, stringValue, []), leftRooms: storedList(input.leftRooms, left, []), roomTombstones: storedList(input.roomTombstones, roomTombstone, []),
    reminders: Array.isArray(input.reminders) ? input.reminders.filter(storedReminder) : [], reminderTombstones: Array.isArray(input.reminderTombstones) ? input.reminderTombstones.filter(storedTombstone) : [],
    contactLabels: dictionary(input.contactLabels, stringValue) ? input.contactLabels : {}, archivedThreads: dictionary(input.archivedThreads, stringValue) ? input.archivedThreads : {}, unread: dictionary(input.unread, numberValue) ? input.unread : {},
    pendingFileDeletes: Array.isArray(input.pendingFileDeletes) ? input.pendingFileDeletes.filter(stringValue) : [],
    announcementsEnabled: input.announcementsEnabled !== false, announcementRoomCreated: input.announcementRoomCreated === true,
    mutedAnnouncements: storedList(input.mutedAnnouncements, stringValue, []), mutedThreads: Array.isArray(input.mutedThreads) ? input.mutedThreads.filter(stringValue) : [],
  };
}
