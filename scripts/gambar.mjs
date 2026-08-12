#!/usr/bin/env node
// ---------------------------------------------------------------------------
// npm run gambar -> salin semua gambar katalog dari TMDB ke assets/img/,
// ubah ke WebP pada ukuran yang benar-benar dipakai layar, lalu tandai di
// data/katalog.json bahwa salinan lokalnya sudah ada.
//
// Alasannya dua, dan keduanya soal berat halaman:
//
// 1. Kartu di baris lebarnya paling besar 240px, tapi sampai sekarang setiap
//    kartu mengunduh JPEG w780 dari TMDB -- 58-91 KB untuk ditampilkan pada
//    seperempat ukurannya. WebP 480px untuk kartu yang sama: 5-14 KB.
//
// 2. Pengunjung tidak lagi bergantung pada CDN pihak lain untuk gambar.
//
// AMAN DIJALANKAN BERKALI-KALI. Berkas yang sudah ada tidak diunduh ulang, dan
// katalog.json tidak pernah kehilangan URL TMDB aslinya (lihat catatan di
// config.js soal penanda backdropLocal / logoLocal).
//
//   npm run gambar             unduh yang belum ada saja
//   npm run gambar -- --paksa  unduh ulang semuanya
//   npm run gambar -- --sisa   jangan hapus berkas yang tak terpakai lagi
//   npm run gambar -- --buang  hapus walau jumlahnya mencurigakan banyak
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { GAMBAR_DIR, LEBAR_KARTU, LEBAR_BESAR, LEBAR_LOGO, gambarLokal } from "../config.js";

const AKAR = new URL("..", import.meta.url).pathname;
const KATALOG = join(AKAR, "data/katalog.json");
const MANIFES = join(AKAR, "data/gambar.json");

// Ukuran yang diunduh dari TMDB, bukan yang disimpan. Backdrop diambil w1280
// supaya keluaran 780 benar-benar hasil pengecilan, bukan pembesaran.
const SUMBER = { bd: "w1280", logo: "w500" };
const LEBAR = { bd: [LEBAR_KARTU, LEBAR_BESAR], logo: [LEBAR_LOGO] };

const MUTU = 80; // WebP; di atas ini ukurannya naik tajam tanpa beda yang terlihat
const SERENTAK = 6; // sopan ke TMDB dan tidak membuat mesin ini tercekik
const PERCOBAAN = 3;

const paksa = process.argv.includes("--paksa");
const simpanSisa = process.argv.includes("--sisa");
const buangPaksa = process.argv.includes("--buang");

const REDUP = "\x1b[2m";
const KUNING = "\x1b[33m";
const RESET = "\x1b[0m";

const jeda = (ms) => new Promise((r) => setTimeout(r, ms));
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

const ada = (jalur) => {
  try {
    return statSync(jalur).size > 0;
  } catch {
    return false;
  }
};

// TMDB melayani gambar yang sama pada beberapa ukuran lewat segmen jalur.
const gantiUkuran = (url, ukuran) => url.replace(/\/t\/p\/[^/]+\//, `/t/p/${ukuran}/`);

async function unduh(url) {
  let terakhir;
  for (let n = 1; n <= PERCOBAAN; n++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      terakhir = err;
      if (n < PERCOBAAN) await jeda(400 * n);
    }
  }
  throw terakhir;
}

// Menjalankan pekerjaan dengan jumlah yang berjalan bersamaan dibatasi.
// Promise.all atas 400 unduhan sekaligus akan ditolak TMDB dan membanjiri RAM.
async function kerjakan(daftar, batas, kerja) {
  let i = 0;
  const pekerja = Array.from({ length: Math.min(batas, daftar.length) }, async () => {
    while (i < daftar.length) await kerja(daftar[i++]);
  });
  await Promise.all(pekerja);
}

// ---------------------------------------------------------------------------
// 1. Kumpulkan gambar unik yang benar-benar dipakai katalog.
//
// Satu judul muncul di beberapa baris sekaligus (Film Indonesia ada di Home dan
// di Movies), jadi tanpa penyeragaman ini gambarnya diunduh berkali-kali.
// ---------------------------------------------------------------------------
let katalog;
try {
  katalog = JSON.parse(readFileSync(KATALOG, "utf8"));
} catch {
  console.error("data/katalog.json belum ada. Jalankan dulu: npm run snapshot");
  process.exit(1);
}

const semuaItem = Object.values(katalog.rows || {}).flat();
if (!semuaItem.length) {
  console.error("katalog.json kosong; tidak ada yang bisa diunduh.");
  process.exit(1);
}

/** url TMDB -> { jenis, url } */
const tugas = new Map();
for (const item of semuaItem) {
  if (item.backdrop?.startsWith("http")) tugas.set(item.backdrop, { jenis: "bd", url: item.backdrop });
  if (item.logo?.startsWith("http")) tugas.set(item.logo, { jenis: "logo", url: item.logo });
}

// Nama berkas keluaran diambil dari nama berkas TMDB. Dua gambar berbeda dengan
// nama yang sama praktis mustahil, tapi kalau sampai terjadi yang satu akan
// menimpa yang lain tanpa suara -- jadi diperiksa, bukan diandaikan.
const pemilik = new Map();
for (const { jenis, url } of tugas.values()) {
  const kunci = gambarLokal(url, jenis, LEBAR[jenis][0]);
  if (pemilik.has(kunci) && pemilik.get(kunci) !== url) {
    console.log(`${KUNING}! nama berkas bentrok: ${kunci}${RESET}`);
    console.log(`  ${pemilik.get(kunci)}\n  ${url}`);
  }
  pemilik.set(kunci, url);
}

for (const jenis of Object.keys(SUMBER)) {
  mkdirSync(join(AKAR, GAMBAR_DIR, jenis), { recursive: true });
}

// ---------------------------------------------------------------------------
// 2. Unduh dan ubah yang belum ada.
// ---------------------------------------------------------------------------
const berhasil = new Set(); // url TMDB yang salinan lokalnya lengkap
let diunduh = 0;
let dilewati = 0;
let gagal = 0;

const daftar = [...tugas.values()];
console.log(
  `${daftar.length} gambar unik dari ${semuaItem.length} kartu ` +
    `(${new Set(semuaItem.map((i) => i.id)).size} judul unik).`
);

await kerjakan(daftar, SERENTAK, async ({ jenis, url }) => {
  const keluaran = LEBAR[jenis].map((w) => ({ w, jalur: join(AKAR, gambarLokal(url, jenis, w)) }));

  if (!paksa && keluaran.every((k) => ada(k.jalur))) {
    berhasil.add(url);
    dilewati++;
    return;
  }

  try {
    const sumber = await unduh(gantiUkuran(url, SUMBER[jenis]));

    for (const { w, jalur } of keluaran) {
      // density hanya berpengaruh untuk masukan vektor; sebagian logo TMDB
      // berupa SVG dan tanpa ini hasil rasternya pecah.
      await sharp(sumber, { density: 200 })
        .resize({ width: w, withoutEnlargement: true })
        .webp({ quality: MUTU, alphaQuality: 90, effort: 5 })
        .toFile(jalur);
    }

    berhasil.add(url);
    diunduh++;
    if (diunduh % 25 === 0) process.stdout.write(`  ${REDUP}${diunduh} diunduh...${RESET}\n`);
  } catch (err) {
    gagal++;
    console.log(`${KUNING}! gagal ${url.split("/").pop()}: ${err.message}${RESET}`);
  }
});

// ---------------------------------------------------------------------------
// 3. Tandai item yang salinan lokalnya siap.
//
// Yang gagal sengaja dibiarkan tanpa penanda: kartunya akan memakai URL TMDB
// seperti sebelumnya. Satu gambar meleset tidak boleh berarti kartu kosong.
// ---------------------------------------------------------------------------
let ditandai = 0;
for (const item of semuaItem) {
  item.backdropLocal = Boolean(item.backdrop && berhasil.has(item.backdrop));
  item.logoLocal = Boolean(item.logo && berhasil.has(item.logo));
  if (item.backdropLocal) ditandai++;
}

// ---------------------------------------------------------------------------
// 4. Buang berkas yang tidak dipakai katalog mana pun lagi.
//
// Katalog berputar tiap hari; tanpa langkah ini foldernya tumbuh selamanya.
// Kalau daftar rujukan mencurigakan kecil, pembuangan dibatalkan -- katalog
// yang separuh terunduh tidak boleh berujung menghapus seluruh gambar.
// ---------------------------------------------------------------------------
const dipakai = new Set();
for (const { jenis, url } of tugas.values()) {
  if (!berhasil.has(url)) continue;
  for (const w of LEBAR[jenis]) dipakai.add(join(AKAR, gambarLokal(url, jenis, w)));
}

let dihapus = 0;
let bytesDihapus = 0;

if (!simpanSisa) {
  for (const jenis of Object.keys(SUMBER)) {
    const folder = join(AKAR, GAMBAR_DIR, jenis);
    const isi = readdirSync(folder).filter((n) => n.endsWith(".webp"));
    const sisa = isi.filter((n) => !dipakai.has(join(folder, n)));

    if (isi.length && sisa.length > isi.length * 0.5 && !buangPaksa) {
      console.log(
        `${KUNING}! ${jenis}: ${sisa.length} dari ${isi.length} berkas tampak tak terpakai -- ` +
          `terlalu banyak, pembuangan dilewati.${RESET}`
      );
      console.log(`  Kalau memang disengaja: npm run gambar -- --buang`);
      continue;
    }

    for (const nama of sisa) {
      const jalur = join(folder, nama);
      try {
        bytesDihapus += statSync(jalur).size;
        unlinkSync(jalur);
        dihapus++;
      } catch {
        /* sudah hilang duluan; bukan masalah */
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Simpan.
// ---------------------------------------------------------------------------
writeFileSync(KATALOG, JSON.stringify(katalog, null, 1));

let bytes = 0;
let jumlah = 0;
for (const jenis of Object.keys(SUMBER)) {
  const folder = join(AKAR, GAMBAR_DIR, jenis);
  for (const nama of readdirSync(folder).filter((n) => n.endsWith(".webp"))) {
    bytes += statSync(join(folder, nama)).size;
    jumlah++;
  }
}

writeFileSync(
  MANIFES,
  JSON.stringify({ generatedAt: new Date().toISOString(), berkas: jumlah, bytes }, null, 1)
);

console.log(
  `\nSelesai: ${diunduh} baru, ${dilewati} sudah ada, ${gagal} gagal` +
    (dihapus ? `, ${dihapus} dibuang (${mb(bytesDihapus)})` : "")
);
console.log(
  `  ${ditandai} dari ${semuaItem.length} kartu memakai gambar lokal` +
    ` -> ${jumlah} berkas, ${mb(bytes)} (rata-rata ${kb(bytes / (jumlah || 1))})`
);

if (gagal) process.exitCode = 0; // sebagian gagal bukan alasan menggagalkan push
