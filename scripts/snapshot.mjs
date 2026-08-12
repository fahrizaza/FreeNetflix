#!/usr/bin/env node
// ---------------------------------------------------------------------------
// npm run snapshot -> unduh seluruh isi baris katalog dari TMDB sekali,
// simpan ke data/katalog.json.
//
// Browser pengunjung membaca berkas ini, bukan menembak TMDB. Jadi kuota API
// gratisan hanya terpakai di mesin pemilik situs, sekali sehari -- bukan oleh
// setiap pengunjung setiap kali membuka beranda.
//
// Ikut dijalankan otomatis oleh npm run push kalau snapshotnya sudah lebih tua
// dari 20 jam, jadi "sekali sehari" terjadi sendiri selama Anda push.
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { SECTIONS, TMDB, TMDB_KEY, normalize, pickLogo } from "../config.js";

const KELUARAN = new URL("../data/katalog.json", import.meta.url).pathname;

const JEDA_MS = 60; // sopan ke TMDB; batasnya ~50 req/detik, kita jauh di bawah

const jeda = (ms) => new Promise((r) => setTimeout(r, ms));

// Logo diunduh untuk SEMUA judul, bukan sekian kartu pertama saja.
//
// Dulu hanya 8 per baris, dan sisanya diambil browser sendiri saat kartunya
// tergulir ke layar -- artinya setiap pengunjung menembak TMDB belasan kali
// hanya untuk menggulir satu baris. Justru itu yang paling menghabiskan kuota
// API gratisan, bukan daftar barisnya.
//
// Yang membuat ini murah: satu judul muncul di beberapa baris sekaligus, jadi
// hasilnya disimpan per judul, bukan per kartu. 700 kartu ternyata hanya ~340
// judul unik.
const logoJudul = new Map();

async function ambilLogo(item) {
  const kind = item.type === "SHOW" ? "tv" : "movie";
  const kunci = `${kind}-${item.tmdbId}`;

  if (logoJudul.has(kunci)) return logoJudul.get(kunci);

  // null = permintaannya GAGAL, beda dengan "" yang berarti judul ini memang
  // tidak punya logo. Yang gagal tidak ditandai logoLoaded, jadi browser masih
  // boleh mencoba sendiri; yang memang kosong ditandai supaya tidak ditanyakan
  // lagi selamanya.
  let logo = null;
  try {
    const data = await tmdb(`/${kind}/${item.tmdbId}/images?include_image_language=id,en,null`);
    logo = pickLogo(data.logos);
  } catch {
    /* logo gagal bukan alasan membuang barisnya */
  }

  logoJudul.set(kunci, logo);
  await jeda(JEDA_MS);
  return logo;
}

async function tmdb(path) {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${TMDB}${path}${sep}api_key=${TMDB_KEY}`);
  if (!res.ok) throw new Error(`TMDB ${res.status} untuk ${path}`);
  return res.json();
}

// Satu baris: hasil discover dinormalisasi ke bentuk yang sama persis dengan
// yang dipakai browser, lalu logo tiap judulnya diisi sekalian.
async function unduhBaris(row) {
  const json = await tmdb(row.path);
  const items = (json.results || []).map((raw) => normalize(raw, row.type));

  for (const item of items) {
    const logo = await ambilLogo(item);
    if (logo === null) continue; // gagal -> biarkan browser yang mencoba

    item.logo = logo;
    item.logoLoaded = true; // browser tidak perlu menanyakannya lagi, walau hasilnya kosong
  }

  return items;
}

// Snapshot lama dipertahankan untuk baris yang gagal diunduh: data kemarin
// jauh lebih baik daripada baris kosong.
let lama = {};
try {
  lama = JSON.parse(readFileSync(KELUARAN, "utf8")).rows || {};
} catch {
  /* belum pernah ada snapshot */
}

const semuaBaris = SECTIONS.flatMap((s) => s.rows);
const rows = {};
let berhasil = 0;
let gagal = 0;

console.log(`Mengunduh ${semuaBaris.length} baris katalog dari TMDB...`);

for (const row of semuaBaris) {
  try {
    rows[row.key] = await unduhBaris(row);
    berhasil++;
    process.stdout.write(`  ✓ ${row.title} (${rows[row.key].length} judul)\n`);
  } catch (err) {
    gagal++;
    if (lama[row.key]) {
      rows[row.key] = lama[row.key];
      process.stdout.write(`  ! ${row.title}: gagal, memakai data lama (${err.message})\n`);
    } else {
      process.stdout.write(`  ✗ ${row.title}: gagal dan tidak ada data lama (${err.message})\n`);
    }
  }
  await jeda(JEDA_MS);
}

if (!berhasil) {
  console.error("\nSemua baris gagal diunduh. Berkas lama tidak disentuh.");
  process.exit(1);
}

mkdirSync(new URL("../data", import.meta.url).pathname, { recursive: true });
writeFileSync(
  KELUARAN,
  JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 1)
);

const kb = Math.round(readFileSync(KELUARAN).length / 1024);
console.log(`\nSelesai: ${berhasil} baris segar, ${gagal} gagal -> data/katalog.json (${kb} KB)`);

// Item yang baru saja ditulis semuanya lahir dengan backdropLocal = false.
// Tanpa langkah berikutnya, situs menarik gambarnya dari TMDB lagi.
console.log("Berikutnya: npm run gambar  (menyalin gambarnya ke hosting sendiri)");
