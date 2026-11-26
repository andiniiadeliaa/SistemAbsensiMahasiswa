// Same tables and constraints as buat_database() in server.py.
// Times are stored as ISO text ("YYYY-MM-DDTHH:MM:SS"), exactly like the SQLite version.
import { pgTable, serial, text, integer, unique } from "drizzle-orm/pg-core";

export const mahasiswa = pgTable("mahasiswa", {
  npm: text().primaryKey(),
  nama: text().notNull(),
  email: text().notNull().unique(),
});

export const sesi = pgTable("sesi", {
  id: serial().primaryKey(),
  pertemuan: integer().notNull().unique(),
  waktuMulai: text("waktu_mulai").notNull(),
  waktuSelesai: text("waktu_selesai").notNull(),
});

export const absensi = pgTable(
  "absensi",
  {
    id: serial().primaryKey(),
    npm: text()
      .notNull()
      .references(() => mahasiswa.npm),
    sesiId: integer("sesi_id")
      .notNull()
      .references(() => sesi.id),
    status: text().notNull(),
    waktuAbsen: text("waktu_absen").notNull(),
  },
  (t) => [unique().on(t.npm, t.sesiId)],
);
