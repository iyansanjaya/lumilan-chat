import test from 'node:test';
import assert from 'node:assert/strict';
import { languageForRegion, languageSettings } from './public/i18n.js';

test('bahasa otomatis mengikuti wilayah, sedangkan pilihan manual tetap berlaku', () => {
  for (const [region, language] of [['ID', 'id'], ['MY', 'ms'], ['ES', 'es'], ['US', 'en'], ['MX', 'en'], ['', 'en'], ['id', 'id']]) {
    assert.equal(languageForRegion(region), language);
    assert.deepEqual(languageSettings({ languageMode: 'auto', language: 'en' }, region), { languageMode: 'auto', language });
  }
  assert.deepEqual(languageSettings({}, 'MY'), { languageMode: 'auto', language: 'ms' });
  assert.deepEqual(languageSettings({ language: 'en' }, 'MY'), { languageMode: 'manual', language: 'en' });
  assert.deepEqual(languageSettings({ languageMode: 'manual', language: 'es' }, 'ID'), { languageMode: 'manual', language: 'es' });
  assert.deepEqual(languageSettings({ language: 'toString' }, 'ID'), { languageMode: 'auto', language: 'id' });
});
