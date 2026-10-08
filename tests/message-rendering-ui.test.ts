import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parseMessage, parseInline } from '../src/renderer/message-format.js';
import type { Mention } from '../src/shared/model.js';

const source = readFileSync(new URL('../src/renderer/app.js', import.meta.url), 'utf8');
function section(startText: string, endText: string, includeEnd = false) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start + startText.length);
  assert(start >= 0 && end > start, `Missing renderer source boundary: ${startText}`);
  return source.slice(start, end + (includeEnd ? endText.length : 0));
}
const appendMentionText = section('function appendMentionText(', '\nfunction renderMessages(');
const renderBubble = section("const bubble = document.createElement('div');", 'content.append(bubble);', true);

class Element {
  tag: string;
  children: Element[];
  textContent: string;
  className = '';
  classList: { add(): void };
  constructor(tag: string, text = '') {
    this.tag = tag;
    this.children = [];
    this.textContent = text;
    this.classList = { add() {} };
  }
  get childNodes() { return this.children; }
  append(...children: Element[]) { this.children.push(...children); }
}
const descendants = (node: Element): Element[] => [node, ...node.children.flatMap(descendants)];
// A <br> contributes one displayed newline; an empty text node contributes none.
const displayedText = (node: Element): string => node.tag === 'br' ? '\n' : node.textContent + node.children.map(displayedText).join('');
function child(node: Element, index: number): Element {
  const value = node.children[index]; assert(value); return value;
}
function render(text: string, mentions: Mention[] = []) {
  const content = new Element('content');
  const context = vm.createContext({
    document: { createElement: (tag: string) => new Element(tag), createTextNode: (text: string) => new Element('#text', text) },
    parseMessage, parseInline, message: { text, mentions }, content,
  });
  vm.runInContext(`${appendMentionText}\n${renderBubble}`, context);
  assert.equal(content.children.length, 1);
  return child(content, 0);
}

test('message bubbles preserve single newlines and consecutive empty lines', () => {
  for (const text of ['test\nsatu\ndua', 'test\n\nsatu\n\ndua', '\n\nfirst\n\n', 'first\n**second**\nthird']) {
    const bubble = render(text);
    assert.equal(child(bubble, 0).tag, 'p');
    assert.equal(displayedText(bubble), text.replaceAll('**', ''));
    assert.equal(descendants(bubble).filter(node => node.tag === 'br').length, text.split('\n').length - 1);
  }
});

test('quote bubbles preserve leading, middle, and trailing empty quote lines', () => {
  for (const [text, expected] of [['> first\n> second', 'first\nsecond'], ['> \n> first\n> \n> second\n>', '\nfirst\n\nsecond\n'], ['>\n>\n>', '\n\n']] as const) {
    const bubble = render(text);
    assert.equal(child(bubble, 0).tag, 'blockquote');
    assert.equal(displayedText(bubble), expected);
    assert.equal(descendants(bubble).filter(node => node.tag === 'br').length, expected.split('\n').length - 1);
  }
});

test('line breaks keep list items separate and preserve safe inline formatting and mention offsets', () => {
  const text = 'first\n**@Budi** <script>alert(1)</script>\n- one\n- *two*\n1. three\n2. four';
  const start = text.indexOf('@Budi');
  const bubble = render(text, [{ id: 'budi', start, end: start + 5 }, { id: 'invalid', start: -1, end: 999 }]);
  assert.deepEqual(bubble.children.map(node => node.tag), ['p', 'ul', 'ol']);
  assert.equal(displayedText(child(bubble, 0)), 'first\n@Budi <script>alert(1)</script>');
  for (const [index, expected] of [[1, ['one', 'two']], [2, ['three', 'four']]] as const) {
    assert.deepEqual(child(bubble, index).children.map(node => node.tag), ['li', 'li']);
    assert.deepEqual(child(bubble, index).children.map(displayedText), expected);
    assert.equal(descendants(child(bubble, index)).filter(node => node.tag === 'br').length, 0);
  }
  const nodes = descendants(bubble);
  const labels = nodes.filter(node => node.className === 'message-mention');
  assert.equal(labels.length, 1);
  const label = labels[0], strong = nodes.find(node => node.tag === 'strong');
  assert(label && strong);
  assert.equal(displayedText(label), '@Budi');
  assert.equal(strong.children.includes(label), true);
  assert.equal(nodes.some(node => node.tag === 'script'), false);
  assert.equal(nodes.filter(node => node.tag === 'br').length, 1);
});
