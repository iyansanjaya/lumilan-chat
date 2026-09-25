import { EventEmitter } from 'node:events';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { isIP } from 'node:net';
import { networkInterfaces } from 'node:os';
import { createLibp2p } from 'libp2p';
import { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } from '@libp2p/crypto/keys';
import { tcp } from '@libp2p/tcp';
import { mdns } from '@libp2p/mdns';
import { noise } from '@libp2p/noise';
import { yamux } from '@libp2p/yamux';
import { identify } from '@libp2p/identify';
import { multiaddr } from '@multiformats/multiaddr';

const PROFILE = '/lumilan/profile/1.0.0';
const DATA = '/lumilan/data/1.0.0';
const MAX_FILE = 20 * 1024 * 1024;
const MAX_FRAME = 29 * 1024 * 1024;
const MAX_TEXT = 4000;
const MAX_AVATAR = 24 * 1024;
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
  if (!match || isIP(match[1]) !== 4 || +match[2] < 1 || +match[2] > 65535) return false;
  const [a, b] = match[1].split('.').map(Number);
  return a === 10 || a === 127 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31;
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

async function readStream(stream, limit) {
  stream.inactivityTimeout = 30_000;
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
  constructor({ dataDir, discovery = true, listen = '/ip4/0.0.0.0/tcp/0', getNetwork = networkSignature }) {
    super();
    this.dataDir = dataDir;
    this.discovery = discovery;
    this.listen = listen;
    this.getNetwork = getNetwork;
    this.network = getNetwork();
    this.roomSession = randomUUID();
    this.path = join(dataDir, 'state.json');
    this.keyPath = join(dataDir, 'identity.key');
    this.filesDir = join(dataDir, 'files');
    // ponytail: riwayat kecil disimpan sebagai satu JSON; pindah ke SQLite jika pemakaian bertahun-tahun membuatnya besar.
    this.state = { name: '', status: 'active', about: '', avatar: '', trusted: [], messages: [], unread: {} };
    this.node = null;
    this.identity = null;
    this.discovered = new Map();
    this.probing = new Set();
    this.dialing = new Set();
  }

  get id() { return this.node?.peerId.toString() || this.identity; }
  get trusted() { return new Map(this.state.trusted.map(peer => [peer.id, peer])); }
  get online() { return new Set((this.node?.getConnections() || []).filter(localPeer).map(connection => connection.remotePeer.toString()).filter(id => this.trusted.has(id))); }
  get addresses() { return (this.node?.getMultiaddrs() || []).map(address => address.toString()).filter(localAddress).filter(address => this.listen.includes('/127.') || !address.includes('/ip4/127.')).sort((a, b) => addressPriority(a) - addressPriority(b)).slice(0, 12); }

  async start() {
    mkdirSync(this.filesDir, { recursive: true, mode: 0o700 });
    if (existsSync(this.path)) this.state = JSON.parse(readFileSync(this.path, 'utf8'));
    this.state.unread ||= {};
    delete this.state.unread.room;
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
      peerDiscovery: this.discovery ? [mdns({ interval: 15_000 })] : [],
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
      if (this.trusted.has(id)) this.sendTo(id, { type: 'hello', ...this.profile() }).catch(() => {});
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

  async stop() { if (this.node) { await this.node.stop(); this.node = null; } }

  async refreshNetwork() {
    const network = this.getNetwork();
    if (network === this.network) return false;
    this.roomSession = randomUUID();
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
    const visibleMessages = this.state.messages.filter(message => message.to === null ? message.roomSession === this.roomSession
      : online.has(message.from === this.id ? message.to : message.from));
    const stats = {};
    const recentFiles = {};
    for (const message of visibleMessages) {
      const key = message.to === null ? 'room' : message.from === this.id ? message.to : message.from;
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
      stats, recentFiles, roomSession: this.roomSession,
      me: { id: this.id, name: this.state.name, status: this.state.status, about: this.state.about, avatar: this.state.avatar },
      peers: this.state.trusted.filter(peer => online.has(peer.id)).map(peer => ({
        id: peer.id, name: peer.name, online: true, status: cleanStatus(peer.status), about: cleanAbout(peer.about), avatar: cleanAvatar(peer.avatar),
      })),
      messages: visibleMessages.slice(-1000),
      unread: Object.fromEntries(Object.entries(this.state.unread).filter(([id]) => id === 'room' || online.has(id))),
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

  profile() { return { name: this.state.name, status: this.state.status, about: this.state.about, avatar: this.state.avatar }; }

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
    const key = thread === null ? 'room' : thread;
    if (key !== 'room' && !validId(key)) throw new Error('Percakapan tidak valid.');
    if (!this.state.unread[key]) return;
    delete this.state.unread[key];
    this.save();
  }

  recordIncoming(message) {
    const key = message.to === null ? 'room' : message.from;
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
      avatar: cleanAvatar(profile.avatar ?? previous?.avatar),
    };
    this.state.trusted = this.state.trusted.filter(item => item.id !== id).concat(peer);
    this.save();
  }

  async request(target, protocol, payload, responseLimit = 4096) {
    const stream = await this.node.dialProtocol(target, protocol, { signal: AbortSignal.timeout(8000) });
    try {
      await writeStream(stream, payload);
      const response = await readStream(stream, responseLimit);
      if (!response?.ok) throw new Error(response?.error || 'Perangkat menolak permintaan.');
      return response;
    } catch (error) { stream.abort(error); throw error; }
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
      else if (data?.type === 'file') this.receiveFile(from, data);
      else throw new Error('Jenis paket tidak dikenal.');
      await writeStream(stream, { ok: true });
    } catch (error) {
      try { await writeStream(stream, { ok: false, error: error.message }); } catch { stream.abort(error); }
    }
  }

  receiveMessage(from, message) {
    if (!message || typeof message !== 'object' || typeof message.id !== 'string' || !/^[0-9a-f-]{36}$/.test(message.id) || typeof message.text !== 'string' || !message.text.trim() || message.text.length > MAX_TEXT || message.to !== null && message.to !== this.id) throw new Error('Pesan tidak valid.');
    if (this.state.messages.some(item => item.id === message.id)) return;
    this.state.messages.push({ id: message.id, from, fromName: this.trusted.get(from).name, to: message.to, text: message.text, kind: 'text', at: Date.now(), roomSession: message.to === null ? this.roomSession : undefined });
    this.recordIncoming(this.state.messages.at(-1));
  }

  receiveFile(from, data) {
    const { message, bytes } = data;
    if (!message || typeof message.id !== 'string' || !/^[0-9a-f-]{36}$/.test(message.id) || typeof message.name !== 'string' || !safeFileName(message.name) || message.to !== null && message.to !== this.id || typeof bytes !== 'string') throw new Error('File tidak valid.');
    if (this.state.messages.some(item => item.id === message.id)) return;
    const buffer = Buffer.from(bytes, 'base64');
    if (!buffer.length || buffer.length > MAX_FILE || buffer.length !== message.size || sha256(buffer).toString('hex') !== message.sha256) throw new Error('File rusak atau terlalu besar.');
    const path = join(this.filesDir, message.id);
    if (existsSync(path)) {
      if (!timingSafeEqual(sha256(readFileSync(path)), sha256(buffer))) throw new Error('ID file sudah digunakan.');
    } else writeFileSync(path, buffer, { flag: 'wx', mode: 0o600 });
    this.state.messages.push({ id: message.id, from, fromName: this.trusted.get(from).name, to: message.to, name: safeFileName(message.name), size: buffer.length, kind: 'file', at: Date.now(), roomSession: message.to === null ? this.roomSession : undefined });
    this.recordIncoming(this.state.messages.at(-1));
  }

  async sendTo(id, payload) {
    if (!this.trusted.has(id)) throw new Error('Perangkat belum ditemukan di jaringan lokal.');
    if (!this.online.has(id)) throw new Error('Perangkat sedang offline.');
    return this.request(this.node.getConnections().find(connection => connection.remotePeer.toString() === id && localPeer(connection)).remotePeer, DATA, payload);
  }

  async sendMessage(text, to = null) {
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) throw new Error('Pesan harus berisi 1–4000 karakter.');
    if (to !== null && (!validId(to) || !this.trusted.has(to))) throw new Error('Penerima tidak dikenal.');
    if (to && !this.online.has(to)) throw new Error('Penerima sedang offline.');
    const message = { id: randomUUID(), from: this.id, fromName: this.state.name, to, text: text.trim(), kind: 'text', at: Date.now() };
    const targets = to ? [to] : [...this.online];
    const results = await Promise.allSettled(targets.map(id => this.sendTo(id, { type: 'message', message })));
    if (to && results[0].status === 'rejected') throw results[0].reason;
    this.state.messages.push({ ...message, roomSession: to === null ? this.roomSession : undefined });
    this.save();
    return { message, delivered: results.filter(result => result.status === 'fulfilled').length, failed: results.filter(result => result.status === 'rejected').length };
  }

  async sendFile(name, bytes, to = null) {
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
      try { await this.sendTo(id, packet); delivered++; }
      catch (error) { if (to) throw error; failed++; }
    }
    writeFileSync(join(this.filesDir, message.id), buffer, { flag: 'wx', mode: 0o600 });
    this.state.messages.push({ ...message, roomSession: to === null ? this.roomSession : undefined });
    this.save();
    return { message, delivered, failed };
  }

  listMessages(thread = null, before = null) {
    if (thread !== null && (!validId(thread) || !this.online.has(thread))) throw new Error('Percakapan tidak tersedia.');
    if (before !== null && (typeof before !== 'string' || !/^[0-9a-f-]{36}$/.test(before))) throw new Error('Posisi pesan tidak valid.');
    const end = before === null ? this.state.messages.length : this.state.messages.findIndex(message => message.id === before);
    if (end < 0) throw new Error('Posisi pesan tidak ditemukan.');
    const items = [];
    for (let index = end - 1; index >= 0 && items.length < 100; index--) {
      const message = this.state.messages[index];
      if (thread === null ? message.to === null && message.roomSession === this.roomSession
        : message.to === thread && message.from === this.id || message.from === thread && message.to === this.id) items.push(message);
    }
    return items.reverse();
  }

  listFiles(thread = null, offset = 0) {
    if (thread !== null && (!validId(thread) || !this.online.has(thread))) throw new Error('Percakapan tidak tersedia.');
    if (!Number.isInteger(offset) || offset < 0) throw new Error('Halaman file tidak valid.');
    const items = [];
    let total = 0;
    for (let index = this.state.messages.length - 1; index >= 0; index--) {
      const message = this.state.messages[index];
      if (message.kind !== 'file' || !(thread === null
        ? message.to === null && message.roomSession === this.roomSession
        : message.to === thread && message.from === this.id || message.from === thread && message.to === this.id)) continue;
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

}
