CREATE TABLE "absensi" (
	"id" serial PRIMARY KEY,
	"npm" text NOT NULL,
	"sesi_id" integer NOT NULL,
	"status" text NOT NULL,
	"waktu_absen" text NOT NULL,
	CONSTRAINT "absensi_npm_sesi_id_unique" UNIQUE("npm","sesi_id")
);
--> statement-breakpoint
CREATE TABLE "mahasiswa" (
	"npm" text PRIMARY KEY,
	"nama" text NOT NULL,
	"email" text NOT NULL UNIQUE
);
--> statement-breakpoint
CREATE TABLE "sesi" (
	"id" serial PRIMARY KEY,
	"pertemuan" integer NOT NULL UNIQUE,
	"waktu_mulai" text NOT NULL,
	"waktu_selesai" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "absensi" ADD CONSTRAINT "absensi_npm_mahasiswa_npm_fkey" FOREIGN KEY ("npm") REFERENCES "mahasiswa"("npm");--> statement-breakpoint
ALTER TABLE "absensi" ADD CONSTRAINT "absensi_sesi_id_sesi_id_fkey" FOREIGN KEY ("sesi_id") REFERENCES "sesi"("id");