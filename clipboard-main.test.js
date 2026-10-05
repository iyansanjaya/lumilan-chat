import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';

const source = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert(from >= 0 && to > from, `Missing source boundary: ${start}`);
  return source.slice(from, to);
}
const declarations = section('const activeUploads = new Map();', 'let quitWaiting');
const fileSource = section('  let clipboardPreparation = Promise.resolve();', "  handler('file-offers',");
const cancelSource = section("  handler('cancel-file',", "  handler('list-files',");
const quitSource = section('function prepareQuit()', "app.on('window-all-closed',");
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const cancelable = (_path, _to, { signal }) => new Promise((_resolve, reject) => {
  signal.addEventListener('abort', () => reject(signal.reason), { once: true });
});

function fixture({ send = cancelable, dispose = async () => {}, stage, inspect, stop = async () => {} } = {}) {
  const handlers = new Map(), warnings = [], progress = [];
  let beforeQuit, exits = 0, stops = 0;
  const app = {
    on: (name, callback) => { assert.equal(name, 'before-quit'); beforeQuit = callback; },
    quit: () => {
      const event = { prevented: false, preventDefault() { this.prevented = true; } };
      beforeQuit(event);
      if (!event.prevented) exits++;
    },
  };
  const context = vm.createContext({
    AbortController, Date, clearTimeout, randomUUID, ArrayBuffer, Uint8Array, MAX_CLIPBOARD_IMAGE: 20 * 1024 * 1024,
    quitWaiting: false, quitCompleted: false, quitShutdown: undefined, refreshingNetwork: undefined, quitting: false,
    window: { isDestroyed: () => false, webContents: { send: (channel, value) => {
      assert.equal(channel, 'lumilan:file-progress'); progress.push({ ...value });
    } } },
    positionSaveTimer: undefined, settingsPath: undefined, settings: undefined,
    notch: undefined, linuxScreenLock: undefined, pendingFileOffers: new Map(),
    console: { warn: (...args) => warnings.push(args) },
    handler: (name, action) => handlers.set(name, action), app,
    stageClipboardImage: stage || (async (_bytes, root) => {
      assert.equal(root, 'private-files');
      return { path: 'private-files/.clipboard-test/image.png', dispose };
    }),
    inspectClipboardImage: inspect || (async () => ({ metadata: { width: 2, height: 3 } })),
    peer: { filesDir: 'private-files', sendFilePath: send, stop: async () => { stops++; await stop(); } },
  });
  vm.runInContext([declarations, fileSource, cancelSource, quitSource].join('\n'), context);
  return { file: handlers.get('file'), cancel: handlers.get('cancel-file'), preview: handlers.get('clipboard-image'),
    app, context, warnings, progress, active: () => vm.runInContext('activeUploads', context), exits: () => exits, stops: () => stops };
}

test('clipboard cleanup failure preserves completed transfer and original transfer errors', async () => {
  const cleanupError = Object.assign(new Error('cleanup failed'), { code: 'EBUSY' });
  const result = { delivered: 1, message: { id: 'image-already-delivered' } };
  const successful = fixture({ send: async () => result, dispose: async () => { throw cleanupError; } });
  assert.equal(await successful.file('', 'notes', new Uint8Array([1])), result);
  assert.equal(successful.active().size, 0);
  assert.deepEqual(successful.warnings, [['Gagal membersihkan staging clipboard:', 'EBUSY']]);
  const transferError = new Error('recipient declined');
  const declined = fixture({ send: async () => { throw transferError; }, dispose: async () => { throw cleanupError; } });
  await assert.rejects(declined.file('', 'notes', new Uint8Array([1])), error => error === transferError);
  assert.equal(declined.active().size, 0);
});

test('two waiting uploads have independent progress, cancellation and disposal', async () => {
  const jobs = new Map(), disposed = [];
  const f = fixture({
    stage: async bytes => ({ path: `private-files/image-${bytes[0]}.png`, dispose: async () => disposed.push(bytes[0]) }),
    send: (path, to, options) => {
      const completion = deferred();
      options.signal.addEventListener('abort', () => completion.reject(options.signal.reason), { once: true });
      jobs.set(path, { to, options, completion }); options.onStatus('waiting'); return completion.promise;
    },
  });
  const firstId = randomUUID(), secondId = randomUUID();
  const first = f.file('', 'recipient', new Uint8Array([1]), firstId);
  const second = f.file('', 'recipient', new Uint8Array([2]), secondId);
  await flush();
  assert.equal(jobs.size, 2, 'Recipient consent blocked the second upload');
  assert.deepEqual(f.progress, [{ id: firstId, status: 'waiting' }, { id: secondId, status: 'waiting' }]);
  assert.throws(() => f.cancel(), /Pengiriman file tidak valid/);
  assert.throws(() => f.cancel(null), /Pengiriman file tidak valid/);
  assert.equal(f.cancel(randomUUID()), false);
  assert.equal(f.cancel(firstId), true);
  await assert.rejects(first, /Pengiriman dibatalkan/);
  assert.deepEqual(disposed, [1]);
  const remaining = jobs.get('private-files/image-2.png');
  assert.equal(remaining.options.signal.aborted, false);
  remaining.options.onProgress(25, 100);
  assert.deepEqual(f.progress.at(-1), { id: secondId, sent: 25, total: 100, status: undefined });
  remaining.completion.resolve({ delivered: 1 });
  assert.equal((await second).delivered, 1);
  assert.deepEqual(disposed, [1, 2]);
  assert.equal(f.active().size, 0);
  assert.equal(f.cancel(firstId), false);
  assert(!f.progress.some(value => Object.hasOwn(value, 'path') || Object.hasOwn(value, 'to')), 'Progress exposed a path or recipient');
});

test('upload IDs and capacity are checked before preparation; capacity returns after cancellation', async () => {
  const f = fixture();
  const id = randomUUID(), first = f.file('native-file', 'recipient', undefined, id);
  const rejected = assert.rejects(first, /Pengiriman dibatalkan/);
  for (const value of [id, '', 'x'.repeat(36), 1, null, {}])
    await assert.rejects(f.file('native-file', 'recipient', undefined, value), /Pengiriman file tidak valid/);
  const others = Array.from({ length: 7 }, () => {
    const uploadId = randomUUID(), promise = f.file('native-file', 'recipient', undefined, uploadId);
    return { id: uploadId, rejected: assert.rejects(promise, /Pengiriman dibatalkan/) };
  });
  assert.equal(f.active().size, 8);
  await assert.rejects(f.file('native-file', 'recipient'), /Maksimal 8/);
  for (const uploadId of [id, ...others.map(job => job.id)]) f.cancel(uploadId);
  await Promise.all([rejected, ...others.map(job => job.rejected)]);
  assert.equal(f.active().size, 0);
  const legacy = f.file('native-file', 'recipient');
  const legacyRejected = assert.rejects(legacy, /Pengiriman dibatalkan/);
  assert.equal(f.cancel(), true, 'Legacy cancellation should work for one remaining job');
  await legacyRejected;
  assert.equal(f.cancel(), false);
});

test('clipboard preview and uploads share one decoder and recover after decode errors', async () => {
  const gate = deferred(), calls = [];
  const failedDecode = new Error('corrupt image');
  const f = fixture({
    inspect: async () => { calls.push('preview'); await gate.promise; throw failedDecode; },
    stage: async bytes => { calls.push(`stage-${bytes[0]}`); return { path: 'private-image', dispose: async () => {} }; },
    send: async () => ({ delivered: 1 }),
  });
  const preview = f.preview(new Uint8Array([1]));
  const previewRejected = assert.rejects(preview, error => error === failedDecode);
  const upload = f.file('', 'notes', new Uint8Array([2]));
  await flush();
  assert.deepEqual(calls, ['preview'], 'Staging decoded while preview decoder was busy');
  await assert.rejects(f.preview(new Uint8Array([3])), /Pengiriman file lain/);
  gate.resolve(); await previewRejected; await upload;
  assert.deepEqual(calls, ['preview', 'stage-2']);
  assert.equal(f.active().size, 0);
});

test('invalid clipboard bytes are rejected before the bounded decoder queue', async () => {
  const f = fixture({ stage: async () => assert.fail('Invalid bytes were staged'), inspect: async () => assert.fail('Invalid bytes were decoded') });
  for (const bytes of [null, {}, { byteLength: 1 }, '', new Uint8Array(), new Uint8Array(20 * 1024 * 1024 + 1)]) {
    await assert.rejects(f.file('', 'notes', bytes), /Gambar clipboard harus/);
    await assert.rejects(f.preview(bytes), /Gambar clipboard harus/);
  }
  assert.equal(f.active().size, 0);
});

test('Quit skips a queued preview decode and rejects new previews', async () => {
  const gate = deferred();
  const f = fixture({ stage: async () => { await gate.promise; return { path: 'private-image', dispose: async () => {} }; },
    inspect: async () => assert.fail('Queued preview decoded after Quit') });
  const upload = f.file('', 'recipient', new Uint8Array([1]));
  const rejected = assert.rejects(upload, /Pengiriman dibatalkan/);
  const preview = f.preview(new Uint8Array([2]));
  const previewRejected = assert.rejects(preview, /Pengiriman dibatalkan/);
  await flush(); f.app.quit();
  await assert.rejects(f.preview(new Uint8Array([3])), /Pengiriman dibatalkan/);
  gate.resolve(); await rejected; await previewRejected; await flush();
  assert.equal(f.exits(), 1);
});

test('canceling queued clipboard preparation skips its decode without disturbing the earlier image', async () => {
  const gate = deferred(), staged = [];
  const f = fixture({
    stage: async bytes => { staged.push(bytes[0]); await gate.promise; return { path: 'private-image', dispose: async () => {} }; },
    send: async () => ({ delivered: 1 }),
  });
  const first = f.file('', 'notes', new Uint8Array([1]), randomUUID());
  const secondId = randomUUID(), second = f.file('', 'notes', new Uint8Array([2]), secondId);
  const rejected = assert.rejects(second, /Pengiriman dibatalkan/);
  await flush(); f.cancel(secondId);
  assert.deepEqual(staged, [1]);
  gate.resolve(); await first; await rejected;
  assert.deepEqual(staged, [1]);
  assert.equal(f.active().size, 0);
});

test('Quit waits for peer shutdown without outgoing uploads and repeated Quit starts shutdown once', async () => {
  const stopping = deferred(), f = fixture({ stop: () => stopping.promise });
  f.app.quit();
  assert.equal(f.exits(), 0, 'Quit exited before incoming transfers and peer shutdown completed');
  await flush();
  assert.equal(f.stops(), 1);
  f.app.quit();
  assert.equal(f.exits(), 0, 'Repeated Quit bypassed pending peer shutdown');
  assert.equal(f.stops(), 1, 'Repeated Quit started another peer shutdown');
  stopping.resolve(); await flush();
  assert.equal(f.exits(), 1);
  assert.equal(f.stops(), 1);
});

test('Quit finishes after rejected peer shutdown without an unhandled rejection', async () => {
  const f = fixture({ stop: async () => { throw new Error('peer shutdown failed'); } });
  f.app.quit();
  assert.equal(f.exits(), 0, 'Quit skipped the asynchronous peer shutdown result');
  await flush();
  assert.equal(f.exits(), 1, 'A peer shutdown rejection left Quit permanently blocked');
  assert.equal(f.stops(), 1);
});

test('update preparation and a concurrent Quit share one peer shutdown', async () => {
  const stopping = deferred(), f = fixture({ stop: () => stopping.promise });
  const preparing = vm.runInContext('prepareQuit()', f.context);
  assert.equal(vm.runInContext('prepareQuit()', f.context), preparing);
  await flush();
  assert.equal(f.stops(), 1);
  assert.equal(f.exits(), 0, 'Update preparation should leave the updater in control of installation');
  f.app.quit();
  assert.equal(f.exits(), 0);
  stopping.resolve(); await preparing; await flush();
  assert.equal(f.stops(), 1);
  assert.equal(f.exits(), 1);
});

test('Quit waits for an existing network refresh before the final peer shutdown', { timeout: 1000 }, async () => {
  const refresh = deferred(), f = fixture();
  f.context.refreshingNetwork = refresh.promise;
  f.app.quit(); await flush();
  assert.equal(f.exits(), 0, 'Quit exited while an existing refresh could still restart the peer');
  assert.equal(f.stops(), 0, 'Final peer shutdown ran before the refresh settled');
  f.app.quit();
  refresh.resolve(); await flush();
  assert.equal(f.stops(), 1);
  assert.equal(f.exits(), 1);
});

test('a failed network refresh still runs the final peer shutdown', { timeout: 1000 }, async () => {
  const refresh = deferred(), f = fixture();
  f.context.refreshingNetwork = refresh.promise;
  f.app.quit(); await flush();
  refresh.reject(new Error('network refresh failed')); await flush();
  assert.equal(f.stops(), 1);
  assert.equal(f.exits(), 1);
});

test('Quit aborts every waiting, preparing and queued image and waits for staging cleanup before peer shutdown', async () => {
  const preparing = deferred(), cleanup = [deferred(), deferred()], stopping = deferred(), staged = [], disposed = [];
  const f = fixture({
    stop: () => stopping.promise,
    stage: async bytes => {
      const index = bytes[0]; staged.push(index);
      if (index === 2) await preparing.promise;
      return { path: `private-image-${index}`, dispose: async () => { disposed.push(index); await cleanup[index - 1].promise; } };
    },
  });
  const first = f.file('', 'recipient', new Uint8Array([1]), randomUUID());
  const firstRejected = assert.rejects(first, /Pengiriman dibatalkan/);
  await flush();
  const second = f.file('', 'recipient', new Uint8Array([2]), randomUUID());
  const third = f.file('', 'recipient', new Uint8Array([3]), randomUUID());
  const secondRejected = assert.rejects(second, /Pengiriman dibatalkan/);
  const thirdRejected = assert.rejects(third, /Pengiriman dibatalkan/);
  await flush();
  assert.deepEqual(staged, [1, 2]);
  assert.equal(f.active().size, 3);
  f.app.quit();
  assert([...f.active().values()].every(job => job.controller.signal.aborted));
  assert.equal(f.exits(), 0);
  assert.equal(f.stops(), 0, 'Peer stopped before aborted outgoing transfers could cancel their remote offers');
  await flush();
  f.app.quit(); assert.equal(f.exits(), 0, 'Repeated Quit skipped cleanup');
  preparing.resolve(); await flush();
  assert.deepEqual(disposed, [1, 2]);
  assert.deepEqual(staged, [1, 2], 'Quit started a queued image decode');
  cleanup[0].resolve(); await firstRejected; await flush();
  assert.equal(f.exits(), 0, 'Quit skipped the second staging disposal');
  assert.equal(f.stops(), 0, 'Peer stopped while another outgoing transfer was still cleaning up');
  cleanup[1].resolve(); await Promise.all([secondRejected, thirdRejected]); await flush();
  assert.equal(f.exits(), 0, 'Quit exited before peer shutdown completed');
  assert.equal(f.active().size, 0);
  assert.equal(f.stops(), 1, 'Quit must stop the peer once after all outgoing transfer cleanup');
  f.app.quit();
  assert.equal(f.exits(), 0, 'Repeated Quit skipped peer shutdown after outgoing cleanup');
  assert.equal(f.stops(), 1);
  stopping.resolve(); await flush();
  assert.equal(f.exits(), 1);
});

test('clipboard upload cannot start after quitting begins; a staging failure releases only its own job', async () => {
  const f = fixture({ send: async () => assert.fail('Transfer started while quitting') });
  f.context.quitting = true;
  await assert.rejects(f.file('', 'notes', new Uint8Array([1])), /Pengiriman dibatalkan/);
  assert.equal(f.active().size, 0);
  const error = new Error('stage failed');
  const broken = fixture({ stage: async () => { throw error; } });
  const waitingId = randomUUID(), waiting = broken.file('native-image', 'recipient', undefined, waitingId);
  const rejected = assert.rejects(waiting, /Pengiriman dibatalkan/);
  await assert.rejects(broken.file('', 'notes', new Uint8Array([1])), value => value === error);
  assert.equal(broken.active().size, 1);
  assert.equal(broken.active().get(waitingId).controller.signal.aborted, false);
  broken.cancel(waitingId); await rejected;
});

function preloadFixture() {
  const calls = [], conversions = [];
  let bridge;
  class PendingBlob {
    get type() { return 'image/png'; }
    get size() { return 10; }
    arrayBuffer() { const gate = deferred(); conversions.push(gate); return gate.promise; }
  }
  const context = vm.createContext({ Blob: PendingBlob, require: name => {
    assert.equal(name, 'electron');
    return { webUtils: { getPathForFile: file => file.path || '' }, ipcRenderer: { invoke: async (...args) => { calls.push(args); return true; } },
      contextBridge: { exposeInMainWorld: (_name, api) => { bridge = api; } } };
  } });
  vm.runInContext(readFileSync(new URL('./preload.cjs', import.meta.url), 'utf8'), context);
  return { bridge, calls, conversions, blob: () => new PendingBlob() };
}

test('preload forwards per-upload IDs and cancellation while bytes are still being prepared', async () => {
  const f = preloadFixture(), id = randomUUID();
  const sending = f.bridge.file(f.blob(), 'recipient', id);
  const rejected = assert.rejects(sending, /Pengiriman dibatalkan/);
  await f.bridge.cancelFile(id);
  f.conversions[0].resolve(new ArrayBuffer(10)); await rejected;
  assert.deepEqual(f.calls, [['lumilan:cancel-file', id]], 'A canceled byte conversion still entered main IPC');
  const native = { path: 'private-native-image' };
  assert.equal(await f.bridge.file(native, 'recipient', id), true);
  assert.deepEqual(f.calls.at(-1), ['lumilan:file', native.path, 'recipient', undefined, id]);
});

test('preload bounds jobs before byte conversion and rejects duplicate IDs', async () => {
  const f = preloadFixture(), ids = Array.from({ length: 8 }, () => randomUUID());
  const uploads = ids.map(id => f.bridge.file(f.blob(), 'recipient', id));
  await assert.rejects(f.bridge.file(f.blob(), 'recipient', randomUUID()), /Maksimal 8/);
  await assert.rejects(f.bridge.file(f.blob(), 'recipient', ids[0]), /Pengiriman file tidak valid/);
  await assert.rejects(f.bridge.file(f.blob(), 'recipient', {}), /Pengiriman file tidak valid/);
  assert.equal(f.conversions.length, 8);
  for (const conversion of f.conversions) conversion.resolve(new ArrayBuffer(10));
  await Promise.all(uploads);
  assert.equal(f.calls.length, 8);
  assert.deepEqual(f.calls.map(call => call[4]), ids);
  assert.equal(await f.bridge.file({ path: 'native' }, 'recipient', ids[0]), true);
});
