import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { TaskList, readTasks, taskTitle, type Task, type TaskReminders } from '../src/main/tasks.js';
import { Reminders, type ReminderPeer } from '../src/main/reminders.js';
import type { ReminderEvent } from '../src/shared/model.js';
import type { TasksView } from '../src/shared/notch.js';

const HOUR = 3_600_000, DAY = 24 * HOUR;

// A reminder store that records what the task list asked of it.
function fakeReminders() {
  const records: Array<{ id: string; title: string; dueAt: number }> = [], calls: Array<[string, string]> = [];
  const reminders: TaskReminders & { failCreate: boolean } = {
    records, failCreate: false,
    create: input => {
      if (reminders.failCreate) throw new Error('Batas 512 pengingat tercapai.');
      const value = input as { title: string; dueAt: number };
      records.push({ id: randomUUID(), title: value.title, dueAt: value.dueAt });
    },
    change: (id, action) => {
      calls.push([action, id]);
      const index = records.findIndex(record => record.id === id);
      if (index < 0) throw new Error('Pengingat sudah tidak tersedia.');
      if (action === 'delete') records.splice(index, 1);
    },
  };
  return { reminders, records, calls };
}

function fixture(saved?: unknown, reminders: TaskReminders = fakeReminders().reminders) {
  const store = { saved, failWrite: false };
  const views: TasksView[] = [];
  const list = new TaskList({ read: () => store.saved, write: tasks => { if (store.failWrite) throw new Error('disk full'); store.saved = JSON.parse(JSON.stringify(tasks)); },
    reminders: () => reminders, onChange: view => views.push(view) });
  list.restore();
  return { list, store, views };
}

test('task titles are cleaned and bounded', () => {
  assert.equal(taskTitle('  Kirim\u202e laporan\n  mingguan '), 'Kirim laporan mingguan');
  for (const value of ['', '   ', '\u0000', 'x'.repeat(161), 12, null]) assert.throws(() => taskTitle(value), /judul tugas/, JSON.stringify(value));
});

test('saved tasks are untrusted: invalid and duplicate entries are dropped, old finished tasks pruned, the list bounded', () => {
  const now = Date.now(), id = randomUUID();
  const task = (extra: Partial<Task> = {}) => ({ id: randomUUID(), title: 'Tugas', done: false, createdAt: now - HOUR, ...extra });
  const tasks = readTasks([task({ id }), task({ id }), task({ title: '' }), { ...task(), id: 'not-a-uuid' }, task({ done: true, doneAt: now - 31 * DAY }),
    task({ done: true }), task({ reminderId: 'bad' }), 'x', null], now);
  assert.equal(tasks.length, 3);
  assert.equal(tasks[1]!.doneAt, now - HOUR, 'A finished task without a time was not dated');
  assert.equal(tasks[2]!.reminderId, undefined);
  assert.equal(readTasks(Array.from({ length: 300 }, () => task()), now).length, 200);
});

test('tasks add, finish, reopen, rename and delete; due times are backed by local reminders', () => {
  const { reminders, records, calls } = fakeReminders();
  const { list, store, views } = fixture(undefined, reminders);
  const due = Date.now() + 2 * HOUR;
  assert.throws(() => list.add({ title: 'Lewat', dueAt: Date.now() - 1 }), /masa depan/);
  assert.throws(() => list.add({ title: 'Path', path: 'C:/secret' }), /tidak valid/);
  assert.equal(records.length, 0, 'A rejected task created a reminder');
  list.add({ title: 'Balas Dina' });
  let view = list.add({ title: 'Laporan', dueAt: due });
  assert.deepEqual(view.items.map(item => [item.title, item.done, item.dueAt]), [['Laporan', false, due], ['Balas Dina', false, undefined]], 'The due task did not lead the list');
  assert.deepEqual(records.map(record => [record.title, record.dueAt]), [['Laporan', due]]);
  const [report, reply] = view.items;
  view = list.toggle(report!.id);
  assert.deepEqual([view.done, view.total, records.length], [1, 2, 0], 'Finishing a task kept its reminder');
  assert.deepEqual(calls.map(([action]) => action), ['cancel', 'delete']);
  view = list.toggle(report!.id);
  assert.equal(records.length, 1, 'Reopening a task before its due time did not schedule it again');
  view = list.edit({ id: report!.id, title: 'Laporan akhir', dueAt: null });
  assert.equal(records.length, 0, 'Removing the due time kept the reminder');
  view = list.edit({ id: report!.id, title: 'Laporan akhir', dueAt: due + HOUR });
  assert.deepEqual(records.map(record => [record.title, record.dueAt]), [['Laporan akhir', due + HOUR]]);
  view = list.remove(report!.id);
  assert.deepEqual([view.items.map(item => item.id), records.length], [[reply!.id], 0]);
  assert.throws(() => list.toggle(report!.id), /tidak tersedia/);
  assert.equal((store.saved as Task[]).length, 1);
  assert.equal(views.at(-1)?.total, 1, 'The change was not published');
});

test('a failed save changes nothing and withdraws the reminder it created', () => {
  const { reminders, records } = fakeReminders();
  const { list, store } = fixture(undefined, reminders);
  store.failWrite = true;
  assert.throws(() => list.add({ title: 'Rapat', dueAt: Date.now() + HOUR }), /disk full/);
  assert.deepEqual([list.tasks.length, records.length], [0, 0]);
  store.failWrite = false;
  reminders.failCreate = true;
  assert.throws(() => list.add({ title: 'Rapat', dueAt: Date.now() + HOUR }), /512/);
  assert.equal(list.tasks.length, 0, 'A task was kept without its reminder');
});

test('the list view shows open tasks and today\'s finished ones, and finished tasks expire after 30 days', () => {
  const now = Date.now();
  const saved = [
    { id: randomUUID(), title: 'Kemarin', done: true, createdAt: now - 2 * DAY, doneAt: now - 1.5 * DAY },
    { id: randomUUID(), title: 'Hari ini', done: true, createdAt: now - HOUR, doneAt: now },
    { id: randomUUID(), title: 'Terbuka', done: false, createdAt: now - HOUR },
  ];
  const { list } = fixture(saved);
  const view = list.view(now);
  assert.deepEqual(view.items.map(item => item.title), ['Terbuka', 'Hari ini']);
  assert.deepEqual([view.done, view.total], [1, 2]);
  assert.deepEqual(list.view(now + 31 * DAY).items.map(item => item.title), ['Terbuka']);
});

test('a due task alerts through the real reminder flow and finishing it cancels that reminder', t => {
  let now = Date.now();
  const peer: EventEmitter & ReminderPeer = Object.assign(new EventEmitter(), { id: 'self', state: { messages: [], reminders: [], reminderTombstones: [] },
    online: new Set<string>(), trusted: new Map(), save() { peer.emit('change'); }, sendTo: async () => ({ ok: true as const }), listMessages: () => [] });
  const reminders = new Reminders(peer, { now: () => now }); reminders.start(); t.after(() => reminders.stop());
  const events: ReminderEvent[] = []; peer.on('reminder', event => events.push(event));
  const { list } = fixture(undefined, reminders);
  const view = list.add({ title: 'Kirim laporan', dueAt: Date.now() + 5000 });
  assert.equal(reminders.records.length, 1);
  now += 6000; reminders.tick();
  assert.deepEqual(events.map(event => [event.type, event.items[0]?.title]), [['due', 'Kirim laporan']]);
  list.toggle(view.items[0]!.id);
  assert.equal(reminders.records.length, 0, 'Finishing the task left its reminder in the Reminders center');
});
