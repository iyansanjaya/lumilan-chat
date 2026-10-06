<p align="center"><img src="build/icon.png" alt="Lumilan Chat" width="80" height="80"></p>

<h1 align="center">Lumilan Chat</h1>
<p align="center"><strong>Jaringan Anda. Percakapan Anda.</strong><br>Chat langsung, berbagi file, panggilan suara, dan pengingat untuk ruang kerja lokal.</p>
<p align="center"><a href="https://github.com/iyansanjaya/lumilan-chat/releases/latest"><strong>Unduh Lumilan Chat</strong></a> · <a href="https://github.com/iyansanjaya/lumilan-chat/issues">Laporkan masalah</a> · <a href="README.md">English</a></p>

![Windows](https://img.shields.io/badge/Windows-64--bit-0078D4) ![macOS](https://img.shields.io/badge/macOS-Intel%20%26%20Apple%20Silicon-333333) ![Linux](https://img.shields.io/badge/Linux-AppImage-FCC624?labelColor=333333) ![Jaringan lokal](https://img.shields.io/badge/Jaringan-LAN-FFD36D?labelColor=333333)

Lumilan menghubungkan perangkat secara langsung melalui LAN atau Wi-Fi yang sama. Tanpa akun, server chat pusat, atau relay internet. Buka aplikasi, pilih nama, lalu mulai percakapan.

![Lumilan Chat dalam tema terang — percakapan langsung pada jaringan demo terisolasi](build/screenshots/chat-light.png)

## Ruang kerja yang dekat dengan Anda

| Terhubung | Atur sesuai kebutuhan |
| --- | --- |
| **Pesan pribadi & Ruang berundangan** — berbicara langsung atau mengumpulkan tim. | **Catatan pribadi** — simpan pesan dan lampiran hanya di perangkat Anda. |
| **Berbagi file & paste gambar** — kirim setiap file hingga 5 GB ke klien yang kompatibel; tempel gambar yang disalin, periksa, lalu tekan Kirim. | **Pengingat** — jadwalkan tugas sendiri atau minta kontak aktif memilih dan menerima jadwal. |
| **Panggilan suara** — audio satu lawan satu melalui jaringan lokal. | **Lumi** — pemberitahuan ringkas di latar belakang, dengan fallback notifikasi sistem saat diperlukan. |

<details>
<summary><strong>Lihat tema gelap dan pengaturan</strong></summary>

![Lumilan Chat dalam tema gelap](build/screenshots/chat-dark.png)

![Profil dan pengaturan tampilan](build/screenshots/settings.png)

Screenshot memakai profil demo terisolasi dan perangkat uji lokal; tidak memuat percakapan pengguna.

</details>

## Unduh

> [!WARNING]
> **Paket saat ini belum ditandatangani.** Windows atau macOS mungkin menampilkan peringatan penerbit. Unduh hanya dari halaman Releases resmi. Pengelola tidak dapat memverifikasi salinan pihak lain dan tidak bertanggung jawab atas kerusakan, kehilangan data, atau risiko keamanan yang ditimbulkannya.

Ambil paket terbaru dari [halaman Releases resmi](https://github.com/iyansanjaya/lumilan-chat/releases/latest).

| Sistem | Pilih paket ini |
| --- | --- |
| Windows 64-bit | `Lumilan Chat Setup *.exe` |
| macOS 13+ Intel | DMG Intel / x64 |
| macOS 13+ Apple Silicon | DMG Apple Silicon / arm64 |
| Linux 64-bit | `*.AppImage` |

Fitur khusus platform bergantung pada paket terpasang dan desktop environment. Lumi diimplementasikan untuk Windows, macOS Intel/Apple Silicon, dan Linux X11; Linux Wayland memakai notifikasi sistem. Build yang sukses saja belum membuktikan kompatibilitas native seluruh fitur.

## Mulai dalam tiga langkah

1. **Buka Lumilan** pada perangkat yang terhubung ke LAN atau Wi-Fi yang sama.
2. **Pilih nama Anda.** Perangkat yang terhubung muncul di daftar pesan pribadi.
3. **Mulai percakapan.** Pilih orang, atau gunakan **Buat Ruang** untuk Ruang Percakapan berundangan maupun Ruang Pengumuman.

Ruang Pengumuman menyiarkan ke perangkat aktif yang mengizinkannya. Pesan pribadi, pesan Ruang, dan transfer file memerlukan penerima yang dapat dijangkau; pengiriman tidak diantrekan untuk penerima offline. Kontak Pengingat hanya tampil saat aktif dan mendukung fitur tersebut. Pengingat pribadi berjalan lokal; permintaan yang sudah dibuat mempertahankan status pengiriman atau keputusan jika koneksi terputus.

Pada pembukaan pertama, paket terpasang yang mendukung fitur ini mengaktifkan buka saat masuk ke komputer. Ubah di **Pengaturan → Saat komputer dinyalakan**. Agar tetap menerima pesan setelah jendela ditutup, aktifkan **Tetap berjalan di tray**; tray harus tersedia.

## Gambar, pemberitahuan, dan pembaruan

- **Seret file ke chat aktif untuk langsung mengirim.** Penanda drop menunjukkan tujuan; klik ikon penjepit kertas untuk memilih beberapa file (Ctrl-klik di Windows/Linux, Command-klik di macOS, atau Shift-klik untuk memilih rentang). Pilihan ditolak jika percakapan berganti saat pemilih terbuka. Hingga 8 file keluar dapat menunggu atau ditransfer sekaligus, masing-masing dengan persetujuan, progres, dan Batal. Catatan pribadi menyimpan file secara lokal. Folder, file kosong atau terlalu besar, dan pilihan yang melebihi slot tersedia ditolak sebelum file dalam pilihan tersebut mulai dikirim. Draf dan pratinjau gambar paste tetap tersimpan. Ruang Pengumuman, percakapan arsip, dan undangan yang belum diterima tidak menerima lampiran.
- **Penyimpanan lokal, tanpa kuota cloud.** Batas 5 GB berlaku untuk setiap file yang dikirim, bukan kapasitas penyimpanan Anda. Pesan dan file yang diterima tetap di perangkat Anda; kapasitas mengikuti ruang disk yang tersedia. Lumilan tidak menyediakan cloud storage.
- **Tetap mengobrol saat file menunggu persetujuan.** Hingga 8 file keluar memiliki progres dan tombol Batal masing-masing. File yang gagal tetap tersedia untuk Coba lagi atau Hapus. Penerimaan beberapa permintaan memerlukan aplikasi penerima yang diperbarui; klien lama dapat menolak file berikutnya hingga transfernya selesai.
- **Salin gambar, lalu paste ke kotak pesan.** Pratinjau muncul sebelum Anda menekan Kirim. Hapus dengan tombol ×. Gambar clipboard mendukung PNG/JPEG/WebP/GIF hingga 20 MB, total 40 juta piksel, dan 120 frame. Pengiriman mengikuti persetujuan dan pemeriksaan integritas file yang sudah ada; Ruang Pengumuman tidak menerima lampiran.
- **Menulis daftar:** Enter melanjutkan daftar bernomor atau berpoin; Enter pada item kosong mengakhirinya. Di luar daftar, Enter mengirim dan Shift + Enter membuat baris baru. Tombol Kirim dapat langsung mengirim daftar.
- **176 emoji lokal:** jelajahi pemilih yang dapat digulir dengan Tab atau tombol panah. Home/End memilih item pertama/terakhir; Enter menyisipkan emoji dan Escape menutup pemilih. Label mengikuti bahasa aplikasi.
- **Status sekilas:** titik berwarna dan lingkar avatar menunjukkan status dalam daftar pesan pribadi. Arahkan kursor ke baris pengguna atau fokuskan dengan keyboard untuk langsung melihat tooltip status; label status tetap tersedia bagi pembaca layar.
- **Gerak yang nyaman:** menu, dialog, bubble pesan, jumlah pesan belum dibaca, dan Lumi memakai animasi singkat dengan durasi terbatas. Pengurangan gerak mematikan animasi dan transisi antarmuka; antarmuka utama menjeda animasi CSS saat tersembunyi.
- **Pemberitahuan latar belakang:** Lumi yang aktif dan siap menggantikan banner sistem. Saat dimuat, dijeda, dinonaktifkan, atau tidak tersedia, aplikasi memakai notifikasi sistem. Mute dan Jangan ganggu mematikan pemberitahuan; layar terkunci dan suspend menundanya.
- **Keluar dengan aman:** Keluar dan Mulai ulang dan pasang membatalkan transfer yang belum selesai dan menunggu pembersihan file sementara serta penghentian jaringan. File yang sudah diterima tetap tersedia. Penghentian paksa atau shutdown OS dapat memutus cleanup; sisa file transfer dibersihkan saat aplikasi dibuka kembali.
- **Pembaruan:** buka **Pengaturan → Periksa pembaruan**. Installer Windows dan AppImage Linux dapat mengunduh pembaruan lalu menawarkan **Nanti** atau **Mulai ulang dan pasang**. macOS saat ini mengarahkan Anda memasang DMG secara manual, termasuk pada build bertanda tangan.

Jika **Uji notifikasi sistem** tidak terlihat, periksa izin notifikasi OS dan Jangan Ganggu. Sistem menerima notifikasi bukan jaminan banner tampil. Notifikasi sistem macOS memerlukan aplikasi bertanda tangan. Linux memerlukan `libnotify.so.4` (`libnotify4` pada Debian/Ubuntu) dan layanan notifikasi desktop. Jika Pengaturan menyatakan deteksi layar terkunci tidak tersedia, periksa `gdbus` dan layanan ScreenSaver desktop; pemberitahuan menunggu sampai keadaan lock dapat diverifikasi.

Linux memerlukan font fallback OS untuk teks Jepang, Tionghoa, dan Korea (CJK). Jika karakter tampil sebagai kotak, pasang font CJK; pada Debian/Ubuntu, jalankan `sudo apt-get install fonts-noto-cjk`.

## Privasi dan batasan jaringan

Koneksi memakai **libp2p Noise** untuk mengenkripsi lalu lintas dan mengautentikasi identitas perangkat. Nama profil dipilih sendiri dan tidak memverifikasi identitas orang. Riwayat, file, dan pengaturan lokal **belum terenkripsi**; gunakan jaringan tepercaya dan enkripsi disk sesuai kebutuhan.

Penemuan perangkat bergantung pada mDNS lokal, dan lalu lintas langsung harus diizinkan firewall serta aturan Wi-Fi/VLAN. Lumilan tidak memakai relay internet untuk melewati isolasi jaringan. Panggilan suara memerlukan izin mikrofon dan lalu lintas UDP lokal langsung.

## Bantu Lumilan berkembang

Dikembangkan oleh [Iyan Sanjaya](https://iyansanjaya.com/). Menemukan masalah? Gunakan **Laporkan bug** di header aplikasi atau [buka issue](https://github.com/iyansanjaya/lumilan-chat/issues).

[![Trakteer](https://raw.githubusercontent.com/iyansanjaya/lumilan-chat/refs/heads/master/build/trakteer.svg)](https://trakteer.id/iyansanjaya/tip) [![Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/iyansanjaya)

Dukungan dalam jumlah berapa pun membantu pengembangan Lumilan. Ikon **Dukung Aplikasi** menyediakan Trakteer untuk Indonesia dan Ko-fi untuk pendukung internasional.
