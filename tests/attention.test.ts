import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { AWAY_AFTER_SECONDS, attended, away, inFront, signalArrival } from '../src/main/attention.js';

function window({ visible = true, minimized = false, focused = true, destroyed = false } = {}) {
  const flashes: boolean[] = [];
  return { flashes, isDestroyed: () => destroyed, isVisible: () => visible, isMinimized: () => minimized, isFocused: () => focused,
    flashFrame: (flag: boolean) => { flashes.push(flag); } };
}

test('attention requires a visible, restored, focused window and recent input', () => {
  const idle = (seconds: number) => ({ getSystemIdleTime: () => seconds });
  assert.equal(attended(window(), idle(0)), true);
  assert.equal(attended(window(), idle(AWAY_AFTER_SECONDS - 1)), true);
  assert.equal(attended(window(), idle(AWAY_AFTER_SECONDS)), false, 'A focused window left alone for three minutes is not being watched');
  for (const state of [{ visible: false, focused: false }, { minimized: true, focused: false }, { focused: false }, { destroyed: true }]) {
    assert.equal(inFront(window(state)), false, JSON.stringify(state));
    assert.equal(attended(window(state), idle(0)), false, JSON.stringify(state));
  }
  assert.equal(attended(undefined, idle(0)), false);
});

test('an unavailable or invalid idle source falls back to focus alone', () => {
  for (const clock of [undefined, {}, { getSystemIdleTime: () => Number.NaN }, { getSystemIdleTime: () => Infinity },
    { getSystemIdleTime: () => -5 }, { getSystemIdleTime: () => { throw new Error('no idle service'); } }]) {
    assert.equal(away(clock), false);
    assert.equal(attended(window(), clock), true);
  }
});

test('arrival cues persist on Windows and macOS only while the window is behind others or minimized', () => {
  const bounces: string[] = [];
  const dock = { bounce: (type?: 'critical' | 'informational') => { bounces.push(type ?? 'informational'); return 1; } };
  const behind = window({ focused: false });
  assert.equal(signalArrival(behind, dock, 'win32'), true);
  assert.deepEqual(behind.flashes, [true]);
  const minimized = window({ minimized: true, focused: false });
  assert.equal(signalArrival(minimized, dock, 'win32'), true, 'A minimized taskbar button did not flash');
  for (const state of [{ focused: true }, { visible: false, focused: false }, { destroyed: true, focused: false }]) {
    const quiet = window(state);
    assert.equal(signalArrival(quiet, dock, 'win32'), false, JSON.stringify(state));
    assert.deepEqual(quiet.flashes, []);
  }
  assert.equal(signalArrival(window({ focused: false }), dock, 'darwin'), true);
  assert.deepEqual(bounces, ['informational'], 'macOS must bounce once instead of demanding attention until activated');
  assert.equal(signalArrival(window({ focused: false }), undefined, 'darwin'), false);
  const linux = window({ focused: false });
  assert.equal(signalArrival(linux, dock, 'linux'), false, 'Linux urgency hints duplicate notifications on GNOME');
  assert.deepEqual(linux.flashes, []);
  assert.equal(bounces.length, 1);
});

test('main reads the open conversation only while it is watched and asks the renderer to confirm a return', () => {
  const main = readFileSync(new URL('../src/main/main.js', import.meta.url), 'utf8');
  const between = (start: string, end: string) => {
    const from = main.indexOf(start), to = main.indexOf(end, from);
    assert(from >= 0 && to > from, `Missing main source between ${start} and ${end}`);
    return main.slice(from, to);
  };
  const reads: string[] = [], dismissed: string[] = [], sent: string[] = [];
  const handlers = new Map<string, () => unknown>();
  let syncs = 0;
  const state = { idle: 0, focused: true, visible: true };
  const win = { isDestroyed: () => false, isVisible: () => state.visible, isMinimized: () => false, isFocused: () => state.focused,
    flashFrame: (flag: boolean) => { sent.push(`flash:${flag}`); }, webContents: { send: (channel: string) => { sent.push(channel); } } };
  const context = vm.createContext({
    attended, signalArrival, app: {}, process: { platform: 'win32' }, window: win, reminderBlocks: new Set<string>(),
    powerMonitor: { getSystemIdleTime: () => state.idle }, currentThread: 'alice', openingThread: undefined,
    peer: { markRead: (thread: string) => { reads.push(thread); } }, dismiss: (thread: string) => { dismissed.push(thread); },
    notch: { sync: () => { syncs++; } }, handler: (name: string, action: () => unknown) => { handlers.set(name, action); },
  });
  vm.runInContext(`${between('let presentAt = 0;', 'let overlayCount')}
${between('function readingWindow()', 'function mainWindowVisible()')}
${between('function noticeArrival()', 'function notify(')}
${between("handler('present',", "handler('notification-settings'")}
globalThis.awaiting = () => awaitingPresence;`, context);
  const present = handlers.get('present');
  assert(present, 'Missing presence handler');
  const run = <T>(code: string) => vm.runInContext(code, context) as T;

  run('readCurrentThread()');
  assert.deepEqual(reads, ['alice'], 'A watched open conversation was not read');
  state.idle = 600; run('noticeArrival(); readCurrentThread()');
  assert.deepEqual(reads, ['alice'], 'An unattended focused window marked a new arrival read');
  assert.deepEqual(sent, ['lumilan:await-presence'], 'A focused window must not flash and must ask for the next real input');
  assert.equal(run('awaiting()'), true);
  assert.equal(present(), true);
  assert.deepEqual(reads, ['alice', 'alice'], 'Confirmed input did not read the open conversation despite a stale OS idle counter');
  assert.deepEqual(dismissed, ['alice', 'alice'], 'Reading did not dismiss the conversation notifications');
  assert.equal(syncs, 1, 'Lumi was not withdrawn after the person returned');
  assert.equal(present(), false, 'A second presence report was accepted without a new request');
  assert.equal(syncs, 1);
  assert.equal(run('readingWindow()'), true, 'Confirmed input did not count as recent activity');

  state.focused = false; sent.length = 0;
  run('noticeArrival()');
  assert.deepEqual(sent, ['flash:true'], 'A window behind others must flash without waiting for in-window input');
  assert.equal(run('awaiting()'), false);
  run('reminderBlocks.add("locked"); readCurrentThread()');
  assert.equal(reads.length, 2, 'A locked screen marked a conversation read');
});
