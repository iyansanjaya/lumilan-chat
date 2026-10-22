import test from 'node:test';
import assert from 'node:assert/strict';
import { BREAK_DEFAULTS, BREAK_GRACE, BreakTimer, breakSettings } from '../src/main/breaks.js';
import type { BreakSettings, BreakView } from '../src/shared/notch.js';

const MINUTE = 60_000, NOW = Date.UTC(2026, 9, 22, 2);
const on: BreakSettings = { ...BREAK_DEFAULTS, enabled: true };

function fixture(saved?: unknown) {
  const store = { saved, failWrite: false, writes: 0 };
  const env = { idle: 0, canStart: true };
  const dues: number[] = [], starts: number[] = [], ends: boolean[] = [], views: BreakView[] = [];
  const breaks = new BreakTimer({
    read: () => store.saved,
    write: settings => { if (store.failWrite) throw new Error('disk full'); store.writes++; store.saved = JSON.parse(JSON.stringify(settings)); },
    idleSeconds: () => env.idle, canStart: () => env.canStart,
    onChange: view => views.push(view), onDue: () => dues.push(Date.now()),
    onBreakStart: until => starts.push(until), onBreakEnd: finished => ends.push(finished),
  });
  return { breaks, store, env, dues, starts, ends, views };
}

test('break settings accept only the offered lengths with exactly their own fields', () => {
  assert.deepEqual(breakSettings({ ...on }), on);
  for (const workMinutes of [25, 30, 45, 60, 90]) for (const breakMinutes of [5, 10, 15, 30]) breakSettings({ ...on, workMinutes, breakMinutes });
  for (const value of [null, [], {}, { ...on, extra: 1 }, { enabled: true, workMinutes: 45 }, { ...on, enabled: 'yes' }, { ...on, workMinutes: 40 }, { ...on, workMinutes: '45' },
    { ...on, breakMinutes: 20 }, { ...on, breakMinutes: 10.5 }, { ...on, workMinutes: Number.NaN }])
    assert.throws(() => breakSettings(value), /rehat tidak valid/, JSON.stringify(value));
});

test('a launch starts a fresh cycle whatever was saved, and a disabled feature keeps no timer', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NOW });
  const off = fixture();
  off.breaks.restore();
  assert.equal(off.breaks.timer, undefined, 'A disabled feature kept a timer');
  assert.deepEqual(off.breaks.view(), { settings: BREAK_DEFAULTS, phase: 'work', nextAt: undefined, until: undefined });
  // A file that smuggles a running break in is only settings to this module.
  const f = fixture({ ...on, phase: 'break', until: NOW + 5 * MINUTE });
  f.breaks.restore();
  assert.deepEqual(f.breaks.view(), { settings: BREAK_DEFAULTS, phase: 'work', nextAt: undefined, until: undefined }, 'Extra saved fields were trusted');
  const g = fixture({ ...on });
  g.breaks.restore();
  assert.deepEqual(g.breaks.view(), { settings: on, phase: 'work', nextAt: NOW + 45 * MINUTE, until: undefined });
  assert.deepEqual(g.starts, [], 'A launch opened on a break');
});

test('settings are written before they apply, and phases never write', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NOW });
  const f = fixture();
  f.breaks.restore();
  f.store.failWrite = true;
  assert.throws(() => f.breaks.setEnabled(true), /disk full/);
  assert.throws(() => f.breaks.configure({ ...on, workMinutes: 25 }), /disk full/);
  assert.deepEqual(f.breaks.view().settings, BREAK_DEFAULTS, 'A failed write changed the settings');
  assert.throws(() => f.breaks.setEnabled('yes'), /tidak valid/);
  f.store.failWrite = false;
  f.breaks.setEnabled(true);
  assert.equal(f.store.writes, 1);
  assert.deepEqual(f.dues, [], 'Turning reminders on reminded at once');
  t.mock.timers.tick(45 * MINUTE + BREAK_GRACE + 10 * MINUTE);
  assert.equal(f.store.writes, 1, 'A reminder or a break wrote to disk');
});

test('a cycle reminds after work, starts the break a minute later and ends it on time', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NOW });
  const f = fixture({ ...on });
  f.breaks.restore();
  t.mock.timers.tick(45 * MINUTE - 1);
  assert.deepEqual(f.dues, []);
  t.mock.timers.tick(1);
  assert.deepEqual(f.dues, [NOW + 45 * MINUTE]);
  assert.deepEqual(f.breaks.view(), { settings: on, phase: 'due', nextAt: undefined, until: NOW + 45 * MINUTE + BREAK_GRACE });
  t.mock.timers.tick(BREAK_GRACE);
  const started = NOW + 46 * MINUTE;
  assert.deepEqual(f.starts, [started + 10 * MINUTE]);
  assert.equal(f.breaks.view().phase, 'break');
  t.mock.timers.tick(10 * MINUTE);
  assert.deepEqual(f.ends, [true]);
  assert.deepEqual(f.breaks.view(), { settings: on, phase: 'work', nextAt: started + 10 * MINUTE + 45 * MINUTE, until: undefined });
  assert.equal(f.dues.length, 1, 'A reminder repeated');
});

test('snooze, skip, break now and back to work follow the phase and refuse the wrong one', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NOW });
  const f = fixture({ ...on });
  f.breaks.restore();
  assert.throws(() => f.breaks.snooze(), /Belum waktunya/);
  assert.throws(() => f.breaks.skip(), /Belum waktunya/);
  assert.throws(() => f.breaks.end(), /Tidak ada rehat/);
  t.mock.timers.tick(45 * MINUTE);
  f.breaks.snooze();
  assert.deepEqual(f.breaks.view().nextAt, Date.now() + 5 * MINUTE);
  t.mock.timers.tick(BREAK_GRACE);
  assert.deepEqual(f.starts, [], 'A snoozed reminder still started the break');
  t.mock.timers.tick(4 * MINUTE);
  assert.equal(f.dues.length, 2, 'The snooze did not remind again');
  f.breaks.skip();
  assert.deepEqual(f.breaks.view(), { settings: on, phase: 'work', nextAt: Date.now() + 45 * MINUTE, until: undefined });
  f.breaks.start();
  assert.equal(f.starts.length, 1);
  assert.throws(() => f.breaks.start(), /sedang berlangsung/);
  f.breaks.end();
  assert.deepEqual(f.ends, [false]);
  // Break now works while reminders are off, and the cycle after it stays off.
  f.breaks.setEnabled(false);
  f.breaks.start();
  assert.equal(f.breaks.view().phase, 'break');
  t.mock.timers.tick(10 * MINUTE);
  assert.deepEqual(f.ends, [false, true]);
  assert.equal(f.breaks.timer, undefined, 'A disabled cycle kept a timer after its break');
});

test('a held-back break reminds again once nothing blocks it, instead of starting unannounced', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NOW });
  const f = fixture({ ...on });
  f.breaks.restore();
  t.mock.timers.tick(45 * MINUTE);
  assert.equal(f.dues.length, 1);
  f.env.canStart = false; // a call or Do not disturb began during the minute
  t.mock.timers.tick(BREAK_GRACE);
  assert.deepEqual(f.starts, []);
  assert.equal(f.breaks.timer, undefined, 'A held-back break kept polling');
  assert.equal(f.breaks.view().until, undefined, 'A held-back break still counted down');
  f.breaks.check(); f.breaks.check();
  assert.equal(f.dues.length, 1, 'A check while blocked reminded');
  f.env.canStart = true;
  f.breaks.check();
  assert.deepEqual(f.starts, [], 'The break started the moment the block lifted');
  assert.equal(f.dues.length, 2);
  assert.equal(f.breaks.view().until, Date.now() + BREAK_GRACE);
  t.mock.timers.tick(BREAK_GRACE);
  assert.equal(f.starts.length, 1);
  // A reminder due while already blocked is not shown until the block lifts.
  const g = fixture({ ...on });
  g.breaks.restore();
  g.env.canStart = false;
  t.mock.timers.tick(45 * MINUTE);
  assert.deepEqual(g.dues, []);
  assert.equal(g.breaks.view().phase, 'due');
  g.env.canStart = true;
  g.breaks.check();
  assert.equal(g.dues.length, 1);
});

test('time idle away from the keyboard counts as the break', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NOW });
  const f = fixture({ ...on });
  f.breaks.restore();
  f.env.idle = 10 * 60;
  t.mock.timers.tick(45 * MINUTE);
  assert.deepEqual(f.dues, [], 'An idle person was reminded to rest');
  assert.deepEqual(f.breaks.view(), { settings: on, phase: 'work', nextAt: Date.now() + 45 * MINUTE, until: undefined });
  f.env.idle = 10 * 60 - 1;
  t.mock.timers.tick(45 * MINUTE);
  assert.equal(f.dues.length, 1);
});

test('lock and sleep in either order: time away counts as a break, a running break ends, a due reminder gets a fresh minute', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NOW });
  for (const away of [12, 3]) {
    // Work, away for longer than a break: a new cycle without a reminder.
    const f = fixture({ ...on });
    f.breaks.restore();
    t.mock.timers.tick(43 * MINUTE);
    // Main reports a lock or sleep as a block, so nothing can start while away.
    f.breaks.pause(); f.breaks.pause(); f.env.canStart = false;
    t.mock.timers.tick(away * MINUTE);
    f.env.canStart = true; f.breaks.resume();
    if (away >= 10) {
      assert.deepEqual(f.dues, [], 'Time away was not counted as a break');
      assert.equal(f.breaks.view().nextAt, Date.now() + 45 * MINUTE);
    } else {
      // Locked across the due time for less than a break: held back while away, reminded once on return.
      assert.equal(f.dues.length, 1);
      assert.equal(f.breaks.view().until, Date.now() + BREAK_GRACE);
    }
    assert.deepEqual(f.starts, [], 'A break started while away or at return');
  }
  // A reminder shown just before the lock is shown again on return, with a fresh minute.
  const g = fixture({ ...on });
  g.breaks.restore();
  t.mock.timers.tick(45 * MINUTE);
  g.breaks.pause(); g.env.canStart = false;
  t.mock.timers.tick(3 * MINUTE);
  assert.deepEqual(g.starts, [], 'A break started while locked');
  g.env.canStart = true; g.breaks.resume();
  assert.equal(g.dues.length, 2);
  assert.equal(g.breaks.view().until, Date.now() + BREAK_GRACE);
  // A running break ends as taken when the person locks the screen, without a second overlay on return.
  g.breaks.start();
  g.breaks.pause();
  t.mock.timers.tick(2 * MINUTE);
  g.breaks.resume();
  assert.deepEqual(g.ends, [false]);
  assert.equal(g.breaks.view().phase, 'work');
  // A resume without a pause (the event fires alone) changes nothing.
  g.breaks.resume();
  assert.deepEqual(g.ends, [false]);
});

test('settings changes restart the cycle and close a running break', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NOW });
  const f = fixture({ ...on });
  f.breaks.restore();
  t.mock.timers.tick(45 * MINUTE);
  f.breaks.configure({ ...on, workMinutes: 25 });
  assert.deepEqual(f.breaks.view(), { settings: { ...on, workMinutes: 25 }, phase: 'work', nextAt: Date.now() + 25 * MINUTE, until: undefined });
  f.breaks.start();
  f.breaks.setEnabled(false);
  assert.deepEqual(f.ends, [false]);
  f.breaks.setEnabled(true);
  f.breaks.dispose();
  assert.equal(f.breaks.timer, undefined);
});
