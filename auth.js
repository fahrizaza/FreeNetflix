// ---------------------------------------------------------------------------
// Lapisan akun, profil, My List, dan riwayat tontonan -- semuanya di Firebase.
//
// Kenapa dipisah dari script.js: seluruh isi berkas ini yang berurusan dengan
// server. Kalau suatu saat pindah ke penyimpanan lain, yang diganti cuma di
// sini; script.js hanya memanggil fungsi-fungsi di bawah.
// ---------------------------------------------------------------------------
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
  EmailAuthProvider,
  reauthenticateWithCredential,
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyA6oj5w0N5PtazDzmfYNpciTXJpoLEff3U",
  authDomain: "cinema-hubs.firebaseapp.com",
  projectId: "cinema-hubs",
  storageBucket: "cinema-hubs.firebasestorage.app",
  messagingSenderId: "938022899622",
  appId: "1:938022899622:web:0cc9168e13f1f2b796c967",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export const MAX_PROFILES = 4;
export const MAX_HISTORY = 100;

// Pemutar mengabarkan posisi tontonan tiap beberapa detik. Menulis semuanya ke
// Firestore berarti ratusan tulisan per film, jadi salinan memori diperbarui
// seketika dan server menyusul paling cepat sekali per jeda ini.
const PROGRESS_WRITE_MS = 15000;

// Batas selisih posisi yang masih dianggap "benar-benar ditonton". Kabar posisi
// datang tiap beberapa detik; apa pun yang melompat lebih jauh dari ini pasti
// geseran, bukan tontonan.
const MAX_TICK_SEC = 60;

// disimpan sebagai kelas Tailwind utuh supaya bisa dipakai apa adanya saat
// menggambar; Tailwind hanya mengenali kelas yang tertulis literal
const PROFILE_SKINS = [
  "bg-gradient-to-br from-sky-400 to-blue-700",
  "bg-gradient-to-br from-amber-300 to-yellow-600",
  "bg-gradient-to-br from-rose-400 to-red-700",
  "bg-gradient-to-br from-emerald-300 to-emerald-700",
];

// ---------- Username sebagai email internal ----------
// Firebase Auth hanya mengenal email. Username diubah jadi alamat internal yang
// tidak pernah dikirimi surat, sehingga:
//   - login cukup username + password, sesuai permintaan
//   - gmail asli tidak perlu bisa dibaca publik untuk mencari akun
//   - keunikan username dijamin Firebase sendiri (email kembar ditolak), jadi
//     tidak ada celah balapan saat dua orang mendaftar bersamaan
const USERNAME_RE = /^[a-z0-9](?:[a-z0-9._]{1,18}[a-z0-9])$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function usernameKey(username) {
  return String(username || "").normalize("NFKC").trim().toLowerCase();
}

function usernameEmail(username) {
  return `${usernameKey(username)}@cinema-hubs.firebaseapp.com`;
}

// ---------- PIN ----------
// crypto.subtle hanya ada di konteks aman (https / localhost). Membuka berkas
// lewat file:// tidak termasuk, jadi dideteksi dan disampaikan apa adanya.
const hasCrypto = Boolean(globalThis.crypto?.subtle);

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

async function hashPin(pin, salt) {
  if (!hasCrypto) throw new Error("PIN butuh https atau localhost");
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  return toHex(await crypto.subtle.digest("SHA-256", data));
}

export function pinSupported() {
  return hasCrypto;
}

// ---------- Keadaan yang sedang aktif ----------
// Firestore itu asinkron, sedangkan render kartu memanggil isSaved() secara
// langsung. Jadi My List dan riwayat disalin ke memori sekali saat profil
// dibuka; tulisan ke server berjalan di belakang.
let account = null; // { uid, username, email }
let profiles = [];
let activeProfile = null;
const myList = new Map();
const history = new Map();

export function currentAccount() {
  return account;
}

export function currentProfile() {
  return activeProfile;
}

export function allProfiles() {
  return profiles;
}

// ---------- Daftar akun & masuk ----------
export function validateSignup({ username, email, password }) {
  const key = usernameKey(username);

  if (!USERNAME_RE.test(key)) {
    return "Username 3-20 karakter, hanya huruf, angka, titik, dan garis bawah.";
  }
  if (!EMAIL_RE.test(String(email || "").trim())) return "Format email tidak benar.";
  if (String(password || "").length < 8) return "Password minimal 8 karakter.";

  return "";
}

export async function signUp({ username, email, password }) {
  const problem = validateSignup({ username, email, password });
  if (problem) throw new Error(problem);

  const cred = await createUserWithEmailAndPassword(
    auth,
    usernameEmail(username),
    password
  );

  await setDoc(doc(db, "users", cred.user.uid), {
    username: String(username).trim(),
    usernameKey: usernameKey(username),
    email: String(email).trim(),
    createdAt: new Date().toISOString(),
  });

  return cred.user;
}

export async function signIn({ username, password }) {
  if (!usernameKey(username) || !password) throw new Error("Username dan password wajib diisi.");
  const cred = await signInWithEmailAndPassword(auth, usernameEmail(username), password);
  return cred.user;
}

export async function logout() {
  clearActiveProfile();
  account = null;
  profiles = [];
  myList.clear();
  history.clear();
  await fbSignOut(auth);
}

// Pesan bawaan Firebase berbahasa Inggris dan menyebut "email" padahal yang
// diisi user itu username -- diterjemahkan supaya tidak membingungkan.
export function authMessage(err) {
  const code = err?.code || "";

  if (code === "auth/email-already-in-use") return "Username itu sudah dipakai.";
  if (code === "auth/invalid-credential" || code === "auth/wrong-password") {
    return "Username atau password salah.";
  }
  if (code === "auth/user-not-found") return "Akun tidak ditemukan.";
  if (code === "auth/weak-password") return "Password minimal 8 karakter.";
  if (code === "auth/too-many-requests") return "Terlalu sering gagal. Coba lagi nanti.";
  if (code === "auth/network-request-failed") return "Koneksi bermasalah.";
  if (code === "auth/invalid-email") return "Username mengandung karakter yang tidak didukung.";

  return err?.message || "Terjadi kesalahan.";
}

// ---------- Admin ----------
// Akun dengan username ini bisa melihat aktivitas seluruh akun.
//
// PENTING, dan tolong jangan dianggap remeh: pemeriksaan di bawah hanya
// menentukan apakah TOMBOLNYA muncul. Ia bukan pengaman. Aplikasi ini tidak
// punya server -- semua pembacaan Firestore berangkat langsung dari browser --
// jadi siapa pun yang membuka DevTools bisa memanggil listAccounts() sendiri
// tanpa peduli username-nya siapa.
//
// Yang benar-benar menjaga data adalah Firestore Security Rules. Berkas
// firestore.rules di repo ini berisi aturan yang menegakkannya di sisi server;
// selama aturan itu belum dipasang di Firebase Console, panel ini akan ditolak
// Firestore -- dan itu memang perilaku yang benar.
const ADMIN_USERNAME = "admin";

export function isAdmin() {
  return usernameKey(account?.username) === ADMIN_USERNAME;
}

// Daftar seluruh akun terdaftar. Hanya berhasil kalau aturan Firestore
// mengizinkan admin membaca koleksi users.
export async function listAccounts() {
  const snap = await getDocs(collection(db, "users"));

  return snap.docs
    .map((d) => ({ uid: d.id, ...d.data() }))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

// Seluruh profil sebuah akun beserta riwayat tontonannya.
//
// Riwayat tiap profil diambil bersamaan, bukan berurutan: satu akun bisa punya
// empat profil, dan menunggu satu per satu membuat panelnya terasa menggantung
// tanpa alasan.
export async function accountActivity(uid) {
  const snap = await getDocs(collection(db, "users", uid, "profiles"));

  const profil = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  return Promise.all(
    profil.map(async (p) => {
      const riwayat = await getDocs(collection(db, "users", uid, "profiles", p.id, "history"));

      return {
        ...p,
        history: riwayat.docs
          .map((d) => d.data())
          .sort((a, b) => String(b.watchedAt).localeCompare(String(a.watchedAt))),
      };
    })
  );
}

// ---------- Profil ----------
function profileRef(id) {
  return doc(db, "users", account.uid, "profiles", id);
}

export async function loadProfiles() {
  const snap = await getDocs(collection(db, "users", account.uid, "profiles"));

  profiles = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

  return profiles;
}

// Profil anak: kids menyalakan batas umurnya, maturity menyimpan batasnya.
// Keduanya dipisah supaya melepas centang tidak menghapus pilihan sebelumnya.
//
// Angkanya umur penonton paling tua yang masih boleh -- 7 dipakai untuk pilihan
// "di bawah 13 tahun" karena itu tingkat sertifikasi yang ada di bawah 13 (SU
// dan PG/TV-Y7). Yang pertama jadi bawaan, jadi centang baru selalu jatuh ke
// pilihan paling ketat.
export const MATURITY_LEVELS = [7, 13, 18];

function cleanName(name) {
  const clean = String(name || "").trim();
  if (!clean) throw new Error("Nama profil tidak boleh kosong.");
  if (clean.length > 20) throw new Error("Nama profil maksimal 20 karakter.");
  return clean;
}

export function isKids(profile) {
  return Boolean(profile?.kids);
}

// 0 = tanpa batas. Dibaca saat menyusun baris beranda dan menyaring pencarian.
export function maturityLimit(profile = activeProfile) {
  if (!isKids(profile)) return 0;
  return MATURITY_LEVELS.includes(profile.maturity) ? profile.maturity : MATURITY_LEVELS[0];
}

export async function createProfile(name, pin = "", extra = {}) {
  if (profiles.length >= MAX_PROFILES) throw new Error(`Maksimal ${MAX_PROFILES} profil.`);

  const clean = cleanName(name);

  const id = `prf_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const data = {
    name: clean,
    skin: PROFILE_SKINS[profiles.length % PROFILE_SKINS.length],
    avatar: extra.avatar || "",
    kids: Boolean(extra.kids),
    maturity: MATURITY_LEVELS.includes(extra.maturity) ? extra.maturity : MATURITY_LEVELS[0],
    createdAt: new Date().toISOString(),
    pinSalt: null,
    pinHash: null,
  };

  if (pin) {
    data.pinSalt = randomSalt();
    data.pinHash = await hashPin(pin, data.pinSalt);
  }

  await setDoc(profileRef(id), data);
  profiles.push({ id, ...data });
  return id;
}

// Nama, foto, dan status profil anak disimpan sekaligus: ketiganya diubah dari
// formulir yang sama, jadi satu tulisan sudah cukup.
export async function updateProfile(id, { name, avatar, kids, maturity }) {
  const patch = { name: cleanName(name) };

  if (avatar !== undefined) patch.avatar = avatar || "";
  if (kids !== undefined) patch.kids = Boolean(kids);
  if (maturity !== undefined) {
    patch.maturity = MATURITY_LEVELS.includes(maturity) ? maturity : MATURITY_LEVELS[0];
  }

  await updateDoc(profileRef(id), patch);

  const found = profiles.find((p) => p.id === id);
  if (found) Object.assign(found, patch);
}

// pin kosong = kunci dilepas, profil bisa langsung dibuka
// Membuktikan bahwa yang di depan layar memang pemilik akunnya, dengan meminta
// password akun. Dipakai saat PIN profil dilupakan.
//
// Memakai reauthenticate, bukan signIn ulang: signIn akan memicu
// onAuthStateChanged, dan seluruh aplikasi akan dibangun ulang dari nol di
// tengah alur reset. Reauthenticate memverifikasi tanpa menyentuh sesi.
//
// Email diambil dari auth.currentUser, bukan disusun ulang dari username --
// itu persis alamat yang dipegang Firebase, jadi tidak bisa meleset karena
// perbedaan penulisan username.
export async function verifyAccountPassword(password) {
  const user = auth.currentUser;
  if (!user?.email) throw new Error("Sesi sudah berakhir. Masuk ulang.");
  if (!password) throw new Error("Password wajib diisi.");

  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
  return true;
}

export async function setProfilePin(id, pin) {
  const patch = pin
    ? { pinSalt: randomSalt(), pinHash: "" }
    : { pinSalt: null, pinHash: null };

  if (pin) patch.pinHash = await hashPin(pin, patch.pinSalt);

  await updateDoc(profileRef(id), patch);
  const found = profiles.find((p) => p.id === id);
  if (found) Object.assign(found, patch);
}

export async function deleteProfile(id) {
  // subkoleksi tidak ikut terhapus otomatis, jadi dibersihkan lebih dulu
  for (const sub of ["mylist", "history"]) {
    const snap = await getDocs(collection(db, "users", account.uid, "profiles", id, sub));
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  }

  await deleteDoc(profileRef(id));
  profiles = profiles.filter((p) => p.id !== id);

  if (activeProfile?.id === id) clearActiveProfile();
}

// ---------- Pengaturan tampilan ----------
// Ditumpangkan ke dokumen profil, bukan localStorage: pilihannya melekat pada
// profilnya -- profil anak bisa menyaring ketat sementara profil lain tidak --
// dan tetap sama saat dibuka dari perangkat lain.
//
// Bawaannya menyaring: hasil pencarian TMDB penuh judul tanpa gambar dan judul
// yang tidak ada di layanan mana pun, dan itu yang paling sering bukan yang
// dicari.
export const DEFAULT_SETTINGS = {
  showNoThumb: false, // tampilkan judul tanpa gambar
  showCam: false, // tampilkan judul yang belum ada di layanan streaming (CAM)

  // Perhatikan arahnya berbeda dari dua di atas: yang ini "sembunyikan", bukan
  // "tampilkan". Bawaannya false berarti film lama TETAP TAMPIL -- tidak ada
  // yang disembunyikan sampai penonton sendiri yang menyalakannya.
  hideOld: false,

  // Panduan singkat saat pertama kali menonton. Disimpan per profil, bukan per
  // perangkat: yang perlu diajari itu orangnya, dan tiap anggota keluarga punya
  // profilnya sendiri.
  tourSeen: false,

  // Mematikan trailer otomatis di halaman film; yang tampil hanya gambar diam.
  //
  // Ada karena satu batas yang tidak bisa kita lewati: trailer datang dari
  // YouTube, dan YouTube kadang menyisipkan iklan lengkap dengan tombol "Skip
  // Ad" yang MENGABAIKAN controls=0. Kita sudah mengenali iklan dan memudarkan
  // pemutarnya, tapi pengenalan itu bergantung pada kabar yang dikirim YouTube
  // -- dan tidak ada yang bisa menjamin kabar itu selalu datang.
  //
  // Sakelar ini satu-satunya jaminan mutlak: tidak ada iframe YouTube sama
  // sekali, jadi tidak ada antarmuka YouTube yang bisa muncul.
  noTrailer: false,
};

export function settings() {
  return { ...DEFAULT_SETTINGS, ...(activeProfile?.settings || {}) };
}

export function updateSettings(patch) {
  if (!activeProfile) return { ...DEFAULT_SETTINGS };

  const next = { ...settings(), ...patch };

  // activeProfile itu objek yang sama dengan isi profiles, jadi satu penetapan
  // ini sudah membuat seluruh tampilan membaca nilai baru
  activeProfile.settings = next;

  updateDoc(profileRef(activeProfile.id), { settings: next }).catch((err) =>
    console.error("Simpan pengaturan gagal", err)
  );

  return next;
}

export function hasPin(profile) {
  return Boolean(profile?.pinHash);
}

export async function checkPin(profile, pin) {
  if (!hasPin(profile)) return true;
  return (await hashPin(pin, profile.pinSalt)) === profile.pinHash;
}

// ---------- Profil aktif ----------
// Profil terakhir sengaja tidak diingat lagi: membuka situs selalu berhenti di
// pemilih profil dulu. Menyimpannya jadi tidak ada gunanya -- tidak ada satu pun
// yang membacanya -- dan justru menyisakan jejak profil mana yang dipakai di
// perangkat bersama.
export function clearActiveProfile() {
  // posisi yang masih mengantre ditulis selagi profilnya masih aktif; setelah
  // ini historyRef() tidak punya tujuan lagi
  flushProgress();

  activeProfile = null;
  myList.clear();
  history.clear();
}

export async function enterProfile(id) {
  const profile = profiles.find((p) => p.id === id);
  if (!profile) throw new Error("Profil tidak ditemukan.");

  // wajib sebelum activeProfile berpindah: antrean yang tersisa milik profil
  // lama, dan historyRef() selalu menunjuk profil yang sedang aktif
  flushProgress();

  activeProfile = profile;
  await loadProfileData();
  return profile;
}

async function loadProfileData() {
  myList.clear();
  history.clear();

  const base = ["users", account.uid, "profiles", activeProfile.id];
  const [listSnap, histSnap] = await Promise.all([
    getDocs(collection(db, ...base, "mylist")),
    getDocs(collection(db, ...base, "history")),
  ]);

  listSnap.docs.forEach((d) => myList.set(d.id, d.data()));
  histSnap.docs.forEach((d) => history.set(d.id, d.data()));
}

// ---------- My List ----------
function listRef(itemId) {
  return doc(db, "users", account.uid, "profiles", activeProfile.id, "mylist", itemId);
}

export function isSaved(id) {
  return myList.has(id);
}

export function savedItems() {
  return [...myList.values()].sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
}

// Tulisan ke server sengaja tidak ditunggu: tampilan berubah seketika, dan
// kalau gagal cuma dicatat di console -- salinan memori tetap benar.
export function toggleSaved(item) {
  if (!activeProfile) return false;

  if (myList.has(item.id)) {
    myList.delete(item.id);
    deleteDoc(listRef(item.id)).catch((err) => console.error("Hapus My List gagal", err));
    return false;
  }

  const entry = {
    id: item.id,
    tmdbId: item.tmdbId,
    imdbId: item.imdbId || "",
    title: item.title,
    year: item.year || "",
    type: item.type,
    backdrop: item.backdrop || "",
    poster: item.poster || "",
    savedAt: new Date().toISOString(),
  };

  myList.set(item.id, entry);
  setDoc(listRef(item.id), entry).catch((err) => console.error("Simpan My List gagal", err));
  return true;
}

// ---------- Riwayat tontonan ----------
function historyRef(itemId) {
  return doc(db, "users", account.uid, "profiles", activeProfile.id, "history", itemId);
}

export function historyItems() {
  return [...history.values()].sort((a, b) =>
    String(b.watchedAt).localeCompare(String(a.watchedAt))
  );
}

// Dikunci per judul, bukan per episode: satu serial muncul sekali di baris
// "Lanjutkan Menonton" dengan episode terakhir, bukan berderet sepanjang
// jumlah episode yang pernah dibuka.
export function recordPlay(item, ep = null) {
  if (!activeProfile) return;

  const before = history.get(item.id);

  // Posisi hanya berarti untuk tayangan yang sama. Membuka episode lain berarti
  // posisi lama tidak lagi berlaku dan hitungannya mulai dari nol.
  const key = playKey(ep);
  const sameTitle = before?.progressKey === key;

  const entry = {
    id: item.id,
    tmdbId: item.tmdbId,
    imdbId: item.imdbId || "",
    title: item.title,
    year: item.year || "",
    type: item.type,
    backdrop: item.backdrop || "",
    poster: item.poster || "",
    logo: item.logo || before?.logo || "",
    season: ep ? ep.season : null,
    episode: ep ? ep.number : null,
    episodeName: ep?.name || "",
    progressKey: key,
    progressSec: sameTitle ? before.progressSec || 0 : 0,
    durationSec: sameTitle ? before.durationSec || 0 : 0,
    progressAt: sameTitle ? before.progressAt || "" : "",

    // Total lama menonton judul ini, menumpuk sepanjang waktu.
    //
    // Harus disalin ulang di sini karena entry dibangun dari nol, bukan dari
    // penyebaran before -- kalau terlewat, hitungannya kembali nol tiap kali
    // tombol Play ditekan. Berbeda dengan progressSec, angka ini TIDAK pernah
    // dinolkan saat pindah episode: yang sudah ditonton tetap sudah ditonton.
    watchedSec: before?.watchedSec || 0,

    watchedAt: new Date().toISOString(),
    startedAt: before?.startedAt || new Date().toISOString(),
    playCount: (before?.playCount || 0) + 1,
  };

  history.set(item.id, entry);
  setDoc(historyRef(item.id), entry).catch((err) => console.error("Simpan riwayat gagal", err));

  evictHistory();
}

// ---------- Posisi tontonan ----------
// Ditumpangkan ke dokumen riwayat judulnya, bukan koleksi baru: satu judul tetap
// satu dokumen, jadi aturan keamanan, batas MAX_HISTORY, dan pembersihan saat
// profil dihapus semuanya ikut yang sudah ada.
//
// Yang diingat cuma satu posisi per judul, sejalan dengan baris "Lanjutkan
// Menonton" yang juga hanya menampilkan satu episode terakhir per serial.

// Penanda tayangan yang posisinya sedang disimpan. Film tidak punya episode,
// jadi kuncinya tetap satu nilai supaya perbandingannya tidak perlu bercabang.
export function playKey(ep) {
  return ep ? `s${ep.season}e${ep.number}` : "movie";
}

export function progressOf(itemId) {
  const entry = history.get(itemId);
  if (!entry?.progressSec) return null;

  return {
    key: entry.progressKey || "movie",
    seconds: entry.progressSec,
    duration: entry.durationSec || 0,
    at: entry.progressAt || entry.watchedAt || "",
  };
}

// Dipanggil tiap kabar posisi dari pemutar. Salinan memori langsung benar
// (tampilan ikut seketika), tulisan ke Firestore diantre oleh flushProgress.
export function recordProgress(itemId, ep, seconds, duration = 0) {
  if (!activeProfile) return null;

  // hanya judul yang sudah tercatat lewat recordPlay -- tanpa itu tidak ada
  // dokumen riwayat untuk ditumpangi
  const before = history.get(itemId);
  if (!before) return null;

  const key = playKey(ep);
  const sameTitle = before.progressKey === key;
  const now = new Date().toISOString();
  const posisi = Math.max(0, Math.round(seconds));

  // Selisih posisi antara dua kabar berturut-turut kira-kira sama dengan waktu
  // yang benar-benar ditonton. Kabar datang tiap beberapa detik, jadi selisih
  // yang wajar hanya sekian detik.
  //
  // Yang di luar rentang itu dibuang, dan justru inilah inti perhitungannya:
  //   - lompat maju (skip iklan, geser ke tengah) menghasilkan selisih besar
  //     yang bukan tontonan
  //   - melanjutkan dari posisi tersimpan menghasilkan lompatan sekali di awal
  //   - mundur menghasilkan selisih negatif
  // Tanpa saringan ini, satu geseran ke akhir film akan tercatat sebagai
  // "menonton dua jam".
  const maju = posisi - (before.progressSec || 0);
  const wajar = maju > 0 && maju <= MAX_TICK_SEC;

  const entry = {
    ...before,
    progressKey: key,
    progressSec: posisi,
    watchedSec: (before.watchedSec || 0) + (wajar ? maju : 0),
    // durasi kadang belum ikut di kabar pertama; yang lama dipertahankan selama
    // masih tayangan yang sama
    durationSec: Math.max(0, Math.round(duration)) || (sameTitle ? before.durationSec || 0 : 0),
    progressAt: now,
    watchedAt: now,
  };

  history.set(itemId, entry);
  dirtyProgress.add(itemId);
  if (!progressTimer) progressTimer = setTimeout(flushProgress, PROGRESS_WRITE_MS);

  return entry;
}

const dirtyProgress = new Set();
let progressTimer = null;

// Menulis posisi yang mengantre sekarang juga. Dipanggil otomatis tiap
// PROGRESS_WRITE_MS, dan dari script.js saat pemutar ditutup atau tab
// ditinggalkan -- momen ketika menunggu jeda berikutnya berisiko kehilangan
// posisi terakhir.
export function flushProgress() {
  clearTimeout(progressTimer);
  progressTimer = null;

  const ids = [...dirtyProgress];
  dirtyProgress.clear();
  if (!activeProfile) return;

  ids.forEach((id) => {
    const entry = history.get(id);
    if (!entry) return;
    setDoc(historyRef(id), entry).catch((err) => console.error("Simpan posisi gagal", err));
  });
}

// Riwayat tumbuh tanpa batas kalau dibiarkan; yang paling lama tidak ditonton
// dibuang lebih dulu.
function evictHistory() {
  if (history.size <= MAX_HISTORY) return;

  const extra = historyItems().slice(MAX_HISTORY);
  extra.forEach((entry) => {
    history.delete(entry.id);
    deleteDoc(historyRef(entry.id)).catch(() => {});
  });
}

export function removeHistory(itemId) {
  history.delete(itemId);
  return deleteDoc(historyRef(itemId)).catch((err) =>
    console.error("Hapus riwayat gagal", err)
  );
}

// ---------- Pintu masuk ----------
// Dipanggil script.js sekali. Callback menerima null saat belum login.
export function onAuth(callback) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      account = null;
      profiles = [];
      activeProfile = null;
      myList.clear();
      history.clear();
      callback(null);
      return;
    }

    const snap = await getDoc(doc(db, "users", user.uid));
    const data = snap.exists() ? snap.data() : {};

    account = {
      uid: user.uid,
      username: data.username || user.email.split("@")[0],
      email: data.email || "",
    };

    await loadProfiles();
    callback(account);
  });
}
