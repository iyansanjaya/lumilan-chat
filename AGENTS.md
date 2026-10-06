# Aturan kerja Lumilan Chat

## Sumber utama dan sinkronisasi

- `iyansanjaya/lumilan` (privat) adalah sumber utama. Semua perubahan kode, workflow, skrip, dan dokumentasi dibuat serta diuji di repo privat.
- `iyansanjaya/lumilan-chat` (publik) menerima salinan berkas dari repo privat. Jangan membuat perubahan berbeda atau perbaikan langsung hanya di repo publik.
- Saat menyalin ke repo publik, kecualikan folder `public/`, `graphify-out/`, dan hasil kompilasi `out/`. Jangan menghapus kedua folder itu dari repo privat.
- Jangan menganggap build dari checkout repo publik lengkap: `main.ts` dan antarmuka aplikasi membutuhkan `public/` dari repo privat.
- `README.md` dan `README.public.md` adalah versi Inggris; `README.id.md` dan `README.public.id.md` adalah versi Indonesia. Perbarui pasangan bahasa yang sesuai saat mengubah fitur atau petunjuk pengguna.
- Saat menyinkronkan dokumentasi ke repo publik, salin `README.public.md` sebagai `README.md` dan `README.public.id.md` sebagai `README.id.md`. Pertahankan panduan pengembang di README privat; versi publik tetap ringkas, dengan perilaku, persyaratan, dan batasan OS yang konsisten dalam kedua bahasa.

## Dukungan Windows, macOS, dan Linux (wajib untuk setiap pekerjaan)

- Setiap perencanaan, implementasi, perbaikan bug, review, perubahan UI, dependensi, skrip, workflow, packaging, dan dokumentasi wajib mempertimbangkan **Windows, macOS, dan Linux**. Jangan hanya berfokus pada OS tempat pekerjaan dilakukan atau OS yang disebut dalam laporan bug; telusuri dampaknya pada ketiga OS.
- Periksa macOS **Intel (x64) dan Apple Silicon (arm64)** serta Linux **X11 dan Wayland** sesuai cakupan fitur. Gunakan API yang tersedia pada platform tujuan; perbedaan perilaku wajib memiliki fallback atau batasan yang dijelaskan kepada pengguna. Jangan menghapus pemeriksaan keamanan, privasi, fokus, atau tes platform lain agar satu OS lolos.
- Saat alurnya terpengaruh, periksa jalur file, izin dan penyimpanan, discovery/jaringan, tray, notifikasi, autostart, panggilan/perangkat audio, lock/suspend/resume, Lumi, instalasi, dan pembaruan pada ketiga OS. Keberhasilan build atau tes dengan mock platform tidak membuktikan perilaku native OS tersebut.
- Pilih pengujian berdasarkan risiko perubahan dan catat hasil per OS: **diimplementasikan**, **lulus tes otomatis**, **lulus runtime native**, **terbatas/fallback**, atau **belum diuji**. Untuk alur native atau paket yang berubah, jalankan verifikasi paket dan smoke/interaksi terkait di OS tujuan; tes Windows tidak menggantikan uji macOS/Linux.
- Jika perangkat atau runner native belum tersedia, tetap selesaikan pemeriksaan kode dan pengujian yang dapat dijalankan, lalu nyatakan OS/arsitektur/lingkungan yang belum diverifikasi serta batasan yang diketahui. Jangan mengklaim seluruh fitur kompatibel, setara, atau stabil di tiga OS tanpa bukti runtime yang sesuai.

## TypeScript dan hasil kompilasi

- Seluruh source aplikasi, preload, tes, dan skrip Node memakai `.ts`, `.cts`, atau `.mts`. `out/` adalah hasil kompilasi yang dibangun ulang, bukan source. Jangan menambahkan source JavaScript atau mengedit hasil kompilasi.
- Pertahankan pemeriksaan strict, batas renderer tanpa tipe Node, preload mandiri dalam sandbox, kontrak IPC bersama, dan validasi runtime input tidak tepercaya. Jangan melewati error memakai `any`, `@ts-ignore`, atau `@ts-nocheck`.
- Jalankan `bun run typecheck`, `bun run test`, dan `bun run test:large` sesuai risiko; pengujian 5 GB membutuhkan minimal 16 GB disk kosong. Paket memakai `out/main.js`, aset `out/public/`, serta allowlist runtime yang eksplisit. Jangan sertakan tes, skrip pengembang, source TypeScript, atau source map.
- Workflow privat `typescript-validation.yml` memeriksa revisi yang tepat sebelum merge. Workflow publik tetap memakai source `master` privat. Salin source `.cts` verifier; jalankan hasilnya melalui `bun run verify:package` setelah build.

## Pemeriksaan antarmuka

- Gunakan gaya dropdown `select` yang sama di seluruh dialog dan pengaturan. Jangan biarkan satu dropdown memakai panah bawaan browser saat yang lain memakai panah khusus; beri ruang kanan yang cukup untuk ikon (minimal 16 px dari tepi dan padding teks yang tidak menabrak ikon).
- Saat mengubah kontrol formulir, periksa tampilannya pada tema terang dan gelap, jendela sempit, serta teks terjemahan yang panjang. Pastikan panah, teks, fokus, dan tepi kontrol tidak saling berhimpitan sebelum menganggap perubahan selesai.

## Mutu perubahan dan pembuktian runtime (wajib)

- Telusuri dampak perubahan sampai alur yang dipakai pengguna. Periksa pemanggil, impor, daftar aset protokol, CSP, preload, dan isi paket ketika salah satunya berubah. Perbaiki akar masalah; jangan berhenti pada perubahan kode yang tampak benar secara lokal.
- Tes unit, pemeriksaan sintaks, dan keberadaan berkas di `app.asar` **tidak membuktikan antarmuka berhasil dimuat**. Setelah mengubah startup, impor renderer, protokol aset, atau packaging, jalankan `bun run pack`, `bun run verify:package`, dan `bun run smoke:ui` dengan profil terisolasi. Pastikan layar awal, chat, dan pengaturan benar-benar tampil, modul tidak gagal dimuat, serta tidak ada error renderer. Uji juga interaksi yang terkena perubahan.
- Jangan mengorbankan ketelitian demi perubahan kecil atau hemat token. Pilih cakupan perbaikan dan pengujian berdasarkan risiko nyata, meskipun perlu menyentuh lebih banyak berkas. Jika validasi runtime tidak dapat dilakukan, nyatakan keterbatasannya secara jelas dan jangan mengklaim fitur stabil.

## Pendamping notch Lumi

- Lumi memakai desain, animasi, dan suara asli Lumilan. Jangan menyalin nama, karakter, suara, atau media Coucou; repo tersebut hanya referensi perilaku.
- Pertahankan sesi memori terpisah, sandbox, context isolation, CSP, daftar aset terbatas, penolakan izin perangkat, dan Permissions-Policy untuk mikrofon/kamera. Jangan memberikan bridge utama, history, SDP, path file, atau akses jaringan kepada renderer notch.
- Validasi sender, frame utama, URL, jenis tindakan, serta ID permintaan yang masih berlaku. Tindakan file dan panggilan harus mengikuti sumber keadaan utama; jangan membuat sistem persetujuan/panggilan kedua. Buka jendela utama untuk pemeriksaan audio saat menerima panggilan.
- Pertahankan privasi pada antrean yang sudah ada setelah pengaturan berubah; jangan menandai pesan dibaca dari pratinjau. Hormati mute, Jangan ganggu, layar terkunci, suspend, dan pause. Keadaan kedaluwarsa/batal harus menghapus tindakan yang tidak berlaku.
- Animasi harus terbatas durasinya dan berhenti saat tersembunyi/reduced motion. Batasi antrean, gabungkan progres, hindari polling idle dan penulisan posisi setiap gerakan pointer.
- Perubahan notch wajib melewati tes, pack, verifikasi aset, smoke UI utama, dan smoke notch pada profil terisolasi. Ulangi smoke notch minimal tiga kali setelah perbaikan; sertakan pengukuran resource dan kegagalan perangkat. Angka heap JS tidak sama dengan total RAM proses. Uji native macOS/Linux sebelum mengklaim dukungan runtime; Wayland memakai fallback notifikasi sistem.
- Mock jendela Electron harus mengikuti nilai `focusable` saat dibuat dan batas API tiap platform: `setFocusable()` hanya Windows/macOS. Tes harus mempertahankan pemeriksaan privasi/fokus pada Linux X11 dan fallback Wayland; jangan melewati seluruh tes Linux untuk mengatasi ekspektasi yang keliru.

## Build macOS dan Linux di GitHub

1. Push perubahan ke cabang `master` repo privat terlebih dahulu. Workflow memakai `ref: master` saat mengambil source privat.
2. Salin perubahan ke repo publik sesuai aturan di atas, termasuk `.github/workflows/build-macos-linux.yml` dan `scripts/verify-ui-package.cts`, lalu push cabang `master` repo publik.
3. Jalankan **Actions → Build macOS and Linux → Run workflow** dari repo publik. Workflow mengambil source lengkap dari repo privat, menjalankan tes, membangun paket, memeriksa UI dalam `app.asar`, lalu mengunggah artefak. Opsi penandatanganan macOS tetap tidak dicentang sampai secret Apple tersedia.
4. Periksa hasil Mac Intel, Mac Apple Silicon, dan Linux sebelum mendistribusikan. Build lokal atau tes Windows tidak membuktikan DMG macOS berfungsi.

## Pengingat

- Daftar penerima hanya menampilkan kontak aktif yang mengiklankan kemampuan Pengingat, sesuai daftar perangkat online. Tolak pembuatan permintaan baru jika kontak terputus sebelum disimpan; jangan mengalihkan pilihan diam-diam ke Diri sendiri. Antrean permintaan yang sudah dibuat, keputusan, dan pembatalan tetap dipertahankan saat koneksi terputus. Identitas ditentukan oleh Peer ID; jangan menggabungkan atau menghapus kontak/riwayat hanya karena namanya sama. Filter harus memberi ruang bagi teks terjemahan tanpa bertumpuk, pada tema terang/gelap dan jendela sempit.
- Tes jaringan memakai profil sementara, discovery dinonaktifkan, dan listener loopback dengan port acak. Jangan menjalankan fixture Andi/Budi atau identitas uji lain pada jaringan/profil pengguna.

- Lock dan suspend adalah dua alasan blokir terpisah: resume tidak berarti layar sudah unlock. Notifikasi yang tertunda selama blokir harus diperiksa kembali pada sumber keadaan utama setelah semua blokir selesai, digabungkan sekali, dan mengikuti status serta pengaturan privasi terbaru. Uji urutan lock → suspend → resume → unlock serta urutan sebaliknya; jangan mengulang jadwal yang telah diberitahukan sebelumnya.

- Jadwal sekali jalan disimpan lokal sebelum notifikasi dikirim. Gunakan ID idempotensi, identitas peer terautentikasi, timestamp UTC, validasi batas waktu, antrean terbatas, dan satu timer deadline tanpa polling idle. Saat restart/resume, gabungkan jadwal terlewat; jangan mengulang notifikasi yang sudah dipersistenkan sebagai jatuh tempo.
- Permintaan hanya untuk kontak pribadi yang mengiklankan kemampuan pengingat. Penerima wajib memilih jadwal dan menerima; jadwal diterima hanya dikendalikan penerima. Pengirim tidak boleh mengubah, menyelesaikan, atau membatalkan jadwal itu. Simpan keputusan dan tombstone agar pengiriman ulang atau pembatalan berbarengan tidak membuat duplikat atau menghidupkan permintaan yang sudah dibatalkan.
- Pertahankan permintaan/jawaban/pembatalan offline, status pengiriman yang jujur, privasi pratinjau, mute, Jangan ganggu, lock/suspend, dan fallback sistem. Renderer Lumi hanya memperoleh ringkasan terbatas dan membuka pusat Pengingat, tanpa akses jadwal atau persetujuan langsung.
- Perubahan pengingat wajib diuji untuk penyimpanan gagal, restart/resume, waktu lewat, batas spam, replay/identitas salah, offline/reconnect, accept versus cancel, dan sumber pesan yang sudah dihapus. Jalankan tes, pack, verifikasi aset, smoke UI, serta smoke notch/pengingat minimal tiga kali pada profil terisolasi; periksa tema terang/gelap dan jendela sempit.

## Pengiriman file

- File dikirim melalui pesan pribadi atau Ruang Percakapan, tidak melalui Ruang Pengumuman. Batasnya 5 GB (5 × 1024 × 1024 × 1024 byte) untuk klien terbaru; klien transfer bertahap sebelumnya dibatasi 2 GB, klien lebih lama dibatasi 500 MB atau 100 MB, dan klien tanpa transfer bertahap dibatasi 20 MB pada pesan pribadi. Periksa kemampuan penerima sebelum mengirim file besar.
- Catatan pribadi dapat menyimpan lampiran hingga 5 GB di data aplikasi lokal tanpa mengirimnya ke jaringan. Lampiran ini ikut dihapus saat pesannya dihapus.
- Persetujuan dan transfer file Ruang harus independen untuk setiap penerima: anggota yang belum menjawab, menolak, lambat, atau gagal tidak boleh menahan anggota lain. Pertahankan pembacaan per potongan, progres gabungan yang tidak mundur, dan pembersihan tiap transfer; pembatalan tidak menghapus file yang sudah diterima.
- Jangan memuat seluruh file 5 GB ke renderer, IPC, atau satu paket jaringan. Pertahankan persetujuan penerima, verifikasi SHA-256, pemeriksaan ruang disk, dan pembersihan file sementara saat transfer gagal atau dibatalkan.
- Gambar hasil paste clipboard dibatasi 20 MB, 40 juta piksel untuk seluruh frame, dan 120 frame. Validasi byte dan format PNG/JPEG/WebP/GIF di proses utama sebelum browser menampilkan pratinjau; jangan mempercayai MIME atau ekstensi saja. Pratinjau tetap terikat pada percakapan asal, baru dikirim setelah tindakan Kirim, dan memakai alur persetujuan/integritas file yang sama. Batasi data IPC dan bersihkan file staging serta URL blob setelah selesai atau dibatalkan.
- Validasi paste memakai maksimal satu decode aktif dan satu kandidat pengganti terbaru. Pelepasan pratinjau setelah Kirim tidak membatalkan paste baru; Remove/pagehide membatalkan kandidat tertunda. Kegagalan cleanup tidak boleh mengubah transfer yang sudah sukses menjadi gagal. Staging berada di direktori data privat, dipulihkan pada startup instance baru, dan tidak dihapus saat rebind jaringan masih memiliki transfer aktif. Uji paste beruntun, paste selama Kirim, pembatalan validasi, cleanup gagal, restart/rebind, dan Quit saat persetujuan penerima masih menunggu.
- Pratinjau PNG/JPEG/WebP dan GIF bergerak dibuat sebagai thumbnail lokal setelah file diterima dan diverifikasi, hanya untuk file sumber hingga 100 MB dan paling banyak 40 juta piksel (jumlah seluruh frame untuk GIF). GIF dibatasi 120 frame dan thumbnail animasinya 2 MB; GIF di luar batas tetap dapat diunduh sebagai lampiran. Hapus thumbnail bersama file asli ketika riwayat dihapus permanen.
- Saat mengubah alur file, uji ukuran tepat 5 GB dan di atas batas, penolakan, pembatalan, kerusakan data, transfer terputus, serta kompatibilitas klien 2 GB, 500 MB, 100 MB, dan 20 MB. Jalankan tes dan periksa isi paket sebelum distribusi.

## Akses repo privat dari workflow publik

- Secret `PRIVATE_SOURCE_TOKEN` harus dibuat pada **repo publik**: **Settings → Secrets and variables → Actions → New repository secret**. Jangan menaruh nilainya di repo privat, kode, file `.env`, log, atau chat.
- Buat fine-grained personal access token GitHub dari **Settings akun → Developer settings → Personal access tokens → Fine-grained tokens**. Pilih pemilik `iyansanjaya`, **Only select repositories: `iyansanjaya/lumilan`**, dan izin **Contents: Read-only**. Token yang kedaluwarsa harus diganti pada secret publik.
- `PRIVATE_SOURCE_TOKEN` hanya untuk checkout source privat. `GH_TOKEN` untuk mengunggah GitHub Release adalah kredensial dan proses terpisah; `GITHUB_TOKEN` bawaan repo publik tidak memberi akses ke repo privat.
- Batasi akses tulis ke workflow repo publik. Siapa pun yang dapat mengubah workflow berpotensi menyalahgunakan secret untuk membaca source privat. Cabut token segera jika diduga bocor.

Lihat [README.id.md](README.id.md#build-macos-dan-linux-tanpa-perangkat-sendiri) atau [README.md](README.md#build-macos-and-linux-without-your-own-devices) untuk langkah pengguna yang lengkap.
