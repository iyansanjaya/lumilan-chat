# Catatan Perubahan

[English](CHANGELOG.md)

## 1.2.1

Perubahan dari versi 1.2.0.

### Perbaikan

- **Kegagalan Lumi tidak lagi mengganggu.** Jika overlay Lumi crash atau gagal dimuat saat ada panggilan atau permintaan file yang menunggu, jendela utama tidak lagi terbuka dan mengambil fokus selama Jangan ganggu, layar terkunci, suspend, Lumi disembunyikan 30 menit, atau notifikasi dimatikan. Permintaan terbaru yang menunggu (panggilan lebih dahulu daripada file) diserahkan ke jendela utama satu kali, pada saat pertama Lumi boleh menyela, dan percakapannya dibuka agar Anda dapat menerima atau menolaknya di sana. Jika jendela utama sudah terbuka, jendela itu tidak ditampilkan ulang. Satu kegagalan pemuatan juga tidak lagi diproses dua kali.
- **Filter percakapan muat di jendela sempit.** Filter Semua, Pribadi, Ruang, dan Arsip di sidebar kini tersusun dalam dua baris dengan padding yang cukup, sehingga teks tidak lagi menempel ke tepi tombol saat jendela dikecilkan. Pada tata letak satu panel yang sempit, filter tetap satu baris jika muat. Terjemahan yang panjang dipendekkan dengan elipsis alih-alih meluber.

### Perubahan

- Menambahkan **lisensi proprietary** dalam bahasa Inggris dan Indonesia ([LICENSE](LICENSE), [LICENSE.id.md](LICENSE.id.md)). Build resmi tetap gratis digunakan; menyalin, mengubah, mendistribusikan ulang, atau merekayasa balik Lumilan Chat memerlukan izin tertulis. Source code di repo publik dibagikan hanya sebagai referensi. Komponen pihak ketiga tetap mengikuti lisensinya masing-masing.
- Menata ulang source code ke folder `src/` dan `tests/`. Paket rilis berisi berkas yang sama, kecuali jalur internalnya.
- Berkas teks kini memakai akhir baris LF di semua sistem operasi.

### Build dan validasi

- Menambahkan tes untuk penyerahan permintaan saat Lumi gagal pada setiap kondisi blokir (Jangan ganggu, lock dan suspend dalam kedua urutan, Lumi disembunyikan, notifikasi dimatikan) serta untuk permintaan yang sudah dijawab, dibisukan, dan kedaluwarsa, ditambah tes regresi bahwa setiap keputusan file hanya dipakai sekali di jendela utama, Lumi, dan saat permintaan kedaluwarsa.
- Smoke test Lumi pada paket aplikasi kini membuat renderer Lumi yang sebenarnya crash saat layar terkunci. Proses renderer diakhiri dengan cara yang sama di Windows, macOS, dan Linux.
- Saat smoke test Linux gagal di CI, log kini menyebut langkah dan baris yang gagal serta memberi label pada setiap log.

### Catatan platform

- Lumi memakai overlay desktop pada Windows, macOS, dan Linux X11. Linux Wayland memakai notifikasi sistem.
- Paket saat ini belum ditandatangani. Windows atau macOS mungkin menampilkan peringatan penerbit; notifikasi sistem macOS memerlukan aplikasi bertanda tangan. Unduh paket dari [halaman Releases resmi](https://github.com/iyansanjaya/lumilan-chat/releases).

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
