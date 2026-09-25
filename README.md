# Lumilan Chat

Lumilan Chat adalah aplikasi pesan antarperangkat di jaringan lokal untuk Windows, macOS, dan Linux. Setiap perangkat terhubung langsung tanpa server pusat. Pesan dan file dikirim melalui koneksi terenkripsi ke perangkat yang ditemukan di LAN.

## Menjalankan aplikasi

Siapkan Node.js 22 atau lebih baru dan bun. Jalankan dari folder Lumilan Chat:

```sh
bun ci
bun start
```

Jika Lumilan Chat yang terpasang sudah berjalan, keluar dahulu melalui menu tray. Lumilan Chat hanya mengizinkan satu instance pada satu perangkat.

Pada penggunaan pertama, masukkan nama yang ingin ditampilkan. Lumilan Chat membuat identitas perangkat secara otomatis dan menyimpannya di komputer tersebut.

Untuk mulai berkirim pesan di jaringan yang sama:

1. Buka Lumilan Chat pada kedua perangkat dan isi nama pada penggunaan pertama.
2. Tunggu hingga nama perangkat lain muncul otomatis di daftar percakapan, lalu pilih untuk mengirim pesan atau file.

Tidak ada langkah pemasangan atau persetujuan. Ruang umum mengirim ke semua perangkat Lumilan Chat yang sedang aktif dan terjangkau di LAN. Perangkat dengan versi lama masih memakai alur pemasangan; perbarui kedua perangkat untuk memakai alur otomatis.

## Pembaruan aplikasi

Lumilan Chat yang **sudah dipasang** memeriksa pembaruan saat mulai berjalan dan setiap enam jam. Jika versi baru selesai diunduh, Lumilan Chat menawarkan **Nanti** atau **Mulai ulang dan pasang**. Aplikasi tidak memasang pembaruan tanpa pilihan tersebut. Pemeriksaan manual tersedia melalui ikon tray → **Periksa pembaruan**. Saat dijalankan dengan `bun start`, pemeriksaan otomatis tidak aktif.

Paket pembaruan diambil dari [GitHub Releases Lumilan Chat](https://github.com/iyansanjaya/lumilan-chat/releases). Aplikasi hanya akan menemukan versi yang **sudah diterbitkan**, bukan draft. Chat dan penemuan perangkat tetap berjalan langsung melalui LAN; internet hanya diperlukan untuk mengambil pembaruan aplikasi.

## Build ulang dan menerbitkan pembaruan

Jalankan proses build **di sistem operasi yang menjadi target**: Windows untuk installer Windows, macOS untuk DMG, dan Linux untuk AppImage. Dari folder Lumilan Chat:

```sh
bun ci
bun run test
bun run dist
```

Hasilnya berada di `dist/`. `bun run dist` hanya membangun paket lokal dan **tidak** mengunggahnya ke GitHub:

| Sistem | Berkas hasil |
| --- | --- |
| Windows | `Lumilan Chat Setup <versi>.exe` |
| macOS | `Lumilan Chat-<versi>.dmg` dan arsip ZIP untuk updater |
| Linux | `Lumilan Chat-<versi>.AppImage` |

Nama berkas mengikuti versi dan arsitektur yang dipilih oleh electron-builder; lihat isi folder `dist` setelah build. Jika hanya ingin menjalankan aplikasi dari folder hasil kemasan tanpa membuat installer, gunakan `bun run pack`.

**Saat merilis pembaruan**, naikkan nilai `version` di `package.json`, lalu sinkronkan lockfile sebelum build:

```sh
bun install --package-lock-only
bun ci
bun run test
bun run dist
```

Jika versi tidak dinaikkan, updater tidak akan mengenali paket sebagai pembaruan. Perubahan kode tidak otomatis memperbarui aplikasi yang sudah terpasang.

Sebelum menerbitkan, simpan kode sumber dan tag `v<versi>` di repo privat `iyansanjaya/lumilan`. Jalankan `bun run release` pada **masing-masing sistem operasi target** dengan `GH_TOKEN` yang memiliki izin **Contents: Read and write** untuk repo rilis publik `iyansanjaya/lumilan-chat`. Repo rilis publik digunakan untuk installer dan metadata pembaruan. Perintah itu mengunggah installer, arsip yang diperlukan updater, dan metadata seperti `latest.yml` ke **draft release**. Pastikan semua paket memiliki nomor versi yang sama, periksa isi draft, lalu terbitkan rilis di GitHub.

Jika menggunakan **Git Bash**, masukkan token di terminal yang sama sebelum menjalankan rilis:

```bash
read -rsp "GitHub token: " GH_TOKEN
printf '\n'
export GH_TOKEN
bun run release
unset GH_TOKEN
```

Token tidak ditampilkan saat diketik. Jangan memasukkan token ke kode, README, atau perintah yang tersimpan dalam riwayat shell. Repo rilis harus dapat diakses oleh pengguna aplikasi; repo privat memerlukan autentikasi pada setiap perangkat dan tidak cocok untuk distribusi ini.

Installer 0.3.0 ini adalah versi pertama yang memiliki updater. Versi 0.2.0 dan lebih lama tetap perlu diperbarui **sekali secara manual**. Setelah itu, pembaruan yang diterbitkan di GitHub dapat diunduh dan dipasang dari aplikasi. **Jangan hapus folder data aplikasi**: identitas, daftar perangkat yang pernah ditemukan, dan riwayat tersimpan terpisah dari berkas aplikasi.

Paket macOS harus ditandatangani agar pembaruan otomatis dan notifikasi sistem berfungsi. Installer Windows lokal saat ini belum ditandatangani; sebelum membagikan pembaruan ke banyak pengguna, tandatangani rilis Windows dengan sertifikat yang sama untuk setiap versi. Build macOS dan Linux perlu diuji pada sistem masing-masing sebelum dibagikan. Jangan menerbitkan rilis yang belum diuji hanya karena draft-nya sudah terbentuk.

## Notifikasi

Pesan dan file baru dari perangkat di LAN menampilkan notifikasi sistem ketika percakapannya tidak sedang terbuka di jendela aktif. Klik notifikasi untuk membuka percakapan. Jumlah pesan belum dibaca tetap terlihat di Lumilan Chat jika layanan notifikasi sistem tidak tersedia.

Ikon lonceng membuka pengaturan notifikasi, pratinjau isi pesan, suara, dan perilaku tray. Pratinjau isi pesan mati secara bawaan agar isinya tidak muncul di layar terkunci. Ketika jendela ditutup, Lumilan Chat tetap berjalan di tray jika pengaturan tersebut aktif dan tray tersedia. Keluar dari aplikasi menghentikan penerimaan pesan.

## Data dan keamanan

Identitas dibuat dari kunci Ed25519 yang disimpan pada perangkat. libp2p Noise mengautentikasi identitas perangkat dan mengenkripsi koneksi. Perangkat di LAN dapat langsung melihat profil dan mengirim pesan atau file tanpa persetujuan. Karena nama dipilih sendiri oleh pengguna, nama yang sama bukan bukti identitas orang. Gunakan pada jaringan yang Anda percayai; pengguna lain yang dapat menjangkau aplikasi di LAN juga dapat mengirim pesan atau file. Antarmuka Electron memakai aset lokal, sandbox, dan context isolation.

Riwayat, file, identitas, serta pengaturan disimpan di folder `lumilan` di dalam lokasi `userData` Electron pada setiap perangkat. Lokasi `userData` lama tetap digunakan setelah penggantian nama aplikasi agar data tetap terbaca. Cadangkan folder tersebut saat aplikasi sudah keluar. Jangan memakai salinan kunci identitas yang sama pada dua perangkat sekaligus. Jika data aplikasi dihapus, ID perangkat berubah dan riwayat kontak lokal dimulai ulang. Data lokal saat ini belum dienkripsi; gunakan enkripsi disk dan akun sistem operasi yang terlindungi jika diperlukan.

Pesan atau file untuk perangkat yang sedang offline tidak dikirim ulang nanti. Penemuan perangkat memakai mDNS di LAN IPv4 dan biasanya bekerja dalam satu subnet. Firewall atau pemisahan VLAN dapat menghalangi koneksi. Layanan notifikasi dan tray pada Linux bergantung pada desktop environment. Belum ada audit keamanan independen atau uji fisik lintas ketiga sistem operasi.
