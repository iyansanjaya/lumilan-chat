import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');
function section(startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start + startText.length);
  assert(start >= 0 && end > start, `Missing renderer source boundary: ${startText}`);
  return source.slice(start, end);
}
const declarations = section('const messageDrafts = new Map();', 'const incomingTransfers = new Map();');
const submit = section("$('#message-form').addEventListener('submit'", "$('#message-input').addEventListener('keydown'");
const uploads = section(source.includes('const outgoingTransfers = new Map();') ? 'const outgoingTransfers = new Map();' : 'let uploading = false;', 'function renderClipboardImage() {');
const clipboard = section('function renderClipboardImage() {', 'const emojis = [');
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const file = (name, size = 100) => ({ name, size, type: 'image/png' });

function fixture() {
  const elements = new Map(), files = [], messages = [], cancels = [], toasts = [], revoked = [], validations = [];
  let onProgress, sequence = 0;
  class Element {
    constructor(tag = 'div') { this.tag = tag; this.children = []; this.listeners = new Map(); this.disabled = false; this.hidden = false; this.value = ''; this.textContent = ''; this.style = {}; this.dataset = {}; }
    append(...children) { children.forEach(child => { child.parent = this; }); this.children.push(...children); }
    replaceChildren(...children) { this.children.forEach(child => { child.parent = null; }); this.children = []; this.append(...children); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
    setAttribute(name, value) { this[name] = value; }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    removeAttribute(name) { delete this[name]; }
    focus() { this.focused = true; }
    click() { if (!this.disabled) return this.listeners.get('click')?.(); }
  }
  const $ = selector => { if (!elements.has(selector)) elements.set(selector, new Element()); return elements.get(selector); };
  $('#transfer-progress').hidden = true;
  const recordMessage = (type, text, thread, reply, mentions) => {
    const pending = deferred(); messages.push({ type, text, thread, reply, mentions, ...pending }); return pending.promise;
  };
  const state = { thread: 'peer-b' };
  const context = vm.createContext({
    $, state, document: { createElement: tag => new Element(tag) }, crypto: { randomUUID: () => `outgoing-${++sequence}` },
    URL: { createObjectURL: value => `blob:${value.name}`, revokeObjectURL: value => revoked.push(value) },
    t: (text, values = {}) => text.replace(/\{(\w+)\}/g, (_match, key) => values[key] ?? `{${key}}`),
    toast: text => toasts.push(text), errorText: error => error.message,
    syncComposerMentions() {}, renderReplyPreview() {}, stopTyping() {}, hideMentionOptions() {}, renderComposerHint() {},
    window: { addEventListener() {}, lumilan: {
      onFileProgress: callback => { onProgress = callback; },
      file: (value, thread, id) => { const pending = deferred(); files.push({ file: value, thread, id, ...pending }); return pending.promise; },
      cancelFile: id => { cancels.push(id); return Promise.resolve(true); },
      clipboardImage: value => { const pending = deferred(); validations.push({ file: value, ...pending }); return pending.promise; },
      message: (text, thread, reply) => recordMessage('private', text, thread, reply),
      roomMessage: (text, id, reply, mentions) => recordMessage('room', text, `room:${id}`, reply, mentions),
      note: (text, reply) => recordMessage('notes', text, 'notes', reply),
      announcement: (text, reply) => recordMessage('announcements', text, 'announcements', reply),
    } },
  });
  vm.runInContext(['let replyTo = null;', declarations, submit, uploads, clipboard].join('\n'), context);
  const descendants = element => [element, ...element.children.flatMap(descendants)];
  const rows = () => $('#transfer-progress').children.map(row => {
    const elements = descendants(row);
    return { text: elements.map(element => element.textContent).join(' '),
      progress: elements.find(element => element.tag === 'progress')?.value,
      buttons: elements.filter(element => element.tag === 'button') };
  });
  return {
    $, state, files, messages, cancels, toasts, revoked, validations,
    submit: () => $('#message-form').listeners.get('submit')({ preventDefault() {} }),
    upload: (value, thread = state.thread) => context.upload(value, thread),
    progress: value => onProgress(value),
    rows,
    click: (name, label) => {
      const row = rows().find(item => item.text.includes(name));
      assert(row, `Missing outgoing row: ${name}`);
      const button = row.buttons.find(item => item.textContent === label);
      assert(button, `Missing ${label} for ${name}`);
      return button.click();
    },
    draft: (text, thread = state.thread) => { $('#message-input').value = text; context.testDraftText = text; context.testDraftThread = thread; vm.runInContext('messageDrafts.set(testDraftThread, { text: testDraftText, mentions: [] });', context); },
    setReply: value => { context.testReply = value; vm.runInContext('replyTo = testReply;', context); },
    setImage: (value, thread = state.thread) => { context.testFile = value; context.testThread = thread; vm.runInContext('clipboardImage = { file: testFile, thread: testThread, url: URL.createObjectURL(testFile) }; renderClipboardImage();', context); },
    image: () => vm.runInContext('clipboardImage', context),
    draftFor: thread => { context.testThread = thread; return vm.runInContext('messageDrafts.get(testThread)', context); },
    paste: value => $('#message-input').listeners.get('paste')({ preventDefault() {}, clipboardData: { items: [{ kind: 'file', type: value.type, getAsFile: () => value }] } }),
  };
}

test('an image waiting for approval leaves text and another image available', async () => {
  const f = fixture();
  f.setImage(file('first.png'));
  const firstSubmit = f.submit();
  await flush();
  assert.equal(f.files.length, 1);
  assert.equal(f.$('#send-button').disabled, false, 'Waiting for recipient approval disabled the composer');
  assert.equal(f.$('#attach-button').disabled, false, 'Waiting for recipient approval disabled attachments');
  assert.equal(f.image(), null, 'The submitted image remained available to submit again');
  f.draft('A chat while you decide');
  const chat = f.submit();
  assert.equal(f.messages.length, 1, 'A pending image prevented sending text');
  f.messages[0].resolve({ delivered: 1 });
  await chat;
  f.setImage(file('second.png'));
  const secondSubmit = f.submit();
  await flush();
  assert.equal(f.files.length, 2, 'A pending image prevented submitting another image');
  assert.equal(f.files[0].thread, 'peer-b');
  assert.equal(f.files[1].thread, 'peer-b');
  assert(f.files.every(item => typeof item.id === 'string' && item.id));
  assert.notEqual(f.files[0].id, f.files[1].id, 'Independent file submissions reused one ID');
  f.files[0].resolve({ delivered: 1 });
  f.files[1].resolve({ delivered: 1 });
  await Promise.all([firstSubmit, secondSubmit]);
});

test('rapid image submission cannot duplicate the captured file or caption', async () => {
  const f = fixture();
  f.setImage(file('once.png'));
  f.draft('caption');
  const first = f.submit(), second = f.submit();
  await flush();
  assert.equal(f.files.length, 1, 'Rapid submission duplicated a file');
  assert.equal(f.messages.length, 1, 'Caption should be sent without waiting for recipient approval');
  assert.equal(f.messages[0].text, 'caption');
  f.messages[0].resolve({ delivered: 1 });
  f.files[0].resolve({ delivered: 1 });
  await Promise.all([first, second]);
});

test('an older image completion preserves a newer paste and draft', async () => {
  const f = fixture();
  f.setImage(file('older.png'));
  const sending = f.submit();
  await flush();
  f.setImage(file('newer.png'));
  f.draft('new draft');
  f.files[0].resolve({ delivered: 1 });
  await sending;
  assert.equal(f.image()?.file.name, 'newer.png', 'An older completion cleared the replacement preview');
  assert.equal(f.$('#message-input').value, 'new draft');
  assert.equal(f.draftFor('peer-b')?.text, 'new draft');
  assert(!f.revoked.includes('blob:newer.png'));
});

test('a captured caption keeps its thread, reply, and later drafts', async () => {
  const f = fixture();
  f.setReply('reply-in-b');
  f.setImage(file('for-b.png'));
  f.draft('Caption for B');
  const sending = f.submit();
  await flush();
  assert.equal(f.messages.length, 1);
  assert.equal(f.messages[0].thread, 'peer-b');
  assert.equal(f.messages[0].reply, 'reply-in-b');
  f.state.thread = 'peer-c';
  f.draft('Draft for C', 'peer-c');
  f.setImage(file('for-c.png'), 'peer-c');
  f.messages[0].resolve({ delivered: 1 });
  f.files[0].resolve({ delivered: 1 });
  await sending;
  assert.equal(f.$('#message-input').value, 'Draft for C');
  assert.equal(f.image()?.thread, 'peer-c');
  assert.equal(f.draftFor('peer-c')?.text, 'Draft for C');
});

test('sending an image does not invalidate a newer clipboard candidate still being checked', async () => {
  const f = fixture();
  f.setImage(file('ready.png'));
  const pasted = f.paste(file('being-checked.png'));
  assert.equal(f.validations.length, 1);
  const sending = f.submit();
  await flush();
  f.validations[0].resolve(true);
  await pasted;
  assert.equal(f.image()?.file.name, 'being-checked.png', 'Submitting the old preview canceled newer clipboard validation');
  f.files[0].resolve({ delivered: 1 });
  await sending;
  assert.equal(f.image()?.file.name, 'being-checked.png', 'An old completion cleared the newly validated image');
});

test('message completion preserves a replacement draft in the same thread', async () => {
  const f = fixture();
  f.draft('original text');
  const sending = f.submit();
  assert.equal(f.messages.length, 1);
  f.draft('replacement text');
  f.messages[0].resolve({ delivered: 1 });
  await sending;
  assert.equal(f.$('#message-input').value, 'replacement text');
  assert.equal(f.draftFor('peer-b')?.text, 'replacement text');
  assert.equal(f.$('#send-button').disabled, false);
});

test('eight pending files are bounded without blocking text or discarding an unsubmitted ninth image', async () => {
  const f = fixture();
  const pending = Array.from({ length: 8 }, (_unused, index) => f.upload(file(`pending-${index}.png`)));
  assert.equal(f.files.length, 8, 'Multiple pending approvals should have independent outgoing jobs');
  f.setImage(file('ninth.png'));
  const ninth = f.submit();
  await flush();
  assert.equal(f.files.length, 8, 'The renderer exceeded its pending outgoing limit');
  assert.equal(f.image()?.file.name, 'ninth.png', 'Admission rejection discarded an unsent preview');
  assert(f.toasts.length > 0, 'The outgoing limit was not explained');
  f.$('#clipboard-remove').click();
  f.draft('Still able to chat at the file limit');
  const chat = f.submit();
  assert.equal(f.messages.length, 1, 'The outgoing file limit blocked text');
  f.messages[0].resolve({ delivered: 1 });
  await chat;
  f.files.forEach(item => item.resolve({ delivered: 1 }));
  await Promise.all([...pending, ninth]);
  await flush();
  assert.equal(f.$('#transfer-progress').hidden, true);
});

test('a failed older transfer reports its error without changing a newer preview or text', async () => {
  const f = fixture();
  f.setImage(file('fails.png'));
  const sending = f.submit();
  await flush();
  f.setImage(file('replacement.png'));
  f.draft('Keep this text');
  f.files[0].reject(new Error('Recipient disconnected'));
  await sending;
  await flush();
  assert(f.toasts.some(text => text.includes('Recipient disconnected')));
  assert.equal(f.image()?.file.name, 'replacement.png');
  assert.equal(f.$('#message-input').value, 'Keep this text');
  assert.equal(f.draftFor('peer-b')?.text, 'Keep this text');
  assert.equal(f.$('#send-button').disabled, false);
  assert.equal(f.$('#attach-button').disabled, false);
});

test('progress and cancellation remain bound to independent outgoing IDs', async () => {
  const f = fixture();
  f.upload(file('alpha.png'));
  f.upload(file('beta.png'));
  assert.equal(f.files.length, 2);
  const alpha = f.files[0], beta = f.files[1];
  f.progress({ id: alpha.id, status: 'sending', sent: 20, total: 100 });
  f.progress({ id: beta.id, status: 'sending', sent: 70, total: 100 });
  const percentFor = name => f.rows().find(row => row.text.includes(name))?.progress;
  assert.equal(percentFor('alpha.png'), 20);
  assert.equal(percentFor('beta.png'), 70);
  f.progress({ id: 'unknown', status: 'sending', sent: 99, total: 100 });
  assert.equal(percentFor('alpha.png'), 20);
  assert.equal(percentFor('beta.png'), 70);
  await f.click('alpha.png', 'Batal');
  assert.deepEqual(f.cancels, [alpha.id], 'Canceling one row did not target its own job');
  f.progress({ id: alpha.id, status: 'sending', sent: 99, total: 100 });
  assert.notEqual(percentFor('alpha.png'), 99, 'Late progress replaced the cancellation state');
  alpha.reject(new Error('Pengiriman file dibatalkan.'));
  await flush();
  assert.equal(f.rows().length, 1, 'Canceled completion removed or retained the wrong row');
  assert.equal(percentFor('beta.png'), 70, 'An older job completion cleared another progress row');
  assert.equal(f.$('#transfer-progress').hidden, false);
  beta.resolve({ delivered: 1 });
  await flush();
  assert.equal(f.rows().length, 0);
  assert.equal(f.$('#transfer-progress').hidden, true);
});

test('failed file rows preserve their file for retry using a fresh ID and can be dismissed', async () => {
  const f = fixture(), captured = file('retry.png');
  f.upload(captured, 'peer-b');
  f.files[0].reject(new Error('Local staging failed'));
  await flush();
  assert.equal(f.rows().length, 1, 'The failed file was lost instead of remaining reviewable');
  assert(f.rows()[0].text.includes('Local staging failed'));
  f.state.thread = 'peer-c';
  f.setImage(file('newer.png'), 'peer-c');
  await f.click('retry.png', 'Coba lagi');
  assert.equal(f.files.length, 2);
  assert.equal(f.files[1].file, captured);
  assert.equal(f.files[1].thread, 'peer-b', 'Retry switched to the currently open conversation');
  assert.notEqual(f.files[1].id, f.files[0].id, 'Retry reused stale progress/cancel identity');
  f.progress({ id: f.files[0].id, status: 'sending', sent: 99, total: 100 });
  assert.notEqual(f.rows()[0].progress, 99, 'An old failed job updated its replacement');
  assert.equal(f.image()?.file.name, 'newer.png');
  f.files[1].reject(new Error('Recipient disconnected'));
  await flush();
  await f.click('retry.png', 'Hapus');
  assert.equal(f.rows().length, 0);
  assert.equal(f.$('#transfer-progress').hidden, true);
  assert.equal(f.image()?.file.name, 'newer.png');
  assert.deepEqual(f.cancels, [], 'Dismissing a settled failure canceled another job');
});
