import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { LumiNotch, notchBounds } from '../src/main/notch.js';
import type { NotchIpcEvent, NotchPeer, NotchReminder } from '../src/main/notch.js';
import type { BrowserWindowConstructorOptions, Rectangle } from 'electron';
import type { NotchSettings, NotchSnapshot } from '../src/shared/notch.js';

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
  last: NotchSnapshot | undefined;
  open: (details: { url: string }) => { action: 'deny' } = () => ({ action: 'deny' });
  constructor(readonly options: BrowserWindowConstructorOptions) {
    super(); this.focusable = options.focusable ?? false; this.webContents = new TestContents(this);
  }
  isDestroyed() { return this.dead; }
  isMinimized() { return false; }
  setAlwaysOnTop() {} setFocusable(value: boolean) {
    assert.notEqual(process.platform, 'linux', 'Electron setFocusable is only available on Windows/macOS');
    this.focusable = value;
  }
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


function fixture() {
  const display = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
  const screen = Object.assign(new EventEmitter(), { getPrimaryDisplay: () => display, getAllDisplays: () => [display], getDisplayNearestPoint: () => display, getCursorScreenPoint: () => ({ x: 500, y: 0 }) });
  const ipcMain = new TestIpc();
  const main = { visible: false, minimized: false, fullScreen: false, isDestroyed: () => false, isVisible: () => main.visible, isMinimized: () => main.minimized, isFullScreen: () => main.fullScreen };
  const settings: NotchSettings = { notch: true, enabled: true, preview: false, silent: true, language: 'id' };
  const peer: NotchPeer & { state: { status: string; mutedThreads: string[]; reminders: NotchReminder[] } } = { state: { status: 'active', mutedThreads: [], reminders: [] }, trusted: new Map([['alice', { name: 'Alice' }]]), sendCall: async () => { peer.activeCall = null; } };
  const decisions: Array<[string, boolean]> = [], opens: Array<string | undefined> = [], accepts: string[] = [], pending = new Set(['f1']);
  const notch = new LumiNotch({ BrowserWindow: Window, ipcMain, screen, powerMonitor: new EventEmitter(), preloadDir: '.', getMain: () => main,
    getSettings: () => settings, getPeer: () => peer, reveal: thread => opens.push(thread), acceptCall: id => accepts.push(id),
    decideFile: async (id, value) => { if (!pending.delete(id)) throw new Error('expired'); decisions.push([id, value]); },
    savePosition: value => { settings.notchPosition = value; } });
  notch.sync(); notch.ready = true;
  return { notch, settings, peer, main, ipcMain, decisions, opens, accepts, pending };
}

test('Lumi bounds remain inside small, negative-coordinate and scaled display work areas', () => {
  for (const area of [{ x: -1600, y: 25, width: 1600, height: 900 }, { x: 0, y: 40, width: 320, height: 260 }]) {
    for (const mode of ['hidden', 'compact', 'expanded'] as const) for (const fraction of [NaN, -500, 0, .5, 1, 500]) {
      const b = notchBounds({ workArea: area }, mode, fraction);
      assert(b.x >= area.x && b.x + b.width <= area.x + area.width);
      assert(b.y >= area.y && b.y + b.height <= area.y + area.height);
    }
  }
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
  const { notch, settings, peer, main } = fixture();
  try {
    notch.message({}, 'alice', 'Alice', '<img src=x onerror=alert(1)> secret');
    assert.equal(notch.mode, 'compact', 'Ordinary messages must not automatically cover the desktop with a full card');
    assert(!JSON.stringify(notch.snapshot()).includes('secret'));
    settings.preview = true; assert(selectedSnapshot(notch).body.includes('secret'));
    settings.preview = false; assert(!JSON.stringify(notch.snapshot()).includes('Alice'));
    await notch.action({ type: 'expand' }); assert.equal(windowOf(notch).focusable, true);
    main.visible = true; assert.equal(notch.sync(), false); assert.equal(windowOf(notch).visible, false);
    assert.equal(windowOf(notch).focusable, process.platform === 'linux');
    assert.equal(windowOf(notch).isFocused(), false, 'A later automatic notification could still take native focus');
    main.visible = false; peer.state.status = 'dnd'; assert.equal(notch.sync(), false);
    peer.state.status = 'active'; settings.enabled = false; assert.equal(notch.sync(), false);
    settings.enabled = true; settings.notch = false; assert.equal(notch.sync(), false);
    assert.equal(windowOf(notch).isDestroyed(), true, 'Disabling Lumi kept its renderer process allocated');
    settings.notch = true; peer.state.mutedThreads = ['alice']; notch.prune(); assert.equal(notch.items.size, 0);
    assert.equal(notch.file({ id: 'muted', thread: 'alice', fromName: 'Alice', name: 'Private.zip', size: 100 }), false);
    assert.equal(notch.items.size, 0, 'Muted consent was published by the companion');
    assert.equal(notch.timers.size, 0, 'Idle must not poll or animate with an interval');
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
    assert.equal(windowOf(notch).ignored, false, 'Expanded consent became click-through and lost focus before the leave timer');
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
    const { notch, peer, main, opens } = fixture();
    try {
      peer.state.status = 'dnd'; notch.sync(); notch.file(aliceFile); fail(notch);
      main.visible = true; notch.sync();
      peer.state.status = 'active'; main.visible = false; notch.prune();
      assert.deepEqual(opens, [], 'Hiding the presented main window brought it back');
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
    await notch.action({ type: 'peek' });
    t.mock.timers.tick(3999); assert.equal(notch.mode, 'compact');
    t.mock.timers.tick(1); assert.equal(notch.mode, 'hidden');
    notch.setMode('expanded'); // Also used by the tray's Show Lumi action.
    notch.pointerInside = true; // A stationary cursor must not keep the panel open indefinitely.
    t.mock.timers.tick(4000); assert.equal(notch.mode, 'hidden');
    await notch.action({ type: 'expand' }); assert.equal(windowOf(notch).isFocused(), true);
    t.mock.timers.tick(4000); assert.equal(notch.mode, 'hidden');
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
    t.mock.timers.tick(4000); assert.equal(notch.mode, 'hidden');
  } finally { notch.dispose(); }
});

test('Lumi accepts bounded content heights only for the current expanded panel and keeps its dismissal deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { notch } = fixture();
  try {
    await notch.action({ type: 'expand' });
    const revision = notch.revision;
    for (const height of [NaN, Infinity, '200', 200.5, 139, 361]) await assert.rejects(notch.action({ type: 'resize', height, revision }));
    assert.equal(await notch.action({ type: 'resize', height: 185, revision: revision - 1 }), false);
    assert.equal(await notch.action({ type: 'resize', height: 185, revision }), true);
    assert.equal(windowOf(notch).bounds.height, 185);
    t.mock.timers.tick(3000);
    await notch.action({ type: 'resize', height: 227, revision });
    assert.equal(windowOf(notch).bounds.height, 227);
    t.mock.timers.tick(1000); assert.equal(notch.mode, 'hidden', 'Layout changes extended the preview deadline');
    assert.equal(await notch.action({ type: 'resize', height: 360, revision }), false);
    assert.equal(windowOf(notch).bounds.height, 5, 'Stale layout expanded the hidden wake strip');
  } finally { notch.dispose(); }
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
        assert.equal(windowOf(notch).isFocused(), false, 'Automatic notifications must not steal focus');
        await notch.action({ type: 'expand' });
        assert.equal(windowOf(notch).focusable, true);
        assert.equal(windowOf(notch).isFocused(), true);
        assert.equal(windowOf(notch).ignored, false, 'Manual expansion must allow pointer input');
        context.main.visible = true; notch.sync();
        assert.equal(windowOf(notch).visible, false);
        assert.equal(windowOf(notch).focusable, platform === 'linux');
        assert.equal(windowOf(notch).isFocused(), false);
        context.main.fullScreen = true;
        assert.equal(notch.message({}, 'alice', 'Alice', 'Visible fullscreen chat'), false);
        context.main.visible = false;
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
