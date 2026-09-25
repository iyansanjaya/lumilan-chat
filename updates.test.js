import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { startUpdates, updateFailureDetail } from './updates.js';

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

test('pesan kegagalan update membedakan internet, metadata, dan izin', () => {
  assert.match(updateFailureDetail({ code: 'ENOTFOUND' }), /internet/);
  assert.match(updateFailureDetail(new Error('HttpError: 404 Not Found')), /Metadata pembaruan/);
  assert.match(updateFailureDetail(new Error('403 Forbidden')), /Akses/);
  assert.doesNotMatch(updateFailureDetail(new Error('HttpError: 404 Not Found')), /Koneksi internet/);
});


test('macOS Intel memeriksa rilis publik saat metadata updater tidak ada', async () => {
  const dialogs = [];
  let updaterCalls = 0;
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => { updaterCalls++; throw new Error('latest-mac.yml 404'); };
  const fetchRelease = async () => ({ ok: true, json: async () => ({ tag_name: 'v0.4.0', assets: [] }) });
  const check = startUpdates({
    app: { isPackaged: true, getVersion: () => '0.4.0' }, updater,
    dialog: { showMessageBox: async (_window, options) => { dialogs.push(options); return { response: 0 }; } },
    getWindow: () => ({}), beforeInstall: () => {}, platform: 'darwin', arch: 'x64', fetchRelease,
  });
  await check(true);
  assert.match(dialogs.at(-1).message, /versi terbaru/);
  assert.equal(updaterCalls, 0);
});

test('macOS menyebut paket Intel yang belum terbit', async () => {
  const dialogs = [];
  const check = startUpdates({
    app: { isPackaged: true, getVersion: () => '0.4.0' }, updater: new EventEmitter(),
    dialog: { showMessageBox: async (_window, options) => { dialogs.push(options); return { response: 0 }; } },
    getWindow: () => ({}), beforeInstall: () => {}, platform: 'darwin', arch: 'x64',
    fetchRelease: async () => ({ ok: true, json: async () => ({ tag_name: 'v0.4.1', assets: [{ name: 'Lumilan-Chat-Setup-0.4.1.exe' }] }) }),
  });
  await check(true);
  assert.match(dialogs.at(-1).message, /paket macOS Intel belum diterbitkan/);
});
