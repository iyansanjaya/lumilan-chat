import test from 'node:test';
import assert from 'node:assert/strict';
import { languageForRegion, languageSettings, translate } from './public/i18n.js';

test('bahasa otomatis mengikuti wilayah, sedangkan pilihan manual tetap berlaku', () => {
  for (const [region, language] of [['ID', 'id'], ['MY', 'ms'], ['ES', 'es'], ['JP', 'ja'], ['KR', 'ko'], ['CN', 'zh-Hans'], ['SG', 'zh-Hans'], ['TW', 'zh-Hant'], ['HK', 'zh-Hant'], ['MO', 'zh-Hant'], ['US', 'en'], ['MX', 'en'], ['', 'en'], ['id', 'id']]) {
    assert.equal(languageForRegion(region), language);
    assert.deepEqual(languageSettings({ languageMode: 'auto', language: 'en' }, region), { languageMode: 'auto', language });
  }
  assert.deepEqual(languageSettings({}, 'MY'), { languageMode: 'auto', language: 'ms' });
  assert.deepEqual(languageSettings({ language: 'en' }, 'MY'), { languageMode: 'manual', language: 'en' });
  assert.deepEqual(languageSettings({ languageMode: 'manual', language: 'es' }, 'ID'), { languageMode: 'manual', language: 'es' });
  assert.deepEqual(languageSettings({ languageMode: 'manual', language: 'zh-Hant' }, 'CN'), { languageMode: 'manual', language: 'zh-Hant' });
  assert.deepEqual(languageSettings({ language: 'toString' }, 'ID'), { languageMode: 'auto', language: 'id' });
  assert.equal(translate('id', 'Catatan pribadi'), 'Catatan pribadi');
  assert.equal(translate('id', '{count} pesan dipilih', { count: 2 }), '2 pesan dipilih');
  for (const language of ['ja', 'ko', 'zh-Hans', 'zh-Hant']) {
    assert.notEqual(translate(language, 'Buat Ruang'), 'Create Room');
    assert.ok(translate(language, '{name} sedang mengetik', { name: 'Aki' }).includes('Aki'));
    assert.notEqual(translate(language, 'Pilih emoji'), 'Choose emoji');
    assert.ok(translate(language, 'Ruang: {name}', { name: 'Tim' }).includes('Tim'));
  }
  for (const language of ['en', 'ms', 'es', 'ja', 'ko', 'zh-Hans', 'zh-Hant']) {
    assert.match(translate(language,'{due} jatuh tempo · {requests} permintaan',{due:2,requests:3}),/2.*3/);
    assert(!translate(language,'Waktu lokal perangkat: {zone}',{zone:'Asia/Jakarta'}).includes('{zone}'));
    if(language!=='en') assert.notEqual(translate(language,'Judul pengingat'),'Reminder title');
    assert.notEqual(translate(language,'Hanya kontak yang mendukung Pengingat ditampilkan, termasuk saat offline.'),'Hanya kontak yang mendukung Pengingat ditampilkan, termasuk saat offline.');
    assert.match(translate(language, 'File maks. 2 GB'), /2 GB/);
    assert.match(translate(language, 'File harus berukuran 1 B–2 GB.'), /2 GB/);
    assert.match(translate(language, 'Perbarui Lumilan Chat pada perangkat penerima untuk mengirim file di atas 100 MB.'), /100 MB/);
  }
});
