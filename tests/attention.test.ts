import test from 'node:test';
import assert from 'node:assert/strict';
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
