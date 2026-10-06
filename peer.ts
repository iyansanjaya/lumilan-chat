import type { Libp2p, Stream, Connection, PeerId } from '@libp2p/interface';
import type { Multiaddr } from '@multiformats/multiaddr';
import type { FileHandle } from 'node:fs/promises';
import type { Hash } from 'node:crypto';
import { record, isRecord, readPeerState, safeInteger, asError, errorCode, errorMessage, type PeerState, type Contact, type PeerProfile, type Snapshot, type Message, type TextMessage, type FileMessage, type Mention, type Room, type RoomPacket, type Reaction, type Status, type DataPacket, type ProfilePacket, type PeerResponse, type FileStart, type FileOffer, type SendOptions, type FileOptions, type ReactionPacket, type CallState, type CallReason, type SendResult, type ReminderEvent, type FileTransfer, type CallSignal } from './shared/model.js';
export type PacketStream = Pick<Stream, 'send' | 'onDrain' | 'close' | 'abort' | 'inactivityTimeout' | 'maxReadBufferLength'> & AsyncIterable<Uint8Array | { subarray(): Uint8Array }>;
export type PeerConnection = Pick<Connection, 'remotePeer' | 'remoteAddr'>;
export type PeerNode = Pick<Libp2p, 'peerId' | 'getConnections' | 'getMultiaddrs' | 'dial' | 'dialProtocol' | 'handle' | 'addEventListener' | 'start' | 'stop'>;
export interface IncomingTransfer extends FileStart { from: string; path: string; handle: Pick<FileHandle, 'write' | 'close' | 'sync'>; hash: Hash; received: number; timer: ReturnType<typeof setTimeout> | null; lastProgressPercent?: number | undefined }
interface PendingFileOffer { from: string; size: number; canceled: boolean; cancellation: Promise<boolean>; cancelConsent(value: boolean): void }
interface PeerOptions { dataDir: string; discovery?: boolean; listen?: string; getNetwork?: () => string; acceptFile?: (offer: FileOffer) => boolean | Promise<boolean> }
import { EventEmitter } from 'node:events';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statfsSync, writeFileSync } from 'node:fs';
import { open, readFile, rename, rm, stat, unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createLibp2p } from 'libp2p';
import { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } from '@libp2p/crypto/keys';
import { tcp } from '@libp2p/tcp';
import { noise } from '@libp2p/noise';
import { yamux } from '@libp2p/yamux';
import { identify } from '@libp2p/identify';
import { multiaddr } from '@multiformats/multiaddr';
import { LanDiscovery, addressPriority, localAddress, localPeer, networkSignature } from './discovery.js';
import { Reminders } from './reminders.js';

const PROFILE = '/lumilan/profile/1.0.0';
const DATA = '/lumilan/data/1.0.0';
const MAX_FILE = 20 * 1024 * 1024;
const PREVIOUS_STREAM_FILE = 100 * 1024 * 1024;
const MAX_STREAM_FILE = 5 * 1024 * 1024 * 1024;
const MAX_INCOMING_FILES = 8;
const FILE_CHUNK = 512 * 1024;
const MAX_FRAME = 29 * 1024 * 1024;
const MAX_TEXT = 4000;
const MAX_AVATAR = 24 * 1024;
const MAX_ROOMS = 64;
const MAX_MEMBERS = 64;
const MAX_CALL_SDP = 64 * 1024;
const STATUSES = new Set(['active', 'busy', 'away', 'dnd']);
const REACTIONS = new Set(['👍', '❤️', '😂', '😮', '😢', '🙏']);
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

const sha256 = (value: Uint8Array) => createHash('sha256').update(value).digest();
const peerFileLimit = (peer: {fileChunks?: unknown; maxFileSize?: unknown} | undefined) => !peer?.fileChunks ? MAX_FILE : safeInteger(peer.maxFileSize) && peer.maxFileSize > 0
  ? Math.min(peer.maxFileSize, MAX_STREAM_FILE) : PREVIOUS_STREAM_FILE;
const stripControls = (value: string) => value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '');
const cleanName = (value: unknown) => typeof value === 'string' ? stripControls(value).trim().replace(/\s+/g, ' ').slice(0, 32) : '';
const safeFileName = (value: unknown) => {
  const name = basename(String(value || '').replaceAll('\\', '/')).replace(/[<>:"/\\|?*]/g, '_').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').replace(/[. ]+$/, '').trim().slice(0, 180);
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? `_${name}` : name;
};
const validId = (value: unknown): value is string & {readonly __validated: true} => typeof value === 'string' && /^[a-zA-Z0-9]{30,100}$/.test(value);
const validRoomId = (value: unknown): value is string & {readonly __validated: true} => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const validCallSdp = (value: unknown): value is string & {readonly __validated: true} => typeof value === 'string' && value.length <= MAX_CALL_SDP && value.startsWith('v=0\r\n') &&
  value.includes('\r\nm=audio ') && value.includes('\r\na=fingerprint:') && !/\r\nm=(?!audio )/.test(value);
const roomKey = (id: string) => `room:${id}`;
const validMentions = (text: string, mentions: unknown, room: Room, sender: string): Mention[] => {
  if (mentions === undefined) return [];
  if (!Array.isArray(mentions) || mentions.length > 20) throw new Error('Mention Ruang tidak valid.');
  let lastEnd = 0;
  return (mentions as unknown[]).map(value => {
    const item = record(value);
    if (!item || !validId(item.id) || item.id === sender || !room.members.includes(item.id) ||
        !safeInteger(item.start) || !safeInteger(item.end) || item.start < lastEnd ||
        item.end <= item.start + 1 || item.end > text.length || item.end - item.start > 33 ||
        !text.slice(item.start, item.end).startsWith('@') || /[\r\n]/.test(text.slice(item.start, item.end)))
      throw new Error('Mention Ruang tidak valid.');
    lastEnd = item.end;
    return { id: item.id, start: item.start, end: item.end };
  });
};
const messageKey = (message: Message, ownId: string): string => message.kind === 'note' || message.kind === 'file' && message.note === true ? 'notes' : message.roomId ? roomKey(message.roomId) : message.kind === 'announcement' ? 'announcements' : message.from === ownId ? message.to! : message.from;
const inThread = (message: Message, thread: string, ownId: string) => thread === 'notes' ? message.kind === 'note' || message.kind === 'file' && message.note === true : thread === 'announcements' ? message.kind === 'announcement'
  : thread?.startsWith('room:') ? message.roomId === thread.slice(5)
  : (message.to === thread && message.from === ownId) || (message.from === thread && message.to === ownId);
const cleanAbout = (value: unknown) => typeof value === 'string' ? stripControls(value).trim().replace(/\s+/g, ' ').slice(0, 100) : '';
const cleanStatus = (value: unknown): Status => typeof value === 'string' && STATUSES.has(value) ? value as Status : 'active';
const cleanAvatar = (value: unknown) => {
  if (!value) return '';
  if (typeof value !== 'string' || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return '';
  const bytes = Buffer.from(value.slice(value.indexOf(',') + 1), 'base64');
  return bytes.length > 0 && bytes.length <= MAX_AVATAR ? value : '';
};

function responseFields(value: Record<string, unknown>): PeerResponse {
  const response: PeerResponse = { ok: true };
  if (typeof value.name === 'string') response.name = value.name;
  if (value.status !== undefined) response.status = cleanStatus(value.status);
  if (value.about !== undefined) response.about = cleanAbout(value.about);
  if (value.avatar !== undefined) response.avatar = cleanAvatar(value.avatar);
  for (const key of ['fileChunks', 'roomFiles', 'reactions', 'voiceCalls', 'callErrorReason', 'reminders', 'announcements'] as const)
    if (value[key] !== undefined) response[key] = value[key] === true;
  if (safeInteger(value.maxFileSize)) response.maxFileSize = value.maxFileSize;
  if (value.reminder !== undefined) response.reminder = value.reminder;
  return response;
}

function saveJson(path: string, value: PeerState) {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
  renameSync(temporary, path);
}

function requireDiskSpace(directory: string, size: number) {
  const disk = statfsSync(directory, { bigint: true });
  if (disk.bavail * disk.bsize < BigInt(size) + 10n * 1024n * 1024n) throw new Error('Ruang penyimpanan tidak cukup untuk file ini.');
}

async function writeAll(handle: Pick<FileHandle, 'write'>, bytes: Uint8Array) {
  for (let offset = 0; offset < bytes.length;) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset);
    if (!bytesWritten) throw new Error('File tidak dapat disimpan.');
    offset += bytesWritten;
  }
}

async function readStream(stream: PacketStream, limit: number, timeout = 30_000): Promise<Record<string, unknown>> {
  stream.inactivityTimeout = timeout;
  stream.maxReadBufferLength = Math.min(limit + 1024, MAX_FRAME + 1024);
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    const bytes = chunk instanceof Uint8Array ? chunk : chunk.subarray();
    size += bytes.length;
    if (size > limit) throw new Error('Paket terlalu besar.');
    chunks.push(Buffer.from(bytes));
  }
  return record(JSON.parse(decoder.decode(Buffer.concat(chunks))));
}

async function writeStream(stream: PacketStream, value: unknown) {
  const bytes = encoder.encode(JSON.stringify(value));
  for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
    if (!stream.send(bytes.subarray(offset, offset + 64 * 1024))) await stream.onDrain();
  }
  await stream.close();
}

export interface PeerEvents { change: []; incoming: [Message]; reminder: [ReminderEvent]; 'file-transfer': [FileTransfer]; call: [CallSignal]; typing: [{from: string; thread: string}[]] }
export class LumilanPeer extends EventEmitter<PeerEvents> {
  dataDir: string; discovery: boolean; listen: string; getNetwork: () => string; acceptFile: (offer: FileOffer) => boolean | Promise<boolean>; network: string; path: string; keyPath: string; filesDir: string;
  state: PeerState; node: PeerNode | null; identity: string | null;
  discovered: Map<string, string[]>; probing: Set<string>; dialing: Set<string>; incomingFiles: Map<string, IncomingTransfer>; pendingFileOffers: Map<string, PendingFileOffer>; incomingPackets: Map<PacketStream, Promise<void>>; incomingCleanups: Set<Promise<void>>;
  stopping: boolean; stopPromise: Promise<void> | null; announcementTimes: Map<string, number[]>; typing: Map<string, {from: string; thread: string; timer: ReturnType<typeof setTimeout>}>; activeCall: (CallState & {timer?: ReturnType<typeof setTimeout> | undefined}) | null; reminders: Reminders;

  constructor({ dataDir, discovery = true, listen = '/ip4/0.0.0.0/tcp/40754', getNetwork = networkSignature, acceptFile = async () => false }: PeerOptions) {
    super();
    this.dataDir = dataDir;
    this.discovery = discovery;
    this.listen = listen;
    this.getNetwork = getNetwork;
    this.acceptFile = acceptFile;
    this.network = getNetwork();
    this.path = join(dataDir, 'state.json');
    this.keyPath = join(dataDir, 'identity.key');
    this.filesDir = join(dataDir, 'files');
    // ponytail: riwayat kecil disimpan sebagai satu JSON; pindah ke SQLite jika pemakaian bertahun-tahun membuatnya besar.
    this.state = { name: '', status: 'active', about: '', avatar: '', trusted: [], contactLabels: {}, reminders: [], reminderTombstones: [], rooms: [], declinedRooms: [], leftRooms: [], roomTombstones: [], archivedThreads: {}, pendingFileDeletes: [], messages: [], unread: {}, announcementsEnabled: true, announcementRoomCreated: false, mutedAnnouncements: [], mutedThreads: [] };
    this.node = null;
    this.identity = null;
    this.discovered = new Map();
    this.probing = new Set();
    this.dialing = new Set();
    this.incomingFiles = new Map();
    this.pendingFileOffers = new Map();
    this.incomingPackets = new Map();
    this.incomingCleanups = new Set();
    this.stopping = false;
    this.stopPromise = null;
    this.announcementTimes = new Map();
    this.typing = new Map();
    this.activeCall = null;
    this.reminders = new Reminders(this);
  }

  get id(): string { return this.node?.peerId.toString() || this.identity || ''; }
  get trusted() { return new Map(this.state.trusted.map(peer => [peer.id, peer])); }
  get online() { return new Set((this.node?.getConnections() || []).filter(localPeer).map(connection => connection.remotePeer.toString()).filter(id => this.trusted.has(id))); }
  get addresses() { return (this.node?.getMultiaddrs() || []).map(address => address.toString()).filter(localAddress).filter(address => this.listen.includes('/127.') || !address.includes('/ip4/127.')).sort((a, b) => addressPriority(a) - addressPriority(b)).slice(0, 12); }
  typingList() { return [...this.typing.values()].map(({ from, thread }) => ({ from, thread })); }

  async start() {
    if (this.stopPromise) await this.stopPromise;
    this.stopPromise = null;
    this.stopping = false;
    mkdirSync(this.filesDir, { recursive: true, mode: 0o700 });
    for (const entry of readdirSync(this.filesDir, { withFileTypes: true })) {
      // Only a fresh instance recovers clipboard stages; network rebind must preserve live uploads.
      if (!this.identity && /^\.clipboard-[A-Za-z0-9]{6}$/.test(entry.name) && (entry.isDirectory() || entry.isSymbolicLink())) {
        // rm removes a symlink itself; recovery never traverses its target.
        await rm(join(this.filesDir, entry.name), { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
          .catch(error => console.warn('Gagal membersihkan gambar clipboard lama:', error));
      } else if (/^\.(?:upload|outgoing)-[0-9a-f-]{36}\.part$/.test(entry.name) || /^[0-9a-f-]{36}\.thumb\.webp\.\d+\.tmp$/.test(entry.name)) {
        await unlink(join(this.filesDir, entry.name)).catch(error => console.warn('Gagal membersihkan transfer lama:', error));
      }
    }
    if (existsSync(this.path)) this.state = readPeerState(JSON.parse(readFileSync(this.path, 'utf8')), this.state);
    this.state.unread ||= {};
    delete this.state.unread.room;
    this.state.rooms ||= [];
    this.state.declinedRooms ||= [];
    this.state.leftRooms ||= [];
    this.state.roomTombstones ||= [];
    if (!this.state.archivedThreads || typeof this.state.archivedThreads !== 'object' || Array.isArray(this.state.archivedThreads)) this.state.archivedThreads = {};
    this.state.pendingFileDeletes = Array.isArray(this.state.pendingFileDeletes) ? this.state.pendingFileDeletes.filter(validRoomId) : [];
    await this.cleanupDeletedFiles();
    this.state.announcementsEnabled = this.state.announcementsEnabled !== false;
    this.state.announcementRoomCreated = this.state.announcementRoomCreated === true;
    this.state.mutedAnnouncements ||= [];
    this.state.mutedThreads = Array.isArray(this.state.mutedThreads) ? this.state.mutedThreads.filter(id => typeof id === 'string' && (validId(id) || id.startsWith('room:') && validRoomId(id.slice(5)))) : [];
    this.state.contactLabels = Object.fromEntries(Object.entries(this.state.contactLabels && typeof this.state.contactLabels === 'object' && !Array.isArray(this.state.contactLabels) ? this.state.contactLabels : {})
      .filter(([id, label]) => validId(id) && typeof label === 'string' && cleanName(label)).map(([id, label]) => [id, cleanName(label)]));
    this.state.status = cleanStatus(this.state.status);
    this.state.about = cleanAbout(this.state.about);
    this.state.avatar = cleanAvatar(this.state.avatar);
    let privateKey;
    if (existsSync(this.keyPath)) privateKey = privateKeyFromProtobuf(readFileSync(this.keyPath));
    else {
      privateKey = await generateKeyPair('Ed25519');
      writeFileSync(this.keyPath, privateKeyToProtobuf(privateKey), { flag: 'wx', mode: 0o600 });
    }
    this.node = await createLibp2p({
      start: false,
      privateKey,
      addresses: { listen: [this.listen] },
      transports: [tcp()],
      streamMuxers: [yamux()],
      connectionEncrypters: [noise()],
      peerDiscovery: this.discovery ? [components => new LanDiscovery(components)] : [],
      services: { identify: identify() },
      connectionManager: { maxConnections: 100, maxIncomingPendingConnections: 16 },
    });
    this.identity = this.node!.peerId.toString();
    await this.node!.handle(PROFILE, (stream, connection) => this.handleProfile(stream, connection), { maxInboundStreams: 2 });
    // Unanswered file offers must leave streams available for messages and cancellation.
    await this.node!.handle(DATA, (stream, connection) => this.handleData(stream, connection), { maxInboundStreams: MAX_INCOMING_FILES + 8 });
    this.node!.addEventListener('peer:discovery', event => {
      const id = event.detail.id.toString();
      if (!validId(id) || id === this.id) return;
      const addresses = event.detail.multiaddrs.map(address => address.toString()).map(address => address.endsWith(`/p2p/${id}`) ? address : `${address}/p2p/${id}`).filter(localAddress).filter(address => this.listen.includes('/127.') || !address.includes('/ip4/127.')).sort((a, b) => addressPriority(a) - addressPriority(b)).slice(0, 12);
      if (!addresses.length) return;
      if (this.discovered.size >= 64 && !this.discovered.has(id)) this.discovered.delete(this.discovered.keys().next().value!);
      this.discovered.set(id, addresses);
      if (this.trusted.has(id)) this.dialKnown(id, this.discovered.get(id)!).catch(() => {});
      else this.probePeer(id).catch(() => {});
    });
    this.node!.addEventListener('peer:connect', event => {
      const id = event.detail.toString();
      this.emit('change');
      if (this.trusted.has(id)) {
        this.sendTo(id, { type: 'hello', ...this.profile() }).catch(() => {});
        this.syncRoomsWith(id).catch(() => {});
        this.reminders.syncRemote(id);
      }
      else if (this.discovered.has(id)) this.probePeer(id).catch(() => {});
    });
    this.node!.addEventListener('peer:disconnect', event => {
      const from = event.detail.toString();
      for (const [key, item] of this.typing) if (item.from === from) { clearTimeout(item.timer); this.typing.delete(key); }
      this.emit('typing', this.typingList());
      this.emit('change');
      setImmediate(() => { if (this.activeCall?.peerId === from && !this.online.has(from)) this.finishCall('offline'); });
    });
    await this.node!.start();
    this.reminders.start();
    for (const peer of this.state.trusted) this.dialKnown(peer.id, peer.addresses || []).catch(() => {});
    return this;
  }

  async dialKnown(id: string, addresses: string[]) {
    if (this.online.has(id) || this.dialing.has(id)) return;
    this.dialing.add(id);
    try {
      const targets = addresses.map(address => address.endsWith(`/p2p/${id}`) ? address : `${address}/p2p/${id}`)
        .filter(localAddress).sort((a, b) => addressPriority(a) - addressPriority(b)).slice(0, 12);
      if (targets.length) await Promise.any(targets.map(target => this.node!.dial(multiaddr(target), { signal: AbortSignal.timeout(5000) })));
    } catch { /* alamat saat ini tidak dapat dihubungi; penemuan berikutnya akan mencoba lagi */ }
    finally { this.dialing.delete(id); }
  }

  maintainConnections() {
    if (!this.node || !this.state.name) return;
    for (const [id, addresses] of this.discovered) {
      if (this.online.has(id)) continue;
      if (this.trusted.has(id)) this.dialKnown(id, addresses).catch(() => {});
      else this.probePeer(id).catch(() => {});
    }
  }

  stop() {
    if (this.stopPromise) return this.stopPromise;
    this.stopping = true;
    this.stopPromise = Promise.resolve().then(async () => {
      this.reminders.stop();
      this.finishCall('offline');
      for (const item of this.typing.values()) clearTimeout(item.timer);
      this.typing.clear();
      const cleanup = [...this.incomingCleanups, ...[...new Set([...this.pendingFileOffers.keys(), ...this.incomingFiles.keys()])].map(id => this.cancelIncomingFile(id))];
      const errors = [];
      for (const stream of this.incomingPackets.keys()) {
        try { stream.abort(new Error('Pengiriman dibatalkan.')); } catch (error) { errors.push(error); }
      }
      const node = this.node;
      const results = await Promise.allSettled([...cleanup, ...this.incomingPackets.values()]);
      try { if (node) { await node.stop(); if (this.node === node) this.node = null; } }
      catch (error) { errors.push(error); }
      for (const result of results) if (result.status === 'rejected') errors.push(result.reason);
      if (errors.length) throw new AggregateError(errors, 'Gagal membersihkan peer saat berhenti.');
    }).catch(error => {
      this.stopPromise = null;
      throw error;
    });
    return this.stopPromise;
  }

  async connectAddress(value: unknown) {
    const address = String(value || '').trim();
    if (!localAddress(address) || (!this.listen.includes('/127.') && address.includes('/ip4/127.'))) throw new Error('Kode perangkat tidak valid.');
    const id = address.match(/\/p2p\/([a-zA-Z0-9]+)$/)?.[1];
    if (!validId(id) || id === this.id) throw new Error('Kode perangkat tidak valid.');
    const response = await this.profilePacket(id, { type: 'profile', ...this.profile(), addresses: this.addresses }, [address]);
    const name = cleanName(response.name);
    if (!name) throw new Error('Profil perangkat tidak valid.');
    this.rememberPeer(id, name, [address], response);
    return id;
  }

  async refreshNetwork() {
    const network = this.getNetwork();
    if (network === this.network) return false;
    delete this.state.unread.room;
    this.save();
    await this.stop();
    this.discovered.clear();
    this.probing.clear();
    this.dialing.clear();
    await this.start();
    this.network = network;
    this.emit('change');
    return true;
  }

  snapshot(): Snapshot {
    const online = this.online;
    const visibleMessages = this.state.messages.filter(message => Object.hasOwn(this.state.archivedThreads, messageKey(message, this.id)) ||
      (inThread(message, 'notes', this.id) ? true : message.roomId ? this.state.rooms.some(room => room.id === message.roomId && !room.pending)
        : message.kind === 'announcement' ? true : message.to && online.has(message.from === this.id ? message.to : message.from)));
    const stats: Snapshot['stats'] = {};
    const recentFiles: Snapshot['recentFiles'] = {};
    for (const message of visibleMessages) {
      const key = messageKey(message, this.id);
      const count = stats[key] ||= { messages: 0, files: 0 };
      count.messages++;
      if (message.kind === 'file') {
        count.files++;
        const list = recentFiles[key] ||= [];
        list.push(message);
        if (list.length > 5) list.shift();
      }
    }
    return {
      stats, recentFiles, reminders: this.reminders.list(),
      me: { id: this.id, name: this.state.name, status: this.state.status, about: this.state.about, avatar: this.state.avatar },
      addresses: this.addresses,
      rooms: this.state.rooms.map(room => ({ id: room.id, name: room.name, owner: room.owner, pending: room.pending,
        members: room.members, onlineMembers: room.members.filter(id => id === this.id || online.has(id)),
        invited: room.owner === this.id ? room.invited : undefined })),
      contacts: this.state.trusted.map(peer => ({ id: peer.id, name: peer.name, avatar: cleanAvatar(peer.avatar), reminders: peer.reminders === true })),
      contactLabels: this.state.contactLabels,
      archivedThreads: Object.entries(this.state.archivedThreads).map(([id, name]) => ({ id, name })),
      announcementsEnabled: this.state.announcementsEnabled,
      announcementRoomCreated: this.state.announcementRoomCreated,
      mutedAnnouncements: this.state.mutedAnnouncements,
      mutedThreads: this.state.mutedThreads,
      peers: this.state.trusted.filter(peer => online.has(peer.id)).map(peer => ({
      id: peer.id, name: peer.name, online: true, status: cleanStatus(peer.status), about: cleanAbout(peer.about), avatar: cleanAvatar(peer.avatar), announcements: peer.announcements === true, voiceCalls: peer.voiceCalls === true, reminders: peer.reminders === true,
      })),
      messages: visibleMessages.slice(-1000),
      typing: this.typingList(),
      unread: Object.fromEntries(Object.entries(this.state.unread).filter(([id]) => Object.hasOwn(this.state.archivedThreads, id) || id === 'announcements' ||
        id.startsWith('room:') && this.state.rooms.some(room => roomKey(room.id) === id && !room.pending) || online.has(id))),
    };
  }

  rename(value: unknown) {
    const name = cleanName(value);
    if (!name) throw new Error('Nama tidak boleh kosong.');
    this.state.name = name;
    this.save();
    for (const id of this.discovered.keys()) if (!this.trusted.has(id)) this.probePeer(id).catch(() => {});
    this.broadcastProfile();
    return this.snapshot();
  }

  profile(): PeerProfile { return { name: this.state.name, status: this.state.status, about: this.state.about, avatar: this.state.avatar, fileChunks: true, maxFileSize: MAX_STREAM_FILE, roomFiles: true, reactions: true, voiceCalls: true, callErrorReason: true, reminders: true, announcements: this.state.announcementsEnabled }; }

  broadcastProfile() {
    if (!this.state.name) return;
    for (const id of this.online) this.sendTo(id, { type: 'hello', ...this.profile() }).catch(() => {});
  }

  setProfile(input: unknown) {
    const value = record(input);
    if (!value || typeof value !== 'object' || !cleanName(value.name) || !(typeof value.status === 'string' && STATUSES.has(value.status)) ||
        typeof value.about !== 'string' || value.about.length > 100 ||
        typeof value.avatar !== 'string' || value.avatar && !cleanAvatar(value.avatar)) throw new Error('Profil tidak valid.');
    this.state.name = cleanName(value.name);
    this.state.status = value.status as Status;
    this.state.about = cleanAbout(value.about);
    this.state.avatar = value.avatar;
    this.save();
    this.broadcastProfile();
    return this.snapshot();
  }

  save() { saveJson(this.path, this.state); this.emit('change'); }

  async cleanupDeletedFiles() {
    if (!this.state.pendingFileDeletes.length) return true;
    const results = await Promise.allSettled(this.state.pendingFileDeletes.map(async id => {
      const removed = await Promise.allSettled([unlink(join(this.filesDir, id)), unlink(join(this.filesDir, `${id}.thumb.webp`))]);
      const failed = removed.find(result => result.status === 'rejected' && result.reason?.code !== 'ENOENT');
      if (failed?.status === 'rejected') throw failed.reason;
    }));
    this.state.pendingFileDeletes = this.state.pendingFileDeletes.filter((_id, index) => results[index]?.status === 'rejected' && errorCode(results[index].reason) !== 'ENOENT');
    this.save();
    return this.state.pendingFileDeletes.length === 0;
  }

  markRead(thread: string) {
    const key = thread;
    if (key === 'notes') return;
    if (key !== 'announcements' && !validId(key) && !(typeof key === 'string' && key.startsWith('room:') && validRoomId(key.slice(5)))) throw new Error('Percakapan tidak valid.');
    if (!this.state.unread[key]) return;
    delete this.state.unread[key];
    this.save();
  }

  recordIncoming(message: Message) {
    const key = messageKey(message, this.id);
    this.state.unread[key] = (this.state.unread[key] || 0) + 1;
    this.save();
    this.emit('incoming', message);
  }

  async profilePacket(id: string, payload: ProfilePacket, addresses: string[] = this.discovered.get(id) || []): Promise<PeerResponse> {
    if (!validId(id) || id === this.id) throw new Error('Perangkat tidak valid.');
    const connection = this.node!.getConnections().find(item => item.remotePeer.toString() === id && localPeer(item));
    if (connection) return this.request(connection.remotePeer, PROFILE, payload, 48 * 1024);
    const targets = addresses.filter(address => localAddress(address) && address.endsWith(`/p2p/${id}`))
      .sort((a, b) => addressPriority(a) - addressPriority(b)).slice(0, 12);
    if (!targets.length) throw new Error('Perangkat tidak memiliki alamat LAN yang dapat dihubungi.');
    try { return await Promise.any(targets.map(address => this.request(multiaddr(address), PROFILE, payload, 48 * 1024))); }
    catch (error) { throw new Error('Perangkat tidak dapat dihubungi di jaringan lokal.', { cause: error }); }
  }

  async probePeer(id: string) {
    if (this.trusted.has(id) || this.probing.has(id) || !this.state.name) return;
    this.probing.add(id);
    try {
      const response = await this.profilePacket(id, { type: 'profile', ...this.profile(), addresses: this.addresses });
      const name = cleanName(response.name);
      if (!name) throw new Error('Nama perangkat tidak valid.');
      this.rememberPeer(id, name, this.discovered.get(id), response);
    } finally { this.probing.delete(id); }
  }

  rememberPeer(id: string, name: unknown, addresses: string[] = [], profile: Record<string, unknown> | PeerResponse | PeerProfile = {}) {
    const previous = this.trusted.get(id);
    const peer = {
      id, name: cleanName(name), addresses: addresses.length ? addresses : previous?.addresses || [],
      status: cleanStatus(profile.status ?? previous?.status), about: cleanAbout(profile.about ?? previous?.about),
      avatar: cleanAvatar(profile.avatar ?? previous?.avatar), fileChunks: profile.fileChunks === true,
      maxFileSize: peerFileLimit(profile), roomFiles: profile.roomFiles === true, reactions: profile.reactions === true,
      voiceCalls: profile.voiceCalls === true, callErrorReason: profile.callErrorReason === true,
      reminders: profile.reminders === true,
      announcements: profile.announcements === true,
    };
    this.state.trusted = this.state.trusted.filter(item => item.id !== id).concat(peer);
    this.save();
    this.reminders.syncRemote(id);
  }

  archiveThread(thread: string) {
    let name;
    if (thread === 'announcements') {
      if (!this.state.announcementRoomCreated && !this.state.messages.some(message => message.kind === 'announcement')) throw new Error('Percakapan tidak tersedia.');
      name = 'Ruang Pengumuman';
    } else if (typeof thread === 'string' && thread.startsWith('room:')) {
      const room = this.room(thread.slice(5));
      if (!room || room.pending) throw new Error('Percakapan tidak tersedia.');
      name = room.name;
    } else {
      if (!validId(thread) || !this.trusted.has(thread)) throw new Error('Percakapan tidak tersedia.');
      name = this.trusted.get(thread)!.name;
    }
    this.state.archivedThreads[thread] = name;
    this.save();
  }

  requireWritableThread(thread: string) {
    if (Object.hasOwn(this.state.archivedThreads, thread)) throw new Error('Pulihkan percakapan dari Arsip sebelum mengirim.');
  }

  restoreThread(thread: string) {
    if (typeof thread !== 'string' || !Object.hasOwn(this.state.archivedThreads, thread)) throw new Error('Percakapan belum diarsipkan.');
    if (thread.startsWith('room:') && !this.room(thread.slice(5))) throw new Error('Ruang sudah dihapus. Riwayat hanya dapat dihapus.');
    delete this.state.archivedThreads[thread];
    this.save();
  }

  async deleteArchivedHistory(thread: string) {
    if (typeof thread !== 'string' || !(Object.hasOwn(this.state.archivedThreads, thread) || validId(thread) && this.trusted.has(thread))) throw new Error('Percakapan tidak tersedia.');
    const removed = this.state.messages.filter(message => inThread(message, thread, this.id));
    this.state.messages = this.state.messages.filter(message => !inThread(message, thread, this.id));
    delete this.state.unread[thread];
    if (thread === 'announcements') this.state.announcementRoomCreated = false;
    if (thread === 'announcements' || (thread.startsWith('room:') && !this.room(thread.slice(5)))) delete this.state.archivedThreads[thread];
    const files = removed.filter(message => message.kind === 'file' && validRoomId(message.id)).map(message => message.id);
    this.state.pendingFileDeletes = [...new Set([...this.state.pendingFileDeletes, ...files])];
    this.save();
    if (!await this.cleanupDeletedFiles()) throw new Error('Riwayat dihapus, tetapi sebagian file lokal belum dapat dibersihkan. Coba mulai ulang aplikasi.');
    return removed.length;
  }

  async deleteMessages(thread: string, ids: unknown) {
    if (typeof thread !== 'string' || !Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some(id => !validRoomId(id))) throw new Error('Pilihan pesan tidak valid.');
    const selected = new Set(ids);
    const removed = this.state.messages.filter(message => selected.has(message.id) && inThread(message, thread, this.id));
    if (removed.length !== selected.size) throw new Error('Pesan tidak ditemukan dalam percakapan ini.');
    this.state.messages = this.state.messages.filter(message => !selected.has(message.id));
    this.state.pendingFileDeletes = [...new Set([...this.state.pendingFileDeletes, ...removed.filter(message => message.kind === 'file').map(message => message.id)])];
    this.save();
    if (!await this.cleanupDeletedFiles()) throw new Error('Pesan dihapus, tetapi sebagian file lokal belum dapat dibersihkan. Coba mulai ulang aplikasi.');
    return removed.length;
  }

  replyTarget(thread: string, id: unknown) {
    if (id == null) return undefined;
    if (!validRoomId(id) || !this.state.messages.some(message => message.id === id && inThread(message, thread, this.id))) throw new Error('Pesan yang dibalas tidak ditemukan.');
    return id;
  }

  saveNote(text: unknown, replyTo: unknown = null) {
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) throw new Error('Catatan harus berisi 1–4000 karakter.');
    const message: Message = { id: randomUUID(), from: this.id, fromName: this.state.name, to: null, text: text.trim(), kind: 'note', at: Date.now() };
    const reply = this.replyTarget('notes', replyTo);
    if (reply) message.replyTo = reply;
    this.state.messages.push(message);
    this.save();
    return { message, delivered: 1, failed: 0 };
  }

  room(id: unknown) { return this.state.rooms.find(room => room.id === id); }

  roomFileAllowed(from: string, id: unknown, version: unknown) {
    const room = this.room(id);
    return validRoomId(id) && room && !room.pending && room.version === version && room.members.includes(this.id) && room.members.includes(from);
  }

  archiveRemovedRoom(room: Room) {
    const key = roomKey(room.id);
    if (this.state.messages.some(message => message.roomId === room.id)) this.state.archivedThreads[key] = room.name;
    else delete this.state.archivedThreads[key];
  }

  async syncRoomsWith(id: string) {
    if (!this.online.has(id)) return;
    for (const room of this.state.rooms) {
      if (room.owner !== this.id) continue;
      if (room.members.includes(id)) await this.sendTo(id, { type: 'room-state', room: this.roomPacket(room) }).catch(() => {});
      else if (room.invited.includes(id)) await this.sendTo(id, { type: 'room-invite', room: this.roomPacket(room) }).catch(() => {});
      else if (room.removed?.[id]) await this.sendTo(id, { type: 'room-remove', id: room.id, version: room.removed[id] }).catch(() => {});
    }
    for (const tombstone of this.state.roomTombstones) if (tombstone.members.includes(id))
      await this.sendTo(id, { type: 'room-remove', id: tombstone.id, version: tombstone.version }).catch(() => {});
    for (const left of this.state.leftRooms.filter(item => item.owner === id)) {
      try {
        await this.sendTo(id, { type: 'room-leave', id: left.id });
        this.state.leftRooms = this.state.leftRooms.filter(item => item !== left);
        this.save();
      } catch { /* pemilik belum dapat dijangkau; coba lagi saat tersambung */ }
    }
  }

  roomPacket(room: Room): RoomPacket { return { id: room.id, name: room.name, owner: room.owner, version: room.version, members: room.members }; }

  async createRoom(name: unknown, selected: unknown) {
    name = cleanName(name);
    if (!name || !Array.isArray(selected) || selected.length < 1 || selected.length > MAX_MEMBERS - 1 ||
        selected.some(id => !validId(id) || id === this.id || !this.online.has(id)) || new Set(selected).size !== selected.length) throw new Error('Nama atau anggota Ruang tidak valid.');
    if (this.state.rooms.length >= MAX_ROOMS) throw new Error('Batas Ruang tercapai.');
    const room: Room = { id: randomUUID(), name: cleanName(name), owner: this.id, version: 1, members: [this.id], invited: selected, removed: {}, pending: false };
    this.state.rooms.push(room);
    this.save();
    const results = await Promise.allSettled(selected.map(id => this.sendTo(id, { type: 'room-invite', room: this.roomPacket(room) })));
    return { id: room.id, failed: results.filter(result => result.status === 'rejected').length };
  }

  async acceptRoom(id: string) {
    const room = this.room(id);
    if (!room?.pending || !this.online.has(room.owner)) throw new Error('Pembuat Ruang sedang offline.');
    await this.sendTo(room.owner, { type: 'room-accept', id });
    room.pending = false;
    this.save();
    return roomKey(id);
  }

  async declineRoom(id: string) {
    const room = this.room(id);
    if (!room?.pending) throw new Error('Undangan tidak ditemukan.');
    this.state.rooms = this.state.rooms.filter(item => item.id !== id);
    this.state.declinedRooms.push(id);
    this.save();
    if (this.online.has(room.owner)) await this.sendTo(room.owner, { type: 'room-decline', id }).catch(() => {});
  }

  async updateRoom(id: string, selected: unknown) {
    const room = this.room(id);
    if (!room || room.owner !== this.id || !Array.isArray(selected) || selected.length > MAX_MEMBERS - 1 ||
        selected.some(peer => !validId(peer) || peer === this.id || !this.trusted.has(peer)) || new Set(selected).size !== selected.length) throw new Error('Anggota Ruang tidak valid.');
    const previous = room.members.slice(1);
    const previousInvited = room.invited.slice();
    room.members = [this.id, ...previous.filter(peer => selected.includes(peer))];
    room.removed ||= {};
    for (const peer of [...previous, ...previousInvited].filter(peer => !selected.includes(peer))) room.removed[peer] = room.version + 1;
    room.invited = selected.filter(peer => !room.members.includes(peer));
    room.version++;
    this.save();
    await Promise.allSettled([...previous, ...previousInvited].filter(peer => !selected.includes(peer) && this.online.has(peer))
      .map(peer => this.sendTo(peer, { type: 'room-remove', id, version: room.version })));
    await Promise.allSettled(room.members.filter(peer => peer !== this.id && this.online.has(peer))
      .map(peer => this.sendTo(peer, { type: 'room-state', room: this.roomPacket(room) })));
    await Promise.allSettled(room.invited.filter(peer => this.online.has(peer))
      .map(peer => this.sendTo(peer, { type: 'room-invite', room: this.roomPacket(room) })));
  }

  async leaveRoom(id: string) {
    const room = this.room(id);
    if (!room || room.owner === this.id) throw new Error('Pembuat Ruang tidak dapat keluar.');
    this.state.leftRooms.push({ id, owner: room.owner });
    this.archiveRemovedRoom(room);
    this.state.rooms = this.state.rooms.filter(item => item.id !== id);
    delete this.state.unread[roomKey(id)];
    this.save();
    if (this.online.has(room.owner)) await this.syncRoomsWith(room.owner);
  }

  async deleteRoom(id: string) {
    const room = this.room(id);
    if (!room || room.owner !== this.id) throw new Error('Ruang tidak ditemukan.');
    const tombstone = { id, version: room.version + 1, members: [...new Set([...room.members, ...room.invited, ...Object.keys(room.removed || {})])] };
    this.state.roomTombstones.push(tombstone);
    this.archiveRemovedRoom(room);
    this.state.rooms = this.state.rooms.filter(item => item !== room);
    delete this.state.unread[roomKey(id)];
    this.save();
    await Promise.allSettled(tombstone.members.filter(peer => peer !== this.id && this.online.has(peer))
      .map(peer => this.sendTo(peer, { type: 'room-remove', id, version: tombstone.version })));
  }

  setAnnouncements(enabled: unknown) {
    if (typeof enabled !== 'boolean') throw new Error('Pengaturan tidak valid.');
    this.state.announcementsEnabled = enabled;
    this.save();
    this.broadcastProfile();
  }

  createAnnouncementRoom() {
    if (this.state.announcementRoomCreated) throw new Error('Ruang Pengumuman sudah dibuat.');
    this.state.announcementRoomCreated = true;
    delete this.state.archivedThreads.announcements;
    this.save();
    return true;
  }

  deleteAnnouncementRoom() {
    if (!this.state.announcementRoomCreated) throw new Error('Ruang Pengumuman tidak ditemukan.');
    this.state.announcementRoomCreated = false;
    if (this.state.messages.some(message => message.kind === 'announcement')) this.state.archivedThreads.announcements = 'Ruang Pengumuman';
    this.save();
  }

  muteAnnouncementsFrom(id: unknown, muted: unknown) {
    if (!validId(id) || !this.trusted.has(id) || typeof muted !== 'boolean') throw new Error('Pengaturan tidak valid.');
    this.state.mutedAnnouncements = this.state.mutedAnnouncements.filter(peer => peer !== id);
    if (muted) this.state.mutedAnnouncements.push(id);
    this.save();
  }

  setThreadMuted(thread: string, muted: unknown) {
    const room = typeof thread === 'string' && thread.startsWith('room:') ? this.room(thread.slice(5)) : null;
    if (typeof muted !== 'boolean' || !(room && !room.pending && room.members.includes(this.id) || validId(thread) && this.trusted.has(thread)))
      throw new Error('Percakapan tidak tersedia.');
    this.state.mutedThreads = this.state.mutedThreads.filter(id => id !== thread);
    if (muted) this.state.mutedThreads.push(thread);
    this.save();
  }

  setContactLabel(id: unknown, value: unknown) {
    if (!validId(id) || !this.trusted.has(id) || typeof value !== 'string' || value.length > 64) throw new Error('Perangkat atau tanda tidak valid.');
    const label = cleanName(value);
    if (label) this.state.contactLabels[id] = label;
    else delete this.state.contactLabels[id];
    this.save();
    return this.snapshot();
  }

  async request(target: PeerId | Multiaddr, protocol: string, payload: DataPacket | ProfilePacket, responseLimit = 4096, { responseTimeout = 30_000, signal }: SendOptions = {}): Promise<PeerResponse> {
    const dialSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000);
    const stream = await this.node!.dialProtocol(target, protocol, { signal: dialSignal });
    const abort = () => stream.abort(signal?.reason || new Error('Pengiriman dibatalkan.'));
    signal?.addEventListener('abort', abort, { once: true });
    try {
      if (signal?.aborted) abort();
      await writeStream(stream, payload);
      const response = await readStream(stream, responseLimit, responseTimeout);
      if (!response?.ok) throw new Error(typeof response?.error === 'string' ? response.error : 'Perangkat menolak permintaan.');
      return responseFields(response);
    } catch (error) { stream.abort(asError(error)); throw error; }
    finally { signal?.removeEventListener('abort', abort); }
  }

  async handleProfile(stream: PacketStream, connection: PeerConnection) {
    if (!localPeer(connection)) { stream.abort(new Error('Perangkat di luar jaringan lokal.')); return; }
    try {
      const data = await readStream(stream, 48 * 1024);
      const remoteId = connection.remotePeer.toString();
      const addresses = Array.isArray(data?.addresses) ? data.addresses.filter(address => typeof address === 'string' && localAddress(address) && address.endsWith('/p2p/' + remoteId)).slice(0, 12) : [];
      if (!this.state.name) throw new Error('Atur nama terlebih dahulu.');
      if (data?.type === 'profile') {
        const name = cleanName(data.name);
        if (name) this.rememberPeer(remoteId, name, addresses, data);
        await writeStream(stream, { ok: true, ...this.profile() });
        return;
      }
      throw new Error('Jenis permintaan tidak dikenal.');
    } catch (error) {
      try { await writeStream(stream, { ok: false, error: errorMessage(error) }); } catch { stream.abort(asError(error)); }
    }
  }

  async handleData(stream: PacketStream, connection: PeerConnection) {
    const from = connection.remotePeer.toString();
    if (this.stopping) { stream.abort(new Error('Pengiriman dibatalkan.')); return; }
    if (!localPeer(connection) || !this.trusted.has(from)) { stream.abort(new Error('Perangkat tidak dikenal di jaringan lokal.')); return; }
    let complete!: () => void;
    const done = new Promise<void>(resolve => { complete = resolve; });
    this.incomingPackets.set(stream, done);
    try {
      const data = await readStream(stream, MAX_FRAME);
      if (this.stopping) throw new Error('Pengiriman dibatalkan.');
      if (data?.type === 'hello') {
        const name = cleanName(data.name);
        if (!name) throw new Error('Nama tidak valid.');
        this.rememberPeer(from, name, [], data);
      } else if (data?.type === 'message') this.receiveMessage(from, data.message);
      else if (data?.type === 'announcement') this.receiveAnnouncement(from, data.message);
      else if (data?.type === 'room-invite') this.receiveRoomInvite(from, data.room);
      else if (data?.type === 'room-accept') await this.receiveRoomAccept(from, data.id);
      else if (data?.type === 'room-state') this.receiveRoomState(from, data.room);
      else if (data?.type === 'room-remove') this.receiveRoomRemove(from, data.id, data.version);
      else if (data?.type === 'room-leave') await this.receiveRoomLeave(from, data.id);
      else if (data?.type === 'room-decline') this.receiveRoomDecline(from, data.id);
      else if (data?.type === 'room-message') this.receiveRoomMessage(from, data.message);
      else if (data?.type === 'reaction') this.receiveReaction(from, data);
      else if (data?.type === 'typing') this.receiveTyping(from, data);
      else if (data?.type === 'call') this.receiveCall(from, data);
      else if (data?.type === 'reminder-request') { const reminder = this.reminders.receiveRequest(from, data); await writeStream(stream,{ok:true,reminder}); return; }
      else if (data?.type === 'reminder-status') this.reminders.receiveStatus(from, data);
      else if (data?.type === 'reminder-cancel') { const reminder = this.reminders.receiveCancel(from,data.id,data.expiresAt); await writeStream(stream,{ok:true,reminder}); return; }
      else if (data?.type === 'file') { stream.inactivityTimeout = 300_000; await this.receiveFile(from, data); }
      else if (data?.type === 'file-start') { stream.inactivityTimeout = 300_000; await this.beginIncomingFile(from, data.message); }
      else if (data?.type === 'file-chunk') await this.receiveFileChunk(from, data);
      else if (data?.type === 'file-end') await this.finishIncomingFile(from, data);
      else if (data?.type === 'file-cancel') await this.cancelIncomingFile(data.id, from);
      else throw new Error('Jenis paket tidak dikenal.');
      await writeStream(stream, { ok: true });
    } catch (error) {
      try { await writeStream(stream, { ok: false, error: errorMessage(error) }); } catch { stream.abort(asError(error)); }
    } finally {
      this.incomingPackets.delete(stream);
      complete();
    }
  }

  receiveMessage(from: string, input: unknown) {
    const message = record(input);
    if (!message || typeof message !== 'object' || !validRoomId(message.id) || typeof message.text !== 'string' || !message.text.trim() || message.text.length > MAX_TEXT || message.to !== this.id || message.kind !== 'text' || message.replyTo != null && !validRoomId(message.replyTo)) throw new Error('Pesan tidak valid.');
    if (this.state.messages.some(item => item.id === message.id)) return;
    this.state.messages.push({ id: message.id, from, fromName: this.trusted.get(from)!.name, to: this.id, text: message.text, kind: 'text', at: Date.now(), ...(message.replyTo ? { replyTo: message.replyTo } : {}) });
    this.clearTyping(from, from);
    this.recordIncoming(this.state.messages.at(-1)!);
  }

  receiveAnnouncement(from: string, input: unknown) {
    const message = record(input);
    if (!this.state.announcementsEnabled || this.state.mutedAnnouncements.includes(from) || !message || !validRoomId(message.id) ||
        message.kind !== 'announcement' || message.to !== null || typeof message.text !== 'string' || !message.text.trim() || message.text.length > MAX_TEXT || message.replyTo != null && !validRoomId(message.replyTo)) throw new Error('Pengumuman ditolak.');
    if (this.state.messages.some(item => item.id === message.id)) return;
    const now = Date.now();
    const recent = (this.announcementTimes.get(from) || []).filter(at => at > now - 60_000);
    if (recent.length >= 10) throw new Error('Terlalu banyak Pengumuman. Coba lagi nanti.');
    recent.push(now);
    this.announcementTimes.set(from, recent);
    this.state.messages.push({ id: message.id, from, fromName: this.trusted.get(from)!.name, to: null, text: message.text, kind: 'announcement', at: Date.now(), ...(message.replyTo ? { replyTo: message.replyTo } : {}) });
    this.recordIncoming(this.state.messages.at(-1)!);
  }

  receiveRoomInvite(from: string, input: unknown) {
    const packet = record(input);
    if (!packet || !validRoomId(packet.id) || packet.owner !== from || !cleanName(packet.name) || packet.name !== cleanName(packet.name) ||
        !safeInteger(packet.version) || packet.version < 1 || !Array.isArray(packet.members) || packet.members.length < 1 || packet.members.length > MAX_MEMBERS ||
        packet.members[0] !== from || packet.members.some(id => !validId(id)) || new Set(packet.members).size !== packet.members.length) throw new Error('Undangan Ruang tidak valid.');
    const existing = this.room(packet.id);
    if (this.state.declinedRooms.includes(packet.id)) {
      this.sendTo(from, { type: 'room-decline', id: packet.id }).catch(() => {});
      return;
    }
    if (existing) {
      if (existing.owner !== from) throw new Error('Pembuat Ruang berbeda.');
      return;
    }
    if (this.state.rooms.length >= MAX_ROOMS) throw new Error('Batas Ruang tercapai.');
    this.state.rooms.push({ id: packet.id, name: packet.name, owner: from, version: packet.version, members: packet.members, invited: [], pending: true });
    this.save();
  }

  async receiveRoomAccept(from: string, id: unknown) {
    const room = this.room(id);
    if (!room || room.owner !== this.id || !room.invited.includes(from)) throw new Error('Undangan Ruang tidak ditemukan.');
    room.invited = room.invited.filter(peer => peer !== from);
    room.members.push(from);
    room.version++;
    this.save();
    await Promise.allSettled(room.members.filter(peer => peer !== this.id && this.online.has(peer))
      .map(peer => this.sendTo(peer, { type: 'room-state', room: this.roomPacket(room) })));
  }

  receiveRoomState(from: string, input: unknown) {
    const packet = record(input);
    const room = this.room(packet?.id);
    if (!room || room.owner !== from || !safeInteger(packet.version) || packet.version < room.version ||
        !cleanName(packet.name) || packet.name !== cleanName(packet.name) || !Array.isArray(packet.members) ||
        packet.members.length < 1 || packet.members.length > MAX_MEMBERS || packet.members[0] !== from ||
        !packet.members.includes(this.id) || packet.members.some(id => !validId(id)) || new Set(packet.members).size !== packet.members.length) throw new Error('Status Ruang tidak valid.');
    room.name = packet.name;
    room.version = packet.version;
    room.members = packet.members;
    room.pending = false;
    this.save();
  }

  receiveRoomRemove(from: string, id: unknown, version: unknown) {
    const room = this.room(id);
    if (!validRoomId(id) || !room || room.owner !== from || !safeInteger(version) || version <= room.version) throw new Error('Perubahan Ruang tidak valid.');
    this.archiveRemovedRoom(room);
    this.state.rooms = this.state.rooms.filter(item => item !== room);
    delete this.state.unread[roomKey(id)];
    this.save();
  }

  receiveRoomDecline(from: string, id: unknown) {
    const room = this.room(id);
    if (!room || room.owner !== this.id || !room.invited.includes(from)) throw new Error('Undangan Ruang tidak ditemukan.');
    room.invited = room.invited.filter(peer => peer !== from);
    this.save();
  }

  async receiveRoomLeave(from: string, id: unknown) {
    const room = this.room(id);
    if (!validRoomId(id)) throw new Error('Anggota Ruang tidak ditemukan.');
    if (!room) return;
    if (room.owner !== this.id) throw new Error('Anggota Ruang tidak ditemukan.');
    if (!room.members.includes(from)) return;
    room.members = room.members.filter(peer => peer !== from);
    room.version++;
    room.removed ||= {};
    room.removed[from] = room.version;
    this.save();
    await Promise.allSettled(room.members.filter(peer => peer !== this.id && this.online.has(peer))
      .map(peer => this.sendTo(peer, { type: 'room-state', room: this.roomPacket(room) })));
  }

  receiveRoomMessage(from: string, input: unknown) {
    const message = record(input);
    const room = this.room(message?.roomId);
    if (!room || room.pending || !room.members.includes(this.id) || !room.members.includes(from) ||
        !validRoomId(message.id) || message.kind !== 'text' || message.to !== null || message.version !== room.version ||
        typeof message.text !== 'string' || !message.text.trim() || message.text.length > MAX_TEXT || message.replyTo != null && !validRoomId(message.replyTo)) throw new Error('Pesan Ruang ditolak.');
    if (this.state.messages.some(item => item.id === message.id)) return;
    const mentions = validMentions(message.text, message.mentions, room, from);
    this.state.messages.push({ id: message.id, roomId: room.id, from, fromName: this.trusted.get(from)!.name, to: null, text: message.text, kind: 'text', at: Date.now(), ...(message.replyTo ? { replyTo: message.replyTo } : {}), ...(mentions.length ? { mentions } : {}) });
    this.clearTyping(roomKey(room.id), from);
    this.recordIncoming(this.state.messages.at(-1)!);
  }

  setReaction(message: Message, peer: string, emoji: Reaction | null) {
    const reactions = { ...message.reactions };
    if (emoji === null) delete reactions[peer];
    else reactions[peer] = emoji;
    if (Object.keys(reactions).length) message.reactions = reactions;
    else delete message.reactions;
    this.save();
  }

  receiveReaction(from: string, input: unknown) {
    const packet = record(input);
    if (!validRoomId(packet.id) || packet.emoji !== null && !(typeof packet.emoji === 'string' && REACTIONS.has(packet.emoji))) throw new Error('Reaksi tidak valid.');
    let thread = from;
    if (packet.roomId !== undefined) {
      const room = this.room(packet.roomId);
      if (!room || room.pending || room.version !== packet.version || !room.members.includes(this.id) || !room.members.includes(from)) throw new Error('Reaksi Ruang ditolak.');
      thread = roomKey(room.id);
    } else if (packet.version !== undefined) throw new Error('Reaksi tidak valid.');
    const message = this.state.messages.find(item => item.id === packet.id && inThread(item, thread, this.id) && item.kind !== 'announcement');
    if (!message) throw new Error('Pesan untuk reaksi tidak ditemukan.');
    this.setReaction(message, from, packet.emoji as Reaction | null);
  }

  async receiveFile(from: string, input: unknown) {
    const data = record(input);
    const message = record(data.message), bytes = data.bytes;
    if (!message || typeof message.id !== 'string' || !/^[0-9a-f-]{36}$/.test(message.id) || typeof message.name !== 'string' || !safeFileName(message.name) || message.to !== this.id || typeof bytes !== 'string') throw new Error('File tidak valid.');
    if (this.state.messages.some(item => item.id === message.id)) return;
    const buffer = Buffer.from(bytes, 'base64');
    if (!buffer.length || buffer.length > MAX_FILE || buffer.length !== message.size || sha256(buffer).toString('hex') !== message.sha256) throw new Error('File rusak atau terlalu besar.');
    const offer = this.reserveIncomingFile(from, message.id, buffer.length);
    try {
      const accepted = await Promise.race([this.acceptFile({ id: message.id, from, fromName: this.trusted.get(from)!.name, name: safeFileName(message.name), size: buffer.length }), offer.cancellation]);
      if (offer.canceled) throw new Error('Pengiriman dibatalkan.');
      if (!accepted) throw new Error('Penerima menolak file.');
      requireDiskSpace(this.filesDir, this.incomingFileReservation());
      const path = join(this.filesDir, message.id);
      if (existsSync(path)) {
        if (!timingSafeEqual(sha256(readFileSync(path)), sha256(buffer))) throw new Error('ID file sudah digunakan.');
      } else writeFileSync(path, buffer, { flag: 'wx', mode: 0o600 });
      this.state.messages.push({ id: message.id, from, fromName: this.trusted.get(from)!.name, to: message.to, name: safeFileName(message.name), size: buffer.length, kind: 'file', at: Date.now() });
      this.recordIncoming(this.state.messages.at(-1)!);
      this.emit('file-transfer', { id: message.id, status: 'complete' });
    } catch (error) {
      if (!offer.canceled) this.emit('file-transfer', { id: message.id, status: 'canceled' });
      throw error;
    } finally {
      if (this.pendingFileOffers.get(message.id) === offer) this.pendingFileOffers.delete(message.id);
    }
  }

  incomingFileReservation() {
    return [...this.pendingFileOffers.values()].reduce((sum, offer) => sum + offer.size, 0) +
      [...this.incomingFiles.values()].reduce((sum, transfer) => sum + transfer.size - transfer.received, 0);
  }

  reserveIncomingFile(from: string, id: string, size: number) {
    if (this.stopping) throw new Error('Pengiriman dibatalkan.');
    if (this.incomingFiles.has(id) || this.pendingFileOffers.has(id)) throw new Error('ID file sudah digunakan.');
    if (this.incomingFiles.size + this.pendingFileOffers.size >= MAX_INCOMING_FILES)
      throw new Error('Perangkat sedang menerima file lain. Coba lagi nanti.');
    requireDiskSpace(this.filesDir, size + this.incomingFileReservation());
    let cancelConsent!: (value: boolean) => void;
    const cancellation = new Promise<boolean>(resolve => { cancelConsent = resolve; });
    const offer = { from, size, canceled: false, cancellation, cancelConsent };
    this.pendingFileOffers.set(id, offer);
    return offer;
  }

  resetIncomingTimer(id: string) {
    const transfer = this.incomingFiles.get(id)!;
    clearTimeout(transfer.timer ?? undefined);
    transfer.timer = setTimeout(() => {
      void this.cancelIncomingFile(id).catch(error => console.warn('Gagal membersihkan transfer file:', error));
    }, 120_000);
    transfer.timer.unref();
  }

  async cancelIncomingFile(id: unknown, from?: string) {
    const transfer = this.incomingFiles.get(typeof id === 'string' ? id : '');
    if (!transfer) {
      const offer = this.pendingFileOffers.get(typeof id === 'string' ? id : '');
      if (offer && !offer.canceled && (!from || offer.from === from)) {
        offer.canceled = true;
        offer.cancelConsent(false);
        this.emit('file-transfer', { id: typeof id === 'string' ? id : '', status: 'canceled' });
      }
      return;
    }
    if (from && transfer.from !== from) throw new Error('Pengirim file tidak valid.');
    const cleanup = (async () => {
      this.incomingFiles.delete(typeof id === 'string' ? id : '');
      clearTimeout(transfer.timer ?? undefined);
      this.emit('file-transfer', { id: typeof id === 'string' ? id : '', status: 'canceled' });
      try { await transfer.handle.close(); }
      finally { await unlink(transfer.path).catch(error => { if (errorCode(error) !== 'ENOENT') throw error; }); }
    })();
    this.incomingCleanups.add(cleanup);
    try { await cleanup; }
    finally { this.incomingCleanups.delete(cleanup); }
  }

  async beginIncomingFile(from: string, input: unknown) {
    const message = record(input);
    const roomFile = message?.roomId !== undefined;
    if (!message || typeof message.id !== 'string' || !/^[0-9a-f-]{36}$/.test(message.id) ||
        typeof message.name !== 'string' || !message.name || safeFileName(message.name) !== message.name ||
        (roomFile ? message.to !== null || !this.roomFileAllowed(from, message.roomId, message.version) : message.to !== this.id) ||
        !safeInteger(message.size) || message.size < 1 || message.size > MAX_STREAM_FILE)
      throw new Error('File tidak valid atau melebihi 5 GB.');
    if (this.state.messages.some(item => item.id === message.id) || existsSync(join(this.filesDir, message.id))) throw new Error('ID file sudah digunakan.');
    const offer = this.reserveIncomingFile(from, message.id, message.size);
    try {
      const accepted = await Promise.race([this.acceptFile({ id: message.id, from, fromName: this.trusted.get(from)!.name, name: message.name, size: message.size,
        roomId: roomFile ? message.roomId as string : null, roomName: roomFile ? this.room(message.roomId)!.name : '' }), offer.cancellation]);
      if (offer.canceled) throw new Error('Pengiriman dibatalkan.');
      if (!accepted) throw new Error('Penerima menolak file.');
      requireDiskSpace(this.filesDir, this.incomingFileReservation());
      const path = join(this.filesDir, `.upload-${message.id}.part`);
      const handle = await open(path, 'wx', 0o600);
      if (offer.canceled) {
        await handle.close();
        await unlink(path);
        throw new Error('Pengiriman dibatalkan.');
      }
      if (roomFile && !this.roomFileAllowed(from, message.roomId, message.version)) {
        await handle.close();
        await unlink(path);
        throw new Error('Keanggotaan Ruang berubah selama persetujuan file.');
      }
      this.pendingFileOffers.delete(message.id);
      this.incomingFiles.set(message.id, { ...message, id: message.id, to: roomFile ? null : this.id, name: message.name, size: message.size, ...(roomFile ? {roomId: message.roomId as string, version: message.version as number} : {}), from, path, handle, hash: createHash('sha256'), received: 0, timer: null });
      this.emit('file-transfer', { id: message.id, status: 'receiving', received: 0, total: message.size });
      this.resetIncomingTimer(message.id);
    } catch (error) {
      if (!offer.canceled) this.emit('file-transfer', { id: message.id, status: 'canceled' });
      throw error;
    } finally {
      if (this.pendingFileOffers.get(message.id) === offer) this.pendingFileOffers.delete(message.id);
    }
  }

  async receiveFileChunk(from: string, input: unknown) {
    const data = record(input);
    const transfer = this.incomingFiles.get(typeof data.id === 'string' ? data.id : '');
    if (!transfer || transfer.from !== from) throw new Error('Transfer file tidak ditemukan.');
    try {
      if (!safeInteger(data.offset) || data.offset !== transfer.received || typeof data.bytes !== 'string' || data.bytes.length > Math.ceil(FILE_CHUNK / 3) * 4 + 4)
        throw new Error('Potongan file tidak valid.');
      const bytes = Buffer.from(data.bytes, 'base64');
      if (!bytes.length || bytes.length > FILE_CHUNK || bytes.toString('base64') !== data.bytes || transfer.received + bytes.length > transfer.size)
        throw new Error('Potongan file tidak valid.');
      this.resetIncomingTimer(transfer.id);
      await writeAll(transfer.handle, bytes);
      transfer.hash.update(bytes);
      transfer.received += bytes.length;
      const percent = Math.floor(transfer.received / transfer.size * 100);
      if (percent !== transfer.lastProgressPercent) {
        transfer.lastProgressPercent = percent;
        this.emit('file-transfer', { id: transfer.id, status: 'receiving', received: transfer.received, total: transfer.size });
      }
    } catch (error) { await this.cancelIncomingFile(data.id); throw error; }
  }

  async finishIncomingFile(from: string, input: unknown) {
    const data = record(input);
    const transfer = this.incomingFiles.get(typeof data.id === 'string' ? data.id : '');
    if (!transfer) {
      if (this.state.messages.some(message => message.id === data.id && message.from === from && message.sha256 === data.sha256)) return;
      throw new Error('Transfer file tidak ditemukan.');
    }
    if (transfer.from !== from) throw new Error('Pengirim file tidak valid.');
    if (transfer.roomId && !this.roomFileAllowed(from, transfer.roomId, transfer.version)) {
      await this.cancelIncomingFile(data.id);
      throw new Error('Keanggotaan Ruang berubah selama transfer file.');
    }
    if (transfer.received !== transfer.size || typeof data.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(data.sha256) || transfer.hash.digest('hex') !== data.sha256) {
      await this.cancelIncomingFile(data.id);
      throw new Error('File tidak lengkap atau rusak.');
    }
    const finalPath = join(this.filesDir, transfer.id);
    try {
      await transfer.handle.sync();
      await transfer.handle.close();
      this.incomingFiles.delete(transfer.id);
      clearTimeout(transfer.timer ?? undefined);
      if (existsSync(finalPath)) throw new Error('ID file sudah digunakan.');
      await rename(transfer.path, finalPath);
      const message: FileMessage = { id: transfer.id, from, fromName: this.trusted.get(from)!.name, to: transfer.roomId ? null : this.id,
        ...(transfer.roomId ? { roomId: transfer.roomId } : {}),
        name: transfer.name, size: transfer.size, kind: 'file', at: Date.now(), sha256: data.sha256 };
      const thread = messageKey(message, this.id);
      const oldUnread = this.state.unread[thread] || 0;
      this.state.messages.push(message);
      this.state.unread[thread] = oldUnread + 1;
      try { this.save(); }
      catch (error) {
        this.state.messages.pop();
        if (oldUnread) this.state.unread[thread] = oldUnread;
        else delete this.state.unread[thread];
        await unlink(finalPath);
        throw error;
      }
      try { this.emit('incoming', message); }
      catch (error) { console.warn('Notifikasi file masuk gagal:', error); }
      this.emit('file-transfer', { id: transfer.id, status: 'complete' });
    } catch (error) {
      if (this.incomingFiles.has(typeof data.id === 'string' ? data.id : '')) await this.cancelIncomingFile(data.id);
      else {
        await unlink(transfer.path).catch(unlinkError => { if (errorCode(unlinkError) !== 'ENOENT') throw unlinkError; });
        this.emit('file-transfer', { id: transfer.id, status: 'canceled' });
      }
      throw error;
    }
  }

  async sendTo(id: string, payload: DataPacket, options?: SendOptions): Promise<PeerResponse> {
    if (!this.trusted.has(id)) throw new Error('Perangkat belum ditemukan di jaringan lokal.');
    if (!this.online.has(id)) throw new Error('Perangkat sedang offline.');
    return this.request(this.node!.getConnections().find(connection => connection.remotePeer.toString() === id && localPeer(connection))!.remotePeer, DATA, payload, 4096, options);
  }

  callState() {
    const call = this.activeCall;
    return call && { id: call.id, peerId: call.peerId, phase: call.phase, ...(call.sdp ? { sdp: call.sdp } : {}) };
  }

  finishCall(reason: CallReason) {
    const call = this.activeCall;
    if (!call) return;
    clearTimeout(call.timer);
    this.activeCall = null;
    this.emit('call', { type: 'end', id: call.id, peerId: call.peerId, reason });
  }

  timeCall(call: CallState & {timer?: ReturnType<typeof setTimeout> | undefined}) {
    call.timer = setTimeout(() => {
      if (this.activeCall !== call) return;
      this.finishCall('timeout');
      this.sendTo(call.peerId, { type: 'call', action: 'end', id: call.id, reason: 'timeout' }).catch(() => {});
    }, 60_000);
    call.timer.unref?.();
  }

  async sendCall(input: unknown) {
    const packet = record(input);
    if (!packet || !validRoomId(packet.id) || !validId(packet.peerId)) throw new Error('Panggilan tidak valid.');
    if (packet.action === 'offer') {
      if (!validCallSdp(packet.sdp)) throw new Error('Data audio panggilan tidak valid.');
      if (this.activeCall) throw new Error('Selesaikan panggilan yang sedang berlangsung.');
      if (!this.trusted.get(packet.peerId)?.voiceCalls) throw new Error('Penerima belum mendukung panggilan suara.');
      if (!this.online.has(packet.peerId)) throw new Error('Penerima sedang offline.');
      const call: CallState & {timer?: ReturnType<typeof setTimeout>} = { id: packet.id, peerId: packet.peerId, phase: 'outgoing' };
      this.activeCall = call;
      this.timeCall(call);
      try { await this.sendTo(call.peerId, { type: 'call', action: 'offer', id: call.id, sdp: packet.sdp }); }
      catch (error) {
        if (this.activeCall === call) {
          clearTimeout(call.timer);
          this.activeCall = null;
          this.sendTo(call.peerId, { type: 'call', action: 'end', id: call.id, reason: 'ended' }).catch(() => {});
        }
        throw error;
      }
      return true;
    }
    const call = this.activeCall;
    if (!call || call.id !== packet.id || call.peerId !== packet.peerId) throw new Error('Panggilan sudah tidak tersedia.');
    if (packet.action === 'answer') {
      if (call.phase !== 'incoming' || !validCallSdp(packet.sdp)) throw new Error('Jawaban panggilan tidak valid.');
      clearTimeout(call.timer);
      call.phase = 'connecting';
      try { await this.sendTo(call.peerId, { type: 'call', action: 'answer', id: call.id, sdp: packet.sdp }); }
      catch (error) {
        if (this.activeCall === call) {
          this.activeCall = null;
          this.sendTo(call.peerId, { type: 'call', action: 'end', id: call.id, reason: 'ended' }).catch(() => {});
        }
        throw error;
      }
      return true;
    }
    if (packet.action === 'end') {
      const reason: CallReason = typeof packet.reason === 'string' && ['declined', 'device-error'].includes(packet.reason) ? packet.reason as CallReason : 'ended';
      this.finishCall(reason);
      await this.sendTo(call.peerId, { type: 'call', action: 'end', id: call.id,
        reason: reason === 'device-error' && !this.trusted.get(call.peerId)?.callErrorReason ? 'ended' : reason }).catch(() => {});
      return true;
    }
    throw new Error('Aksi panggilan tidak valid.');
  }

  receiveCall(from: string, input: unknown) {
    const packet = record(input);
    if (!validRoomId(packet.id)) throw new Error('Panggilan tidak valid.');
    if (packet.action === 'offer') {
      if (!validCallSdp(packet.sdp)) throw new Error('Data audio panggilan tidak valid.');
      if (this.activeCall) throw new Error('Penerima sedang dalam panggilan lain. Coba lagi nanti.');
      if (this.state.status === 'dnd') throw new Error('Penerima mengaktifkan Jangan ganggu.');
      const call: CallState & {timer?: ReturnType<typeof setTimeout>} = { id: packet.id, peerId: from, phase: 'incoming', sdp: packet.sdp };
      this.activeCall = call;
      this.timeCall(call);
      this.emit('call', { type: 'offer', id: call.id, peerId: from, sdp: call.sdp! });
    } else if (packet.action === 'answer') {
      if (!validCallSdp(packet.sdp)) throw new Error('Jawaban panggilan tidak valid.');
      const call = this.activeCall;
      if (!call || call.id !== packet.id || call.peerId !== from || call.phase !== 'outgoing') throw new Error('Panggilan sudah tidak tersedia.');
      clearTimeout(call.timer);
      call.phase = 'connecting';
      this.emit('call', { type: 'answer', id: call.id, peerId: from, sdp: packet.sdp });
    } else if (packet.action === 'end') {
      if (!(typeof packet.reason === 'string' && ['ended', 'declined', 'timeout', 'device-error'].includes(packet.reason))) throw new Error('Akhir panggilan tidak valid.');
      if (this.activeCall?.id === packet.id && this.activeCall.peerId === from) this.finishCall(packet.reason as CallReason);
    } else throw new Error('Aksi panggilan tidak valid.');
  }

  async sendMessage(text: unknown, to: string, replyTo: unknown = null) {
    this.requireWritableThread(to);
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) throw new Error('Pesan harus berisi 1–4000 karakter.');
    if (!validId(to) || !this.trusted.has(to)) throw new Error('Penerima tidak dikenal.');
    if (!this.online.has(to)) throw new Error('Penerima sedang offline.');
    const message: Message = { id: randomUUID(), from: this.id, fromName: this.state.name, to, text: text.trim(), kind: 'text', at: Date.now() };
    const reply = this.replyTarget(to, replyTo);
    if (reply) message.replyTo = reply;
    await this.sendTo(to, { type: 'message', message });
    this.state.messages.push(message);
    this.save();
    return { message, delivered: 1, failed: 0 };
  }

  async react(thread: string, id: unknown, emoji: unknown) {
    if (!validRoomId(id) || !(typeof emoji === 'string' && REACTIONS.has(emoji))) throw new Error('Reaksi tidak valid.');
    const message = this.state.messages.find(item => item.id === id && inThread(item, thread, this.id) && item.kind !== 'announcement');
    if (!message) throw new Error('Pesan untuk reaksi tidak ditemukan.');
    const next = message.reactions?.[this.id] === emoji ? null : emoji as Reaction;
    if (thread === 'notes') { this.setReaction(message, this.id, next); return { delivered: 1, failed: 0 }; }
    this.requireWritableThread(thread);
    const packet: ReactionPacket = { type: 'reaction', id, emoji: next };
    if (thread?.startsWith('room:')) {
      const room = this.room(thread.slice(5));
      if (!room || room.pending || !room.members.includes(this.id)) throw new Error('Ruang tidak tersedia.');
      packet.roomId = room.id;
      packet.version = room.version;
      const targets = room.members.filter(peer => peer !== this.id && this.online.has(peer));
      if (!targets.length) throw new Error('Tidak ada anggota Ruang yang online.');
      const results = await Promise.allSettled(targets.map(peer => this.trusted.get(peer)?.reactions
        ? this.sendTo(peer, packet) : Promise.reject(new Error('Perangkat belum mendukung reaksi.'))));
      const delivered = results.filter(result => result.status === 'fulfilled').length;
      if (delivered) this.setReaction(message, this.id, next);
      return { delivered, failed: targets.length - delivered };
    }
    if (!validId(thread) || !this.trusted.has(thread)) throw new Error('Penerima tidak dikenal.');
    if (!this.online.has(thread)) throw new Error('Penerima sedang offline.');
    if (!this.trusted.get(thread)!.reactions) throw new Error('Perangkat belum mendukung reaksi.');
    await this.sendTo(thread, packet);
    this.setReaction(message, this.id, next);
    return { delivered: 1, failed: 0 };
  }

  async sendTyping(thread: unknown, active: unknown) {
    if (typeof active !== 'boolean' || typeof thread !== 'string' || Object.hasOwn(this.state.archivedThreads, thread)) return;
    if (thread.startsWith('room:')) {
      const room = this.room(thread.slice(5));
      if (!room || room.pending || !room.members.includes(this.id)) return;
      await Promise.allSettled(room.members.filter(id => id !== this.id && this.online.has(id))
        .map(id => this.sendTo(id, { type: 'typing', roomId: room.id, active })));
    } else if (validId(thread) && this.trusted.has(thread) && this.online.has(thread)) {
      await this.sendTo(thread, { type: 'typing', active }).catch(() => {});
    }
  }

  clearTyping(thread: string, from: string) {
    const key = `${thread}:${from}`;
    clearTimeout(this.typing.get(key)?.timer);
    this.typing.delete(key);
  }

  receiveTyping(from: string, input: unknown) {
    const packet = record(input);
    if (typeof packet.active !== 'boolean') throw new Error('Status mengetik tidak valid.');
    let thread = from;
    if (packet.roomId !== undefined) {
      const room = this.room(packet.roomId);
      if (!room || room.pending || !room.members.includes(this.id) || !room.members.includes(from)) throw new Error('Status mengetik tidak valid.');
      thread = roomKey(room.id);
    }
    const key = `${thread}:${from}`;
    this.clearTyping(thread, from);
    if (packet.active && !Object.hasOwn(this.state.archivedThreads, thread)) {
      const timer = setTimeout(() => { this.typing.delete(key); this.emit('typing', this.typingList()); }, 5000);
      timer.unref?.();
      this.typing.set(key, { from, thread, timer });
    }
    this.emit('typing', this.typingList());
  }

  async sendRoomMessage(text: unknown, id: string, replyTo: unknown = null, mentions: unknown = []) {
    const room = this.room(id);
    if (!room || room.pending || !room.members.includes(this.id) || typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) throw new Error('Pesan Ruang tidak valid.');
    this.requireWritableThread(roomKey(id));
    const targets = room.members.filter(peer => peer !== this.id && this.online.has(peer));
    if (!targets.length) throw new Error('Tidak ada anggota Ruang yang online.');
    const cleanText = text.trim();
    const selectedMentions = validMentions(cleanText, mentions, room, this.id);
    const message: Message = { id: randomUUID(), roomId: id, version: room.version, from: this.id, fromName: this.state.name, to: null, text: cleanText, kind: 'text', at: Date.now(), ...(selectedMentions.length ? { mentions: selectedMentions } : {}) };
    const reply = this.replyTarget(roomKey(id), replyTo);
    if (reply) message.replyTo = reply;
    const results = await Promise.allSettled(targets.map(peer => this.sendTo(peer, { type: 'room-message', message })));
    const delivered = results.filter(result => result.status === 'fulfilled').length;
    if (delivered) { this.state.messages.push(message); this.save(); }
    return { message, delivered, failed: results.length - delivered };
  }

  async sendAnnouncement(text: unknown, replyTo: unknown = null) {
    if (!this.state.announcementRoomCreated) throw new Error('Buat Ruang Pengumuman sebelum mengirim.');
    this.requireWritableThread('announcements');
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) throw new Error('Pengumuman harus berisi 1–4000 karakter.');
    const targets = [...this.online].filter(id => this.trusted.get(id)?.announcements);
    if (!targets.length) throw new Error('Tidak ada penerima Pengumuman yang online.');
    const message: Message = { id: randomUUID(), from: this.id, fromName: this.state.name, to: null, text: text.trim(), kind: 'announcement', at: Date.now() };
    const reply = this.replyTarget('announcements', replyTo);
    if (reply) message.replyTo = reply;
    const results = await Promise.allSettled(targets.map(peer => this.sendTo(peer, { type: 'announcement', message })));
    const delivered = results.filter(result => result.status === 'fulfilled').length;
    if (delivered) { this.state.messages.push(message); this.save(); }
    return { message, delivered, failed: results.length - delivered };
  }

  async sendFile(name: unknown, bytes: Uint8Array, to: string | null = null, { signal }: SendOptions = {}) {
    if (to === null) throw new Error('File hanya dapat dikirim melalui pesan pribadi.');
    this.requireWritableThread(to);
    if (signal?.aborted) throw signal?.reason || new Error('Pengiriman dibatalkan.');
    const buffer = Buffer.from(bytes);
    const filename = safeFileName(name);
    if (!filename || !buffer.length || buffer.length > MAX_FILE) throw new Error('File harus berukuran 1 B–20 MB.');
    if (to !== null && (!validId(to) || !this.trusted.has(to))) throw new Error('Penerima tidak dikenal.');
    if (to && !this.online.has(to)) throw new Error('Penerima sedang offline.');
    const message: Message = { id: randomUUID(), from: this.id, fromName: this.state.name, to, name: filename, size: buffer.length, kind: 'file', at: Date.now() };
    const packet: DataPacket = { type: 'file', message: { ...message, sha256: sha256(buffer).toString('hex') }, bytes: buffer.toString('base64') };
    const targets = to ? [to] : [...this.online];
    let delivered = 0;
    let failed = 0;
    for (const id of targets) {
      try { await this.sendTo(id, packet, { responseTimeout: 300_000, signal }); delivered++; }
      catch (error) {
        await this.sendTo(id, { type: 'file-cancel', id: message.id }).catch(() => {});
        if (to) throw error;
        failed++;
      }
    }
    if (signal?.aborted) throw signal?.reason || new Error('Pengiriman dibatalkan.');
    writeFileSync(join(this.filesDir, message.id), buffer, { flag: 'wx', mode: 0o600 });
    this.state.messages.push(message);
    this.save();
    return { message, delivered, failed };
  }

  async sendFilePath(path: string, to: string, { signal, onProgress, onStatus, onPreparationProgress }: FileOptions = {}): Promise<SendResult> {
    if (typeof path !== 'string' || !path || typeof to !== 'string') throw new Error('Penerima atau file tidak valid.');
    if (to === 'notes') return this.saveNoteFilePath(path, { signal, onProgress });
    const roomId = to.startsWith('room:') ? to.slice(5) : null;
    const room = roomId ? this.room(roomId) : null;
    if (roomId ? !room || !this.roomFileAllowed(this.id, roomId, room.version) : !validId(to) || !this.trusted.has(to))
      throw new Error('Penerima atau Ruang tidak valid.');
    this.requireWritableThread(to);
    const targets = room ? room.members.filter(id => id !== this.id && this.online.has(id)) : [to];
    if (!targets.length) throw new Error('Tidak ada anggota Ruang yang online.');
    if (!room && !this.online.has(to)) throw new Error('Penerima sedang offline.');
    const source = await stat(path);
    const filename = safeFileName(basename(path));
    if (!source.isFile() || !filename || source.size < 1 || source.size > MAX_STREAM_FILE) throw new Error('File harus berukuran 1 B–5 GB.');
    if (!room && source.size > peerFileLimit(this.trusted.get(to))) {
      const response = await this.profilePacket(to, { type: 'profile', ...this.profile(), addresses: this.addresses });
      const name = cleanName(response.name);
      if (!name) throw new Error('Nama perangkat penerima tidak valid.');
      this.rememberPeer(to, name, [], response);
    }
    if (!room && source.size > peerFileLimit(this.trusted.get(to))) {
      if (peerFileLimit(this.trusted.get(to)) === MAX_FILE) throw new Error('Perbarui Lumilan Chat pada perangkat penerima untuk mengirim file di atas 20 MB.');
      throw new Error(`Perbarui Lumilan Chat pada perangkat penerima untuk mengirim file di atas ${Math.round(peerFileLimit(this.trusted.get(to)) / 1024 / 1024)} MB.`);
    }
    if (!room && !this.trusted.get(to)!.fileChunks) {
      return this.sendFile(filename, await readFile(path), to, { signal });
    }
    if (room && targets.every(target => !this.trusted.get(target)?.roomFiles || source.size > peerFileLimit(this.trusted.get(target))))
      throw new Error('Tidak ada anggota Ruang online yang mendukung ukuran file ini. Perbarui Lumilan Chat pada perangkat penerima.');
    requireDiskSpace(this.filesDir, source.size);
    const id = randomUUID();
    const temporary = join(this.filesDir, `.outgoing-${id}.part`);
    const finalPath = join(this.filesDir, id);
    try {
      onStatus?.('preparing');
      const input = await open(path, 'r');
      try {
        const output = await open(temporary, 'wx', 0o600);
        try {
          for (let offset = 0; offset < source.size;) {
            if (signal?.aborted) throw signal?.reason || new Error('Pengiriman dibatalkan.');
            const buffer = Buffer.allocUnsafe(Math.min(FILE_CHUNK, source.size - offset));
            const { bytesRead } = await input.read(buffer, 0, buffer.length, offset);
            if (!bytesRead) throw new Error('File berubah saat disiapkan. Coba lagi.');
            await writeAll(output, buffer.subarray(0, bytesRead));
            offset += bytesRead;
            onPreparationProgress?.(offset, source.size);
          }
        } finally { await output.close(); }
      } finally { await input.close(); }
      if (signal?.aborted) throw signal?.reason || new Error('Pengiriman dibatalkan.');
      const sourceAfter = await stat(path);
      if ((await stat(temporary)).size !== source.size || sourceAfter.size !== source.size || sourceAfter.mtimeMs !== source.mtimeMs)
        throw new Error('File berubah saat disiapkan. Coba lagi.');
      const message: FileMessage = { id, from: this.id, fromName: this.state.name, to: room ? null : to,
        ...(room ? { roomId: roomId!, version: room.version } : {}), name: filename, size: source.size, kind: 'file', at: Date.now() };
      let delivered = 0;
      let digest = '';
      let lastError;
      const progress = targets.map(() => 0);
      const reportProgress = (index: number, bytes: number) => {
        progress[index] = bytes;
        onProgress?.(progress.reduce((sum, value) => sum + value, 0), targets.length * source.size);
      };
      let waiting = targets.length;
      let sending = 0;
      onStatus?.('waiting');
      // At most 63 room recipients; each reader holds only one 512 KB chunk.
      const results = await Promise.allSettled(targets.map(async (target, index) => {
        const recipientSignal = signal && AbortSignal.any([signal]);
        let offered = false;
        let accepted = false;
        try {
          if (signal?.aborted) throw signal?.reason || new Error('Pengiriman dibatalkan.');
          if (room && !this.roomFileAllowed(this.id, roomId, message.version)) throw new Error('Keanggotaan Ruang berubah selama transfer file.');
          const recipient = this.trusted.get(target);
          if (room && (!recipient?.roomFiles || source.size > peerFileLimit(recipient))) {
            throw new Error(recipient?.roomFiles
              ? `Perbarui Lumilan Chat pada perangkat penerima untuk mengirim file di atas ${Math.round(peerFileLimit(recipient) / 1024 / 1024)} MB.`
              : 'Anggota Ruang perlu memperbarui Lumilan Chat untuk menerima file.');
          }
          offered = true;
          await this.sendTo(target, { type: 'file-start', message: { id, to: room ? null : target,
            ...(room ? { roomId: roomId!, version: message.version } : {}), name: filename, size: source.size } }, { responseTimeout: 300_000, signal: recipientSignal });
          accepted = true;
          waiting--;
          sending++;
          const hash = createHash('sha256');
          const handle = await open(temporary, 'r');
          try {
            for (let offset = 0; offset < source.size;) {
              if (signal?.aborted) throw signal?.reason || new Error('Pengiriman dibatalkan.');
              if (room && !this.roomFileAllowed(this.id, roomId, message.version)) throw new Error('Keanggotaan Ruang berubah selama transfer file.');
              const buffer = Buffer.allocUnsafe(Math.min(FILE_CHUNK, source.size - offset));
              const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
              if (!bytesRead) throw new Error('File berubah saat dikirim. Coba lagi.');
              const bytes = buffer.subarray(0, bytesRead);
              await this.sendTo(target, { type: 'file-chunk', id, offset, bytes: bytes.toString('base64') }, { signal: recipientSignal });
              hash.update(bytes);
              offset += bytesRead;
              reportProgress(index, offset);
            }
          } finally { await handle.close(); }
          if (signal?.aborted) throw signal?.reason || new Error('Pengiriman dibatalkan.');
          const finish: Extract<DataPacket, {type: 'file-end'}> = { type: 'file-end', id, sha256: hash.digest('hex') };
          try { await this.sendTo(target, finish); }
          catch (error) { await this.sendTo(target, finish).catch(() => { throw error; }); }
          digest = finish.sha256;
          delivered++;
        } catch (error) {
          if (offered) await this.sendTo(target, { type: 'file-cancel', id }).catch(() => {});
          lastError = error;
        } finally {
          if (accepted) sending--;
          else waiting--;
          if (room) reportProgress(index, source.size);
          if (waiting && !sending && !signal?.aborted) onStatus?.('waiting');
        }
      }));
      for (const result of results) if (result.status === 'rejected') lastError = result.reason;
      const canceled = Boolean(signal?.aborted);
      if (!delivered) throw signal?.aborted ? signal?.reason || new Error('Pengiriman dibatalkan.') : lastError || new Error('Tidak ada anggota Ruang yang menerima file.');
      await rename(temporary, finalPath);
      this.state.messages.push({ ...message, sha256: digest });
      try { this.save(); }
      catch (error) { this.state.messages.pop(); await unlink(finalPath); throw error; }
      return { message: { ...message, sha256: digest }, delivered, failed: targets.length - delivered, canceled };
    } finally {
      await unlink(temporary).catch(error => { if (errorCode(error) !== 'ENOENT') console.warn('Gagal membersihkan file sementara:', error); });
    }
  }

  async saveNoteFilePath(path: string, { signal, onProgress }: FileOptions = {}): Promise<SendResult> {
    if (signal?.aborted) throw signal?.reason || new Error('Penyimpanan dibatalkan.');
    const source = await stat(path);
    const filename = safeFileName(basename(path));
    if (!source.isFile() || !filename || source.size < 1 || source.size > MAX_STREAM_FILE) throw new Error('File harus berukuran 1 B–5 GB.');
    requireDiskSpace(this.filesDir, source.size);
    const id = randomUUID();
    const temporary = join(this.filesDir, `.outgoing-${id}.part`);
    const finalPath = join(this.filesDir, id);
    try {
      const input = await open(path, 'r');
      try {
        const output = await open(temporary, 'wx', 0o600);
        try {
          for (let offset = 0; offset < source.size;) {
            if (signal?.aborted) throw signal?.reason || new Error('Penyimpanan dibatalkan.');
            const buffer = Buffer.allocUnsafe(Math.min(FILE_CHUNK, source.size - offset));
            const { bytesRead } = await input.read(buffer, 0, buffer.length, offset);
            if (!bytesRead) throw new Error('File berubah saat disimpan. Coba lagi.');
            await writeAll(output, buffer.subarray(0, bytesRead));
            offset += bytesRead;
            onProgress?.(offset, source.size);
          }
          await output.sync();
        } finally { await output.close(); }
      } finally { await input.close(); }
      if (signal?.aborted) throw signal?.reason || new Error('Penyimpanan dibatalkan.');
      const sourceAfter = await stat(path);
      if ((await stat(temporary)).size !== source.size || sourceAfter.size !== source.size || sourceAfter.mtimeMs !== source.mtimeMs)
        throw new Error('File berubah saat disimpan. Coba lagi.');
      await rename(temporary, finalPath);
      const message: FileMessage = { id, from: this.id, fromName: this.state.name, to: null, note: true, name: filename, size: source.size, kind: 'file', at: Date.now() };
      this.state.messages.push(message);
      try { this.save(); }
      catch (error) { this.state.messages.pop(); await unlink(finalPath); throw error; }
      return { message, delivered: 1, failed: 0 };
    } finally {
      await unlink(temporary).catch(error => { if (errorCode(error) !== 'ENOENT') console.warn('Gagal membersihkan file sementara:', error); });
    }
  }

  listMessages(thread: string, before: unknown = null): Message[] {
    if (thread !== 'notes' && thread !== 'announcements' && !Object.hasOwn(this.state.archivedThreads, thread) && !(typeof thread === 'string' && thread.startsWith('room:') && this.room(thread.slice(5)) && !this.room(thread.slice(5))!.pending) &&
        (!validId(thread) || !this.online.has(thread))) throw new Error('Percakapan tidak tersedia.');
    if (before !== null && (typeof before !== 'string' || !/^[0-9a-f-]{36}$/.test(before))) throw new Error('Posisi pesan tidak valid.');
    const end = before === null ? this.state.messages.length : this.state.messages.findIndex(message => message.id === before);
    if (end < 0) throw new Error('Posisi pesan tidak ditemukan.');
    const items = [];
    for (let index = end - 1; index >= 0 && items.length < 100; index--) {
      const message = this.state.messages[index]!;
      if (inThread(message, thread, this.id)) items.push(message);
    }
    return items.reverse();
  }

  listFiles(thread: string, offset = 0) {
    const room = typeof thread === 'string' && thread.startsWith('room:') ? this.room(thread.slice(5)) : null;
    if (thread !== 'notes' && !(room && !room.pending) && !(typeof thread === 'string' && thread.startsWith('room:') && Object.hasOwn(this.state.archivedThreads, thread)) &&
        !(validId(thread) && (this.online.has(thread) || Object.hasOwn(this.state.archivedThreads, thread))))
      throw new Error('Percakapan tidak tersedia.');
    if (!Number.isInteger(offset) || offset < 0) throw new Error('Halaman file tidak valid.');
    const items = [];
    let total = 0;
    for (let index = this.state.messages.length - 1; index >= 0; index--) {
      const message = this.state.messages[index]!;
      if (message.kind !== 'file' || !inThread(message, thread, this.id)) continue;
      if (total >= offset && items.length < 50) items.push(message);
      total++;
    }
    return { items, total };
  }

  file(id: string) {
    const message = this.state.messages.find((item): item is FileMessage => item.id === id && item.kind === 'file');
    if (!message) throw new Error('File tidak ditemukan.');
    return { name: message.name, bytes: readFileSync(join(this.filesDir, id)) };
  }

  filePath(id: string) {
    const message = this.state.messages.find((item): item is FileMessage => item.id === id && item.kind === 'file');
    if (!message) throw new Error('File tidak ditemukan.');
    return { name: message.name, path: join(this.filesDir, id) };
  }

}
