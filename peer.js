import { EventEmitter } from 'node:events';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { isIP } from 'node:net';
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
  constructor({ dataDir, discovery = true, listen = '/ip4/0.0.0.0/tcp/0' }) {
    super();
    this.dataDir = dataDir;
    this.discovery = discovery;
    this.listen = listen;
    this.path = join(dataDir, 'state.json');
    this.keyPath = join(dataDir, 'identity.key');
    this.filesDir = join(dataDir, 'files');
    // ponytail: riwayat kecil disimpan sebagai satu JSON; pindah ke SQLite jika pemakaian bertahun-tahun membuatnya besar.
    this.state = { name: '', trusted: [], messages: [], unread: {} };
    this.node = null;
    this.discovered = new Map();
    this.probing = new Set();
  }

  get id() { return this.node.peerId.toString(); }
  get trusted() { return new Map(this.state.trusted.map(peer => [peer.id, peer])); }
  get online() { return new Set(this.node.getConnections().filter(localPeer).map(connection => connection.remotePeer.toString()).filter(id => this.trusted.has(id))); }
  get addresses() { return this.node.getMultiaddrs().map(address => address.toString()).filter(localAddress).slice(0, 12); }

  async start() {
    mkdirSync(this.filesDir, { recursive: true, mode: 0o700 });
    if (existsSync(this.path)) this.state = JSON.parse(readFileSync(this.path, 'utf8'));
    this.state.unread ||= {};
    let privateKey;
    if (existsSync(this.keyPath)) privateKey = privateKeyFromProtobuf(readFileSync(this.keyPath));
    else {
      privateKey = await generateKeyPair('Ed25519');
      writeFileSync(this.keyPath, privateKeyToProtobuf(privateKey), { flag: 'wx', mode: 0o600 });
    }
    this.node = await createLibp2p({
      privateKey,
      addresses: { listen: [this.listen] },
      transports: [tcp()],
      streamMuxers: [yamux()],
      connectionEncrypters: [noise()],
      peerDiscovery: this.discovery ? [mdns({ interval: 15_000 })] : [],
      services: { identify: identify() },
      connectionManager: { maxConnections: 100, maxIncomingPendingConnections: 16 },
    });
    await this.node.handle(PROFILE, (stream, connection) => this.handleProfile(stream, connection), { maxInboundStreams: 2 });
    await this.node.handle(DATA, (stream, connection) => this.handleData(stream, connection), { maxInboundStreams: 8 });
    this.node.addEventListener('peer:discovery', event => {
      const id = event.detail.id.toString();
      if (!validId(id) || id === this.id) return;
      const addresses = event.detail.multiaddrs.map(address => address.toString()).map(address => address.endsWith(`/p2p/${id}`) ? address : `${address}/p2p/${id}`).filter(localAddress).slice(0, 12);
      if (!addresses.length) return;
      if (this.discovered.size >= 64 && !this.discovered.has(id)) this.discovered.delete(this.discovered.keys().next().value);
      this.discovered.set(id, addresses);
      if (this.trusted.has(id)) this.dialKnown(id, this.discovered.get(id)).catch(() => {});
      else this.probePeer(id).catch(() => {});
    });
    this.node.addEventListener('peer:connect', event => {
      const id = event.detail.toString();
      this.emit('change');
      if (this.trusted.has(id)) this.sendTo(id, { type: 'hello', name: this.state.name }).catch(() => {});
    });
    this.node.addEventListener('peer:disconnect', () => this.emit('change'));
    for (const peer of this.state.trusted) this.dialKnown(peer.id, peer.addresses || []).catch(() => {});
    return this;
  }

  async dialKnown(id, addresses) {
    if (this.online.has(id)) return;
    for (const address of addresses) {
      const target = address.endsWith(`/p2p/${id}`) ? address : `${address}/p2p/${id}`;
      if (!localAddress(target)) continue;
      try { await this.node.dial(multiaddr(target), { signal: AbortSignal.timeout(5000) }); return; }
      catch { /* coba alamat berikutnya */ }
    }
  }

  async stop() { if (this.node) await this.node.stop(); }

  snapshot() {
    return {
      me: { id: this.id, name: this.state.name },
      peers: this.state.trusted.map(peer => ({ id: peer.id, name: peer.name, online: this.online.has(peer.id) })),
      messages: this.state.messages.slice(-1000),
      unread: this.state.unread,
    };
  }

  rename(value) {
    const name = cleanName(value);
    if (!name) throw new Error('Nama tidak boleh kosong.');
    this.state.name = name;
    this.save();
    for (const id of this.discovered.keys()) if (!this.trusted.has(id)) this.probePeer(id).catch(() => {});
    for (const id of this.online) this.sendTo(id, { type: 'hello', name }).catch(() => {});
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
    if (connection) return this.request(connection.remotePeer, PROFILE, payload, 4096);
    let lastError;
    for (const address of addresses.slice(0, 12)) {
      if (!localAddress(address) || !address.endsWith(`/p2p/${id}`)) continue;
      try { return await this.request(multiaddr(address), PROFILE, payload, 4096); }
      catch (error) { lastError = error; }
    }
    throw new Error('Perangkat tidak dapat dihubungi di jaringan lokal.', { cause: lastError });
  }

  async probePeer(id) {
    if (this.trusted.has(id) || this.probing.has(id) || !this.state.name) return;
    this.probing.add(id);
    try {
      const response = await this.profilePacket(id, { type: 'profile', name: this.state.name, addresses: this.addresses });
      const name = cleanName(response.name);
      if (!name) throw new Error('Nama perangkat tidak valid.');
      this.rememberPeer(id, name, this.discovered.get(id));
    } finally { this.probing.delete(id); }
  }

  rememberPeer(id, name, addresses = []) {
    const previous = this.trusted.get(id);
    const peer = { id, name: cleanName(name), addresses: addresses.length ? addresses : previous?.addresses || [] };
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
      const data = await readStream(stream, 4096);
      const remoteId = connection.remotePeer.toString();
      const addresses = Array.isArray(data?.addresses) ? data.addresses.filter(address => typeof address === 'string' && localAddress(address) && address.endsWith('/p2p/' + remoteId)).slice(0, 12) : [];
      if (!this.state.name) throw new Error('Atur nama terlebih dahulu.');
      if (data?.type === 'profile') {
        const name = cleanName(data.name);
        if (name) this.rememberPeer(remoteId, name, addresses);
        await writeStream(stream, { ok: true, name: this.state.name });
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
        this.rememberPeer(from, name);
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
    this.state.messages.push({ id: message.id, from, fromName: this.trusted.get(from).name, to: message.to, text: message.text, kind: 'text', at: Date.now() });
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
    this.state.messages.push({ id: message.id, from, fromName: this.trusted.get(from).name, to: message.to, name: safeFileName(message.name), size: buffer.length, kind: 'file', at: Date.now() });
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
    this.state.messages.push(message);
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
    this.state.messages.push(message);
    this.save();
    return { message, delivered, failed };
  }

  file(id) {
    const message = this.state.messages.find(item => item.id === id && item.kind === 'file');
    if (!message) throw new Error('File tidak ditemukan.');
    return { name: message.name, bytes: readFileSync(join(this.filesDir, id)) };
  }

}
