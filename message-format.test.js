import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInline, parseMessage, continueList } from './public/message-format.js';

test('Enter continues numbered/bullet lists, exits empty items and preserves selection boundaries', () => {
  assert.deepEqual(continueList('9. item',7),{start:7,end:7,text:'\n10. '});
  assert.deepEqual(continueList('  - item',8),{start:8,end:8,text:'\n  - '});
  assert.deepEqual(continueList('* item',6),{start:6,end:6,text:'\n* '});
  assert.deepEqual(continueList('1. item\n2. ',11),{start:8,end:11,text:''});
  assert.deepEqual(continueList('1. abcd',5,7),{start:5,end:7,text:'\n2. '});
  assert.equal(continueList('ordinary text',13),null);
  assert.equal(continueList('1. item\n2. more',5,12),null);
  assert.deepEqual(continueList('1. item',0),{start:0,end:0,text:'\n'});
  assert.deepEqual(continueList('9999999999999999. item',22),{start:22,end:22,text:'\n10000000000000000. '});
});

test('format pesan menjaga blok, isi, dan posisi mention tanpa menafsirkan HTML', () => {
  const text = 'Halo **@Budi**\n- pertama\n- kedua\n> kutipan\n<script>alert(1)</script>';
  const blocks = parseMessage(text);
  assert.deepEqual(blocks.map(block => block.type), ['text', 'ul', 'quote', 'text']);
  assert.equal(blocks[1].lines[0].text, 'pertama');
  assert.equal(blocks[1].lines[1].text, 'kedua');
  assert.deepEqual(parseInline(blocks[0].lines[0].text), [
    { type: 'text', text: 'Halo ', start: 0 },
    { type: 'strong', text: '@Budi', start: 7 },
  ]);
  assert.deepEqual(parseInline(blocks[3].lines[0].text, blocks[3].lines[0].start), [
    { type: 'text', text: '<script>alert(1)</script>', start: text.indexOf('<script>') },
  ]);
  assert.deepEqual(parseInline('*miring* ~~coret~~ `kode`').map(part => part.type), ['em', 'text', 's', 'text', 'code']);
});
