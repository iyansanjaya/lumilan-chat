import type { TestContext } from 'node:test';
import type { FileTransfer } from './shared/model.js';
import { type PacketStream, type PeerNode, type IncomingTransfer } from './peer.js';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';
import { generateKeyPair } from '@libp2p/crypto/keys';
import { multiaddr } from '@multiformats/multiaddr';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LumilanPeer } from './peer.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function packetStream(packet: unknown): PacketStream & {aborted: Error | null} {
  return {
    aborted: null, inactivityTimeout: 0, maxReadBufferLength: 0, async onDrain() {},
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(packet)); },
    send() { if (this.aborted) throw this.aborted; return true; },
    async close() {},
    abort(error: Error) { this.aborted = error; },
  };
}

async function fixture(t: TestContext, acceptFile: (offer: import('./shared/model.js').FileOffer) => boolean | Promise<boolean> = async () => true) {
  const root = mkdtempSync(join(tmpdir(), 'lumilan-peer-shutdown-'));
  const peer = new LumilanPeer({ dataDir: root, discovery: false, listen: '/ip4/127.0.0.1/tcp/0', getNetwork: () => '', acceptFile });
  mkdirSync(peer.filesDir, { recursive: true, mode: 0o700 });
  peer.identity = 'a'.repeat(40);
  const remotePeer = peerIdFromPrivateKey(await generateKeyPair('Ed25519')); const from = remotePeer.toString(), connection = { remotePeer, remoteAddr: multiaddr('/ip4/127.0.0.1/tcp/1') };
  peer.state.trusted.push({ id: from, name: 'Sender' });
  let stops = 0;
  const unused = () => { throw new Error('Unexpected network operation in shutdown fixture'); };
  peer.node = { peerId: peerIdFromPrivateKey(await generateKeyPair('Ed25519')), stop: async () => { stops++; }, start: unused, getConnections: unused, getMultiaddrs: unused, dial: unused, dialProtocol: unused, handle: unused, addEventListener: unused };
  t.after(async () => { await peer.stop().catch(() => {}); rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });
  return { peer, from, connection, stops: () => stops };
}

test('stop settles modern and legacy packets whose consent callback never answers', async t => {
  for (const legacy of [false, true]) await t.test(legacy ? 'legacy' : 'chunked', async t => {
    const { peer, from, connection, stops } = await fixture(t, () => new Promise(() => {}));
    const id = randomUUID(), bytes = Buffer.from('x'), message = { id, to: peer.id, name: 'waiting.bin', size: 1, sha256: digest(bytes) };
    const events: FileTransfer[] = [];
    peer.on('file-transfer', value => events.push(value));
    let settled = false;
    const receiving = peer.handleData(packetStream(legacy ? { type: 'file', message, bytes: bytes.toString('base64') } : { type: 'file-start', message }), connection)
      .then(() => { settled = true; });
    await flush();
    assert.equal(peer.pendingFileOffers.size, 1);
    await peer.stop();
    assert.equal(settled, true, 'stop left an admitted consent packet running');
    await receiving;
    assert.equal(stops(), 1);
    assert.equal(peer.pendingFileOffers.size, 0);
    assert.equal(peer.incomingFiles.size, 0);
    assert.deepEqual(readdirSync(peer.filesDir), []);
    assert.deepEqual(events, [{ id, status: 'canceled' }]);
    assert.equal(peer.state.messages.length, 0);
    await peer.cancelIncomingFile(id, from);
  });
});

test('stop runs once, rejects new packets, and waits for finalization after promotion', async t => {
  const { peer, from, connection, stops } = await fixture(t);
  const id = randomUUID(), bytes = Buffer.from('complete');
  await peer.beginIncomingFile(from, { id, to: peer.id, name: 'complete.bin', size: bytes.length });
  await peer.receiveFileChunk(from, { id, offset: 0, bytes: bytes.toString('base64') });
  const finalized = deferred(), release = deferred(), network = deferred();
  const finish = peer.finishIncomingFile.bind(peer);
  peer.finishIncomingFile = async (...args) => { await finish(...args); finalized.resolve(); await release.promise; };
  const originalStop = peer.node!.stop;
  peer.node!.stop = async () => { await originalStop(); await network.promise; };
  const receiving = peer.handleData(packetStream({ type: 'file-end', id, sha256: digest(bytes) }), connection);
  await finalized.promise;
  assert.equal(peer.incomingFiles.size, 0);
  let stopped = false;
  const stopping = peer.stop().then(() => { stopped = true; }), repeated = peer.stop();
  try {
    await flush();
    assert.equal(stops(), 0, 'network stopped before the admitted packet settled');
    const next = packetStream({ type: 'file-start', message: { id: randomUUID(), to: peer.id, name: 'new.bin', size: 1 } });
    await peer.handleData(next, connection);
    assert(next.aborted, 'shutdown admitted another inbound packet');
    assert.equal(peer.incomingFiles.size, 0);
    assert.equal(stopped, false, 'stop ignored the packet after its transfer left incomingFiles');
    release.resolve(); await flush();
    assert.equal(stops(), 1, 'concurrent stop called the network twice');
    assert.equal(stopped, false, 'stop did not wait for network shutdown');
    network.resolve(); await Promise.all([receiving, stopping, repeated]);
    assert.equal(stopped, true);
    assert.equal(stops(), 1);
    assert.equal(readFileSync(join(peer.filesDir, id)).toString(), 'complete');
    assert.equal(peer.state.messages.at(-1)!.sha256, digest(bytes));
  } finally { network.resolve(); release.resolve(); await Promise.allSettled([receiving, stopping, repeated]); }
});

test('stop attempts every receiver cleanup and network shutdown after close and unlink failures', async t => {
  const { peer, from, stops } = await fixture(t);
  const closeError = new Error('close failed'), first = randomUUID(), second = randomUUID(), third = randomUUID();
  const firstPath = join(peer.filesDir, `.upload-${first}.part`), secondPath = join(peer.filesDir, `.upload-${second}.part`), thirdPath = join(peer.filesDir, `.upload-${third}.part`);
  writeFileSync(firstPath, 'first'); mkdirSync(secondPath); writeFileSync(thirdPath, 'third');
  const closed: string[] = [];
  for (const [id, path] of [[first, firstPath], [second, secondPath], [third, thirdPath]] as const) peer.incomingFiles.set(id, {
    id, name: 'fixture.bin', size: 1, to: peer.id, received: 0, hash: createHash('sha256'), from, path, timer: null, handle: { write: async () => { throw new Error('Unexpected write'); }, sync: async () => {}, close: async () => { closed.push(id); if (id === first) throw closeError; } },
  });
  await assert.rejects(peer.stop());
  assert.equal(stops(), 1, 'cleanup failure skipped network shutdown');
  assert.deepEqual(closed.sort(), [first, second, third].sort());
  assert.equal(peer.incomingFiles.size, 0);
  assert.deepEqual(readdirSync(peer.filesDir), [`.upload-${second}.part`]);
});

test('stop waits for cancellation already closing a handle after removal from incomingFiles', async t => {
  const { peer, from, stops } = await fixture(t), started = deferred(), release = deferred(), id = randomUUID();
  const path = join(peer.filesDir, `.upload-${id}.part`);
  writeFileSync(path, 'unfinished');
  peer.incomingFiles.set(id, { id, name: 'fixture.bin', size: 1, to: peer.id, received: 0, hash: createHash('sha256'), from, path, timer: null, handle: { write: async () => { throw new Error('Unexpected write'); }, sync: async () => {}, close: async () => { started.resolve(); await release.promise; } } });
  const canceled = peer.cancelIncomingFile(id, from);
  await started.promise;
  assert.equal(peer.incomingFiles.size, 0);
  let stopped = false;
  const stopping = peer.stop().then(() => { stopped = true; });
  try {
    await flush();
    assert.equal(stopped, false, 'stop skipped cancellation already removed from incomingFiles');
    assert.equal(stops(), 0, 'network shutdown preceded receiver cleanup');
    release.resolve(); await Promise.all([canceled, stopping]);
    assert.equal(stops(), 1);
    assert.deepEqual(readdirSync(peer.filesDir), []);
  } finally { release.resolve(); await Promise.allSettled([canceled, stopping]); }
});

test('failed network shutdown can be retried without admitting packets before restart', async t => {
  const { peer, connection, stops } = await fixture(t), node = peer.node!, originalStop = node.stop;
  node.stop = async () => { await originalStop(); if (stops() === 1) throw new Error('temporary network shutdown failure'); };
  const first = peer.stop(), same = peer.stop();
  assert.equal(first, same, 'pending stop was not shared');
  await assert.rejects(first, error => error instanceof AggregateError && /temporary network shutdown failure/.test(error.errors[0].message));
  assert.equal(peer.node, node, 'failed network shutdown discarded the node needed for retry');
  const incoming = packetStream({ type: 'hello', name: 'Sender' });
  await peer.handleData(incoming, connection);
  assert(incoming.aborted, 'failed shutdown reopened inbound admission');
  await peer.stop();
  assert.equal(stops(), 2);
  assert.equal(peer.node, null);
  await peer.stop();
  assert.equal(stops(), 2, 'successful retry was not cached');
});
