# Catatan Perubahan

[English](CHANGELOG.md)

## 1.2.0

Perubahan dari versi 1.1.0.

### Fitur baru

- **Percakapan belum dibaca tampil lebih dahulu.** Kontak aktif dengan pesan pribadi yang belum dibaca kini muncul di atas kontak yang pesannya sudah dibaca. Setiap kelompok tetap diurutkan berdasarkan nama sesuai bahasa yang dipilih. Setelah percakapan dibaca di jendela aplikasi yang aktif, kontaknya kembali ke urutan biasa. Pratinjau Lumi tidak menandai pesan sebagai dibaca.

### Perubahan

- Memigrasikan aplikasi, modul preload, tes, dan skrip Node ke **TypeScript dengan pemeriksaan strict**, menggunakan kontrak komunikasi bersama serta pemeriksaan tipe terpisah untuk desktop, renderer, dan preload.
- Memperbarui proses build dan packaging agar menggunakan hasil kompilasi baru beserta aset runtime. Source TypeScript aplikasi, skrip pengembangan, tes, dan source map dikecualikan dari paket rilis.

### Build dan validasi

- Memperbarui verifikasi paket untuk struktur hasil kompilasi, termasuk aset antarmuka wajib, modul runtime, preload sandbox yang mandiri, dan ikon aplikasi macOS.
- Memperluas validasi otomatis pada **Windows x64, macOS Intel dan Apple Silicon, serta Linux x64**, termasuk X11 dan Wayland. Workflow build mengulang pemeriksaan tipe, tes otomatis, tes transfer penuh 5 GB, dan smoke test aplikasi yang sudah dikemas sebanyak tiga kali.
- Menambahkan pemeriksaan regresi untuk urutan pesan belum dibaca, pembacaan percakapan, nama kontak yang sama, koneksi ulang, pencarian dan filter arsip, serta bahasa antarmuka yang didukung.
- Memperbaiki lingkungan tes Linux dengan font fallback CJK dan input Wayland terisolasi untuk pemeriksaan antarmuka serta fallback notifikasi.

### Catatan platform

- Lumi memakai overlay desktop pada Windows, macOS, dan Linux X11. Linux Wayland memakai notifikasi sistem.
- Paket saat ini belum ditandatangani. Windows atau macOS mungkin menampilkan peringatan penerbit; notifikasi sistem macOS memerlukan aplikasi bertanda tangan. Unduh paket dari [halaman Releases resmi](https://github.com/iyansanjaya/lumilan-chat/releases).
