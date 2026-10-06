import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import { isRecord } from './shared/model.js';

const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
const visibilitySource = main.slice(main.indexOf('function mainWindowVisible()'), main.indexOf('function updateBadge()'));

test('visibility query retains main sender, frame and URL validation', async () => {
  const frame = {}, mainUrl = 'lumilan://app/index.html';
  let url = mainUrl, calls = 0;
  type TestEvent = { sender: unknown; senderFrame: unknown };
  let invoke: (event: TestEvent) => Promise<boolean> = async () => assert.fail('Missing visibility handler');
  const sender = { mainFrame: frame, getURL: () => url };
  const context = vm.createContext({
    window: { webContents: sender }, mainUrl,
    mainWindowVisible: () => { calls++; return true; },
    ipcMain: { handle: (channel: string, callback: (event: TestEvent) => Promise<boolean>) => { assert.equal(channel, 'lumilan:window-visible'); invoke = callback; } },
  });
  const gate = main.slice(main.indexOf('function checkSender('), main.indexOf('if (instanceLock)'));
  vm.runInContext(gate + "\nhandler('window-visible', mainWindowVisible);", context);
  assert.equal(await invoke({ sender, senderFrame: frame }), true);
  await assert.rejects(invoke({ sender: {}, senderFrame: frame }), /Permintaan ditolak/);
  await assert.rejects(invoke({ sender, senderFrame: {} }), /Permintaan ditolak/);
  url = 'https://invalid.example/';
  await assert.rejects(invoke({ sender, senderFrame: frame }), /Permintaan ditolak/);
  assert.equal(calls, 1);
});

test('native motion visibility excludes minimized/hidden/destroyed windows and publishes only a boolean', () => {
  const sent: unknown[][] = [];
  interface VisibilityWindow {
    isVisible(): boolean; isMinimized(): boolean; isDestroyed(): boolean;
    webContents: { isDestroyed(): boolean; send(...args: unknown[]): void };
  }
  const environment = { window: undefined as VisibilityWindow | undefined };
  const context = vm.createContext(environment);
  vm.runInContext(visibilitySource, context);
  const visible: unknown = vm.runInContext('mainWindowVisible', context);
  const publish: unknown = vm.runInContext('publishWindowVisibility', context);
  assert.equal(typeof visible, 'function'); assert.equal(typeof publish, 'function');
  const mainWindowVisible = visible as () => boolean, publishWindowVisibility = publish as () => void;
  assert.equal(mainWindowVisible(), false);
  publishWindowVisibility();
  for (const [visible, minimized, destroyed, contentsDestroyed] of [
    [true, false, false, false], [false, false, false, false],
    [true, true, false, false], [true, false, true, false],
    [true, false, false, true],
  ] as const) {
    environment.window = {
      isVisible: () => visible, isMinimized: () => minimized, isDestroyed: () => destroyed,
      webContents: { isDestroyed: () => contentsDestroyed, send: (...args: unknown[]) => { sent.push(args); } },
    };
    assert.equal(mainWindowVisible(), visible && !minimized && !destroyed);
    const before = sent.length;
    publishWindowVisibility();
    if (destroyed || contentsDestroyed) assert.equal(sent.length, before);
    else assert.deepEqual(sent.at(-1), ['lumilan:window-visible', visible && !minimized]);
  }
});

test('sandbox preload visibility API strips the event, rejects non-booleans and unsubscribes', async () => {
  const calls: unknown[][] = [];
  const ipcRenderer = Object.assign(new EventEmitter(), { invoke: async (...args: unknown[]) => { calls.push(args); return false; } });
  interface VisibilityBridge { windowVisible(): Promise<boolean>; onWindowVisible(callback: (value: boolean) => void): () => void }
  const isVisibilityBridge = (value: unknown): value is VisibilityBridge =>
    isRecord(value) && typeof value.windowVisible === 'function' && typeof value.onWindowVisible === 'function';
  let bridge: VisibilityBridge | undefined;
  const context = vm.createContext({ exports: {}, require: (name: string) => {
    assert.equal(name, 'electron');
    return { ipcRenderer, webUtils: {}, contextBridge: { exposeInMainWorld: (name: string, api: unknown) => {
      assert.equal(name, 'lumilan');
      assert(isVisibilityBridge(api));
      bridge = api;
    } } };
  } });
  vm.runInContext(readFileSync(new URL('./preload.cjs', import.meta.url), 'utf8'), context);
  assert(bridge);
  assert.equal(await bridge.windowVisible(), false);
  assert.deepEqual(calls, [['lumilan:window-visible']]);
  const values: boolean[][] = [];
  const unsubscribe = bridge.onWindowVisible((...args) => values.push(args));
  const event = { privileged: true };
  for (const value of [true, false, 'true', 1, null, { visible: true }]) ipcRenderer.emit('lumilan:window-visible', event, value);
  assert.deepEqual(values, [[true], [false]]);
  unsubscribe();
  ipcRenderer.emit('lumilan:window-visible', event, true);
  assert.equal(values.length, 2);
});
