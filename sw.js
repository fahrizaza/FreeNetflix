// ---------------------------------------------------------------------------
// Service worker CinemaHub.
//
// Dua tugasnya: (1) memenuhi syarat browser supaya tombol "Install" muncul, dan
// (2) menyimpan berkas yang tidak pernah berubah supaya kunjungan berikutnya
// tidak mengunduhnya lagi.
//
// Yang SENGAJA TIDAK dilakukan: menyajikan kode aplikasi dari cache lebih dulu.
// Situs ini di-deploy dengan mengunggah berkas satu per satu, jadi cache yang
// tertinggal bisa memasangkan index.html baru dengan script.js lama -- persis
// jenis kerusakan yang bikin layar hitam, dan yang paling sulit dilacak karena
// tidak memunculkan galat apa pun. Karena itu kode aplikasi SELALU diambil dari
// jaringan dulu; cache hanya dipakai kalau jaringannya benar-benar mati.
// ---------------------------------------------------------------------------

// Dinaikkan setiap kali aturan di berkas ini berubah. Cache versi lama dihapus
// saat service worker baru aktif.
const VERSI = "cinemahub-v1";

// Cukup untuk memunculkan sesuatu saat offline, bukan untuk menjalankan seluruh
// aplikasi -- situs streaming memang tidak ada gunanya tanpa internet.
const KERANGKA = ["/", "/index.html", "/src/output.css", "/assets/icon-192.png"];

// Video hero tidak boleh masuk cache: ia sudah ditahan agar hanya
// diunduh di jaringan yang layak, dan menyimpannya membuang kuota penyimpanan
// pengguna demi sesuatu yang hanya jadi latar beranda.
const JANGAN_SIMPAN = /\.(mp4|webm)$/i;

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(VERSI)
      // addAll gagal total kalau SATU berkas gagal, dan itu membatalkan seluruh
      // pemasangan. Disimpan satu per satu supaya satu berkas meleset tidak
      // menggagalkan sisanya.
      .then((cache) => Promise.all(KERANGKA.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((nama) => Promise.all(nama.filter((n) => n !== VERSI).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Menyimpan salinan tanpa menahan jawabannya ke halaman.
function simpan(request, response) {
  if (!response || !response.ok) return response;

  const salinan = response.clone();
  caches.open(VERSI).then((cache) => cache.put(request, salinan).catch(() => {}));
  return response;
}

self.addEventListener("fetch", (e) => {
  const { request } = e;

  // Hanya GET biasa. Login Firebase, penyimpanan riwayat, dan apa pun yang
  // menulis data tidak boleh disentuh sama sekali.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Lewatkan apa adanya: TMDB, gambar poster, Firebase, dan halaman pemutar.
  // Semuanya lintas-domain dan berubah terus; mencampurinya hanya menambah
  // cara baru untuk rusak.
  if (url.origin !== self.location.origin) return;

  if (JANGAN_SIMPAN.test(url.pathname)) return;

  // Berkas di /assets/ -- ikon, foto profil, bunyi klik -- namanya tidak pernah
  // berganti isi. Aman diambil dari cache lebih dulu, dan di sinilah
  // penghematan yang sesungguhnya: 53 foto profil tidak perlu diunduh ulang.
  if (url.pathname.startsWith("/assets/")) {
    e.respondWith(
      caches.match(request).then(
        (tersimpan) =>
          tersimpan || fetch(request).then((res) => simpan(request, res))
      )
    );
    return;
  }

  // Sisanya -- HTML, CSS, kode aplikasi, dan katalog harian -- selalu dari
  // jaringan dulu. Cache murni jaring pengaman saat offline.
  e.respondWith(
    fetch(request)
      .then((res) => simpan(request, res))
      .catch(async () => {
        const tersimpan = await caches.match(request);
        if (tersimpan) return tersimpan;

        // Membuka halaman saat offline: beri kerangka yang tersimpan, bukan
        // galat browser bawaan.
        if (request.mode === "navigate") {
          const beranda = await caches.match("/index.html");
          if (beranda) return beranda;
        }

        return Response.error();
      })
  );
});
