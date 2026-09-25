import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { startUpdates } from './updates.js';

test('pembaruan diperiksa, diunduh, dan hanya dipasang setelah pengguna memilih mulai ulang', async () => {
  const updater = new EventEmitter();
  const dialogs = [];
  let response = 0;
  let installed = 0;
  let quitting = 0;
  updater.checkForUpdates = async () => { updater.emit('update-not-available'); return null; };
  updater.quitAndInstall = () => { installed++; };
  const check = startUpdates({
    app: { isPackaged: true, getVersion: () => '0.3.0' },
    updater,
    dialog: { showMessageBox: async (_window, options) => { dialogs.push(options); return { response }; } },
    getWindow: () => ({}),
    beforeInstall: () => { quitting++; },
  });

  assert.equal(updater.autoDownload, true);
  assert.equal(updater.autoInstallOnAppQuit, false);
  await check(true);
  assert.match(dialogs.at(-1).message, /versi terbaru/);

  updater.emit('update-available');
  await check(true);
  assert.match(dialogs.at(-1).message, /sedang diunduh/);

  updater.emit('update-downloaded', { version: '0.4.0' });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(dialogs.at(-1).message, /0\.4\.0/);
  assert.equal(installed, 0);

  response = 1;
  await check(true);
  assert.equal(quitting, 1);
  assert.equal(installed, 1);
});
