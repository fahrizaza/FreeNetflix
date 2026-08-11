#!/usr/bin/env node
// ---------------------------------------------------------------------------
// npm run push            -> build CSS, commit semua perubahan, push
// npm run push -- "pesan" -> sama, tapi dengan pesan commit sendiri
//
// Ditulis dengan Node, bukan skrip shell, supaya perintahnya sama persis di
// macOS dan Windows -- Node sudah jadi dependensi proyek ini.
// ---------------------------------------------------------------------------
import { execSync } from "node:child_process";

const BIRU = "\x1b[36m";
const HIJAU = "\x1b[32m";
const KUNING = "\x1b[33m";
const MERAH = "\x1b[31m";
const REDUP = "\x1b[2m";
const RESET = "\x1b[0m";

const kabar = (teks) => console.log(`${BIRU}›${RESET} ${teks}`);
const beres = (teks) => console.log(`${HIJAU}✓${RESET} ${teks}`);
const catat = (teks) => console.log(`  ${REDUP}${teks}${RESET}`);

// Mengambil keluaran perintah sebagai teks.
function baca(perintah) {
  return execSync(perintah, { encoding: "utf8" }).trim();
}

// Menjalankan perintah dan membiarkan keluarannya langsung terlihat.
function jalankan(perintah) {
  execSync(perintah, { stdio: "inherit" });
}

function berhenti(pesan, saran) {
  console.error(`\n${MERAH}✗ ${pesan}${RESET}`);
  if (saran) console.error(`  ${saran}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------

try {
  baca("git rev-parse --is-inside-work-tree");
} catch {
  berhenti("Folder ini bukan repositori git.", "Jalankan: git init");
}

let remote;
try {
  remote = baca("git remote get-url origin");
} catch {
  berhenti(
    "Belum ada remote bernama 'origin'.",
    "Jalankan: git remote add origin https://github.com/pengguna/repo.git"
  );
}

const cabang = baca("git rev-parse --abbrev-ref HEAD");

// ---------------------------------------------------------------------------
// 0. Segarkan snapshot katalog kalau sudah tua.
//
// Isi baris beranda dibaca pengunjung dari data/katalog.json, bukan dari TMDB
// langsung -- jadi kesegarannya bergantung pada snapshot ikut terkirim. Batas
// 20 jam (bukan 24) supaya push harian pada jam yang kira-kira sama tetap
// menyegarkan, tidak meleset gara-gara selisih beberapa menit.
//
// Gagal mengunduh TIDAK menggagalkan push: snapshot kemarin masih jauh lebih
// baik daripada perubahan kode yang tertahan di mesin ini.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";

const BATAS_SEGAR_JAM = 20;

let umurJam = Infinity;
try {
  const { generatedAt } = JSON.parse(readFileSync("data/katalog.json", "utf8"));
  umurJam = (Date.now() - Date.parse(generatedAt)) / 36e5;
} catch {
  /* belum ada snapshot sama sekali */
}

if (umurJam > BATAS_SEGAR_JAM) {
  kabar(umurJam === Infinity
    ? "Snapshot katalog belum ada; mengunduh dari TMDB..."
    : `Snapshot katalog berumur ${Math.round(umurJam)} jam; menyegarkan...`);
  try {
    jalankan("node scripts/snapshot.mjs");
    beres("Snapshot katalog segar");
  } catch {
    console.log(`${KUNING}! Snapshot gagal diunduh; memakai data lama.${RESET}`);
  }
} else {
  catat(`snapshot katalog masih segar (${Math.round(umurJam)} jam)`);
}

// ---------------------------------------------------------------------------
// 1. Build CSS lebih dulu.
//
// Ini bagian terpenting dari skrip ini. Tailwind di proyek ini di-BUILD ke
// src/output.css, bukan dimuat lewat CDN -- jadi kelas baru yang dipakai di
// script.js atau index.html tidak berefek apa-apa sampai dikompilasi. Push
// tanpa build berarti situs yang tayang memakai CSS lama: tata letaknya rusak
// tanpa satu pun galat yang muncul di mana pun. Karena itu build dijadikan
// bagian dari push, bukan langkah terpisah yang gampang terlupa.
// ---------------------------------------------------------------------------
kabar("Membangun CSS...");
try {
  jalankan("npm run build --silent");
} catch {
  berhenti("Build CSS gagal.", "Perbaiki galatnya dulu; tidak ada yang di-push.");
}
beres("CSS terbaru");

// ---------------------------------------------------------------------------
// 2. Apa yang berubah?
// ---------------------------------------------------------------------------
const status = baca("git status --porcelain");

// Dibungkus try, bukan dibungkam dengan "2>/dev/null": pengalihan itu sintaks
// shell Unix dan akan jadi galat di Windows cmd. Perintahnya sendiri memang
// gagal kalau cabang ini belum pernah ada di GitHub -- dan itu wajar.
let belumTerkirim = 0;
try {
  belumTerkirim = Number(baca(`git rev-list --count origin/${cabang}..${cabang}`)) || 0;
} catch {
  belumTerkirim = 0;
}

if (!status && !belumTerkirim) {
  console.log(`\n${KUNING}Tidak ada yang perlu dikirim.${RESET} Semuanya sudah sama dengan GitHub.`);
  process.exit(0);
}

if (status) {
  const baris = status.split("\n");
  kabar(`${baris.length} berkas berubah:`);

  // daftar panjang tidak menolong siapa pun; cukup sepuluh lalu diringkas
  baris.slice(0, 10).forEach((b) => catat(b));
  if (baris.length > 10) catat(`... dan ${baris.length - 10} berkas lain`);

  const pesan = process.argv[2] || `Update ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;

  jalankan("git add -A");

  // Pesan dilewatkan sebagai argumen terpisah, bukan disisipkan ke dalam string
  // perintah: tanda kutip atau karakter aneh di dalam pesan tidak boleh sampai
  // ditafsirkan oleh shell.
  execSync("git commit -F -", { input: pesan, stdio: ["pipe", "inherit", "inherit"] });
  beres(`Commit dibuat: "${pesan}"`);
} else {
  kabar(`Tidak ada perubahan baru, tapi ada ${belumTerkirim} commit yang belum terkirim.`);
}

// ---------------------------------------------------------------------------
// 3. Kirim.
// ---------------------------------------------------------------------------
kabar(`Mengirim ke ${remote} (cabang ${cabang})...`);
try {
  jalankan(`git push origin ${cabang}`);
} catch {
  berhenti(
    "Push ditolak.",
    "Biasanya karena ada perubahan di GitHub yang belum ada di sini.\n  Coba: git pull --rebase origin " + cabang
  );
}

console.log(`\n${HIJAU}✓ Selesai.${RESET} ${remote.replace(/\.git$/, "")}`);
