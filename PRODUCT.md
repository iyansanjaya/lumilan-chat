# Product

<!-- impeccable:product-schema 1 -->

<!-- Judul bagian tetap dalam bahasa Inggris karena alat pembaca PRODUCT.md mengandalkan nama bagian yang persis.
     Isinya berbahasa Indonesia. -->

## Platform

web

Lumilan Chat adalah aplikasi desktop Electron (Windows 64-bit, macOS 13+ Intel dan Apple Silicon, Linux AppImage). Antarmukanya dibangun dengan teknologi web di dalam renderer yang di-sandbox, sehingga bahasa desainnya adalah web, bukan iOS atau Android native.

## Users

Utama: tim yang berada di satu tempat. Rekan kerja dalam satu kantor atau ruang kerja, pada LAN atau Wi-Fi yang sama, yang ingin chat, berbagi file, dan panggilan suara tanpa layanan cloud, akun, atau server yang harus dijalankan.

Juga terlayani (menurut lisensi dan fiturnya): satu orang yang memakai Catatan pribadi di perangkatnya sendiri, dan siapa pun yang berbagi jaringan itu. Belum ada audiens lain yang dikonfirmasi.

## Product Purpose

Lumilan Chat adalah aplikasi pesan jaringan lokal. Perangkat saling menemukan di LAN dan terhubung langsung lewat koneksi terenkripsi. Buka aplikasi, pilih nama, dan mulai percakapan. Keberhasilan berarti orang-orang di jaringan yang sama dapat berbicara, berbagi file, dan saling menelepon dengan andal tanpa pengaturan apa pun selain nama, dan tidak ada yang mereka kirim pernah keluar dari jaringan lokal.

## Positioning

Privat sejak dirancang. Tanpa akun, tanpa server chat pusat, tanpa relay internet. Percakapan dan file tetap di LAN; satu-satunya koneksi keluar adalah pengambilan pratinjau tautan opsional (opt-in) dari perangkat pengirim. Lumi, sang pendamping, adalah bonus di atas janji itu, bukan alasan produk ini ada.

## Operating Context

- Berjalan di desktop komputer kerja berdampingan dengan pekerjaan lain. Hidup di system tray; dapat tetap berjalan setelah jendela ditutup, dan dapat dibuka saat masuk ke komputer.
- Hanya satu instance berjalan per perangkat. Peluncuran pertama meminta nama tampilan dan membuat identitas perangkat secara otomatis.
- Discovery memakai mDNS lokal; lalu lintas langsung harus diizinkan oleh firewall dan aturan Wi-Fi/VLAN. Panggilan suara memerlukan akses mikrofon dan lalu lintas UDP lokal langsung.
- Pesan pribadi, pesan Ruang, dan transfer file memerlukan penerima yang dapat dijangkau. Tidak ada yang diantrekan untuk pengiriman offline.
- Pesan di percakapan yang sedang dilihat pada jendela yang fokus ditandai dibaca tanpa suara. Yang lain memberi notifikasi kecuali dibisukan, notifikasi dimatikan, atau status Jangan Ganggu. Notifikasi menunggu selama layar terkunci dan suspend, lalu digabungkan sekali setelahnya.
- Lumi berada di puncak layar sebagai pill bergaya Dynamic Island. Ia menggantikan notifikasi sistem hanya saat pengguna tidak melihat jendela utama. Notifikasi sistem menjadi fallback saat Lumi sedang dimuat, dijeda, dinonaktifkan, atau tidak tersedia (Linux Wayland selalu).
- Aplikasi tersedia dalam 8 bahasa: Bahasa Indonesia, English, Bahasa Melayu, Español, 日本語, 한국어, 简体中文, dan 繁體中文. Pilihan bawaan **Otomatis (wilayah perangkat)** mengikuti wilayah perangkat setiap kali aplikasi dimulai: Indonesia → Bahasa Indonesia, Malaysia → Bahasa Melayu, Spanyol → Español, Jepang → 日本語, Korea Selatan → 한국어, Tiongkok/Singapura → 简体中文, Taiwan/Hong Kong/Makau → 繁體中文, dan wilayah lain → English. Bahasa juga dapat dipilih manual di Pengaturan → Tampilan, dan pilihan manual tetap tersimpan.
- Paket saat ini belum ditandatangani; pengguna diperingatkan agar mengunduh hanya dari halaman Releases resmi.

## Capabilities and Constraints

Fungsi yang dikonfirmasi:

- Pesan pribadi, Ruang Percakapan khusus undangan, dan Ruang Pengumuman (siaran ke perangkat aktif yang mengizinkan pengumuman).
- Catatan pribadi: pesan dan lampiran yang disimpan di perangkat pengguna sendiri, tidak pernah dikirim ke jaringan.
- Berbagi file hingga 5 GB per file ke klien terbaru; klien lebih lama dibatasi 2 GB, 500 MB, 100 MB, atau 20 MB tergantung versinya. Persetujuan penerima, verifikasi SHA-256, pemeriksaan ruang disk, dan independensi per penerima di Ruang wajib dipertahankan.
- Stiker: paket gambar yang diimpor pengguna dan disimpan hanya di perangkatnya, dikirim dari pemilih di komposer ke pesan pribadi, Ruang Percakapan, atau Catatan pribadi. Stiker adalah pengecualian dari aturan persetujuan file: penerima tidak perlu menerima. Pengecualian ini aman karena stiker hanya dikirim ke kontak yang mendukungnya, perangkat penerima hanya menerima WebP hingga 500 KB dan 512 px, men-decode lalu meng-encode ulang gambar sebelum menyimpannya (pengganti verifikasi SHA-256), dan membatasi 30 stiker per pengirim per menit. Pemeriksaan ruang disk dan pengiriman independen per anggota Ruang tetap berlaku.
- Paste gambar dari clipboard dengan pratinjau yang ditinjau sebelum Kirim.
- Panggilan suara satu-ke-satu melalui jaringan lokal.
- Pengingat: jadwal pribadi, atau permintaan ke kontak online yang harus memilih waktu dan menerima.
- Pratinjau tautan: kartu statis (judul, akun, thumbnail kecil, Buka di browser) untuk YouTube, Shorts, dan Instagram saat tersedia tanpa login; Facebook, Threads, dan X mendapat kartu tautan lokal. Pengambilan bersifat opt-in dan hanya terjadi di perangkat pengirim.
- Halaman Lumi: Aktivitas, Fokus (sesi 25/45/60 menit yang mengatur Jangan Ganggu), Rutinitas (asupan air dan pengingatnya), Tugas, dan Rak (hingga 10 file yang disimpan dekat untuk ditarik keluar, dikirim, atau disimpan ke Catatan pribadi). Kabar perangkat untuk charger, jaringan, dan perangkat yang online.
- Rehat kerja: siklus kerja/istirahat dengan pengingat jatuh tempo satu menit, lalu setiap layar meredup dengan hitung mundur; tunda, lewati, atau akhiri lebih awal. Rehat menunggu selama Jangan Ganggu, panggilan, lock, dan sleep.
- Setiap halaman Lumi juga punya rumah di Pengaturan jendela utama, untuk Wayland dan untuk pengguna yang menonaktifkan Lumi.

Batasan teknis yang harus dipertahankan pekerjaan berikutnya:

- CSP renderer yang ketat. Tanpa skrip pihak ketiga, iframe, pemutar tertanam, atau media remote di UI; kartu tautan bersifat statis.
- Renderer tidak punya akses Node; skrip preload di-sandbox; semua IPC memakai kontrak bersama dengan validasi runtime untuk input tidak tepercaya.
- Renderer notch Lumi hanya menerima ringkasan terbatas: tanpa bridge utama, history, path file, peer ID, atau akses jaringan.
- History lokal, file, dan pengaturan tidak dienkripsi di disk. Koneksi memakai libp2p Noise untuk enkripsi dan autentikasi perangkat. Nama profil dipilih sendiri dan tidak memverifikasi identitas.
- Setiap perubahan wajib mempertimbangkan Windows, macOS (x64 dan arm64), dan Linux (X11 dan Wayland), dengan fallback yang dijelaskan kepada pengguna ketika perilakunya berbeda.
- Jendela Lumi berukuran tetap 680×280 DIP; island berubah bentuk lewat CSS dan tidak boleh mengubah ukuran jendela per mode.

Terminologi (pakai nama-nama ini): Lumi, pill, island, panel, Pesan pribadi, Ruang Percakapan, Ruang Pengumuman, Catatan pribadi, Rak, Sesi fokus, Rehat kerja, Rutinitas air, Tugas, Pengingat, Jangan Ganggu, Tetap berjalan di tray.

Belum diputuskan: belum ada rencana yang dikonfirmasi untuk penandatanganan kode, relay internet, akun multi-perangkat, atau sinkronisasi history pesan. Pekerjaan berikutnya tidak boleh menyiratkan salah satunya.

## Brand Commitments

- Nama dan tagline: **Lumilan Chat**, "Your network. Your conversations." Nama "Lumilan" dan karakter Lumi bersifat proprietary dan tidak boleh dipakai untuk mengidentifikasi produk lain.
- Ikon aplikasi: ikon yang ada di `build/` (icon.svg, icon.png, icon.ico, icon-mac.icns, trayTemplate*.png) tetap seperti adanya.
- Karakter Lumi: lembut dan imut, tidak pernah kasar. Pill hitam dengan bahu melengkung yang menyatu ke tepi atas layar, mata dua elips, serta animasi dan suara asli Lumilan. Coucou hanya referensi perilaku; nama, karakter, suara, atau medianya tidak boleh disalin.
- Huruf: Public Sans (dibundel di `src/renderer/fonts/`, OFL).
- Bahasa: kedelapan bahasa setara dan lengkap; teks sumber ditulis dalam Bahasa Indonesia, dan setiap teks baru wajib diterjemahkan ke ketujuh bahasa lain (tes lokal menolak terjemahan yang hilang). Setiap tampilan harus memuat terjemahan yang panjang, seperti Bahasa Indonesia, Bahasa Melayu, dan Español, tanpa tumpang tindih, pada tema terang dan gelap serta jendela sempit. Teks Jepang, Korea, dan Tionghoa di Linux memerlukan font CJK dari sistem operasi.
- Suara: lugas, langsung, orang kedua, jujur tentang batasan. Dokumentasi menyatakan apa yang belum diverifikasi alih-alih mengklaim dukungan.

## Evidence on Hand

- Tangkapan layar: `docs/screenshots/chat-light.png`, `docs/screenshots/chat-dark.png`, `docs/screenshots/settings.png`. Diambil pada profil demo terisolasi dan perangkat uji lokal; tidak berisi percakapan pengguna.
- Changelog: `CHANGELOG.md` dan `CHANGELOG.id.md`, riwayat fitur per rilis.
- Dokumentasi: `README.md`, `README.id.md` (pengembang), `README.public.md`, `README.public.id.md` (untuk pengguna), `LICENSE`, `LICENSE.id.md`.
- Distribusi: repo publik `iyansanjaya/lumilan-chat` dengan GitHub Releases untuk paket Windows, macOS, dan Linux.
- Dukungan: tautan tip Trakteer (Indonesia) dan Ko-fi (internasional); `docs/trakteer.svg`.
- Situs pemasaran terpisah berada di `lumilan-web/` (Next.js, dengan AGENTS.md sendiri). Situs itu bukan bagian dari otoritas desain aplikasi desktop.

Tidak ada, dan tidak boleh dikarang: testimoni, logo pelanggan atau organisasi, jumlah pengguna, angka unduhan, benchmark, liputan pers, audit keamanan, dan harga (aplikasi gratis dipakai di bawah lisensi proprietary-nya).

## Product Principles

1. Tidak ada yang keluar dari LAN kecuali pengguna mengaktifkannya. Privasi adalah keadaan bawaan, bukan pengaturan.
2. Tunjukkan keadaan yang jujur. Keterjangkauan, pengiriman, persetujuan, dan verifikasi dilaporkan apa adanya; aplikasi tidak pernah berpura-pura sebuah pesan diantrekan atau sebuah fitur didukung.
3. Perhatian milik pengguna. Membaca jendela, membisukan, Jangan Ganggu, sesi fokus, lock, dan suspend semuanya menahan notifikasi; Lumi menginterupsi hanya saat pengguna tidak sedang melihat.
4. Satu perilaku di tiga sistem operasi, dengan setiap fallback disebutkan, bukan disembunyikan.
5. Pola aplikasi pesan yang sudah akrab lebih dulu; Lumi menambah kehangatan tanpa menghalangi pekerjaan.

## Accessibility & Inclusion

Belum ada standar formal yang diadopsi. Persyaratan yang sudah ditetapkan: hormati reduced motion (animasi Lumi dan rehat berhenti), dukung tema terang dan gelap, jaga tata letak tetap bekerja pada lebar sempit (320 px adalah lantai smoke test), muat terjemahan Indonesia yang panjang, dan pertahankan jalur keyboard untuk halaman Lumi (tombol Kiri/Kanan, Escape).
