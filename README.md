# Lumilan Chat

Aplikasi chat antarperangkat untuk Windows, macOS, dan Linux. Temukan pengguna lain di jaringan lokal, kirim pesan pribadi atau ke Ruang Umum, dan bagikan file langsung antardevice tanpa akun atau server chat.

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
2. Isi nama Anda. Perangkat lain yang aktif akan muncul otomatis.
3. Pilih orang untuk chat pribadi atau buka **Ruang Umum** untuk mengirim pesan ke perangkat aktif pada sesi jaringan ini.

File dibatasi **20 MB per kiriman**. Antarmuka tersedia dalam Bahasa Indonesia, English, Bahasa Melayu, dan Español. Riwayat chat dan file disimpan di perangkat masing-masing. Perangkat yang sedang offline tidak menerima pesan yang dikirim saat mereka tidak terhubung.

## Privasi dan batasan jaringan

Koneksi langsung antarperangkat memakai **libp2p Noise** untuk mengenkripsi lalu lintas dan mengautentikasi identitas perangkat. Nama profil dipilih sendiri oleh pengguna; verifikasi identitas orang belum tersedia. Data yang tersimpan di perangkat **belum terenkripsi**. Gunakan jaringan yang Anda percayai dan aktifkan enkripsi disk jika diperlukan.

Penemuan perangkat otomatis memakai mDNS di LAN. Firewall, VLAN, atau VPN dapat menghalangi penemuan otomatis. Dukungan penemuan perangkat VPN lintas subnet belum tersedia.

## Pembaruan dan bantuan

Aplikasi yang telah dipasang dapat memeriksa pembaruan dari halaman Releases. Anda juga dapat memilih **Periksa pembaruan** dari Pengaturan. Fitur pembaruan pada macOS memerlukan paket yang ditandatangani.

Dikembangkan oleh [Iyan Sanjaya](https://iyansanjaya.com/).

Dukung pengembangan Lumilan Chat melalui [situs Iyan Sanjaya](https://iyansanjaya.com/).
