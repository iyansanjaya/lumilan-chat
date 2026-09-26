import { EventEmitter } from 'node:events';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { constants, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statfsSync, writeFileSync } from 'node:fs';
import { copyFile, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { networkInterfaces } from 'node:os';
import { createLibp2p } from 'libp2p';
import { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } from '@libp2p/crypto/keys';
import { tcp } from '@libp2p/tcp';
import { noise } from '@libp2p/noise';
import { yamux } from '@libp2p/yamux';
import { identify } from '@libp2p/identify';
import { multiaddr } from '@multiformats/multiaddr';
import { LanDiscovery, lanIPv4 } from './discovery.js';

const PROFILE = '/lumilan/profile/1.0.0';
const DATA = '/lumilan/data/1.0.0';
const MAX_FILE = 20 * 1024 * 1024;
const MAX_STREAM_FILE = 100 * 1024 * 1024;
const FILE_CHUNK = 512 * 1024;
const MAX_FRAME = 29 * 1024 * 1024;
const MAX_TEXT = 4000;
const MAX_AVATAR = 24 * 1024;
const MAX_ROOMS = 64;
const MAX_MEMBERS = 64;
const STATUSES = new Set(['active', 'busy', 'away', 'dnd']);
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

const sha256 = value => createHash('sha256').update(value).digest();
const stripControls = value => value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '');
const cleanName = value => typeof value === 'string' ? stripControls(value).trim().replace(/\s+/g, ' ').slice(0, 32) : '';
const safeFileName = value => {
  const name = basename(String(value || '').replaceAll('\\', '/')).replace(/[<>:"/\\|?*]/g, '_').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').replace(/[. ]+$/, '').trim().slice(0, 180);
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? `_${name}` : name;
};
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9]{30,100}$/.test(value);
const validRoomId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const roomKey = id => `room:${id}`;
const messageKey = (message, ownId) => message.roomId ? roomKey(message.roomId) : message.kind === 'announcement' ? 'announcements' : message.from === ownId ? message.to : message.from;
const inThread = (message, thread, ownId) => thread === 'announcements' ? message.kind === 'announcement'
  : thread?.startsWith('room:') ? message.roomId === thread.slice(5)
  : (message.to === thread && message.from === ownId) || (message.from === thread && message.to === ownId);
const cleanAbout = value => typeof value === 'string' ? stripControls(value).trim().replace(/\s+/g, ' ').slice(0, 100) : '';
const cleanStatus = value => STATUSES.has(value) ? value : 'active';
const cleanAvatar = value => {
  if (!value) return '';
  if (typeof value !== 'string' || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return '';
  const bytes = Buffer.from(value.slice(value.indexOf(',') + 1), 'base64');
  return bytes.length > 0 && bytes.length <= MAX_AVATAR ? value : '';
};
const networkSignature = () => Object.entries(networkInterfaces())
  .flatMap(([name, addresses]) => (addresses || []).filter(address => address.family === 'IPv4' && !address.internal)
    .map(address => `${name}:${address.address}/${address.netmask}`)).sort().join('|');

function addressPriority(address) {
  const ip = /^\/ip4\/([^/]+)/.exec(address)?.[1];
  if (!ip) return 3;
  if (ip.startsWith('127.')) return 2;
  const number = ip.split('.').map(Number).reduce((value, byte) => (value * 256 + byte) >>> 0, 0);
  for (const addresses of Object.values(networkInterfaces())) for (const local of addresses || []) {
    if (local.family !== 'IPv4' || local.internal) continue;
    const own = local.address.split('.').map(Number).reduce((value, byte) => (value * 256 + byte) >>> 0, 0);
    const mask = local.netmask.split('.').map(Number).reduce((value, byte) => (value * 256 + byte) >>> 0, 0);
    if ((number & mask) === (own & mask)) return 0;
  }
  return 1;
}

function localAddress(address) {
  const match = /^\/ip4\/(\d+\.\d+\.\d+\.\d+)\/tcp\/(\d+)\/p2p\/([a-zA-Z0-9]+)$/.exec(address);
  return Boolean(match && lanIPv4(match[1]) && +match[2] >= 1 && +match[2] <= 65535);
}

function localPeer(connection) {
  const id = connection.remotePeer.toString();
  const address = connection.remoteAddr.toString();
  return localAddress(address.endsWith('/p2p/' + id) ? address : address + '/p2p/' + id);
}

function saveJson(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
  renameSync(temporary, path);
}

function requireDiskSpace(directory, size) {
  const disk = statfsSync(directory, { bigint: true });
  if (disk.bavail * disk.bsize < BigInt(size) + 10n * 1024n * 1024n) throw new Error('Ruang penyimpanan tidak cukup untuk file ini.');
}

async function writeAll(handle, bytes) {
  for (let offset = 0; offset < bytes.length;) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset);
    if (!bytesWritten) throw new Error('File tidak dapat disimpan.');
    offset += bytesWritten;
  }
}

async function readStream(stream, limit, timeout = 30_000) {
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
  return JSON.parse(decoder.decode(Buffer.concat(chunks)));
}

async function writeStream(stream, value) {
  const bytes = encoder.encode(JSON.stringify(value));
  for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
    if (!stream.send(bytes.subarray(offset, offset + 64 * 1024))) await stream.onDrain();
  }
  await stream.close();
}

export class LumilanPeer extends EventEmitter {
  constructor({ dataDir, discovery = true, listen = '/ip4/0.0.0.0/tcp/40754', getNetwork = networkSignature, acceptFile = async () => false }) {
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
    this.state = { name: '', status: 'active', about: '', avatar: '', trusted: [], rooms: [], declinedRooms: [], leftRooms: [], roomTombstones: [], messages: [], unread: {}, announcementsEnabled: true, mutedAnnouncements: [] };
    this.node = null;
    this.identity = null;
    this.discovered = new Map();
    this.probing = new Set();
    this.dialing = new Set();
    this.incomingFiles = new Map();
    this.pendingFileOffers = new Map();
    this.announcementTimes = new Map();
  }

  get id() { return this.node?.peerId.toString() || this.identity; }
  get trusted() { return new Map(this.state.trusted.map(peer => [peer.id, peer])); }
  get online() { return new Set((this.node?.getConnections() || []).filter(localPeer).map(connection => connection.remotePeer.toString()).filter(id => this.trusted.has(id))); }
  get addresses() { return (this.node?.getMultiaddrs() || []).map(address => address.toString()).filter(localAddress).filter(address => this.listen.includes('/127.') || !address.includes('/ip4/127.')).sort((a, b) => addressPriority(a) - addressPriority(b)).slice(0, 12); }

  async start() {
    mkdirSync(this.filesDir, { recursive: true, mode: 0o700 });
    for (const name of readdirSync(this.filesDir)) if (/^\.(?:upload|outgoing)-[0-9a-f-]{36}\.part$/.test(name)) {
      await unlink(join(this.filesDir, name)).catch(error => console.warn('Gagal membersihkan transfer lama:', error));
    }
    if (existsSync(this.path)) this.state = JSON.parse(readFileSync(this.path, 'utf8'));
    this.state.unread ||= {};
    delete this.state.unread.room;
    this.state.rooms ||= [];
    this.state.declinedRooms ||= [];
    this.state.leftRooms ||= [];
    this.state.roomTombstones ||= [];
    this.state.announcementsEnabled = this.state.announcementsEnabled !== false;
    this.state.mutedAnnouncements ||= [];
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
    this.identity = this.node.peerId.toString();
    await this.node.handle(PROFILE, (stream, connection) => this.handleProfile(stream, connection), { maxInboundStreams: 2 });
    await this.node.handle(DATA, (stream, connection) => this.handleData(stream, connection), { maxInboundStreams: 8 });
    this.node.addEventListener('peer:discovery', event => {
      const id = event.detail.id.toString();
      if (!validId(id) || id === this.id) return;
      const addresses = event.detail.multiaddrs.map(address => address.toString()).map(address => address.endsWith(`/p2p/${id}`) ? address : `${address}/p2p/${id}`).filter(localAddress).filter(address => this.listen.includes('/127.') || !address.includes('/ip4/127.')).sort((a, b) => addressPriority(a) - addressPriority(b)).slice(0, 12);
      if (!addresses.length) return;
      if (this.discovered.size >= 64 && !this.discovered.has(id)) this.discovered.delete(this.discovered.keys().next().value);
      this.discovered.set(id, addresses);
      if (this.trusted.has(id)) this.dialKnown(id, this.discovered.get(id)).catch(() => {});
      else this.probePeer(id).catch(() => {});
    });
    this.node.addEventListener('peer:connect', event => {
      const id = event.detail.toString();
      this.emit('change');
      if (this.trusted.has(id)) {
        this.sendTo(id, { type: 'hello', ...this.profile() }).catch(() => {});
        this.syncRoomsWith(id).catch(() => {});
      }
      else if (this.discovered.has(id)) this.probePeer(id).catch(() => {});
    });
    this.node.addEventListener('peer:disconnect', () => this.emit('change'));
    await this.node.start();
    for (const peer of this.state.trusted) this.dialKnown(peer.id, peer.addresses || []).catch(() => {});
    return this;
  }

  async dialKnown(id, addresses) {
    if (this.online.has(id) || this.dialing.has(id)) return;
    this.dialing.add(id);
    try {
      const targets = addresses.map(address => address.endsWith(`/p2p/${id}`) ? address : `${address}/p2p/${id}`)
        .filter(localAddress).sort((a, b) => addressPriority(a) - addressPriority(b)).slice(0, 12);
      if (targets.length) await Promise.any(targets.map(target => this.node.dial(multiaddr(target), { signal: AbortSignal.timeout(5000) })));
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

  async stop() {
    for (const offer of this.pendingFileOffers.values()) offer.canceled = true;
    for (const id of this.incomingFiles.keys()) await this.cancelIncomingFile(id);
    if (this.node) { await this.node.stop(); this.node = null; }
  }

  async connectAddress(value) {
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

  snapshot() {
    const online = this.online;
    const visibleMessages = this.state.messages.filter(message => message.roomId ? this.state.rooms.some(room => room.id === message.roomId && !room.pending)
      : message.kind === 'announcement' ? true : message.to && online.has(message.from === this.id ? message.to : message.from));
    const stats = {};
    const recentFiles = {};
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
      stats, recentFiles,
      me: { id: this.id, name: this.state.name, status: this.state.status, about: this.state.about, avatar: this.state.avatar },
      addresses: this.addresses,
      rooms: this.state.rooms.map(room => ({ id: room.id, name: room.name, owner: room.owner, pending: room.pending,
        members: room.members, onlineMembers: room.members.filter(id => id === this.id || online.has(id)),
        invited: room.owner === this.id ? room.invited : undefined })),
      contacts: this.state.trusted.map(peer => ({ id: peer.id, name: peer.name })),
      announcementsEnabled: this.state.announcementsEnabled,
      mutedAnnouncements: this.state.mutedAnnouncements,
      peers: this.state.trusted.filter(peer => online.has(peer.id)).map(peer => ({
        id: peer.id, name: peer.name, online: true, status: cleanStatus(peer.status), about: cleanAbout(peer.about), avatar: cleanAvatar(peer.avatar), announcements: peer.announcements === true,
      })),
      messages: visibleMessages.slice(-1000),
      unread: Object.fromEntries(Object.entries(this.state.unread).filter(([id]) => id === 'announcements' ||
        id.startsWith('room:') && this.state.rooms.some(room => roomKey(room.id) === id && !room.pending) || online.has(id))),
    };
  }

  rename(value) {
    const name = cleanName(value);
    if (!name) throw new Error('Nama tidak boleh kosong.');
    this.state.name = name;
    this.save();
    for (const id of this.discovered.keys()) if (!this.trusted.has(id)) this.probePeer(id).catch(() => {});
    this.broadcastProfile();
    return this.snapshot();
  }

  profile() { return { name: this.state.name, status: this.state.status, about: this.state.about, avatar: this.state.avatar, fileChunks: true, announcements: this.state.announcementsEnabled }; }

  broadcastProfile() {
    if (!this.state.name) return;
    for (const id of this.online) this.sendTo(id, { type: 'hello', ...this.profile() }).catch(() => {});
  }

  setProfile(value) {
    if (!value || typeof value !== 'object' || !cleanName(value.name) || !STATUSES.has(value.status) ||
        typeof value.about !== 'string' || value.about.length > 100 ||
        typeof value.avatar !== 'string' || value.avatar && !cleanAvatar(value.avatar)) throw new Error('Profil tidak valid.');
    this.state.name = cleanName(value.name);
    this.state.status = value.status;
    this.state.about = cleanAbout(value.about);
    this.state.avatar = value.avatar;
    this.save();
    this.broadcastProfile();
    return this.snapshot();
  }

  save() { saveJson(this.path, this.state); this.emit('change'); }

  markRead(thread) {
    const key = thread;
    if (key !== 'announcements' && !validId(key) && !(typeof key === 'string' && key.startsWith('room:') && validRoomId(key.slice(5)))) throw new Error('Percakapan tidak valid.');
    if (!this.state.unread[key]) return;
    delete this.state.unread[key];
    this.save();
  }

  recordIncoming(message) {
    const key = messageKey(message, this.id);
    this.state.unread[key] = (this.state.unread[key] || 0) + 1;
    this.save();
    this.emit('incoming', message);
  }

  async profilePacket(id, payload, addresses = this.discovered.get(id) || []) {
    if (!validId(id) || id === this.id) throw new Error('Perangkat tidak valid.');
    const connection = this.node.getConnections().find(item => item.remotePeer.toString() === id && localPeer(item));
    if (connection) return this.request(connection.remotePeer, PROFILE, payload, 48 * 1024);
    const targets = addresses.filter(address => localAddress(address) && address.endsWith(`/p2p/${id}`))
      .sort((a, b) => addressPriority(a) - addressPriority(b)).slice(0, 12);
    if (!targets.length) throw new Error('Perangkat tidak memiliki alamat LAN yang dapat dihubungi.');
    try { return await Promise.any(targets.map(address => this.request(multiaddr(address), PROFILE, payload, 48 * 1024))); }
    catch (error) { throw new Error('Perangkat tidak dapat dihubungi di jaringan lokal.', { cause: error }); }
  }

  async probePeer(id) {
    if (this.trusted.has(id) || this.probing.has(id) || !this.state.name) return;
    this.probing.add(id);
    try {
      const response = await this.profilePacket(id, { type: 'profile', ...this.profile(), addresses: this.addresses });
      const name = cleanName(response.name);
      if (!name) throw new Error('Nama perangkat tidak valid.');
      this.rememberPeer(id, name, this.discovered.get(id), response);
    } finally { this.probing.delete(id); }
  }

  rememberPeer(id, name, addresses = [], profile = {}) {
    const previous = this.trusted.get(id);
    const peer = {
      id, name: cleanName(name), addresses: addresses.length ? addresses : previous?.addresses || [],
      status: cleanStatus(profile.status ?? previous?.status), about: cleanAbout(profile.about ?? previous?.about),
      avatar: cleanAvatar(profile.avatar ?? previous?.avatar), fileChunks: profile.fileChunks === true,
      announcements: profile.announcements === true,
    };
    this.state.trusted = this.state.trusted.filter(item => item.id !== id).concat(peer);
    this.save();
  }

  room(id) { return this.state.rooms.find(room => room.id === id); }

  async syncRoomsWith(id) {
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

  roomPacket(room) { return { id: room.id, name: room.name, owner: room.owner, version: room.version, members: room.members }; }

  async createRoom(name, selected) {
    name = cleanName(name);
    if (!name || !Array.isArray(selected) || selected.length < 1 || selected.length > MAX_MEMBERS - 1 ||
        selected.some(id => !validId(id) || id === this.id || !this.online.has(id)) || new Set(selected).size !== selected.length) throw new Error('Nama atau anggota Ruang tidak valid.');
    if (this.state.rooms.length >= MAX_ROOMS) throw new Error('Batas Ruang tercapai.');
    const room = { id: randomUUID(), name, owner: this.id, version: 1, members: [this.id], invited: selected, removed: {}, pending: false };
    this.state.rooms.push(room);
    this.save();
    const results = await Promise.allSettled(selected.map(id => this.sendTo(id, { type: 'room-invite', room: this.roomPacket(room) })));
    return { id: room.id, failed: results.filter(result => result.status === 'rejected').length };
  }

  async acceptRoom(id) {
    const room = this.room(id);
    if (!room?.pending || !this.online.has(room.owner)) throw new Error('Pembuat Ruang sedang offline.');
    await this.sendTo(room.owner, { type: 'room-accept', id });
    room.pending = false;
    this.save();
    return roomKey(id);
  }

  async declineRoom(id) {
    const room = this.room(id);
    if (!room?.pending) throw new Error('Undangan tidak ditemukan.');
    this.state.rooms = this.state.rooms.filter(item => item.id !== id);
    this.state.declinedRooms.push(id);
    this.save();
    if (this.online.has(room.owner)) await this.sendTo(room.owner, { type: 'room-decline', id }).catch(() => {});
  }

  async updateRoom(id, selected) {
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

  async leaveRoom(id) {
    const room = this.room(id);
    if (!room || room.owner === this.id) throw new Error('Pembuat Ruang tidak dapat keluar.');
    this.state.leftRooms.push({ id, owner: room.owner });
    this.state.rooms = this.state.rooms.filter(item => item.id !== id);
    delete this.state.unread[roomKey(id)];
    this.save();
    if (this.online.has(room.owner)) await this.syncRoomsWith(room.owner);
  }

  async deleteRoom(id) {
    const room = this.room(id);
    if (!room || room.owner !== this.id) throw new Error('Ruang tidak ditemukan.');
    const tombstone = { id, version: room.version + 1, members: [...new Set([...room.members, ...room.invited, ...Object.keys(room.removed || {})])] };
    this.state.roomTombstones.push(tombstone);
    this.state.rooms = this.state.rooms.filter(item => item !== room);
    delete this.state.unread[roomKey(id)];
    this.save();
    await Promise.allSettled(tombstone.members.filter(peer => peer !== this.id && this.online.has(peer))
      .map(peer => this.sendTo(peer, { type: 'room-remove', id, version: tombstone.version })));
  }

  setAnnouncements(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Pengaturan tidak valid.');
    this.state.announcementsEnabled = enabled;
    this.save();
    this.broadcastProfile();
  }

  muteAnnouncementsFrom(id, muted) {
    if (!validId(id) || !this.trusted.has(id) || typeof muted !== 'boolean') throw new Error('Pengaturan tidak valid.');
    this.state.mutedAnnouncements = this.state.mutedAnnouncements.filter(peer => peer !== id);
    if (muted) this.state.mutedAnnouncements.push(id);
    this.save();
  }

  async request(target, protocol, payload, responseLimit = 4096, { responseTimeout = 30_000, signal } = {}) {
    const dialSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000);
    const stream = await this.node.dialProtocol(target, protocol, { signal: dialSignal });
    const abort = () => stream.abort(signal.reason || new Error('Pengiriman dibatalkan.'));
    signal?.addEventListener('abort', abort, { once: true });
    try {
      if (signal?.aborted) abort();
      await writeStream(stream, payload);
      const response = await readStream(stream, responseLimit, responseTimeout);
      if (!response?.ok) throw new Error(response?.error || 'Perangkat menolak permintaan.');
      return response;
    } catch (error) { stream.abort(error); throw error; }
    finally { signal?.removeEventListener('abort', abort); }
  }

  async handleProfile(stream, connection) {
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
      try { await writeStream(stream, { ok: false, error: error.message }); } catch { stream.abort(error); }
    }
  }

  async handleData(stream, connection) {
    const from = connection.remotePeer.toString();
    if (!localPeer(connection) || !this.trusted.has(from)) { stream.abort(new Error('Perangkat tidak dikenal di jaringan lokal.')); return; }
    try {
      const data = await readStream(stream, MAX_FRAME);
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
      else if (data?.type === 'file') { stream.inactivityTimeout = 300_000; await this.receiveFile(from, data); }
      else if (data?.type === 'file-start') { stream.inactivityTimeout = 300_000; await this.beginIncomingFile(from, data.message); }
      else if (data?.type === 'file-chunk') await this.receiveFileChunk(from, data);
      else if (data?.type === 'file-end') await this.finishIncomingFile(from, data);
      else if (data?.type === 'file-cancel') await this.cancelIncomingFile(data.id, from);
      else throw new Error('Jenis paket tidak dikenal.');
      await writeStream(stream, { ok: true });
    } catch (error) {
      try { await writeStream(stream, { ok: false, error: error.message }); } catch { stream.abort(error); }
    }
  }

  receiveMessage(from, message) {
    if (!message || typeof message !== 'object' || !validRoomId(message.id) || typeof message.text !== 'string' || !message.text.trim() || message.text.length > MAX_TEXT || message.to !== this.id || message.kind !== 'text') throw new Error('Pesan tidak valid.');
    if (this.state.messages.some(item => item.id === message.id)) return;
    this.state.messages.push({ id: message.id, from, fromName: this.trusted.get(from).name, to: this.id, text: message.text, kind: 'text', at: Date.now() });
    this.recordIncoming(this.state.messages.at(-1));
  }

  receiveAnnouncement(from, message) {
    if (!this.state.announcementsEnabled || this.state.mutedAnnouncements.includes(from) || !message || !validRoomId(message.id) ||
        message.kind !== 'announcement' || message.to !== null || typeof message.text !== 'string' || !message.text.trim() || message.text.length > MAX_TEXT) throw new Error('Pengumuman ditolak.');
    if (this.state.messages.some(item => item.id === message.id)) return;
    const now = Date.now();
    const recent = (this.announcementTimes.get(from) || []).filter(at => at > now - 60_000);
    if (recent.length >= 10) throw new Error('Terlalu banyak Pengumuman. Coba lagi nanti.');
    recent.push(now);
    this.announcementTimes.set(from, recent);
    this.state.messages.push({ id: message.id, from, fromName: this.trusted.get(from).name, to: null, text: message.text, kind: 'announcement', at: Date.now() });
    this.recordIncoming(this.state.messages.at(-1));
  }

  receiveRoomInvite(from, packet) {
    if (!packet || !validRoomId(packet.id) || packet.owner !== from || !cleanName(packet.name) || packet.name !== cleanName(packet.name) ||
        !Number.isSafeInteger(packet.version) || packet.version < 1 || !Array.isArray(packet.members) || packet.members.length < 1 || packet.members.length > MAX_MEMBERS ||
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

  async receiveRoomAccept(from, id) {
    const room = this.room(id);
    if (!room || room.owner !== this.id || !room.invited.includes(from)) throw new Error('Undangan Ruang tidak ditemukan.');
    room.invited = room.invited.filter(peer => peer !== from);
    room.members.push(from);
    room.version++;
    this.save();
    await Promise.allSettled(room.members.filter(peer => peer !== this.id && this.online.has(peer))
      .map(peer => this.sendTo(peer, { type: 'room-state', room: this.roomPacket(room) })));
  }

  receiveRoomState(from, packet) {
    const room = this.room(packet?.id);
    if (!room || room.owner !== from || !Number.isSafeInteger(packet.version) || packet.version < room.version ||
        !cleanName(packet.name) || packet.name !== cleanName(packet.name) || !Array.isArray(packet.members) ||
        packet.members.length < 1 || packet.members.length > MAX_MEMBERS || packet.members[0] !== from ||
        !packet.members.includes(this.id) || packet.members.some(id => !validId(id)) || new Set(packet.members).size !== packet.members.length) throw new Error('Status Ruang tidak valid.');
    room.name = packet.name;
    room.version = packet.version;
    room.members = packet.members;
    room.pending = false;
    this.save();
  }

  receiveRoomRemove(from, id, version) {
    const room = this.room(id);
    if (!room || room.owner !== from || !Number.isSafeInteger(version) || version <= room.version) throw new Error('Perubahan Ruang tidak valid.');
    this.state.rooms = this.state.rooms.filter(item => item !== room);
    delete this.state.unread[roomKey(id)];
    this.save();
  }

  receiveRoomDecline(from, id) {
    const room = this.room(id);
    if (!room || room.owner !== this.id || !room.invited.includes(from)) throw new Error('Undangan Ruang tidak ditemukan.');
    room.invited = room.invited.filter(peer => peer !== from);
    this.save();
  }

  async receiveRoomLeave(from, id) {
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

  receiveRoomMessage(from, message) {
    const room = this.room(message?.roomId);
    if (!room || room.pending || !room.members.includes(this.id) || !room.members.includes(from) ||
        !validRoomId(message.id) || message.kind !== 'text' || message.to !== null || message.version !== room.version ||
        typeof message.text !== 'string' || !message.text.trim() || message.text.length > MAX_TEXT) throw new Error('Pesan Ruang ditolak.');
    if (this.state.messages.some(item => item.id === message.id)) return;
    this.state.messages.push({ id: message.id, roomId: room.id, from, fromName: this.trusted.get(from).name, to: null, text: message.text, kind: 'text', at: Date.now() });
    this.recordIncoming(this.state.messages.at(-1));
  }

  async receiveFile(from, data) {
    const { message, bytes } = data;
    if (!message || typeof message.id !== 'string' || !/^[0-9a-f-]{36}$/.test(message.id) || typeof message.name !== 'string' || !safeFileName(message.name) || message.to !== this.id || typeof bytes !== 'string') throw new Error('File tidak valid.');
    if (this.state.messages.some(item => item.id === message.id)) return;
    const buffer = Buffer.from(bytes, 'base64');
    if (!buffer.length || buffer.length > MAX_FILE || buffer.length !== message.size || sha256(buffer).toString('hex') !== message.sha256) throw new Error('File rusak atau terlalu besar.');
    if (!await this.acceptFile({ from, fromName: this.trusted.get(from).name, name: safeFileName(message.name), size: buffer.length })) throw new Error('Penerima menolak file.');
    requireDiskSpace(this.filesDir, buffer.length);
    const path = join(this.filesDir, message.id);
    if (existsSync(path)) {
      if (!timingSafeEqual(sha256(readFileSync(path)), sha256(buffer))) throw new Error('ID file sudah digunakan.');
    } else writeFileSync(path, buffer, { flag: 'wx', mode: 0o600 });
    this.state.messages.push({ id: message.id, from, fromName: this.trusted.get(from).name, to: message.to, name: safeFileName(message.name), size: buffer.length, kind: 'file', at: Date.now() });
    this.recordIncoming(this.state.messages.at(-1));
  }

  resetIncomingTimer(id) {
    const transfer = this.incomingFiles.get(id);
    clearTimeout(transfer.timer);
    transfer.timer = setTimeout(() => {
      void this.cancelIncomingFile(id).catch(error => console.warn('Gagal membersihkan transfer file:', error));
    }, 120_000);
    transfer.timer.unref();
  }

  async cancelIncomingFile(id, from) {
    const transfer = this.incomingFiles.get(id);
    if (!transfer) {
      const offer = this.pendingFileOffers.get(id);
      if (offer && (!from || offer.from === from)) offer.canceled = true;
      return;
    }
    if (from && transfer.from !== from) throw new Error('Pengirim file tidak valid.');
    this.incomingFiles.delete(id);
    clearTimeout(transfer.timer);
    try { await transfer.handle.close(); }
    finally { await unlink(transfer.path).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }

  async beginIncomingFile(from, message) {
    if (!message || typeof message.id !== 'string' || !/^[0-9a-f-]{36}$/.test(message.id) ||
        typeof message.name !== 'string' || !message.name || safeFileName(message.name) !== message.name ||
        message.to !== this.id || !Number.isSafeInteger(message.size) || message.size < 1 || message.size > MAX_STREAM_FILE)
      throw new Error('File tidak valid atau melebihi 100 MB.');
    if (this.state.messages.some(item => item.id === message.id) || existsSync(join(this.filesDir, message.id))) throw new Error('ID file sudah digunakan.');
    if (this.incomingFiles.size || this.pendingFileOffers.size) throw new Error('Perangkat sedang menerima file lain. Coba lagi nanti.');
    requireDiskSpace(this.filesDir, message.size);
    const offer = { from, canceled: false };
    this.pendingFileOffers.set(message.id, offer);
    try {
      const accepted = await this.acceptFile({ from, fromName: this.trusted.get(from).name, name: message.name, size: message.size });
      if (offer.canceled) throw new Error('Pengiriman dibatalkan.');
      if (!accepted) throw new Error('Penerima menolak file.');
      const path = join(this.filesDir, `.upload-${message.id}.part`);
      const handle = await open(path, 'wx', 0o600);
      if (offer.canceled) {
        await handle.close();
        await unlink(path);
        throw new Error('Pengiriman dibatalkan.');
      }
      this.incomingFiles.set(message.id, { ...message, from, path, handle, hash: createHash('sha256'), received: 0, timer: null });
      this.resetIncomingTimer(message.id);
    } finally { this.pendingFileOffers.delete(message.id); }
  }

  async receiveFileChunk(from, data) {
    const transfer = this.incomingFiles.get(data.id);
    if (!transfer || transfer.from !== from) throw new Error('Transfer file tidak ditemukan.');
    try {
      if (!Number.isSafeInteger(data.offset) || data.offset !== transfer.received || typeof data.bytes !== 'string' || data.bytes.length > Math.ceil(FILE_CHUNK / 3) * 4 + 4)
        throw new Error('Potongan file tidak valid.');
      const bytes = Buffer.from(data.bytes, 'base64');
      if (!bytes.length || bytes.length > FILE_CHUNK || bytes.toString('base64') !== data.bytes || transfer.received + bytes.length > transfer.size)
        throw new Error('Potongan file tidak valid.');
      this.resetIncomingTimer(data.id);
      await writeAll(transfer.handle, bytes);
      transfer.hash.update(bytes);
      transfer.received += bytes.length;
    } catch (error) { await this.cancelIncomingFile(data.id); throw error; }
  }

  async finishIncomingFile(from, data) {
    const transfer = this.incomingFiles.get(data.id);
    if (!transfer) {
      if (this.state.messages.some(message => message.id === data.id && message.from === from && message.sha256 === data.sha256)) return;
      throw new Error('Transfer file tidak ditemukan.');
    }
    if (transfer.from !== from) throw new Error('Pengirim file tidak valid.');
    if (transfer.received !== transfer.size || typeof data.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(data.sha256) || transfer.hash.digest('hex') !== data.sha256) {
      await this.cancelIncomingFile(data.id);
      throw new Error('File tidak lengkap atau rusak.');
    }
    const finalPath = join(this.filesDir, data.id);
    try {
      await transfer.handle.sync();
      await transfer.handle.close();
      this.incomingFiles.delete(data.id);
      clearTimeout(transfer.timer);
      if (existsSync(finalPath)) throw new Error('ID file sudah digunakan.');
      await rename(transfer.path, finalPath);
      const message = { id: data.id, from, fromName: this.trusted.get(from).name, to: this.id,
        name: transfer.name, size: transfer.size, kind: 'file', at: Date.now(), sha256: data.sha256 };
      const oldUnread = this.state.unread[from] || 0;
      this.state.messages.push(message);
      this.state.unread[from] = oldUnread + 1;
      try { this.save(); }
      catch (error) {
        this.state.messages.pop();
        if (oldUnread) this.state.unread[from] = oldUnread;
        else delete this.state.unread[from];
        await unlink(finalPath);
        throw error;
      }
      try { this.emit('incoming', message); }
      catch (error) { console.warn('Notifikasi file masuk gagal:', error); }
    } catch (error) {
      if (this.incomingFiles.has(data.id)) await this.cancelIncomingFile(data.id);
      else await unlink(transfer.path).catch(unlinkError => { if (unlinkError.code !== 'ENOENT') throw unlinkError; });
      throw error;
    }
  }

  async sendTo(id, payload, options) {
    if (!this.trusted.has(id)) throw new Error('Perangkat belum ditemukan di jaringan lokal.');
    if (!this.online.has(id)) throw new Error('Perangkat sedang offline.');
    return this.request(this.node.getConnections().find(connection => connection.remotePeer.toString() === id && localPeer(connection)).remotePeer, DATA, payload, 4096, options);
  }

  async sendMessage(text, to) {
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) throw new Error('Pesan harus berisi 1–4000 karakter.');
    if (!validId(to) || !this.trusted.has(to)) throw new Error('Penerima tidak dikenal.');
    if (!this.online.has(to)) throw new Error('Penerima sedang offline.');
    const message = { id: randomUUID(), from: this.id, fromName: this.state.name, to, text: text.trim(), kind: 'text', at: Date.now() };
    await this.sendTo(to, { type: 'message', message });
    this.state.messages.push(message);
    this.save();
    return { message, delivered: 1, failed: 0 };
  }

  async sendRoomMessage(text, id) {
    const room = this.room(id);
    if (!room || room.pending || !room.members.includes(this.id) || typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) throw new Error('Pesan Ruang tidak valid.');
    const targets = room.members.filter(peer => peer !== this.id && this.online.has(peer));
    if (!targets.length) throw new Error('Tidak ada anggota Ruang yang online.');
    const message = { id: randomUUID(), roomId: id, version: room.version, from: this.id, fromName: this.state.name, to: null, text: text.trim(), kind: 'text', at: Date.now() };
    const results = await Promise.allSettled(targets.map(peer => this.sendTo(peer, { type: 'room-message', message })));
    const delivered = results.filter(result => result.status === 'fulfilled').length;
    if (delivered) { this.state.messages.push(message); this.save(); }
    return { message, delivered, failed: results.length - delivered };
  }

  async sendAnnouncement(text) {
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) throw new Error('Pengumuman harus berisi 1–4000 karakter.');
    const targets = [...this.online].filter(id => this.trusted.get(id)?.announcements);
    if (!targets.length) throw new Error('Tidak ada penerima Pengumuman yang online.');
    const message = { id: randomUUID(), from: this.id, fromName: this.state.name, to: null, text: text.trim(), kind: 'announcement', at: Date.now() };
    const results = await Promise.allSettled(targets.map(peer => this.sendTo(peer, { type: 'announcement', message })));
    const delivered = results.filter(result => result.status === 'fulfilled').length;
    if (delivered) { this.state.messages.push(message); this.save(); }
    return { message, delivered, failed: results.length - delivered };
  }

  async sendFile(name, bytes, to = null, { signal } = {}) {
    if (to === null) throw new Error('File hanya dapat dikirim melalui pesan pribadi.');
    if (signal?.aborted) throw signal.reason || new Error('Pengiriman dibatalkan.');
    const buffer = Buffer.from(bytes);
    const filename = safeFileName(name);
    if (!filename || !buffer.length || buffer.length > MAX_FILE) throw new Error('File harus berukuran 1 B–20 MB.');
    if (to !== null && (!validId(to) || !this.trusted.has(to))) throw new Error('Penerima tidak dikenal.');
    if (to && !this.online.has(to)) throw new Error('Penerima sedang offline.');
    const message = { id: randomUUID(), from: this.id, fromName: this.state.name, to, name: filename, size: buffer.length, kind: 'file', at: Date.now() };
    const packet = { type: 'file', message: { ...message, sha256: sha256(buffer).toString('hex') }, bytes: buffer.toString('base64') };
    const targets = to ? [to] : [...this.online];
    let delivered = 0;
    let failed = 0;
    for (const id of targets) {
      try { await this.sendTo(id, packet, { signal }); delivered++; }
      catch (error) { if (to) throw error; failed++; }
    }
    if (signal?.aborted) throw signal.reason || new Error('Pengiriman dibatalkan.');
    writeFileSync(join(this.filesDir, message.id), buffer, { flag: 'wx', mode: 0o600 });
    this.state.messages.push(message);
    this.save();
    return { message, delivered, failed };
  }

  async sendFilePath(path, to, { signal, onProgress } = {}) {
    if (typeof path !== 'string' || !path || !validId(to) || !this.trusted.has(to)) throw new Error('Penerima atau file tidak valid.');
    if (!this.online.has(to)) throw new Error('Penerima sedang offline.');
    const source = await stat(path);
    const filename = safeFileName(basename(path));
    if (!source.isFile() || !filename || source.size < 1 || source.size > MAX_STREAM_FILE) throw new Error('File harus berukuran 1 B–100 MB.');
    if (!this.trusted.get(to).fileChunks && source.size > MAX_FILE) {
      const response = await this.profilePacket(to, { type: 'profile', ...this.profile(), addresses: this.addresses });
      const name = cleanName(response.name);
      if (!name) throw new Error('Nama perangkat penerima tidak valid.');
      this.rememberPeer(to, name, [], response);
    }
    if (!this.trusted.get(to).fileChunks) {
      if (source.size > MAX_FILE) throw new Error('Perbarui Lumilan Chat pada perangkat penerima untuk mengirim file di atas 20 MB.');
      return this.sendFile(filename, await readFile(path), to, { signal });
    }
    requireDiskSpace(this.filesDir, source.size);
    const id = randomUUID();
    const temporary = join(this.filesDir, `.outgoing-${id}.part`);
    const finalPath = join(this.filesDir, id);
    let offered = false;
    try {
      await copyFile(path, temporary, constants.COPYFILE_EXCL);
      if (signal?.aborted) throw signal.reason || new Error('Pengiriman dibatalkan.');
      if ((await stat(temporary)).size !== source.size) throw new Error('File berubah saat disiapkan. Coba lagi.');
      const message = { id, from: this.id, fromName: this.state.name, to, name: filename, size: source.size, kind: 'file', at: Date.now() };
      offered = true;
      await this.sendTo(to, { type: 'file-start', message: { id, to, name: filename, size: source.size } }, { responseTimeout: 300_000, signal });
      const hash = createHash('sha256');
      const handle = await open(temporary, 'r');
      try {
        for (let offset = 0; offset < source.size;) {
          if (signal?.aborted) throw signal.reason || new Error('Pengiriman dibatalkan.');
          const buffer = Buffer.allocUnsafe(Math.min(FILE_CHUNK, source.size - offset));
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
          if (!bytesRead) throw new Error('File berubah saat dikirim. Coba lagi.');
          const bytes = buffer.subarray(0, bytesRead);
          await this.sendTo(to, { type: 'file-chunk', id, offset, bytes: bytes.toString('base64') }, { signal });
          hash.update(bytes);
          offset += bytesRead;
          onProgress?.(offset, source.size);
        }
      } finally { await handle.close(); }
      if (signal?.aborted) throw signal.reason || new Error('Pengiriman dibatalkan.');
      const finish = { type: 'file-end', id, sha256: hash.digest('hex') };
      try { await this.sendTo(to, finish); }
      catch (error) { await this.sendTo(to, finish).catch(() => { throw error; }); }
      await rename(temporary, finalPath);
      this.state.messages.push({ ...message, sha256: finish.sha256 });
      try { this.save(); }
      catch (error) { this.state.messages.pop(); await unlink(finalPath); throw error; }
      return { message: { ...message, sha256: finish.sha256 }, delivered: 1, failed: 0 };
    } catch (error) {
      if (offered) await this.sendTo(to, { type: 'file-cancel', id }).catch(() => {});
      throw error;
    } finally {
      await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') console.warn('Gagal membersihkan file sementara:', error); });
    }
  }

  listMessages(thread, before = null) {
    if (thread !== 'announcements' && !(typeof thread === 'string' && thread.startsWith('room:') && this.room(thread.slice(5)) && !this.room(thread.slice(5)).pending) &&
        (!validId(thread) || !this.online.has(thread))) throw new Error('Percakapan tidak tersedia.');
    if (before !== null && (typeof before !== 'string' || !/^[0-9a-f-]{36}$/.test(before))) throw new Error('Posisi pesan tidak valid.');
    const end = before === null ? this.state.messages.length : this.state.messages.findIndex(message => message.id === before);
    if (end < 0) throw new Error('Posisi pesan tidak ditemukan.');
    const items = [];
    for (let index = end - 1; index >= 0 && items.length < 100; index--) {
      const message = this.state.messages[index];
      if (inThread(message, thread, this.id)) items.push(message);
    }
    return items.reverse();
  }

  listFiles(thread, offset = 0) {
    if (!validId(thread) || !this.online.has(thread)) throw new Error('Percakapan tidak tersedia.');
    if (!Number.isInteger(offset) || offset < 0) throw new Error('Halaman file tidak valid.');
    const items = [];
    let total = 0;
    for (let index = this.state.messages.length - 1; index >= 0; index--) {
      const message = this.state.messages[index];
      if (message.kind !== 'file' || !inThread(message, thread, this.id)) continue;
      if (total >= offset && items.length < 50) items.push(message);
      total++;
    }
    return { items, total };
  }

  file(id) {
    const message = this.state.messages.find(item => item.id === id && item.kind === 'file');
    if (!message) throw new Error('File tidak ditemukan.');
    return { name: message.name, bytes: readFileSync(join(this.filesDir, id)) };
  }

  filePath(id) {
    const message = this.state.messages.find(item => item.id === id && item.kind === 'file');
    if (!message) throw new Error('File tidak ditemukan.');
    return { name: message.name, path: join(this.filesDir, id) };
  }

}
