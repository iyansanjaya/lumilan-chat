# Lumilan Chat

Aplikasi chat antarperangkat untuk Windows, macOS, dan Linux. Temukan pengguna lain di jaringan lokal, kirim pesan pribadi atau ke Ruang Umum, dan bagikan file lewat pesan pribadi tanpa akun atau server chat.

## Unduh

Ambil paket terbaru di [Releases](https://github.com/iyansanjaya/lumilan-chat/releases/latest):

| Sistem | Paket |
| --- | --- |
| Windows (64-bit) | `Lumilan Chat Setup *.exe` |
| macOS 13+ Intel | Pilih paket Intel (x64) pada keterangan rilis |
| macOS 13+ Apple Silicon | Pilih paket Apple Silicon (arm64) pada keterangan rilis |
| Linux (64-bit) | `*.AppImage` |

Paket saat ini dapat tersedia tanpa tanda tangan digital. Windows atau macOS mungkin menampilkan peringatan penerbit. Pastikan berkas berasal dari halaman Releases resmi di atas.

## Mulai menggunakan

1. Pasang dan buka Lumilan Chat pada perangkat yang terhubung ke LAN atau Wi-Fi yang sama.
2. Isi nama Anda. Semua perangkat lain yang terhubung akan muncul di daftar pesan pribadi.
3. Pilih orang untuk chat pribadi atau buka **Ruang Umum** untuk mengirim pesan ke perangkat aktif pada sesi jaringan ini.

File hanya dapat dikirim lewat pesan pribadi, dibatasi **100 MB per kiriman**, dan memerlukan persetujuan penerima. Kedua perangkat memerlukan ruang kosong yang cukup; transfer yang gagal tidak dilanjutkan otomatis. Jika penerima masih memakai versi lama, batasnya **20 MB**. Antarmuka tersedia dalam Bahasa Indonesia, English, Bahasa Melayu, dan Español. Riwayat chat dan file disimpan di perangkat masing-masing. Perangkat yang sedang offline tidak menerima pesan yang dikirim saat mereka tidak terhubung.

## Privasi dan batasan jaringan

Koneksi langsung antarperangkat memakai **libp2p Noise** untuk mengenkripsi lalu lintas dan mengautentikasi identitas perangkat. Nama profil dipilih sendiri oleh pengguna; verifikasi identitas orang belum tersedia. Data yang tersimpan di perangkat **belum terenkripsi**. Gunakan jaringan yang Anda percayai dan aktifkan enkripsi disk jika diperlukan.

Penemuan perangkat otomatis memakai mDNS di LAN. Firewall, VLAN, atau VPN dapat menghalangi penemuan otomatis. Dukungan penemuan perangkat VPN lintas subnet belum tersedia.

## Pembaruan dan bantuan

Aplikasi yang telah dipasang dapat memeriksa pembaruan dari halaman Releases melalui **Pengaturan → Periksa pembaruan**. Pada macOS, aplikasi saat ini memeriksa rilis dan mengarahkan Anda untuk mengunduh serta memasang DMG secara manual. Pemasangan otomatis macOS memerlukan paket bertanda tangan dan metadata pembaruan yang diterbitkan bersama rilis.

Jika **Uji notifikasi sistem** tidak terlihat, periksa izin notifikasi Lumilan Chat dan Jangan Ganggu di pengaturan Windows, macOS, atau desktop Linux. Hasil uji yang menyatakan sistem menerima notifikasi tidak menjamin pemberitahuan tampil di layar.

Dikembangkan oleh [Iyan Sanjaya](https://iyansanjaya.com/).

Ikon **Dukung Aplikasi** di header menjelaskan cara membantu pengembangan Lumilan Chat dalam jumlah berapa pun. Tautannya saat ini menuju [situs Iyan Sanjaya](https://iyansanjaya.com/); halaman donasi khusus belum tersedia.
