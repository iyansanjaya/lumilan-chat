import type { MessageBoxOptions } from 'electron';
import type { UpdateService } from '../src/main/updates.js';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { startUpdates, updateFailureDetail } from '../src/main/updates.js';

const flush = () => new Promise(resolve => setImmediate(resolve));

test('pembaruan diperiksa, diunduh, dan hanya dipasang setelah pengguna memilih mulai ulang', async () => {
  const updater: EventEmitter & UpdateService = new EventEmitter();
  const dialogs: MessageBoxOptions[] = [];
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
    platform: 'win32',
  });

  assert.equal(updater.autoDownload, true);
  assert.equal(updater.autoInstallOnAppQuit, false);
  await check(true);
  assert.match(dialogs.at(-1)!.message, /versi terbaru/);

  updater.emit('update-available');
  await check(true);
  assert.match(dialogs.at(-1)!.message, /sedang diunduh/);

  updater.emit('update-downloaded', { version: '0.4.0' });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(dialogs.at(-1)!.message, /0\.4\.0/);
  assert.equal(installed, 0);

  response = 1;
  await check(true);
  assert.equal(quitting, 1);
  assert.equal(installed, 1);
});

test('install waits for asynchronous shutdown and a second update check cannot skip it', async () => {
  const updater: EventEmitter & UpdateService = new EventEmitter(), order: string[] = [];
  let releaseShutdown!: () => void; let response = 0;
  const shutdown = new Promise<void>(resolve => { releaseShutdown = resolve; });
  updater.quitAndInstall = (...args: [boolean, boolean]) => { assert.deepEqual(args, [false, true]); order.push('install'); };
  const check = startUpdates({
    app: { isPackaged: true, getVersion: () => '1.0.0' }, updater,
    dialog: { showMessageBox: async () => ({ response }) }, getWindow: () => ({}),
    beforeInstall: async () => { order.push('prepare'); await shutdown; order.push('cleaned'); }, platform: 'win32',
  });
  updater.emit('update-downloaded', { version: '1.0.1' }); await flush();
  response = 1;
  const install = check(true);
  await flush();
  assert.deepEqual(order, ['prepare'], 'The installer quit before asynchronous file cleanup');
  await check(true);
  assert.deepEqual(order, ['prepare'], 'Another update check bypassed pending shutdown');
  releaseShutdown(); await install;
  assert.deepEqual(order, ['prepare', 'cleaned', 'install']);
});

test('a failed asynchronous shutdown prevents installation and releases the prompt for retry', async () => {
  const updater: EventEmitter & UpdateService = new EventEmitter();
  let installed = 0, attempts = 0, response = 0;
  const failure = new Error('shutdown failed');
  updater.quitAndInstall = () => { installed++; };
  const check = startUpdates({
    app: { isPackaged: true, getVersion: () => '1.0.0' }, updater,
    dialog: { showMessageBox: async () => ({ response }) }, getWindow: () => ({}),
    beforeInstall: async () => { if (++attempts === 1) throw failure; }, platform: 'win32',
  });
  updater.emit('update-downloaded', { version: '1.0.1' }); await flush();
  response = 1;
  await assert.rejects(check(true), error => error === failure);
  assert.equal(installed, 0);
  await check(true);
  assert.equal(attempts, 2);
  assert.equal(installed, 1);
});

test('pesan kegagalan update membedakan internet, metadata, dan izin', () => {
  assert.match(updateFailureDetail({ code: 'ENOTFOUND' }), /internet/);
  assert.match(updateFailureDetail(new Error('HttpError: 404 Not Found')), /Metadata pembaruan/);
  assert.match(updateFailureDetail(new Error('403 Forbidden')), /Akses/);
  assert.doesNotMatch(updateFailureDetail(new Error('HttpError: 404 Not Found')), /Koneksi internet/);
  assert.match(updateFailureDetail({ code: 'ENOTFOUND' }, source => `Translated: ${source}`), /^Translated: /);
});


test('macOS Intel melaporkan paket yang belum tersedia, meski versi sama', async () => {
  const dialogs: MessageBoxOptions[] = [];
  let updaterCalls = 0;
  const updater: EventEmitter & UpdateService = new EventEmitter();
  updater.checkForUpdates = async () => { updaterCalls++; throw new Error('latest-mac.yml 404'); };
  const fetchRelease = async () => ({ ok: true, json: async () => ({ tag_name: 'v0.4.0', assets: [] }) });
  const check = startUpdates({
    app: { isPackaged: true, getVersion: () => '0.4.0' }, updater,
    dialog: { showMessageBox: async (_window, options) => { dialogs.push(options); return { response: 0 }; } },
    getWindow: () => ({}), beforeInstall: () => {}, platform: 'darwin', arch: 'x64', fetchRelease,
  });
  await check(true);
  assert.match(dialogs.at(-1)!.message, /Paket macOS Intel belum diterbitkan/);
  assert.equal(updaterCalls, 0);
});

test('macOS menyebut paket Intel yang belum terbit', async () => {
  const dialogs: MessageBoxOptions[] = [];
  const check = startUpdates({
    app: { isPackaged: true, getVersion: () => '0.4.0' }, updater: new EventEmitter(),
    dialog: { showMessageBox: async (_window, options) => { dialogs.push(options); return { response: 0 }; } },
    getWindow: () => ({}), beforeInstall: () => {}, platform: 'darwin', arch: 'x64',
    fetchRelease: async () => ({ ok: true, json: async () => ({ tag_name: 'v0.4.1', assets: [{ name: 'Lumilan-Chat-Setup-0.4.1.exe' }] }) }),
  });
  await check(true);
  assert.match(dialogs.at(-1)!.message, /Paket macOS Intel belum diterbitkan/);
});

test('macOS Intel mengenali DMG tanpa sufiks arsitektur', async () => {
  const dialogs: MessageBoxOptions[] = [];
  const check = startUpdates({
    app: { isPackaged: true, getVersion: () => '0.4.0' }, updater: new EventEmitter(),
    dialog: { showMessageBox: async (_window, options) => { dialogs.push(options); return { response: 0 }; } },
    getWindow: () => ({}), beforeInstall: () => {}, platform: 'darwin', arch: 'x64',
    fetchRelease: async () => ({ ok: true, json: async () => ({ tag_name: 'v0.4.1', assets: [{ name: 'Lumilan Chat-0.4.1.dmg' }] }) }),
  });
  await check(true);
  assert.equal(dialogs.at(-1)!.message, 'Lumilan Chat 0.4.1 tersedia.');
  assert.match(dialogs.at(-1)!.detail!, /Unduh dan pasang/);
});
