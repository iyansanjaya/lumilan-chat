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

### Build macOS dan Linux tanpa perangkat sendiri

Setelah workflow tersedia di cabang `master` repo privat, buka tab **Actions** → **Build macOS and Linux** → **Run workflow**. Unduh paket dari bagian **Artifacts** pada run tersebut: `lumilan-chat-macos-x64` untuk **Mac Intel**, `lumilan-chat-macos-arm64` untuk **Mac Apple Silicon**, atau `lumilan-chat-linux-x64` untuk Linux x64. Masing-masing artefak macOS berisi DMG dan ZIP. Workflow memeriksa arsitektur binary di kedua paket sebelum mengunggahnya. Workflow menjalankan tes dan menyimpan paket di repo privat; tidak memerlukan `GH_TOKEN` dan tidak menerbitkannya ke repo rilis publik.

Paket Mac Intel tetap memerlukan macOS 13 (Ventura) atau lebih baru karena aplikasi memakai Electron 44. Secara bawaan workflow menghasilkan paket macOS tanpa tanda tangan. Untuk rilis publik, jalankan ulang workflow dengan opsi **Sign and notarize macOS packages** setelah semua secret Apple tersedia. Uji AppImage di lingkungan Linux sebelum menerbitkannya.

### Tanda tangan aplikasi macOS

Tanda tangan digital menghubungkan aplikasi dengan identitas penerbit dan menunjukkan bahwa paket belum diubah. Notarization adalah pemeriksaan terpisah oleh Apple, lalu tiketnya ditempelkan pada aplikasi. Untuk DMG/ZIP yang didistribusikan langsung dan agar notifikasi native Electron di macOS berfungsi, gunakan sertifikat **Developer ID Application** dari Apple Developer Program. Sertifikat **Developer ID Installer** hanya diperlukan bila nanti membuat paket PKG. GH_TOKEN untuk GitHub Releases bukan sertifikat penandatanganan.

Anda tidak perlu memiliki Mac sendiri untuk proses build: GitHub Actions memakai runner macOS Intel dan Apple Silicon. Yang tetap dibutuhkan adalah keanggotaan Apple Developer Program, sertifikat beserta private key dalam berkas `.p12`, dan kredensial notarization. Berkas `.cer` saja tidak cukup untuk menandatangani aplikasi.

1. Buat sertifikat **Developer ID Application** di [Apple Developer Certificates](https://developer.apple.com/help/account/certificates/create-developer-id-certificates). Simpan private key dengan aman dan ekspor sertifikat bersama key sebagai `.p12` dengan kata sandi. Cara termudah adalah memakai Keychain Access pada Mac yang dapat Anda akses sementara. Bila hanya ada Windows, CSR dan `.p12` juga dapat dibuat dengan OpenSSL; pastikan private key yang dipakai untuk CSR sama dengan yang dimasukkan ke `.p12`.
2. Pada repo sumber **privat** `iyansanjaya/lumilan`, buka **Settings > Secrets and variables > Actions > New repository secret**. Tambahkan `MAC_CSC_LINK` (isi base64 dari berkas `.p12`), `MAC_CSC_KEY_PASSWORD` (kata sandi `.p12`), `APPLE_ID` (email Apple Account), `APPLE_APP_SPECIFIC_PASSWORD` (buat di pengaturan Apple Account, bukan kata sandi utama), dan `APPLE_TEAM_ID` (lihat Membership details pada Apple Developer). Jangan menaruh kelimanya di repo rilis publik atau di source code.
3. Buka **Actions > Build macOS and Linux > Run workflow**, centang **Sign and notarize macOS packages**, lalu jalankan. Workflow akan gagal bila secret kosong, tanda tangan tidak valid, atau notarization tidak berhasil. Setelah sukses, unduh artefak Intel/Apple Silicon dan uji notifikasi di Mac masing-masing sebelum menerbitkan rilis.

Jika tidak memiliki Mac, Git Bash di Windows biasanya sudah menyertakan OpenSSL. Jalankan perintah berikut di folder aman **di luar repo**. `openssl req` akan meminta kata sandi untuk private key dan data CSR; setelah CSR diunggah ke Apple Developer dan sertifikat `.cer` diunduh, salin `.cer` tersebut ke folder yang sama. Nama berkas `.cer` pada contoh perlu disesuaikan dengan hasil unduhan Apple.

```bash
openssl req -new -newkey rsa:2048 -sha256 -keyout developer-id.key -out developer-id.certSigningRequest
openssl x509 -inform DER -in developer_id.cer -out developer-id.pem
openssl pkcs12 -export -inkey developer-id.key -in developer-id.pem -out developer-id.p12
```

Perintah pertama dijalankan sebelum langkah membuat sertifikat di portal Apple; dua perintah terakhir dijalankan setelah `.cer` diunduh. `openssl pkcs12` meminta kata sandi ekspor baru: nilai itulah yang dipakai untuk `MAC_CSC_KEY_PASSWORD`.

Di Windows, untuk menyalin isi `.p12` sebagai base64 ke clipboard tanpa mencetaknya di terminal, jalankan PowerShell dari folder berkas tersebut:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path -LiteralPath '.\developer-id.p12').Path)) | Set-Clipboard
```

Tempel hasilnya sebagai nilai `MAC_CSC_LINK`, lalu kosongkan clipboard. Simpan `.p12` dan private key di lokasi aman di luar repo. Tanda tangan Windows memakai sertifikat **Authenticode** yang berbeda. Untuk sertifikat publik baru, private key umumnya disimpan di token/HSM atau layanan signing sehingga tidak selalu tersedia sebagai berkas `.pfx`. Konfigurasinya mengikuti metode penyedia; `WIN_CSC_LINK` dan `WIN_CSC_KEY_PASSWORD` hanya berlaku bila penyedia memang memberikan berkas sertifikat yang dapat dipakai electron-builder. Periksa hasil build lewat PowerShell dengan `Get-AuthenticodeSignature 'dist\Lumilan Chat Setup <versi>.exe'`. Log `signing with signtool.exe` saja bukan bukti: status harus `Valid`. Lihat [persyaratan penyimpanan key CA/Browser Forum](https://cabforum.org/working-groups/code-signing/requirements/).

Rujukan: [electron-builder v26 code signing](https://www.electron.build/v26/docs/features/code-signing/), [notarization macOS](https://www.electron.build/v26/docs/notarization/), dan [persyaratan notifikasi Electron](https://www.electronjs.org/docs/latest/tutorial/notifications).

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

## Profil, notifikasi, dan ruang umum

Ikon **lonceng** menampilkan percakapan yang memiliki pesan belum dibaca; pilih salah satunya untuk membuka chat. Ikon **roda gigi** membuka pengaturan profil, tampilan, notifikasi, dan pembaruan. Di profil, Anda dapat mengganti nama, mengunggah foto, menulis keterangan singkat yang muncul di bawah nama, dan memilih status Aktif, Sibuk, Pergi, atau Jangan ganggu. Status Jangan ganggu mematikan notifikasi desktop, tetapi pesan tetap diterima dan ditandai belum dibaca.

Pesan dan file baru menampilkan notifikasi bawaan sistem ketika percakapannya tidak sedang terbuka di jendela aktif. Suara mengikuti pengaturan notifikasi sistem operasi; opsi **Tanpa suara** membuatnya senyap. Gunakan **Uji notifikasi sistem** di pengaturan setelah memasang aplikasi. Izinkan notifikasi Lumilan Chat pada pengaturan perangkat, serta periksa Focus Assist/Jangan Ganggu sistem bila uji tidak terlihat atau terdengar. Pratinjau isi pesan mati secara bawaan agar isinya tidak muncul di layar terkunci. Ketika jendela ditutup, Lumilan Chat tetap berjalan di tray jika pengaturan tersebut aktif dan tray tersedia. Keluar dari aplikasi menghentikan penerimaan pesan.

Daftar percakapan hanya menampilkan perangkat yang sedang terhubung. Percakapan pribadi lama tetap tersimpan secara lokal dan muncul kembali saat perangkat yang sama terhubung lagi. Ruang Umum berlaku untuk **sesi jaringan saat ini**: saat jaringan berubah atau aplikasi dimulai ulang, tampilannya dimulai kosong agar chat LAN lama tidak tercampur. Pesan lama masih tersimpan di data lokal aplikasi, tetapi tidak ditampilkan di Ruang Umum.

Pengiriman file tetap dibatasi **20 MB per file**. Transport saat ini memuat seluruh file ke memori dan mengirimnya ke setiap penerima satu per satu; menghapus batas tanpa mengubahnya menjadi transfer streaming dapat membebani memori dan memperlama pengiriman, terutama di Ruang Umum. Tidak ada server pusat, tetapi setiap perangkat penerima tetap menyimpan salinan file.

## Data dan keamanan

Identitas dibuat dari kunci Ed25519 yang disimpan pada perangkat. libp2p Noise mengautentikasi identitas perangkat dan mengenkripsi koneksi. Perangkat di LAN dapat langsung melihat profil dan mengirim pesan atau file tanpa persetujuan. Karena nama dipilih sendiri oleh pengguna, nama yang sama bukan bukti identitas orang. Gunakan pada jaringan yang Anda percayai; pengguna lain yang dapat menjangkau aplikasi di LAN juga dapat mengirim pesan atau file. Antarmuka Electron memakai aset lokal, sandbox, dan context isolation.

Riwayat, file, identitas, serta pengaturan disimpan di folder `lumilan` di dalam lokasi `userData` Electron pada setiap perangkat. Lokasi `userData` lama tetap digunakan setelah penggantian nama aplikasi agar data tetap terbaca. Cadangkan folder tersebut saat aplikasi sudah keluar. Jangan memakai salinan kunci identitas yang sama pada dua perangkat sekaligus. Jika data aplikasi dihapus, ID perangkat berubah dan riwayat kontak lokal dimulai ulang. Data lokal saat ini belum dienkripsi; gunakan enkripsi disk dan akun sistem operasi yang terlindungi jika diperlukan.

Pesan atau file untuk perangkat yang sedang offline tidak dikirim ulang nanti. Penemuan perangkat memakai mDNS di LAN IPv4 dan biasanya bekerja dalam satu subnet. Firewall atau pemisahan VLAN dapat menghalangi koneksi. Layanan notifikasi dan tray pada Linux bergantung pada desktop environment. Belum ada audit keamanan independen atau uji fisik lintas ketiga sistem operasi.
