# Catatan Perubahan

[English](CHANGELOG.md)

## 1.4.1

Perubahan dari versi 1.4.0.

### Fitur baru

- **Paket stiker.** Impor stiker sendiri di **Pengaturan → Paket stiker**: isi nama paket, lalu pilih atau jatuhkan hingga 100 gambar PNG, JPEG, WebP, atau GIF bergerak (masing-masing hingga 20 MB). Lumilan mengubahnya menjadi stiker WebP maksimal 512 px dan menyimpannya hanya di perangkat ini; file asli tidak diubah. Mengimpor dengan nama paket yang sudah ada menambah paket tersebut, gambar yang sama tidak disimpan dua kali, dan gambar yang tidak didukung dilewati.
- **Pemilih stiker.** Tombol stiker di samping tombol emoji membuka pemilih dengan tab **Terkini** dan satu tab per paket. Klik stiker untuk langsung mengirimnya, termasuk sebagai balasan. Tombol panah, Home/End, Enter, dan Escape bekerja seperti pada pemilih emoji; klik kanan stiker atau tekan Delete untuk menghapusnya dari perangkat ini.
- **Stiker tampil tanpa Terima.** Stiker tersedia di pesan pribadi, Ruang Percakapan, dan Catatan pribadi. Penerima tidak perlu memilih **Terima** seperti pada file: perangkat penerima hanya menerima gambar WebP hingga 500 KB dan 512 px, men-decode lalu meng-encode ulang setiap gambar sebelum menyimpannya, dan menerima paling banyak 30 stiker per pengirim per menit.
- **Simpan stiker yang diterima.** Pilih stiker di percakapan lalu **Simpan stiker** untuk menambahkannya ke paket **Tersimpan**.
- **Esc menutup percakapan yang terbuka.** Seperti di WhatsApp atau Telegram, Esc kembali ke beranda dan menyimpan draf untuk nanti. Esc lebih dulu menutup yang ada di atasnya: dialog, pemilih emoji, menu, pilihan pesan, atau balasan yang sedang ditulis. Pada jendela sempit, Esc kembali ke daftar percakapan.

### Perubahan

- **Lumi rata dengan menu bar macOS.** Di setiap layar Mac, bukan hanya Mac dengan notch kamera, Lumi kini menggantung dari tepi atas layar di atas bagian tengah menu bar, dan pill idle setinggi menu bar. Tanpa menu bar yang terlihat, serta di Windows dan Linux, pill tetap setinggi 30 pt. Sudut bawahnya kini sama dengan bahu lengkungnya.
- Notifikasi dan Lumi menampilkan **Stiker** untuk stiker yang diterima, atau **Pesan baru diterima** saat pratinjau isi pesan mati. Balasan, pesan yang disalin, pengingat, dan kotak pesan belum dibaca juga menampilkan **Stiker**, bukan nama file.
- Stiker tidak dihitung atau didaftarkan sebagai file bersama di panel detail percakapan.

### Build dan validasi

- Pustaka stiker dan gambar stiker punya modul tersendiri tanpa Electron, dengan tes untuk batas impor, duplikat, data tersimpan yang rusak, pemulihan setelah impor terputus, penghapusan paket dan stiker, serta penyimpanan dari percakapan.
- Tes jaringan dengan perangkat loopback mencakup stiker di pesan pribadi dan Ruang, anggota Ruang dengan versi lama, Catatan pribadi, Ruang Pengumuman, gambar tidak valid dan terlalu besar, paket berulang, batas per pengirim, versi Ruang yang usang, serta penghapusan file stiker bersama pesannya.
- Smoke UI paket mengimpor paket, mengirim dari pemilih di Catatan pribadi dan ke kontak loopback, menerima stiker bergerak tanpa langkah persetujuan, memeriksa frame diam saat pengurangan gerak aktif, menyimpan stiker yang diterima, dan menghapus paket, pada tema terang dan gelap di lebar 1100, 375, dan 320 px. Smoke ini juga memeriksa perilaku Esc yang baru.
- Area jatuhkan file di **Pengaturan → Rak** dan **Pengaturan → Paket stiker** kini memakai satu implementasi yang sama.

### Catatan platform

- Stiker memakai pustaka gambar yang sudah dibundel untuk Windows, macOS, dan Linux; tidak ada dependensi native baru.
- Stiker lulus smoke paket di Windows. Saat catatan ini ditulis, paket macOS (Intel dan Apple Silicon) serta Linux (X11 dan Wayland) belum diuji dengan stiker.
- Posisi Lumi di Mac bergantung pada tinggi menu bar karena Electron tidak melaporkan notch kamera. Dengan menu bar yang disembunyikan otomatis, pill idle 120 pt dapat berada di dalam notch.
- Lumilan Chat versi lama tidak menampilkan tombol stiker dan tidak menerima stiker. Jika versi lama membuka riwayat yang berisi stiker, setiap stiker tampil sebagai file `sticker.webp`.
- Paket saat ini belum ditandatangani. Windows atau macOS mungkin menampilkan peringatan penerbit; notifikasi sistem macOS memerlukan aplikasi bertanda tangan. Unduh paket dari [halaman Releases resmi](https://github.com/iyansanjaya/lumilan-chat/releases).

## 1.4.0

Perubahan dari versi 1.3.0.

### Fitur baru

- **Rehat kerja.** Pilih lama kerja dan istirahat di halaman **Rehat** Lumi atau **Pengaturan → Rehat kerja** (nonaktif secara bawaan). Saat waktunya tiba, Lumi mengingatkan, lalu setiap layar diredupkan dengan hitung mundur dan **Lanjut kerja**. Tunda, lewati, atau akhiri rehat lebih awal; rehat menunggu saat Jangan ganggu, sesi fokus, panggilan, layar terkunci, dan tidur.
- **Buka Lumi saat kursor diarahkan.** Pilih **Pengaturan → Lumi → Buka panel Lumi → Saat kursor diarahkan** agar panel terbuka saat kursor berhenti di atas pill.

### Perubahan

- **Lumi punya bagian sendiri di Pengaturan.** Menampilkan Lumi, membuatnya tetap tampil saat Anda memakai jendela, dan cara panel dibuka kini ada di **Pengaturan → Lumi**.
- **Lumi lebih lembut.** Badan lebih bulat, mata besar berkilau, pipi merah muda, dan kaki keemasan. Animasi dan pose tidak berubah.
- **Lumi lebih mudah ditemukan.** Mengarahkan kursor ke pill menampilkan petunjuk **Buka** dan kartu terbaru, perkenalan muncul sekali saat pertama kali, dan halaman **Fokus** punya tombol **Aktifkan**.
- **Warna emas Lumi di seluruh aplikasi.** Tombol, percakapan terpilih, mention, bilah progres, sakelar, dan tab memakai emas Lumi, dan semua dropdown memakai satu gaya yang sama.
- **Satu status jaringan.** Bagian bawah sidebar menampilkan **Jaringan lokal terenkripsi** setelah perangkat lain online dan **Mencari perangkat…** sebelum itu.

### Perbaikan

- Klik ganda pada tab atau tombol tidak lagi menyorot teks labelnya.
- Pilihan panjang di dropdown tidak lagi menabrak panah.
- Panel Lumi tidak lagi terpotong di sisi jendela saat memantul terbuka.

### Build dan validasi

- Penerimaan file dipindahkan ke modul tersendiri yang teruji; tes transfer penuh 5 GB tetap lulus. Perilaku tidak berubah.
- Aturan rehat dan layar rehat punya modul tersendiri yang teruji, dan panggilan dari jendela ke inti aplikasi kini diperiksa tipenya.

### Catatan platform

- Di Linux Wayland, layar rehat berupa satu jendela gelap pekat di satu layar dan Lumi memakai notifikasi sistem; Rehat kerja ada di **Pengaturan**. Game dalam mode layar penuh eksklusif dapat tetap berada di atas layar rehat.
- Belum dicek di perangkat fisik: rehat saat lock dan tidur sungguhan, Space layar penuh macOS, dan layar Windows dengan skala berbeda.
- Di macOS, unduh dan pasang pembaruan dari halaman Releases; aplikasi memberi tahu saat versi baru tersedia.
- Paket belum ditandatangani; Windows atau macOS mungkin menampilkan peringatan penerbit. Notifikasi sistem macOS memerlukan aplikasi bertanda tangan.

## 1.3.0

Perubahan dari versi 1.2.2.

### Fitur baru

- **Pratinjau tautan untuk YouTube, Shorts, dan Instagram.** Tautan di pesan kini tampil sebagai kartu statis berisi judul, kanal atau akun, thumbnail kecil, dan tombol **Buka di browser**. Kartu muncul di komposer sebelum pesan dikirim dan di percakapan pada kedua sisi. Tidak ada pemutar tertanam atau skrip pihak ketiga.
- **Kartu tautan untuk Facebook, Threads, dan X.** Tautan ini mendapat kartu yang dibuat di perangkat Anda dari alamatnya saja, tanpa menghubungi platform.
- **Lumi terbuka menjadi beberapa halaman.** Klik pill untuk membuka halaman **Aktivitas**, **Fokus**, **Rutinitas**, **Tugas**, dan **Rak** di panel yang melebar ke samping notch, dengan tab halaman, tombol Kiri/Kanan, dan usapan horizontal; menggeser dan menyembunyikan Lumi ada di bilah dan menu **⋯**-nya. Pill idle kini menampilkan mata Lumi, jam, dan hitungan aktivitas yang menunggu.
- **Rutinitas minum.** Catat minum dari Lumi atau **Pengaturan → Rutinitas**, lihat jumlah hari ini terhadap target dengan grafik per jam, dan aktifkan pengingat untuk jam aktif Anda. Pengingat ditunda saat Jangan ganggu, layar terkunci, dan tidur, muncul sekali sesudahnya, dan berhenti saat target tercapai.
- **Tugas.** Tambah, centang, dan hapus tugas dari Lumi atau **Pengaturan → Tugas**. Jatuh tempo yang diatur di Pengaturan membuat Pengingat lokal yang dibatalkan saat tugas selesai atau dihapus.
- **Rak file.** Jatuhkan hingga 10 file ke Lumi atau ke **Pengaturan → Rak** agar tetap dekat. Buka, seret keluar ke aplikasi lain, kirim ke kontak online dengan persetujuan dan verifikasi seperti biasa, atau simpan ke Catatan pribadi. Rak hanya menyimpan lokasi setiap file dan tidak pernah menghapus file.
- **Kabar perangkat.** Lumi menampilkan kabar singkat saat pengisi daya dicolok atau dicabut (dengan persentase baterai bila tersedia), saat jaringan terputus atau kembali, dan saat perangkat Lumilan mulai online.
- **Sesi fokus.** Mulai sesi 25, 45, atau 60 menit dari halaman Fokus di Lumi atau **Pengaturan → Fokus** (nonaktif secara bawaan). Status Anda menjadi Jangan ganggu bagi kontak yang terhubung dan kembali ke status sebelumnya saat selesai. Pill idle Lumi menampilkan sisa menit, panelnya memiliki hitung mundur dengan Jeda/Lanjut dan Selesai, dan satu ringkasan pesan belum dibaca serta percakapan muncul saat sesi selesai, tanpa nama, isi pesan, atau menandai apa pun dibaca. Sesi bertahan setelah restart, layar terkunci, dan tidur komputer.
- **Pengambilan bersifat opt-in.** Tautan YouTube atau Instagram pertama menanyakan apakah judul dan gambar boleh diambil dari host tersebut: pilih **Aktifkan** atau **Jangan**, lalu ubah kapan saja di **Pengaturan → Pratinjau tautan**. Hanya perangkat pengirim yang menghubungi YouTube atau Instagram; penerima menerima kartu melalui LAN dan tidak pernah terhubung ke internet. Pratinjau Instagram hanya bekerja selama Instagram menyediakan detail postingan tanpa login; jika tidak, kartu kembali menjadi kartu tautan.

### Perubahan

- Tautan di pesan kini dapat dibuka, hanya melalui tombol **Buka di browser** pada kartu. Alamat diperiksa ulang sebelum browser bawaan membukanya.
- **Pill Lumi tetap tampil.** Secara bawaan pill tetap ada saat Anda memakai jendela utama; pesan masuk di atas jendela yang dilihat hanya menambah hitungannya. **Pengaturan → Notifikasi → Pil Lumi saat jendela dilihat** (atau tray) mengembalikan perilaku sebelumnya. Panel yang Anda buka sendiri kini tetap terbuka selama kursor di atasnya dan menutup sesaat setelah kursor keluar; mengetik di dalamnya menahan panel sampai Anda mengklik di tempat lain atau menekan Escape.
- **Lumi kini berupa Dynamic Island.** Pendamping tampil sebagai pill hitam yang menggantung dari tepi atas layar, tersambung ke tepi oleh lengkungan bahu seperti notch perangkat keras. Pill berubah bentuk dengan halus menjadi pratinjau ringkas dan panel detail tanpa mengubah ukuran jendela, dan klik di luar island diteruskan ke jendela di bawahnya. Pada Mac dengan notch kamera, pill idle menutupi notch dan panel terbuka di atas menu bar; layar lain menaruhnya di bawah menu bar. Animasi tetap berhenti saat Lumi tersembunyi dan mengikuti pengurangan gerakan.

### Perbaikan

- Saat salinan Lumilan Chat tidak dapat memperbarui dirinya sendiri (folder hasil unpack, atau AppImage yang dijalankan di luar AppImage), **Periksa pembaruan** kini menjelaskannya dan mengarahkan ke halaman rilis, bukan meminta Anda mencoba lagi nanti.

### Build dan validasi

- Menambahkan tes untuk deteksi tautan dan alamat kanonik, host tiruan, redirect yang ditolak, batas ukuran dan waktu, parsing Open Graph, encode ulang thumbnail, validasi kartu yang diterima (kartu harus menjelaskan tautan pertama di pesan), kartu yang terikat percakapan, dan alur komposer. Tes loopback tiga perangkat memastikan penerima men-decode ulang thumbnail, membatasinya per pengirim, dan menghapusnya bersama pesan.
- Smoke test paket aplikasi kini mencakup Tanya dulu, Aktifkan dan Jangan, kartu Shorts dan Instagram dari fixture di dalam proses tanpa akses internet, kartu lokal Threads, X, dan Facebook, kartu yang diterima, Buka di browser, thumbnail yang tetap di tempat saat pesan baru masuk, serta tata letak terang/gelap pada jendela sempit.
- Tes Lumi mencakup jendela berukuran tetap, klik tembus di samping panel yang terbuka, bentuk jendela Linux X11, dan penempatan notch macOS. Smoke test paket aplikasi menunggu perubahan bentuk selesai, lalu memeriksa pill idle, ukuran ringkas, isi panel yang tidak terpotong, dan memastikan jendela native tidak pernah berubah ukuran.
- Sesi fokus memiliki modul tersendiri tanpa Electron dengan tes untuk mulai, jeda, selesai lebih awal, restart, kegagalan penyimpanan, pemulihan status, jumlah ringkasan, dan kedua urutan lock/tidur. Smoke test paket aplikasi memulai sesi dari tombol Lumi melalui koneksi LAN nyata, memeriksa pill idle, mengakhirinya saat lock dan tidur, serta memeriksa kontrol Pengaturan pada tema terang/gelap dan jendela sempit.
- Pengingat minum, tugas, dan rak memiliki modul tanpa Electron dengan tes untuk data tersimpan yang rusak, waktu pengingat lintas hari dan tengah malam, restart, slot terlewat, kegagalan penyimpanan, tautan pengingat, batas rak, path yang tidak pernah masuk tampilan, progres, dan pembatalan. Tes Lumi mencakup pill yang selalu tampil, pesan masuk yang hanya menambah hitungan di atas jendela yang dilihat, penutupan saat kursor keluar dan penahanan saat mengetik, kabar perangkat, serta validasi aksi halaman dan drop. Smoke test paket aplikasi memeriksa deck, jam dan kedip pill, pengingat minum setelah resume, tugas sambil mengetik, serta file nyata yang dijatuhkan ke rak dengan buka, drag keluar native, kirim yang disetujui, pembatalan, dan simpan ke catatan. Upload file dari percakapan dan dari rak kini berbagi satu jalur kode dengan batas 8 transfer yang sama.
- Aturan notifikasi, perhatian, dan pengaturan dipindahkan dari berkas utama proses utama ke modul tersendiri yang diuji tanpa Electron. Tes baru mencakup urutan lock → suspend → resume → unlock dan kebalikannya: pesan dan pengingat yang tertunda muncul sekali, hanya jika masih belum dibaca atau masih menunggu. Perilaku tidak berubah.

### Catatan platform

- **Buka di browser** memakai browser bawaan di Windows, macOS, dan Linux (`xdg-open`). Pengambilan memakai network stack Chromium dan mengikuti pengaturan proxy sistem operasi.
- Lumi memakai overlay desktop pada Windows, macOS, dan Linux X11. Linux X11 membatasi area input dan gambar jendela pada island. Penempatan notch macOS memakai tinggi menu bar karena Electron tidak melaporkan notch; dengan menu bar yang disembunyikan otomatis island tetap di bawah notch. Perilaku di atas notch fisik, di samping item menu bar, dan di atas Space layar penuh masih perlu diperiksa pada Mac bernotch. Linux Wayland memakai notifikasi sistem.
- Rutinitas, Tugas, dan Rak punya rumah di **Pengaturan** pada semua sistem, termasuk saat Lumi dimatikan atau Linux Wayland memakai notifikasi sistem. Halaman, pill yang selalu tampil, dan rak sudah diverifikasi di Windows dengan drop file simulasi; drag nyata dari Explorer ke pill idle masih perlu dicek manual. Di macOS pill idle meneruskan klik sehingga mungkin tidak menerima file yang diseret, jadi jatuhkan ke panel yang terbuka atau gunakan **Pengaturan → Rak**. Fitur ini lulus smoke paket di Windows serta di runner GitHub hosted untuk macOS (Intel dan Apple Silicon) dan Linux X11; Mac dan desktop Linux fisik masih perlu dicek. Electron tidak dapat mengetahui kapan aplikasi lain berada dalam layar penuh, sehingga pill tetap di atas aplikasi layar penuh; gunakan **Sembunyikan 30 menit** atau pengaturan "hanya saat jendela tidak dilihat".
- Sesi fokus dapat dimulai dari **Pengaturan → Fokus** di semua sistem, termasuk saat Lumi dimatikan atau Linux Wayland memakai notifikasi sistem. Fitur ini lulus smoke paket di Windows serta di runner GitHub hosted untuk macOS dan Linux, dengan lock dan tidur disimulasikan; perangkat fisik masih perlu dicek.
- Paket saat ini belum ditandatangani. Windows atau macOS mungkin menampilkan peringatan penerbit; notifikasi sistem macOS memerlukan aplikasi bertanda tangan. Unduh paket dari [halaman Releases resmi](https://github.com/iyansanjaya/lumilan-chat/releases).

## 1.2.2

Perubahan dari versi 1.2.1.

### Fitur baru

- **Notifikasi mengikuti apakah Anda benar-benar sedang melihat Lumilan.** Lumi (atau notifikasi sistem jika Lumi tidak tersedia) kini muncul setiap kali jendela utama tidak sedang dilihat: saat diminimalkan, ditutup ke tray, tertutup jendela lain, atau fokus tetapi tidak disentuh selama 3 menit. Sebelumnya, jendela yang tetap terbuka di belakang jendela lain tidak memunculkan Lumi, dan jendela fokus yang ditinggalkan menandai pesan baru di percakapan yang terbuka sebagai dibaca tanpa notifikasi apa pun.
- **Pesan yang datang saat Anda tidak di depan layar tetap belum dibaca.** Pada jendela yang ditinggalkan, pesan baru baru ditandai dibaca setelah Anda kembali: berpindah lagi ke jendela, atau mengklik, mengetik, menggulir, maupun menyentuhnya. Menggerakkan pointer saja tidak dihitung. Jika sistem operasi tidak melaporkan waktu idle input, aplikasi hanya memakai status fokus jendela.
- **Penanda yang bertahan di Windows dan macOS.** Di Windows, tombol taskbar berkedip sampai Anda kembali ke jendela dan menampilkan titik merah selama ada pesan belum dibaca. Di macOS, ikon Dock memantul sekali. Kedipan dan pantulan mengikuti aturan notifikasi, mute, Jangan ganggu, dan layar terkunci yang sama dengan Lumi; seperti judul jendela, titik merah mencerminkan jumlah pesan belum dibaca. Linux hanya memakai Lumi dan notifikasi sistem, karena sebagian desktop mengubah peringatan taskbar menjadi notifikasi kedua.

### Perbaikan

- **Percakapan tidak lagi melompat naik-turun saat file diterima.** Di perangkat penerima, setiap kenaikan progres membangun ulang seluruh daftar pesan dan memuat ulang pratinjau gambar, sehingga percakapan melompat sampai file selesai. Progres kini diperbarui di tempat, thumbnail yang sudah tampil dipertahankan, dan file yang diterima di percakapan lain tidak lagi menggambar ulang percakapan yang sedang terbuka.

### Perubahan

- Di atas jendela utama yang hanya tertutup jendela lain, Lumi menampilkan pesan masuk tanpa mengambil fokus dan tidak meninggalkan strip idle; strip tetap muncul selama jendela utama diminimalkan atau ditutup ke tray. Renderer Lumi kini mulai saat jendela utama pertama kali tidak sedang dilihat.
- Jika Lumi gagal saat ada panggilan atau permintaan file yang menunggu, permintaan itu juga diserahkan ke jendela utama yang terbuka tetapi tidak sedang dilihat, alih-alih dibiarkan di sana tanpa terlihat.

### Build dan validasi

- Verifikasi paket kini menelusuri entri utama paket, skrip halaman, dan preload melalui impornya. Setiap modul yang dapat dimuat aplikasi wajib ada di paket dan setiap berkas hasil kompilasi dalam paket wajib identik byte demi byte, sehingga modul runtime baru cukup ditambahkan ke `build.files`.
- Menambahkan tes untuk deteksi perhatian (termasuk sumber idle yang tidak valid dan batas 3 menit), Lumi di atas jendela yang tertutup jendela lain, penandaan dibaca setelah kehadiran dikonfirmasi, bridge kehadiran di preload, progres penerimaan tanpa membangun ulang percakapan, dan verifikasi paket yang diturunkan dari impor.
- Smoke test paket kini mencakup Lumi di belakang jendela lain tanpa mencuri fokus, pesan belum dibaca pada jendela yang ditinggalkan, penanda taskbar dan Dock, serta penerimaan file 24 MB tanpa pergeseran tata letak atau thumbnail yang dimuat ulang. Smoke test kini mengatur waktu idle secara eksplisit dan memastikan fokus jendela sebelum langkah membaca, sehingga desktop yang ditinggalkan atau layar CI tidak lagi mengubah hasilnya.

### Catatan platform

- Lumi memakai overlay desktop pada Windows, macOS, dan Linux X11. Linux Wayland memakai notifikasi sistem. Jika sistem operasi tidak melaporkan waktu idle input, yang mungkin terjadi pada sebagian desktop Wayland, jendela yang fokus dianggap sedang dilihat.
- Paket saat ini belum ditandatangani. Windows atau macOS mungkin menampilkan peringatan penerbit; notifikasi sistem macOS memerlukan aplikasi bertanda tangan. Unduh paket dari [halaman Releases resmi](https://github.com/iyansanjaya/lumilan-chat/releases).

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
