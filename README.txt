SISTEM ABSENSI MAHASISWA - TANPA LOGIN

Kebutuhan:
- Python 3
- Flask

Cara menjalankan:
1. Buka terminal pada folder project.
2. Jalankan: py -m pip install -r requirements.txt
3. Jalankan: py server.py
4. Buka http://127.0.0.1:5000

Menu:
- Mahasiswa: mengisi NPM, nama, email, sesi, dan status.
- Dosen: membuka sesi pertemuan selama 5 menit dan melihat data absensi.
- Rekap: melihat jumlah Hadir, Izin, dan Sakit.

Catatan:
- Database absensi.db dibuat otomatis dan awalnya kosong.
- Data mahasiswa disimpan saat absensi pertama berhasil.
- NPM yang sama harus menggunakan nama dan email yang sama.
- Satu mahasiswa hanya bisa absen satu kali pada satu pertemuan.
- Halaman dosen tidak memakai login/kode akses sesuai permintaan.
- Karena tidak ada login, halaman dosen dapat dibuka siapa pun yang memiliki alamat aplikasi.
- Sesi pertemuan hanya dapat dibuat satu kali untuk setiap nomor pertemuan.
- Waktu absensi divalidasi oleh Python di server, bukan hanya tampilan browser.
