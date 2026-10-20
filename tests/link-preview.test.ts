import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { MAX_THUMBNAIL_BYTES, RECEIVER_PIXELS, SENDER_PIXELS, canonicalizeLinkUrl, detectSupportedUrl, fetchLinkPreview, prepareThumbnail, readWirePreview, wirePreview, type DetectedLink, type LinkFetch } from '../src/main/link-preview.js';
import { readPeerState, type PeerState } from '../src/shared/model.js';

const VIDEO = 'dQw4w9WgXcQ';
const image = (width: number, height: number, format: 'png' | 'jpeg' | 'webp' = 'png') =>
  sharp({ create: { width, height, channels: 3, background: '#6391bc' } }).toFormat(format).toBuffer();
const link = (url: string) => { const value = canonicalizeLinkUrl(url); assert(value, url); return value; };
function routes(table: Record<string, () => Response | Promise<Response>>) {
  const calls: {url: string; init: RequestInit}[] = [];
  const fetch: LinkFetch = async (url, init) => {
    calls.push({ url, init });
    const route = table[url];
    if (!route) throw new Error(`Unexpected request: ${url}`);
    return route();
  };
  return { fetch, calls };
}
const json = (value: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
const html = (value: string) => new Response(value, { status: 200, headers: { 'content-type': 'text/html' } });
const oembed = (url: string) => `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`;
const watch = `https://www.youtube.com/watch?v=${VIDEO}`;

test('supported links are canonicalized; lookalikes, credentials, ports and plain http are refused', () => {
  for (const [input, platform, canonical] of [
    [`https://youtu.be/${VIDEO}?si=share`, 'youtube', watch],
    [`https://www.youtube.com/shorts/${VIDEO}?feature=share`, 'youtube', `https://www.youtube.com/shorts/${VIDEO}`],
    [`https://m.youtube.com/watch?v=${VIDEO}&t=10`, 'youtube', watch],
    [`https://youtube.com/live/${VIDEO}`, 'youtube', watch],
    [`https://www.youtube.com/embed/${VIDEO}/`, 'youtube', watch],
    ['https://www.instagram.com/reel/C1a2b3c4d5/?igsh=abc', 'instagram', 'https://www.instagram.com/reel/C1a2b3c4d5/'],
    ['https://instagram.com/some.one/p/C1a2b3c4d5', 'instagram', 'https://www.instagram.com/p/C1a2b3c4d5/'],
    ['https://www.instagram.com/reels/C1a2b3c4d5/', 'instagram', 'https://www.instagram.com/reel/C1a2b3c4d5/'],
    ['https://m.facebook.com/watch?v=123&fbclid=tracking', 'facebook', 'https://www.facebook.com/watch?v=123'],
    ['https://fb.watch/abcDEF/', 'facebook', 'https://fb.watch/abcDEF/'],
    ['https://www.threads.net/@user.name/post/C1a2b3c4d5?xmt=1', 'threads', 'https://www.threads.com/@user.name/post/C1a2b3c4d5'],
    ['https://twitter.com/jack/status/20?s=20', 'x', 'https://x.com/jack/status/20'],
    ['https://x.com/i/web/status/123', 'x', 'https://x.com/i/status/123'],
    ['https://x.com/jack/status/20/photo/1', 'x', 'https://x.com/jack/status/20'],
  ] as const) {
    const value = canonicalizeLinkUrl(input);
    assert.equal(value?.platform, platform, input);
    assert.equal(value.canonical, canonical, input);
    assert.equal(value.url, input);
  }
  for (const input of [`http://youtu.be/${VIDEO}`, `https://youtube.com.evil.example/watch?v=${VIDEO}`, `https://evil.example/youtu.be/${VIDEO}`,
    `https://user:pass@youtu.be/${VIDEO}`, `https://youtu.be:444/${VIDEO}`, 'https://youtu.be/short', `https://www.youtube.com/watch?v=${VIDEO}x`,
    `https://www.youtube.com/channel/${VIDEO}`, 'https://www.instagram.com/accounts/login/', 'https://www.instagram.com/someone/', 'https://facebook.com/',
    'https://x.com/jack', 'https://threads.com/@user', 'https://example.com/', `https://www.youtube.com/watch?v=${VIDEO}#`.repeat(80), 'not a url'])
    assert.equal(canonicalizeLinkUrl(input), null, input);
});

test('detection takes the first supported https link and trims surrounding punctuation', () => {
  assert.equal(detectSupportedUrl(`Lihat ini: https://youtu.be/${VIDEO}.`)?.url, `https://youtu.be/${VIDEO}`);
  assert.equal(detectSupportedUrl(`**https://youtu.be/${VIDEO}**`)?.url, `https://youtu.be/${VIDEO}`);
  assert.equal(detectSupportedUrl(`(https://youtu.be/${VIDEO})`)?.url, `https://youtu.be/${VIDEO}`);
  assert.equal(detectSupportedUrl('https://example.com/a lalu https://x.com/jack/status/1 dan https://youtu.be/dQw4w9WgXcQ')?.platform, 'x');
  assert.equal(detectSupportedUrl(`HTTPS://YOUTU.BE/${VIDEO}`)?.url, `HTTPS://YOUTU.BE/${VIDEO}`);
  assert.equal(detectSupportedUrl(`youtu.be/${VIDEO} www.youtube.com/watch?v=${VIDEO}`), null, 'A link without a scheme became a card');
  assert.equal(detectSupportedUrl('Tidak ada tautan'), null);
});

test('platforms without a fetcher never touch the network', async () => {
  const { fetch, calls } = routes({});
  for (const url of ['https://www.facebook.com/watch?v=1', 'https://www.threads.com/t/C1a2b3c4d5', 'https://x.com/jack/status/20']) {
    const result = await fetchLinkPreview(link(url), { fetch, version: '1.3.0' });
    assert.deepEqual(result, { preview: { url, platform: link(url).platform } });
  }
  assert.equal(calls.length, 0);
});

test('YouTube and Shorts use oEmbed with a bounded, cookieless request and a re-encoded thumbnail', async () => {
  const shorts = `https://youtube.com/shorts/${VIDEO}`;
  const { fetch, calls } = routes({
    [oembed(watch)]: () => json({ title: '  Judul\u202e\u0000 video  ', author_name: 'Kanal', thumbnail_url: `https://i.ytimg.com/vi/${VIDEO}/hqdefault.jpg` }),
    [`https://i.ytimg.com/vi/${VIDEO}/hqdefault.jpg`]: async () => new Response(new Uint8Array(await image(1200, 800, 'jpeg')), { status: 200 }),
  });
  const result = await fetchLinkPreview(link(shorts), { fetch, version: '1.3.0' });
  assert.deepEqual(result.preview, { url: shorts, platform: 'youtube', title: 'Judul video', author: 'Kanal' });
  assert(result.thumbnail);
  assert.deepEqual([result.thumbnail.width, result.thumbnail.height], [512, 341]);
  assert(result.thumbnail.bytes.length <= MAX_THUMBNAIL_BYTES);
  assert.equal((await sharp(result.thumbnail.bytes).metadata()).format, 'webp');
  assert.deepEqual(calls.map(call => call.url), [oembed(watch), `https://i.ytimg.com/vi/${VIDEO}/hqdefault.jpg`], 'Shorts must use the watch form for oEmbed');
  for (const { init } of calls) {
    assert.equal(init.redirect, 'error');
    assert.equal(init.credentials, 'omit');
    assert(init.signal);
    assert.match(String(Reflect.get(init.headers ?? {}, 'User-Agent')), /^Lumilan Chat\/1\.3\.0 \(\+https:\/\/github\.com\/iyansanjaya\/lumilan-chat\)$/);
  }
});

test('thumbnails from other hosts or schemes are never fetched; failures leave the local card', async () => {
  for (const thumbnail_url of ['https://evil.example/a.jpg', `http://i.ytimg.com/vi/${VIDEO}/a.jpg`, `https://i.ytimg.com.evil.example/a.jpg`, `https://user@i.ytimg.com/a.jpg`, 4]) {
    const { fetch, calls } = routes({ [oembed(watch)]: () => json({ title: 'Video', thumbnail_url }) });
    const result = await fetchLinkPreview(link(watch), { fetch, version: '1' });
    assert.deepEqual(result, { preview: { url: watch, platform: 'youtube', title: 'Video' } }, String(thumbnail_url));
    assert.equal(calls.length, 1);
  }
  const basic = { preview: { url: watch, platform: 'youtube' } };
  for (const response of [
    () => { throw new TypeError('Redirect was cancelled'); },
    () => new Response(null, { status: 302, headers: { location: 'https://evil.example/' } }),
    () => new Response('nope', { status: 404 }),
    () => new Response('{not json', { status: 200 }),
    () => json({ author_name: 'Untitled' }),
  ]) assert.deepEqual(await fetchLinkPreview(link(watch), { fetch: routes({ [oembed(watch)]: response }).fetch, version: '1' }), basic);
  const broken = routes({
    [oembed(watch)]: () => json({ title: 'Video', thumbnail_url: 'https://i.ytimg.com/a.gif' }),
    'https://i.ytimg.com/a.gif': () => new Response(new Uint8Array(Buffer.from('GIF89a....')), { status: 200 }),
  });
  assert.deepEqual(await fetchLinkPreview(link(watch), { fetch: broken.fetch, version: '1' }), { preview: { url: watch, platform: 'youtube', title: 'Video' } });
});

test('oversized answers are refused from the declared length and while streaming', async () => {
  let canceled = 0;
  const endless = () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(16 * 1024)); },
    cancel() { canceled++; },
  }), { status: 200 });
  const declared = routes({ [oembed(watch)]: () => new Response('{}', { status: 200, headers: { 'content-length': String(64 * 1024 + 1) } }) });
  assert.deepEqual(await fetchLinkPreview(link(watch), { fetch: declared.fetch, version: '1' }), { preview: { url: watch, platform: 'youtube' } });
  const streamed = routes({ [oembed(watch)]: endless });
  assert.deepEqual(await fetchLinkPreview(link(watch), { fetch: streamed.fetch, version: '1' }), { preview: { url: watch, platform: 'youtube' } });
  assert.equal(canceled, 1, 'The oversized body was not canceled');
  const largeImage = routes({
    [oembed(watch)]: () => json({ title: 'Video', thumbnail_url: 'https://i.ytimg.com/big.jpg' }),
    'https://i.ytimg.com/big.jpg': () => new Response('x', { status: 200, headers: { 'content-length': String(5 * 1024 * 1024 + 1) } }),
  });
  assert.deepEqual(await fetchLinkPreview(link(watch), { fetch: largeImage.fetch, version: '1' }), { preview: { url: watch, platform: 'youtube', title: 'Video' } });
});

test('one deadline bounds the whole lookup, including a stalled response body', { timeout: 5000 }, async t => {
  // AbortSignal.timeout does not keep Node alive; Electron's main process always does.
  const alive = setInterval(() => {}, 1000);
  t.after(() => clearInterval(alive));
  // Like Electron's net.fetch, which was probed to reject both a pending request and a stalled body read on abort.
  const aborted = (signal: AbortSignal | null | undefined) => new Promise<never>((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }));
  const hanging: LinkFetch = (_url, init) => aborted(init.signal);
  const started = Date.now();
  assert.deepEqual(await fetchLinkPreview(link(watch), { fetch: hanging, version: '1', timeout: 50 }), { preview: { url: watch, platform: 'youtube' } });
  const stalledBody: LinkFetch = async (_url, init) => new Response(new ReadableStream({ start: controller => { void aborted(init.signal).catch(error => controller.error(error)); } }), { status: 200 });
  assert.deepEqual(await fetchLinkPreview(link(watch), { fetch: stalledBody, version: '1', timeout: 50 }), { preview: { url: watch, platform: 'youtube' } });
  assert(Date.now() - started < 2000, 'Lookup outlived its deadline');
});

test('Instagram Open Graph is used only when the page names the same post', async () => {
  const reel = 'https://www.instagram.com/reel/C1a2b3c4d5/?igsh=share';
  const page = (tags: string) => `<!doctype html><html><head><title>Fallback &amp; title</title>${tags}</head><body><meta property="og:title" content="Body tag"></body></html>`;
  const post = page(`<meta name="twitter:title" content="Twitter title">
    <meta property="og:title" content="Andi on Instagram: &quot;Senja &#x2022; Bali&quot; &#128512;">
    <meta content="Caption &amp; more" property="og:description">
    <meta property="og:url" content="https://www.instagram.com/p/C1a2b3c4d5/">
    <meta property='og:image' content='https://scontent-sin6-2.cdninstagram.com/v/t51/photo.jpg?stp=1&amp;oh=2'>`);
  const photo = 'https://scontent-sin6-2.cdninstagram.com/v/t51/photo.jpg?stp=1&oh=2';
  const { fetch, calls } = routes({ 'https://www.instagram.com/reel/C1a2b3c4d5/': () => html(post), [photo]: async () => new Response(new Uint8Array(await image(640, 640, 'webp')), { status: 200 }) });
  const result = await fetchLinkPreview(link(reel), { fetch, version: '1' });
  assert.deepEqual(result.preview, { url: reel, platform: 'instagram', title: 'Andi on Instagram: "Senja • Bali" 😀' });
  assert.deepEqual([result.thumbnail?.width, result.thumbnail?.height], [512, 512]);
  assert.deepEqual(calls.map(call => call.url), ['https://www.instagram.com/reel/C1a2b3c4d5/', photo]);
  const basic = { preview: { url: reel, platform: 'instagram' } };
  for (const tags of [
    '<meta property="og:title" content="Instagram"><meta property="og:url" content="https://www.instagram.com/accounts/login/">',
    '<meta property="og:title" content="Login • Instagram">',
    '<meta property="og:title" content="Another post"><meta property="og:url" content="https://www.instagram.com/p/Z9z9z9z9z9/">',
    `${'<meta name="filler" content="x">'.repeat(200)}<meta property="og:title" content="Late"><meta property="og:url" content="https://www.instagram.com/p/C1a2b3c4d5/">`,
  ]) assert.deepEqual(await fetchLinkPreview(link(reel), { fetch: routes({ 'https://www.instagram.com/reel/C1a2b3c4d5/': () => html(page(tags)) }).fetch, version: '1' }), basic);
});

test('thumbnails are re-encoded single-frame WebP within the pixel and byte limits', async () => {
  for (const format of ['png', 'jpeg', 'webp'] as const) {
    const result = await prepareThumbnail(await image(1200, 800, format), RECEIVER_PIXELS);
    assert.deepEqual([result.width, result.height], [512, 341], format);
    assert(result.bytes.length <= MAX_THUMBNAIL_BYTES);
    const metadata = await sharp(result.bytes).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.pages ?? 1, 1);
  }
  // Random pixels do not compress: their 512 px WebP is about 115 KB, over the 96 KB thumbnail limit.
  const noise = await sharp(randomBytes(900 * 900 * 3), { raw: { width: 900, height: 900, channels: 3 } }).png().toBuffer();
  await assert.rejects(prepareThumbnail(noise, SENDER_PIXELS), /tidak tersedia/);
  const large = await image(2100, 2000);
  await assert.rejects(prepareThumbnail(large, RECEIVER_PIXELS), /tidak tersedia/);
  assert.equal((await prepareThumbnail(large, SENDER_PIXELS)).width, 512);
  // Frames must differ, or the encoder merges them into one.
  const frames = Buffer.alloc(16 * 32 * 3, 200);
  frames.fill(20, 16 * 16 * 3);
  const gif = await sharp(frames, { raw: { width: 16, height: 32, pageHeight: 16, channels: 3 } }).gif({ delay: [100, 100] }).toBuffer();
  const animated = await sharp(gif, { animated: true }).webp().toBuffer();
  assert.equal((await sharp(animated).metadata()).pages, 2);
  const first = await prepareThumbnail(animated, SENDER_PIXELS);
  assert.deepEqual([first.width, first.height, (await sharp(first.bytes).metadata()).pages ?? 1], [16, 16, 1], 'Animated WebP did not become its first frame');
  for (const rejected of [
    gif,
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'), Buffer.from('not an image'), Buffer.alloc(0),
    (await image(64, 64)).subarray(0, 60),
  ]) await assert.rejects(prepareThumbnail(rejected, SENDER_PIXELS));
});

test('wire previews are rebuilt from whitelisted fields and must describe the first link in the text', async () => {
  const thumbnail = await prepareThumbnail(await image(300, 200), SENDER_PIXELS);
  const url = `https://youtu.be/${VIDEO}`, text = `Tonton ${url} ya`;
  const wire = wirePreview({ preview: { url, platform: 'youtube', title: 'Video', author: 'Kanal' }, thumbnail });
  assert.match(String(wire.thumbnail), /^data:image\/webp;base64,/);
  const read = readWirePreview({ ...wire, extra: 'ignored', title: `\u202e${'J'.repeat(400)}` }, text);
  assert(read?.thumbnail);
  assert.deepEqual(read.thumbnail, thumbnail.bytes);
  assert.deepEqual(read.preview, { url, platform: 'youtube', title: 'J'.repeat(200), author: 'Kanal' });
  assert.equal(readWirePreview(undefined, text), undefined);
  for (const input of [null, 'string', { ...wire, url: 'https://youtu.be/AAAAAAAAAAA' }, { ...wire, platform: 'instagram' }, { ...wire, url: 'https://example.com/' }])
    assert.equal(readWirePreview(input, text), undefined, JSON.stringify(input).slice(0, 80));
  assert.equal(readWirePreview(wire, `https://x.com/jack/status/1 lalu ${url}`), undefined, 'A card for the second link was accepted');
  assert.equal(readWirePreview(wire, `${url}XYZ`), undefined, 'A card for an edited link was accepted');
  const gif = `data:image/gif;base64,${Buffer.from('GIF89a').toString('base64')}`;
  const oversized = `data:image/webp;base64,${Buffer.alloc(MAX_THUMBNAIL_BYTES + 1).toString('base64')}`;
  for (const value of [gif, oversized, 'data:image/webp;base64,', 'data:image/webp;base64,@@@@', 4])
    assert.deepEqual(readWirePreview({ ...wire, thumbnail: value }, text), { preview: { url, platform: 'youtube', title: 'Video', author: 'Kanal' } });
});

test('saved history drops malformed previews without rejecting the conversation', () => {
  const defaults: PeerState = { name: '', status: 'active', about: '', avatar: '', trusted: [], contactLabels: {}, reminders: [], reminderTombstones: [], rooms: [], declinedRooms: [], leftRooms: [], roomTombstones: [], archivedThreads: {}, pendingFileDeletes: [], messages: [], unread: {}, announcementsEnabled: true, announcementRoomCreated: false, mutedAnnouncements: [], mutedThreads: [] };
  const message = (preview: unknown) => ({ id: randomUUID(), from: 'a', to: 'b', at: 1, kind: 'text', text: `https://youtu.be/${VIDEO}`, preview });
  const valid = { url: `https://youtu.be/${VIDEO}`, platform: 'youtube', title: 'Video', thumbnail: { width: 512, height: 288 } };
  const state = readPeerState({ name: 'Andi', messages: [message(valid), message({ url: 5 }), message({ ...valid, platform: 'tiktok' }), message({ ...valid, thumbnail: { width: 0, height: 1 } }), message({ ...valid, thumbnail: { width: 9999, height: 1 } }), message({ ...valid, title: 4 })] }, defaults);
  assert.equal(state.messages.length, 6);
  assert.deepEqual(state.messages[0]!.preview, valid);
  for (const item of state.messages.slice(1)) assert.equal(item.preview, undefined);
});

test('link hosts shown before fetching never include subdomain prefixes', () => {
  const hosts = (urls: string[]) => urls.map(url => (link(url) satisfies DetectedLink).host);
  assert.deepEqual(hosts([`https://m.youtube.com/watch?v=${VIDEO}`, `https://youtu.be/${VIDEO}`, 'https://instagram.com/p/C1a2b3c4d5/']), ['youtube.com', 'youtube.com', 'instagram.com']);
});
