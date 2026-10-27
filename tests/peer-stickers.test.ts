import type { TestContext } from 'node:test';
import type { DataPacket, Message, PeerState } from '../src/shared/model.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { readPeerState } from '../src/shared/model.js';
import { LumilanPeer } from '../src/main/peer.js';
import { encodeSticker } from '../src/main/sticker-image.js';

async function until(predicate: () => unknown, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Kondisi tidak tercapai.');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

// Loopback peers on random ports, discovery off, in a temporary profile.
async function peers<N extends string[]>(t: TestContext, names: [...N]): Promise<{ [K in keyof N]: LumilanPeer }> {
  const root = mkdtempSync(join(tmpdir(), 'lumilan-stickers-peer-'));
  const list = names.map((_, index) => new LumilanPeer({ dataDir: join(root, String(index)), discovery: false, listen: '/ip4/127.0.0.1/tcp/0', acceptFile: async () => true }));
  t.after(async () => {
    for (const peer of list) await peer.stop().catch(() => {});
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  for (const [index, peer] of list.entries()) { await peer.start(); peer.rename(names[index]!); }
  for (const a of list) for (const b of list) if (a !== b && !a.online.has(b.id)) { a.discovered.set(b.id, b.addresses); await a.probePeer(b.id); }
  await until(() => list.every(a => list.every(b => a === b || a.online.has(b.id) && a.trusted.get(b.id)?.stickers === true)));
  return list as { [K in keyof N]: LumilanPeer };
}

const sticker = async (width = 96, height = 64) => encodeSticker(await sharp({ create: { width, height, channels: 4, background: { r: 30, g: 120, b: 200, alpha: 0.8 } } }).png().toBuffer(), 'import');

test('stiker pribadi diterima tanpa persetujuan, disimpan sebagai file, dan ikut terhapus', async t => {
  const [a, b] = await peers(t, ['Andi', 'Budi']);
  let offers = 0;
  b.acceptFile = () => { offers++; return false; };
  const incoming: Message[] = [];
  b.on('incoming', message => incoming.push(message));
  const image = await sticker();
  assert.equal(a.snapshot().peers[0]!.stickers, true);

  const sent = await a.sendSticker(image.bytes, image, b.id);
  assert.deepEqual([sent.delivered, sent.failed], [1, 0]);
  assert.equal(offers, 0, 'no consent step');
  const received = b.state.messages.find(message => message.id === sent.message.id)!;
  assert.deepEqual([received.kind, received.name, received.from, received.to], ['file', 'sticker.webp', a.id, b.id]);
  assert.deepEqual(received.sticker, { width: 96, height: 64, animated: false });
  assert(existsSync(join(a.filesDir, sent.message.id)) && existsSync(join(b.filesDir, sent.message.id)));
  assert.equal(b.state.unread[a.id], 1);
  assert.equal(incoming.length, 1);
  assert.match(await b.stickerImage(received.id), /^data:image\/webp;base64,/);
  assert.equal((await b.stickerBytes(received.id)).info.width, 96);
  // Stickers are stored like files but are not counted or listed as files.
  assert.equal(b.snapshot().stats[a.id]!.files, 0);
  assert.deepEqual(b.snapshot().recentFiles[a.id] ?? [], []);
  assert.deepEqual(b.listFiles(a.id).items, []);

  const reply = await b.sendSticker(image.bytes, image, a.id, received.id);
  await until(() => a.state.messages.some(message => message.id === reply.message.id));
  assert.equal(a.state.messages.find(message => message.id === reply.message.id)!.replyTo, received.id);

  // Restart: the record stays a sticker; a damaged sticker field leaves a downloadable file.
  const saved = JSON.parse(readFileSync(b.path, 'utf8')) as PeerState;
  const defaults = { ...b.state, messages: [] };
  assert.deepEqual(readPeerState(saved, defaults).messages.find(message => message.id === received.id)!.sticker, received.sticker);
  const damaged = saved.messages.find(message => message.id === received.id)!;
  Object.assign(damaged, { sticker: { width: 9999, height: 1, animated: false } });
  const reloaded = readPeerState(saved, defaults).messages.find(message => message.id === received.id)!;
  assert.equal(reloaded.sticker, undefined);
  assert.equal(reloaded.kind, 'file');

  await b.deleteMessages(a.id, [received.id]);
  assert.equal(existsSync(join(b.filesDir, received.id)), false);
  await assert.rejects(b.stickerImage(received.id), /Stiker tidak tersedia/);
});

test('pengiriman stiker mengikuti kemampuan penerima, Catatan pribadi, dan Pengumuman', async t => {
  const [a, b] = await peers(t, ['Andi', 'Budi']);
  const image = await sticker();
  a.rememberPeer(b.id, 'Budi', [], { ...b.profile(), stickers: false });
  await assert.rejects(a.sendSticker(image.bytes, image, b.id), /perlu memperbarui Lumilan Chat/);
  assert.equal(b.state.messages.length, 0);
  a.rememberPeer(b.id, 'Budi', [], b.profile());
  await assert.rejects(a.sendSticker(image.bytes, image, 'announcements'), /Ruang Pengumuman/);
  await assert.rejects(a.sendSticker(Buffer.alloc(0), image, b.id), /Stiker tidak valid/);

  const note = await a.sendSticker(image.bytes, image, 'notes');
  assert.equal(note.message.note, true);
  assert(existsSync(join(a.filesDir, note.message.id)));
  assert.equal(b.state.messages.length, 0, 'Personal notes never leave the device');

  a.archiveThread(b.id);
  await assert.rejects(a.sendSticker(image.bytes, image, b.id), /Pulihkan percakapan/);
  a.restoreThread(b.id);
  await b.stop();
  await until(() => !a.online.has(b.id));
  await assert.rejects(a.sendSticker(image.bytes, image, b.id), /offline/);
  assert.equal(a.state.messages.filter(message => message.sticker).length, 1, 'a failed send stores nothing');
  assert.deepEqual(a.state.messages.filter(message => message.sticker).map(message => message.id), [note.message.id]);
});

test('penerima menolak stiker yang tidak valid dan membatasi pengirim', async t => {
  const [a, b] = await peers(t, ['Andi', 'Budi']);
  const image = await sticker();
  const packet = (bytes = image.bytes.toString('base64'), message: Record<string, unknown> = {}) => ({ type: 'sticker', message: { id: randomUUID(), to: b.id, ...message }, bytes }) as DataPacket & { type: 'sticker' };
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } }).png().toBuffer();
  await assert.rejects(a.sendTo(b.id, packet(png.toString('base64'))), /Stiker tidak valid/);
  await assert.rejects(a.sendTo(b.id, packet(`${image.bytes.toString('base64')}A`)), /Stiker tidak valid/);
  await assert.rejects(a.sendTo(b.id, packet('A'.repeat(700_004))), /Stiker tidak valid/);
  await assert.rejects(a.sendTo(b.id, packet(undefined, { to: a.id })), /Stiker ditolak/);
  await assert.rejects(a.sendTo(b.id, packet(undefined, { roomId: randomUUID(), to: null })), /Stiker ditolak/);
  await assert.rejects(a.sendTo(b.id, packet(undefined, { replyTo: 'bukan-id' })), /Stiker ditolak/);
  assert.equal(b.state.messages.length, 0);
  assert.deepEqual(b.state.unread, {});

  // A repeated packet (a sender retrying after a timeout) is acknowledged once and stored once.
  const repeated = packet();
  await a.sendTo(b.id, repeated);
  await a.sendTo(b.id, repeated);
  assert.equal(b.state.messages.filter(message => message.id === repeated.message.id).length, 1);
  // The same id while it is still being decoded is refused.
  const twice = packet();
  const results = await Promise.allSettled([b.receiveSticker(a.id, twice), b.receiveSticker(a.id, twice)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.match(String(results.find(result => result.status === 'rejected')?.reason), /sedang diproses/);
  // 30 per sender per minute, counting every packet that reached the limit above.
  const counted = b.stickerTimes.get(a.id)!.length, stored = b.state.messages.length;
  for (let index = counted; index < 30; index++) await b.receiveSticker(a.id, packet());
  await assert.rejects(b.receiveSticker(a.id, packet()), /Terlalu banyak stiker/);
  assert.equal(b.state.messages.length, stored + 30 - counted);
});

test('stiker Ruang terkirim per anggota yang mendukungnya dan memeriksa versi Ruang', async t => {
  const [a, b, c] = await peers(t, ['Andi', 'Budi', 'Citra']);
  const { id } = await a.createRoom('Stiker', [b.id, c.id]);
  await b.acceptRoom(id);
  await c.acceptRoom(id);
  await until(() => b.room(id)?.members.length === 3 && c.room(id)?.members.length === 3);
  const image = await sticker(512, 512);

  a.rememberPeer(c.id, 'Citra', [], { ...c.profile(), stickers: false });
  const partial = await a.sendSticker(image.bytes, image, `room:${id}`);
  assert.deepEqual([partial.delivered, partial.failed], [1, 1]);
  const atB = b.state.messages.find(message => message.id === partial.message.id)!;
  assert.deepEqual([atB.roomId, atB.to, atB.sticker?.width], [id, null, 512]);
  assert.equal(b.state.unread[`room:${id}`], 1);
  assert.equal(c.state.messages.some(message => message.id === partial.message.id), false);
  assert(a.state.messages.some(message => message.id === partial.message.id), 'the sender keeps a message one member received');

  a.rememberPeer(b.id, 'Budi', [], { ...b.profile(), stickers: false });
  await assert.rejects(a.sendSticker(image.bytes, image, `room:${id}`), /Tidak ada anggota Ruang yang dapat menerima stiker/);
  a.rememberPeer(b.id, 'Budi', [], b.profile());
  a.rememberPeer(c.id, 'Citra', [], c.profile());

  const version = a.room(id)!.version;
  await assert.rejects(c.sendTo(b.id, { type: 'sticker', message: { id: randomUUID(), to: null, roomId: id, version: version - 1 }, bytes: image.bytes.toString('base64') }), /Stiker ditolak/);
  const full = await c.sendSticker(image.bytes, image, `room:${id}`);
  assert.deepEqual([full.delivered, full.failed], [2, 0]);
  await until(() => a.state.messages.some(message => message.id === full.message.id) && b.state.messages.some(message => message.id === full.message.id));
});
