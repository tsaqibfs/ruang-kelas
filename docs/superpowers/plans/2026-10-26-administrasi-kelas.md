# Rencana implementasi administrasi kelas dan pengingat WhatsApp

Pengguna meminta langsung dibuat; pilihan teknis dan rincian versi awal diserahkan kepada implementer.

**Tujuan:** satu aplikasi untuk tugas, jadwal/PJ, kas, dan pengingat grup WA di Windows.
**Arsitektur:** Express menyajikan web tanpa proses build, SQLite menyimpan data serta sesi dan riwayat pengiriman. Worker pengingat berjalan dalam proses yang sama, menggunakan waktu Asia/Jakarta. WhatsApp dihubungkan lewat LocalAuth dan QR; dinonaktifkan sampai admin memasangkan akun dan memilih grup.
**Stack:** Node.js 22.13+ (24 LTS disarankan), Express 5, node:sqlite, whatsapp-web.js, qrcode, native HTML/CSS/JS.

## Batasan dan keputusan implementer

- Satu kelas, satu akun admin, tampilan mahasiswa hanya baca; data pribadi mahasiswa dan koneksi bot hanya untuk admin.
- Jadwal mingguan; waktu tenggat tugas adalah WIB; pengingat H-3 dan hari-H hanya untuk tugas yang belum ditutup dan belum lewat tenggat.
- Kas per bulan, nominal bisa diatur, pembayaran mahasiswa masuk ke buku kas. Pengingat kas mingguan menampilkan jumlah belum lunas tanpa daftar nama.
- Tidak ada data contoh di database pengguna; keadaan awal kosong dengan petunjuk pengisian.
- Tidak mengirim pesan atau menghubungkan akun WA selama pengembangan.
- Default pengingat jadwal pukul 21.00; tugas 08.00; kas Jumat 19.00 WIB. Bisa diubah.
- Pengingat yang terlewat dapat dikirim setelah aplikasi hidup kembali pada tanggal yang sama; tidak mengejar hari sebelumnya.
- Kunci pengiriman persisten mencegah pengiriman normal berulang setelah restart. Jika proses terhenti saat kirim, tandai perlu diperiksa; tidak retry otomatis untuk menghindari duplikat. Exactly-once ke layanan eksternal tidak dijamin.
- Bind localhost secara default; akses internet melalui reverse proxy HTTPS yang disiapkan pada RDP pemilik.

## Tahap dan verifikasi

- [ ] Domain dan database: uji batas tanggal WIB, H-3/hari-H, saldo, pembayaran parsial, validasi dan foreign key; implementasikan setelah hasil uji merah.
- [ ] Scheduler dan WhatsApp: uji deduplikasi persisten, kegagalan kirim, penutupan tugas, jadwal besok dan pengingat kas; transport eksternal diganti saat pengujian saja.
- [ ] API dan autentikasi: uji bootstrap memakai token lokal, sesi, CSRF, pembatasan admin, data publik, CRUD dan input buruk.
- [ ] Web responsif: ringkasan, tugas, jadwal, kas, mahasiswa, bot dan pengaturan; form tambah/edit/hapus, filter, pencarian, QR, pratinjau pesan dan ekspor buku kas.
- [ ] Panduan Windows, start otomatis saat boot, backup SQLite, uji keseluruhan, pemeriksaan browser dan review.

## Fokus risiko

- Pergantian hari/bulan/tahun, waktu server berbeda dari WIB, dan tenggat sebelum jam pengingat.
- Pembayaran parsial/ganda tidak boleh mengubah status menjadi lunas terlalu awal; transaksi invalid tidak boleh tersimpan.
- Restart saat pengiriman; akun terputus; grup belum dipilih; tidak membocorkan QR atau sesi ke pengunjung.
- Permintaan lintas situs, endpoint admin tanpa login, dan XSS melalui input pengguna.
- RDP logout/reboot dan penguncian file database saat backup.
