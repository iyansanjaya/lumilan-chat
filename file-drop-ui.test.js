import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');
const start = source.indexOf('function isFileDrag(event) {');
const end = source.indexOf('let fileListThread = null;', start);
assert(start >= 0 && end > start, 'Missing file drag and drop renderer source');
const file = (name, size = 100) => ({ name, size, type: '' });

function fixture() {
  const elements = new Map(), listeners = new Map(), windowListeners = new Map();
  const uploads = [], toasts = [], outgoingTransfers = new Map();
  class Element {
    constructor() {
      this.listeners = new Map(); this.hidden = false; this.disabled = false;
      this.dataset = {}; this.value = ''; this.style = {}; this.classes = new Set();
      this.classList = {
        add: (...names) => names.forEach(name => this.classes.add(name)),
        remove: (...names) => names.forEach(name => this.classes.delete(name)),
        contains: name => this.classes.has(name),
        toggle: (name, visible = !this.classes.has(name)) => { visible ? this.classes.add(name) : this.classes.delete(name); return visible; },
      };
    }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    contains(target) { while (target) { if (target === this) return true; target = target.parent; } return false; }
    setAttribute(name, value) { this[name] = value; }
  }
  const $ = selector => { if (!elements.has(selector)) elements.set(selector, new Element()); return elements.get(selector); };
  const state = { thread: 'peer-b' };
  const document = {
    hidden: false, dialogOpen: false,
    get visibilityState() { return this.hidden ? 'hidden' : 'visible'; },
    addEventListener: (name, callback) => listeners.set(name, callback),
    querySelector: selector => selector === 'dialog[open]' ? document.dialogOpen ? $('dialog') : null : $(selector),
  };
  $('#file-drop-overlay').hidden = true;
  const context = vm.createContext({
    $, state, outgoingTransfers,
    document,
    window: { addEventListener: (name, callback) => windowListeners.set(name, callback) },
    t: (text, values = {}) => text.replace(/\{(\w+)\}/g, (_match, key) => values[key] ?? `{${key}}`),
    toast: text => toasts.push(text),
    upload(value, thread) {
      uploads.push({ file: value, thread });
      outgoingTransfers.set(`transfer-${uploads.length}`, {});
      if (context.afterUpload) context.afterUpload();
      return true;
    },
  });
  vm.runInContext(source.slice(start, end), context);
  return {
    $, state, document, context, uploads, toasts, outgoingTransfers,
    fire(name, files = [], options = {}) {
      const event = {
        target: $('.conversation'), relatedTarget: null, prevented: false, stopped: false,
        dataTransfer: {
          types: ['Files'], files,
          items: files.map(value => ({ kind: 'file', getAsFile: () => value, webkitGetAsEntry: () => ({ isDirectory: false }) })),
        },
        preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; },
        ...options,
      };
      listeners.get(name)?.(event); // The navigation guard runs during document capture.
      if (!event.stopped && $('.conversation').contains(event.target)) $('.conversation').listeners.get(name)?.(event);
      return event;
    },
    windowEvent: name => windowListeners.get(name)?.(),
    documentEvent: (name, event = {}) => listeners.get(name)?.(event),
  };
}

test('dropping several external files on the chat starts them with one captured destination', () => {
  const f = fixture();
  const first = file('one.png'), second = file('two.pdf');
  f.$('#message-input').value = 'Existing draft';
  f.context.clipboardImage = { file: file('clipboard.png'), thread: 'peer-b' };
  f.context.afterUpload = () => { f.state.thread = 'peer-c'; };
  const event = f.fire('drop', [first, second], { target: { parent: f.$('.conversation') } });
  assert(event.prevented, 'An external file drop can navigate away from the app');
  assert.deepEqual(f.uploads, [{ file: first, thread: 'peer-b' }, { file: second, thread: 'peer-b' }]);
  assert.equal(f.$('#message-input').value, 'Existing draft');
  assert.equal(f.context.clipboardImage.file.name, 'clipboard.png');
});

test('ordinary text drag and drop retains native editing behavior', () => {
  const f = fixture();
  const dataTransfer = { types: ['text/plain'], files: [], items: [{ kind: 'string' }] };
  const over = f.fire('dragover', [], { dataTransfer });
  const drop = f.fire('drop', [], { dataTransfer });
  assert.equal(over.prevented, false);
  assert.equal(drop.prevented, false);
  assert.equal(f.uploads.length, 0);
});

test('file drops outside the chat or into read-only conversations cannot upload or navigate', () => {
  const cases = [
    f => { f.state.thread = null; },
    f => { f.state.thread = 'announcements'; },
    f => { f.$('#composer-wrap').hidden = true; },
    f => { f.document.dialogOpen = true; },
    f => ({ target: {} }),
  ];
  for (const configure of cases) {
    const f = fixture();
    const options = configure(f) || {};
    const over = f.fire('dragover', [file('should-not-send.txt')], options);
    assert(over.prevented);
    assert.equal(over.dataTransfer.dropEffect, 'none');
    const event = f.fire('drop', [file('should-not-send.txt')], options);
    assert(event.prevented, 'Rejected file drops must prevent file navigation');
    assert.equal(f.uploads.length, 0, 'A file was sent outside an editable conversation');
  }
});

test('nested drag feedback persists within the chat and clears on leave, cancel, or drop', () => {
  const f = fixture();
  const image = file('nested.png'), overlay = f.$('#file-drop-overlay');
  const enter = f.fire('dragenter', [], { dataTransfer: {
    types: ['Files'], files: [], items: [{ kind: 'file', getAsFile: () => null }],
  } });
  assert.equal(overlay.hidden, false);
  assert.equal(enter.dataTransfer.dropEffect, 'copy');
  f.fire('dragenter', [image], { target: { parent: f.$('.conversation') } });
  f.fire('dragleave', [image], { target: { parent: f.$('.conversation') } });
  assert.equal(overlay.hidden, false, 'Leaving a nested bubble hid the chat drop target');
  f.fire('dragleave', [image]);
  assert.equal(overlay.hidden, true);
  for (const cancel of [
    () => f.windowEvent('blur'),
    () => { f.documentEvent('dragend'); f.windowEvent('dragend'); },
    () => { f.document.hidden = true; f.documentEvent('visibilitychange'); f.document.hidden = false; },
    () => f.documentEvent('keydown', { key: 'Escape' }),
    () => f.context.clearFileDrag(),
  ]) {
    f.fire('dragenter', [image]);
    cancel();
    assert.equal(overlay.hidden, true, 'Canceled file drag left stale overlay');
  }
  f.fire('dragenter', [image]);
  f.fire('drop', [image]);
  assert.equal(overlay.hidden, true);
  assert.equal(f.uploads.length, 1);
});

test('the global navigation guard preserves native file inputs used by other forms', () => {
  const f = fixture();
  const target = { matches: selector => selector.includes('input') && selector.includes('file') };
  target.closest = selector => target.matches(selector) ? target : null;
  assert.equal(f.fire('dragover', [file('avatar.png')], { target }).prevented, false);
  assert.equal(f.fire('drop', [file('avatar.png')], { target }).prevented, false);
  assert.equal(f.uploads.length, 0);
});

test('folders, invalid sizes, and over-capacity batches are rejected before sending any file', () => {
  for (const invalid of [file('empty.txt', 0), file('oversize.bin', 5 * 1024 ** 3 + 1)]) {
    const f = fixture();
    f.fire('drop', [file('valid.png'), invalid]);
    assert.equal(f.uploads.length, 0, 'Part of an invalid batch was sent before validation completed');
    assert.equal(f.toasts.length, 1);
  }
  const f = fixture(), folder = file('Folder', 4096), valid = file('valid.pdf');
  f.fire('drop', [valid, folder], { dataTransfer: {
    types: ['Files'], files: [valid, folder],
    items: [
      { kind: 'file', getAsFile: () => valid, webkitGetAsEntry: () => ({ isDirectory: false }) },
      { kind: 'file', getAsFile: () => folder, webkitGetAsEntry: () => ({ isDirectory: true }) },
    ],
  } });
  assert.equal(f.uploads.length, 0, 'A folder selection silently sent only some contents');
  assert.equal(f.toasts.length, 1);
  const limited = fixture();
  for (let index = 0; index < 7; index++) limited.outgoingTransfers.set(index, {});
  limited.fire('drop', [file('one.png'), file('two.png')]);
  assert.equal(limited.uploads.length, 0, 'A batch above remaining transfer slots was partly sent');
  assert.equal(limited.toasts.length, 1);
  limited.fire('drop', [file('exact-limit.bin', 5 * 1024 ** 3)]);
  assert.equal(limited.uploads.length, 1, 'A file at exactly 5 GiB was rejected');
});
