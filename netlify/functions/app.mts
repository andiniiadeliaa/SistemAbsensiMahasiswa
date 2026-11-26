// TypeScript port of server.py for Netlify Functions.
// Routes, validation rules, messages and SQL mirror the Flask app one-to-one.
// The original server.py + SQLite version is kept unchanged for local use.
import type { Config } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import nunjucks from "nunjucks";
import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SECRET_KEY = "kunci-project-absensi"; // app.secret_key in server.py
const DURASI_SESI = 5; // menit
const KODE_DOSEN = "DOSEN2026";
// Flask uses the computer's local time; Netlify runs on UTC, so the clock is fixed to WIB (UTC+7).
const OFFSET_WIB_MS = 7 * 60 * 60 * 1000;

const db = getDatabase();

// ---------------------------------------------------------------------------
// Templates: the existing Jinja files in templates/ are rendered as-is with
// Nunjucks. Two Jinja-only forms are translated in memory when loading:
//   {% with x = y %} ... {% endwith %}  ->  {% set x = y %} ...
//   value[11:16]                        ->  value.slice(11, 16)
// ---------------------------------------------------------------------------
function findTemplatesDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(process.cwd(), "templates"),
    resolve(here, "../../templates"),
    resolve(here, "../templates"),
    resolve(here, "templates"),
  ];
  return candidates.find((dir) => existsSync(join(dir, "mahasiswa.html"))) ?? candidates[0];
}

const TEMPLATES_DIR = findTemplatesDir();

class JinjaCompatLoader extends nunjucks.Loader {
  getSource(name: string) {
    const fullPath = join(TEMPLATES_DIR, name);
    const src = readFileSync(fullPath, "utf8")
      .replace(/\{%(-?)\s*with\s+/g, "{%$1 set ")
      .replace(/\{%-?\s*endwith\s*-?%\}/g, "")
      .replace(/\[\s*(\d+)\s*:\s*(\d+)\s*\]/g, ".slice($1, $2)");
    return { src, path: fullPath, noCache: false };
  }
}

const env = new nunjucks.Environment(new JinjaCompatLoader(), { autoescape: true });

const ROUTES: Record<string, string> = {
  index: "/",
  akses_dosen: "/akses-dosen",
  keluar_dosen: "/keluar-dosen",
  dosen: "/dosen",
  rekap: "/rekap",
};

function urlFor(endpoint: string, kwargs?: { filename?: string }): string {
  if (endpoint === "static") return `/static/${kwargs?.filename ?? ""}`;
  return ROUTES[endpoint] ?? "/";
}

// ---------------------------------------------------------------------------
// Flask-style signed session cookie (holds dosen_ok and flash messages)
// ---------------------------------------------------------------------------
type Session = { dosen_ok?: boolean; _flashes?: string[] };

function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    if (!key) continue;
    const value = part.slice(i + 1).trim();
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

function sign(value: string): string {
  return createHmac("sha256", SECRET_KEY).update(value).digest("base64url");
}

function loadSession(cookies: Record<string, string>): Session {
  const raw = cookies["session"];
  if (!raw) return {};
  const [payload, sig] = raw.split(".");
  if (!payload || !sig) return {};
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return {};
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Session;
  } catch {
    return {};
  }
}

function sessionCookie(session: Session): string {
  if (!session.dosen_ok && !session._flashes?.length) {
    return "session=; Max-Age=0; Path=/; HttpOnly";
  }
  const payload = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  return `session=${payload}.${sign(payload)}; Path=/; HttpOnly`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Local (WIB) time as "YYYY-MM-DDTHH:MM:SS", like datetime.isoformat(timespec="seconds"). */
function isoSeconds(ms: number): string {
  return new Date(ms + OFFSET_WIB_MS).toISOString().slice(0, 19);
}

/** Parses a stored "YYYY-MM-DDTHH:MM:SS" WIB timestamp back to epoch ms. */
function parseIso(value: string): number {
  return Date.parse(`${value}+07:00`);
}

function isIntegrityError(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  // unique_violation, foreign_key_violation, not_null_violation (sqlite3.IntegrityError equivalents)
  return code === "23505" || code === "23503" || code === "23502";
}

class Ctx {
  cookies: Record<string, string>;
  session: Session;
  extraCookies: string[] = [];

  constructor(req: Request) {
    this.cookies = parseCookies(req);
    this.session = loadSession(this.cookies);
  }

  flash(message: string) {
    this.session._flashes = [...(this.session._flashes ?? []), message];
  }

  private headers(extra: Record<string, string>): Headers {
    const h = new Headers(extra);
    h.append("Set-Cookie", sessionCookie(this.session));
    for (const c of this.extraCookies) h.append("Set-Cookie", c);
    h.set("Cache-Control", "no-store");
    return h;
  }

  redirect(endpoint: string): Response {
    return new Response(null, { status: 302, headers: this.headers({ Location: urlFor(endpoint) }) });
  }

  render(template: string, context: Record<string, unknown> = {}): Response {
    const html = env.render(template, {
      ...context,
      url_for: urlFor,
      get_flashed_messages: () => {
        const messages = this.session._flashes ?? [];
        delete this.session._flashes;
        return messages;
      },
    });
    return new Response(html, {
      status: 200,
      headers: this.headers({ "Content-Type": "text/html; charset=utf-8" }),
    });
  }
}

function formValue(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
async function index(req: Request, ctx: Ctx): Promise<Response> {
  const { rows: sesiAktif } = await db.pool.query(
    "SELECT * FROM sesi WHERE waktu_selesai >= $1 ORDER BY pertemuan",
    [isoSeconds(Date.now())],
  );

  if (req.method === "POST") {
    const form = await req.formData();
    const npm = formValue(form, "npm");
    const nama = formValue(form, "nama");
    const email = (formValue(form, "email")).toLowerCase();
    const status = formValue(form, "status");
    const sesiId = formValue(form, "sesi_id");

    if (![npm, nama, email, status, sesiId].every(Boolean)) {
      ctx.flash("Semua kolom wajib diisi.");
      return ctx.redirect("index");
    }

    if (!["Hadir", "Izin", "Sakit"].includes(status)) {
      ctx.flash("Status absensi tidak valid.");
      return ctx.redirect("index");
    }

    const namaCookie = `absen_sesi_${sesiId}`;
    if (ctx.cookies[namaCookie] === "1") {
      ctx.flash("Perangkat ini sudah digunakan untuk absen pada pertemuan ini.");
      return ctx.redirect("index");
    }

    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");

      const sesi = /^\d+$/.test(sesiId)
        ? (await client.query("SELECT * FROM sesi WHERE id = $1", [Number(sesiId)])).rows[0]
        : undefined;

      if (!sesi) {
        await client.query("ROLLBACK");
        ctx.flash("Sesi tidak ditemukan.");
        return ctx.redirect("index");
      }

      const sekarangMs = Date.now();
      if (sekarangMs > parseIso(sesi.waktu_selesai)) {
        await client.query("ROLLBACK");
        ctx.flash("Waktu absensi untuk pertemuan ini sudah berakhir.");
        return ctx.redirect("index");
      }

      const dataLama = (await client.query("SELECT * FROM mahasiswa WHERE npm = $1", [npm])).rows[0];

      if (!dataLama) {
        await client.query("INSERT INTO mahasiswa (npm, nama, email) VALUES ($1, $2, $3)", [
          npm,
          nama,
          email,
        ]);
      } else {
        if (String(dataLama.email).toLowerCase() !== email) {
          await client.query("ROLLBACK");
          ctx.flash("Email tidak sesuai dengan email yang terdaftar untuk NPM ini.");
          return ctx.redirect("index");
        }
        if (String(dataLama.nama).toLowerCase() !== nama.toLowerCase()) {
          await client.query("ROLLBACK");
          ctx.flash("Nama tidak sesuai dengan data NPM yang terdaftar.");
          return ctx.redirect("index");
        }
      }

      await client.query(
        "INSERT INTO absensi (npm, sesi_id, status, waktu_absen) VALUES ($1, $2, $3, $4)",
        [npm, sesi.id, status, isoSeconds(sekarangMs)],
      );
      await client.query("COMMIT");

      ctx.flash("Absensi berhasil disimpan.");
      ctx.extraCookies.push(`${namaCookie}=1; Max-Age=${60 * 60 * 24}; Path=/; HttpOnly; SameSite=Lax`);
      return ctx.redirect("index");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      if (isIntegrityError(err)) {
        ctx.flash(
          "NPM ini sudah melakukan absensi pada pertemuan tersebut, atau email sudah digunakan.",
        );
        return ctx.redirect("index");
      }
      throw err;
    } finally {
      client.release();
    }
  }

  return ctx.render("mahasiswa.html", { sesi: sesiAktif });
}

async function aksesDosen(req: Request, ctx: Ctx): Promise<Response> {
  if (ctx.session.dosen_ok) return ctx.redirect("dosen");

  if (req.method === "POST") {
    const kode = formValue(await req.formData(), "kode_akses");
    if (kode === KODE_DOSEN) {
      ctx.session.dosen_ok = true;
      return ctx.redirect("dosen");
    }
    ctx.flash("Kode akses salah.");
    return ctx.redirect("akses_dosen");
  }

  return ctx.render("akses_dosen.html");
}

async function keluarDosen(_req: Request, ctx: Ctx): Promise<Response> {
  delete ctx.session.dosen_ok;
  ctx.flash("Sesi dosen telah ditutup.");
  return ctx.redirect("akses_dosen");
}

async function dosen(req: Request, ctx: Ctx): Promise<Response> {
  if (!ctx.session.dosen_ok) return ctx.redirect("akses_dosen");

  if (req.method === "POST") {
    const pertemuan = formValue(await req.formData(), "pertemuan");
    if (!/^\d+$/.test(pertemuan) || !(Number(pertemuan) >= 1 && Number(pertemuan) <= 14)) {
      ctx.flash("Nomor pertemuan harus antara 1 sampai 14.");
      return ctx.redirect("dosen");
    }

    const mulaiMs = Date.now();
    const selesaiMs = mulaiMs + DURASI_SESI * 60 * 1000;

    try {
      await db.pool.query(
        "INSERT INTO sesi (pertemuan, waktu_mulai, waktu_selesai) VALUES ($1, $2, $3)",
        [Number(pertemuan), isoSeconds(mulaiMs), isoSeconds(selesaiMs)],
      );
      ctx.flash(`Absensi pertemuan ${pertemuan} dibuka selama ${DURASI_SESI} menit.`);
    } catch (err) {
      if (!isIntegrityError(err)) throw err;
      ctx.flash("Pertemuan tersebut sudah pernah dibuka.");
    }
    return ctx.redirect("dosen");
  }

  const { rows: daftarSesi } = await db.pool.query(`
    SELECT sesi.*,
           COUNT(absensi.id) AS jumlah_absen
    FROM sesi
    LEFT JOIN absensi ON sesi.id = absensi.sesi_id
    GROUP BY sesi.id
    ORDER BY sesi.pertemuan
  `);

  const { rows: dataMahasiswa } = await db.pool.query(`
    SELECT mahasiswa.npm, mahasiswa.nama, mahasiswa.email,
           sesi.pertemuan, absensi.status, absensi.waktu_absen
    FROM absensi
    JOIN mahasiswa ON absensi.npm = mahasiswa.npm
    JOIN sesi ON absensi.sesi_id = sesi.id
    ORDER BY sesi.pertemuan, mahasiswa.nama
  `);

  return ctx.render("dosen.html", { sesi: daftarSesi, data: dataMahasiswa });
}

async function rekap(_req: Request, ctx: Ctx): Promise<Response> {
  if (!ctx.session.dosen_ok) return ctx.redirect("akses_dosen");

  const { rows: hasil } = await db.pool.query(`
    SELECT mahasiswa.npm, mahasiswa.nama, mahasiswa.email,
           SUM(CASE WHEN absensi.status = 'Hadir' THEN 1 ELSE 0 END) AS hadir,
           SUM(CASE WHEN absensi.status = 'Izin' THEN 1 ELSE 0 END) AS izin,
           SUM(CASE WHEN absensi.status = 'Sakit' THEN 1 ELSE 0 END) AS sakit
    FROM mahasiswa
    LEFT JOIN absensi ON mahasiswa.npm = absensi.npm
    GROUP BY mahasiswa.npm, mahasiswa.nama, mahasiswa.email
    ORDER BY mahasiswa.nama
  `);
  return ctx.render("rekap.html", { data: hasil });
}

type Handler = (req: Request, ctx: Ctx) => Promise<Response>;

// Same URL + allowed methods as the @app.route(...) declarations in server.py.
const HANDLERS: Record<string, { handler: Handler; methods: string[] }> = {
  "/": { handler: index, methods: ["GET", "POST"] },
  "/akses-dosen": { handler: aksesDosen, methods: ["GET", "POST"] },
  "/keluar-dosen": { handler: keluarDosen, methods: ["GET"] },
  "/dosen": { handler: dosen, methods: ["GET", "POST"] },
  "/rekap": { handler: rekap, methods: ["GET"] },
};

export default async (req: Request) => {
  const route = HANDLERS[new URL(req.url).pathname];
  if (!route) return new Response("Not Found", { status: 404 });
  const method = req.method === "HEAD" ? "GET" : req.method;
  if (!route.methods.includes(method)) {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: [...route.methods, "HEAD"].join(", ") },
    });
  }
  return route.handler(req, new Ctx(req));
};

export const config: Config = {
  path: ["/", "/akses-dosen", "/keluar-dosen", "/dosen", "/rekap"],
};
