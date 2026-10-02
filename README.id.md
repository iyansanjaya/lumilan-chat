# Lumilan Chat

[English](README.md) · **Bahasa Indonesia**

Aplikasi chat antarperangkat untuk Windows, macOS, dan Linux. Temukan pengguna lain di jaringan lokal, kirim pesan pribadi, buat Ruang berundangan, dan kirim Pengumuman tanpa akun atau server chat.

[![Trakteer](https://raw.githubusercontent.com/iyansanjaya/lumilan-chat/refs/heads/master/build/trakteer.svg)](https://trakteer.id/iyansanjaya/tip) [![Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/iyansanjaya)

## Unduh

Ambil paket terbaru di [Releases](https://github.com/iyansanjaya/lumilan-chat/releases/latest):

> [!WARNING]
> **Paket belum ditandatangani — unduh hanya dari sumber resmi.** Paket saat ini belum memiliki tanda tangan digital, sehingga Windows atau macOS mungkin menampilkan peringatan penerbit. Unduh Lumilan Chat **hanya** dari [halaman Releases resmi](https://github.com/iyansanjaya/lumilan-chat/releases/latest). Jangan pasang salinan dari tautan lain. Pengelola tidak dapat memverifikasi salinan dari pihak lain dan tidak bertanggung jawab atas kerusakan, kehilangan data, atau risiko keamanan yang disebabkan olehnya.

| Sistem | Paket |
| --- | --- |
| Windows (64-bit) | `Lumilan Chat Setup *.exe` |
| macOS 13+ Intel | Pilih paket Intel (x64) pada keterangan rilis |
| macOS 13+ Apple Silicon | Pilih paket Apple Silicon (arm64) pada keterangan rilis |
| Linux (64-bit) | `*.AppImage` |

## Mulai menggunakan

1. Pasang dan buka Lumilan Chat pada perangkat yang terhubung ke LAN atau Wi-Fi yang sama.
2. Isi nama Anda. Semua perangkat lain yang terhubung akan muncul di daftar pesan pribadi.
3. Pilih orang untuk chat pribadi. Gunakan **Buat Ruang** untuk membuat Ruang Percakapan berundangan atau Ruang Pengumuman. Ruang Pengumuman Anda baru muncul setelah dibuat dan menyiarkan ke semua perangkat aktif yang mengizinkannya. Penerima melihatnya setelah mendapat pesan.

Pada pembukaan pertama, paket terpasang yang mendukung fitur ini mengaktifkan buka saat masuk ke komputer secara bawaan. Anda dapat mematikannya di **Pengaturan → Saat komputer dinyalakan**.

GIF yang dikirim bergerak dalam pratinjau chat lokal setelah file diterima. Unduh lampirannya untuk melihat file asli.

**Notch Lumi** menampilkan pesan, panggilan masuk, dan permintaan file di tepi atas layar saat Lumilan diminimalkan atau berjalan di tray. Pratinjau ringkasnya tersembunyi otomatis setelah beberapa detik; permintaan yang belum dijawab tetap tersedia. Anda dapat memindahkan, menjeda, atau mematikannya di **Pengaturan → Notifikasi**. Ketersediaannya mengikuti lingkungan desktop perangkat.

Untuk subnet lokal yang saling memiliki rute tetapi perangkatnya tidak muncul otomatis, buka **Hubungkan perangkat** pada perangkat tujuan, salin kode perangkatnya, lalu tempel pada perangkat lain. Keduanya harus dapat terhubung lewat TCP port **40754**. Kode memuat alamat IPv4 privat, port, dan ID perangkat yang diautentikasi. Aplikasi tidak memakai relay internet atau layanan chat global.

**Pengingat** tersedia di daftar sebelah kiri untuk diri sendiri atau permintaan ke kontak pribadi. Penerima memilih jadwal dan memberikan persetujuan. Pengingat berjalan selama Lumilan aktif, termasuk di tray; jadwal terlewat tetap terlihat saat aplikasi dibuka kembali. Kedua perangkat perlu versi terbaru untuk permintaan ke kontak.

## Privasi dan batasan jaringan

Koneksi langsung antarperangkat memakai **libp2p Noise** untuk mengenkripsi lalu lintas dan mengautentikasi identitas perangkat. Nama profil dipilih sendiri oleh pengguna; verifikasi identitas orang belum tersedia. Data yang tersimpan di perangkat **belum terenkripsi**. Gunakan jaringan yang Anda percayai dan aktifkan enkripsi disk jika diperlukan.

## Pembaruan dan bantuan

Aplikasi yang telah dipasang dapat memeriksa pembaruan dari halaman Releases melalui **Pengaturan → Periksa pembaruan**. Pada macOS, aplikasi saat ini memeriksa rilis dan mengarahkan Anda untuk mengunduh serta memasang DMG secara manual. Pemasangan otomatis macOS memerlukan paket bertanda tangan dan metadata pembaruan yang diterbitkan bersama rilis.

Jika **Uji notifikasi sistem** tidak terlihat, periksa izin notifikasi Lumilan Chat dan Jangan Ganggu di pengaturan Windows, macOS, atau desktop Linux. Hasil uji yang menyatakan sistem menerima notifikasi tidak menjamin pemberitahuan tampil di layar.

Dikembangkan oleh [Iyan Sanjaya](https://iyansanjaya.com/).

Ikon **Dukung Aplikasi** di header menyediakan dua pilihan: [Trakteer untuk Indonesia](https://trakteer.id/iyansanjaya/tip) dan [Ko-fi untuk pendukung internasional](https://ko-fi.com/iyansanjaya). Dukungan dalam jumlah berapa pun membantu pengembangan Lumilan Chat.

Untuk melaporkan masalah, gunakan ikon **Laporkan bug** di header atau buka [GitHub Issues](https://github.com/iyansanjaya/lumilan-chat/issues).
