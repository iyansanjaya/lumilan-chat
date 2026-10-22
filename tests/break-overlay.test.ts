import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import type { BrowserWindowConstructorOptions, Rectangle } from 'electron';
import { BREAK_INPUT_GRACE, BreakOverlay } from '../src/main/break-overlay.js';
import type { NotchIpcEvent as BreakIpcEvent } from '../src/main/notch.js';
import type { BreakState } from '../src/shared/ipc.js';

const PAGE = 'lumilan://app/break.html';
const wayland = () => process.platform === 'linux' && process.env.XDG_SESSION_TYPE === 'wayland';

class TestContents extends EventEmitter {
  mainFrame = { url: PAGE };
  url = PAGE;
  last: BreakState | undefined;
  getURL() { return this.url; }
  send(_channel: string, value: BreakState) { this.last = value; }
  setWindowOpenHandler() {}
}
class Window extends EventEmitter {
  readonly webContents = new TestContents();
  shown: 'active' | 'inactive' | undefined;
  dead = false;
  level: string | undefined;
  bounds: Rectangle | undefined;
  loaded = false;
  constructor(readonly options: BrowserWindowConstructorOptions) { super(); }
  isDestroyed() { return this.dead; }
  destroy() { if (this.dead) return; this.dead = true; this.emit('closed'); }
  show() { this.shown = 'active'; }
  showInactive() { assert(!wayland(), 'Wayland cannot show a window without focus'); this.shown = 'inactive'; }
  setAlwaysOnTop(_value: boolean, level: string) { assert(!wayland(), 'Wayland has no window levels'); this.level = level; }
  setBounds(value: Rectangle) { assert(!wayland(), 'Wayland cannot place windows'); this.bounds = value; }
  loadURL() { this.loaded = true; return Promise.resolve(); }
  finish() { this.webContents.emit('did-finish-load'); }
}
class TestIpc {
  readonly handlers = new Map<string, (event: BreakIpcEvent) => unknown>();
  handle(name: string, fn: (event: BreakIpcEvent) => unknown) { this.handlers.set(name, fn); }
  removeHandler(name: string) { this.handlers.delete(name); }
  call(name: string, event: BreakIpcEvent) { const handler = this.handlers.get(name); assert(handler, name); return handler(event); }
}

function fixture() {
  const displays = [{ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }, { id: 2, bounds: { x: 1920, y: -200, width: 1600, height: 900 } }];
  const screen = Object.assign(new EventEmitter(), { getAllDisplays: () => displays, getDisplayNearestPoint: () => displays[1]!, getCursorScreenPoint: () => ({ x: 2000, y: 0 }) });
  const ipcMain = new TestIpc(), created: Window[] = [];
  const counts = { resumes: 0 };
  class Created extends Window { constructor(options: BrowserWindowConstructorOptions) { super(options); created.push(this); } }
  const overlay = new BreakOverlay<Window>({ BrowserWindow: Created, ipcMain, screen, preloadDir: '/app/preload', getLanguage: () => 'en',
    onResume: () => { counts.resumes++; } });
  const live = () => [...overlay.wins.values()];
  const event = (win: Window): BreakIpcEvent => ({ sender: win.webContents, senderFrame: win.webContents.mainFrame });
  return { overlay, screen, displays, ipcMain, created, counts, live, event };
}

function onPlatform(platform: NodeJS.Platform, session: string, run: () => void) {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform'), type = process.env.XDG_SESSION_TYPE;
  try { Object.defineProperty(process, 'platform', { ...descriptor, value: platform }); process.env.XDG_SESSION_TYPE = session; run(); }
  finally {
    Object.defineProperty(process, 'platform', descriptor!);
    if (type === undefined) delete process.env.XDG_SESSION_TYPE; else process.env.XDG_SESSION_TYPE = type;
  }
}

test('the overlay covers every display, focuses only the one under the pointer, and hiding closes all of it', () => onPlatform('win32', 'x11', () => {
  const f = fixture();
  f.overlay.show(Date.now() + 600_000);
  assert.equal(f.live().length, 2);
  for (const win of f.live()) win.finish();
  const [first, second] = f.live();
  assert.deepEqual([first!.shown, second!.shown], ['inactive', 'active'], 'Focus went to a display without the pointer');
  assert.deepEqual([first!.bounds, second!.bounds], [f.displays[0]!.bounds, f.displays[1]!.bounds], 'The overlay was not placed over the whole display before showing');
  for (const win of f.live()) {
    assert.equal(win.level, 'screen-saver');
    assert.equal(win.options.webPreferences?.preload, join('/app/preload', 'break-preload.cjs'));
    assert.deepEqual([win.options.frame, win.options.transparent, win.options.focusable, win.options.skipTaskbar, win.options.show, win.options.webPreferences?.sandbox,
      win.options.webPreferences?.contextIsolation, win.options.webPreferences?.nodeIntegration], [false, true, true, true, false, true, true, false]);
  }
  f.overlay.hide();
  assert.deepEqual(f.created.map(win => win.dead), [true, true]);
  assert.equal(f.live().length, 0);
  f.overlay.sync();
  assert.equal(f.created.length, 2, 'A display change reopened a hidden overlay');
}));

test('each platform gets the overlay it can show', () => {
  for (const [platform, session] of [['win32', 'x11'], ['darwin', ''], ['linux', 'x11'], ['linux', 'wayland']] as const) onPlatform(platform, session, () => {
    const f = fixture();
    f.overlay.show(Date.now() + 600_000);
    for (const win of f.live()) win.finish();
    const label = `${platform} ${session}`;
    if (platform === 'linux' && session === 'wayland') {
      assert.equal(f.live().length, 1, 'Wayland cannot place a window on each display');
      const [win] = f.live();
      assert.deepEqual([win!.options.fullscreen, win!.options.transparent, win!.options.backgroundColor, win!.options.x, win!.shown, win!.level],
        [true, false, '#0a0c10', undefined, 'active', undefined], label);
    } else {
      assert.equal(f.live().length, 2, label);
      for (const win of f.live()) assert.deepEqual([win.options.fullscreen, win.options.transparent, win.level], [undefined, true, 'screen-saver'], label);
    }
    const mac = f.live()[0]!.options;
    assert.deepEqual([mac.type, mac.enableLargerThanScreen, mac.vibrancy], platform === 'darwin' ? ['panel', true, 'fullscreen-ui'] : [undefined, undefined, undefined], label);
    f.overlay.dispose();
  });
});

test('displays added, removed or rescaled during a break follow, and one failed renderer leaves the rest running', () => onPlatform('win32', 'x11', () => {
  const f = fixture();
  f.overlay.show(Date.now() + 600_000);
  const [first, second] = f.live();
  f.displays.push({ id: 3, bounds: { x: -1280, y: 0, width: 1280, height: 1024 } });
  f.screen.emit('display-added');
  assert.equal(f.live().length, 3);
  assert.equal(f.live()[0], first, 'An existing window was replaced');
  f.displays.splice(0, 1);
  f.screen.emit('display-removed');
  assert.deepEqual([first!.dead, second!.dead, f.live().length], [true, false, 2]);
  f.displays[0]!.bounds = { x: 1920, y: 0, width: 2560, height: 1440 };
  f.screen.emit('display-metrics-changed');
  assert.deepEqual(second!.bounds, f.displays[0]!.bounds, 'A rescaled display kept the old bounds');
  assert.equal(second!.webContents.last?.until, f.overlay.until, 'The deadline was not republished');
  second!.webContents.emit('did-fail-load', {}, -3);
  assert.equal(second!.dead, false, 'An aborted load closed the window');
  second!.webContents.emit('render-process-gone');
  assert.deepEqual([second!.dead, f.live().length, f.overlay.until > 0], [true, 1, true], 'A failed renderer ended the break or closed another window');
  f.live()[0]!.destroy();
  assert.equal(f.live().length, 0, 'A closed window stayed listed');
  f.overlay.dispose();
}));

test('only the overlay page may ask, and input inside the grace period does not end the break', t => onPlatform('win32', 'x11', () => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const f = fixture();
  const until = Date.now() + 600_000;
  f.overlay.show(until);
  const [win, other] = f.live();
  assert.deepEqual(f.ipcMain.call('break:state', f.event(win!)), { until, grace: BREAK_INPUT_GRACE, language: 'en' });
  const foreign = new Window({}); foreign.webContents.mainFrame = { url: 'lumilan://app/notch.html' };
  for (const event of [f.event(foreign), { sender: win!.webContents, senderFrame: null }, { sender: win!.webContents, senderFrame: { url: PAGE } },
    { sender: {}, senderFrame: win!.webContents.mainFrame }])
    for (const channel of ['break:state', 'break:resume']) assert.throws(() => f.ipcMain.call(channel, event), /ditolak/, `${channel} ${JSON.stringify(event.senderFrame)}`);
  other!.webContents.url = 'https://example.com/';
  assert.throws(() => f.ipcMain.call('break:resume', f.event(other!)), /ditolak/, 'A navigated page ended the break');
  t.mock.timers.tick(1000);
  assert.equal(f.ipcMain.call('break:resume', f.event(win!)), false);
  assert.equal(f.counts.resumes, 0, 'A key in flight ended the break');
  assert.equal((f.ipcMain.call('break:state', f.event(win!)) as BreakState).grace, BREAK_INPUT_GRACE - 1000);
  // A repeat of the same break keeps its grace and windows.
  f.overlay.show(until + 1000);
  assert.deepEqual([f.created.length, (f.ipcMain.call('break:state', f.event(win!)) as BreakState).grace], [2, BREAK_INPUT_GRACE - 1000]);
  t.mock.timers.tick(BREAK_INPUT_GRACE);
  assert.equal(f.ipcMain.call('break:resume', f.event(win!)), true);
  assert.equal(f.counts.resumes, 1);
  f.overlay.hide();
  assert.throws(() => f.ipcMain.call('break:resume', f.event(win!)), /ditolak/, 'A closed overlay still answered');
  f.overlay.dispose();
  assert.deepEqual([...f.ipcMain.handlers.keys()], []);
}));

test('the break preload exposes only state, resume and a state listener that never sees the IPC event', async () => {
  interface Bridge { state(): Promise<unknown>; resume(): Promise<unknown>; onState(callback: (value: unknown) => void): () => void }
  let bridge: Bridge | undefined, name = '';
  const calls: unknown[][] = [];
  const ipcRenderer = Object.assign(new EventEmitter(), { invoke: async (...args: unknown[]) => { calls.push(args); return true; } });
  const context = vm.createContext({ require: () => ({ ipcRenderer, contextBridge: { exposeInMainWorld: (key: string, api: Bridge) => { name = key; bridge = api; } } }) });
  vm.runInContext(readFileSync(new URL('../src/preload/break-preload.cjs', import.meta.url), 'utf8'), context);
  assert(bridge);
  assert.equal(name, 'lumiBreak');
  assert(Object.isFrozen(bridge));
  assert.deepEqual(Object.keys(bridge), ['state', 'resume', 'onState']);
  await bridge.state(); await bridge.resume();
  assert.deepEqual(calls, [['break:state'], ['break:resume']]);
  const seen: unknown[] = [];
  const off = bridge.onState(value => seen.push(value));
  ipcRenderer.emit('break:state', { sender: 'secret' }, { until: 1, grace: 0, language: 'id' });
  off();
  ipcRenderer.emit('break:state', {}, { until: 2, grace: 0, language: 'id' });
  assert.deepEqual(seen, [{ until: 1, grace: 0, language: 'id' }]);
});
