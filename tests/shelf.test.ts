import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Shelf, glyphOf, readShelf, SHELF_MAX, type ShelfContact, type ShelfItem, type ShelfProgress } from '../src/main/shelf.js';

const root = resolve(tmpdir(), 'lumilan-shelf-test');
const file = (name: string) => join(root, name);
const flush = () => new Promise<void>(done => setImmediate(done));

// The shelf with an in-memory store, a fake file system and fake transfers that the test settles by hand.
function fixture(saved?: unknown) {
  const files = new Map<string, number>(), store = { saved, failWrite: false }, opened: string[] = [], dragged: string[] = [], done: string[] = [];
  const uploads: Array<{ path: string; to: string; observe: (progress: ShelfProgress) => void; resolve: () => void; reject: (error: Error) => void; canceled: boolean }> = [];
  const contacts: ShelfContact[] = [{ id: 'peer-alice', name: 'Alice', maxSize: 5 * 1024 ** 3 }, { id: 'peer-old', name: 'Old client', maxSize: 20 * 1024 ** 2 }];
  let changes = 0;
  const shelf = new Shelf({
    read: () => store.saved,
    write: items => { if (store.failWrite) throw new Error('disk full'); store.saved = JSON.parse(JSON.stringify(items)); },
    stat: async path => { const size = files.get(path); if (size === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return { isFile: () => size >= 0, size: Math.max(0, size) }; },
    open: async path => { opened.push(path); return files.has(path) ? '' : 'missing'; },
    drag: path => { dragged.push(path); },
    upload: (path, to, observe) => {
      let resolve!: () => void, reject!: (error: Error) => void;
      const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
      const entry = { path, to, observe, resolve, reject, canceled: false };
      uploads.push(entry);
      return { done: promise, cancel: () => { entry.canceled = true; reject(new Error('Pengiriman dibatalkan.')); } };
    },
    contacts: () => contacts,
    translate: (source, values = {}) => source.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? '')),
    onChange: () => { changes++; }, onDone: text => { done.push(text); },
  });
  return { shelf, files, store, opened, dragged, uploads, contacts, done, get changes() { return changes; } };
}

test('saved shelf entries are untrusted: they need an id, an absolute path and a size in range, once per file', () => {
  const id = randomUUID(), entry = (extra: Partial<ShelfItem>) => ({ id: randomUUID(), path: file('a.txt'), name: 'x', size: 10, addedAt: 1, ...extra });
  const items = readShelf([entry({ id }), entry({ path: file('a.txt') }), entry({ path: 'relative.txt' }), entry({ size: 0 }), entry({ size: 6 * 1024 ** 3 }),
    entry({ id: 'bad', path: file('b.txt') }), entry({ path: file('c\u202ename.txt') }), null, 'x']);
  assert.deepEqual(items.map(item => item.path), [file('a.txt'), file('c\u202ename.txt')]);
  assert.equal(items[1]!.name, 'c name.txt', 'A control character reached the display name');
  assert.equal(readShelf(Array.from({ length: 20 }, (_, i) => entry({ path: file(`${i}.txt`) }))).length, SHELF_MAX);
  assert.deepEqual([glyphOf('Photo.JPG'), glyphOf('talk.m4a'), glyphOf('report.pdf'), glyphOf('backup.tar'), glyphOf('clip.mov'), glyphOf('data.bin')],
    ['image', 'audio', 'document', 'archive', 'video', 'file']);
});

test('restore drops files that moved away since the last run', async () => {
  const kept = { id: randomUUID(), path: file('kept.txt'), name: 'kept.txt', size: 5, addedAt: 1 };
  const f = fixture([kept, { ...kept, id: randomUUID(), path: file('gone.txt') }]);
  f.files.set(file('kept.txt'), 5);
  await f.shelf.restore();
  assert.deepEqual(f.shelf.items.map(item => item.path), [file('kept.txt')]);
  assert.equal((f.store.saved as ShelfItem[]).length, 1, 'The cleaned list was not stored');
});

test('drops keep regular files of 1 B-5 GB, move a repeated file to the front, and replace the oldest past ten', async () => {
  const f = fixture();
  for (let i = 0; i < 12; i++) f.files.set(file(`${i}.txt`), 100 + i);
  f.files.set(file('empty.bin'), 0); f.files.set(file('folder'), -1); f.files.set(file('huge.iso'), 5 * 1024 ** 3 + 1);
  assert.deepEqual(await f.shelf.add([file('0.txt'), file('empty.bin'), file('folder'), file('huge.iso'), 'relative.txt', file('missing.txt')]), { added: 1, replaced: 0, skipped: 5 });
  await assert.rejects(f.shelf.add('C:/x'), /tidak valid/);
  await assert.rejects(f.shelf.add(Array(11).fill(file('0.txt'))), /tidak valid/);
  for (let i = 1; i < 10; i++) await f.shelf.add([file(`${i}.txt`)]);
  assert.equal(f.shelf.items.length, 10);
  await f.shelf.add([file('0.txt')]);
  assert.equal(f.shelf.items[0]!.path, file('0.txt'), 'A repeated drop did not move the file to the front');
  assert.equal(f.shelf.items.length, 10, 'A repeated drop added a second entry');
  // The oldest item is being sent: the next oldest one leaves instead.
  const oldest = f.shelf.items.at(-1)!;
  f.shelf.note(oldest.id);
  assert.deepEqual(await f.shelf.add([file('10.txt')]), { added: 1, replaced: 1, skipped: 0 });
  assert(f.shelf.items.some(item => item.id === oldest.id), 'A file being sent was evicted');
  f.store.failWrite = true;
  await assert.rejects(f.shelf.add([file('11.txt')]), /disk full/);
  assert(!f.shelf.items.some(item => item.path === file('11.txt')), 'A failed write changed the shelf');
  // Concurrent drops are added one after the other.
  f.store.failWrite = false;
  const [a, b] = await Promise.all([f.shelf.add([file('11.txt')]), f.shelf.add([file('1.txt')])]);
  assert.deepEqual([a.added, b.added, f.shelf.items.length], [1, 1, 10]);
});

test('open and drag use the stored path; a file that moved away leaves the shelf; remove never deletes the file', async () => {
  const f = fixture();
  f.files.set(file('a.txt'), 10); f.files.set(file('b.txt'), 20);
  await f.shelf.add([file('a.txt'), file('b.txt')]);
  const [b, a] = f.shelf.items;
  await f.shelf.open(a!.id); await f.shelf.drag(b!.id);
  assert.deepEqual([f.opened, f.dragged], [[file('a.txt')], [file('b.txt')]]);
  f.files.delete(file('a.txt'));
  await assert.rejects(f.shelf.open(a!.id), /lokasi semula/);
  assert.equal(f.shelf.items.length, 1, 'A missing file stayed on the shelf');
  await assert.rejects(f.shelf.open('nope'), /tidak ada di Rak/);
  f.shelf.remove(b!.id);
  assert.deepEqual([f.shelf.items.length, f.files.has(file('b.txt'))], [0, true]);
  assert(!JSON.stringify(f.shelf.view()).includes(root), 'A path reached the view');
});

test('sending lists online contacts by opaque position, checks size, reports monotonic progress and a notice, and cancels', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  f.files.set(file('big.zip'), 50 * 1024 ** 2);
  await f.shelf.add([file('big.zip')]);
  const item = f.shelf.items[0]!;
  assert.equal(f.shelf.view().picker, undefined, 'Contact names appeared before the picker was opened');
  f.shelf.pick(item.id);
  const picker = f.shelf.view().picker!;
  assert.deepEqual(picker.contacts.map(contact => [contact.id, contact.name]), [['c0', 'Alice'], ['c1', 'Old client']]);
  assert(!JSON.stringify(f.shelf.view()).includes('peer-alice'), 'A peer id reached the view');
  assert.throws(() => f.shelf.send({ id: item.id, to: 'c1' }), /terlalu besar/);
  assert.throws(() => f.shelf.send({ id: item.id, to: '../x' }), /tidak valid/);
  f.shelf.send({ id: item.id, to: 'c0' });
  assert.deepEqual([f.uploads[0]!.path, f.uploads[0]!.to, f.shelf.view().picker], [file('big.zip'), 'peer-alice', undefined]);
  const job = () => f.shelf.view().items[0]!.job!;
  f.uploads[0]!.observe({ status: 'waiting' }); assert.equal(job().status, 'waiting');
  f.uploads[0]!.observe({ sent: 60, total: 100 }); f.uploads[0]!.observe({ sent: 30, total: 100 });
  assert.deepEqual([job().status, job().progress], ['sending', 60], 'Progress moved backwards');
  assert.throws(() => f.shelf.note(item.id), /sedang dikirim/);
  f.uploads[0]!.resolve(); await flush();
  assert.deepEqual([f.shelf.view().items[0]!.job, f.shelf.view().items[0]!.notice, f.done], [undefined, 'Terkirim ke Alice.', ['Terkirim ke Alice.']]);
  t.mock.timers.tick(8000);
  assert.equal(f.shelf.view().items[0]!.notice, undefined, 'The notice did not expire');
  // Offline at send time, then a canceled save to notes.
  f.shelf.pick(item.id); f.contacts.length = 0;
  assert.throws(() => f.shelf.send({ id: item.id, to: 'c0' }), /offline/);
  f.shelf.note(item.id);
  assert.deepEqual([f.uploads[1]!.to, job().kind, job().status], ['notes', 'note', 'saving']);
  f.shelf.cancel(item.id); await flush();
  assert.deepEqual([f.uploads[1]!.canceled, f.shelf.view().items[0]!.failed, f.shelf.view().items[0]!.notice], [true, true, 'Pengiriman dibatalkan.']);
  assert.throws(() => f.shelf.cancel(item.id), /Tidak ada pengiriman/);
  f.shelf.dispose();
});
