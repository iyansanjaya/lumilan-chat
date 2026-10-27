import type { TestContext } from 'node:test';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STICKER_PACKS, STICKER_RECENT, Stickers, cleanPackName, readStickers, type StickerIndex } from '../src/main/stickers.js';

// The encoder is faked: each source file becomes "webp:<contents>", so equal contents are duplicates.
function fixture(t: TestContext, options: { failWrite?: (index: StickerIndex) => boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'lumilan-stickers-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const dir = join(root, 'stickers'), writes: StickerIndex[] = [];
  let saved: unknown, changes = 0;
  const library = new Stickers({ dir,
    read: () => saved,
    write: index => { if (options.failWrite?.(index)) throw new Error('disk full'); writes.push(index); saved = JSON.parse(JSON.stringify(index)); },
    encode: async bytes => {
      if (bytes.toString().startsWith('bad')) throw new Error('unsupported');
      return { bytes: Buffer.from(`webp:${bytes}`), width: 100, height: 80, animated: bytes.toString().startsWith('gif') };
    },
    thumbnail: async bytes => Buffer.from(`thumb:${bytes}`),
    onChange: () => { changes++; } });
  const source = (name: string, contents = name) => { const path = join(root, name); writeFileSync(path, contents); return path; };
  return { root, dir, library, writes, source, saved: () => saved, setSaved: (value: unknown) => { saved = value; }, changes: () => changes };
}

test('nama paket dibersihkan dan indeks tersimpan diperiksa ulang', () => {
  assert.equal(cleanPackName('  Kucing‮  lucu\n'), 'Kucing lucu');
  assert.equal(cleanPackName('x'.repeat(60)).length, 40);
  assert.equal(cleanPackName(42), '');
  const pack = randomUUID(), sticker = randomUUID();
  const entry = { id: sticker, width: 100, height: 80, animated: false, bytes: 10, sha256: 'a'.repeat(64) };
  const index = readStickers({ packs: [
    { id: pack, name: 'Lucu', createdAt: 1, stickers: [entry, { ...entry }, { ...entry, id: randomUUID(), width: 900 }, { ...entry, id: '../x' }] },
    { id: pack, name: 'Duplikat', createdAt: 1, stickers: [{ ...entry, id: randomUUID() }] },
    { id: randomUUID(), name: '', createdAt: 1, stickers: [{ ...entry, id: randomUUID() }] },
    { id: randomUUID(), name: 'Kosong', createdAt: 1, stickers: [] },
    { id: randomUUID(), name: 'Simpan', saved: true, createdAt: 1, stickers: [{ ...entry, id: randomUUID(), sha256: 'b'.repeat(64) }] },
    { id: randomUUID(), name: 'Simpan 2', saved: true, createdAt: 1, stickers: [{ ...entry, id: randomUUID(), sha256: 'c'.repeat(64) }] },
  ], recent: [sticker, sticker, randomUUID(), 'x'] });
  assert.deepEqual(index.packs.map(item => [item.name, item.stickers.length, item.saved === true]), [['Lucu', 1, false], ['Simpan', 1, true], ['Simpan 2', 1, true]]);
  assert.deepEqual(index.recent, [sticker]);
  assert.deepEqual(readStickers('rusak'), { packs: [], recent: [] });
});

test('impor menambah paket, melewati gambar buruk dan duplikat, serta menulis indeks per stiker', async t => {
  const { library, writes, source, dir } = fixture(t);
  await library.restore();
  assert.equal(writes.length, 1, 'a readable index is normalized once on start');
  await assert.rejects(library.importFiles([], 'Lucu'), /1–100 gambar/);
  await assert.rejects(library.importFiles([source('a.png')], '  '), /Nama paket/);
  await assert.rejects(library.importFiles(Array.from({ length: 101 }, () => source('a.png')), 'Lucu'), /1–100 gambar/);
  const result = await library.importFiles([source('a.png'), source('b.png', 'bad image'), source('c.png', 'a.png'), 'relative.png', join(dir, 'missing.png'), source('gif.gif')], 'Lucu');
  assert.deepEqual(result, { added: 2, skipped: 3, duplicates: 1 });
  assert.equal(writes.length, 3, 'the index is written after every stored sticker');
  const view = library.view();
  assert.equal(view.job, undefined);
  assert.deepEqual(view.packs.map(pack => [pack.name, pack.count, pack.saved]), [['Lucu', 2, false]]);
  assert.equal(JSON.stringify(view).includes(dir), false, 'views never carry paths');
  const pack = library.index.packs[0]!;
  assert.deepEqual(readdirSync(join(dir, pack.id)).sort(), pack.stickers.flatMap(item => [`${item.id}.thumb.webp`, `${item.id}.webp`]).sort());
  assert.equal(pack.stickers[1]!.animated, true);
  // The same name, in any case, adds to the same pack.
  await library.importFiles([source('d.png')], 'lucu');
  assert.deepEqual(library.view().packs.map(item => item.count), [3]);
  await library.importFiles([source('e.png')], 'Lain');
  assert.deepEqual(library.view().packs.map(item => item.name), ['Lucu', 'Lain']);

  const thumbs = await library.thumbs(pack.id);
  assert.equal(thumbs.length, 3);
  assert.match(thumbs[0]!.src, /^data:image\/webp;base64,/);
  assert.deepEqual((await library.thumbs('covers')).map(item => item.id), library.index.packs.map(item => item.id));
  await assert.rejects(library.thumbs(randomUUID()), /Paket stiker sudah tidak ada/);
  await assert.rejects(library.thumbs('../etc'), /Paket stiker sudah tidak ada/);
  const read = await library.read(pack.stickers[0]!.id);
  assert.equal(read.bytes.toString(), `webp:${'a.png'}`);
  assert.deepEqual(read.info, { width: 100, height: 80, animated: false });
  await assert.rejects(library.read(randomUUID()), /Stiker sudah tidak ada/);
});

test('impor berjalan satu per satu, melaporkan progres, dan berhenti saat indeks gagal disimpan', async t => {
  let failAt = 0;
  const { library, source } = fixture(t, { failWrite: index => failAt > 0 && index.packs.flatMap(pack => pack.stickers).length >= failAt });
  await library.restore();
  const progress: (number | undefined)[] = [];
  library.options.onChange = () => progress.push(library.view().job?.done);
  const [first, second] = await Promise.all([library.importFiles([source('1.png'), source('2.png')], 'A'), library.importFiles([source('3.png')], 'A')]);
  assert.deepEqual([first.added, second.added], [2, 1]);
  assert.deepEqual(library.view().packs.map(pack => pack.count), [3]);
  assert(progress.includes(1) && progress.includes(2) && progress.at(-1) === undefined);
  failAt = 5;
  await assert.rejects(library.importFiles([source('4.png'), source('5.png'), source('6.png')], 'A'), /disk full/);
  assert.equal(library.view().packs[0]!.count, 4, 'stickers stored before the failure stay');
  assert.equal(library.view().job, undefined);
});

test('hapus paket atau stiker terakhir membersihkan file dan riwayat terkini', async t => {
  const { library, source, dir } = fixture(t);
  await library.restore();
  await library.importFiles([source('a.png'), source('b.png')], 'A');
  await library.importFiles([source('c.png')], 'B');
  const [a, b] = library.index.packs;
  for (const item of [...a!.stickers, ...b!.stickers]) library.markRecent(item.id);
  library.markRecent(randomUUID());
  assert.equal(library.view().recent.length, 3);
  await library.deleteSticker(a!.stickers[0]!.id);
  assert.equal(existsSync(join(dir, a!.id, `${a!.stickers[0]!.id}.webp`)), false);
  assert.equal(library.view().recent.length, 2);
  await library.deleteSticker(b!.stickers[0]!.id);
  assert.equal(existsSync(join(dir, b!.id)), false, 'the last sticker takes its pack along');
  await library.deletePack(a!.id);
  assert.deepEqual(library.view(), { packs: [], recent: [] });
  assert.deepEqual(readdirSync(dir), []);
  await assert.rejects(library.deletePack(a!.id), /Paket stiker sudah tidak ada/);
  await assert.rejects(library.deleteSticker('x'), /Stiker sudah tidak ada/);
});

test('stiker dari percakapan masuk ke paket Tersimpan sekali saja', async t => {
  const { library, source } = fixture(t);
  await library.restore();
  await library.importFiles([source('a.png')], 'A');
  assert.deepEqual(await library.saveFromMessage(Buffer.from('webp:a.png'), { width: 100, height: 80, animated: false }), { duplicate: true });
  assert.deepEqual(await library.saveFromMessage(Buffer.from('baru'), { width: 50, height: 50, animated: true }), { duplicate: false });
  assert.deepEqual(await library.saveFromMessage(Buffer.from('lain'), { width: 50, height: 50, animated: false }), { duplicate: false });
  assert.deepEqual(await library.saveFromMessage(Buffer.from('baru'), { width: 50, height: 50, animated: true }), { duplicate: true });
  assert.deepEqual(library.view().packs.map(pack => [pack.saved, pack.count]), [[false, 1], [true, 2]]);
  await assert.rejects(library.saveFromMessage(Buffer.alloc(0), { width: 50, height: 50, animated: false }), /tidak tersedia/);
  for (let index = 0; index < STICKER_RECENT + 5; index++) library.markRecent(library.index.packs[1]!.stickers[index % 2]!.id);
  assert.equal(library.view().recent.length, 2);
});

test('batas paket berlaku untuk impor dan simpan', async t => {
  const { library, source, setSaved } = fixture(t);
  setSaved({ recent: [], packs: Array.from({ length: STICKER_PACKS }, (_, index) => ({ id: randomUUID(), name: `P${index}`, createdAt: 1,
    stickers: [{ id: randomUUID(), width: 1, height: 1, animated: false, bytes: 1, sha256: index.toString(16).padStart(64, '0') }] })) });
  await library.restore();
  assert.equal(library.view().packs.length, 0, 'packs without files are dropped on restore');
  await library.importFiles([source('a.png')], 'P0');
  for (let index = 1; index < STICKER_PACKS; index++) await library.importFiles([source(`${index}.png`)], `P${index}`);
  assert.equal(library.view().packs.length, STICKER_PACKS);
  await assert.rejects(library.importFiles([source('z.png')], 'Baru'), /Batas 50 paket/);
  await assert.rejects(library.saveFromMessage(Buffer.from('x'), { width: 1, height: 1, animated: false }), /Batas 50 paket/);
  assert.equal((await library.importFiles([source('y.png')], 'P1')).added, 1, 'an existing pack still grows');
});

test('pemulihan membuang entri tanpa file dan membersihkan sisa impor yang terputus', async t => {
  const { library, source, dir, saved, setSaved, writes } = fixture(t);
  await library.restore();
  await library.importFiles([source('a.png'), source('b.png')], 'A');
  const pack = library.index.packs[0]!, [first, second] = pack.stickers;
  rmSync(join(dir, pack.id, `${second!.id}.thumb.webp`));
  writeFileSync(join(dir, pack.id, `${randomUUID()}.webp.123.tmp`), 'x');
  writeFileSync(join(dir, pack.id, `${randomUUID()}.webp`), 'orphan');
  mkdirSync(join(dir, randomUUID()));
  const before = writes.length;
  const next = new Stickers({ ...library.options, read: () => saved() });
  await next.restore();
  assert.deepEqual(next.index.packs[0]!.stickers.map(item => item.id), [first!.id]);
  assert.deepEqual(readdirSync(join(dir, pack.id)).sort(), [`${first!.id}.thumb.webp`, `${first!.id}.webp`]);
  assert.deepEqual(readdirSync(dir), [pack.id]);
  assert.equal(writes.length, before + 1);
  // An unreadable index leaves the folders alone.
  setSaved(undefined);
  const broken = new Stickers({ ...library.options, read: () => { throw new SyntaxError('Unexpected token'); } });
  t.mock.method(console, 'warn', () => {});
  await broken.restore();
  assert.deepEqual(broken.view().packs, []);
  assert.deepEqual(readdirSync(dir), [pack.id]);
});
