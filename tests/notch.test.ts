import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { LumiNotch, notchBounds } from '../src/main/notch.js';
import type { NotchIpcEvent, NotchPeer, NotchReminder } from '../src/main/notch.js';
import type { BrowserWindowConstructorOptions, Rectangle } from 'electron';
import type { BreakView, NotchSettings, NotchSnapshot, RoutineView, ShelfDropResult, ShelfView, TasksView } from '../src/shared/notch.js';
import { FocusTimer, type FocusEnd } from '../src/main/focus.js';
import type { Status } from '../src/shared/model.js';

class TestContents extends EventEmitter {
  mainFrame = { url: 'lumilan://app/notch.html' };
  constructor(private readonly owner: Window) { super(); }
  getURL() { return 'lumilan://app/notch.html'; }
  send(_channel: string, value: NotchSnapshot) { this.owner.last = value; }
  setWindowOpenHandler(fn: (details: { url: string }) => { action: 'deny' }) { this.owner.open = fn; }
}
class Window extends EventEmitter {
  readonly webContents: TestContents;
  visible = false;
  dead = false;
  focusable: boolean;
  focused = false;
  ignored = false;
  bounds: Rectangle = { x: 0, y: 0, width: 0, height: 0 };
  shape: Rectangle[] | undefined;
  level: string | undefined;
  last: NotchSnapshot | undefined;
  open: (details: { url: string }) => { action: 'deny' } = () => ({ action: 'deny' });
  constructor(readonly options: BrowserWindowConstructorOptions) {
    super(); this.focusable = options.focusable ?? false; this.webContents = new TestContents(this);
  }
  isDestroyed() { return this.dead; }
  isMinimized() { return false; }
  setAlwaysOnTop(_value: boolean, level: string) { this.level = level; }
  setShape(rects: Rectangle[]) {
    assert.notEqual(process.platform, 'darwin', 'Electron setShape is only available on Windows/Linux');
    this.shape = rects;
  }
  // Electron on Windows also deactivates a visible window, handing the foreground to the window below it.
  deactivations = 0;
  setFocusable(value: boolean) {
    assert.notEqual(process.platform, 'linux', 'Electron setFocusable is only available on Windows/macOS');
    this.focusable = value;
    if (process.platform === 'win32' && this.visible) { this.deactivations++; if (this.focused) { this.focused = false; this.emit('blur'); } }
  }
  isFocusable() { return this.focusable; }
  setIgnoreMouseEvents(value: boolean) { this.ignored = value; }
  setBounds(value: Rectangle) { this.bounds = value; } isVisible() { return this.visible; }
  showInactive() { this.visible = true; } hide() { this.visible = false; this.focused = false; this.emit('blur'); } destroy() { this.dead = true; }
  focus() { if (this.focusable) this.focused = true; } isFocused() { return this.focused; } loadURL() { return Promise.resolve(); }
}
class TestIpc extends EventEmitter {
  readonly handlers = new Map<string, (event: NotchIpcEvent, packet: unknown) => unknown>();
  handle(name: string, fn: (event: NotchIpcEvent, packet: unknown) => unknown) { this.handlers.set(name, fn); }
  removeHandler(name: string) { this.handlers.delete(name); }
  state(event: NotchIpcEvent) {
    const handler = this.handlers.get('lumi:state'); assert(handler);
    const value = handler(event, undefined);
    assert(value && typeof value === 'object' && 'count' in value);
    return value;
  }
}
function windowOf(notch: LumiNotch<Window>) { assert(notch.win); return notch.win; }
function selectedSnapshot(notch: LumiNotch<Window>) { const item = notch.snapshot().selected; assert(item); return item; }
function selectedItem(notch: LumiNotch<Window>) { const item = notch.selected(); assert(item); return item; }
function itemOf(notch: LumiNotch<Window>, key: string) { const item = notch.items.get(key); assert(item); return item; }


function pointer(notch: LumiNotch<Window>, inside: boolean) {
  notch.ipcMain.emit('lumi:pointer', { sender: windowOf(notch).webContents, senderFrame: windowOf(notch).webContents.mainFrame }, inside);
}

function fixture(pages: ConstructorParameters<typeof LumiNotch>[0]['pages'] = undefined, addToShelf?: (paths: string[]) => Promise<ShelfDropResult>) {
  const display = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 }, bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
  const screen = Object.assign(new EventEmitter(), { getPrimaryDisplay: () => display, getAllDisplays: () => [display], getDisplayNearestPoint: () => display, getCursorScreenPoint: () => ({ x: 500, y: 0 }) });
  const ipcMain = new TestIpc();
  const main = { visible: false, minimized: false, focused: false, fullScreen: false, isDestroyed: () => false, isVisible: () => main.visible,
    isMinimized: () => main.minimized, isFocused: () => main.focused, isFullScreen: () => main.fullScreen };
  // The person watches the main window only while it is visible, focused and recently used.
  const watch = (value: boolean) => { main.visible = main.focused = value; };
  const clock = { idle: 0, getSystemIdleTime: () => clock.idle };
  const settings: NotchSettings = { notch: true, enabled: true, preview: false, silent: true, language: 'id', focus: 0, notchIdle: 'always', notchOpen: 'click', notchOpened: true };
  const peer: NotchPeer & { state: { status: Status; mutedThreads: string[]; reminders: NotchReminder[] } } = { state: { status: 'active', mutedThreads: [], reminders: [] }, trusted: new Map([['alice', { name: 'Alice' }]]), sendCall: async () => { peer.activeCall = null; } };
  const decisions: Array<[string, boolean]> = [], opens: Array<string | undefined> = [], accepts: string[] = [], pending = new Set(['f1']), ends: FocusEnd[] = [], firstOpens: number[] = [];
  // Wired like main: a status change reaches Lumi through the peer change event.
  const focus = new FocusTimer({ read: () => undefined, write: () => {}, getStatus: () => peer.state.status,
    setStatus: status => { peer.state.status = status; notch.prune(); }, onChange: () => notch.sync(), onEnd: end => ends.push(end) });
  const notch = new LumiNotch({ BrowserWindow: Window, ipcMain, screen, powerMonitor: new EventEmitter(), idleClock: clock, preloadDir: '.', getMain: () => main,
    getSettings: () => settings, getPeer: () => peer, reveal: thread => opens.push(thread), acceptCall: id => accepts.push(id),
    decideFile: async (id, value) => { if (!pending.delete(id)) throw new Error('expired'); decisions.push([id, value]); },
    savePosition: value => { settings.notchPosition = value; }, getFocus: () => focus.view(),
    focusAction: (type, minutes) => type === 'enable' ? settings.focus ||= 25 : type === 'start' ? focus.start(minutes) : type === 'pause' ? focus.pause() : type === 'resume' ? focus.resume() : focus.end(), ...(pages ? { pages } : {}), ...(addToShelf ? { addToShelf } : {}),
    onOpened: () => { settings.notchOpened = true; firstOpens.push(Date.now()); } });
  notch.sync(); notch.ready = true;
  return { notch, settings, peer, main, watch, clock, ipcMain, decisions, opens, accepts, pending, focus, ends, firstOpens };
}

test('Lumi bounds remain inside small, negative-coordinate and scaled display work areas', () => {
  for (const area of [{ x: -1600, y: 25, width: 1600, height: 900 }, { x: 0, y: 40, width: 320, height: 260 }]) {
    for (const fraction of [NaN, -500, 0, .5, 1, 500]) {
      const b = notchBounds({ workArea: area }, fraction);
      assert(b.x >= area.x && b.x + b.width <= area.x + area.width);
      assert(b.y >= area.y && b.y + b.height <= area.y + area.height);
      assert(b.width <= 680 && b.height <= 280 && b.inset === 0);
    }
  }
});

test('Lumi covers a macOS camera notch only beside a notch-height menu bar', () => {
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  try {
    // 37 pt: MacBook menu bar beside a camera notch. 25 pt: an ordinary Mac or external display menu bar.
    for (const [platform, top, inset] of [['darwin', 37, 37], ['darwin', 25, 0], ['win32', 37, 0], ['linux', 37, 0]] as const) {
      Object.defineProperty(process, 'platform', { ...platformDescriptor, value: platform });
      const screen = { x: 1512, y: -200, width: 1512, height: 982 };
      const b = notchBounds({ workArea: { ...screen, y: screen.y + top, height: screen.height - top }, bounds: screen });
      assert.equal(b.inset, inset, `${platform} ${top}`);
      assert.equal(b.y, inset ? screen.y : screen.y + top, 'The island must start at the screen edge only over a notch');
      assert.deepEqual([b.x, b.width, b.height], [screen.x + 416, 680, 280]);
      assert(b.y + b.height <= screen.y + screen.height);
    }
  } finally { Object.defineProperty(process, 'platform', platformDescriptor!); }
});

test('Lumi reminders redact queued content, obey mute, remove answered requests, and never grant consent',async()=>{
  const {notch,settings,peer,opens}=fixture();
  try{
    const request={id:'r1',kind:'incoming',from:'alice',status:'pending',title:'Private reminder',dueAt:Date.now()};peer.state.reminders=[request];
    notch.reminder({type:'request',items:[request]});assert(!JSON.stringify(notch.snapshot()).includes('Private reminder'));
    assert.equal(selectedSnapshot(notch).actionable,false);await assert.rejects(notch.action({type:'accept',key:'reminder:r1'}));
    settings.preview=true;notch.sync();assert.equal(selectedSnapshot(notch).body,'Private reminder');
    await notch.action({type:'open',key:'reminder:r1'});assert.deepEqual(opens,['reminders']);assert.equal(request.status,'pending');
    notch.reminder({type:'request',items:[request]});peer.state.mutedThreads=['alice'];notch.prune();assert.equal(notch.items.size,0);
    peer.state.mutedThreads=[];notch.reminder({type:'request',items:[request]});request.status='scheduled';notch.prune();assert.equal(notch.items.size,0);
    request.status='due';const local={id:'r2',kind:'local',status:'due',title:'Local'};peer.state.reminders.push(local);
    notch.reminder({type:'due',items:[request]});notch.reminder({type:'due',items:[local]});assert.equal(selectedSnapshot(notch).count,2);
    peer.state.mutedThreads=['alice'];notch.prune();assert.equal(selectedSnapshot(notch).count,1);assert.equal(selectedSnapshot(notch).body,'Local');
    local.status='done';notch.prune();assert.equal(notch.items.size,0);
  }finally{notch.dispose();}
});

test('Lumi IPC rejects foreign windows, frames, URLs and arbitrary actions', async () => {
  const { notch, ipcMain } = fixture();
  try {
    const event = { sender: windowOf(notch).webContents, senderFrame: windowOf(notch).webContents.mainFrame };
    assert.equal(ipcMain.state(event).count, 0);
    for (const invalid of [{ ...event, sender: {} }, { ...event, senderFrame: null }, { ...event, senderFrame: { url: 'lumilan://app/notch.html' } }]) {
      assert.throws(() => ipcMain.state(invalid), /ditolak/);
      assert.doesNotThrow(() => ipcMain.emit('lumi:pointer', invalid, false));
    }
    for (const action of [null, { type: 'accept', key: 'file:missing' }, { type: 'open', path: 'C:/secret' }, { type: 'eval' }, { type: 'move', delta: Infinity }])
      await assert.rejects(notch.action(action));
    assert.equal(windowOf(notch).options.webPreferences!.sandbox, true);
    assert.equal(windowOf(notch).options.webPreferences!.nodeIntegration, false);
    assert.equal(windowOf(notch).open({ url: 'https://example.com' }).action, 'deny');
  } finally { notch.dispose(); }
});

test('Lumi redacts queued content immediately and obeys DND, mute, visibility and notification settings', async () => {
  const { notch, settings, peer, watch } = fixture();
  settings.notchIdle = 'away';
  try {
    notch.message({}, 'alice', 'Alice', '<img src=x onerror=alert(1)> secret');
    assert.equal(notch.mode, 'compact', 'Ordinary messages must not automatically cover the desktop with a full card');
    assert(!JSON.stringify(notch.snapshot()).includes('secret'));
    settings.preview = true; assert(selectedSnapshot(notch).body.includes('secret'));
    settings.preview = false; assert(!JSON.stringify(notch.snapshot()).includes('Alice'));
    await notch.action({ type: 'expand' }); assert.equal(windowOf(notch).focusable, true);
    watch(true); assert.equal(notch.sync(), false); assert.equal(windowOf(notch).visible, false);
    assert.equal(windowOf(notch).focusable, process.platform === 'linux');
    assert.equal(windowOf(notch).isFocused(), false, 'A later automatic notification could still take native focus');
    watch(false); peer.state.status = 'dnd'; assert.equal(notch.sync(), false);
    peer.state.status = 'active'; settings.enabled = false; assert.equal(notch.sync(), false);
    settings.enabled = true; settings.notch = false; assert.equal(notch.sync(), false);
    assert.equal(windowOf(notch).isDestroyed(), true, 'Disabling Lumi kept its renderer process allocated');
    settings.notch = true; peer.state.mutedThreads = ['alice']; notch.prune(); assert.equal(notch.items.size, 0);
    assert.equal(notch.file({ id: 'muted', thread: 'alice', fromName: 'Alice', name: 'Private.zip', size: 100 }), false);
    assert.equal(notch.items.size, 0, 'Muted consent was published by the companion');
    assert.equal(notch.timers.size, 0, 'Idle must not poll or animate with an interval');
  } finally { notch.dispose(); }
});

test('Lumi covers a visible main window behind other windows without taking focus and withdraws once it is watched', () => {
  const { notch, main, watch, settings } = fixture();
  settings.notchIdle = 'away';
  try {
    watch(true); notch.sync();
    assert.equal(notch.message({}, 'alice', 'Alice', 'While reading'), false, 'Lumi interrupted a main window being watched');
    main.focused = false; // Alt-Tab to another application leaves the main window visible.
    assert.equal(notch.message({}, 'alice', 'Alice', 'Behind another window'), true, 'A visible but unfocused main window hid the arrival');
    assert.equal(notch.mode, 'compact');
    assert.equal(windowOf(notch).visible, true);
    assert.equal(windowOf(notch).isFocused(), false, 'An automatic preview took native focus from the other application');
    notch.collapse();
    assert.equal(windowOf(notch).visible, false, 'An idle strip appeared over a main window that is only behind other windows');
    assert.equal(notch.timers.size, 0);
    main.visible = false; notch.sync(); // Closed to the tray: the strip leads back to the queue.
    assert.equal(windowOf(notch).visible, true); assert.deepEqual([windowOf(notch).bounds.width, windowOf(notch).bounds.height], [680, 280]);
    main.visible = true; notch.sync();
    assert.equal(windowOf(notch).visible, false, 'Restoring the main window behind others kept the idle strip');
    notch.message({}, 'alice', 'Alice', 'Second arrival behind another window');
    assert.equal(windowOf(notch).visible, true, 'A later arrival did not reuse the warm renderer');
    main.focused = true; assert.equal(notch.sync(), false);
    assert.equal(windowOf(notch).visible, false, 'Lumi stayed over the main window after it was focused again');
    assert.equal(itemOf(notch, 'message:alice').count, 3, 'Focusing the main window discarded queued activity');
    main.minimized = true; main.focused = false;
    assert.equal(notch.message({}, 'alice', 'Alice', 'Minimized'), true);
  } finally { notch.dispose(); }
});

test('Lumi covers a focused main window only after the person has been away for three minutes', () => {
  const { notch, watch, clock, settings } = fixture();
  settings.notchIdle = 'away';
  try {
    watch(true);
    clock.idle = 179; assert.equal(notch.message({}, 'alice', 'Alice', 'Still here'), false);
    clock.idle = 180; assert.equal(notch.message({}, 'alice', 'Alice', 'Away'), true, 'An unattended focused window hid the arrival');
    assert.equal(windowOf(notch).isFocused(), false, 'Lumi took focus from the unattended main window');
    clock.idle = 0; assert.equal(notch.sync(), false, 'Lumi stayed after the person returned');
    assert.equal(windowOf(notch).visible, false);
    for (const reading of [() => Number.NaN, () => Infinity, () => -1, () => { throw new Error('idle service unavailable'); }]) {
      clock.getSystemIdleTime = reading;
      assert.equal(notch.sync(), false, 'An invalid idle source must fall back to focus alone');
    }
  } finally { notch.dispose(); }
});

test('Lumi prioritizes consent, rechecks expired IDs, prevents double consent and keeps progress monotonic', async () => {
  const { notch, settings, pending, decisions, peer, accepts } = fixture(); settings.preview = true;
  try {
    notch.file({ id: 'f1', fromName: 'Alice', name: 'Test.zip', size: 100, thread: 'alice' });
    await notch.action({ type: 'collapse', revision: notch.revision - 1 }); assert.equal(notch.mode, 'expanded', 'A delayed mouse leave collapsed a newer panel');
    await notch.action({ type: 'peek' }); assert.equal(notch.mode, 'expanded', 'A stale hover must not collapse a new consent card');
    notch.pointerInside = true;
    notch.ipcMain.emit('lumi:pointer', { sender: windowOf(notch).webContents, senderFrame: windowOf(notch).webContents.mainFrame }, false);
    // The fixed window is larger than the panel: outside the island it must pass clicks to the desktop below.
    assert.equal(windowOf(notch).ignored, process.platform !== 'linux', 'The transparent area beside the expanded panel intercepted clicks');
    await notch.action({ type: 'collapse' }); assert.equal(windowOf(notch).ignored, process.platform !== 'linux');
    await notch.action({ type: 'expand' }); assert.equal(windowOf(notch).ignored, false);
    for (let i = 0; i < 100; i++) notch.message({}, `thread-${i}`, 'Sender', 'Message');
    assert.equal(selectedItem(notch).id, 'f1'); assert.equal(notch.items.size, 65);
    await notch.action({ type: 'accept', key: 'file:f1' });
    assert.deepEqual(decisions, [['f1', true]]);
    await assert.rejects(notch.action({ type: 'accept', key: 'file:f1' }));
    notch.transfer({ id: 'f1', status: 'receiving', received: 80, total: 100 });
    notch.transfer({ id: 'f1', status: 'receiving', received: 30, total: 100 });
    assert.equal(itemOf(notch, 'file:f1').progress, 80);
    notch.file({ id: 'f2', fromName: 'Alice', name: 'Other.zip', size: 100, thread: 'alice' });
    await assert.rejects(notch.action({ type: 'accept', key: 'file:f2' }), /expired/);
    pending.add('f2'); await notch.action({ type: 'decline', key: 'file:f2' }); assert(!notch.items.has('file:f2'));
    peer.activeCall = { id: 'call1', peerId: 'alice', phase: 'incoming' };
    notch.call({ type: 'offer', id: 'call1', peerId: 'alice', sdp: 'PRIVATE SDP' });
    notch.callPhase(null); assert(notch.items.has('call:call1'), 'A stale renderer update removed the current incoming call');
    assert(!JSON.stringify(notch.snapshot()).includes('PRIVATE SDP'));
    await notch.action({ type: 'select', key: 'file:f1' }); assert.equal(selectedItem(notch).id, 'f1');
    await notch.action({ type: 'select', key: 'call:call1' });
    await notch.action({ type: 'accept', key: 'call:call1' }); assert.deepEqual(accepts, ['call1']);
    await assert.rejects(notch.action({ type: 'accept', key: 'call:call1' }));
    peer.activeCall = null; notch.call({ type: 'end', id: 'call1' });
    await assert.rejects(notch.action({ type: 'decline', key: 'call:call1' }));
    notch.transfer({ id: 'f1', status: 'complete' }); assert(!notch.items.has('file:f1'));
  } finally { notch.dispose(); }
});

test('Lumi never revives canceled consent after an asynchronous decision or accepts an ended call', async () => {
  const { notch, peer, accepts } = fixture();
  try {
    let releaseDecision: (value: boolean) => void = () => { throw new Error('decision not pending'); };
    notch.decideFile = () => new Promise<boolean>(resolve => { releaseDecision = resolve; });
    notch.file({ id: 'race', fromName: 'Alice', name: 'Test.zip', size: 100, thread: 'alice' });
    const accepting = notch.action({ type: 'accept', key: 'file:race' });
    notch.transfer({ id: 'race', status: 'canceled' });
    releaseDecision(true);
    await accepting;
    assert(!notch.snapshot().items.some(item => item.key === 'file:race'), 'A late acceptance revived the canceled transfer');
    await assert.rejects(notch.action({ type: 'decline', key: 'file:race' }));

    peer.activeCall = { id: 'old-call', peerId: 'alice', phase: 'incoming' };
    notch.call({ type: 'offer', id: 'old-call', peerId: 'alice' });
    peer.activeCall = null; // The authoritative state changed before its UI event arrived.
    await assert.rejects(notch.action({ type: 'accept', key: 'call:old-call' }));
    assert.deepEqual(accepts, []);
    peer.activeCall = { id: 'new-call', peerId: 'alice', phase: 'incoming' };
    notch.call({ type: 'offer', id: 'new-call', peerId: 'alice' });
    notch.call({ type: 'end', id: 'old-call' });
    await notch.action({ type: 'accept', key: 'call:new-call' });
    assert.deepEqual(accepts, ['new-call'], 'An old cancellation affected the new call');
  } finally { notch.dispose(); }
});

function fail(notch: LumiNotch<Window>) {
  // Electron reports one failed load twice (did-fail-load and the loadURL rejection); a crash may follow.
  const contents = windowOf(notch).webContents;
  contents.emit('did-fail-load', {}, -312); contents.emit('render-process-gone');
}
const aliceFile = { id: 'f1', fromName: 'Alice', name: 'Test.zip', size: 100, thread: 'alice' };

test('Lumi failure hands pending consent to the main window once and keeps later requests on the main path', () => {
  const { notch, opens } = fixture();
  try {
    notch.file(aliceFile); notch.message({}, 'bob', 'Bob', 'Newer ordinary message');
    fail(notch);
    assert.deepEqual(opens, ['alice'], 'The failure did not open the pending request exactly once');
    assert.equal(notch.supported, false); assert(windowOf(notch).isDestroyed()); assert.equal(notch.mode, 'hidden');
    assert.equal(notch.file({ ...aliceFile, id: 'f2', thread: 'bob' }), false, 'A failed Lumi still claimed a new request');
    notch.sync(); assert.deepEqual(opens, ['alice'], 'The failure handoff repeated');
    assert.equal(notch.timers.size, 0, 'A failed Lumi kept an idle timer');
  } finally { notch.dispose(); }
});

test('Lumi failure defers its handoff until Do not disturb, lock, suspend, pause and disabled notifications end', async t => {
  type Fixture = ReturnType<typeof fixture>;
  const blocks: Array<[string, (f: Fixture) => void | Promise<unknown>, (f: Fixture) => void]> = [
    ['Do not disturb', f => { f.peer.state.status = 'dnd'; f.notch.sync(); }, f => { f.peer.state.status = 'active'; f.notch.prune(); }],
    ['lock then suspend', f => { f.notch.powerMonitor.emit('lock-screen'); f.notch.powerMonitor.emit('suspend'); }, f => {
      f.notch.powerMonitor.emit('resume'); assert.deepEqual(f.opens, [], 'Resume revealed the app before screen unlock');
      f.notch.powerMonitor.emit('unlock-screen');
    }],
    ['suspend then lock', f => { f.notch.powerMonitor.emit('suspend'); f.notch.powerMonitor.emit('lock-screen'); }, f => {
      f.notch.powerMonitor.emit('unlock-screen'); assert.deepEqual(f.opens, [], 'Unlock revealed the app before resume');
      f.notch.powerMonitor.emit('resume');
    }],
    ['pause', f => f.notch.action({ type: 'pause' }), f => { f.notch.pausedUntil = 0; f.notch.sync(); }],
    ['notifications disabled', f => { f.settings.enabled = false; f.notch.sync(); }, f => { f.settings.enabled = true; f.notch.sync(); }],
  ];
  for (const [name, block, unblock] of blocks) await t.test(name, async () => {
    const f = fixture();
    try {
      await block(f);
      assert.equal(f.notch.file(aliceFile), false);
      fail(f.notch);
      f.notch.sync(); f.notch.message({}, 'bob', 'Bob', 'Background message');
      assert.deepEqual(f.opens, [], `A failed Lumi revealed the app during ${name}`);
      unblock(f);
      assert.deepEqual(f.opens, ['alice'], `The pending request was not handed over after ${name}`);
      f.notch.sync(); assert.deepEqual(f.opens, ['alice'], 'The deferred handoff repeated');
    } finally { f.notch.dispose(); }
  });
});

test('Lumi failure handoff rechecks consent, calls, mute state and an already presented main window', async t => {
  await t.test('consent answered elsewhere during the block', () => {
    const { notch, peer, opens } = fixture();
    try {
      peer.state.status = 'dnd'; notch.sync(); notch.file(aliceFile); fail(notch);
      notch.transfer({ id: 'f1', status: 'receiving' });
      peer.state.status = 'active'; notch.prune();
      assert.deepEqual(opens, [], 'An answered request reopened the app');
    } finally { notch.dispose(); }
  });
  await t.test('thread muted during the block', () => {
    const { notch, peer, opens } = fixture();
    try {
      peer.state.status = 'dnd'; notch.sync(); notch.file(aliceFile); fail(notch);
      peer.state.mutedThreads = ['alice']; notch.prune();
      peer.state.status = 'active'; notch.prune();
      assert.deepEqual(opens, [], 'A muted request reopened the app');
    } finally { notch.dispose(); }
  });
  await t.test('main window already presented', () => {
    const { notch, peer, watch, opens } = fixture();
    try {
      peer.state.status = 'dnd'; notch.sync(); notch.file(aliceFile); fail(notch);
      watch(true); notch.sync();
      peer.state.status = 'active'; watch(false); notch.prune();
      assert.deepEqual(opens, [], 'Hiding the presented main window brought it back');
    } finally { notch.dispose(); }
  });
  await t.test('visible main window behind another window', () => {
    const { notch, main, opens } = fixture();
    try {
      main.visible = true;
      assert.equal(notch.file(aliceFile), true, 'Lumi ignored consent while the main window was not being watched');
      fail(notch);
      assert.deepEqual(opens, ['alice'], 'A visible but unwatched main window silently swallowed the pending request');
    } finally { notch.dispose(); }
  });
  await t.test('focused main window left unattended', () => {
    const { notch, watch, clock, opens } = fixture();
    try {
      watch(true); clock.idle = 600;
      assert.equal(notch.file(aliceFile), true);
      fail(notch);
      assert.deepEqual(opens, ['alice'], 'An unattended focused window ended the handoff without showing the request');
    } finally { notch.dispose(); }
  });
  await t.test('incoming call outranks a file; an ended call is ignored', () => {
    const { notch, peer, opens } = fixture();
    try {
      peer.activeCall = { id: 'call1', peerId: 'alice', phase: 'incoming' };
      notch.file({ ...aliceFile, thread: 'bob' }); notch.call({ type: 'offer', id: 'call1', peerId: 'alice' });
      fail(notch);
      assert.deepEqual(opens, ['alice'], 'The active call was not preferred');
    } finally { notch.dispose(); }
    const stale = fixture();
    try {
      stale.peer.activeCall = null; stale.notch.call({ type: 'offer', id: 'old-call', peerId: 'alice' });
      fail(stale.notch);
      assert.deepEqual(stale.opens, [], 'An ended call reopened the app');
    } finally { stale.notch.dispose(); }
  });
});

test('Lumi pause survives background updates, screen lock suspends it, and shutdown removes every listener/timer', async () => {
  const { notch, settings } = fixture();
  await notch.action({ type: 'move', delta: 200 }); assert(settings.notchPosition!.fraction > .5);
  await notch.action({ type: 'reset' }); assert.equal(settings.notchPosition!.fraction, .5);
  await notch.action({ type: 'pause' }); notch.sync(); assert(notch.pauseTimer);
  notch.pausedUntil = 0; notch.powerMonitor.emit('lock-screen'); assert.equal(notch.eligible(), false);
  notch.powerMonitor.emit('unlock-screen'); assert.equal(notch.eligible(), true);
  notch.powerMonitor.emit('lock-screen'); notch.powerMonitor.emit('suspend');
  notch.powerMonitor.emit('resume'); assert.equal(notch.eligible(), false, 'Resume exposed Lumi before screen unlock');
  notch.powerMonitor.emit('unlock-screen'); assert.equal(notch.eligible(), true);
  notch.powerMonitor.emit('suspend'); notch.powerMonitor.emit('lock-screen');
  notch.powerMonitor.emit('unlock-screen'); assert.equal(notch.eligible(), false, 'Unlock exposed Lumi before resume');
  notch.powerMonitor.emit('resume'); assert.equal(notch.eligible(), true);
  notch.dispose(); assert.equal(notch.timers.size, 0); assert.equal(notch.screen.listenerCount('display-removed'), 0);
  assert.equal(notch.powerMonitor.listenerCount('lock-screen'), 0); assert(windowOf(notch).isDestroyed());
});

test('Lumi automatically hides manual and automatic previews without deleting pending activity', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { notch, settings, decisions } = fixture();
  try {
    notch.sync(); // The idle pill is on screen before the pointer reaches it.
    // Hovering an empty pill opens nothing: a glance would only repeat its clock. Its CSS shows the Open hint instead.
    pointer(notch, true); await notch.action({ type: 'peek' });
    assert.equal(notch.mode, 'hidden', 'Hovering an empty pill opened a card');
    pointer(notch, false);
    notch.message({}, 'carol', 'Carol', 'Queued'); t.mock.timers.tick(4000); assert.equal(notch.mode, 'hidden');
    pointer(notch, true); await notch.action({ type: 'peek' });
    t.mock.timers.tick(10_000); assert.equal(notch.mode, 'compact', 'A hover peek closed under the pointer');
    pointer(notch, false);
    t.mock.timers.tick(399); assert.equal(notch.mode, 'compact');
    t.mock.timers.tick(1); assert.equal(notch.mode, 'hidden');
    notch.setMode('expanded'); // Also used by the tray's Show Lumi action.
    notch.pointerInside = true; // A stationary cursor must not keep an automatic panel open indefinitely.
    t.mock.timers.tick(4000); assert.equal(notch.mode, 'hidden');
    await notch.action({ type: 'expand' }); assert.equal(windowOf(notch).isFocused(), true);
    t.mock.timers.tick(10_000); assert.equal(notch.mode, 'expanded', 'A panel the person opened closed under the pointer');
    pointer(notch, false); t.mock.timers.tick(400); assert.equal(notch.mode, 'hidden');
    assert.equal(windowOf(notch).isFocused(), false, 'The closed preview kept keyboard focus');
    assert.equal(windowOf(notch).ignored, process.platform !== 'linux', 'The hidden transparent area still intercepts mouse clicks');
    notch.message({}, 'alice', 'Alice', 'Unread message');
    t.mock.timers.tick(4000); assert.equal(notch.mode, 'hidden');
    assert.equal(itemOf(notch, 'message:alice').count, 1);
    settings.preview = true; notch.sync(); assert.equal(notch.mode, 'hidden', 'A privacy update reopened an expired preview');
    notch.file({ id: 'f1', fromName: 'Alice', name: 'Test.zip', size: 100, thread: 'alice' });
    t.mock.timers.tick(6999); assert.equal(notch.mode, 'expanded');
    t.mock.timers.tick(1); assert.equal(notch.mode, 'hidden');
    assert.equal(selectedSnapshot(notch).actionable, true);
    assert.deepEqual(decisions, [], 'Hiding the card answered a consent request');
    notch.prune(); assert.equal(notch.mode, 'hidden');
    notch.message({}, 'bob', 'Bob', 'Another notification');
    assert.equal(notch.mode, 'compact', 'An old hidden consent blocked a new notification');
    assert(notch.items.has('file:f1'));
    t.mock.timers.tick(4000); assert.equal(notch.mode, 'hidden');
    assert.equal(notch.timers.size, 0, 'Hidden preview still has an idle timer');
  } finally { notch.dispose(); }
});

test('Lumi opens on hover only when chosen, without taking focus until the first press inside', async t => {
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  const sessionType = process.env.XDG_SESSION_TYPE;
  for (const platform of ['win32', 'darwin', 'linux'] as const) {
    await t.test(platform, async () => {
      let notch: LumiNotch<Window> | undefined;
      try {
        Object.defineProperty(process, 'platform', { ...platformDescriptor, value: platform });
        process.env.XDG_SESSION_TYPE = 'x11';
        const context = fixture(); notch = context.notch;
        const win = windowOf(notch);
        context.settings.notchOpen = 'hover';
        notch.sync(); // The idle pill is on screen before the pointer reaches it.
        await notch.action({ type: 'peek' }); assert.equal(notch.mode, 'hidden', 'A peek without the pointer on the pill opened the panel');
        pointer(notch, true); await notch.action({ type: 'peek' });
        // Windows hands the foreground away on any focusability change, so hover leaves focus where it is.
        assert.deepEqual([notch.mode, win.isFocused(), win.focusable, win.deactivations, win.ignored], ['expanded', false, platform === 'linux', 0, false],
          'Opening on hover took focus, moved the foreground or ignored the pointer');
        // The renderer sends the first press inside as 'expand': keyboard focus as with a click on the pill.
        await notch.action({ type: 'expand' });
        assert.deepEqual([notch.mode, win.isFocused(), win.focusable], ['expanded', true, true]);
        notch.collapse();
        // Click is the default: hovering then only glances at queued activity.
        context.settings.notchOpen = 'click';
        pointer(notch, true); await notch.action({ type: 'peek' });
        assert.equal(notch.mode, 'hidden');
      } finally {
        notch?.dispose();
        Object.defineProperty(process, 'platform', platformDescriptor!);
        if (sessionType === undefined) delete process.env.XDG_SESSION_TYPE;
        else process.env.XDG_SESSION_TYPE = sessionType;
      }
    });
  }
});

test('Lumi introduces itself once until the panel is first opened, as a quiet card without private content', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { notch, settings, watch, firstOpens } = fixture();
  try {
    settings.notchOpened = false;
    // Over a watched main window the intro only raises the badge, like any arrival there.
    watch(true);
    windowOf(notch).webContents.emit('did-finish-load');
    assert.deepEqual([notch.mode, notch.snapshot().count], ['hidden', 1]);
    assert.equal(notch.intro(), false, 'The intro was queued twice');
    watch(false);
    pointer(notch, true); await notch.action({ type: 'peek' });
    const card = selectedSnapshot(notch);
    // Lumi's own text survives previews being off; it names no person or message.
    assert.deepEqual([notch.mode, card.key, card.title, card.body], ['compact', 'lumi:intro', 'Halo, saya Lumi', 'Klik untuk membuka Fokus, Rehat, Rutinitas, Tugas, dan Rak.']);
    await notch.action({ type: 'expand' });
    assert.deepEqual([notch.items.has('lumi:intro'), settings.notchOpened, firstOpens.length, notch.snapshot().count], [false, true, 1, 0]);
    notch.collapse(); await notch.action({ type: 'expand' });
    assert.equal(firstOpens.length, 1, 'A later opening saved the setting again');
    assert.equal(notch.intro(), false, 'The intro returned after the panel was opened');
  } finally { notch.dispose(); }
});

test('Lumi activity renews the deadline, while stale activity and background progress cannot prolong or reopen it', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { notch } = fixture();
  try {
    notch.message({}, 'alice', 'Alice', 'First message');
    const oldRevision = notch.revision;
    t.mock.timers.tick(3000);
    await notch.action({ type: 'activity', revision: oldRevision });
    t.mock.timers.tick(3999); assert.equal(notch.mode, 'compact');
    notch.file({ id: 'f1', fromName: 'Alice', name: 'Test.zip', size: 100, thread: 'alice' });
    t.mock.timers.tick(1); assert.equal(notch.mode, 'expanded', 'An older preview timer closed the new consent');
    assert.equal(await notch.action({ type: 'activity', revision: oldRevision }), false);
    t.mock.timers.tick(6999); assert.equal(notch.mode, 'hidden');
    notch.transfer({ id: 'f1', status: 'receiving', received: 30, total: 100 });
    t.mock.timers.tick(150); assert.equal(notch.mode, 'hidden');
    assert.equal(notch.timers.size, 0);
    await notch.action({ type: 'expand' });
    pointer(notch, false); t.mock.timers.tick(400); assert.equal(notch.mode, 'hidden');
  } finally { notch.dispose(); }
});

test('Lumi keeps one fixed window and shapes it to the island only where X11 cannot forward clicks', async t => {
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  const sessionType = process.env.XDG_SESSION_TYPE;
  for (const platform of ['win32', 'darwin', 'linux'] as const) {
    await t.test(platform, async () => {
      let notch: LumiNotch<Window> | undefined;
      try {
        Object.defineProperty(process, 'platform', { ...platformDescriptor, value: platform });
        process.env.XDG_SESSION_TYPE = 'x11';
        notch = fixture().notch;
        notch.message({}, 'alice', 'Alice', 'Test');
        const win = windowOf(notch), fixed = { ...win.bounds };
        assert.deepEqual([fixed.width, fixed.height], [680, 280]);
        for (const shape of [{ width: NaN, height: 30 }, { width: 0, height: 30 }, { width: 1.5, height: 30 }, { width: '200', height: 30 },
          { width: 681, height: 30 }, { width: 120, height: 281 }, { width: 120 }, { width: 120, height: 30, x: 0 }, { width: 120, height: 30, shoulder: 10 }])
          await assert.rejects(notch.action({ type: 'shape', ...shape }));
        assert.equal(win.shape, undefined, 'An invalid shape reached the native window');
        assert.equal(await notch.action({ type: 'shape', width: 320, height: 64 }), true);
        // Centered in the 680 DIP window with one DIP of slack on each side, plus a band for the top shoulders.
        assert.deepEqual(win.shape, platform === 'linux' ? [{ x: 179, y: 0, width: 322, height: 64 }, { x: 169, y: 0, width: 342, height: 10 }] : undefined);
        await notch.action({ type: 'expand' }); assert.equal(notch.mode, 'expanded');
        notch.collapse(); assert.equal(notch.mode, 'hidden');
        assert.deepEqual(win.bounds, fixed, 'A mode change resized the native window instead of morphing the island');
        assert.equal(notch.snapshot().inset, 0);
      } finally {
        notch?.dispose();
        Object.defineProperty(process, 'platform', platformDescriptor!);
        if (sessionType === undefined) delete process.env.XDG_SESSION_TYPE;
        else process.env.XDG_SESSION_TYPE = sessionType;
      }
    });
  }
});

test('Lumi focus respects Windows/macOS, X11 and Wayland capabilities', async t => {
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  const sessionType = process.env.XDG_SESSION_TYPE;
  for (const [platform, session] of [['win32', ''], ['darwin', ''], ['linux', 'x11'], ['linux', 'wayland']] as const) {
    await t.test(`${platform} ${session}`.trim(), async () => {
      let notch: LumiNotch<Window> | undefined;
      try {
        Object.defineProperty(process, 'platform', { ...platformDescriptor, value: platform });
        process.env.XDG_SESSION_TYPE = session;
        const context = fixture(); notch = context.notch;
        context.settings.notchIdle = 'away';
        assert.equal(notch.supported, session !== 'wayland');
        assert.equal(notch.message({}, 'alice', 'Alice', 'Test'), session !== 'wayland');
        if (session === 'wayland') {
          assert.equal(notch.win, undefined, 'Wayland should use system notifications without allocating an overlay');
          assert.equal(notch.mode, 'hidden');
          assert.equal(notch.timers.size, 0);
          assert.equal(notch.file({ id: 'f1', thread: 'alice', name: 'Test.zip', size: 100 }), false);
          return;
        }
        assert.equal(windowOf(notch).options.focusable, platform === 'linux');
        assert.equal(windowOf(notch).options.type, platform === 'darwin' ? 'panel' : undefined, 'macOS needs a native panel to follow Spaces and fullscreen apps');
        assert.equal(windowOf(notch).options.enableLargerThanScreen, platform === 'darwin' ? true : undefined, 'AppKit keeps a window below the menu bar without it');
        assert.equal(windowOf(notch).level, platform === 'darwin' ? 'status' : 'floating', 'The macOS island must sit above the menu bar');
        assert.equal(windowOf(notch).isFocused(), false, 'Automatic notifications must not steal focus');
        await notch.action({ type: 'expand' });
        assert.equal(windowOf(notch).focusable, true);
        assert.equal(windowOf(notch).isFocused(), true);
        assert.equal(windowOf(notch).ignored, false, 'Manual expansion must allow pointer input');
        notch.ipcMain.emit('lumi:pointer', { sender: windowOf(notch).webContents, senderFrame: windowOf(notch).webContents.mainFrame }, false);
        assert.equal(windowOf(notch).ignored, platform !== 'linux', 'Beside the expanded island, Windows/macOS must pass clicks through; X11 uses the shape');
        assert.equal(windowOf(notch).isFocused(), true, 'Leaving the island must keep keyboard focus in the expanded panel');
        context.watch(true); notch.sync();
        assert.equal(windowOf(notch).visible, false);
        assert.equal(windowOf(notch).focusable, platform === 'linux');
        assert.equal(windowOf(notch).isFocused(), false);
        context.main.fullScreen = true;
        assert.equal(notch.message({}, 'alice', 'Alice', 'Visible fullscreen chat'), false);
        context.watch(false);
        assert.equal(notch.message({}, 'alice', 'Alice', 'Hidden fullscreen chat'), true, 'A hidden fullscreen flag must not suppress background notifications');
        context.main.visible = true; context.main.minimized = true;
        assert.equal(notch.message({}, 'alice', 'Alice', 'Minimized fullscreen chat'), true);
        assert.equal(windowOf(notch).isFocused(), false, 'Background notifications must keep the panel inactive');
      } finally {
        notch?.dispose();
        Object.defineProperty(process, 'platform', platformDescriptor!);
        if (sessionType === undefined) delete process.env.XDG_SESSION_TYPE;
        else process.env.XDG_SESSION_TYPE = sessionType;
      }
    });
  }
});

test('Closing Lumi keeps the focus another window holds on Windows/macOS', async t => {
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  for (const platform of ['win32', 'darwin'] as const) {
    await t.test(platform, async () => {
      let notch: LumiNotch<Window> | undefined;
      try {
        Object.defineProperty(process, 'platform', { ...platformDescriptor, value: platform });
        const context = fixture(); notch = context.notch;
        const win = windowOf(notch);
        // Previews and the idle pill never change focusability.
        notch.message({}, 'alice', 'Alice', 'Test'); assert.equal(notch.mode, 'compact');
        notch.collapse(); assert.equal(notch.mode, 'hidden');
        assert.equal(win.deactivations, 0, 'A closing preview moved the foreground');
        // Open from the expanded panel: the main window takes focus, the panel blurs and closes to the always-on pill.
        await notch.action({ type: 'expand' }); assert.equal(win.isFocused(), true);
        const before = win.deactivations;
        win.focused = false; context.watch(true); win.emit('blur');
        assert.equal(notch.mode, 'hidden');
        assert.equal(win.deactivations, before, 'Closing the panel handed the foreground away from the main window');
        assert.equal(win.focusable, false);
        assert.equal(win.visible, true, 'The always-on pill stays over the watched main window');
        // Closed from inside the panel: the island gives up its own focus.
        await notch.action({ type: 'expand' }); await notch.action({ type: 'collapse' });
        assert.equal(win.focusable, false); assert.equal(win.isFocused(), false);
      } finally {
        notch?.dispose();
        Object.defineProperty(process, 'platform', platformDescriptor!);
      }
    });
  }
});

test('Lumi focus actions are opt-in and validated, and the session keeps the idle pill while arrivals wait quietly', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const { notch, settings, peer, focus, ends } = fixture();
  try {
    await assert.rejects(notch.action({ type: 'focus', minutes: 25 }), /ditolak/, 'Focus started before the person opted in');
    assert.equal(notch.snapshot().focus, false);
    // Turn on carries nothing: a length or extra field is refused, and opting in starts no session.
    for (const action of [{ type: 'focus-enable', minutes: 60 }, { type: 'focus-enable', value: 60 }, { type: 'focus-enable', path: 'C:/secret' }])
      await assert.rejects(notch.action(action), JSON.stringify(action));
    assert.equal(settings.focus, 0, 'A refused Turn on changed the setting');
    await notch.action({ type: 'focus-enable' });
    assert.deepEqual([settings.focus, notch.snapshot().focus, peer.state.status, focus.session], [25, true, 'active', undefined], 'Turn on did not only opt in');
    for (const action of [{ type: 'focus' }, { type: 'focus', minutes: 4 }, { type: 'focus', minutes: 181 }, { type: 'focus', minutes: 25.5 }, { type: 'focus', minutes: '25' },
      { type: 'focus', minutes: 25, path: 'C:/secret' }, { type: 'peek', minutes: 25 }, { type: 'focus-pause', minutes: 25 }, { type: 'focus-pause' }, { type: 'focus-stop' }])
      await assert.rejects(notch.action(action), JSON.stringify(action));
    assert.deepEqual([peer.state.status, focus.session], ['active', undefined]);

    await notch.action({ type: 'expand' });
    await notch.action({ type: 'focus', minutes: 25 });
    assert.equal(peer.state.status, 'dnd');
    assert.equal(notch.mode, 'expanded', 'Starting a session closed the panel');
    const card = selectedSnapshot(notch);
    assert.deepEqual([card.key, card.kind, card.status, card.title, card.until, card.remaining], ['focus', 'focus', 'running', 'Sesi fokus', 1_000_000 + 25 * 60_000, undefined]);
    assert.equal(notch.snapshot().count, 0, 'The session counted as an activity');
    await notch.action({ type: 'collapse' });
    assert.deepEqual([notch.mode, windowOf(notch).visible, notch.eligible()], ['hidden', true, false], 'The session lost its idle pill or let arrivals interrupt');

    assert.equal(notch.message({}, 'alice', 'Alice', 'Held message'), false);
    assert.equal(notch.file({ id: 'f1', thread: 'alice', fromName: 'Alice', name: 'a.zip', size: 1 }), false);
    t.mock.timers.tick(200);
    assert.deepEqual([notch.mode, selectedSnapshot(notch).key], ['hidden', 'focus'], 'An arrival took attention during the session');
    const published = notch.lastPublication;
    t.mock.timers.tick(10 * 60_000);
    assert.deepEqual([notch.mode, notch.lastPublication], ['hidden', published], 'Time passing published or reopened the pill');

    await notch.action({ type: 'focus-pause' });
    assert.equal(notch.mode, 'hidden', 'Pausing reopened the hidden preview');
    assert.deepEqual([selectedSnapshot(notch).status, selectedSnapshot(notch).until, selectedSnapshot(notch).remaining], ['paused', undefined, 15 * 60_000 - 200]);
    await notch.action({ type: 'focus-resume' });
    assert.equal(selectedSnapshot(notch).until, 1_000_000 + 25 * 60_000, 'Resume lost or added time');
    await notch.action({ type: 'focus-end' });
    assert.deepEqual([peer.state.status, ends.length, notch.snapshot().items.some(i => i.key === 'focus')], ['active', 1, false]);
    assert.equal(notch.items.has('message:alice'), true, 'The held message was dropped');
  } finally { focus.dispose(); notch.dispose(); }
});

test('Lumi Do not disturb without a focus session still hides the island', () => {
  const { notch, peer, focus } = fixture();
  try {
    assert.deepEqual([notch.sync(), windowOf(notch).visible], [true, true]);
    peer.state.status = 'dnd';
    assert.deepEqual([notch.sync(), notch.shown(), windowOf(notch).visible], [false, false, false]);
  } finally { focus.dispose(); notch.dispose(); }
});

test('Lumi shows one focus summary, redacted with previews off, that opens the conversations and leaves them unread', async () => {
  const { notch, settings, peer, opens } = fixture();
  try {
    notch.focusDone({ count: 3, threads: 2, thread: 'inbox' }, '3 pesan dari 2 percakapan');
    assert.equal(notch.mode, 'compact');
    let card = selectedSnapshot(notch);
    assert.deepEqual([card.kind, card.status, card.title, card.body], ['focus', 'done', 'Lumilan Chat', 'Sesi fokus selesai.']);
    settings.preview = true; card = selectedSnapshot(notch);
    assert.deepEqual([card.title, card.body], ['Sesi fokus selesai', '3 pesan dari 2 percakapan']);
    notch.focusDone({ count: 1, threads: 1, thread: 'alice' }, '1 pesan dari 1 percakapan');
    assert.equal(notch.items.size, 1, 'A second summary was queued beside the first');
    await notch.action({ type: 'open', key: 'focus:done' });
    assert.deepEqual([opens, notch.items.size], [['alice'], 0]);
    peer.state.mutedThreads = ['alice'];
    assert.equal(notch.focusDone({ count: 1, threads: 1, thread: 'alice' }, 'x'), false, 'A muted conversation produced a summary');
    peer.state.mutedThreads = [];
    notch.focusDone({ count: 1, threads: 1, thread: 'alice' }, 'x'); notch.dismiss('alice');
    assert.equal(notch.items.size, 0, 'Reading the conversation kept its summary');
  } finally { notch.dispose(); }
});

test('Lumi keeps its idle pill over a watched main window and only badges arrivals there', async () => {
  const { notch, settings, watch } = fixture();
  try {
    watch(true);
    assert.deepEqual([notch.sync(), windowOf(notch).visible, notch.mode], [true, true, 'hidden'], 'The pill left a watched main window');
    assert.equal(notch.message({}, 'alice', 'Alice', 'While reading'), false, 'Lumi interrupted a main window being watched');
    assert.deepEqual([notch.mode, notch.snapshot().count, selectedSnapshot(notch).key], ['hidden', 1, 'message:alice']);
    assert.equal(windowOf(notch).isFocused(), false);
    notch.dismiss('alice');
    assert.equal(notch.snapshot().count, 0, 'Reading the conversation kept the badge');
    await notch.action({ type: 'expand' }); assert.equal(notch.mode, 'expanded');
    await notch.action({ type: 'collapse' });
    watch(false);
    assert.equal(notch.message({}, 'alice', 'Alice', 'Away again'), true);
    assert.equal(notch.mode, 'compact');
    notch.collapse(); settings.notchIdle = 'away'; watch(true);
    assert.deepEqual([notch.sync(), windowOf(notch).visible], [false, false], "'away' kept the pill over a watched window");
    assert.equal(notch.timers.size, 0, 'The idle pill must not poll');
  } finally { notch.dispose(); }
});

test('Lumi stays open under the pointer after the person opens it and closes shortly after the pointer leaves', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { notch } = fixture();
  try {
    notch.sync(); // The idle pill is on screen before the person clicks it.
    await notch.action({ type: 'expand' });
    t.mock.timers.tick(60_000); assert.equal(notch.mode, 'expanded');
    assert.equal(notch.timers.size, 0, 'An open panel under the pointer kept a timer');
    pointer(notch, false); t.mock.timers.tick(399); assert.equal(notch.mode, 'expanded');
    pointer(notch, true); t.mock.timers.tick(5000); assert.equal(notch.mode, 'expanded', 'Returning to the island did not cancel the close');
    pointer(notch, false);
    notch.file({ id: 'f1', fromName: 'Alice', name: 'Test.zip', size: 100, thread: 'alice' });
    t.mock.timers.tick(400); assert.equal(notch.mode, 'expanded', 'A request arriving after the pointer left used the hover close');
    t.mock.timers.tick(6600); assert.equal(notch.mode, 'hidden');
    // Typing in the panel survives the pointer drifting off the island; finishing the edit restores the hover close.
    await notch.action({ type: 'expand' });
    await notch.action({ type: 'editing', value: true });
    pointer(notch, false); t.mock.timers.tick(10_000); assert.equal(notch.mode, 'expanded', 'The pointer leaving discarded the typing');
    await notch.action({ type: 'editing', value: false }); t.mock.timers.tick(400); assert.equal(notch.mode, 'hidden');
    for (const action of [{ type: 'editing' }, { type: 'editing', value: 'yes' }, { type: 'editing', value: true, action: 'add' }, { type: 'peek', value: true }])
      await assert.rejects(notch.action(action), JSON.stringify(action));
    await notch.action({ type: 'editing', value: true });
    assert.equal(notch.editing, false, 'A closed panel accepted a typing hold');
    await notch.action({ type: 'expand' });
    windowOf(notch).emit('blur'); assert.deepEqual([notch.mode, notch.held], ['hidden', false]);
    await notch.action({ type: 'expand' });
    notch.remove('file:f1');
    assert.equal(notch.mode, 'expanded', 'Answering the last card closed a panel the person is using');
  } finally { notch.dispose(); }
});

test('Lumi device notices are passing, rate-limited, and quiet under lock and Do not disturb', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const { notch, peer, settings, focus } = fixture();
  try {
    notch.powerMonitor.emit('on-battery');
    assert.deepEqual([notch.mode, selectedSnapshot(notch).key, selectedSnapshot(notch).status], ['compact', 'device:power', 'battery']);
    assert.equal(selectedSnapshot(notch).title, 'Daya', 'A device notice was redacted like private content');
    assert.equal(notch.snapshot().count, 0, 'A device notice counted as queued activity');
    const revision = notch.revision;
    notch.powerMonitor.emit('on-battery'); assert.equal(notch.revision, revision, 'A repeated event took attention again');
    notch.powerMonitor.emit('on-ac');
    assert.deepEqual([notch.revision, selectedSnapshot(notch).status], [revision, 'ac'], 'A change inside the window reopened the preview');
    t.mock.timers.tick(4000); assert.equal(notch.mode, 'hidden');
    assert.equal(notch.items.has('device:power'), false, 'A device notice outlived its preview');
    notch.network(true); assert.equal(notch.mode, 'hidden', 'The starting network state was announced');
    notch.network(false); assert.deepEqual([notch.mode, selectedSnapshot(notch).body], ['compact', 'Jaringan terputus']);
    notch.collapse();
    notch.presence(2); assert.deepEqual([selectedSnapshot(notch).key, selectedSnapshot(notch).count], ['device:peers', 2]);
    notch.presence(3); assert.equal(selectedSnapshot(notch).count, 3);
    notch.presence(0); assert.equal(notch.items.has('device:peers'), false);
    notch.collapse(); notch.presence(1); assert.equal(notch.mode, 'hidden', 'Presence was announced again within ten minutes');
    t.mock.timers.tick(60_000);
    notch.powerMonitor.emit('lock-screen'); notch.powerMonitor.emit('on-battery');
    assert.equal(notch.items.size, 0, 'A device notice was queued on a locked screen');
    notch.powerMonitor.emit('unlock-screen'); peer.state.status = 'dnd'; notch.powerMonitor.emit('on-ac');
    assert.equal(notch.items.size, 0, 'A device notice appeared during Do not disturb');
    peer.state.status = 'active'; settings.focus = 25; focus.start(25); notch.powerMonitor.emit('on-battery');
    assert.equal(notch.items.size, 0, 'A device notice interrupted a focus session');
  } finally { focus.dispose(); notch.dispose(); }
});

test('Lumi page modules publish a view only while on and receive validated actions', async () => {
  let on = true;
  const calls: Array<[string, unknown]> = [];
  const view: TasksView = { done: 1, total: 2, items: [{ id: 't1', title: 'Write report', done: false, dueAt: undefined }] };
  const { notch } = fixture({ tasks: { view: () => on ? view : undefined, act: (action, value) => { if (action !== 'toggle') throw new Error('unknown'); calls.push([action, value]); } } });
  try {
    assert.deepEqual(notch.snapshot().pages, { tasks: view });
    assert.equal(await notch.action({ type: 'tasks', action: 'toggle', value: 't1' }), true);
    assert.deepEqual(calls, [['toggle', 't1']]);
    for (const action of [{ type: 'tasks' }, { type: 'tasks', value: 't1' }, { type: 'shelf', action: 'open', value: 'x' }, { type: 'tasks', action: 'Toggle()', value: 't1' },
      { type: 'tasks', action: 'toggle', value: 't1', path: 'C:/secret' }, { type: 'peek', action: 'toggle' }, { type: 'tasks', action: 'toggle', value: 'x'.repeat(5000) },
      { type: 'tasks', action: 'remove', value: 't1' }])
      await assert.rejects(notch.action(action), JSON.stringify(action).slice(0, 80));
    on = false;
    assert.deepEqual(notch.snapshot().pages, {}, 'A page stayed in the deck after its feature was turned off');
    await assert.rejects(notch.action({ type: 'tasks', action: 'toggle', value: 't1' }), /ditolak/);
    assert.equal(calls.length, 1, 'A refused action reached the module');
  } finally { notch.dispose(); }
});

test('Lumi water card is not private, goes once the goal is reached, and is answered by Drink', async () => {
  const routine: RoutineView = { settings: { enabled: true, servingMl: 250, goalMl: 2000, startHour: 8, endHour: 22, intervalMinutes: 60 }, todayMl: 500, percent: 25, reached: false,
    hours: Array<number>(24).fill(0), nextAt: undefined };
  const drinks: unknown[] = [];
  const { notch } = fixture({ routine: { view: () => routine, act: action => { if (action !== 'drink') throw new Error('unknown'); drinks.push(action); routine.todayMl += 250; } } });
  try {
    assert.equal(notch.water('0.5 / 2.0 L'), true);
    const card = selectedSnapshot(notch);
    assert.deepEqual([card.kind, card.title, card.body, notch.mode], ['routine', 'Waktunya minum', '0.5 / 2.0 L', 'compact'], 'The water card was redacted or not previewed');
    await notch.action({ type: 'routine', action: 'drink' });
    assert.deepEqual([drinks.length, notch.items.has('routine:water')], [1, false], 'Drinking left the reminder card');
    notch.water('0.8 / 2.0 L'); routine.reached = true; notch.sync();
    assert.equal(notch.items.has('routine:water'), false, 'A reached goal kept the reminder card');
    routine.reached = false; notch.water('0.8 / 2.0 L'); routine.settings.enabled = false; notch.sync();
    assert.equal(notch.items.has('routine:water'), false, 'Turning reminders off kept the card');
    assert.equal(notch.snapshot().pages.routine, routine);
  } finally { notch.dispose(); }
});

test('Lumi break page stays in the deck while off, its card is not private and goes once answered, and its end notice is passing', async () => {
  const view: BreakView = { settings: { enabled: false, workMinutes: 45, breakMinutes: 10 }, phase: 'work', nextAt: undefined, until: undefined };
  const calls: string[] = [];
  const { notch, peer } = fixture({ break: { view: () => view, act: action => { if (!['snooze', 'start'].includes(action)) throw new Error('unknown'); calls.push(action); view.phase = 'work'; } } });
  try {
    assert.equal(notch.snapshot().pages.break, view, 'The break page left the deck while reminders were off');
    Object.assign(view, { settings: { ...view.settings, enabled: true }, phase: 'due', until: Date.now() + 60_000 });
    assert.equal(notch.breakDue('Istirahat 10 menit'), true);
    const card = selectedSnapshot(notch);
    assert.deepEqual([card.kind, card.title, card.body, notch.mode], ['break', 'Waktunya rehat', 'Istirahat 10 menit', 'compact'], 'The break card was redacted or not previewed');
    for (const action of [{ type: 'break' }, { type: 'break', action: 'Snooze!' }, { type: 'break', action: 'skip' }])
      await assert.rejects(notch.action(action), JSON.stringify(action));
    assert.equal(notch.items.has('break:due'), true, 'A refused action removed the card');
    await notch.action({ type: 'break', action: 'snooze' });
    assert.deepEqual([calls, notch.items.has('break:due')], [['snooze'], false], 'Snoozing left the break card');
    view.phase = 'due'; notch.breakDue('Istirahat 10 menit'); view.phase = 'break'; notch.sync();
    assert.equal(notch.items.has('break:due'), false, 'A break that started kept its reminder card');
    notch.collapse();
    assert.equal(notch.breakDone(), true);
    assert.deepEqual([selectedSnapshot(notch).key, selectedSnapshot(notch).title, selectedSnapshot(notch).body, notch.snapshot().count], ['device:break', 'Rehat kerja', 'Rehat selesai', 0],
      'The end notice was not a passing card');
    notch.collapse();
    assert.equal(notch.items.has('device:break'), false, 'The end notice outlived its preview');
    peer.state.status = 'dnd';
    assert.equal(notch.breakDone(), false, 'The end notice appeared during Do not disturb');
  } finally { notch.dispose(); }
});

test('Lumi shelf drops reach main only as validated paths from the Lumi window, and a drag opens the shelf without focus', async () => {
  const drops: string[][] = [], view: ShelfView = { items: [], picker: undefined };
  const { notch, ipcMain } = fixture({ shelf: { view: () => view, act: action => { if (action !== 'open') throw new Error('unknown'); } } },
    async paths => { drops.push(paths); return { added: paths.length, replaced: 0, skipped: 0 }; });
  try {
    notch.sync();
    const drop = ipcMain.handlers.get('lumi:drop'); assert(drop);
    const event = { sender: windowOf(notch).webContents, senderFrame: windowOf(notch).webContents.mainFrame };
    assert.deepEqual(await drop(event, ['C:/Users/a/report.pdf']), { added: 1, replaced: 0, skipped: 0 });
    assert.deepEqual(drops, [['C:/Users/a/report.pdf']]);
    // A whole drop arrives as one batch of up to ten paths: one call into the shelf.
    const batch = Array.from({ length: 10 }, (_, i) => `C:/Users/a/${i}.txt`);
    assert.deepEqual(await drop(event, batch), { added: 10, replaced: 0, skipped: 0 });
    assert.deepEqual(drops.at(-1), batch);
    for (const bad of ['C:/x', Array(11).fill('C:/a'), [''], [5], ['x'.repeat(4097)], null])
      assert.throws(() => drop(event, bad), /ditolak/, JSON.stringify(bad)?.slice(0, 40));
    assert.throws(() => drop({ ...event, sender: {} }, ['C:/a']), /ditolak/, 'Another window reached the shelf');
    assert.equal(drops.length, 2);
    await notch.action({ type: 'shelf', action: 'reveal' });
    assert.deepEqual([notch.mode, windowOf(notch).isFocused(), windowOf(notch).ignored, notch.held], ['expanded', false, false, true],
      'Opening the shelf for a drag took focus or kept the window click-through');
    for (const action of [{ type: 'shelf', action: 'reveal', value: 1 }, { type: 'shelf', action: 'send', value: { id: 'x', to: 'c0' } }])
      await assert.rejects(notch.action(action), JSON.stringify(action));
    notch.collapse();
    notch.shelfDone('Terkirim ke Alice.');
    assert.deepEqual([notch.mode, selectedSnapshot(notch).title, selectedSnapshot(notch).body], ['compact', 'Rak', 'Terkirim ke Alice.']);
    assert.equal(notch.snapshot().count, 0, 'A shelf notice raised the activity badge');
  } finally { notch.dispose(); }
  assert.equal(ipcMain.handlers.has('lumi:drop'), false, 'The drop handler outlived Lumi');
});

test('the Lumi preload sends a whole drop to main as one batch of at most ten paths', async () => {
  interface ShelveBridge { shelve(files: unknown): Promise<unknown> }
  const calls: unknown[][] = [];
  let bridge: ShelveBridge | undefined;
  const context = vm.createContext({ require: () => ({
    // The preload builds its arrays in the vm realm; clone them so deepEqual compares values, not prototypes.
    ipcRenderer: Object.assign(new EventEmitter(), { invoke: async (...args: unknown[]) => { calls.push(structuredClone(args)); return { added: 0, replaced: 0, skipped: 0 }; } }),
    // Like Electron's: a File without a disk path (pasted data) has an empty path, anything else is refused.
    webUtils: { getPathForFile: (file: unknown) => { if (!file || typeof file !== 'object') throw new TypeError('Not a File'); return 'path' in file ? String(file.path) : ''; } },
    contextBridge: { exposeInMainWorld: (_name: string, api: ShelveBridge) => { bridge = api; } } }) });
  vm.runInContext(readFileSync(new URL('../src/preload/notch-preload.cjs', import.meta.url), 'utf8'), context);
  assert(bridge);
  await bridge.shelve(Array.from({ length: 12 }, (_, i) => ({ path: i === 1 ? '' : `C:/a/${i}.txt` })));
  assert.deepEqual(calls, [['lumi:drop', ['C:/a/0.txt', ...Array.from({ length: 8 }, (_, i) => `C:/a/${i + 2}.txt`)]]]);
  await assert.rejects(async () => bridge!.shelve('C:/secret.txt'));
  assert.equal(calls.length, 1, 'A path string reached main');
});

test('Lumi refuses shelf drops when the shelf is not wired', () => {
  const { notch, ipcMain } = fixture();
  try {
    notch.sync();
    const drop = ipcMain.handlers.get('lumi:drop'); assert(drop);
    assert.throws(() => drop({ sender: windowOf(notch).webContents, senderFrame: windowOf(notch).webContents.mainFrame }, ['C:/a']), /ditolak/);
  } finally { notch.dispose(); }
});
