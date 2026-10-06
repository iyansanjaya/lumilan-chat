import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import type {IncomingTransfer} from './shared/ipc.js';
import type {FileTransfer} from './shared/model.js';

const source = readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');
function section(startText: string, endText: string, includeEnd = false) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start + startText.length);
  assert(start >= 0 && end > start, `Missing renderer source boundary: ${startText}`);
  return source.slice(start, end + (includeEnd ? endText.length : 0));
}
const declarations = section('const incomingTransfers = new Map();', 'let settingsView;');
const render = section('function renderIncomingTransfers(list) {', '\n}', true);
const events = section('window.lumilan.onFileOffer(', 'window.lumilan.onTyping(');
const initialSnapshot = section('window.lumilan.fileOffers()', 'window.lumilan.currentThread(null)');
const flush = () => new Promise(resolve => setImmediate(resolve));
const offer = (id: string, name = `${id}.bin`): IncomingTransfer => ({ id, from: 'sender', fromName: 'Sender', thread: 'sender', name, size: 100, status: 'offered', received: 0 });
const deferred = <T>() => { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function fixture() {
  const snapshot = deferred<IncomingTransfer[]>(), decision = deferred<boolean>(), toasts: string[] = [], decisions: {id: string;accepted: boolean}[] = [];
  let onOffer: ((value: IncomingTransfer) => void) | undefined, onTransfer: ((value: FileTransfer) => void) | undefined, context: vm.Context;
  class Element {
    declare tag: string;
    declare children: Element[];
    declare listeners: Map<string, () => void | Promise<void>>;
    declare textContent: string;
    declare value: number;
    declare max: number;
    declare className: string;
    declare type: string;
    constructor(tag: string) { this.tag = tag; this.children = []; this.listeners = new Map(); this.textContent = ''; }
    append(...children: Element[]) { this.children.push(...children); }
    replaceChildren(...children: Element[]) { this.children = children; }
    setAttribute() {}
    addEventListener(type: string, callback: () => void | Promise<void>) { this.listeners.set(type, callback); }
  }
  const list = new Element('list');
  const descendants = (element: Element): Element[] => [element, ...element.children.flatMap(descendants)];
  const renderMessages = () => { list.replaceChildren(); (vm.runInContext('renderIncomingTransfers', context) as (list: Element) => void)(list); };
  context = vm.createContext({
    state: { thread: 'sender', me: { id: 'receiver' } }, document: { createElement: (tag: string) => new Element(tag) },
    t: (text: string, values: Record<string, unknown> = {}) => text.replace(/\{(\w+)\}/g, (_match: string, key: string) => String(values[key] ?? `{${key}}`)),
    formatSize: (value: number) => `${value} B`, avatar: () => new Element('avatar'), renderMessages,
    toast: (text: string) => toasts.push(text), errorText: (error: Error) => error.message,
    window: { lumilan: {
      onFileOffer: (callback: (value: IncomingTransfer) => void) => { onOffer = callback; }, onFileTransfer: (callback: (value: FileTransfer) => void) => { onTransfer = callback; },
      fileOffers: () => snapshot.promise,
      decideFile: (id: string, accepted: boolean) => { decisions.push({ id, accepted }); return decision.promise; },
    } },
  });
  vm.runInContext([declarations, render, events, initialSnapshot].join('\n'), context);
  return {
    snapshot, decision, toasts, decisions,
    onOffer: (value: IncomingTransfer) => onOffer!(value), onTransfer: (value: FileTransfer) => onTransfer!(value),
    transferCount: () => vm.runInContext('incomingTransfers.size', context) as number,
    rows: () => list.children.map(row => {
      const elements = descendants(row);
      return { text: elements.map(element => element.textContent).join(' '),
        buttons: elements.filter(element => element.tag === 'button').map(element => element.textContent),
        progress: elements.find(element => element.tag === 'progress')?.value };
    }),
    click: (accepted: boolean) => {
      const button = descendants(list).find(element => element.tag === 'button' && element.textContent === (accepted ? 'Terima file' : 'Tolak'));
      assert(button, 'Expected a pending file decision button');
      return button.listeners.get('click')!();
    },
  };
}

test('a rejected pending decision preserves a transfer accepted by another surface', async t => {
  for (const accepted of [true, false]) await t.test(accepted ? 'Accept' : 'Decline', async () => {
    const f = fixture(); f.onOffer(offer('race'));
    const clicking = f.click(accepted);
    f.onTransfer({ id: 'race', status: 'receiving', received: 35, total: 100 });
    f.decision.reject(new Error('Permintaan file sudah tidak tersedia.'));
    await clicking;
    assert.equal(f.rows().length, 1, 'The rejected duplicate removed the receiving transfer');
    assert.equal(f.rows()[0]!.progress, 35);
    assert.deepEqual(f.rows()[0]!.buttons, []);
    f.onTransfer({ id: 'race', status: 'receiving', received: 70, total: 100 });
    assert.equal(f.rows()[0]!.progress, 70, 'Subsequent transfer progress was lost');
  });
});

test('a rejected pending decision cannot restore terminal transfers or remove a replacement offer', async t => {
  for (const status of ['complete', 'canceled'] as const) await t.test(status, async () => {
    const f = fixture(); f.onOffer(offer('terminal'));
    const clicking = f.click(true);
    f.onTransfer({ id: 'terminal', status });
    assert.equal(f.rows().length, 0);
    f.onOffer(offer('terminal', 'replacement.bin'));
    f.decision.reject(new Error('Permintaan file sudah tidak tersedia.'));
    await clicking;
    assert.equal(f.rows().length, 1, 'An old rejection removed a replacement offer');
    assert(f.rows()[0]!.text.includes('replacement.bin'));
    assert.equal(f.rows()[0]!.buttons.length, 2);
    f.onTransfer({ id: 'terminal', status });
    assert.equal(f.rows().length, 0);
  });
});

test('late startup snapshots cannot restore offered or receiving rows after terminal events', async t => {
  for (const terminal of ['complete', 'canceled'] as const) for (const oldStatus of ['offered', 'receiving'] as const) for (const known of [true, false])
    await t.test(`${terminal}, old ${oldStatus}, ${known ? 'known' : 'unknown'} row`, async () => {
      const f = fixture(), stale = { ...offer('stale'), status: oldStatus, received: oldStatus === 'receiving' ? 25 : 0 };
      if (known) f.onOffer(offer('stale'));
      f.onTransfer({ id: 'stale', status: terminal });
      f.snapshot.resolve([stale, offer('unaffected')]);
      await flush();
      assert.equal(f.rows().length, 1, 'The startup snapshot restored a terminal transfer');
      assert(f.rows()[0]!.text.includes('unaffected.bin'), 'The unaffected snapshot entry was lost');
      assert.equal(f.rows()[0]!.buttons.length, 2);
    });
});

test('fresh offer and progress events win over an older startup snapshot', async () => {
  const f = fixture();
  f.onOffer(offer('fresh', 'new-name.bin'));
  f.onTransfer({ id: 'fresh', status: 'receiving', received: 65, total: 100 });
  f.snapshot.resolve([{ ...offer('fresh', 'old-name.bin'), status: 'receiving', received: 10 }, offer('unaffected')]);
  await flush();
  const current = f.rows().find(row => row.text.includes('new-name.bin'));
  assert(current);
  assert.equal(current.progress, 65);
  assert.deepEqual(current.buttons, []);
  assert.equal(f.rows().length, 2);
  assert(!f.rows().some(row => row.text.includes('old-name.bin')));
});

test('progress arriving before its row is restored keeps snapshot metadata and current receiving state', async t => {
  for (const oldStatus of ['offered', 'receiving'] as const) await t.test(oldStatus, async () => {
    const f = fixture();
    f.onTransfer({ id: 'early-progress', status: 'receiving', received: 75, total: 100 });
    assert.equal(f.rows().length, 0, 'Progress without file metadata should not create an incomplete row');
    f.snapshot.resolve([{ ...offer('early-progress', 'metadata.bin'), status: oldStatus, received: oldStatus === 'receiving' ? 10 : 0 }]);
    await flush();
    assert.equal(f.rows().length, 1);
    assert(f.rows()[0]!.text.includes('metadata.bin'));
    assert.equal(f.rows()[0]!.progress, 75, 'Older snapshot progress overwrote the incoming event');
    assert.deepEqual(f.rows()[0]!.buttons, [], 'Older snapshot consent became actionable after reception began');
  });
});

test('late progress cannot make a terminal transfer reappear through the startup snapshot', async t => {
  for (const terminal of ['complete', 'canceled'] as const) await t.test(terminal, async () => {
    const f = fixture();
    f.onTransfer({ id: 'ended', status: terminal });
    f.onTransfer({ id: 'ended', status: 'receiving', received: 20, total: 100 });
    f.snapshot.resolve([offer('ended')]);
    await flush();
    assert.equal(f.rows().length, 0, 'Late progress made a terminal transfer reappear');
  });
});

test('normal startup snapshots restore offers and receiving progress', async () => {
  const f = fixture();
  f.snapshot.resolve([offer('pending'), { ...offer('active'), status: 'receiving', received: 45 }]);
  await flush();
  assert.equal(f.rows().length, 2);
  assert.equal(f.rows().find(row => row.text.includes('pending.bin'))!.buttons.length, 2);
  assert.equal(f.rows().find(row => row.text.includes('active.bin'))!.progress, 45);
  f.onTransfer({ id: 'active', status: 'complete' });
  assert.equal(f.rows().length, 1);
  f.onOffer(offer('later'));
  assert.equal(f.rows().length, 2, 'An ordinary later offer was lost after startup');
});

test('ordinary decision errors clear their own pending row and still report the error', async t => {
  for (const accepted of [true, false]) await t.test(accepted ? 'Accept' : 'Decline', async () => {
    const f = fixture(); f.onOffer(offer('failed'));
    const clicking = f.click(accepted);
    f.decision.reject(new Error('Decision failed'));
    await clicking;
    assert.equal(f.rows().length, 0);
    assert.deepEqual(f.toasts, ['Decision failed']);
    assert.deepEqual(f.decisions, [{ id: 'failed', accepted }]);
  });
});

test('ordinary decision errors stay cleared when an older startup snapshot resolves', async t => {
  for (const accepted of [true, false]) await t.test(accepted ? 'Accept' : 'Decline', async () => {
    const f = fixture(); f.onOffer(offer('failed'));
    const clicking = f.click(accepted);
    f.decision.reject(new Error('Decision failed'));
    await clicking;
    f.snapshot.resolve([offer('failed')]);
    await flush();
    assert.equal(f.rows().length, 0, 'An old snapshot restored a locally cleared decision');
    assert.equal(f.transferCount(), 0, 'An old snapshot retained a hidden locally cleared transfer');
    assert.deepEqual(f.toasts, ['Decision failed']);
  });
});

test('a successful decline stays cleared when an older startup snapshot resolves', async () => {
  const f = fixture(); f.onOffer(offer('declined'));
  const clicking = f.click(false);
  f.decision.resolve(true);
  await clicking;
  f.snapshot.resolve([offer('declined')]);
  await flush();
  assert.equal(f.rows().length, 0);
  assert.equal(f.transferCount(), 0, 'An old snapshot retained a hidden declined transfer');
});

test('authentic progress after a local decision error still hydrates from startup metadata', async t => {
  for (const accepted of [true, false]) await t.test(accepted ? 'Accept' : 'Decline', async () => {
    const f = fixture(); f.onOffer(offer('recovering', 'metadata.bin'));
    const clicking = f.click(accepted);
    f.decision.reject(new Error('Decision failed'));
    await clicking;
    f.onTransfer({ id: 'recovering', status: 'receiving', received: 60, total: 100 });
    f.snapshot.resolve([offer('recovering', 'metadata.bin')]);
    await flush();
    assert.equal(f.rows().length, 1);
    assert(f.rows()[0]!.text.includes('metadata.bin'));
    assert.equal(f.rows()[0]!.progress, 60);
    assert.deepEqual(f.rows()[0]!.buttons, []);
  });
});

test('a failed startup snapshot reports the error and later events keep working', async () => {
  const f = fixture();
  f.onTransfer({ id: 'unknown', status: 'canceled' });
  f.snapshot.reject(new Error('Snapshot failed'));
  await flush();
  assert.deepEqual(f.toasts, ['Snapshot failed']);
  f.onOffer(offer('later'));
  f.onTransfer({ id: 'later', status: 'receiving', received: 20, total: 100 });
  assert.equal(f.rows().length, 1);
  assert.equal(f.rows()[0]!.progress, 20);
  f.onTransfer({ id: 'later', status: 'canceled' });
  assert.equal(f.rows().length, 0);
});
