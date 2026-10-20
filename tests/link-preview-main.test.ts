import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import { detectSupportedUrl, enrichable, wirePreview, type DetectedLink, type LinkAttachment, type LinkFetch } from '../src/main/link-preview.js';
import { isRecord } from '../src/shared/model.js';

const main = readFileSync(new URL('../src/main/main.js', import.meta.url), 'utf8');
function between(start: string, end: string) {
  const from = main.indexOf(start), to = main.indexOf(end, from);
  assert(from >= 0 && to > from, `Missing main source between ${start} and ${end}`);
  return main.slice(from, to);
}
const staging = between('function persistSettings(', 'function decideFile(');
const handlers = between("handler('message',", "handler('react',");
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
// Objects made inside the vm have another realm's prototypes.
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
const peerId = 'P'.repeat(46), roomId = randomUUID();
const video = (id: string) => `https://youtu.be/${id.padEnd(11, 'x')}`;
type Ready = { status: 'ready'; token: string; card: Record<string, unknown>; ask?: string };

function fixture({ mode = 'ask' as 'ask' | 'on' | 'off', smoke = false } = {}) {
  const fetches: {link: DetectedLink; version: string; fetch: LinkFetch; finish(value: LinkAttachment): void}[] = [];
  const sent: {kind: string; text: unknown; thread: string; link: LinkAttachment | undefined}[] = [];
  const opened: string[] = [], warnings: unknown[][] = [], writes: string[] = [];
  const registered = new Map<string, (...args: unknown[]) => unknown>();
  let failSend: Error | undefined;
  const clock = { now: Date.now() };
  const send = (kind: string, thread: string) => async (text: unknown, link: LinkAttachment | undefined) => {
    if (failSend) throw failSend;
    sent.push({ kind, text, thread, link });
    return { delivered: 1 };
  };
  const peer = {
    sendMessage: (text: unknown, to: string, _reply: unknown, link: LinkAttachment | undefined) => send('message', to)(text, link),
    sendRoomMessage: (text: unknown, id: string, _reply: unknown, _mentions: unknown, link: LinkAttachment | undefined) => send('room', `room:${id}`)(text, link),
    saveNote: (text: unknown, _reply: unknown, link: LinkAttachment | undefined) => send('note', 'notes')(text, link),
    linkThumbnail: async (id: string) => `data:image/webp;base64,${id}`,
    linkTarget: (id: string) => { if (id !== 'stored') throw new Error('Tautan tidak dapat dibuka.'); return 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'; },
  };
  const context = vm.createContext({
    app: { commandLine: { hasSwitch: (name: string) => smoke && name === 'lumilan-ui-smoke' }, getVersion: () => '1.3.0' },
    net: { fetch: () => assert.fail('Production network used in a test') },
    settings: { linkPreviews: mode, language: 'id' }, settingsPath: 'settings.json',
    writeFileSync: (_path: string, value: string) => { writes.push(value); }, renameSync: () => {},
    randomUUID, Date: { now: () => clock.now }, console: { warn: (...args: unknown[]) => warnings.push(args) },
    detectSupportedUrl, enrichable, wirePreview,
    fetchLinkPreview: (link: DetectedLink, options: {fetch: LinkFetch; version: string}) => new Promise<LinkAttachment>(finish => fetches.push({ link, ...options, finish })),
    peer, shell: { openExternal: async (url: string) => { opened.push(url); } },
    deletingHistory: 0, previewRequests: new Set(),
    inputString: (value: unknown) => { if (typeof value !== 'string') throw new Error('Permintaan tidak valid.'); return value; },
    handler: (name: string, action: (...args: unknown[]) => unknown) => registered.set(name, action),
  });
  vm.runInContext(`${staging}\n${handlers}`, context);
  const call = async (name: string, ...args: unknown[]) => {
    const action = registered.get(name);
    assert(action, `Missing ${name} handler`);
    return action(...args);
  };
  const preview = async (text: string, thread: string = peerId): Promise<Ready> => {
    const value: unknown = await call('link-preview', text, thread);
    assert(isRecord(value) && value.status === 'ready' && typeof value.token === 'string' && isRecord(value.card));
    return value as Ready;
  };
  return { call, preview, fetches, sent, opened, warnings, writes, clock, context,
    fail: (error?: Error) => { failSend = error; }, stages: () => vm.runInContext('linkStages.size', context) as number };
}

test('ask and off give a local card without contacting any host', async () => {
  for (const mode of ['ask', 'off'] as const) {
    const f = fixture({ mode });
    const result = await f.preview(`Lihat ${video('dQw4w9WgXcQ')}`);
    assert.deepEqual(result.card, { url: video('dQw4w9WgXcQ'), platform: 'youtube' });
    assert.equal(result.ask, mode === 'ask' ? 'youtube.com' : undefined);
    const local = await f.preview('https://x.com/jack/status/20');
    assert.equal(local.ask, undefined, 'A platform without a fetcher asked for consent');
    assert.equal(f.fetches.length, 0);
  }
  const f = fixture({ mode: 'on' });
  const facebook = await f.preview('https://www.facebook.com/watch?v=1');
  assert.deepEqual(facebook.card, { url: 'https://www.facebook.com/watch?v=1', platform: 'facebook' });
  assert.equal(facebook.ask, undefined);
  assert.equal(f.fetches.length, 0, 'Facebook was fetched');
});

test('conversation shape, announcements and plain text are checked before any lookup', async () => {
  const f = fixture({ mode: 'on' });
  assert.deepEqual(plain(await f.call('link-preview', video('dQw4w9WgXcQ'), 'announcements')), { status: 'none' });
  assert.deepEqual(plain(await f.call('link-preview', 'tanpa tautan', peerId)), { status: 'none' });
  assert.deepEqual(plain(await f.call('link-preview', 'https://example.com/', 'notes')), { status: 'none' });
  for (const [text, thread] of [[video('a'), 'room:not-a-uuid'], [video('a'), '../x'], [video('a'), 4], ['x'.repeat(4001), peerId], [4, peerId]] as const)
    await assert.rejects(f.call('link-preview', text, thread), /Permintaan tidak valid/);
  const room = f.preview(video('dQw4w9WgXcQ'), `room:${roomId}`);
  await flush();
  f.fetches[0]!.finish({ preview: { url: video('dQw4w9WgXcQ'), platform: 'youtube', title: 'Video' } });
  assert.equal((await room).card.title, 'Video');
  assert.equal(f.fetches.length, 1);
});

test('on looks up the link as written and keeps the local card when the lookup fails', async () => {
  const f = fixture({ mode: 'on' });
  const first = f.preview('https://youtu.be/dQw4w9WgXcQ');
  await flush();
  assert.equal(f.fetches[0]!.version, '1.3.0');
  assert.equal(f.fetches[0]!.link.url, 'https://youtu.be/dQw4w9WgXcQ');
  f.fetches[0]!.finish({ preview: { url: 'https://youtu.be/dQw4w9WgXcQ', platform: 'youtube', title: 'Video' } });
  const card = await first;
  assert.deepEqual(card.card, { url: 'https://youtu.be/dQw4w9WgXcQ', platform: 'youtube', title: 'Video' });
  assert.equal(card.ask, undefined);
  const failed = f.preview(video('AAAAAAAAAAA'));
  await flush();
  f.fetches[1]!.finish({ preview: { url: video('AAAAAAAAAAA'), platform: 'youtube' } });
  assert.deepEqual((await failed).card, { url: video('AAAAAAAAAAA'), platform: 'youtube' });
});

test('at most two lookups run at once; extra links get the local card immediately', async () => {
  const f = fixture({ mode: 'on' });
  const pending = [f.preview(video('B')), f.preview(video('C'))];
  await flush();
  const third = await f.preview(video('D'));
  assert.deepEqual(third.card, { url: video('D'), platform: 'youtube' });
  assert.equal(f.fetches.length, 2);
  for (const fetch of f.fetches) fetch.finish({ preview: { url: fetch.link.url, platform: 'youtube' } });
  await Promise.all(pending);
});

test('tokens are bound to their conversation, spent on success, kept on failure, and expire quietly', async () => {
  const f = fixture({ mode: 'off' });
  const card = await f.preview(`Tonton ${video('dQw4w9WgXcQ')}`);
  await assert.rejects(f.call('message', 'teks', 'Q'.repeat(46), null, card.token), /Permintaan ditolak/);
  await assert.rejects(f.call('note', 'teks', null, card.token), /Permintaan ditolak/);
  await assert.rejects(f.call('message', 'teks', peerId, null, 42), /Permintaan tidak valid/);
  assert.equal(f.sent.length, 0);
  f.fail(new Error('Penerima sedang offline.'));
  await assert.rejects(f.call('message', 'teks', peerId, null, card.token), /offline/);
  f.fail();
  await f.call('message', 'teks', peerId, null, card.token);
  assert.deepEqual(plain(f.sent.at(-1)!.link?.preview), { url: video('dQw4w9WgXcQ'), platform: 'youtube' });
  await f.call('message', 'teks', peerId, null, card.token);
  assert.equal(f.sent.at(-1)!.link, undefined, 'A spent token attached a preview twice');
  assert.equal(f.warnings.length, 1);
  const room = await f.preview(video('dQw4w9WgXcQ'), `room:${roomId}`);
  await f.call('room-message', 'teks', roomId, null, [], room.token);
  assert.equal(f.sent.at(-1)!.thread, `room:${roomId}`);
  assert(f.sent.at(-1)!.link);
  const note = await f.preview(video('dQw4w9WgXcQ'), 'notes');
  f.clock.now += 31 * 60_000;
  await f.call('note', 'teks', null, note.token);
  assert.equal(f.sent.at(-1)!.link, undefined, 'An expired token attached a preview');
  await f.call('message', 'tanpa pratinjau', peerId, null, undefined);
  assert.equal(f.sent.at(-1)!.link, undefined);
});

test('only the eight newest cards stay staged', async () => {
  const f = fixture({ mode: 'off' });
  const cards = [];
  for (let index = 0; index < 9; index++) cards.push(await f.preview(video(String(index))));
  assert.equal(f.stages(), 8);
  await f.call('message', 'teks', peerId, null, cards[0]!.token);
  assert.equal(f.sent.at(-1)!.link, undefined, 'The evicted card was still attached');
  await f.call('message', 'teks', peerId, null, cards[8]!.token);
  assert(f.sent.at(-1)!.link);
});

test('opening, thumbnails and the setting stay behind main-process checks', async () => {
  const f = fixture({ mode: 'ask' });
  assert.equal(await f.call('open-link-preview', 'stored'), true);
  assert.deepEqual(f.opened, ['https://www.youtube.com/watch?v=dQw4w9WgXcQ']);
  await assert.rejects(f.call('open-link-preview', 'missing'), /tidak dapat dibuka/);
  await assert.rejects(f.call('open-link-preview', { url: 'https://evil.example/' }), /Permintaan tidak valid/);
  assert.equal(f.opened.length, 1);
  assert.equal(await f.call('link-preview-thumbnail', 'abc'), 'data:image/webp;base64,abc');
  f.context.deletingHistory = 1;
  await assert.rejects(f.call('link-preview-thumbnail', 'abc'), /tidak tersedia/);
  for (const value of ['maybe', true, null, 'ON']) await assert.rejects(f.call('set-link-previews', value), /Pengaturan tidak valid/);
  assert.equal(f.writes.length, 0);
  assert.deepEqual(plain(await f.call('set-link-previews', 'on')), { linkPreviews: 'on' });
  assert.equal(JSON.parse(f.writes.at(-1)!).linkPreviews, 'on');
  void f.preview('https://youtu.be/dQw4w9WgXcQ');
  await flush();
  assert.equal(f.fetches.length, 1, 'On did not look the link up');
  await f.call('set-link-previews', 'off');
  await f.preview('https://youtu.be/dQw4w9WgXcQ');
  assert.equal(f.fetches.length, 1, 'Off still looked the link up');
});

test('smoke runs refuse the network unless an in-process fixture is installed', async () => {
  const f = fixture({ smoke: true });
  const linkFetch = vm.runInContext('linkFetch', f.context) as LinkFetch;
  await assert.rejects(linkFetch('https://www.youtube.com/oembed', {}), /dinonaktifkan dalam mode smoke/);
  Reflect.set(f.context, 'smokeLinkFetch', async (url: string) => new Response(url));
  assert.equal(await (await linkFetch('https://www.youtube.com/oembed', {})).text(), 'https://www.youtube.com/oembed');
});
