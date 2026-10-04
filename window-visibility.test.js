import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';

const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
const visibilitySource = main.slice(main.indexOf('function mainWindowVisible()'), main.indexOf('function updateBadge()'));

test('visibility query retains main sender, frame and URL validation', async () => {
  const frame = {}, mainUrl = 'lumilan://app/index.html';
  let url = mainUrl, invoke, calls = 0;
  const sender = { mainFrame: frame, getURL: () => url };
  const context = vm.createContext({
    window: { webContents: sender }, mainUrl,
    mainWindowVisible: () => { calls++; return true; },
    ipcMain: { handle: (channel, callback) => { assert.equal(channel, 'lumilan:window-visible'); invoke = callback; } },
  });
  const gate = main.slice(main.indexOf('function checkSender('), main.indexOf('if (instanceLock) app.whenReady()'));
  vm.runInContext(gate + "\nhandler('window-visible', mainWindowVisible);", context);
  assert.equal(await invoke({ sender, senderFrame: frame }), true);
  await assert.rejects(invoke({ sender: {}, senderFrame: frame }), /Permintaan ditolak/);
  await assert.rejects(invoke({ sender, senderFrame: {} }), /Permintaan ditolak/);
  url = 'https://invalid.example/';
  await assert.rejects(invoke({ sender, senderFrame: frame }), /Permintaan ditolak/);
  assert.equal(calls, 1);
});

test('native motion visibility excludes minimized/hidden/destroyed windows and publishes only a boolean', () => {
  const sent = [];
  const context = vm.createContext({ window: undefined });
  vm.runInContext(visibilitySource, context);
  assert.equal(context.mainWindowVisible(), false);
  context.publishWindowVisibility();
  for (const [visible, minimized, destroyed, contentsDestroyed] of [
    [true, false, false, false], [false, false, false, false],
    [true, true, false, false], [true, false, true, false],
    [true, false, false, true],
  ]) {
    context.window = {
      isVisible: () => visible, isMinimized: () => minimized, isDestroyed: () => destroyed,
      webContents: { isDestroyed: () => contentsDestroyed, send: (...args) => sent.push(args) },
    };
    assert.equal(context.mainWindowVisible(), visible && !minimized && !destroyed);
    const before = sent.length;
    context.publishWindowVisibility();
    if (destroyed || contentsDestroyed) assert.equal(sent.length, before);
    else assert.deepEqual(sent.at(-1), ['lumilan:window-visible', visible && !minimized]);
  }
});

test('sandbox preload visibility API strips the event, rejects non-booleans and unsubscribes', async () => {
  const calls = [], ipcRenderer = new EventEmitter();
  ipcRenderer.invoke = async (...args) => { calls.push(args); return false; };
  let bridge;
  const context = vm.createContext({ require: name => {
    assert.equal(name, 'electron');
    return { ipcRenderer, webUtils: {}, contextBridge: { exposeInMainWorld: (name, api) => { assert.equal(name, 'lumilan'); bridge = api; } } };
  } });
  vm.runInContext(readFileSync(new URL('./preload.cjs', import.meta.url), 'utf8'), context);
  assert.equal(await bridge.windowVisible(), false);
  assert.deepEqual(calls, [['lumilan:window-visible']]);
  const values = [];
  const unsubscribe = bridge.onWindowVisible((...args) => values.push(args));
  const event = { privileged: true };
  for (const value of [true, false, 'true', 1, null, { visible: true }]) ipcRenderer.emit('lumilan:window-visible', event, value);
  assert.deepEqual(values, [[true], [false]]);
  unsubscribe();
  ipcRenderer.emit('lumilan:window-visible', event, true);
  assert.equal(values.length, 2);
});
