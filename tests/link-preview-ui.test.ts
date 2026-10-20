import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/renderer/app.js', import.meta.url), 'utf8');
function section(start: string, end: string) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert(from >= 0 && to > from, `Missing renderer source boundary: ${start}`);
  return source.slice(from, to);
}
const declarations = section('const messageDrafts = new Map();', 'const incomingTransfers = new Map();');
const cards = section('const linkPlatforms = {', 'function renderIncomingTransfers(list) {');
const composer = section('function linkKey(', 'const outgoingTransfers = new Map();');
const submit = section("$('#message-form').addEventListener('submit'", "$('#message-input').addEventListener('keydown'");
const flush = async () => { for (let index = 0; index < 5; index++) await new Promise(resolve => setImmediate(resolve)); };
const peer = 'P'.repeat(46), url = 'https://youtu.be/dQw4w9WgXcQ';

class Element {
  tag: string; children: Element[] = []; parent: Element | null = null; listeners = new Map<string, ((event: unknown) => unknown)[]>();
  attributes = new Map<string, string>(); dataset: Record<string, string> = {}; style: Record<string, string> = {};
  hidden = false; disabled = false; focused = false; textContent = ''; value = ''; selectionStart = 0; className = ''; type = ''; alt = ''; decoding = ''; width = 0; height = 0;
  constructor(tag = 'div') { this.tag = tag; }
  get src() { return this.attributes.get('src') ?? ''; }
  set src(value: string) { this.attributes.set('src', value); }
  append(...children: Element[]) { for (const child of children) { child.parent = this; this.children.push(child); } }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  addEventListener(name: string, callback: (event: unknown) => unknown) { this.listeners.set(name, [...this.listeners.get(name) || [], callback]); }
  dispatch(name: string, event: unknown = {}) { return Promise.all((this.listeners.get(name) || []).map(callback => callback(event))); }
  click() { return this.disabled ? Promise.resolve([]) : this.dispatch('click'); }
  focus() { this.focused = true; }
}
const descendants = (element: Element): Element[] => [element, ...element.children.flatMap(descendants)];

function fixture() {
  const elements = new Map<string, Element>();
  const $ = (selector: string) => { let value = elements.get(selector); if (!value) elements.set(selector, value = new Element()); return value; };
  const requests: {text: string; thread: string; resolve(value: unknown): void; reject(error: Error): void}[] = [];
  const modes: unknown[] = [], opened: unknown[] = [], toasts: string[] = [], sent: unknown[][] = [];
  const timers: (() => void)[] = [];
  let modeFailure: Error | undefined, sendFailure: Error | undefined;
  const state = { thread: peer as string | null };
  const record = (kind: string) => async (...args: unknown[]) => {
    sent.push([kind, ...args]);
    if (sendFailure) throw sendFailure;
    return { delivered: 1, failed: 0 };
  };
  const context = vm.createContext({
    $, state, document: { createElement: (tag: string) => new Element(tag) }, URL,
    t: (text: string, values: Record<string, string> = {}) => text.replace(/\{(\w+)\}/g, (_match, key: string) => values[key] ?? ''),
    toast: (text: string) => toasts.push(text), errorText: (error: unknown) => error instanceof Error ? error.message : String(error),
    setTimeout: (callback: () => void) => timers.push(callback), clearTimeout: () => {},
    syncComposerMentions() {}, renderReplyPreview() {}, stopTyping() {}, hideMentionOptions() {}, renderComposerHint() {},
    window: { lumilan: {
      linkPreview: (text: string, thread: string) => new Promise((resolve, reject) => requests.push({ text, thread, resolve, reject })),
      setLinkPreviews: async (value: unknown) => { modes.push(value); if (modeFailure) throw modeFailure; return { linkPreviews: value }; },
      openLinkPreview: async (id: unknown) => { opened.push(id); if (id === 'broken') throw new Error('Tautan tidak dapat dibuka.'); return true; },
      message: record('message'), roomMessage: record('room'), note: record('note'), announcement: record('announcement'),
    } },
  });
  vm.runInContext(['let replyTo = null;', declarations, cards, composer, submit].join('\n'), context);
  // Match the markup: the card and consent row start hidden.
  for (const id of ['#link-preview', '#link-consent', '#link-preview-thumbnail']) $(id).hidden = true;
  const input = $('#message-input');
  const type = (value: string, pasted = false) => {
    input.value = value;
    input.selectionStart = value.length;
    vm.runInContext(`scheduleLinkPreview(${pasted})`, context);
    for (const timer of timers.splice(0)) timer();
  };
  const ready = (card: Record<string, unknown>, ask?: string) => ({ status: 'ready', token: `token-${requests.length}`, card: { url, platform: 'youtube', ...card }, ...(ask ? { ask } : {}) });
  return { $, state, context, input, type, ready, requests, modes, opened, toasts, sent, run: (code: string) => vm.runInContext(code, context),
    failModes: (error?: Error) => { modeFailure = error; }, failSends: (error?: Error) => { sendFailure = error; },
    submit: () => $('#message-form').dispatch('submit', { preventDefault() {} }) };
}

test('ask mode shows a local card with a named host and fetches only after Turn on', async () => {
  const f = fixture();
  f.type(`Tonton ${url}`);
  assert.equal(f.requests.length, 0, 'A link still being typed was looked up');
  f.type(`Tonton ${url} `);
  assert.deepEqual(f.requests.map(({ text, thread }) => [text, thread]), [[`Tonton ${url} `, peer]]);
  f.requests[0]!.resolve(f.ready({}, 'youtube.com'));
  await flush();
  assert.equal(f.$('#link-preview').hidden, false);
  assert.equal(f.$('#link-preview-title').textContent, 'youtu.be');
  assert.equal(f.$('#link-preview-url').textContent, url);
  assert.equal(f.$('#link-preview-thumbnail').hidden, true);
  assert.equal(f.$('#link-consent').hidden, false);
  assert.match(f.$('#link-consent-text').textContent, /youtube\.com/);
  await f.$('#link-consent-accept').click();
  await flush();
  assert.deepEqual(f.modes, ['on']);
  assert.equal(f.requests.length, 2, 'Turn on did not look the link up again');
  assert.equal(f.$('#link-consent').hidden, true);
  f.requests[1]!.resolve(f.ready({ title: 'Video', author: 'Kanal', thumbnail: 'data:image/webp;base64,AAAA' }));
  await flush();
  assert.equal(f.$('#link-preview-title').textContent, 'Video');
  assert.equal(f.$('#link-preview-author').textContent, 'Kanal');
  assert.equal(f.$('#link-preview-thumbnail').src, 'data:image/webp;base64,AAAA');
  assert.equal(f.$('#link-preview-thumbnail').hidden, false);
});

test('No thanks turns fetching off and keeps the local card', async () => {
  const f = fixture();
  f.type(url, true);
  assert.equal(f.requests.length, 1, 'A pasted link waited for more typing');
  f.requests[0]!.resolve(f.ready({}, 'youtube.com'));
  await flush();
  await f.$('#link-consent-decline').click();
  await flush();
  assert.deepEqual(f.modes, ['off']);
  assert.equal(f.requests.length, 1);
  assert.equal(f.$('#link-preview').hidden, false);
  assert.equal(f.$('#link-consent').hidden, true);
  f.failModes(new Error('Pengaturan tidak valid.'));
  const select = f.$('#link-previews-select');
  select.value = 'on';
  await select.dispatch('change', { target: select });
  await flush();
  assert.equal(select.value, 'off', 'A failed save left the select on the unsaved value');
  assert.deepEqual(f.toasts, ['Pengaturan tidak valid.']);
  f.failModes();
  select.value = 'ask';
  await select.dispatch('change', { target: select });
  await flush();
  assert.deepEqual(f.modes, ['off', 'on', 'ask']);
  assert.equal(f.$('#link-consent').hidden, true, 'A card already answered asked again');
});

test('one lookup runs at a time and an answer for a replaced draft is dropped', async () => {
  const f = fixture();
  f.type(`${url} `);
  f.type(`${url} https://x.com/jack/status/1 `);
  f.type(`https://x.com/jack/status/2 `);
  assert.equal(f.requests.length, 1);
  f.requests[0]!.resolve(f.ready({ title: 'Old' }));
  await flush();
  assert.equal(f.$('#link-preview').hidden, true, 'An answer for a replaced draft was shown');
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1]!.text, 'https://x.com/jack/status/2 ');
  f.requests[1]!.resolve({ status: 'ready', token: 'x', card: { url: 'https://x.com/jack/status/2', platform: 'x' } });
  await flush();
  assert.equal(f.$('#link-preview-platform').textContent, 'X');
  assert.equal(f.$('#link-preview-title').textContent, 'x.com');
  f.type('Tanpa tautan');
  assert.equal(f.$('#link-preview').hidden, true, 'Removing the link kept its card');
});

test('a card stays with its conversation and a removed card is not looked up again until the link changes', async () => {
  const f = fixture();
  f.type(`${url} `);
  f.run(`messageDrafts.set('${peer}', { text: '${url} ', mentions: [] })`);
  f.state.thread = 'notes';
  f.input.value = '';
  f.requests[0]!.resolve(f.ready({ title: 'Video' }));
  await flush();
  f.run('renderLinkPreview()');
  assert.equal(f.$('#link-preview').hidden, true, 'A card appeared in another conversation');
  f.state.thread = peer;
  f.input.value = `${url} `;
  f.run('renderLinkPreview()');
  assert.equal(f.$('#link-preview').hidden, false);
  await f.$('#link-preview-remove').click();
  assert.equal(f.$('#link-preview').hidden, true);
  assert.equal(f.input.focused, true);
  f.type(`${url} lagi`);
  assert.equal(f.requests.length, 1, 'A removed card was requested again');
  f.type('');
  f.type(`${url} `);
  assert.equal(f.requests.length, 2, 'Pasting the link again after removing it was ignored');
  f.state.thread = 'announcements';
  f.type(`${url} `);
  assert.equal(f.requests.length, 2, 'Announcements requested a preview');
});

test('a removed card never returns from a lookup in flight or for the same first link', async () => {
  const f = fixture();
  f.type(`${url} `);
  f.requests[0]!.resolve(f.ready({}, 'youtube.com'));
  await flush();
  await f.$('#link-consent-accept').click();
  await flush();
  await f.$('#link-preview-remove').click();
  f.requests[1]!.resolve(f.ready({ title: 'Video' }));
  await flush();
  assert.equal(f.$('#link-preview').hidden, true, 'An enriched answer restored a removed card');
  f.type(`${url} https://example.com/ `);
  assert.equal(f.requests.length, 3);
  f.requests[2]!.resolve(f.ready({ title: 'Video' }));
  await flush();
  assert.equal(f.$('#link-preview').hidden, true, 'Editing the draft restored a removed card');
  f.type(`https://x.com/jack/status/1 ${url} `);
  f.requests[3]!.resolve({ status: 'ready', token: 'x', card: { url: 'https://x.com/jack/status/1', platform: 'x' } });
  await flush();
  assert.equal(f.$('#link-preview').hidden, false, 'A different link stayed hidden');
});

test('Send passes the token only for the matching conversation and text, then retires the card', async () => {
  for (const [thread, kind, expected] of [
    [peer, 'message', ['message', `Lihat ${url}`, peer, null, 'token-1']],
    ['notes', 'note', ['note', `Lihat ${url}`, null, 'token-1']],
    ['room:11111111-1111-4111-8111-111111111111', 'room', ['room', `Lihat ${url}`, '11111111-1111-4111-8111-111111111111', null, [], 'token-1']],
  ] as const) {
    const f = fixture();
    f.state.thread = thread;
    f.type(`Lihat ${url}`, true);
    f.requests[0]!.resolve(f.ready({ title: 'Video' }));
    await flush();
    f.failSends(new Error('Penerima sedang offline.'));
    await f.submit();
    assert.equal(f.$('#link-preview').hidden, false, `${kind}: a failed send dropped the card`);
    f.failSends();
    await f.submit();
    assert.deepEqual(JSON.parse(JSON.stringify(f.sent.at(-1))), expected);
    assert.equal(f.$('#link-preview').hidden, true, `${kind}: the spent card stayed`);
    assert.equal(f.run(`linkStates.has(${JSON.stringify(thread)})`), false);
  }
  const f = fixture();
  f.type(`${url} `);
  f.requests[0]!.resolve(f.ready({}));
  await flush();
  f.input.value = 'Tautannya sudah dihapus';
  await f.submit();
  assert.equal(f.sent.at(-1)!.at(-1), undefined, 'A token was sent for text without its link');
  f.state.thread = 'announcements';
  f.run(`linkStates.set('announcements', { key: 'x', card: { token: 'leak', card: { url: '${url}', platform: 'youtube' } } })`);
  f.input.value = `Pengumuman ${url}`;
  await f.submit();
  assert.deepEqual(f.sent.at(-1), ['announcement', `Pengumuman ${url}`, null]);
});

test('message cards are static text with one Open in browser action', async () => {
  const f = fixture();
  const host =(message: Record<string, unknown>, thumbnail?: Element) => {
    const content = new Element();
    Object.assign(f.context, { cardHost: content, cardMessage: message, cardThumbnail: thumbnail });
    f.run('appendLinkPreview(cardHost, cardMessage, cardThumbnail)');
    return content;
  };
  const image = new Element('img');
  const full = host({ id: 'full', kind: 'text', preview: { url, platform: 'youtube', title: '<b>Video</b>', author: 'Kanal' } }, image);
  const card = full.children[0]!;
  assert.equal(card.className, 'link-card');
  assert.equal(card.dataset.platform, 'youtube');
  assert.equal(card.children[0], image);
  const texts = descendants(card).map(element => element.textContent).filter(Boolean);
  assert.deepEqual(texts, ['YouTube', '<b>Video</b>', 'Kanal', url, 'Buka di browser']);
  assert(!descendants(card).some(element => Object.hasOwn(element, 'innerHTML')), 'A card used HTML parsing');
  const open = descendants(card).find(element => element.className === 'link-open')!;
  await open.click();
  assert.deepEqual(f.opened, ['full']);
  const text = host({ id: 'text', kind: 'text', preview: { url, platform: 'youtube', title: 'Judul' } }).children[0]!;
  assert.deepEqual(descendants(text).map(element => element.className).filter(Boolean), ['link-card', 'link-copy', 'link-badge', 'link-title', 'link-url', 'link-open']);
  const basic = host({ id: 'broken', kind: 'text', preview: { url: 'https://www.instagram.com/reel/C1a2b3c4d5/', platform: 'instagram' } }).children[0]!;
  assert.equal(descendants(basic).find(element => element.className === 'link-title')!.textContent, 'instagram.com');
  await descendants(basic).find(element => element.className === 'link-open')!.click();
  await flush();
  assert.deepEqual(f.toasts, ['Tautan tidak dapat dibuka.']);
  assert.equal(host({ id: 'unknown', kind: 'text', preview: { url, platform: 'tiktok' } }).children.length, 0);
  assert.equal(host({ id: 'none', kind: 'text' }).children.length, 0);
});
