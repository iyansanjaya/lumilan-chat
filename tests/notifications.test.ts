import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { NotificationConstructorOptions } from 'electron';
import { Notifier, type FileOffer, type NotifierNotch, type NotifierPeer, type NotifierWindow } from '../src/main/notifications.js';
import { parseSettings } from '../src/main/settings.js';
import { translate } from '../src/renderer/i18n.js';
import type { Message, ReminderRecord, TextMessage } from '../src/shared/model.js';
import type { RoutineView } from '../src/shared/notch.js';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

function withPlatform(platform: NodeJS.Platform, run: () => void) {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  try { Object.defineProperty(process, 'platform', { ...descriptor, value: platform }); run(); }
  finally { Object.defineProperty(process, 'platform', descriptor!); }
}

function fixture() {
  const banners: Banner[] = [], sent: string[] = [], reads: string[] = [], dismissed: string[] = [], opened: (string | undefined)[] = [], files: string[] = [];
  const env = { supported: true, throwOnShow: false };
  class Banner extends EventEmitter {
    static isSupported() { return env.supported; }
    shown = false; closed = false;
    constructor(readonly options: NotificationConstructorOptions) { super(); banners.push(this); }
    show() { if (env.throwOnShow) throw new Error('blocked by system'); this.shown = true; }
    close() { this.closed = true; this.emit('close'); }
  }
  // The person is watching by default: visible, restored, focused and recently active.
  const view = { visible: true, minimized: false, focused: true, loading: false };
  const window: NotifierWindow = { isDestroyed: () => false, isVisible: () => view.visible, isMinimized: () => view.minimized, isFocused: () => view.focused,
    flashFrame: flag => { sent.push(`flash:${flag}`); }, showInactive: () => { sent.push('showInactive'); view.visible = true; },
    webContents: { send: (channel: string) => { sent.push(channel); }, isLoading: () => view.loading } };
  const counts = { syncs: 0, ticks: 0 };
  const peer: NotifierPeer = { id: 'me', state: { status: 'active', mutedThreads: [], messages: [], unread: {}, reminders: [] },
    trusted: new Map([['alice', { name: 'Alice' }], ['bob', { name: 'Bob' }]]), room: () => undefined,
    markRead: (thread: string) => { reads.push(thread); }, reminders: { tick: () => { counts.ticks++; } } };
  const handled = { message: false, file: false, focus: false, water: false };
  const waters: string[] = [];
  const routine: { view: RoutineView | undefined } = { view: undefined };
  const summaries: Array<{ count: number; threads: number; thread: string; body: string }> = [];
  const notch: NotifierNotch = { ready: false, eligible: () => false, sync: () => { counts.syncs++; return true; },
    dismiss: (thread: string) => { dismissed.push(thread); }, message: () => handled.message, reminder: () => false,
    file: offer => { files.push(offer.id); return handled.file; },
    focusDone: (summary, body) => { summaries.push({ ...summary, body }); return handled.focus; },
    water: body => { waters.push(body); return handled.water; } };
  const settings = parseSettings({ preview: true }, 'ID');
  const clock = { idle: 0 };
  const notifier = new Notifier({ Notification: Banner, powerMonitor: { getSystemIdleTime: () => clock.idle }, getWindow: () => window, getPeer: () => peer,
    getSettings: () => settings, getNotch: () => notch, getRoutine: () => routine.view, isQuitting: () => false, reveal: thread => { opened.push(thread); },
    translate: (source, values) => translate('id', source, values) });
  let sequence = 0;
  const message = (fields: Partial<TextMessage> = {}): Message => ({ id: `m${++sequence}`, kind: 'text', from: 'alice', to: 'me', at: Date.now(), text: 'Halo', ...fields });
  const reminder = (fields: Partial<ReminderRecord> = {}): ReminderRecord => ({ id: `r${++sequence}`, kind: 'local', from: 'me', to: 'me', createdAt: 0, status: 'due',
    title: 'Bayar listrik', note: '', dueAt: 0, ...fields });
  return { notifier, banners, sent, reads, dismissed, opened, files, env, view, counts, peer, handled, notch, settings, clock, message, reminder, summaries, waters, routine };
}

test('reads the open conversation only while watched and asks the renderer to confirm a return', () => withPlatform('win32', () => {
  const f = fixture();
  f.notifier.currentThread = 'alice';
  f.notifier.readCurrentThread();
  assert.deepEqual(f.reads, ['alice'], 'A watched open conversation was not read');
  f.clock.idle = 600; f.notifier.noticeArrival(); f.notifier.readCurrentThread();
  assert.deepEqual(f.reads, ['alice'], 'An unattended focused window marked a new arrival read');
  assert.deepEqual(f.sent, ['lumilan:await-presence'], 'A focused window must not flash and must ask for the next real input');
  assert.equal(f.notifier.awaitingPresence, true);
  assert.equal(f.notifier.present(), true);
  assert.deepEqual(f.reads, ['alice', 'alice'], 'Confirmed input did not read the open conversation despite a stale OS idle counter');
  assert.deepEqual(f.dismissed, ['alice', 'alice'], 'Reading did not dismiss the conversation notifications');
  assert.equal(f.counts.syncs, 1, 'Lumi was not withdrawn after the person returned');
  assert.equal(f.notifier.present(), false, 'A second presence report was accepted without a new request');
  assert.equal(f.counts.syncs, 1);
  assert.equal(f.notifier.readingWindow(), true, 'Confirmed input did not count as recent activity');

  f.view.focused = false; f.sent.length = 0;
  f.notifier.noticeArrival();
  assert.deepEqual(f.sent, ['flash:true'], 'A window behind others must flash without waiting for in-window input');
  assert.equal(f.notifier.awaitingPresence, false);
  f.view.focused = true; f.notifier.block('locked'); f.notifier.readCurrentThread();
  assert.equal(f.reads.length, 2, 'A locked screen marked a conversation read');
}));

test('lock → suspend → resume → unlock replays deferred messages and reminders once, after the last block clears', async () => {
  const f = fixture(); f.view.focused = false;
  const arrival = f.message(); f.peer.state.messages.push(arrival); f.peer.state.unread.alice = 1;
  const due = f.reminder(); f.peer.state.reminders.push(due);
  f.notifier.block('locked'); f.notifier.block('suspended');
  f.notifier.message(arrival); f.notifier.reminder({ type: 'due', items: [due] });
  assert.equal(f.banners.length, 0, 'A banner appeared while blocked');
  f.notifier.unblock('suspended'); await flush();
  assert.equal(f.banners.length, 0, 'Resume alone replayed while the screen was still locked');
  f.notifier.unblock('locked'); await flush();
  assert.deepEqual(f.banners.map(b => b.options.title), ['Alice', 'Pengingat terlewat'], 'Deferred arrivals were not combined once after unlock');
  assert.equal(f.counts.ticks, 1);
  assert.equal(f.notifier.deferredMessages.size + f.notifier.deferredReminders.size, 0);
  f.notifier.unblock('locked'); await flush();
  assert.equal(f.banners.length, 2, 'A repeated unlock replayed already notified arrivals');
});

test('suspend → lock → unlock → resume replays once and rechecks unread state and reminder status', async () => {
  const f = fixture(); f.view.focused = false;
  const read = f.message({ from: 'alice' }), unread = f.message({ from: 'bob' });
  f.peer.state.messages.push(read, unread);
  const request = f.reminder({ kind: 'incoming', from: 'alice', status: 'pending' }), due = f.reminder();
  f.peer.state.reminders.push(request, due);
  f.notifier.block('suspended'); f.notifier.block('locked');
  f.notifier.message(read); f.notifier.message(unread);
  f.notifier.reminder({ type: 'request', items: [request] }); f.notifier.reminder({ type: 'due', items: [due] });
  f.notifier.unblock('locked'); await flush();
  assert.equal(f.banners.length, 0, 'Unlock alone replayed while the device was still suspended');
  // While blocked, Alice's message was read elsewhere and her reminder request was canceled.
  f.peer.state.unread = { bob: 1 }; request.status = 'canceled';
  f.notifier.unblock('suspended'); await flush();
  assert.deepEqual(f.banners.map(b => b.options.title), ['Bob', 'Pengingat terlewat']);
});

test('blocking closes live message, reminder and call banners, and the test notification reports the block', async () => {
  const f = fixture(); f.view.focused = false;
  const due = f.reminder(); f.peer.state.reminders.push(due);
  f.notifier.message(f.message()); f.notifier.reminder({ type: 'due', items: [due] }); f.notifier.callOffer('alice');
  assert.equal(f.banners.length, 3);
  f.notifier.block('locked');
  assert(f.banners.every(banner => banner.closed), 'A banner stayed on a locked screen');
  assert.deepEqual(await f.notifier.test(), { shown: false, error: 'Notifikasi ditunda selama layar terkunci atau perangkat tidur.' });
});

test('hidden previews are redacted; mute, Do not disturb, disabled notifications and a Lumi card suppress the banner', () => {
  const f = fixture(); f.view.focused = false; f.settings.preview = false;
  f.notifier.message(f.message({ text: 'Rencana rahasia' }));
  assert.deepEqual([f.banners[0]?.options.title, f.banners[0]?.options.body], ['Lumilan Chat', 'Pesan baru diterima']);
  assert(!JSON.stringify(f.banners[0]?.options).includes('rahasia'), 'A hidden preview leaked message text');
  const cases: [string, (q: ReturnType<typeof fixture>) => void][] = [
    ['muted', q => { q.peer.state.mutedThreads.push('alice'); }], ['dnd', q => { q.peer.state.status = 'dnd'; }],
    ['disabled', q => { q.settings.enabled = false; }], ['Lumi', q => { q.handled.message = true; }]];
  for (const [label, setup] of cases) {
    const q = fixture(); q.view.focused = false; setup(q);
    q.notifier.message(q.message());
    assert.equal(q.banners.length, 0, label);
  }
});

test('an arrival in the open, watched conversation is read instead of shown, unless it is still opening or loading', () => {
  const f = fixture(); f.notifier.currentThread = 'alice';
  f.notifier.message(f.message());
  assert.deepEqual(f.reads, ['alice']); assert.equal(f.banners.length, 0);
  f.notifier.openingThread = 'alice'; f.notifier.message(f.message());
  assert.equal(f.banners.length, 1, 'A conversation that is still opening swallowed the arrival');
  f.notifier.openingThread = undefined; f.view.loading = true; f.notifier.message(f.message());
  assert.equal(f.banners.length, 2, 'A loading window swallowed the arrival');
  assert.deepEqual(f.reads, ['alice']);
});

test('the test notification resolves on show, failure, a throw and the 5 second timeout, and tracks the error', async t => {
  const f = fixture();
  const shown = f.notifier.test(); f.banners.at(-1)!.emit('show');
  assert.deepEqual(await shown, { shown: true }); assert.equal(f.notifier.error, '');
  const failed = f.notifier.test(); f.banners.at(-1)!.emit('failed', {}, 'denied');
  assert.deepEqual(await failed, { shown: false, error: 'denied' }); assert.equal(f.notifier.error, 'denied');
  f.env.throwOnShow = true;
  assert.deepEqual(await f.notifier.test(), { shown: false, error: 'blocked by system' });
  f.env.throwOnShow = false;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const silent = f.notifier.test(); t.mock.timers.tick(5000);
  assert.deepEqual(await silent, { shown: false, error: 'Sistem tidak mengonfirmasi notifikasi. Periksa izin notifikasi aplikasi.' });
  f.peer.state.status = 'dnd';
  assert.deepEqual(await f.notifier.test(), { shown: false, error: 'Status Jangan ganggu sedang aktif.' });
  f.env.supported = false;
  assert.deepEqual(await f.notifier.test(), { shown: false, error: 'Notifikasi desktop tidak tersedia pada sistem ini.' });
});

test('file and call offers reach Lumi first, stay quiet while blocked, muted or in DND, and can reveal the window', () => {
  const offer: FileOffer = { id: 'f1', from: 'alice', fromName: 'Alice', name: 'rencana.pdf', size: 10, thread: 'alice' };
  const f = fixture(); f.view.focused = false;
  const banner = f.notifier.fileOffer(offer);
  assert.deepEqual(f.files, ['f1']);
  assert.equal(banner, f.banners[0], 'The caller did not receive the banner it must close later');
  assert.equal(f.banners[0]?.options.body, 'Terima file rencana.pdf dari Alice?');
  f.banners[0]!.emit('click'); assert.deepEqual(f.opened, ['alice']);
  f.handled.file = true;
  assert.equal(f.notifier.fileOffer({ ...offer, id: 'f2' }), undefined, 'Lumi and a native banner both asked for consent');
  assert.deepEqual(f.files, ['f1', 'f2']);

  const quiet: [string, (q: ReturnType<typeof fixture>) => void][] = [
    ['blocked', q => { q.notifier.block('locked'); }], ['muted', q => { q.peer.state.mutedThreads.push('alice'); }], ['dnd', q => { q.peer.state.status = 'dnd'; }]];
  for (const [label, setup] of quiet) {
    const q = fixture(); q.view.focused = false; setup(q);
    assert.equal(q.notifier.fileOffer(offer), undefined, label);
    assert.deepEqual(q.files, ['f1'], `${label}: Lumi must still receive the request`);
    q.notifier.callOffer('alice');
    assert.equal(q.banners.length, 0, label);
  }

  const hidden = fixture(); hidden.env.supported = false; hidden.view.visible = false; hidden.view.focused = false;
  assert.equal(hidden.notifier.fileOffer(offer), undefined);
  assert(hidden.sent.includes('showInactive'), 'Without system notifications a pending request did not reveal the window');

  f.notifier.callOffer('alice');
  const call = f.banners.at(-1)!;
  assert.equal(call.options.title, 'Panggilan suara masuk');
  call.emit('click'); assert.equal(f.opened.at(-1), 'alice');
  f.notifier.closeCallBanner(); assert(call.closed);
  f.notch.ready = true; f.notch.eligible = () => true;
  const count = f.banners.length; f.notifier.callOffer('alice');
  assert.equal(f.banners.length, count, 'A ready Lumi must own the call card');
});

test('reminder banners are pruned when answered or silenced, and banners can be closed per thread or all at once', () => {
  const f = fixture(); f.view.focused = false;
  const due = f.reminder(); f.peer.state.reminders.push(due);
  f.notifier.reminder({ type: 'due', items: [due] });
  const first = f.banners.at(-1)!;
  f.notifier.prune(); assert.equal(first.closed, false, 'A reminder that is still due lost its banner');
  due.status = 'done'; f.notifier.prune(); assert(first.closed, 'A finished reminder kept its banner');
  due.status = 'due'; f.notifier.reminder({ type: 'due', items: [due] });
  const second = f.banners.at(-1)!;
  f.settings.enabled = false; f.notifier.prune(); assert(second.closed, 'Disabling notifications kept a reminder banner');
  f.settings.enabled = true; f.notifier.reminder({ type: 'due', items: [due] });
  f.notifier.closeReminders(); assert(f.banners.at(-1)!.closed); assert.equal(f.notifier.reminderNotifications.size, 0);

  f.notifier.message(f.message({ from: 'alice' })); f.notifier.message(f.message({ from: 'bob' }));
  const [alice, bob] = f.banners.slice(-2);
  f.notifier.dismiss('alice'); assert(alice!.closed && !bob!.closed);
  f.notifier.dismissAll(); assert(bob!.closed); assert.equal(f.notifier.activeNotifications.size, 0);
});

test('water reminders wait for lock and suspend in either order, show once, and are rechecked when shown', async () => {
  const f = fixture();
  const view = (fields: Partial<RoutineView> = {}): RoutineView => ({ settings: { enabled: true, servingMl: 250, goalMl: 2000, startHour: 8, endHour: 22, intervalMinutes: 60 },
    todayMl: 500, percent: 25, reached: false, hours: Array<number>(24).fill(0), nextAt: undefined, ...fields });
  f.routine.view = view();
  f.notifier.water();
  assert.deepEqual(f.waters, ['0.5 / 2.0 L']);
  assert.deepEqual(f.banners.map(b => [b.options.title, b.options.body, b.options.silent]), [['Waktunya minum', '0.5 / 2.0 L', false]], 'Without a Lumi card the system banner was not shown');
  f.banners[0]!.emit('click'); assert.deepEqual(f.opened, ['routine']);
  f.handled.water = true; f.notifier.water();
  assert.equal(f.banners.length, 1, 'A Lumi card was duplicated by a system banner');
  for (const order of [['locked', 'suspended'], ['suspended', 'locked']]) {
    f.waters.length = 0;
    for (const reason of order) f.notifier.block(reason);
    f.notifier.water(); f.notifier.water();
    assert.deepEqual(f.waters, [], 'A water reminder appeared while blocked');
    f.notifier.unblock(order[0]!); await flush();
    assert.deepEqual(f.waters, [], 'One block ending replayed the reminder early');
    f.notifier.unblock(order[1]!); await flush();
    assert.deepEqual(f.waters, ['0.5 / 2.0 L'], `${order.join(' then ')}: slots missed while blocked were not shown once`);
    f.notifier.unblock(order[1]!); await flush();
    assert.equal(f.waters.length, 1, 'A repeated unblock replayed the reminder');
  }
  f.waters.length = 0;
  f.notifier.block('locked'); f.notifier.water(); f.routine.view = view({ todayMl: 2000, percent: 100, reached: true });
  f.notifier.unblock('locked'); await flush();
  assert.deepEqual(f.waters, [], 'A goal reached while locked still reminded');
  f.routine.view = view();
  f.peer.state.status = 'dnd'; f.notifier.water();
  f.peer.state.status = 'active'; f.settings.enabled = false; f.notifier.water();
  f.settings.enabled = true; f.routine.view = view({ settings: { ...view().settings, enabled: false } }); f.notifier.water();
  assert.deepEqual(f.waters, [], 'Do not disturb, disabled notifications or disabled reminders still reminded');
});
