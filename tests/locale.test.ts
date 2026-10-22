import test from 'node:test';
import assert from 'node:assert/strict';
import { languageForRegion, languageSettings, translate } from '../src/renderer/i18n.js';

test('bahasa otomatis mengikuti wilayah, sedangkan pilihan manual tetap berlaku', () => {
  for (const [region, language] of [['ID', 'id'], ['MY', 'ms'], ['ES', 'es'], ['JP', 'ja'], ['KR', 'ko'], ['CN', 'zh-Hans'], ['SG', 'zh-Hans'], ['TW', 'zh-Hant'], ['HK', 'zh-Hant'], ['MO', 'zh-Hant'], ['US', 'en'], ['MX', 'en'], ['', 'en'], ['id', 'id']] as const) {
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
    assert.notEqual(translate(language,'Hanya kontak aktif yang mendukung Pengingat ditampilkan.'),'Hanya kontak aktif yang mendukung Pengingat ditampilkan.');
    for(const key of ['Pilih kontak aktif','Kirim beberapa file','Hingga 8 file sekaligus','Daftar: Enter melanjutkan · Enter pada item kosong mengakhiri','Gambar siap dikirim. Tekan Kirim.','Hapus gambar','Gambar clipboard harus berukuran 1 B–20 MB.']) assert.notEqual(translate(language,key),key);
    for (const key of ['Pratinjau tautan', 'Aktifkan', 'Jangan', 'Buka di browser', 'Hapus pratinjau tautan', 'Ambil judul dan gambar', 'Tanya dulu', 'Nonaktif', 'Tautan tidak dapat dibuka.',
      'Saat aktif, perangkat Anda mengambil judul dan gambar dari YouTube atau Instagram ketika Anda menempelkan tautannya. Penerima tidak terhubung ke internet.'])
      assert.notEqual(translate(language, key), key, `${language}: ${key}`);
    const consent = translate(language, 'Ambil judul dan gambar dari {host} untuk membuat pratinjau?', { host: 'youtube.com' });
    assert(consent.includes('youtube.com') && !consent.includes('{host}'), `${language}: ${consent}`);
    // Work breaks: Lumi, the overlay and Settings. Malay shares some words with Indonesian, so only keys that differ in every language.
    for (const key of ['Waktunya rehat', 'Rehat selesai', 'Mulai rehat', 'Lanjut kerja', 'Lewati', 'Saatnya rehat sejenak', 'Pengingat rehat', 'Pengaturan rehat tidak valid.',
      'Waktunya rehat. Dimulai otomatis dalam satu menit.', 'Berdiri, regangkan badan, dan lihat jauh dari layar.'])
      assert.notEqual(translate(language, key), key, `${language}: ${key}`);
    assert.match(translate(language, 'Istirahat {minutes} menit', { minutes: 10 }), /10/);
    assert.match(translate(language, 'Rehat berikutnya pukul {time}', { time: '10:30' }), /10:30/);
    assert.match(translate(language, 'File maks. 2 GB'), /2 GB/);
    assert.match(translate(language, 'File harus berukuran 1 B–2 GB.'), /2 GB/);
    assert.match(translate(language, 'Perbarui Lumilan Chat pada perangkat penerima untuk mengirim file di atas 100 MB.'), /100 MB/);
  }
});
