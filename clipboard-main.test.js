import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
const fileStart = source.indexOf("handler('file', async (path, to, clipboardBytes) => {");
const quitStart = source.indexOf("app.on('before-quit',");
assert(fileStart >= 0 && quitStart >= 0);
const fileSource = source.slice(fileStart, source.indexOf('  let clipboardValidationPending', fileStart));
const quitSource = source.slice(quitStart, source.indexOf("app.on('window-all-closed',", quitStart));
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture({ send, dispose }) {
  let file;
  let beforeQuit;
  let exits = 0;
  const warnings = [];
  const app = {
    on: (name, callback) => { assert.equal(name, 'before-quit'); beforeQuit = callback; },
    quit: () => {
      const event = { prevented: false, preventDefault() { this.prevented = true; } };
      beforeQuit(event);
      if (!event.prevented) exits++;
    },
  };
  const context = vm.createContext({
    AbortController, Date, clearTimeout,
    activeUpload: undefined, activeUploadDone: undefined, quitWaiting: false, quitting: false,
    window: undefined, positionSaveTimer: undefined, settingsPath: undefined, settings: undefined,
    notch: undefined, linuxScreenLock: undefined, pendingFileOffers: new Map(),
    console: { warn: (...args) => warnings.push(args) },
    handler: (name, action) => { assert.equal(name, 'file'); file = action; },
    app,
    stageClipboardImage: async (_bytes, root) => {
      assert.equal(root, 'private-files');
      return { path: 'private-files/.clipboard-test/image.png', dispose };
    },
    peer: { filesDir: 'private-files', sendFilePath: send, stop: async () => {} },
  });
  vm.runInContext(fileSource + '\n' + quitSource, context);
  return { file, app, context, warnings, exits: () => exits };
}

test('clipboard cleanup failure preserves completed transfer and original transfer errors', async () => {
  const cleanupError = Object.assign(new Error('cleanup failed'), { code: 'EBUSY' });
  const result = { delivered: 1, message: { id: 'image-already-delivered' } };
  const successful = fixture({ send: async () => result, dispose: async () => { throw cleanupError; } });
  assert.equal(await successful.file('', 'notes', new Uint8Array([1])), result);
  assert.equal(successful.context.activeUpload, undefined);
  assert.deepEqual(successful.warnings, [['Gagal membersihkan staging clipboard:', 'EBUSY']]);
  const transferError = new Error('recipient declined');
  const declined = fixture({ send: async () => { throw transferError; }, dispose: async () => { throw cleanupError; } });
  await assert.rejects(declined.file('', 'notes', new Uint8Array([1])), error => error === transferError);
  assert.equal(declined.context.activeUpload, undefined);
});

test('quit aborts active upload and waits for staging disposal; repeated quit cannot bypass it', async () => {
  let releaseCleanup;
  const cleanup = new Promise(resolve => { releaseCleanup = resolve; });
  const f = fixture({
    send: async (_path, _to, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
    dispose: () => cleanup,
  });
  const upload = f.file('', 'notes', new Uint8Array([1]));
  const rejected = assert.rejects(upload, /Pengiriman dibatalkan/);
  await flush();
  f.app.quit();
  assert.equal(f.context.activeUpload.signal.aborted, true);
  assert.equal(f.exits(), 0);
  await flush();
  f.app.quit();
  assert.equal(f.exits(), 0, 'Repeated Quit skipped cleanup');
  releaseCleanup();
  await rejected;
  await flush();
  assert.equal(f.exits(), 1);
  assert.equal(f.context.activeUpload, undefined);
});

test('clipboard upload cannot start after quitting begins', async () => {
  const f = fixture({ send: async () => assert.fail('Transfer started while quitting'), dispose: async () => {} });
  f.context.quitting = true;
  await assert.rejects(f.file('', 'notes', new Uint8Array([1])), /Pengiriman dibatalkan/);
  assert.equal(f.context.activeUpload, undefined);
});
