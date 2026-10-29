---
name: Lumilan Chat
description: "Meja kerja yang rapi: bingkai batu, lembar putih, pulau hitam, dan emas Lumi hanya untuk yang meminta tangan Anda."
colors:
  frame: "#f3f3f1"
  surface: "#fff"
  raised: "#f2f3f4"
  ink: "#16171a"
  muted: "#5d6066"
  divider: "#d5d7da"
  line: "#e3e4e6"
  rule: "#edeef0"
  control: "#c9ccd0"
  hover: "#ebecec"
  selected: "#e6e7e6"
  outgoing: "#1d1e20"
  outgoing-ink: "#fff"
  own-muted: "#c3c5ca"
  own-hover: "#2e3034"
  own-line: "#43464b"
  accent: "#f1c65c"
  accent-hover: "#e7b94c"
  accent-ink: "#1d1e20"
  accent-strong: "#d9a12a"
  accent-soft: "#fcf1d4"
  accent-line: "#a87a14"
  accent-text: "#7a560b"
  highlight: "#f6de9a"
  focus: "#3d6577"
  selection-stroke: "#7b7e84"
  status-active: "#26855c"
  status-busy: "#a36b20"
  status-away: "#6b7785"
  status-dnd: "#ad4851"
  danger: "#a73131"
  danger-hover: "#8d2626"
  danger-text: "#a73131"
  call-accept: "#1f7a52"
  island: "#000"
  island-raised: "#1c1c1e"
  island-hover: "#2c2c2e"
  island-line: "#3a3a3c"
  island-text: "#f1f5f7"
  island-secondary: "#b4b4b4"
  island-meta: "#949494"
  island-focus: "#9fb6c5"
  island-accept: "#117a59"
  island-danger: "#982e3d"
  island-error: "#ffbfc6"
  lumi-gold: "#ffd36d"
  lumi-gold-hover: "#ffe199"
  lumi-gold-ink: "#20272c"
  break-scrim: "rgba(10, 12, 16, 0.8)"
typography:
  display:
    fontFamily: "Public Sans, Arial, sans-serif"
    fontSize: "24px"
    fontWeight: 500
    lineHeight: 1.15
    fontFeature: "tnum"
  headline:
    fontFamily: "Public Sans, Arial, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Public Sans, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Public Sans, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Public Sans, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.25
  caption:
    fontFamily: "Public Sans, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.45
  meta:
    fontFamily: "Public Sans, Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.4
    fontFeature: "tnum"
rounded:
  none: "0"
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "12px"
  composer: "14px"
  sheet: "16px"
  pill: "999px"
spacing:
  "2xs": "4px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  xl: "24px"
  "2xl": "28px"
  "3xl": "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "8px 14px"
    height: "38px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.accent-ink}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "8px 14px"
    height: "38px"
  button-secondary-hover:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.ink}"
  button-danger-outline:
    backgroundColor: "transparent"
    textColor: "{colors.danger-text}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "8px 14px"
    height: "38px"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "#fff"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "8px 14px"
    height: "38px"
  button-icon:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.md}"
    size: "36px"
  button-icon-hover:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.ink}"
  button-quiet-row:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "38px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "40px"
  select:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 44px 0 12px"
    height: "40px"
  search:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 10px 0 12px"
    height: "34px"
  composer:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.composer}"
    padding: "6px"
  tab-filter:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0 10px"
    height: "38px"
  tab-filter-active:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
  settings-tab:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "40px"
  settings-tab-active:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.ink}"
  row-list:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "8px 10px"
    height: "56px"
  row-list-hover:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.ink}"
  row-list-active:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.ink}"
  bubble-incoming:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "4px 16px 16px 16px"
    padding: "10px 14px"
  bubble-own:
    backgroundColor: "{colors.outgoing}"
    textColor: "{colors.outgoing-ink}"
    typography: "{typography.body}"
    rounded: "16px 4px 16px 16px"
    padding: "10px 14px"
  badge-unread:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.pill}"
    padding: "0 6px"
    height: "20px"
  chip-member:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "5px 10px"
  date-divider:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.muted}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: "3px 10px"
  sheet:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet}"
  dialog:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet}"
    padding: "28px"
  menu:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "5px"
  sticker-picker:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "8px"
    width: "360px"
  toast:
    backgroundColor: "{colors.outgoing}"
    textColor: "{colors.outgoing-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "10px 16px"
  switch:
    backgroundColor: "{colors.control}"
    rounded: "{rounded.pill}"
    width: "34px"
    height: "20px"
  switch-on:
    backgroundColor: "{colors.accent}"
    rounded: "{rounded.pill}"
    width: "34px"
    height: "20px"
  checkbox:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    size: "20px"
  checkbox-checked:
    backgroundColor: "{colors.accent}"
    rounded: "{rounded.sm}"
    size: "20px"
  avatar:
    rounded: "{rounded.pill}"
    size: "38px"
  island-pill:
    backgroundColor: "{colors.island}"
    textColor: "{colors.lumi-gold}"
    typography: "{typography.caption}"
    rounded: "0 0 10px 10px"
    padding: "0 10px"
    width: "120px"
    height: "30px"
  island-button:
    backgroundColor: "{colors.island-raised}"
    textColor: "{colors.island-text}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "7px 14px"
    height: "34px"
  island-button-hover:
    backgroundColor: "{colors.island-hover}"
    textColor: "{colors.island-text}"
  island-button-primary:
    backgroundColor: "{colors.lumi-gold}"
    textColor: "{colors.lumi-gold-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "7px 14px"
    height: "34px"
  island-tab:
    backgroundColor: "transparent"
    textColor: "{colors.island-meta}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: "0 9px"
    height: "30px"
  island-tab-active:
    backgroundColor: "{colors.island-hover}"
    textColor: "{colors.island-text}"
  island-card:
    backgroundColor: "{colors.island-raised}"
    textColor: "{colors.island-text}"
    rounded: "{rounded.sheet}"
    padding: "10px"
  break-button:
    backgroundColor: "{colors.lumi-gold}"
    textColor: "{colors.lumi-gold-ink}"
    rounded: "{rounded.pill}"
    padding: "10px 28px"
    height: "44px"
---

<!-- Judul bagian tetap dalam bahasa Inggris karena alat pembaca DESIGN.md mengandalkan nama bagian yang persis.
     Nilai token diambil langsung dari src/renderer/app.css, notch.css, dan break.css (tema terang sebagai nilai utama;
     pasangan tema gelapnya dicatat di prosa dan di .impeccable/design.json). Bahasa "rasa" (metafora, nama warna,
     aturan bernama) diturunkan dari komentar kode dan README, dengan satu pilihan pengguna pada 2026-10-23:
     suasana "meja kerja yang rapi". Disegarkan 2026-10-29 untuk Pengaturan per kategori, pencarian di sidebar,
     dan stiker. -->

# Design System: Lumilan Chat

## Overview

**Creative North Star: "Meja Kerja yang Rapi"**

Lumilan tampil seperti meja kerja yang sudah dibereskan sebelum hari dimulai. Satu bingkai batu (`frame`) memegang bilah atas dan daftar percakapan tanpa garis di antaranya; percakapan yang terbuka dan detailnya duduk di satu lembar putih (`surface`) yang menjorok 8 px dari tepi kanan dan bawah jendela, bersudut 16 px, bertepi 1 px. Hampir semua yang ada di meja itu putih, abu-abu, dan tinta. Kedalaman adalah satu tingkat warna, bukan bayangan. Tidak ada yang berkilau, tembus pandang, atau melayang saat diam.

Mereknya adalah hitam dan emas Lumi. Pesan Anda sendiri adalah pulau hitam kecil di atas lembar, serupa notch Lumi di puncak layar (di tema gelap pulau itu berubah emas). Emas tidak dipakai sebagai suasana; ia dipakai sebagai sinyal. Emas hanya menandai yang meminta tangan Anda: tombol Kirim, satu tombol utama per tampilan, angka pesan belum dibaca, garis tab yang aktif, isi batang progres, dan sakelar yang menyala. Karena jarang, emas terlihat.

Lumi adalah satu-satunya wajah di produk ini. Ia hidup di luar jendela, di dalam pulau hitam pekat yang menempel ke tepi atas layar seperti notch perangkat keras: kontrolnya pil penuh, teksnya dua tingkat abu, dan satu tombol emas per halaman. Tubuh emas bergradasi Lumi adalah satu-satunya gradien yang ada di seluruh sistem. Layar rehat mengikuti dunia Lumi: tirai gelap, satu angka besar, satu tombol emas.

**Key Characteristics:**
- Bingkai batu dan lembar putih: dua tingkat warna, satu tepi 1 px, sudut 16 px; tidak ada bayangan saat diam.
- Hitam untuk kata-kata sendiri (dan Lumi), emas untuk yang meminta tangan; segala sesuatu yang lain abu-abu.
- Satu huruf, Public Sans, dari 11 px meta hingga 26 px judul sambutan; angka yang berubah selalu tabular.
- Kontrol 38 px bersudut 8 px, baris daftar 56 px bersudut 10 px, pil 999 px untuk badge, chip, dan segala sesuatu di dalam Lumi.
- Warna identitas (lima tint avatar) dipisahkan tegas dari warna status (empat titik presensi).
- Gerak singkat dan fungsional: 140 ms untuk warna, 160–220 ms untuk muncul, pegas 380 ms hanya untuk morf pulau Lumi; semuanya berhenti pada reduced motion dan saat halaman tersembunyi.

## Colors

Palet ini adalah abu-abu hangat yang tenang dengan satu tinta, satu emas, dan satu hitam pekat; warna lain hanya menyatakan status atau tindakan yang tidak boleh salah tekan.

### Primary
- **Emas Lumi** (`accent`, #f1c65c; gelap #f0c668): Kirim, tombol utama berlatar emas (Simpan, Buat Ruang, tombol kirim pengingat), badge belum dibaca, sakelar aktif, avatar Anda di bilah atas. Ini adalah emas tubuh Lumi dan logo (#ffd36d) yang diredupkan sedikit agar tetap terbaca di atas lembar putih.
- **Emas Ditekan** (`accent-hover`, #e7b94c; gelap sama): keadaan hover dan active untuk semua yang berlatar Emas Lumi.
- **Emas Pekat** (`accent-strong`, #d9a12a; gelap #e2b244): garis bawah 2 px pada tab aktif dan isi batang progres; dipakai sebagai garis, bukan area.
- **Emas Pucat** (`accent-soft`, #fcf1d4; gelap #2e2615): latar baris percakapan yang sedang dibuka, opsi select yang terpilih, sebutan @nama, segmen tanggal yang difokus, serta avatar Ruang dan Catatan.
- **Emas Garis** (`accent-line`, #a87a14; gelap #c99d3a): tepi 1 px baris terpilih, agar keadaan terpilih terbaca sebagai keadaan dan bukan sekadar warna.
- **Emas Teks** (`accent-text`, #7a560b; gelap #f0cd85): teks di atas Emas Pucat, tanda centang pada opsi terpilih.
- **Sorot Emas** (`highlight`, #f6de9a; gelap #6b5520): warna seleksi teks (`::selection`) di seluruh jendela.
- **Emas Lumi Murni** (`lumi-gold`, #ffd36d, selalu sama): tubuh Lumi, mata di pill, badge pill, tombol utama di dalam pulau, isi progres dan kotak centang Lumi, tombol Lanjut kerja di layar rehat, latar ikon aplikasi. Teksnya `lumi-gold-ink` (#20272c); hovernya `lumi-gold-hover` (#ffe199).

### Secondary
- **Pulau Hitam** (`outgoing`, #1d1e20; gelap menjadi emas #f1c65c): gelembung pesan Anda sendiri, avatar Anda di tengah peta jaringan, dan toast. Teksnya `outgoing-ink` (#fff; gelap #1d1e20). Di dalam gelembung sendiri, token `muted`, `hover`, `raised`, `line`, dan `focus` diganti oleh `own-muted` (#c3c5ca), `own-hover` (#2e3034), `own-line` (#43464b), dan `own-focus` (= Emas Lumi) agar kutipan, ikon file, dan fokus tetap terbaca di atas hitam.
- **Hitam Lumi** (`island`, #000, selalu sama): pulau Lumi dan bahu cekungnya. Di atasnya ada tiga tingkat: **Arang** (`island-raised`, #1c1c1e) untuk tombol, kartu Rak, menu, dan kolom tugas; **Arang Terang** (`island-hover`, #2c2c2e) untuk hover, tab aktif, dan batang kosong grafik; **Garis Arang** (`island-line`, #3a3a3c) untuk tepi kontrol. Teks tiga tingkat: **Putih Kapur** (`island-text`, #f1f5f7), **Abu Kedua** (`island-secondary`, #b4b4b4) untuk teks pendukung, **Abu Meta** (`island-meta`, #949494) untuk label dan meta.

### Tertiary
- **Biru Teduh** (`focus`, #3d6577; gelap #9fb6c5): cincin fokus keyboard 2 px di seluruh jendela, tepi kotak pencarian dan komposer saat fokus, garis kiri 3 px pada kutipan balasan dan blockquote, tepi pesan yang menyebut Anda, tombol pilih yang aktif, dan garis putus-putus zona lepas file. Di Lumi dan layar rehat, cincin fokusnya `island-focus` (#9fb6c5).
- **Hijau Hadir** (`status-active`, #26855c; gelap #5cb889), **Kuning Sibuk** (`status-busy`, #a36b20; gelap #d7a557), **Abu Pergi** (`status-away`, #6b7785; gelap #9da9b7), **Merah Jangan Ganggu** (`status-dnd`, #ad4851; gelap #d97b87): titik presensi 7 px, outline 2 px di sekeliling avatar kontak, dan tepi 2 px avatar Anda sendiri. Status jaringan memakai Hijau Hadir saat ada perangkat lain dan Abu Pergi saat masih mencari.
- **Merah Bata** (`danger`, #a73131; gelap #b13c3c; hover `danger-hover` #8d2626 / #982f2f): tombol konfirmasi tindakan yang menghapus dan tombol Tutup panggilan. **Merah Teks** (`danger-text`, #a73131; gelap #ffaaa9): tombol garis tepi Hapus, item menu hapus, tautan Keluar, dan pesan galat. Di Lumi: `island-danger` (#982e3d, tepi #c45263) dan galat `island-error` (#ffbfc6).
- **Hijau Angkat** (`call-accept`, #1f7a52; hover #196644): hanya tombol Jawab panggilan dan simbol panggilan (#1d7f57). Di Lumi: `island-accept` (#117a59, tepi #289775).

### Neutral
- **Batu Bingkai** (`frame`, #f3f3f1; gelap #0c0d0e): latar jendela, bilah atas, dan sidebar; juga halaman sambutan pertama.
- **Lembar Putih** (`surface`, #fff; gelap #161719): lembar percakapan dan detail, dialog, menu, kartu, kotak pencarian, kontrol, dan tombol sekunder.
- **Lembar Naik** (`raised`, #f2f3f4; gelap #222326): satu tingkat di atas lembar: gelembung masuk, tab tanggal, kutipan, chip anggota, kaki kartu sambutan, catatan masalah panggilan, ikon file, dan latar formulir pengingat.
- **Tinta** (`ink`, #16171a; gelap #f1f2f3): teks utama, ikon aktif, judul.
- **Tinta Redup** (`muted`, #5d6066; gelap #b3b6ba): teks pendukung, waktu, label tab tidak aktif, ikon diam, placeholder.
- **Garis Tepi** (`line`, #e3e4e6; gelap #2a2c2f): tepi lembar, kartu, menu, kotak pencarian, kisi ringkasan, reaksi; garis bawah bilah filter.
- **Garis Halus** (`rule`, #edeef0; gelap #222427): pemisah di dalam lembar: bawah header percakapan, antar bagian detail dan pengaturan, antar baris tugas, dan batas kiri panel detail.
- **Pembagi** (`divider`, #d5d7da; gelap #3a3c40): ibu jari scrollbar, garis peta jaringan, dan cincin putus-putus saat belum ada perangkat.
- **Tepi Kontrol** (`control`, #c9ccd0; gelap #46494e): tepi 1 px tombol sekunder, input, select, komposer, kotak centang, dan rel sakelar yang mati; juga garis putus-putus zona Rak.
- **Sentuh** (`hover`, #ebecec; gelap #1f2023): latar hover untuk baris, item menu, tombol ikon, dan tombol sekunder; latar kode sebaris.
- **Terpilih** (`selected`, #e6e7e6; gelap #26282b): latar reaksi yang Anda beri. **Goresan Seleksi** (`selection-stroke`, #7b7e84; gelap #8d9095): rel sakelar saat baris pengaturannya di-hover.
- **Tint identitas avatar** (terang → gelap): teal #d5ece8/#1d5a53 → #183330/#93d4ca; kuning #f8e6c3/#6b4807 → #36290f/#f0cd85; hijau #dcecd6/#2f5d2a → #1d3019/#a8d69d; merah muda #f6dde3/#85344a → #3a1d25/#f0a9bb; biru #dae6f6/#2c5687 → #1b2a3e/#a7c5ee. Lima rona berjarak sekitar 72° dipilih dari nama; avatar orang di header dan detail memakai pasangan biru. Tint adalah identitas, bukan status.
- **Tirai Rehat** (`break-scrim`, rgba(10, 12, 16, 0.8)): latar layar rehat di atas jendela transparan; di X11 tanpa compositor dan Wayland terbaca nyaris hitam dan tetap berfungsi.

### Named Rules
**Aturan Emas Hemat.** Emas Lumi hanya untuk yang meminta tangan: Kirim, satu tombol utama per tampilan, badge belum dibaca, garis tab aktif, isi progres, dan sakelar aktif. Emas tidak pernah menjadi latar area besar, warna teks panjang, warna status, atau hiasan.

**Aturan Satu Pulau.** Hitam pekat (`outgoing`) hanya untuk pesan Anda sendiri, avatar Anda di peta jaringan, dan toast; Lumi adalah pulau hitam di luar jendela. Blok hitam lain tidak ditambahkan. Di tema gelap, pulau pesan sendiri berubah emas dan toast berubah terang (#f1f2f3) agar tetap menjadi satu-satunya hal yang menonjol.

**Aturan Identitas Bukan Status.** Lima tint avatar menyatakan siapa; empat warna presensi menyatakan sedang apa. Keduanya tidak pernah saling menggantikan: status selalu tampil sebagai titik 7 px atau outline 2 px, bukan sebagai warna avatar.

## Typography

**Display Font:** Public Sans (variabel, 100–900; cadangan Arial, sans-serif)
**Body Font:** Public Sans
**Label/Mono Font:** Public Sans untuk label; `monospace` sistem hanya untuk kode sebaris; "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji" hanya di pemilih emoji.

**Character:** Satu huruf sans yang lurus dan tenang, dibedakan oleh bobot (400 teks, 500 angka dan baris tenang, 600 label, 700 judul) dan spasi huruf yang sedikit merapat pada judul. Tidak ada huruf display; bahkan jam 160 px di layar rehat memakai huruf yang sama dengan bobot 600.

### Hierarchy
- **Display** (500, 24px, 1.15, tabular-nums): angka ringkasan di panel detail (Orang aktif, Total pesan). Di Lumi angka halaman memakai 24px/600/1.2 dan jam fokus/rehat 30px. Di layar rehat jam memakai clamp(72px, 14vw, 160px), bobot 600, line-height 1, spasi -0.02em.
- **Headline** (700, 20px, 1.2, -0.02em): judul sidebar "Pesan" dan judul dialog. Judul kartu sambutan pertama lebih besar: 26px, -0.03em.
- **Title** (700, 16px, -0.01em): nama percakapan di header, judul bagian pengaturan, nama di panel detail, nama merek di bilah atas (dengan "Chat" dalam Tinta Redup bobot 500). Judul bagian detail memakai 14px/700.
- **Body** (400, 14px, 1.5): gelembung pesan (pre-wrap, overflow-wrap anywhere), teks komposer (1.45), input dan select, nama di baris daftar (600), opsi menu.
- **Label** (600, 13px, 1.25): semua tombol 38 px, label formulir, tab filter, nama pengirim di meta pesan (700, 12px). Tab yang kehabisan ruang mengecil ke 12px dengan padding 3px.
- **Caption** (400, 12px, 1.45): teks pendukung, baris kedua daftar, catatan pengaturan, tab tanggal (500), tooltip presensi, kaki panel detail. Keterangan grup daftar memakai 600 dan huruf kapital di awal saja.
- **Meta** (400, 11px, tabular-nums): waktu pesan, ukuran file, petunjuk komposer, badge belum dibaca (700), badge bilah atas (10px, 800), kbd pintasan.
- **Lumi**: dasar 13px/1.4 di atas pulau; pill 12px/700; tab dan tombol kecil 12px; chip aktivitas dan meta 11px; label halaman 12px/400 Abu Meta.

### Named Rules
**Aturan Satu Huruf.** Hanya Public Sans di seluruh jendela, Lumi, dan layar rehat; huruf lain hanya untuk emoji dan kode. Hierarki dibangun dari bobot dan ukuran, bukan dari pasangan huruf.

**Aturan Angka Rata.** Setiap angka yang berubah (jam, hitungan, ukuran file, waktu pesan, statistik) memakai `font-variant-numeric: tabular-nums` agar tidak bergeser saat nilainya berganti.

**Aturan Satu Baris.** Nama, judul, dan baris kedua daftar dipotong dengan elipsis pada satu baris; teks pesan dan catatan boleh membungkus dengan `overflow-wrap: anywhere`. Teks terjemahan yang panjang tidak boleh melipat label tombol: tombol sidebar menjadi baris tenang dengan ikon, bukan kotak.

## Layout

**Kerangka.** Jendela utama adalah satu kolom: bilah atas 52 px di atas ruang kerja. Bilah atas adalah kisi tiga kolom `sidebar-width (268px) | 1fr | auto`: merek di kiri selebar sidebar, tengah kosong, akun dan empat tombol ikon di kanan. Kotak pencarian menyaring daftar percakapan, jadi ia berada di sidebar tepat di atas tab filter (tinggi 34 px, margin 14 px seperti tab), bukan di bilah atas. Ruang kerja adalah kisi `268px | minmax(340px, 1fr) | 300px`: sidebar di atas bingkai batu, lalu lembar putih yang memuat percakapan dan detail, menjorok 8 px dari kanan dan bawah. Percakapan dan detail berbagi satu lembar; batas di antaranya adalah Garis Halus, bukan celah.

**Kepadatan.** Header percakapan 64 px; baris daftar 56 px (orang 58 px, tujuan sidebar 40 px); kontrol 38 px; input dan select 40 px; tombol ikon 36 px; baris pengaturan minimal 64 px. Pesan berjarak 14 px dengan padding 24 px 28 px; gelembung maksimum `min(78%, 560px)`. Panel detail berpadding 22 px dengan bagian 20 px yang dipisah Garis Halus. Dialog berpadding 28 px, lebar 400–640 px menurut isinya, tinggi maksimum 85–90 dvh. Pengaturan adalah pengecualian: ukurannya tetap `min(100% − 32px, 860px)` × `min(100dvh − 48px, 680px)` agar tidak melompat saat berpindah kategori; judulnya dipisah Garis Halus, kolom kategori 220 px duduk di atas Batu Bingkai, dan isi kategori bergulir sendiri dengan padding 4px 28px 28px serta parit scrollbar yang tetap sehingga margin kiri dan kanan selalu sama.

**Irama jarak.** 2 px antar baris daftar; 4 px antar tombol ikon; 6–8 px antar tombol dalam satu kelompok; 10–12 px antar elemen dalam kartu; 16 px antar field formulir; 20 px antar bagian; 24–32 px padding konten besar. Tidak ada token jarak di kode; skala 4/8/12/16/20/24/28/32 pada frontmatter adalah ringkasan nilai yang terpakai.

**Responsif.** Lima ambang, semuanya `max-width`:
- 1160 px: sidebar 248 px, detail 260 px, pintasan kbd pencarian disembunyikan.
- 980 px: panel detail hilang; lembar percakapan mendapat empat sudut 16 px.
- 700 px (ponsel): bingkai mundur, lembar menjadi layar; satu wilayah tampil sekaligus (`body.show-list` memilih daftar atau percakapan); bilah atas tetap satu baris, nama akun disembunyikan, dan pencarian ikut tampil bersama daftar dengan tinggi 38 px untuk sentuhan; tombol Kembali muncul; pesan 90 %. Pengaturan menjadi hampir selayar (8 px dari tepi) dan kategorinya menjadi deretan tab 36 px yang bergulir ke samping di bawah judul.
- 390 px: "Chat" pada merek hilang, tombol ikon 32 px, pesan 94 %.
- 320 px adalah lebar minimum `body`; dialog pengingat merapat di 480 px.

**Lumi.** Jendela notch tetap 680×280 DIP dan transparan; hanya pulau di dalamnya yang bermorf. Pill idle 120×30 px (136 px saat disentuh atau rehat jatuh tempo; 330–346 px di atas notch kamera Mac); kompak 320×64 px; terbuka melebar ke samping hingga `min(640px, 100% - 20px)` dan tinggi otomatis maksimal 240 px ditambah inset bilah menu macOS. Saat terbuka, pulau menjadi baris: kolom Lumi 100 px di kiri, lalu bilah tab 30 px dan halaman. Setiap halaman adalah kisi `1fr | 168px` (konten, lalu kolom aksi); Rutinitas `150px | 1fr | 120px`; Tugas `156px | 1fr`; Rak satu kolom berisi baki kartu 136 px. Bahu cekung 10 px di kiri-kanan menyambungkan pulau ke tepi layar.

**Layar rehat.** Satu jendela per layar, tirai gelap penuh, kolom tengah maksimum 640 px dengan jarak 12 px: judul 24px/600, petunjuk 15px Abu Kedua, jam raksasa, lalu tombol pil 44 px.

## Elevation & Depth

Sistem ini datar saat diam. Kedalaman dinyatakan oleh tingkat warna, bukan bayangan: bingkai batu di bawah, lembar putih di atasnya, Lembar Naik satu tingkat lagi untuk gelembung masuk dan kutipan, dengan Garis Tepi 1 px di tepi lembar dan Garis Halus di dalamnya. Kartu, kisi ringkasan, kartu tautan, dan kartu pengingat memakai tepi 1 px tanpa bayangan. Bayangan hanya diberikan kepada lapisan yang melayang sementara di atas lembar dan hilang lagi: menu, popover, pemilih emoji, pemilih anggota, dialog, panel panggilan, toast, dan tooltip presensi. Lumi tidak memakai bayangan sama sekali: tiga tingkat hitam (#000 → #1c1c1e → #2c2c2e) dan tepi #3a3a3c menyusun seluruh kedalamannya. Di peta jaringan, cincin putih 5–7 px di sekeliling avatar adalah celah yang memotong garis, bukan bayangan.

### Shadow Vocabulary
- **Melayang** (`--shadow`, terang: `0 18px 48px #1b1d2126, 0 2px 6px #1b1d210f`; gelap: `0 18px 48px #000a, 0 0 0 1px #2a2c2f`): satu-satunya bayangan jendela utama, untuk setiap lapisan sementara di atas. Di tema gelap bayangan hampir tak terlihat, maka cincin 1 px Garis Tepi ikut menggantikannya.
- **Tirai dialog** (`::backdrop`, #0d0e10a6): meredupkan lembar di belakang dialog modal.
- **Cincin knop** (`0 0 0 .5px #00000026`): garis rambut yang menjaga knop putih sakelar tetap terdefinisi di atas emas; bukan bayangan jatuh.

### Named Rules
**Aturan Datar Saat Diam.** Permukaan yang diam tidak berbayangan. Kedalaman adalah satu tingkat warna dan satu tepi 1 px. Bayangan muncul hanya pada lapisan yang datang dan pergi: menu, dialog, panel panggilan, toast, tooltip.

**Aturan Lapisan Sementara.** Lapisan yang melayang selalu memakai Lembar Putih, Garis Tepi 1 px, sudut 10–16 px, bayangan `--shadow`, dan animasi muncul 140–160 ms. Ia tidak pernah tembus pandang atau buram.

## Shapes

Bahasa bentuknya adalah sudut tumpul yang bertingkat menurut ukuran benda. Kontrol (tombol, input, select, tombol ikon, ikon file) bersudut 8 px; baris daftar, menu, kisi ringkasan, dan opsi dukungan 10 px; popover, kartu tautan, kartu pengingat, dan pratinjau gambar 12 px; komposer 14 px; lembar, dialog, panel panggilan, dan kartu sambutan 16 px. Item di dalam menu 6 px, kbd dan kode 4 px. Pil penuh (999 px) untuk badge, chip anggota, tab tanggal, reaksi, batang progres, sakelar, dan scrollbar; avatar selalu lingkaran. Gelembung pesan bersudut 16 px dengan satu sudut 4 px yang menunjuk ke arah pengirim: kiri atas untuk pesan masuk, kanan atas untuk pesan sendiri. Tepi selalu 1 px (2 px hanya untuk cincin fokus, outline presensi, dan garis putus-putus zona lepas file; 3 px untuk garis kiri kutipan). Kotak centang 20 px bersudut 6 px; sakelar 34×20 px dengan knop 16 px yang bergeser 14 px.

Lumi memakai bahasa yang berbeda dan sengaja: pulau bersudut bawah 10 px saat pill (sama dengan bahu), 20 px saat kompak, 28 px saat terbuka, dan bahu cekung 10 px menyambungkannya ke tepi layar. Semua kontrol di dalamnya pil penuh; kartu Rak dan menu 16 px; item menu 12 px. Tubuh Lumi adalah bentuk organik simetris dengan mata dua elips (kelompok `#eyes` disalin ke pill, jangan diubah strukturnya), tanpa alis, dengan pipi dan highlight lembut.

### Named Rules
**Aturan Sudut Bertingkat.** 4 px teks sebaris, 6 px item menu, 8 px kontrol, 10 px baris dan menu, 12 px popover dan kartu, 14 px komposer, 16 px lembar dan dialog, 999 px pil. Benda yang lebih besar mendapat sudut yang lebih besar; satu benda tidak mencampur dua tingkat.

## Components

### Buttons
- **Karakter:** tenang dan tegas; satu tombol emas per tampilan, sisanya putih dengan tepi.
- **Shape:** sudut 8 px, tinggi minimal 38 px, padding 8px 14px, label 13px/600, ikon 16–18 px.
- **Primary** (`button-primary`): latar Emas Lumi, teks Tinta (`accent-ink`), tepi seiring latar; hover Emas Ditekan. Dipakai oleh tombol submit dialog, Simpan label, Terima transfer, Undang, Aktifkan pratinjau, Masuk di kartu sambutan (lebar penuh, 46 px, 14px/700).
- **Secondary** (`button-secondary`): latar Lembar Putih, tepi Tepi Kontrol, teks Tinta; hover Sentuh.
- **Danger outline** (`button-danger-outline`): latar transparan, tepi dan teks Merah Teks; hover Sentuh. Untuk Hapus label dan Hapus Ruang. **Danger filled** (`button-danger`): latar Merah Bata, teks putih; hanya konfirmasi penghapusan dan Tutup panggilan. **Jawab panggilan** memakai Hijau Angkat.
- **Icon** (`button-icon`): 36 px, tanpa tepi, Tinta Redup; hover latar Sentuh dan Tinta. Badge bilah atas: pil emas 18 px dengan cincin 2 px warna bingkai.
- **Quiet row** (`button-quiet-row`): tombol sidebar (Buat Ruang, Hubungkan perangkat) adalah baris 38 px bersudut 10 px tanpa tepi, 14px/500, ikon 20 px Tinta Redup, rata kiri; hover Sentuh. Tombol teks kecil (Tampilkan format, batalkan transfer, pesan aksi) 30 px, 12px, tanpa tepi; tautan Keluar bergaris bawah Merah Teks.
- **Hover / Focus:** transisi warna 140 ms; fokus keyboard `outline: 2px solid var(--focus)` offset 2 px; disabled opacity .55 dengan kursor not-allowed.

### Chips
- **Chip anggota** (`chip-member`): pil Lembar Naik, tepi Garis Tepi, teks Tinta, padding 5px 10px.
- **Badge belum dibaca** (`badge-unread`): pil Emas Lumi 20 px, teks Tinta 11px/700 tabular.
- **Tab tanggal** (`date-divider`): pil Lembar Naik, Tinta Redup 12px/500, di tengah aliran pesan tanpa garis di kiri-kanan.
- **Reaksi:** pil Lembar Putih 26 px bertepi Garis Tepi; reaksi Anda bertepi Biru Teduh berlatar Terpilih; hover naik 2 px.
- **Badge tautan:** pil Lembar Naik 11px/600 bertuliskan nama platform.

### Cards / Containers
- **Lembar** (`sheet`): Lembar Putih, sudut 16 px, tepi Garis Tepi; percakapan hanya bersudut kiri, detail hanya kanan, dengan Garis Halus sebagai batas kiri detail.
- **Kisi ringkasan:** dua figur dalam satu wadah bersudut 10 px bertepi Garis Tepi, dibagi satu garis; label 12px Tinta Redup di atas, angka 24px/500 di bawah, selalu sejajar meski label membungkus.
- **Kartu tautan dan pratinjau:** 12 px, tepi Garis Tepi, padding 10 px, thumbnail 72×60 px bersudut 8 px, judul 13px/700 maksimal dua baris, tombol Buka di browser gaya sekunder.
- **Kartu pengingat:** 12 px, padding 16 px; formulir pengingat berlatar Lembar Naik.
- **Opsi dukungan:** baris 64 px bersudut 10 px bertepi Garis Tepi; hover tepi Tepi Kontrol dan latar Sentuh.
- **Kartu sambutan:** 440 px, sudut 16 px, kepala 64 px dan kaki berlatar Lembar Naik, konten berpadding 32 px.
- **Shadow Strategy:** tidak ada; lihat Elevation & Depth.

### Inputs / Fields
- **Input teks** (`input`): 40 px, sudut 8 px, tepi Tepi Kontrol, latar Lembar Putih, 14px; placeholder Tinta Redup; label 13px/600 di atasnya dengan jarak 8 px; 16 px antar field. Input sambutan 44 px; input label perangkat 40 px dengan padding 7px 11px. Textarea pengingat 64 px, resize vertikal.
- **Kotak pencarian** (`search`): di sidebar di atas tab filter; 34 px (38 px di jendela sempit), ikon 16 px, kbd "/" bertepi; fokus mengubah tepi menjadi Biru Teduh dan cincin fokus masuk 1 px ke dalam. "/" memfokuskannya dari mana pun dan membuka daftar di jendela sempit.
- **Komposer** (`composer`): kotak 14 px bertepi Tepi Kontrol, padding 6 px, tombol lampir dan Kirim 38 px bersudut 10 px di dalamnya; textarea 38–130 px tanpa tepi; fokus mengubah tepi menjadi Biru Teduh. Kirim selalu emas. Petunjuk 11px di bawahnya.
- **Select** (`select`): satu gaya di mana pun: 40 px, `appearance: base-select`, panah 16 px dari tepi kanan, padding kanan 44 px agar teks tidak menabrak panah, satu baris yang dipotong di tepi konten. Picker: 12 px, Lembar Putih, bayangan Melayang; opsi 36 px bersudut 8 px, hover Sentuh, terpilih Emas Pucat dengan teks dan centang Emas Teks. Panah bawaan browser tidak dipakai.
- **Sakelar** (`switch`): 34×20 px, rel Tepi Kontrol, knop putih 16 px dengan cincin rambut; aktif rel Emas Lumi dan knop bergeser 14 px dalam 140 ms; hover baris membuat rel yang mati menjadi Goresan Seleksi.
- **Kotak centang** (`checkbox`): 20 px, sudut 6 px, tepi 1.5 px Tepi Kontrol; hover tepi Emas Garis; tercentang latar Emas Lumi dengan centang Tinta.
- **Tanggal:** picker native mengikuti `color-scheme`, ikon kalender Lumilan 18 px, segmen yang difokus berlatar Emas Pucat.
- **Progres:** pil 8 px, rel Lembar Naik, isi Emas Pekat, transisi lebar 200 ms.
- **Error / Disabled:** teks galat Merah Teks; disabled opacity .5–.55, kursor not-allowed.

### Navigation
- **Bilah atas:** 52 px di atas Batu Bingkai tanpa garis bawah; merek (ikon 26 px, "Lumilan" 16px/700, "Chat" Tinta Redup 500); empat tombol ikon; avatar Anda 32 px berlatar Emas Lumi dengan tepi 2 px warna status.
- **Tab filter** (`tab-filter`): tab garis bawah pada satu garis Garis Tepi; 38 px, 13px/600, Tinta Redup; hover Tinta dengan garis Garis Tepi; aktif Tinta dengan garis 2 px Emas Pekat selebar label (`box-shadow: inset 0 -2px 0`). Di sidebar tab berbagi lebar secara merata; saat sempit mengecil ke 12px, dan bila masih meluap barisnya bergulir dengan tepi memudar 24 px.
- **Baris daftar** (`row-list`): 56 px, sudut 10 px, avatar 38 px, nama 14px/600, baris kedua 12px Tinta Redup, waktu 11px, badge di kanan; hover Sentuh; terbuka Emas Pucat bertepi Emas Garis. Pengingat dan Catatan pribadi adalah baris 40 px dengan ikon abu 22 px tanpa tile. Keterangan grup 12px/600.
- **Kategori Pengaturan** (`settings-tab`): daftar tab vertikal (pola tab ARIA) di kolom 220 px berlatar Batu Bingkai, dibatasi Garis Halus di kanan. Setiap kategori adalah baris 40 px bersudut 10 px, ikon 20 px Tinta Redup, label 14px/500 yang dipotong elipsis; hover Sentuh; terpilih Emas Pucat bertepi Emas Garis dengan label 600 dan ikon Emas Teks, sama seperti baris percakapan yang dibuka. Panah, Home, dan End berpindah kategori; hanya tab terpilih yang masuk urutan Tab.
- **Menu:** 10 px, padding 5 px, bayangan Melayang, item 36 px bersudut 6 px dengan ikon Tinta Redup; item hapus Merah Teks; muncul 160 ms dari 4 px di bawah.
- **Mobile:** di bawah 700 px satu wilayah sekaligus dengan tombol Kembali di header dan aksi akun pindah ke kaki sidebar.

### Avatar
- Lingkaran 38 px (32 px di pesan, 30 px di baris detail, 40 px header, 48 px detail, 52 px profil), inisial 12px/700 di atas salah satu dari lima tint identitas; foto menutupi penuh. Avatar Ruang dan Catatan berlatar Sentuh dengan ikon 20 px Tinta Redup (Emas Pucat dan Emas Teks di header dan detail). Status sebagai outline 2 px berjarak 1 px. Avatar Anda di peta jaringan 60 px Pulau Hitam dengan celah putih 7 px.

### Peta Jaringan (empty state)
- Sebelum memilih percakapan, lembar menampilkan LAN ini: avatar Anda di tengah, setiap perangkat online pada cincin 1 px Garis Tepi di sekelilingnya (putus-putus Pembagi saat masih kosong), garis tipis Pembagi menghubungkannya, label 12px/600 di bawah tiap avatar. Ikon kosong 56 px Lembar Naik, judul 18px/700, teks 13px/1.6.

### Lumi (komponen tanda tangan)
- **Pulau:** hitam pekat menempel ke tepi atas layar dengan bahu cekung 10 px; pill idle selebar 120 px dan setinggi menu bar macOS (30 px tanpa menu bar serta di Windows/Linux) menampilkan mata Lumi 26×10 px dan badge emas di kiri, jam 12px/700 emas (atau hitung mundur) di kanan; disentuh melebar 16 px dan jam berganti petunjuk Buka. Kompak 320×64 px: Lumi 58×54 px, judul 14px, pratinjau 12px Abu Kedua, chevron Buka. Terbuka: Lumi 80×72 px di kolom kiri dengan hitungan aktivitas di bawahnya; bilah tab (tab terpilih menampilkan namanya, lainnya hanya ikon); halaman Aktivitas, Fokus, Rehat, Rutinitas, Tugas, Rak.
- **Kontrol:** semua pil penuh 34 px berlatar Arang bertepi Garis Arang; satu tombol emas (`island-button-primary`) per halaman; Terima hijau dan Tolak merah hanya di Aktivitas; pilihan menit sebagai pil kecil 28–30 px yang aktifnya bertepi dan berteks emas; chip aktivitas 26 px 11px. Kolom tugas pil 34 px. Kartu Rak 136 px bersudut 16 px berlatar Arang. Menu popover 16 px berlatar Arang, item 12 px.
- **Ikon:** satu set simbol sebaris di `notch.html`: kisi 24 px, goresan 1,8 px bulat, warna teks saat ini; 15–18 px saat dipakai. Jendela utama memakai set reicon (24 px) pada 18 px, 16 px di kotak pencarian, 20 px di avatar Ruang.
- **Gerak:** morf lebar dan tinggi 380 ms dengan pegas `cubic-bezier(.34, 1.56, .64, 1)`, sudut 380 ms ease, menutup 260 ms ease-in; isi memudar 200 ms; halaman masuk 180 ms dari 12 px; kedip 400 ms sekali saat muncul atau disentuh; sapa 700 ms, lambaian 600 ms dua kali, dering 500 ms empat kali. Pill idle tidak menjalankan animasi apa pun; saat tersembunyi atau tidur semua animasi mati.

### Layar rehat
- Tirai `break-scrim` di atas jendela transparan, kolom tengah: judul 24px/600 Putih Kapur, petunjuk 15px Abu Kedua, jam clamp(72px, 14vw, 160px)/600 tabular, tombol pil 44 px Emas Lumi Murni (`break-button`) dengan hover #ffdf8f; cincin fokus `island-focus`. Masuk memudar 320 ms.

### Stiker
- **Pemilih** (`sticker-picker`): lapisan sementara di posisi pemilih emoji, Lembar Putih bersudut 12 px, padding 8 px, bayangan Melayang, lebar `min(360px, 100% − 40px)`. Strip tab 36 px (Terkini, lalu sampul tiap paket 26 px) di atas Garis Halus; tab terpilih dan hover berlatar Sentuh. Kisi lima kolom sel persegi bersudut 8 px, hover dan fokus Sentuh. Kaki "Kelola stiker…" 34 px Tinta Redup di atas Garis Halus.
- **Pesan stiker:** gambar tanpa gelembung, lebar `min(160px, 45vw)` (128 px di bawah 480 px), menempel ke sisi pengirim; ukurannya dipesan sebelum gambar dimuat.
- **Impor di Pengaturan:** zona lepas yang sama dengan Rak (garis putus-putus Tepi Kontrol); setelah impor, ringkasan Tinta Redup dan daftar file yang dilewati di bawah tombol Pilih gambar, memakai baris daftar tugas: nama 13px tebal satu baris, alasan 12px Tinta Redup di bawahnya.

### Toast
- Pil 10 px berlatar Pulau Hitam, teks putih 13px, bayangan Melayang, di tengah bawah 24 px, muncul dengan geser 16 px dan opacity 200 ms. Di tema gelap latar #f1f2f3 dengan teks Tinta.

## Do's and Don'ts

Pagar visual yang diambil dari implementasi saat ini.

### Do:
- **Lakukan** satu tombol emas per tampilan; tombol lain Lembar Putih bertepi Tepi Kontrol, 38 px, sudut 8 px.
- **Lakukan** fokus keyboard yang sama di mana pun: `outline: 2px solid var(--focus)` dengan offset 2 px (−1 px di dalam kotak pencarian dan komposer; `island-focus` di Lumi dan layar rehat).
- **Lakukan** satu gaya select di seluruh dialog dan pengaturan: tinggi 40 px, panah khusus 16 px dari tepi kanan, padding kanan 44 px, picker bersudut 12 px.
- **Lakukan** Pengaturan sebagai satu kategori sekaligus dalam dialog berukuran tetap; section baru masuk ke panel kategori yang ada, dan kategori baru memakai baris 40 px bersudut 10 px dengan ikon 20 px.
- **Lakukan** pemeriksaan tema terang dan gelap, lebar 320 px, dan teks terjemahan Indonesia yang panjang untuk setiap kontrol baru; panah, teks, fokus, dan tepi tidak boleh saling menabrak.
- **Lakukan** `tabular-nums` pada setiap angka yang berubah dan elipsis satu baris pada nama dan judul.
- **Lakukan** kedalaman dengan tingkat warna (`frame` → `surface` → `raised`) dan tepi 1 px; simpan `--shadow` untuk lapisan sementara saja.
- **Lakukan** status sebagai titik 7 px atau outline 2 px di sekeliling avatar, dan identitas sebagai salah satu dari lima tint avatar.
- **Lakukan** penghormatan pada `prefers-reduced-motion` dan `data-page-hidden`: semua animasi dan transisi berhenti; animasi Lumi berdurasi terbatas dan pill idle tidak beranimasi.
- **Lakukan** ikon dari set yang sudah ada: reicon di jendela utama, simbol sebaris 24 px/1,8 px di Lumi; gambar sebagai SVG dengan `currentColor`.

### Don't:
- **Jangan** beri bayangan, blur, transparansi, atau gradien pada permukaan jendela utama; tubuh Lumi adalah satu-satunya gradien.
- **Jangan** pakai emas sebagai latar area besar, warna teks panjang, warna status, atau hiasan; emas adalah sinyal yang meminta tangan.
- **Jangan** gambar hitam pekat selain gelembung pesan sendiri, avatar Anda di peta jaringan, toast, dan pulau Lumi.
- **Jangan** pakai hijau dan merah di luar status presensi, Jawab/Tutup panggilan, Terima/Tolak di Lumi, dan tindakan yang menghapus.
- **Jangan** tambah huruf kedua, set ikon lain, maskot lain, ilustrasi dekoratif, atau emoji sebagai hiasan; Lumi satu-satunya wajah.
- **Jangan** pakai panah bawaan browser pada select, atau mencampur dua gaya dropdown dalam satu dialog.
- **Jangan** ubah ukuran jendela Lumi per mode (tetap 680×280 DIP); pulau bermorf lewat CSS, dan gaya Lumi (kurva simetris, tanpa alis, mata dua elips, warna hangat) dipertahankan.
- **Jangan** campur dua tingkat sudut pada satu benda, dan jangan beri sudut 16 px pada kontrol atau sudut 8 px pada lembar.
- **Jangan** sembunyikan keadaan terpilih hanya dengan warna latar; baris yang dibuka selalu bertepi Emas Garis di atas Emas Pucat.
