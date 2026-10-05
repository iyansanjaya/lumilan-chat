import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parseMessage, parseInline } from './public/message-format.js';

const source = readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');
function section(startText, endText, includeEnd = false) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start + startText.length);
  assert(start >= 0 && end > start, `Missing renderer source boundary: ${startText}`);
  return source.slice(start, end + (includeEnd ? endText.length : 0));
}
const appendMentionText = section('function appendMentionText(', '\nfunction renderMessages(');
const renderBubble = section("      const bubble = document.createElement('div');", '      content.append(bubble);', true);

class Element {
  constructor(tag, text = '') {
    this.tag = tag;
    this.children = [];
    this.textContent = text;
    this.classList = { add() {} };
  }
  get childNodes() { return this.children; }
  append(...children) { this.children.push(...children); }
}
const descendants = node => [node, ...node.children.flatMap(descendants)];
// A <br> contributes one displayed newline; an empty text node contributes none.
const displayedText = node => node.tag === 'br' ? '\n' : node.textContent + node.children.map(displayedText).join('');
function render(text, mentions = []) {
  const content = new Element('content');
  const context = vm.createContext({
    document: { createElement: tag => new Element(tag), createTextNode: text => new Element('#text', text) },
    parseMessage, parseInline, message: { text, mentions }, content,
  });
  vm.runInContext(`${appendMentionText}\n${renderBubble}`, context);
  assert.equal(content.children.length, 1);
  return content.children[0];
}

test('message bubbles preserve single newlines and consecutive empty lines', () => {
  for (const text of ['test\nsatu\ndua', 'test\n\nsatu\n\ndua', '\n\nfirst\n\n', 'first\n**second**\nthird']) {
    const bubble = render(text);
    assert.equal(bubble.children[0].tag, 'p');
    assert.equal(displayedText(bubble), text.replaceAll('**', ''));
    assert.equal(descendants(bubble).filter(node => node.tag === 'br').length, text.split('\n').length - 1);
  }
});

test('quote bubbles preserve leading, middle, and trailing empty quote lines', () => {
  for (const [text, expected] of [['> first\n> second', 'first\nsecond'], ['> \n> first\n> \n> second\n>', '\nfirst\n\nsecond\n'], ['>\n>\n>', '\n\n']]) {
    const bubble = render(text);
    assert.equal(bubble.children[0].tag, 'blockquote');
    assert.equal(displayedText(bubble), expected);
    assert.equal(descendants(bubble).filter(node => node.tag === 'br').length, expected.split('\n').length - 1);
  }
});

test('line breaks keep list items separate and preserve safe inline formatting and mention offsets', () => {
  const text = 'first\n**@Budi** <script>alert(1)</script>\n- one\n- *two*\n1. three\n2. four';
  const start = text.indexOf('@Budi');
  const bubble = render(text, [{ id: 'budi', start, end: start + 5 }, { id: 'invalid', start: -1, end: 999 }]);
  assert.deepEqual(bubble.children.map(node => node.tag), ['p', 'ul', 'ol']);
  assert.equal(displayedText(bubble.children[0]), 'first\n@Budi <script>alert(1)</script>');
  for (const [index, expected] of [[1, ['one', 'two']], [2, ['three', 'four']]]) {
    assert.deepEqual(bubble.children[index].children.map(node => node.tag), ['li', 'li']);
    assert.deepEqual(bubble.children[index].children.map(displayedText), expected);
    assert.equal(descendants(bubble.children[index]).filter(node => node.tag === 'br').length, 0);
  }
  const nodes = descendants(bubble);
  const labels = nodes.filter(node => node.className === 'message-mention');
  assert.equal(labels.length, 1);
  assert.equal(displayedText(labels[0]), '@Budi');
  assert.equal(nodes.find(node => node.tag === 'strong').children.includes(labels[0]), true);
  assert.equal(nodes.some(node => node.tag === 'script'), false);
  assert.equal(nodes.filter(node => node.tag === 'br').length, 1);
});
