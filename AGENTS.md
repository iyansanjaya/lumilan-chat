# Aturan kerja Lumilan Chat

## Sumber utama dan sinkronisasi

- `iyansanjaya/lumilan` (privat) adalah sumber utama. Semua perubahan kode, workflow, skrip, dan dokumentasi dibuat serta diuji di repo privat.
- `iyansanjaya/lumilan-chat` (publik) menerima salinan berkas dari repo privat. Jangan membuat perubahan berbeda atau perbaikan langsung hanya di repo publik.
- Saat menyalin ke repo publik, kecualikan folder `public/` dan `graphify/`. Jangan menghapus kedua folder itu dari repo privat.
- Jangan menganggap build dari checkout repo publik lengkap: `main.js` dan antarmuka aplikasi membutuhkan `public/` dari repo privat.

## Build macOS dan Linux di GitHub

1. Push perubahan ke cabang `master` repo privat terlebih dahulu. Workflow memakai `ref: master` saat mengambil source privat.
2. Salin perubahan ke repo publik sesuai aturan di atas, termasuk `.github/workflows/build-macos-linux.yml` dan `scripts/verify-ui-package.cjs`, lalu push cabang `master` repo publik.
3. Jalankan **Actions → Build macOS and Linux → Run workflow** dari repo publik. Workflow mengambil source lengkap dari repo privat, menjalankan tes, membangun paket, memeriksa UI dalam `app.asar`, lalu mengunggah artefak. Opsi penandatanganan macOS tetap tidak dicentang sampai secret Apple tersedia.
4. Periksa hasil Mac Intel, Mac Apple Silicon, dan Linux sebelum mendistribusikan. Build lokal atau tes Windows tidak membuktikan DMG macOS berfungsi.

## Pengiriman file

- File hanya dikirim melalui pesan pribadi. Batasnya 100 MB (100 × 1024 × 1024 byte) untuk dua klien yang mendukung transfer bertahap; klien lama tetap memakai batas kompatibilitas 20 MB.
- Jangan memuat seluruh file 100 MB ke renderer, IPC, atau satu paket jaringan. Pertahankan persetujuan penerima, verifikasi SHA-256, pemeriksaan ruang disk, dan pembersihan file sementara saat transfer gagal atau dibatalkan.
- Saat mengubah alur file, uji ukuran tepat 100 MB dan di atas batas, penolakan, pembatalan, kerusakan data, transfer terputus, serta kompatibilitas klien lama. Jalankan tes dan periksa isi paket sebelum distribusi.

## Akses repo privat dari workflow publik

- Secret `PRIVATE_SOURCE_TOKEN` harus dibuat pada **repo publik**: **Settings → Secrets and variables → Actions → New repository secret**. Jangan menaruh nilainya di repo privat, kode, file `.env`, log, atau chat.
- Buat fine-grained personal access token GitHub dari **Settings akun → Developer settings → Personal access tokens → Fine-grained tokens**. Pilih pemilik `iyansanjaya`, **Only select repositories: `iyansanjaya/lumilan`**, dan izin **Contents: Read-only**. Token yang kedaluwarsa harus diganti pada secret publik.
- `PRIVATE_SOURCE_TOKEN` hanya untuk checkout source privat. `GH_TOKEN` untuk mengunggah GitHub Release adalah kredensial dan proses terpisah; `GITHUB_TOKEN` bawaan repo publik tidak memberi akses ke repo privat.
- Batasi akses tulis ke workflow repo publik. Siapa pun yang dapat mengubah workflow berpotensi menyalahgunakan secret untuk membaca source privat. Cabut token segera jika diduga bocor.

Lihat [README.md](README.md#build-macos-dan-linux-tanpa-perangkat-sendiri) untuk langkah pengguna yang lengkap.
