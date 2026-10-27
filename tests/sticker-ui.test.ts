import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/renderer/app.js', import.meta.url), 'utf8');
function section(startText: string, endText: string) {
  const start = source.indexOf(startText), end = source.indexOf(endText, start + startText.length);
  assert(start >= 0 && end > start, `Missing renderer source boundary: ${startText}`);
  return source.slice(start, end);
}
// The compiled branch ends with its closing brace before `else if (message.kind === 'file')`.
const stickerBranch = section('if (message.sticker) {', "else if (message.kind === 'file')");
const summary = section('function messageSummary(', '\nfunction renderReplyPreview(');

class Element {
  children: Element[] = [];
  className = '';
  constructor(readonly tag: string) {}
  append(...children: Element[]) { this.children.push(...children); }
}
class HTMLImageElement extends Element {}

function render(message: Record<string, unknown>, kept?: Element) {
  const content = new Element('content'), observed: unknown[][] = [], created: unknown[][] = [];
  const stickersUI = {
    messageImage: (id: string, size: unknown) => { created.push([id, size]); return new HTMLImageElement('img'); },
    observe: (...args: unknown[]) => { observed.push(args); },
  };
  const shownPreviews = new Map(kept ? [[message.id, kept]] : []);
  vm.runInContext(stickerBranch, vm.createContext({ document: { createElement: (tag: string) => new Element(tag) }, HTMLImageElement, stickersUI, shownPreviews, message, content }));
  return { content, observed, created };
}

test('a sticker message is a bare image whose size is reserved before it loads', () => {
  const size = { width: 120, height: 90, animated: true };
  const { content, observed, created } = render({ id: 'm1', kind: 'file', name: 'sticker.webp', sticker: size });
  assert.equal(content.children.length, 1);
  const figure = content.children[0]!;
  assert.equal(figure.tag, 'figure');
  assert.equal(figure.className, 'sticker-bubble');
  assert.equal(figure.children.length, 1);
  assert.deepEqual(created, [['m1', size]]);
  assert.deepEqual(observed, [[figure.children[0], 'm1', true]]);
});

test('an image already shown is kept across list rebuilds instead of loading again', () => {
  const kept = new HTMLImageElement('img');
  const { content, observed, created } = render({ id: 'm2', kind: 'file', sticker: { width: 10, height: 10, animated: false } }, kept);
  assert.equal(content.children[0]!.children[0], kept);
  assert.equal(created.length, 0);
  assert.deepEqual(observed, [[kept, 'm2', false]]);
});

test('replies, copies and the inbox name a sticker instead of its file name', () => {
  const context = vm.createContext({ t: (text: string) => `«${text}»` });
  vm.runInContext(`${summary}; globalThis.messageSummary = messageSummary;`, context);
  const messageSummary = context.messageSummary as (message: Record<string, unknown>) => string;
  assert.equal(messageSummary({ kind: 'file', name: 'sticker.webp', sticker: { width: 1, height: 1, animated: false } }), '«Stiker»');
  assert.equal(messageSummary({ kind: 'file', name: 'laporan.pdf' }), 'laporan.pdf');
  assert.equal(messageSummary({ kind: 'text', text: 'Halo' }), 'Halo');
});
