import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { NotificationConstructorOptions } from 'electron';
import { FocusTimer, focusMinutes, focusSummary, readFocusSession, type FocusEnd, type FocusSession } from '../src/main/focus.js';
import { Notifier, type NotifierNotch, type NotifierPeer, type NotifierWindow } from '../src/main/notifications.js';
import { parseSettings } from '../src/main/settings.js';
import { translate } from '../src/renderer/i18n.js';
import type { Status, TextMessage } from '../src/shared/model.js';

const MINUTE = 60_000;
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

// The focus timer alone, with an in-memory store that can fail like a full disk.
function fixture(saved?: unknown) {
  const store = { saved, failRead: false, failWrite: false, failStatus: false };
  const peer = { status: 'active' as Status };
  const statuses: Status[] = [], changes: unknown[] = [], ends: FocusEnd[] = [];
  const timer = new FocusTimer({
    read: () => { if (store.failRead) throw new Error('ENOENT'); return store.saved; },
    write: session => { if (store.failWrite) throw new Error('disk full'); store.saved = session === null ? null : JSON.parse(JSON.stringify(session)); },
    getStatus: () => peer.status,
    setStatus: status => { if (store.failStatus) throw new Error('state.json'); peer.status = status; statuses.push(status); },
    onChange: view => changes.push(view), onEnd: end => ends.push(end),
  });
  return { timer, store, peer, statuses, changes, ends };
}

// The timer wired to the real notification policy the way main wires them.
function presented() {
  const banners: Banner[] = [], opened: (string | undefined)[] = [], reads: string[] = [], lumi: Array<{ count: number; threads: number; thread: string; body: string }> = [];
  class Banner extends EventEmitter {
    static isSupported() { return true; }
    shown = false;
    constructor(readonly options: NotificationConstructorOptions) { super(); banners.push(this); }
    show() { this.shown = true; }
    close() { this.emit('close'); }
  }
  // Visible but behind other windows: nobody is reading it.
  const view = { focused: false };
  const window: NotifierWindow = { isDestroyed: () => false, isVisible: () => true, isMinimized: () => false, isFocused: () => view.focused,
    flashFrame: () => {}, showInactive: () => {}, webContents: { send: () => {}, isLoading: () => false } };
  const peer: NotifierPeer & { state: { status: Status } } = { id: 'me', state: { status: 'active', mutedThreads: [], messages: [], unread: {}, reminders: [] },
    trusted: new Map([['alice', { name: 'Alice' }], ['bob', { name: 'Bob' }]]), room: () => undefined,
    markRead: thread => { reads.push(thread); }, reminders: { tick: () => {} } };
  const handled = { focus: false };
  const notch: NotifierNotch = { ready: true, eligible: () => false, sync: () => true, dismiss: () => {}, message: () => false, reminder: () => false, file: () => false,
    focusDone: (summary, body) => { lumi.push({ ...summary, body }); return handled.focus; }, water: () => false };
  const settings = parseSettings({ preview: true, focus: 25 }, 'ID');
  const notifier = new Notifier({ Notification: Banner, powerMonitor: { getSystemIdleTime: () => 0 }, getWindow: () => window, getPeer: () => peer,
    getSettings: () => settings, getNotch: () => notch, isQuitting: () => false, reveal: thread => { opened.push(thread); },
    translate: (source, values) => translate('id', source, values) });
  const timer = new FocusTimer({ read: () => undefined, write: () => {}, getStatus: () => peer.state.status,
    setStatus: status => { peer.state.status = status; }, onChange: () => {}, onEnd: end => notifier.focus(end) });
  let sequence = 0;
  const arrive = (from: string, fields: Partial<TextMessage> = {}) => {
    const message: TextMessage = { id: `m${++sequence}`, kind: 'text', from, to: 'me', at: Date.now(), text: 'Rencana rahasia', ...fields };
    const thread = message.roomId ? `room:${message.roomId}` : from;
    peer.state.messages.push(message);
    if (from !== 'me') peer.state.unread[thread] = (peer.state.unread[thread] || 0) + 1;
    notifier.message(message);
  };
  return { notifier, timer, peer, settings, banners, opened, reads, lumi, handled, view, arrive };
}

test('focus lengths are whole minutes from 5 to 180', () => {
  assert.equal(focusMinutes(5), 5); assert.equal(focusMinutes(180), 180);
  for (const value of [4, 181, 25.5, '25', Number.NaN, Infinity, -25, null, undefined, {}])
    assert.throws(() => focusMinutes(value), /5–180/, String(value));
});

test('start sets Do not disturb and stores the session; the deadline restores the previous status and ends once', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const f = fixture(); f.peer.status = 'busy';
  assert.deepEqual(f.timer.start(25), { minutes: 25, until: 1_000_000 + 25 * MINUTE, remaining: 25 * MINUTE, paused: false });
  assert.equal(f.peer.status, 'dnd');
  assert.deepEqual(f.store.saved, { minutes: 25, startedAt: 1_000_000, until: 1_000_000 + 25 * MINUTE, previous: 'busy' });
  assert.throws(() => f.timer.start(45), /sudah berjalan/);
  t.mock.timers.tick(25 * MINUTE - 1);
  assert.deepEqual([f.peer.status, f.ends.length], ['dnd', 0]);
  t.mock.timers.tick(1);
  assert.deepEqual(f.statuses, ['dnd', 'busy'], 'The previous status was not restored');
  assert.equal(f.store.saved, null, 'An ended session stayed stored');
  assert.deepEqual(f.ends, [{ startedAt: 1_000_000, endedAt: 1_000_000 + 25 * MINUTE }]);
  assert.equal(f.timer.timer, undefined, 'An idle timer kept running');
  assert.equal(f.changes.at(-1), undefined);
  assert.equal(f.timer.end(), false); f.timer.check();
  assert.equal(f.ends.length, 1, 'The summary was requested twice');
});

test('invalid lengths change nothing', () => {
  const f = fixture();
  for (const value of [0, 4, 181, 25.5, '25', Number.NaN]) assert.throws(() => f.timer.start(value), /5–180/);
  assert.deepEqual([f.peer.status, f.timer.session, f.store.saved, f.changes.length], ['active', undefined, undefined, 0]);
});

test('pause keeps Do not disturb without a timer, and resume continues from the remaining time', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const f = fixture();
  f.timer.start(25); t.mock.timers.tick(10 * MINUTE);
  assert.deepEqual(f.timer.pause(), { minutes: 25, until: undefined, remaining: 15 * MINUTE, paused: true });
  assert.deepEqual(f.store.saved, { minutes: 25, startedAt: 0, remaining: 15 * MINUTE, previous: 'active' });
  assert.equal(f.timer.timer, undefined, 'A paused session kept a timer');
  assert.throws(() => f.timer.pause(), /tidak sedang berjalan/);
  t.mock.timers.tick(60 * MINUTE);
  assert.deepEqual([f.ends.length, f.peer.status], [0, 'dnd'], 'A paused session ended or dropped Do not disturb');
  assert.deepEqual(f.timer.resume(), { minutes: 25, until: 85 * MINUTE, remaining: 15 * MINUTE, paused: false });
  assert.throws(() => f.timer.resume(), /tidak sedang dijeda/);
  t.mock.timers.tick(15 * MINUTE);
  assert.deepEqual(f.ends, [{ startedAt: 0, endedAt: 85 * MINUTE }]);
  assert.equal(f.peer.status, 'active');
});

test('ending early restores only the session\'s own Do not disturb', () => {
  const early = fixture(); early.peer.status = 'away';
  early.timer.start(45);
  assert.equal(early.timer.end(), true);
  assert.deepEqual([early.peer.status, early.ends.length, early.store.saved], ['away', 1, null]);

  const changed = fixture();
  changed.timer.start(45); changed.peer.status = 'busy'; // Chosen by the person during the session.
  changed.timer.end();
  assert.equal(changed.peer.status, 'busy', 'A status chosen during the session was overwritten');
  assert.deepEqual(changed.statuses, ['dnd']);

  const already = fixture(); already.peer.status = 'dnd';
  already.timer.start(25); already.timer.end();
  assert.deepEqual([already.peer.status, already.statuses], ['dnd', []], 'An existing Do not disturb was changed');
});

test('restart continues a stored session, ends a missed one once, and ignores damaged data', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 10 * MINUTE });
  const running = fixture({ minutes: 25, startedAt: 0, until: 25 * MINUTE, previous: 'away' }); running.peer.status = 'dnd';
  running.timer.restore();
  assert.deepEqual(running.timer.view(), { minutes: 25, until: 25 * MINUTE, remaining: 15 * MINUTE, paused: false });
  t.mock.timers.tick(15 * MINUTE);
  assert.deepEqual([running.peer.status, running.ends.length], ['away', 1]);

  const missed = fixture({ minutes: 5, startedAt: 0, until: 5 * MINUTE, previous: 'busy' }); missed.peer.status = 'dnd';
  missed.timer.restore();
  assert.deepEqual([missed.peer.status, missed.store.saved], ['busy', null], 'A deadline passed while closed did not end the session');
  assert.deepEqual(missed.ends, [{ startedAt: 0, endedAt: 25 * MINUTE }]);
  const again = fixture(missed.store.saved); again.peer.status = 'busy';
  again.timer.restore();
  assert.deepEqual([again.ends.length, again.statuses.length], [0, 0], 'A second restart repeated the ended session');

  const paused = fixture({ minutes: 60, startedAt: 0, remaining: 20 * MINUTE, previous: 'active' });
  paused.timer.restore();
  assert.deepEqual(paused.timer.view(), { minutes: 60, until: undefined, remaining: 20 * MINUTE, paused: true });
  assert.equal(paused.timer.timer, undefined);

  for (const value of [null, 'session', [], {}, { minutes: 25, startedAt: 0, previous: 'active' }, { minutes: 25, startedAt: 0, until: 1, remaining: 1, previous: 'active' },
    { minutes: 500, startedAt: 0, until: 1, previous: 'active' }, { minutes: 25, startedAt: 0, until: 1, previous: 'offline' }, { minutes: 25, startedAt: -1, until: 1, previous: 'active' },
    { minutes: 25, startedAt: 0, until: '1', previous: 'active' }]) assert.equal(readFocusSession(value), undefined, JSON.stringify(value));
  assert.equal(readFocusSession({ minutes: 25, startedAt: 0, until: 1e12, previous: 'active' }, 0)?.until, 25 * MINUTE, 'A clock moved back extended Do not disturb');
  assert.equal(readFocusSession({ minutes: 25, startedAt: 0, remaining: 1e12, previous: 'active' }, 0)?.remaining, 25 * MINUTE);
  const unreadable = fixture(); unreadable.store.failRead = true;
  assert.doesNotThrow(() => unreadable.timer.restore());
  assert.equal(unreadable.timer.session, undefined);
});

test('storage failures never leave a half-started session, and an ended session still restores the status', t => {
  t.mock.method(console, 'warn', () => {});
  const disk = fixture(); disk.store.failWrite = true;
  assert.throws(() => disk.timer.start(25), /disk full/);
  assert.deepEqual([disk.peer.status, disk.timer.session, disk.changes.length], ['active', undefined, 0]);

  const state = fixture(); state.store.failStatus = true;
  assert.throws(() => state.timer.start(25), /state\.json/);
  assert.deepEqual([state.peer.status, state.timer.session, state.store.saved, state.timer.timer], ['active', undefined, null, undefined], 'A failed status change left a session behind');

  const pause = fixture(); pause.timer.start(25); pause.store.failWrite = true;
  assert.throws(() => pause.timer.pause(), /disk full/);
  assert.equal(pause.timer.view()?.paused, false, 'An unsaved pause changed the running session');

  const end = fixture(); end.timer.start(25); end.store.failWrite = true;
  end.timer.end();
  assert.deepEqual([end.peer.status, end.ends.length, end.timer.session], ['active', 1, undefined]);
});

test('the summary counts unread arrivals from the session only, without names, mute or own messages', () => {
  let sequence = 0;
  const message = (fields: Partial<TextMessage>): TextMessage => ({ id: `m${++sequence}`, kind: 'text', from: 'alice', to: 'me', at: 1000, text: 'x', ...fields });
  const state = { mutedThreads: ['carol'], unread: { alice: 1, bob: 2, carol: 3, 'room:r1': 1, announcements: 1 } as Record<string, number>, messages: [
    message({ at: 999 }), message({}), message({}), message({ from: 'bob' }), message({ from: 'bob' }), message({ from: 'carol' }), message({ from: 'me', to: 'alice' }),
    message({ from: 'dave' }), message({ roomId: 'r1', to: null }), message({ kind: 'announcement', to: null, from: 'erin' }), message({ at: 2001 }) ] };
  // Alice: two arrivals but only one still unread. Dave was read meanwhile. Carol is muted.
  assert.deepEqual(focusSummary(state, 'me', { startedAt: 1000, endedAt: 2000 }), { count: 5, threads: 4, thread: 'inbox' });
  assert.deepEqual(focusSummary({ ...state, unread: { bob: 2 } }, 'me', { startedAt: 1000, endedAt: 2000 }), { count: 2, threads: 1, thread: 'bob' });
  assert.deepEqual(focusSummary({ ...state, unread: {} }, 'me', { startedAt: 1000, endedAt: 2000 }), { count: 0, threads: 0, thread: 'inbox' });
});

test('lock → suspend → resume → unlock: the session ends on time, and its summary waits for the last block, once', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const f = presented();
  f.timer.start(25);
  f.arrive('alice'); f.arrive('alice'); f.arrive('bob'); f.arrive('me');
  assert.equal(f.banners.length, 0, 'Do not disturb let a message through');
  f.notifier.block('locked'); f.notifier.block('suspended');
  t.mock.timers.tick(25 * MINUTE);
  assert.equal(f.peer.state.status, 'active', 'Lock or suspend stopped the session');
  assert.deepEqual([f.banners.length, f.lumi.length], [0, 0], 'The summary appeared while blocked');
  f.notifier.unblock('suspended'); f.timer.check(); await flush();
  assert.equal(f.banners.length, 0, 'Resume alone showed the summary on a locked screen');
  delete f.peer.state.unread.bob; // Read on another path while locked.
  f.notifier.unblock('locked'); await flush();
  assert.deepEqual(f.lumi, [{ count: 2, threads: 1, thread: 'alice', body: '2 pesan dari 1 percakapan' }]);
  assert.deepEqual([f.banners[0]?.options.title, f.banners[0]?.options.body], ['Sesi fokus selesai', '2 pesan dari 1 percakapan']);
  assert.deepEqual([f.reads, f.peer.state.unread.alice], [[], 2], 'The summary marked messages read');
  f.banners[0]!.emit('click');
  assert.deepEqual(f.opened, ['alice']);
  f.notifier.unblock('locked'); f.notifier.unblock('suspended'); await flush();
  assert.equal(f.banners.length, 1, 'A repeated unlock replayed the summary');
});

test('suspend → lock → unlock → resume shows one summary after resume, with the current privacy setting', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const f = presented();
  f.timer.start(5); f.arrive('alice'); f.arrive('bob');
  f.notifier.block('suspended'); f.notifier.block('locked');
  t.mock.timers.tick(5 * MINUTE);
  f.notifier.unblock('locked'); await flush();
  assert.equal(f.banners.length, 0, 'Unlock alone showed the summary while suspended');
  f.settings.preview = false;
  f.notifier.unblock('suspended'); f.timer.check(); await flush();
  assert.deepEqual([f.banners.length, f.banners[0]?.options.title, f.banners[0]?.options.body], [1, 'Lumilan Chat', 'Sesi fokus selesai.']);
  assert(!/rahasia|Alice|Bob/.test(JSON.stringify(f.banners[0]?.options)), 'The summary leaked a name or message text');
  assert.equal(f.opened.length, 0);
});

test('the summary uses Lumi when it can, and stays away for Do not disturb, disabled notifications or a watched window', async () => {
  const lumi = presented(); lumi.handled.focus = true;
  lumi.timer.start(25); lumi.arrive('alice'); lumi.timer.end();
  assert.deepEqual([lumi.lumi.length, lumi.banners.length], [1, 0], 'Lumi showed the summary and a banner too');

  const cases: [string, (f: ReturnType<typeof presented>) => void][] = [
    ['dnd before', f => { f.peer.state.status = 'dnd'; }], ['disabled', f => { f.settings.enabled = false; }], ['watched', f => { f.view.focused = true; }]];
  for (const [label, setup] of cases) {
    const f = presented(); setup(f);
    f.timer.start(25); f.arrive('alice'); f.timer.end(); await flush();
    assert.deepEqual([f.banners.length, f.lumi.length], [0, 0], label);
  }
  const empty = presented();
  empty.timer.start(25); empty.timer.end();
  assert.deepEqual([empty.banners[0]?.options.title, empty.banners[0]?.options.body], ['Sesi fokus selesai', 'Tidak ada pesan baru.']);
});
