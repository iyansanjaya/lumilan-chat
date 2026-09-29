import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInline, parseMessage } from './public/message-format.js';

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
