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

const ACTIVE_PROFILE_KEY = "netflix:profile";
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

export async function createProfile(name, pin = "") {
  if (profiles.length >= MAX_PROFILES) throw new Error(`Maksimal ${MAX_PROFILES} profil.`);

  const clean = String(name || "").trim();
  if (!clean) throw new Error("Nama profil tidak boleh kosong.");
  if (clean.length > 20) throw new Error("Nama profil maksimal 20 karakter.");

  const id = `prf_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const data = {
    name: clean,
    skin: PROFILE_SKINS[profiles.length % PROFILE_SKINS.length],
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

export async function renameProfile(id, name) {
  const clean = String(name || "").trim();
  if (!clean) throw new Error("Nama profil tidak boleh kosong.");

  await updateDoc(profileRef(id), { name: clean });
  const found = profiles.find((p) => p.id === id);
  if (found) found.name = clean;
}

// pin kosong = kunci dilepas, profil bisa langsung dibuka
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

export function hasPin(profile) {
  return Boolean(profile?.pinHash);
}

export async function checkPin(profile, pin) {
  if (!hasPin(profile)) return true;
  return (await hashPin(pin, profile.pinSalt)) === profile.pinHash;
}

// ---------- Profil aktif ----------
export function savedProfileId() {
  try {
    return localStorage.getItem(ACTIVE_PROFILE_KEY) || "";
  } catch {
    return "";
  }
}

function rememberProfile(id) {
  try {
    localStorage.setItem(ACTIVE_PROFILE_KEY, id);
  } catch {
    /* mode privat: sesi tetap jalan, cuma tidak diingat setelah reload */
  }
}

export function clearActiveProfile() {
  activeProfile = null;
  myList.clear();
  history.clear();
  try {
    localStorage.removeItem(ACTIVE_PROFILE_KEY);
  } catch {
    /* diabaikan */
  }
}

export async function enterProfile(id) {
  const profile = profiles.find((p) => p.id === id);
  if (!profile) throw new Error("Profil tidak ditemukan.");

  activeProfile = profile;
  rememberProfile(id);
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
    watchedAt: new Date().toISOString(),
    startedAt: before?.startedAt || new Date().toISOString(),
    playCount: (before?.playCount || 0) + 1,
  };

  history.set(item.id, entry);
  setDoc(historyRef(item.id), entry).catch((err) => console.error("Simpan riwayat gagal", err));

  evictHistory();
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
