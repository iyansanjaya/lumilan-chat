import test from 'node:test';
import assert from 'node:assert/strict';
import { WATER_DEFAULTS, WaterRoutine, dueAt, readWaterState, waterSettings, type WaterState } from '../src/main/routines.js';
import type { RoutineView, WaterSettings } from '../src/shared/notch.js';

const MINUTE = 60_000, HOUR = 60 * MINUTE;
// Local time on a fixed day, so the active-hours arithmetic does not depend on when or where the test runs.
const local = (hour: number, minute = 0, day = 5) => new Date(2026, 0, day, hour, minute).getTime();
const on: WaterSettings = { ...WATER_DEFAULTS, enabled: true };

function fixture(saved?: unknown) {
  const store = { saved, failWrite: false, writes: 0 };
  const dues: number[] = [], views: RoutineView[] = [];
  const routine = new WaterRoutine({
    read: () => store.saved,
    write: state => { if (store.failWrite) throw new Error('disk full'); store.writes++; store.saved = JSON.parse(JSON.stringify(state)); },
    onChange: view => views.push(view), onDue: () => dues.push(Date.now()),
  });
  return { routine, store, dues, views };
}

test('water settings accept only the offered ranges with exactly their own fields', () => {
  assert.deepEqual(waterSettings({ ...on }), on);
  for (const value of [null, [], {}, { ...on, extra: 1 }, { ...on, enabled: 'yes' }, { ...on, servingMl: 49 }, { ...on, servingMl: 250.5 }, { ...on, goalMl: 5001 },
    { ...on, startHour: -1 }, { ...on, endHour: 25 }, { ...on, startHour: 22, endHour: 8 }, { ...on, startHour: 9, endHour: 9 }, { ...on, intervalMinutes: 14 }, { ...on, intervalMinutes: '60' }])
    assert.throws(() => waterSettings(value), /rutinitas tidak valid/, JSON.stringify(value));
});

test('saved water state is untrusted: damaged settings fall back, the log keeps a plausible week, and a future reminder time is clamped', () => {
  const now = local(12);
  assert.deepEqual(readWaterState(undefined, now), { settings: WATER_DEFAULTS, log: [] });
  const state = readWaterState({ settings: { ...on, goalMl: 99_999 }, notifiedAt: now + HOUR,
    log: [{ at: now - 8 * 24 * HOUR, ml: 250 }, { at: now + 2 * MINUTE, ml: 250 }, { at: now - HOUR, ml: 0 }, { at: now - HOUR, ml: 300 }, { at: now - 2 * HOUR, ml: 200 }, 'x', { at: 'now', ml: 1 }] }, now);
  assert.deepEqual(state.settings, WATER_DEFAULTS, 'Damaged settings were partly kept');
  assert.deepEqual(state.log, [{ at: now - 2 * HOUR, ml: 200 }, { at: now - HOUR, ml: 300 }]);
  assert.equal(state.notifiedAt, now, 'A reminder time ahead of the clock postponed the next reminder');
  const many = readWaterState({ log: Array.from({ length: 1500 }, (_, i) => ({ at: now - i * MINUTE, ml: 10 })) }, now);
  assert.equal(many.log.length, 1000);
});

test('the next reminder follows the active window, the last drink and the goal, and never runs past the window', () => {
  const state = (log: WaterState['log'], notifiedAt?: number): WaterState => ({ settings: on, log, ...(notifiedAt === undefined ? {} : { notifiedAt }) });
  assert.equal(dueAt({ settings: WATER_DEFAULTS, log: [] }, local(10)), undefined, 'A disabled routine scheduled a reminder');
  assert.equal(dueAt(state([]), local(6)), local(9), 'The first reminder is one interval after the window opens');
  assert.equal(dueAt(state([{ at: local(10, 30), ml: 250 }]), local(11)), local(11, 30));
  assert.equal(dueAt(state([], local(11)), local(11, 5)), local(12));
  assert.equal(dueAt(state([{ at: local(10, 30, 4), ml: 250 }], local(21, 30, 4)), local(7)), local(9), "Yesterday's drink or reminder moved today's first reminder");
  assert.equal(dueAt(state([], local(21, 30)), local(21, 31)), local(9, 0, 6), 'A reminder ran past the active window');
  assert.equal(dueAt(state([]), local(23)), local(9, 0, 6));
  const reached = state(Array.from({ length: 8 }, (_, i) => ({ at: local(9 + i), ml: 250 })));
  assert.equal(dueAt(reached, local(17)), local(9, 0, 6), 'A reached goal still reminded today');
});

test('drinking logs a serving, enabling never reminds at once, and a due slot fires once and is persisted first', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: local(9) });
  const { routine, store, dues, views } = fixture();
  routine.restore();
  assert.equal(routine.timer, undefined, 'A disabled routine kept a timer');
  routine.setEnabled(true);
  assert.deepEqual(dues, [], 'Turning reminders on reminded immediately');
  t.mock.timers.tick(HOUR - 1); assert.deepEqual(dues, []);
  t.mock.timers.tick(1); assert.deepEqual(dues, [local(10)]);
  assert.equal((store.saved as WaterState).notifiedAt, local(10), 'The shown slot was not stored before notifying');
  t.mock.timers.tick(30 * MINUTE);
  const view = routine.drink();
  assert.deepEqual([view.todayMl, view.percent, view.reached, view.hours[10], view.nextAt], [250, 13, false, 250, local(11, 30)]);
  assert.equal(views.at(-1)?.todayMl, 250, 'The change was not published');
  store.failWrite = true;
  assert.throws(() => routine.drink(), /disk full/);
  assert.equal(routine.view().todayMl, 250, 'A failed write changed the log');
  store.failWrite = false;
  routine.configure({ ...on, goalMl: 500 }); routine.drink();
  assert.equal(routine.view().reached, true);
  t.mock.timers.tick(12 * HOUR);
  assert.deepEqual(dues, [local(10)], 'The routine reminded after the goal was reached');
  routine.setEnabled(false);
  // Off, but with intake today: one wake at local midnight resets the page, then no timer at all.
  t.mock.timers.setTime(local(23, 59, 5)); routine.arm();
  t.mock.timers.tick(MINUTE);
  assert.deepEqual([views.at(-1)?.todayMl, routine.timer], [0, undefined], 'Midnight did not reset the page, or a disabled routine kept a timer');
  routine.dispose();
});

test('a slot missed while the app was closed or asleep fires once, and a later restart does not repeat it', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: local(13) });
  const saved: WaterState = { settings: on, log: [], notifiedAt: local(9) };
  const first = fixture(saved);
  first.routine.restore();
  assert.deepEqual(first.dues, [local(13)], 'The missed slot was not shown once');
  first.routine.dispose();
  const second = fixture(first.store.saved);
  second.routine.restore();
  assert.deepEqual(second.dues, [], 'A restart repeated a slot that was already shown');
  // Resume after sleep: the timer fires late, but check() on resume shows the passed slot once.
  t.mock.timers.setTime(local(15, 30));
  second.routine.check(); second.routine.check();
  assert.deepEqual(second.dues, [local(15, 30)]);
  second.routine.dispose();
});
