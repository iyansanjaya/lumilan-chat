import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { LumiNotch, notchBounds } from './notch.js';

function fixture() {
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.visible = false; this.dead = false; this.focusable = options.focusable;
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, { mainFrame: { url: 'lumilan://app/notch.html' }, getURL: () => 'lumilan://app/notch.html',
        send: (_channel, value) => { this.last = value; }, setWindowOpenHandler: fn => { this.open = fn; } });
    }
    isDestroyed() { return this.dead; }
    setAlwaysOnTop() {} setFocusable(value) {
      assert.notEqual(process.platform, 'linux', 'Electron setFocusable is only available on Windows/macOS');
      this.focusable = value;
    }
    setIgnoreMouseEvents(value) { this.ignored = value; }
    setBounds(value) { this.bounds = value; } isVisible() { return this.visible; }
    showInactive() { this.visible = true; } hide() { this.visible = false; this.focused = false; this.emit('blur'); } destroy() { this.dead = true; }
    focus() { if (this.focusable) this.focused = true; } isFocused() { return this.focused === true; } loadURL() { return Promise.resolve(); }
  }
  const display = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
  const screen = new EventEmitter(); Object.assign(screen, { getPrimaryDisplay: () => display, getAllDisplays: () => [display], getDisplayNearestPoint: () => display, getCursorScreenPoint: () => ({ x: 500, y: 0 }) });
  const ipcMain = new EventEmitter(); Object.assign(ipcMain, { handle: (name, fn) => { ipcMain[name] = fn; }, removeHandler: name => { delete ipcMain[name]; } });
  const main = { visible: false, minimized: false, fullScreen: false, isDestroyed: () => false, isVisible: () => main.visible, isMinimized: () => main.minimized, isFullScreen: () => main.fullScreen };
  const settings = { notch: true, enabled: true, preview: false, silent: true, language: 'id' };
  const peer = { state: { status: 'active', mutedThreads: [] }, trusted: new Map([['alice', { name: 'Alice' }]]), sendCall: async () => { peer.activeCall = null; } };
  const decisions = [], opens = [], accepts = [], pending = new Set(['f1']);
  const notch = new LumiNotch({ BrowserWindow: Window, ipcMain, screen, powerMonitor: new EventEmitter(), root: '.', getMain: () => main,
    getSettings: () => settings, getPeer: () => peer, reveal: thread => opens.push(thread), acceptCall: id => accepts.push(id),
    decideFile: async (id, value) => { if (!pending.delete(id)) throw new Error('expired'); decisions.push([id, value]); },
    savePosition: value => { settings.notchPosition = value; } });
  notch.sync(); notch.ready = true;
  return { notch, settings, peer, main, ipcMain, decisions, opens, accepts, pending };
}

test('Lumi bounds remain inside small, negative-coordinate and scaled display work areas', () => {
  for (const area of [{ x: -1600, y: 25, width: 1600, height: 900 }, { x: 0, y: 40, width: 320, height: 260 }]) {
    for (const mode of ['hidden', 'compact', 'expanded']) for (const fraction of [NaN, -500, 0, .5, 1, 500]) {
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
    assert.equal(notch.snapshot().selected.actionable,false);await assert.rejects(notch.action({type:'accept',key:'reminder:r1'}));
    settings.preview=true;notch.sync();assert.equal(notch.snapshot().selected.body,'Private reminder');
    await notch.action({type:'open',key:'reminder:r1'});assert.deepEqual(opens,['reminders']);assert.equal(request.status,'pending');
    notch.reminder({type:'request',items:[request]});peer.state.mutedThreads=['alice'];notch.prune();assert.equal(notch.items.size,0);
    peer.state.mutedThreads=[];notch.reminder({type:'request',items:[request]});request.status='scheduled';notch.prune();assert.equal(notch.items.size,0);
    request.status='due';const local={id:'r2',kind:'local',status:'due',title:'Local'};peer.state.reminders.push(local);
    notch.reminder({type:'due',items:[request]});notch.reminder({type:'due',items:[local]});assert.equal(notch.snapshot().selected.count,2);
    peer.state.mutedThreads=['alice'];notch.prune();assert.equal(notch.snapshot().selected.count,1);assert.equal(notch.snapshot().selected.body,'Local');
    local.status='done';notch.prune();assert.equal(notch.items.size,0);
  }finally{notch.dispose();}
});

test('Lumi IPC rejects foreign windows, frames, URLs and arbitrary actions', async () => {
  const { notch, ipcMain } = fixture();
  try {
    const event = { sender: notch.win.webContents, senderFrame: notch.win.webContents.mainFrame };
    assert.equal(ipcMain['lumi:state'](event).count, 0);
    for (const invalid of [{ ...event, sender: {} }, { ...event, senderFrame: null }, { ...event, senderFrame: { url: 'lumilan://app/notch.html' } }]) {
      assert.throws(() => ipcMain['lumi:state'](invalid), /ditolak/);
      assert.doesNotThrow(() => ipcMain.emit('lumi:pointer', invalid, false));
    }
    for (const action of [null, { type: 'accept', key: 'file:missing' }, { type: 'open', path: 'C:/secret' }, { type: 'eval' }, { type: 'move', delta: Infinity }])
      await assert.rejects(notch.action(action));
    assert.equal(notch.win.options.webPreferences.sandbox, true);
    assert.equal(notch.win.options.webPreferences.nodeIntegration, false);
    assert.equal(notch.win.open({ url: 'https://example.com' }).action, 'deny');
  } finally { notch.dispose(); }
});

test('Lumi redacts queued content immediately and obeys DND, mute, visibility and notification settings', async () => {
  const { notch, settings, peer, main } = fixture();
  try {
    notch.message({}, 'alice', 'Alice', '<img src=x onerror=alert(1)> secret');
    assert.equal(notch.mode, 'compact', 'Ordinary messages must not automatically cover the desktop with a full card');
    assert(!JSON.stringify(notch.snapshot()).includes('secret'));
    settings.preview = true; assert(notch.snapshot().selected.body.includes('secret'));
    settings.preview = false; assert(!JSON.stringify(notch.snapshot()).includes('Alice'));
    await notch.action({ type: 'expand' }); assert.equal(notch.win.focusable, true);
    main.visible = true; assert.equal(notch.sync(), false); assert.equal(notch.win.visible, false);
    assert.equal(notch.win.focusable, process.platform === 'linux');
    assert.equal(notch.win.isFocused(), false, 'A later automatic notification could still take native focus');
    main.visible = false; peer.state.status = 'dnd'; assert.equal(notch.sync(), false);
    peer.state.status = 'active'; settings.enabled = false; assert.equal(notch.sync(), false);
    settings.enabled = true; settings.notch = false; assert.equal(notch.sync(), false);
    assert.equal(notch.win.isDestroyed(), true, 'Disabling Lumi kept its renderer process allocated');
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
    notch.ipcMain.emit('lumi:pointer', { sender: notch.win.webContents, senderFrame: notch.win.webContents.mainFrame }, false);
    assert.equal(notch.win.ignored, false, 'Expanded consent became click-through and lost focus before the leave timer');
    await notch.action({ type: 'collapse' }); assert.equal(notch.win.ignored, process.platform !== 'linux');
    await notch.action({ type: 'expand' }); assert.equal(notch.win.ignored, false);
    for (let i = 0; i < 100; i++) notch.message({}, `thread-${i}`, 'Sender', 'Message');
    assert.equal(notch.selected().id, 'f1'); assert.equal(notch.items.size, 65);
    await notch.action({ type: 'accept', key: 'file:f1' });
    assert.deepEqual(decisions, [['f1', true]]);
    await assert.rejects(notch.action({ type: 'accept', key: 'file:f1' }));
    notch.transfer({ id: 'f1', status: 'receiving', received: 80, total: 100 });
    notch.transfer({ id: 'f1', status: 'receiving', received: 30, total: 100 });
    assert.equal(notch.items.get('file:f1').progress, 80);
    notch.file({ id: 'f2', fromName: 'Alice', name: 'Other.zip', size: 100, thread: 'alice' });
    await assert.rejects(notch.action({ type: 'accept', key: 'file:f2' }), /expired/);
    pending.add('f2'); await notch.action({ type: 'decline', key: 'file:f2' }); assert(!notch.items.has('file:f2'));
    peer.activeCall = { id: 'call1', peerId: 'alice', phase: 'incoming' };
    notch.call({ type: 'offer', id: 'call1', peerId: 'alice', sdp: 'PRIVATE SDP' });
    notch.callPhase(null); assert(notch.items.has('call:call1'), 'A stale renderer update removed the current incoming call');
    assert(!JSON.stringify(notch.snapshot()).includes('PRIVATE SDP'));
    await notch.action({ type: 'select', key: 'file:f1' }); assert.equal(notch.selected().id, 'f1');
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
    let releaseDecision;
    notch.decideFile = () => new Promise(resolve => { releaseDecision = resolve; });
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

test('Lumi pause survives background updates, screen lock suspends it, and shutdown removes every listener/timer', async () => {
  const { notch, settings } = fixture();
  await notch.action({ type: 'move', delta: 200 }); assert(settings.notchPosition.fraction > .5);
  await notch.action({ type: 'reset' }); assert.equal(settings.notchPosition.fraction, .5);
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
  assert.equal(notch.powerMonitor.listenerCount('lock-screen'), 0); assert(notch.win.isDestroyed());
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
    await notch.action({ type: 'expand' }); assert.equal(notch.win.isFocused(), true);
    t.mock.timers.tick(4000); assert.equal(notch.mode, 'hidden');
    assert.equal(notch.win.isFocused(), false, 'The closed preview kept keyboard focus');
    assert.equal(notch.win.ignored, process.platform !== 'linux', 'The hidden transparent area still intercepts mouse clicks');
    notch.message({}, 'alice', 'Alice', 'Unread message');
    t.mock.timers.tick(4000); assert.equal(notch.mode, 'hidden');
    assert.equal(notch.items.get('message:alice').count, 1);
    settings.preview = true; notch.sync(); assert.equal(notch.mode, 'hidden', 'A privacy update reopened an expired preview');
    notch.file({ id: 'f1', fromName: 'Alice', name: 'Test.zip', size: 100, thread: 'alice' });
    t.mock.timers.tick(6999); assert.equal(notch.mode, 'expanded');
    t.mock.timers.tick(1); assert.equal(notch.mode, 'hidden');
    assert.equal(notch.snapshot().selected.actionable, true);
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
    assert.equal(notch.win.bounds.height, 185);
    t.mock.timers.tick(3000);
    await notch.action({ type: 'resize', height: 227, revision });
    assert.equal(notch.win.bounds.height, 227);
    t.mock.timers.tick(1000); assert.equal(notch.mode, 'hidden', 'Layout changes extended the preview deadline');
    assert.equal(await notch.action({ type: 'resize', height: 360, revision }), false);
    assert.equal(notch.win.bounds.height, 5, 'Stale layout expanded the hidden wake strip');
  } finally { notch.dispose(); }
});

test('Lumi focus respects Windows/macOS, X11 and Wayland capabilities', async t => {
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  const sessionType = process.env.XDG_SESSION_TYPE;
  for (const [platform, session] of [['win32', ''], ['darwin', ''], ['linux', 'x11'], ['linux', 'wayland']]) {
    await t.test(`${platform} ${session}`.trim(), async () => {
      let notch;
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
        assert.equal(notch.win.options.focusable, platform === 'linux');
        assert.equal(notch.win.options.type, platform === 'darwin' ? 'panel' : undefined, 'macOS needs a native panel to follow Spaces and fullscreen apps');
        assert.equal(notch.win.isFocused(), false, 'Automatic notifications must not steal focus');
        await notch.action({ type: 'expand' });
        assert.equal(notch.win.focusable, true);
        assert.equal(notch.win.isFocused(), true);
        assert.equal(notch.win.ignored, false, 'Manual expansion must allow pointer input');
        context.main.visible = true; notch.sync();
        assert.equal(notch.win.visible, false);
        assert.equal(notch.win.focusable, platform === 'linux');
        assert.equal(notch.win.isFocused(), false);
        context.main.fullScreen = true;
        assert.equal(notch.message({}, 'alice', 'Alice', 'Visible fullscreen chat'), false);
        context.main.visible = false;
        assert.equal(notch.message({}, 'alice', 'Alice', 'Hidden fullscreen chat'), true, 'A hidden fullscreen flag must not suppress background notifications');
        context.main.visible = true; context.main.minimized = true;
        assert.equal(notch.message({}, 'alice', 'Alice', 'Minimized fullscreen chat'), true);
        assert.equal(notch.win.isFocused(), false, 'Background notifications must keep the panel inactive');
      } finally {
        notch?.dispose();
        Object.defineProperty(process, 'platform', platformDescriptor);
        if (sessionType === undefined) delete process.env.XDG_SESSION_TYPE;
        else process.env.XDG_SESSION_TYPE = sessionType;
      }
    });
  }
});
