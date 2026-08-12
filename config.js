// ---------------------------------------------------------------------------
// Konfigurasi katalog yang dipakai DUA dunia sekaligus:
//   - script.js  (browser) -- menggambar baris beranda
//   - scripts/snapshot.mjs (Node) -- mengunduh isinya sekali sehari
//
// Ditaruh di satu berkas justru karena keduanya harus sepakat. Kalau daftar
// baris disalin ke skrip pengunduh, cepat atau lambat keduanya melenceng:
// baris baru muncul di layar tapi tidak pernah ikut terunduh, dan kartunya
// selamanya skeleton. Di sini tidak boleh ada DOM, window, atau import
// browser -- Node harus bisa memuatnya apa adanya.
// ---------------------------------------------------------------------------

export const TMDB_KEY = "e514a26ed1063ffba53ecce04eeb969d";
export const TMDB = "https://api.themoviedb.org/3";
export const IMG = "https://image.tmdb.org/t/p";
export const REGION = "ID"; // dipakai untuk daftar layanan streaming

// Hanya judul yang benar-benar ada di layanan streaming Indonesia yang boleh
// tampil di beranda. TMDB bisa menyaringnya langsung lewat watch_region, jadi
// tidak perlu menembak detail satu per satu hanya untuk mengecek. Judul di luar
// itu tetap bisa ditemukan lewat kotak pencarian.
export const ONLY_STREAMABLE =
  `watch_region=${REGION}&with_watch_monetization_types=flatrate%7Cfree%7Cads%7Crent%7Cbuy`;

// 6 bulan terakhir, dipakai baris "Trending Now" dan "Baru Tayang"
export const SIX_MONTHS_AGO = new Date(Date.now() - 182 * 864e5).toISOString().slice(0, 10);

const movieRow = (key, title, extra) => ({
  key,
  title,
  path: `/discover/movie?${ONLY_STREAMABLE}&include_adult=false&${extra}`,
  type: "MOVIE",
});

const tvRow = (key, title, extra) => ({
  key,
  title,
  path: `/discover/tv?${ONLY_STREAMABLE}&include_adult=false&${extra}`,
  type: "SHOW",
});

// Baris beranda. Lima pertama dimuat langsung saat halaman dibuka; sisanya
// menyusul begitu tergulir mendekati layar (lihat EAGER_ROWS di script.js).
// Kunci baris harus unik SE-SITUS, bukan hanya di dalam satu bagian --
// fillRow mencari targetnya lewat [data-row="kunci"] di seluruh dokumen.
const ROWS = [
  {
    key: "trending",
    title: "Trending Now",
    path:
      `/discover/movie?${ONLY_STREAMABLE}&include_adult=false` +
      `&primary_release_date.gte=${SIX_MONTHS_AGO}&sort_by=popularity.desc`,
    type: "MOVIE",
  },
  {
    key: "series",
    title: "Serial Populer",
    path: `/discover/tv?${ONLY_STREAMABLE}&include_adult=false&sort_by=popularity.desc`,
    type: "SHOW",
  },
  {
    // vote_count.gte menyaring judul obskur/dewasa yang ikut terangkat
    // kalau hanya diurutkan berdasarkan popularitas
    key: "anime",
    title: "Anime",
    path:
      `/discover/tv?${ONLY_STREAMABLE}&with_genres=16&with_original_language=ja` +
      "&include_adult=false&vote_count.gte=200&sort_by=popularity.desc",
    type: "SHOW",
  },
  {
    key: "local",
    title: "Film Indonesia",
    path:
      `/discover/movie?${ONLY_STREAMABLE}&with_original_language=id` +
      "&include_adult=false&sort_by=popularity.desc",
    type: "MOVIE",
  },
  {
    key: "drakor",
    title: "Drama Korea",
    path:
      `/discover/movie?${ONLY_STREAMABLE}&with_original_language=ko` +
      "&include_adult=false&sort_by=popularity.desc",
    type: "MOVIE",
  },

  // ---- mulai dari sini dimuat malas (baris ke-6 dan seterusnya) ----
  movieRow("h-aksi", "Aksi Menegangkan", "with_genres=28&sort_by=popularity.desc"),
  movieRow("h-komedi", "Bikin Tertawa", "with_genres=35&sort_by=popularity.desc"),
  movieRow("h-horor", "Horor & Thriller", "with_genres=27&sort_by=popularity.desc"),
  movieRow("h-scifi", "Sci-Fi & Fantasi", "with_genres=878&sort_by=popularity.desc"),
];

export const SECTIONS = [
  { key: "home", label: "Home", rows: ROWS },
  {
    key: "series",
    label: "Series",
    rows: [
      tvRow("s-pop", "Serial Populer", "sort_by=popularity.desc"),
      tvRow("s-new", "Baru Tayang", `first_air_date.gte=${SIX_MONTHS_AGO}&sort_by=popularity.desc`),
      tvRow("s-anime", "Anime", "with_genres=16&with_original_language=ja&vote_count.gte=200&sort_by=popularity.desc"),
      tvRow("s-korea", "Drama Korea", "with_original_language=ko&sort_by=popularity.desc"),
      tvRow("s-ko-baru", "Drakor Baru", `with_original_language=ko&first_air_date.gte=${SIX_MONTHS_AGO}&sort_by=popularity.desc`),
      tvRow("s-ko-romantis", "Drakor Romantis", "with_original_language=ko&with_genres=18&sort_by=popularity.desc"),
      tvRow("s-crime", "Kriminal", "with_genres=80&sort_by=popularity.desc"),
      tvRow("s-local", "Serial Indonesia", "with_original_language=id&sort_by=popularity.desc"),
    ],
  },
  {
    key: "movies",
    label: "Movies",
    // Film Indonesia dan Korea sengaja dipecah per genre, bukan satu baris
    // campur: 15 judul "Film Indonesia" habis sekali gulir, sedangkan empat
    // baris bergenre memberi 60 judul tanpa terasa berulang.
    rows: [
      movieRow("m-pop", "Film Populer", "sort_by=popularity.desc"),
      movieRow("m-local", "Film Indonesia", "with_original_language=id&sort_by=popularity.desc"),
      movieRow("m-id-horor", "Horor Indonesia", "with_original_language=id&with_genres=27&sort_by=popularity.desc"),
      movieRow("m-id-drama", "Drama Indonesia", "with_original_language=id&with_genres=18&sort_by=popularity.desc"),
      movieRow("m-id-komedi", "Komedi Indonesia", "with_original_language=id&with_genres=35&sort_by=popularity.desc"),
      movieRow("m-korea", "Film Korea", "with_original_language=ko&sort_by=popularity.desc"),
      movieRow("m-ko-aksi", "Aksi Korea", "with_original_language=ko&with_genres=28&sort_by=popularity.desc"),
      movieRow("m-ko-romantis", "Romantis Korea", "with_original_language=ko&with_genres=10749&sort_by=popularity.desc"),
      movieRow("m-action", "Aksi", "with_genres=28&sort_by=popularity.desc"),
      movieRow("m-horror", "Horor", "with_genres=27&sort_by=popularity.desc"),
      movieRow("m-comedy", "Komedi", "with_genres=35&sort_by=popularity.desc"),
      movieRow("m-romance", "Romantis", "with_genres=10749&sort_by=popularity.desc"),
      movieRow("m-thriller", "Thriller", "with_genres=53&sort_by=popularity.desc"),
      movieRow("m-anim", "Animasi", "with_genres=16&sort_by=popularity.desc"),
    ],
  },
  {
    key: "new",
    label: "New & Popular",
    rows: [
      movieRow("n-movie", "Film Baru", `primary_release_date.gte=${SIX_MONTHS_AGO}&sort_by=popularity.desc`),
      tvRow("n-tv", "Serial Baru", `first_air_date.gte=${SIX_MONTHS_AGO}&sort_by=popularity.desc`),
      movieRow("n-top", "Nilai Tertinggi", "vote_count.gte=500&sort_by=vote_average.desc"),
      tvRow("n-toptv", "Serial Nilai Tertinggi", "vote_count.gte=300&sort_by=vote_average.desc"),
    ],
  },
];

// ---------------------------------------------------------------------------
// Gambar yang disalin ke hosting sendiri
//
// katalog.json TETAP menyimpan URL TMDB yang asli, bukan jalur lokal. Yang
// disimpan hanya penanda backdropLocal / logoLocal: "salinan lokal untuk URL
// ini sudah ada". Jalurnya dihitung ulang dari URL itu lewat gambarLokal().
//
// Dibuat begitu supaya scripts/gambar.mjs boleh dijalankan berkali-kali tanpa
// merusak apa pun: kalau jalurnya yang ditulis, jalankan kedua kalinya skrip
// itu akan membaca jalur lokal dan kehilangan alamat asalnya di TMDB.
// Penanda juga membuat kegagalan unduh jadi tidak berbahaya -- penandanya
// tidak dipasang, dan kartunya jatuh kembali ke TMDB dengan sendirinya.
// ---------------------------------------------------------------------------
export const GAMBAR_DIR = "assets/img";

// Kartu di baris lebarnya paling besar 240px CSS; 480 memberi ketajaman penuh
// di layar 2x tanpa mengunduh piksel yang tidak pernah terlihat.
export const LEBAR_KARTU = 480;

// Hero, latar pemutar, dan panggung modal detail. Sama dengan w780 TMDB yang
// dipakai sebelumnya, jadi tidak ada penurunan ketajaman di mana pun.
export const LEBAR_BESAR = 780;

export const LEBAR_LOGO = 400;

// URL TMDB -> jalur berkas lokal. Nama berkasnya diambil dari nama berkas TMDB,
// yang sudah unik per gambar: kalau sampul sebuah judul diganti, TMDB memberi
// nama baru, jadi tidak ada cache basi yang perlu diurus.
export function gambarLokal(url, jenis, lebar) {
  if (!url) return "";

  const nama = url.split("/").pop().replace(/\.[^.]+$/, "");
  if (!nama) return "";

  return `${GAMBAR_DIR}/${jenis}/${nama}-${lebar}.webp`;
}

// Bentuk baku sebuah judul di seluruh aplikasi. Snapshot menyimpan persis
// bentuk ini supaya browser bisa memakainya tanpa diolah lagi.
export function normalize(raw, forcedType = "") {
  const type = forcedType || (raw.media_type === "tv" ? "SHOW" : "MOVIE");
  const date = raw.release_date || raw.first_air_date || "";

  return {
    id: `${type === "SHOW" ? "tv" : "movie"}-${raw.id}`,
    tmdbId: raw.id,
    imdbId: "", // baru diambil saat modal dibuka (butuh satu request lagi)
    title: raw.title || raw.name || "Tanpa judul",
    year: date.slice(0, 4),
    runtime: 0, // tidak ada di hasil pencarian, diisi dari detail
    type,
    overview: raw.overview || "",
    poster: raw.poster_path ? `${IMG}/w500${raw.poster_path}` : "",
    backdrop: raw.backdrop_path ? `${IMG}/w780${raw.backdrop_path}` : "",
    // dipasang scripts/gambar.mjs kalau salinan lokalnya benar-benar jadi;
    // judul dari pencarian langsung tidak punya salinan, jadi tetap false
    backdropLocal: false,
    logoLocal: false,
    rating: raw.vote_average ? Math.round(raw.vote_average * 10) : null,
    logo: "",
    logoLoaded: false,
    genres: [],
    seasonCount: 0,
    episodeCount: 0,
    providers: [],
    providersLoaded: false, // beda dengan "tidak punya layanan": ini belum ditanyakan
    certs: null, // sertifikasi umur per negara, diisi readCert
    certLoaded: false,
    detailLoaded: false,
  };
}

// Logo judul: PNG berlatar transparan, dipakai menumpuk di atas backdrop
// seperti kartu Netflix. Urutan pilihan: bahasa Indonesia, Inggris, lalu yang
// tanpa bahasa; kalau sama, yang skornya paling tinggi.
export function pickLogo(logos) {
  if (!logos?.length) return "";

  const rank = (l) => (l.iso_639_1 === "id" ? 0 : l.iso_639_1 === "en" ? 1 : 2);
  const best = [...logos].sort(
    (a, b) => rank(a) - rank(b) || (b.vote_average || 0) - (a.vote_average || 0)
  )[0];

  return `${IMG}/w500${best.file_path}`;
}
