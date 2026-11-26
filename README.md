# Sistem Absensi Mahasiswa Berbasis Web

Aplikasi absensi mahasiswa berbasis web yang dikembangkan menggunakan **Python Flask** dan **SQLite**. Aplikasi ini dibuat untuk membantu proses pencatatan kehadiran mahasiswa selama perkuliahan agar lebih praktis, terstruktur, dan mudah dikelola.

Sistem memiliki dua jenis akses, yaitu mahasiswa dan dosen. Mahasiswa dapat langsung mengisi form absensi, sedangkan dosen memiliki akses khusus untuk membuka sesi pertemuan dan melihat rekap kehadiran.

## Fitur Utama

### 1. Form Absensi Mahasiswa
- Mahasiswa langsung diarahkan ke halaman pengisian absensi.
- Mengisi NPM, nama lengkap, dan email.
- Memilih sesi pertemuan yang sedang aktif.
- Memilih status kehadiran: Hadir, Izin, atau Sakit.
- Mendapatkan notifikasi setelah mengirim absensi.
- Tidak menampilkan menu dashboard dosen maupun rekap absensi.

### 2. Akses Khusus Dosen
- Dashboard dosen dilindungi kode akses.
- Kode akses awal: `DOSEN2026`.
- Menggunakan Flask Session untuk mempertahankan status akses dosen.
- Memiliki fitur keluar dari dashboard.

### 3. Pengelolaan Sesi Absensi
- Dosen dapat membuka sesi pertemuan 1 sampai 14.
- Setiap sesi memiliki batas waktu pengisian selama 5 menit.
- Sistem mencatat waktu mulai dan waktu selesai.
- Sesi yang sudah dibuat tidak dapat dibuat kembali dengan nomor pertemuan yang sama.

### 4. Validasi Absensi
- Memeriksa kelengkapan data sebelum disimpan.
- Memeriksa kesesuaian NPM, nama, dan email dengan data mahasiswa yang sudah terdaftar.
- Memastikan sesi yang dipilih masih aktif.
- Mencegah pengisian absensi lebih dari satu kali pada sesi yang sama menggunakan batasan `UNIQUE(npm, sesi_id)` di SQLite.

### 5. Rekap Kehadiran
- Menampilkan data mahasiswa yang sudah melakukan absensi.
- Mengelompokkan jumlah kehadiran berdasarkan status Hadir, Izin, dan Sakit.
- Hanya dapat diakses melalui akses dosen yang sudah terverifikasi.

## Teknologi yang Digunakan

| Teknologi | Kegunaan |
|---|---|
| Python | Bahasa pemrograman utama |
| Flask | Framework untuk memb
