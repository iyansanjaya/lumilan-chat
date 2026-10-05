import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { locales, translate } from './public/i18n.js';

const source = readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');
function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert(from >= 0 && to > from, `Missing picker source boundary: ${start}`);
  return source.slice(from, to);
}
const uploadSource = section('const outgoingTransfers = new Map();', 'function renderClipboardImage() {');
const batchSource = section('function isFileDrag(event) {', 'const fileDropZone =');
const flush = () => new Promise(resolve => setImmediate(resolve));
const file = (name, size = 100) => ({ name, size, type: '' });

test('attachment control exposes multiple selection and its translated accessible label', () => {
  const html = readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');
  const input = html.match(/<input\b[^>]*\bid="file-input"[^>]*>/)?.[0];
  const button = html.match(/<button\b[^>]*\bid="attach-button"[^>]*>/)?.[0];
  assert(input && button, 'Attachment controls are missing');
  assert.match(input, /\btype="file"/);
  assert.match(input, /\bmultiple(?:\s|>)/);
  const label = button.match(/\btitle="([^"]+)"/)?.[1];
  assert.equal(label, 'Kirim beberapa file');
  assert.equal(button.match(/\baria-label="([^"]+)"/)?.[1], label);
  const translations = Object.keys(locales).filter(language => language !== 'id').map(language => translate(language, label));
  assert(translations.every(value => value && value !== label), 'A supported language lost the attachment label');
  assert.equal(new Set(translations).size, translations.length, 'A locale falls back to another attachment translation');
  assert.doesNotMatch(source, /\$\('#file-hint'\)/, 'Header still accesses the removed size hint');
});

function fixture() {
  const elements = new Map(), requests = [], toasts = [], canceled = [];
  class Element {
    constructor(selector) { this.selector = selector; this.listeners = new Map(); this.children = []; this.hidden = false; this.dataset = {}; this.files = []; this._value = ''; }
    get value() { return this._value; }
    set value(value) { this._value = value; if (this.selector === '#file-input' && value === '') this.files = []; }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    setAttribute(name, value) { this[name] = value; }
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
    click() { return this.fire('click'); }
    fire(name) {
      const event = { target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
      this.listeners.get(name)?.(event);
      return event;
    }
  }
  const $ = selector => { if (!elements.has(selector)) elements.set(selector, new Element(selector)); return elements.get(selector); };
  const state = { thread: 'peer-b' }, document = {
    dialogOpen: false,
    createElement: () => new Element(),
    querySelector: selector => selector === 'dialog[open]' ? document.dialogOpen ? $('dialog') : null : $(selector),
  };
  let progress;
  const bridge = {
    onFileProgress: callback => { progress = callback; },
    file(value, thread, id) {
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      requests.push({ file: value, thread, id, resolve, reject });
      fixtureAfterFile?.();
      return promise;
    },
    cancelFile(id) { canceled.push(id); requests.find(request => request.id === id)?.reject(new Error('canceled')); return Promise.resolve(true); },
  };
  let fixtureAfterFile;
  const context = vm.createContext({ $, state, document, window: { lumilan: bridge }, crypto: { randomUUID },
    t: (text, values = {}) => text.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? `{${key}}`),
    toast: value => toasts.push(value), errorText: error => error.message,
  });
  vm.runInContext(`${uploadSource}\n${batchSource}`, context);
  return { $, state, document, requests, toasts, canceled,
    jobs: () => vm.runInContext('outgoingTransfers', context),
    afterFile: callback => { fixtureAfterFile = callback; },
    progress: value => progress(value),
    select(values) { const input = $('#file-input'); input.files = values; input._value = 'selection'; input.fire('change'); },
  };
}

test('picker rejects the whole selection when its opening conversation changed', () => {
  const f = fixture();
  f.$('#file-input').click();
  f.state.thread = 'peer-c';
  f.select([file('one.png'), file('two.pdf')]);
  assert.equal(f.requests.length, 0, 'Files went to the conversation selected after the picker opened');
  assert.equal(f.jobs().size, 0);
  assert.equal(f.$('#file-input').value, '');
  assert.equal(f.toasts.length, 1);
});

test('attachment picker starts every selected original file with independent progress and cancellation', async () => {
  const f = fixture(), first = file('one.png'), second = file('two.pdf');
  f.afterFile(() => { f.state.thread = 'peer-c'; });
  f.$('#attach-button').click();
  f.select([first, second]);
  assert.deepEqual(f.requests.map(request => [request.file, request.thread]), [[first, 'peer-b'], [second, 'peer-b']]);
  const [one, two] = f.requests;
  assert.notEqual(one.id, two.id);
  assert.equal(f.jobs().size, 2);
  f.progress({ id: one.id, sent: 50, total: 100, status: 'sending' });
  assert.equal(f.jobs().get(one.id).bar.value, 50);
  assert.equal(f.jobs().get(two.id).bar.value, 0);
  f.jobs().get(one.id).cancel.click(); await flush();
  assert.deepEqual(f.canceled, [one.id]);
  assert.equal(f.jobs().has(one.id), false);
  assert.equal(f.jobs().has(two.id), true, 'Cancel removed another selected file');
  two.resolve({ delivered: 1 }); await flush();
  assert.equal(f.jobs().size, 0);
});

test('cancel clears the captured picker destination and completed files can be selected again', async () => {
  const f = fixture(), selected = [file('same.png'), file('same.pdf')];
  f.$('#file-input').click();
  f.$('#file-input').fire('cancel');
  f.state.thread = 'peer-c';
  f.select(selected); // Programmatic native FileList injection has no click event.
  assert.equal(f.requests.length, 2);
  assert(f.requests.every(request => request.thread === 'peer-c'));
  assert.equal(f.$('#file-input').value, '');
  assert.deepEqual(f.$('#file-input').files, []);
  for (const request of f.requests) request.resolve({ delivered: 1 });
  await flush();
  f.$('#file-input').click(); f.select(selected);
  assert.equal(f.requests.length, 4, 'Reset input did not admit reselection of the same files');
  assert.equal(new Set(f.requests.map(request => request.id)).size, 4);
});

test('inactive, read-only, and dialog-blocked picker destinations admit no files', () => {
  for (const configure of [
    f => { f.state.thread = null; },
    f => { f.state.thread = 'announcements'; },
    f => { f.$('#composer-wrap').hidden = true; },
    f => { f.document.dialogOpen = true; },
  ]) {
    const f = fixture(); configure(f);
    assert.equal(f.$('#file-input').click().defaultPrevented, true, 'Blocked destination opened the native picker');
    f.select([file('one.png'), file('two.pdf')]);
    assert.equal(f.requests.length, 0);
    assert.equal(f.jobs().size, 0);
    assert.equal(f.$('#file-input').value, '');
  }
});

test('invalid and over-capacity picker selections start no partial batch', () => {
  for (const invalid of [file('empty', 0), file('too-large', 5 * 1024 ** 3 + 1), file('fractional', 1.5)]) {
    const f = fixture(); f.$('#file-input').click(); f.select([file('valid'), invalid]);
    assert.equal(f.requests.length, 0, 'A valid file started before its invalid sibling was rejected');
    assert.equal(f.jobs().size, 0);
  }
  const f = fixture();
  f.$('#file-input').click(); f.select(Array.from({ length: 7 }, (_, index) => file(`waiting-${index}`)));
  assert.equal(f.requests.length, 7);
  f.$('#file-input').click(); f.select([file('one'), file('two')]);
  assert.equal(f.requests.length, 7, 'An over-capacity selection partially started');
  f.$('#file-input').click(); f.select([file('exact-limit', 5 * 1024 ** 3)]);
  assert.equal(f.requests.length, 8);
});
