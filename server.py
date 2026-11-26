from pathlib import Path
import sqlite3
from datetime import datetime, timedelta
from flask import (
    Flask,
    flash,
    make_response,
    redirect,
    render_template,
    request,
    session,
    url_for,
)

app = Flask(__name__)
app.secret_key = "kunci-project-absensi"
DATABASE = Path(__file__).with_name("absensi.db")
DURASI_SESI = 5  # menit
KODE_DOSEN = "DOSEN2026"


def koneksi():
    db = sqlite3.connect(DATABASE)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    return db


def buat_database():
    """Membuat tabel kosong tanpa data awal."""
    with koneksi() as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS mahasiswa (
                npm TEXT PRIMARY KEY,
                nama TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE
            )
        """)
        db.execute("""
            CREATE TABLE IF NOT EXISTS sesi (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pertemuan INTEGER NOT NULL UNIQUE,
                waktu_mulai TEXT NOT NULL,
                waktu_selesai TEXT NOT NULL
            )
        """)
        db.execute("""
            CREATE TABLE IF NOT EXISTS absensi (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                npm TEXT NOT NULL,
                sesi_id INTEGER NOT NULL,
                status TEXT NOT NULL,
                waktu_absen TEXT NOT NULL,
                UNIQUE(npm, sesi_id),
                FOREIGN KEY(npm) REFERENCES mahasiswa(npm),
                FOREIGN KEY(sesi_id) REFERENCES sesi(id)
            )
        """)


def waktu_sekarang():
    return datetime.now()


@app.route("/", methods=["GET", "POST"])
def index():
    with koneksi() as db:
        sesi_aktif = db.execute(
            "SELECT * FROM sesi WHERE waktu_selesai >= ? ORDER BY pertemuan",
            (waktu_sekarang().isoformat(timespec="seconds"),),
        ).fetchall()

    if request.method == "POST":
        npm = request.form.get("npm", "").strip()
        nama = request.form.get("nama", "").strip()
        email = request.form.get("email", "").strip().lower()
        status = request.form.get("status", "").strip()
        sesi_id = request.form.get("sesi_id", "").strip()

        if not all([npm, nama, email, status, sesi_id]):
            flash("Semua kolom wajib diisi.")
            return redirect(url_for("index"))

        if status not in ["Hadir", "Izin", "Sakit"]:
            flash("Status absensi tidak valid.")
            return redirect(url_for("index"))

        nama_cookie = f"absen_sesi_{sesi_id}"
        if request.cookies.get(nama_cookie) == "1":
            flash("Perangkat ini sudah digunakan untuk absen pada pertemuan ini.")
            return redirect(url_for("index"))

        try:
            with koneksi() as db:
                sesi = db.execute(
                    "SELECT * FROM sesi WHERE id = ?", (sesi_id,)
                ).fetchone()

                if sesi is None:
                    flash("Sesi tidak ditemukan.")
                    return redirect(url_for("index"))

                sekarang = waktu_sekarang()
                selesai = datetime.fromisoformat(sesi["waktu_selesai"])
                if sekarang > selesai:
                    flash("Waktu absensi untuk pertemuan ini sudah berakhir.")
                    return redirect(url_for("index"))

                data_lama = db.execute(
                    "SELECT * FROM mahasiswa WHERE npm = ?", (npm,)
                ).fetchone()

                if data_lama is None:
                    db.execute(
                        "INSERT INTO mahasiswa (npm, nama, email) VALUES (?, ?, ?)",
                        (npm, nama, email),
                    )
                else:
                    if data_lama["email"].lower() != email:
                        flash("Email tidak sesuai dengan email yang terdaftar untuk NPM ini.")
                        return redirect(url_for("index"))
                    if data_lama["nama"].lower() != nama.lower():
                        flash("Nama tidak sesuai dengan data NPM yang terdaftar.")
                        return redirect(url_for("index"))

                db.execute(
                    """INSERT INTO absensi (npm, sesi_id, status, waktu_absen)
                       VALUES (?, ?, ?, ?)""",
                    (npm, sesi_id, status, sekarang.isoformat(timespec="seconds")),
                )

            flash("Absensi berhasil disimpan.")
            resp = make_response(redirect(url_for("index")))
            resp.set_cookie(
                nama_cookie, "1", max_age=60 * 60 * 24, httponly=True, samesite="Lax"
            )
            return resp

        except sqlite3.IntegrityError:
            flash("NPM ini sudah melakukan absensi pada pertemuan tersebut, atau email sudah digunakan.")
            return redirect(url_for("index"))

    return render_template("mahasiswa.html", sesi=sesi_aktif)


@app.route("/akses-dosen", methods=["GET", "POST"])
def akses_dosen():
    if session.get("dosen_ok"):
        return redirect(url_for("dosen"))

    if request.method == "POST":
        kode = request.form.get("kode_akses", "").strip()
        if kode == KODE_DOSEN:
            session["dosen_ok"] = True
            return redirect(url_for("dosen"))
        flash("Kode akses salah.")
        return redirect(url_for("akses_dosen"))

    return render_template("akses_dosen.html")


@app.route("/keluar-dosen")
def keluar_dosen():
    session.pop("dosen_ok", None)
    flash("Sesi dosen telah ditutup.")
    return redirect(url_for("akses_dosen"))


@app.route("/dosen", methods=["GET", "POST"])
def dosen():
    if not session.get("dosen_ok"):
        return redirect(url_for("akses_dosen"))

    if request.method == "POST":
        pertemuan = request.form.get("pertemuan", "").strip()
        if not pertemuan.isdigit() or not 1 <= int(pertemuan) <= 14:
            flash("Nomor pertemuan harus antara 1 sampai 14.")
            return redirect(url_for("dosen"))

        mulai = waktu_sekarang()
        selesai = mulai + timedelta(minutes=DURASI_SESI)

        try:
            with koneksi() as db:
                db.execute(
                    "INSERT INTO sesi (pertemuan, waktu_mulai, waktu_selesai) VALUES (?, ?, ?)",
                    (
                        int(pertemuan),
                        mulai.isoformat(timespec="seconds"),
                        selesai.isoformat(timespec="seconds"),
                    ),
                )
            flash(f"Absensi pertemuan {pertemuan} dibuka selama {DURASI_SESI} menit.")
        except sqlite3.IntegrityError:
            flash("Pertemuan tersebut sudah pernah dibuka.")
        return redirect(url_for("dosen"))

    with koneksi() as db:
        daftar_sesi = db.execute("""
            SELECT sesi.*,
                   COUNT(absensi.id) AS jumlah_absen
            FROM sesi
            LEFT JOIN absensi ON sesi.id = absensi.sesi_id
            GROUP BY sesi.id
            ORDER BY sesi.pertemuan
        """).fetchall()

        data_mahasiswa = db.execute("""
            SELECT mahasiswa.npm, mahasiswa.nama, mahasiswa.email,
                   sesi.pertemuan, absensi.status, absensi.waktu_absen
            FROM absensi
            JOIN mahasiswa ON absensi.npm = mahasiswa.npm
            JOIN sesi ON absensi.sesi_id = sesi.id
            ORDER BY sesi.pertemuan, mahasiswa.nama
        """).fetchall()

    return render_template("dosen.html", sesi=daftar_sesi, data=data_mahasiswa)


@app.route("/rekap")
def rekap():
    if not session.get("dosen_ok"):
        return redirect(url_for("akses_dosen"))

    with koneksi() as db:
        hasil = db.execute("""
            SELECT mahasiswa.npm, mahasiswa.nama, mahasiswa.email,
                   SUM(CASE WHEN absensi.status = 'Hadir' THEN 1 ELSE 0 END) AS hadir,
                   SUM(CASE WHEN absensi.status = 'Izin' THEN 1 ELSE 0 END) AS izin,
                   SUM(CASE WHEN absensi.status = 'Sakit' THEN 1 ELSE 0 END) AS sakit
            FROM mahasiswa
            LEFT JOIN absensi ON mahasiswa.npm = absensi.npm
            GROUP BY mahasiswa.npm, mahasiswa.nama, mahasiswa.email
            ORDER BY mahasiswa.nama
        """).fetchall()
    return render_template("rekap.html", data=hasil)


if __name__ == "__main__":
    buat_database()
    app.run(debug=True)