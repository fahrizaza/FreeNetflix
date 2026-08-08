// TMDB dipakai karena mengirim header CORS "*", jadi bisa dipanggil langsung
// dari browser di domain mana pun -- tidak perlu proxy seperti API sebelumnya.
import * as Auth from "./auth.js";

const TMDB_KEY = "e514a26ed1063ffba53ecce04eeb969d";
const TMDB = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p";
const REGION = "ID"; // dipakai untuk daftar layanan streaming
const PLAYER = "https://nextgencloudfabric.com/embed";
const STORAGE_KEY = "netflix:saved";

// Hanya judul yang benar-benar ada di layanan streaming Indonesia yang boleh
// tampil di beranda. TMDB bisa menyaringnya langsung lewat watch_region, jadi
// tidak perlu menembak detail satu per satu hanya untuk mengecek. Judul di luar
// itu tetap bisa ditemukan lewat kotak pencarian.
const ONLY_STREAMABLE =
  `watch_region=${REGION}&with_watch_monetization_types=flatrate%7Cfree%7Cads%7Crent%7Cbuy`;

// 6 bulan terakhir, dipakai baris "Trending Now"
const SIX_MONTHS_AGO = new Date(Date.now() - 182 * 864e5).toISOString().slice(0, 10);

const ROWS = [
  {
    key: "next",
    title: "Your Next Watch",
    path: `/discover/movie?${ONLY_STREAMABLE}&include_adult=false&sort_by=popularity.desc`,
    type: "MOVIE",
    top10: true,
  },
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
];

// Menu navbar. Tiap bagian punya kumpulan barisnya sendiri; dimuat sekali saat
// pertama dibuka, lalu tinggal ditampilkan-sembunyikan tanpa menembak TMDB lagi.
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

const SECTIONS = [
  { key: "home", label: "Home", rows: ROWS },
  {
    key: "series",
    label: "Series",
    rows: [
      tvRow("s-pop", "Serial Populer", "sort_by=popularity.desc"),
      tvRow("s-new", "Baru Tayang", `first_air_date.gte=${SIX_MONTHS_AGO}&sort_by=popularity.desc`),
      tvRow("s-anime", "Anime", "with_genres=16&with_original_language=ja&vote_count.gte=200&sort_by=popularity.desc"),
      tvRow("s-korea", "Drama Korea", "with_original_language=ko&sort_by=popularity.desc"),
      tvRow("s-crime", "Kriminal", "with_genres=80&sort_by=popularity.desc"),
      tvRow("s-local", "Serial Indonesia", "with_original_language=id&sort_by=popularity.desc"),
    ],
  },
  {
    key: "movies",
    label: "Movies",
    rows: [
      movieRow("m-pop", "Film Populer", "sort_by=popularity.desc"),
      movieRow("m-action", "Aksi", "with_genres=28&sort_by=popularity.desc"),
      movieRow("m-horror", "Horor", "with_genres=27&sort_by=popularity.desc"),
      movieRow("m-comedy", "Komedi", "with_genres=35&sort_by=popularity.desc"),
      movieRow("m-anim", "Animasi", "with_genres=16&sort_by=popularity.desc"),
      movieRow("m-local", "Film Indonesia", "with_original_language=id&sort_by=popularity.desc"),
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

// Semua judul yang pernah dimuat, dipakai saat kartu diklik.
const catalog = new Map();

// ---------- API ----------
async function tmdb(path) {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${TMDB}${path}${sep}api_key=${TMDB_KEY}`);
  if (!res.ok) throw new Error(`Request gagal (${res.status})`);
  return res.json();
}

// dipakai baris beranda maupun kotak pencarian
async function fetchList(path, forcedType = "") {
  const json = await tmdb(path);

  const items = (json.results || [])
    .filter((raw) => (forcedType ? true : raw.media_type === "movie" || raw.media_type === "tv"))
    .map((raw) => normalize(raw, forcedType));

  items.forEach((item) => catalog.set(item.id, item));
  return items;
}

function normalize(raw, forcedType = "") {
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
    rating: raw.vote_average ? Math.round(raw.vote_average * 10) : null,
    logo: "",
    logoLoaded: false,
    genres: [],
    seasonCount: 0,
    episodeCount: 0,
    providers: [],
    detailLoaded: false,
  };
}

// Logo judul: PNG berlatar transparan, dipakai menumpuk di atas backdrop
// seperti kartu Netflix. Urutan pilihan: bahasa Indonesia, Inggris, lalu yang
// tanpa bahasa; kalau sama, yang skornya paling tinggi.
// Trailer resmi terbaru diutamakan; teaser dipakai kalau trailer tidak ada.
// Banyak judul non-Inggris memang tidak punya video sama sekali -> "" dan
// pratinjaunya tetap gambar diam.
function pickTrailer(videos) {
  const usable = (videos || []).filter(
    (v) => v.site === "YouTube" && (v.type === "Trailer" || v.type === "Teaser")
  );
  if (!usable.length) return "";

  const rank = (v) => (v.type === "Trailer" ? 0 : 1) + (v.official ? 0 : 0.5);
  const best = [...usable].sort(
    (a, b) => rank(a) - rank(b) || String(b.published_at).localeCompare(String(a.published_at))
  )[0];

  return best.key;
}

function pickLogo(logos) {
  if (!logos?.length) return "";

  const rank = (l) => (l.iso_639_1 === "id" ? 0 : l.iso_639_1 === "en" ? 1 : 2);
  const best = [...logos].sort(
    (a, b) => rank(a) - rank(b) || (b.vote_average || 0) - (a.vote_average || 0)
  )[0];

  return `${IMG}/w500${best.file_path}`;
}

// Satu request mengambil semua yang kurang: durasi, genre, imdb_id untuk
// player, jumlah season, daftar layanan streaming, dan logo judul.
async function fetchDetail(item) {
  if (item.detailLoaded) return item;

  const kind = item.type === "SHOW" ? "tv" : "movie";
  // images ikut menumpang di request ini, jadi logo judul tidak menambah request
  const data = await tmdb(
    `/${kind}/${item.tmdbId}?append_to_response=external_ids,watch/providers,images,videos` +
      "&include_image_language=id,en,null"
  );

  item.trailer = pickTrailer(data.videos?.results);
  item.logo = pickLogo(data.images?.logos);
  item.logoLoaded = true; // kartu di baris ikut memakai hasil ini

  item.imdbId = data.external_ids?.imdb_id || "";
  item.overview = data.overview || item.overview;
  item.genres = (data.genres || []).map((g) => g.name);
  item.runtime = data.runtime || (data.episode_run_time || [])[0] || 0;

  if (item.type === "SHOW") {
    item.seasonCount = data.number_of_seasons || 0;
    item.episodeCount = data.number_of_episodes || 0;
    item.seasons = (data.seasons || [])
      .filter((s) => s.season_number > 0 && s.episode_count > 0)
      .map((s) => ({ number: s.season_number, count: s.episode_count }));
  }

  const region = data["watch/providers"]?.results?.[REGION] || {};
  const seen = new Set();
  item.providers = [...(region.flatrate || []), ...(region.rent || []), ...(region.buy || [])]
    .filter((p) => !seen.has(p.provider_name) && seen.add(p.provider_name))
    .map((p) => ({ name: p.provider_name, url: region.link || "#" }));

  item.detailLoaded = true;
  catalog.set(item.id, item);
  return item;
}

// ---------- Penyimpanan ----------
// isSaved / savedItems / historyItems dibaca dari salinan memori di auth.js,
// jadi tetap bisa dipanggil langsung saat menggambar kartu. Tulisannya ke
// Firestore berjalan di belakang.
function saveToggle(item) {
  const nowSaved = Auth.toggleSaved(item);
  renderSavedRow();
  return nowSaved;
}

function isSaved(id) {
  return Auth.isSaved(id);
}

function savedById(id) {
  return Auth.savedItems().find((entry) => entry.id === id) || null;
}

function historyById(id) {
  return Auth.historyItems().find((entry) => entry.id === id) || null;
}

// ---------- Util ----------
function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function duration(item) {
  if (!item.runtime) return "";
  if (item.type === "SHOW") return `${item.runtime}m / eps`;
  const h = Math.floor(item.runtime / 60);
  const m = item.runtime % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

// "23 menit" / "1 jam 5 menit" -- posisi tontonan selalu disebut dalam menit,
// detiknya tidak menambah apa pun bagi yang membacanya
function clockText(seconds) {
  const mins = Math.max(1, Math.round(seconds / 60));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h} jam ${m} menit` : `${m} menit`;
}

function timeAgo(iso) {
  const then = Date.parse(iso || "");
  if (!then) return "";

  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "baru saja";
  if (mins < 60) return `${mins} menit lalu`;

  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} jam lalu`;

  const days = Math.round(hours / 24);
  if (days < 30) return `${days} hari lalu`;

  const months = Math.round(days / 30);
  return months < 12 ? `${months} bulan lalu` : `${Math.round(months / 12)} tahun lalu`;
}

// Bagian tontonan yang sudah lewat, 0..1. Durasi dari pemutar yang dipakai lebih
// dulu; kalau kabarnya belum pernah membawa durasi, runtime TMDB jadi patokan
// (untuk serial angkanya memang per episode, jadi tetap sepadan).
function watchFraction(entry, runtimeMin = 0) {
  const seconds = entry?.progressSec || 0;
  if (!seconds) return 0;

  const total = entry.durationSec || runtimeMin * 60;
  return total ? Math.min(1, seconds / total) : 0;
}

// id IMDb valid: selalu diawali "tt" lalu angka (mis. tt15398776)
function validImdbId(id) {
  return /^tt\d{7,}$/.test(String(id || "").trim());
}

// Parameter yang ditempel ke URL player. Halaman embed meneruskan seluruh query
// string apa adanya ke player di dalamnya, jadi param baru cukup ditambah di
// sini -- tapi hanya berpengaruh kalau player-nya memang membaca param itu.
// Contoh kalau nanti ketemu nama param kualitas yang benar: quality: 1080
const PLAYER_PARAMS = { autoplay: 1 };

// Film  : https://streamimdb.ru/embed/movie/tt15398776?autoplay=1
// Serial : https://streamimdb.ru/embed/tv/tt0903747/2/5?autoplay=1  (season/episode)
function playerUrl(item, ep = null, resumeAt = 0) {
  if (!validImdbId(item.imdbId)) return "";

  const id = item.imdbId.trim();
  const query = new URLSearchParams(PLAYER_PARAMS);

  // detik tempat tontonan sebelumnya berhenti; pemutar yang membacanya akan
  // memulai dari sana, yang tidak akan memulai dari awal seperti biasa
  if (resumeAt > 0) query.set("resumeAt", Math.round(resumeAt));

  if (item.type === "SHOW") {
    const path = ep ? `tv/${id}/${ep.season}/${ep.number}` : `tv/${id}`;
    return `${PLAYER}/${path}?${query}`;
  }

  return `${PLAYER}/movie/${id}?${query}`;
}

// ---------- Daftar episode ----------
// Diambil per season supaya serial panjang tidak menarik ratusan episode
// sekaligus. Hasilnya di-cache per "tmdbId-season".
const episodeCache = new Map();

async function fetchSeason(tmdbId, season) {
  const key = `${tmdbId}-${season}`;
  if (episodeCache.has(key)) return episodeCache.get(key);

  const data = await tmdb(`/tv/${tmdbId}/season/${season}`);

  const episodes = (data.episodes || []).map((e) => ({
    season: e.season_number,
    number: e.episode_number,
    name: e.name || `Episode ${e.episode_number}`,
    runtime: e.runtime || 0,
    image: e.still_path ? `${IMG}/w300${e.still_path}` : "",
    summary: e.overview || "",
  }));

  episodeCache.set(key, episodes);
  return episodes;
}

// ---------- Kartu ----------
function cardTemplate(item, opts = {}) {
  const { top10 = false, logo = false, index = 0, grid = false, badge = "", progress = 0 } = opts;

  // dipakai baris "Lanjutkan Menonton" untuk menandai episode terakhir
  const epBadge = badge
    ? `<span class="absolute bottom-1.5 left-1.5 z-10 rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-bold">${esc(badge)}</span>`
    : "";

  // bilah merah setipis Netflix: seberapa jauh tontonan terakhir sampai. Dibatasi
  // 2% supaya awal yang baru sedikit tetap terlihat, bukan garis yang hilang.
  const bar =
    progress > 0
      ? `<div class="absolute inset-x-0 bottom-0 z-10 h-1 bg-white/25">
           <div class="h-full bg-red-600" style="width: ${Math.min(100, Math.max(2, progress * 100)).toFixed(1)}%"></div>
         </div>`
      : "";

  // di grid kartunya mengikuti lebar kolom; di baris geser lebarnya tetap
  const size = grid
    ? "w-full"
    : "w-[160px] shrink-0 snap-start sm:w-[200px] md:w-[240px]";

  // wadah logo dibiarkan kosong; diisi menyusul oleh loadLogos()
  const logoSlot = logo
    ? `<div data-logo class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-8"></div>`
    : "";

  const top10Badge = top10
    ? `<div class="absolute left-1 top-0 z-10 rounded-sm bg-red-600 px-1 py-0.5 text-center text-[9px] font-bold leading-none">TOP<br />10</div>`
    : "";

  const netflix = item.providers.some((p) => p.name === "Netflix")
    ? `<span class="absolute right-1.5 top-1.5 z-10 rounded-sm bg-red-600 px-1.5 py-0.5 text-[10px] font-bold">N</span>`
    : "";

  const image = item.backdrop
    ? `<img src="${esc(item.backdrop)}" alt="${esc(item.title)}" loading="lazy"
         class="h-full w-full object-cover transition duration-300 group-hover/card:scale-105" />`
    : `<div class="flex h-full w-full items-center justify-center px-3 text-center text-sm text-neutral-500">${esc(item.title)}</div>`;

  return `
    <button type="button" data-id="${esc(item.id)}" data-index="${index}"
      class="group/card relative ${size} text-left transition-transform duration-300 md:hover:z-30 md:hover:scale-110">
      <div class="relative aspect-video overflow-hidden rounded-md bg-neutral-800 transition duration-300 group-hover/card:ring-2 group-hover/card:ring-white/60">
        ${top10Badge}
        ${netflix}
        ${image}
        ${epBadge}
        ${bar}
        ${logoSlot}
        <div class="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent opacity-0 transition duration-300 group-hover/card:opacity-100"></div>
        <div class="absolute inset-x-0 bottom-0 translate-y-2 p-3 opacity-0 transition duration-300 group-hover/card:translate-y-0 group-hover/card:opacity-100">
          <p class="line-clamp-1 text-sm font-semibold">${esc(item.title)}</p>
          <p class="text-xs text-neutral-300">${esc(item.year)} ${item.rating ? `&middot; ${item.rating}% match` : ""}</p>
        </div>
      </div>
    </button>
  `;
}

function skeletonCard() {
  return `<div class="w-[160px] shrink-0 animate-pulse sm:w-[200px] md:w-[240px]"><div class="aspect-video rounded-md bg-neutral-800"></div></div>`;
}

// ---------- Baris ----------
function rowShell(key, title) {
  return `
    <section data-row="${esc(key)}" class="group/row relative mb-8 md:mb-10">
      <h2 class="mb-3 px-4 text-lg font-bold sm:text-xl md:px-8 md:text-2xl">${esc(title)}</h2>

      <button type="button" data-scroll="-1"
        class="absolute left-0 top-1/2 z-20 hidden h-24 w-8 -translate-y-1/2 items-center justify-center rounded-r-md bg-black/60 text-2xl opacity-0 transition group-hover/row:opacity-100 md:flex">&#8249;</button>

      <!-- py memberi ruang untuk kartu yang membesar saat hover; tanpa itu
           bagian atas-bawahnya terpotong karena overflow-x ikut memotong.
           scroll-pl wajib sepadan dengan px: snap-start menempel ke tepi
           scroll-port yang mengabaikan padding, jadi tanpa ini kartu pertama
           bergeser masuk begitu barisnya ter-snap dan tidak lagi sejajar
           dengan judul maupun baris yang isinya sedikit. -->
      <div data-track
        class="flex snap-x snap-mandatory gap-2 overflow-x-auto scroll-smooth scroll-pl-4 px-4 py-3 md:scroll-pl-8 md:px-8 md:py-5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        ${skeletonCard().repeat(6)}
      </div>

      <button type="button" data-scroll="1"
        class="absolute right-0 top-1/2 z-20 hidden h-24 w-8 -translate-y-1/2 items-center justify-center rounded-l-md bg-black/60 text-2xl opacity-0 transition group-hover/row:opacity-100 md:flex">&#8250;</button>
    </section>
  `;
}

// ---------- Logo di kartu ----------
// Logo tidak ikut di hasil /discover, jadi perlu satu request per judul.
// Supaya tidak menembak 20 sekaligus, diambil 10 dulu; sisanya menyusul saat
// kartu yang belum berlogo tergeser ke dalam layar.
const LOGO_BATCH = 5;
const rowItems = new Map();

async function fetchLogo(item) {
  if (item.logoLoaded) return item.logo;

  const kind = item.type === "SHOW" ? "tv" : "movie";
  try {
    const data = await tmdb(`/${kind}/${item.tmdbId}/images?include_image_language=id,en,null`);
    item.logo = pickLogo(data.logos);
  } catch (err) {
    item.logo = "";
    console.error(`Logo "${item.title}" gagal dimuat`, err);
  }

  item.logoLoaded = true;
  catalog.set(item.id, item);
  return item.logo;
}

function paintLogo(key, item) {
  const slot = document.querySelector(`[data-row="${key}"] [data-id="${item.id}"] [data-logo]`);
  if (!slot || !item.logo) return;

  slot.innerHTML = `<img src="${esc(item.logo)}" alt="${esc(item.title)}"
    class="max-h-10 w-auto max-w-[85%] object-contain drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)] sm:max-h-14 md:max-h-16" />`;
}

async function loadLogos(key, start) {
  const items = rowItems.get(key) || [];
  const batch = items.slice(start, start + LOGO_BATCH).filter((i) => !i.logoLoaded);
  if (!batch.length) return;

  await Promise.all(batch.map((item) => fetchLogo(item).then(() => paintLogo(key, item))));
}

// box  : wadah kartu yang diamati
// root : acuan IntersectionObserver -- baris geser memantau di dalam dirinya
//        sendiri, grid ikut gulir halaman jadi acuannya viewport (null)
function setupLogos(key, items, box = null, root = box) {
  rowItems.set(key, items);
  items.forEach((item) => item.logoLoaded && paintLogo(key, item)); // dari cache
  loadLogos(key, 0);

  const container = box || document.querySelector(`[data-row="${key}"] [data-track]`);
  if (!container) return;

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const index = Number(entry.target.dataset.index);
        if (!items[index]?.logoLoaded) loadLogos(key, index);
      }
    },
    { root: box ? root : container, threshold: 0.1 }
  );

  container.querySelectorAll("[data-index]").forEach((card) => io.observe(card));
}

function fillRow(key, items, opts = {}) {
  const track = document.querySelector(`[data-row="${key}"] [data-track]`);
  if (!track) return;

  if (!items.length) {
    track.innerHTML = `<p class="px-0 py-8 text-sm text-neutral-500">Tidak ada hasil.</p>`;
    return;
  }

  track.innerHTML = items
    .map((item, i) =>
      cardTemplate(item, {
        top10: opts.top10 && i < 3,
        logo: opts.logo,
        index: i,
        badge: opts.badgeOf ? opts.badgeOf(item) : "",
        progress: opts.progressOf ? opts.progressOf(item) : 0,
      })
    )
    .join("");

  if (opts.logo) setupLogos(key, items);
}

// ---------- Baris "My List" (dari id yang disimpan) ----------
function renderSavedRow() {
  const items = Auth.savedItems();
  const existing = document.querySelector('[data-row="saved"]');

  if (!items.length) {
    existing?.remove();
    return;
  }

  if (!existing) {
    homeBox().insertAdjacentHTML("afterbegin", rowShell("saved", "My List"));
  }

  // item tersimpan hanya menyimpan field ringkas -> lengkapi dari catalog bila ada
  fillRow(
    "saved",
    items.map((s) => catalog.get(s.id) || { ...s, providers: [], rating: null })
  );

  orderPinnedRows();
}

// ---------- Baris "Lanjutkan Menonton" (dari riwayat) ----------
function renderHistoryRow() {
  const items = Auth.historyItems();
  const existing = document.querySelector('[data-row="history"]');

  if (!items.length) {
    existing?.remove();
    return;
  }

  if (!existing) {
    homeBox().insertAdjacentHTML("afterbegin", rowShell("history", "Lanjutkan Menonton"));
  }

  // lewat fillRow seperti baris lain, supaya tata letaknya tidak bisa melenceng
  fillRow(
    "history",
    items.map((entry) => {
      const known = catalog.get(entry.id) || entry;
      return {
        ...known,
        providers: [],
        rating: null,
        // penanda episode terakhir, dibaca lagi oleh badgeOf di bawah
        lastEp: entry.type === "SHOW" && entry.season ? `S${entry.season}:E${entry.episode}` : "",
        // begitu juga bilah posisi tontonan, lewat progressOf
        lastProgress: watchFraction(entry, known.runtime || 0),
      };
    }),
    { logo: true, badgeOf: (item) => item.lastEp, progressOf: (item) => item.lastProgress }
  );

  orderPinnedRows();
}

// Dua baris ini disisipkan dengan afterbegin sehingga urutannya bergantung
// siapa yang menyisipkan terakhir. Diurutkan ulang supaya selalu tetap.
function orderPinnedRows() {
  const box = homeBox();
  const history = document.querySelector('[data-row="history"]');
  const saved = document.querySelector('[data-row="saved"]');

  if (saved) box.prepend(saved);
  if (history) box.prepend(history);
}

// ---------- Modal detail ----------
function stageImage(item) {
  return item.backdrop
    ? `<img src="${esc(item.backdrop)}" alt="${esc(item.title)}" class="h-full w-full object-cover" />`
    : `<div class="flex h-full w-full items-center justify-center bg-neutral-800 text-sm text-neutral-500">${esc(item.title)}</div>`;
}

// Posisi kartu yang barusan diklik. Modal tumbuh dari kotak itu, bukan muncul
// begitu saja di tengah -- jadi mata pengguna tidak kehilangan jejak asalnya.
let openFromRect = null;

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function animateDetailIn(modal) {
  const panel = modal.firstElementChild;
  if (!panel) return;

  modal.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "ease-out" });

  const ease = "cubic-bezier(.22,.8,.24,1)";

  if (!openFromRect || reducedMotion) {
    panel.animate(
      [
        { opacity: 0, transform: "scale(.96)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: reducedMotion ? 1 : 260, easing: ease }
    );
    return;
  }

  const to = panel.getBoundingClientRect();
  if (!to.width || !to.height) return;

  // dihitung dari titik tengah masing-masing, karena transform-origin
  // bawaannya juga titik tengah
  const dx = openFromRect.left + openFromRect.width / 2 - (to.left + to.width / 2);
  const dy = openFromRect.top + openFromRect.height / 2 - (to.top + to.height / 2);

  panel.animate(
    [
      {
        opacity: 0.4,
        transform: `translate(${dx}px, ${dy}px) scale(${openFromRect.width / to.width}, ${
          openFromRect.height / to.height
        })`,
      },
      { opacity: 1, transform: "none" },
    ],
    { duration: 380, easing: ease }
  );
}

// ---------- Trailer di pratinjau modal ----------
// Gambar tampil dulu sebentar, baru trailer memudar masuk -- sama seperti
// kelakuan Netflix, dan berguna: kalau langsung video, judul yang belum siap
// terlihat berkedip.
// gambar ditahan selama ini sebelum trailer ditampilkan; iframe sudah memuat
// sejak detik pertama, jadi jeda ini benar-benar dipakai untuk menyangga
const TRAILER_HOLD_MS = 5500;

let trailerTimer = null;
let trailerFallback = null;
let trailerPlaying = null; // dipanggil saat pemutar mengabarkan sudah jalan

function trailerAllowed() {
  const conn = navigator.connection || {};
  if (reducedMotion || conn.saveData) return false;
  return !/(^|-)(2g|slow-2g)$/.test(conn.effectiveType || "");
}

// Perintah ke pemutar YouTube lewat postMessage; enablejsapi=1 di URL yang
// membuatnya mau mendengarkan, jadi tidak perlu memuat pustaka apa pun.
function ytCommand(iframe, func) {
  iframe?.contentWindow?.postMessage(
    JSON.stringify({ event: "command", func, args: [] }),
    "*"
  );
}

// Pemutar YouTube mengabarkan statusnya lewat postMessage setelah menerima
// handshake "listening". Status 0 berarti selesai -- itu saat layar rekomendasi
// muncul, jadi trailernya dibuang tepat sebelum itu.
window.addEventListener("message", (e) => {
  let host = "";
  try {
    host = new URL(e.origin).hostname;
  } catch {
    return;
  }
  if (!/(^|\.)youtube(-nocookie)?\.com$/.test(host)) return;

  let data;
  try {
    data = JSON.parse(e.data);
  } catch {
    return;
  }
  // Pemutar sekarang mengabarkan status lewat "infoDelivery"; "onStateChange"
  // hanya muncul di versi lama. Keduanya diterima supaya tidak bergantung pada
  // versi pemutar yang kebetulan dilayani YouTube.
  if (data?.event !== "infoDelivery" && data?.event !== "onStateChange") return;

  const state = typeof data.info === "number" ? data.info : data.info?.playerState;
  if (state === 1) trailerPlaying?.(); // 1 = sedang berjalan
  if (state === 0) stopModalTrailer(); // 0 = habis (loop biasanya mencegah ini)
});

function clearTrailerTimers() {
  clearTimeout(trailerTimer);
  clearTimeout(trailerFallback);
  trailerTimer = null;
  trailerFallback = null;
  trailerPlaying = null;
}

function stopModalTrailer() {
  clearTrailerTimers();

  const modal = document.getElementById("modal");

  // cukup buang pembungkusnya: gambar backdrop tidak pernah dihapus, dia
  // memang selalu ada di lapisan bawah
  modal.querySelector("[data-trailer-wrap]")?.remove();

  const btn = modal.querySelector("[data-trailer-mute]");
  if (btn) {
    btn.classList.add("hidden");
    btn.classList.remove("flex");
  }
}

function startModalTrailer(item, modal) {
  if (!item.trailer || !trailerAllowed()) return;

  const stage = modal.querySelector("[data-stage]");
  const btn = modal.querySelector("[data-trailer-mute]");
  if (!stage || !btn) return;

  const key = encodeURIComponent(item.trailer);

  // loop wajib: tanpa itu, begitu trailer habis YouTube menampilkan layar
  // akhir berisi "More videos" dan deretan thumbnail.
  // playlist=<key> adalah syarat loop bekerja untuk video tunggal.
  // iv_load_policy=3 mematikan anotasi, fs=0 & disablekb=1 mematikan kontrol
  // yang tidak kita pakai.
  const src =
    `https://www.youtube-nocookie.com/embed/${key}` +
    `?autoplay=1&mute=1&controls=0&loop=1&playlist=${key}` +
    "&modestbranding=1&playsinline=1&rel=0&iv_load_policy=3&fs=0&disablekb=1&enablejsapi=1";

  // Iframe dipasang SEKARANG supaya mulai memuat, tapi masih bening dan
  // gambar tetap terlihat di bawahnya. Iframe dibuat 140% lalu dipusatkan,
  // dan wadahnya memotong luapannya -- yang terpotong justru bagian yang
  // mengganggu: bilah judul di tepi atas dan logo YouTube di tepi bawah.
  // Rasionya tetap 16:9 karena lebar dan tinggi dinaikkan sama besar.
  stage.insertAdjacentHTML(
    "beforeend",
    `<div data-trailer-wrap class="absolute inset-0 overflow-hidden">
       <iframe data-trailer src="${esc(src)}" title="Trailer ${esc(item.title)}"
         class="pointer-events-none absolute left-1/2 top-1/2 h-[140%] w-[140%] -translate-x-1/2 -translate-y-1/2 border-0 opacity-0 transition-opacity duration-700"
         allow="autoplay; encrypted-media" referrerpolicy="origin-when-cross-origin"></iframe>
     </div>`
  );

  const frame = stage.querySelector("[data-trailer]");
  let muted = true;

  const paint = () => {
    btn.innerHTML = muted ? SPEAKER_OFF : SPEAKER_ON;
    btn.title = muted ? "Nyalakan suara" : "Bisukan";
  };

  // Dua syarat yang harus sama-sama terpenuhi sebelum ditampilkan:
  // gambar sudah tertahan cukup lama, DAN videonya benar-benar sudah jalan.
  // Kalau hanya mengandalkan waktu, video yang lambat memuat akan muncul
  // sebagai bidang hitam.
  let playing = false;
  let held = false;

  const reveal = () => {
    if (!playing || !held || !frame.isConnected) return;
    frame.classList.add("opacity-100");
    btn.classList.remove("hidden");
    btn.classList.add("flex");
    paint();
  };

  trailerPlaying = () => {
    playing = true;
    reveal();
  };

  trailerTimer = setTimeout(() => {
    held = true;
    reveal();
  }, TRAILER_HOLD_MS);

  // Jaring pengaman: kalau kabar "sudah jalan" tidak pernah datang -- pemutar
  // gagal handshake, atau autoplay-nya ditolak -- tampilkan saja setelah lewat
  // batas ini. Lebih baik trailer yang masih menyangga daripada tidak pernah
  // muncul sama sekali.
  trailerFallback = setTimeout(() => {
    playing = true;
    held = true;
    reveal();
  }, TRAILER_HOLD_MS + 3500);

  // Handshake harus dikirim setelah pemutarnya siap, dan "load" pada iframe
  // belum tentu menandakan itu. Jadi dikirim beberapa kali dengan jeda.
  const greet = () =>
    frame.contentWindow?.postMessage(
      JSON.stringify({ event: "listening", id: "modal-trailer" }),
      "*"
    );

  frame.onload = () => {
    greet();
    [300, 900, 1800].forEach((ms) => setTimeout(() => frame.isConnected && greet(), ms));
  };

  btn.onclick = () => {
    muted = !muted;
    ytCommand(frame, muted ? "mute" : "unMute");
    paint();
  };
}

function openDetail(item) {
  const modal = document.getElementById("modal");
  firstEpisode = null;
  clearTrailerTimers();

  modal.className =
    "fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/80 p-2 py-4 sm:p-4 sm:py-10";
  modal.innerHTML = `
    <div class="w-full max-w-4xl overflow-hidden rounded-lg bg-[#181818] shadow-2xl">

      <!-- overflow-hidden wajib: iframe trailer diperbesar untuk menyembunyikan
           UI YouTube, dan tanpa ini kelebihannya menjulur menutupi bagian bawah -->
      <div class="relative aspect-video overflow-hidden bg-black">
        <div data-stage class="absolute inset-0 overflow-hidden">${stageImage(item)}</div>

        <!-- lapisan bening: klik tidak pernah sampai ke halaman embed -->
        <div data-shield class="absolute inset-0 z-10"></div>

        <div class="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-2/3 bg-gradient-to-t from-[#181818] via-[#181818]/60 to-transparent"></div>

        <button type="button" data-close
          class="absolute right-4 top-4 z-30 flex h-10 w-10 items-center justify-center rounded-full bg-[#181818] text-xl hover:bg-black">&times;</button>

        <button type="button" data-trailer-mute
          class="absolute right-16 top-4 z-30 hidden h-10 w-10 items-center justify-center rounded-full border border-white/50 bg-black/40 text-white transition hover:bg-black/70"></button>

        <div class="absolute inset-x-0 bottom-0 z-20 p-4 sm:p-6 md:p-10">
          <h3 data-title class="max-w-[80%] text-xl font-black tracking-tight drop-shadow-lg sm:text-3xl md:max-w-[70%] md:text-5xl">${esc(item.title)}</h3>

          <div class="mt-3 flex items-center gap-2 sm:mt-5 sm:gap-3">
            <button type="button" data-play disabled
              class="flex items-center gap-2 rounded bg-white px-4 py-1.5 text-sm font-bold text-black hover:bg-white/80 disabled:cursor-not-allowed disabled:opacity-40 sm:px-7 sm:py-2 sm:text-lg">
              <span class="leading-none sm:text-xl">&#9654;</span>
              <span data-play-label>Play</span>
            </button>

            <button type="button" data-save title="My List"
              class="flex h-9 w-9 items-center justify-center rounded-full border-2 border-neutral-400 bg-black/40 text-lg leading-none hover:border-white sm:h-10 sm:w-10 sm:text-xl"></button>

            <button type="button" data-like title="Suka"
              class="flex h-9 w-9 items-center justify-center rounded-full border-2 border-neutral-400 bg-black/40 text-sm hover:border-white sm:h-10 sm:w-10 sm:text-base">&#128077;</button>
          </div>

          <!-- diisi paintResume(): episode, posisi berhenti, dan kapan terakhir
               ditonton oleh profil yang sedang aktif -->
          <p data-resume class="mt-2 hidden text-xs text-neutral-300 drop-shadow sm:mt-3 sm:text-sm"></p>
        </div>
      </div>

      <div class="grid gap-6 p-4 sm:p-6 md:grid-cols-[2fr_1fr] md:gap-8 md:p-10 md:pt-6">
        <div class="space-y-4">
          <div class="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
            <span class="text-neutral-300">${esc(item.year)}</span>
            <span class="text-neutral-300">${item.type === "SHOW" ? "Series" : "Movie"}</span>
            <span data-duration class="text-neutral-300">${duration(item)}</span>
            <span data-eps-meta class="text-neutral-300"></span>
            <span data-quality title="Memuat info kualitas..."
              class="rounded border border-neutral-500 px-1.5 text-[11px] leading-5 text-neutral-300">HD</span>
            ${item.rating ? `<span class="font-semibold text-green-500">${item.rating}% match</span>` : ""}
          </div>

          ${
            item.rating >= 80
              ? `<p class="flex items-center gap-2 font-semibold">
                   <span class="flex h-6 w-6 items-center justify-center rounded bg-red-600 text-xs">&#128077;</span>
                   Most Liked
                 </p>`
              : ""
          }

          <p data-overview class="text-sm leading-relaxed text-neutral-200">
            ${esc(item.overview) || "Sinopsis belum tersedia."}
          </p>
        </div>

        <div class="space-y-4 text-sm">
          <p data-genres class="leading-relaxed"></p>
          <p data-providers class="leading-relaxed">
            <span class="text-neutral-500">Tonton di: </span>
            <span class="text-neutral-500">memuat...</span>
          </p>
          <p class="leading-relaxed">
            <span class="text-neutral-500">ID: </span>
            <span class="font-mono text-xs">${esc(item.id)}</span> &middot;
            <span data-imdb class="font-mono text-xs">-</span>
          </p>
        </div>
      </div>

      ${
        item.type === "SHOW"
          ? `<div data-episodes class="border-t border-neutral-800 p-4 sm:p-6 md:p-10 md:pt-6">
               <div class="mb-4 flex items-center justify-between gap-4">
                 <h4 class="text-xl font-bold sm:text-2xl">Episode</h4>
                 <select data-season
                   class="hidden cursor-pointer rounded border border-neutral-500 bg-[#242424] px-4 py-2 text-base font-semibold outline-none hover:border-white sm:px-5 sm:py-2.5 sm:text-lg"></select>
               </div>
               <div data-eplist class="space-y-1 text-sm text-neutral-500">Memuat daftar episode...</div>
             </div>`
          : ""
      }
    </div>
  `;

  const playBtn = modal.querySelector("[data-play]");
  const saveBtn = modal.querySelector("[data-save]");
  const likeBtn = modal.querySelector("[data-like]");

  const paintSave = () => {
    saveBtn.innerHTML = isSaved(item.id) ? "&#10003;" : "+";
  };

  modal.querySelector("[data-close]").onclick = closeDetail;
  modal.onclick = (e) => {
    if (e.target === modal) closeDetail();
  };

  paintSave();
  saveBtn.onclick = () => {
    saveToggle(item);
    paintSave();
  };

  likeBtn.onclick = () => {
    likeBtn.classList.toggle("border-white");
    likeBtn.classList.toggle("bg-white/20");
  };

  animateDetailIn(modal);

  // detail (durasi, genre, imdb_id, provider) butuh satu request lagi, jadi
  // modal ditampilkan dulu lalu diisi menyusul
  loadDetail(item, modal);
}

async function loadDetail(item, modal) {
  const alive = () => modal.innerHTML !== ""; // modal bisa keburu ditutup

  try {
    await fetchDetail(item);
  } catch (err) {
    console.error("Gagal memuat detail", err);
    if (alive()) {
      modal.querySelector("[data-providers]").innerHTML =
        `<span class="text-neutral-500">Detail gagal dimuat.</span>`;
    }
    return;
  }

  if (!alive()) return;

  const set = (sel, html) => {
    const el = modal.querySelector(sel);
    if (el) el.innerHTML = html;
  };

  set("[data-duration]", esc(duration(item)));
  set("[data-overview]", esc(item.overview) || "Sinopsis belum tersedia.");
  set("[data-imdb]", esc(item.imdbId || "-"));

  startModalTrailer(item, modal);

  // judul teks diganti logo resminya; kalau tidak ada, teksnya dibiarkan
  if (item.logo) {
    set(
      "[data-title]",
      `<img src="${esc(item.logo)}" alt="${esc(item.title)}"
         class="max-h-20 w-auto max-w-full object-contain object-left drop-shadow-lg md:max-h-28" />`
    );
  }

  set(
    "[data-genres]",
    item.genres.length
      ? `<span class="text-neutral-500">Genre: </span>${esc(item.genres.join(", "))}`
      : ""
  );

  const streamable = item.providers.length > 0;

  set(
    "[data-providers]",
    `<span class="text-neutral-500">Tonton di: </span>` +
      (streamable
        ? item.providers
            .slice(0, 8)
            .map(
              (p) =>
                `<a href="${esc(p.url)}" target="_blank" rel="noopener"
                   class="text-white underline-offset-2 hover:underline">${esc(p.name)}</a>`
            )
            .join(", ")
        : `<span class="text-neutral-500">belum tersedia di Indonesia.</span>`)
  );

  // Judul tanpa platform resmi biasanya cuma beredar sebagai rekaman bioskop,
  // jadi ditandai CAM supaya jelas kualitasnya sebelum ditonton.
  const quality = modal.querySelector("[data-quality]");
  if (quality) {
    quality.textContent = streamable ? "HD" : "CAM";
    quality.title = streamable
      ? "Tersedia resmi di layanan streaming"
      : "Belum ada di layanan streaming mana pun - kemungkinan besar hasil rekaman, kualitas dan suaranya buruk";
    quality.className = streamable
      ? "rounded border border-neutral-500 px-1.5 text-[11px] leading-5 text-neutral-300"
      : "rounded border border-red-600 bg-red-600 px-1.5 text-[11px] font-bold leading-5 text-white";
  }

  const playBtn = modal.querySelector("[data-play]");
  if (playerUrl(item)) {
    playBtn.disabled = false;
    playBtn.onclick = () => openPlayer(item, firstEpisode);
    paintResume(item, modal);
  } else {
    set("[data-imdb]", "tidak ada ID IMDb");
  }

  if (item.type === "SHOW") loadEpisodes(item, modal);
}

// Baris kecil di bawah tombol Play: apa yang terakhir ditonton profil ini, dan
// kapan. Untuk film sekalian mengganti tulisan tombolnya jadi "Lanjutkan" --
// untuk serial itu urusan loadEpisodes, yang perlu tahu episodenya dulu.
function paintResume(item, modal) {
  const line = modal.querySelector("[data-resume]");
  const entry = historyById(item.id);
  if (!line || !entry) return;

  const saved = Auth.progressOf(item.id);
  const parts = [];

  if (entry.type === "SHOW" && entry.season) parts.push(`S${entry.season}:E${entry.episode}`);
  if (saved) parts.push(`berhenti di ${clockText(saved.seconds)}`);

  const ago = timeAgo(entry.watchedAt);
  if (ago) parts.push(`ditonton ${ago}`);

  if (!parts.length) return;

  line.textContent = parts.join(" · ");
  line.classList.remove("hidden");

  if (item.type !== "SHOW" && saved) {
    const label = modal.querySelector("[data-play-label]");
    if (label) label.textContent = `Lanjutkan ${clockText(saved.seconds)}`;
  }
}

// episode yang akan diputar tombol Play: episode terakhir dari riwayat kalau
// ada, kalau tidak episode pertama dari season yang sedang dibuka
let firstEpisode = null;

// Episode terakhir yang tercatat di riwayat untuk sebuah serial. Dipakai
// supaya tombol Play melanjutkan, bukan mengulang dari episode pertama.
function resumeEpisode(item) {
  if (item.type !== "SHOW") return null;

  const last = historyById(item.id);
  if (!last || !last.season || !last.episode) return null;

  return { season: Number(last.season), number: Number(last.episode) };
}

function episodeRow(item, ep) {
  const thumb = ep.image
    ? `<img src="${esc(ep.image)}" alt="" loading="lazy" class="h-full w-full object-cover" />`
    : "";

  return `
    <button type="button" data-ep="${ep.season}-${ep.number}"
      class="flex w-full items-center gap-3 rounded p-2 text-left hover:bg-neutral-800 sm:gap-4 sm:p-3">
      <span class="w-5 shrink-0 text-center text-base text-neutral-400 sm:w-6 sm:text-lg">${ep.number}</span>
      <span class="h-12 w-20 shrink-0 overflow-hidden rounded bg-neutral-800 sm:h-16 sm:w-28">${thumb}</span>
      <span class="min-w-0 flex-1">
        <span class="flex items-baseline justify-between gap-3">
          <span class="truncate text-sm font-semibold sm:text-base">${esc(ep.name)}</span>
          ${ep.runtime ? `<span class="shrink-0 text-xs text-neutral-400">${ep.runtime}m</span>` : ""}
        </span>
        <span class="mt-1 line-clamp-2 hidden text-xs leading-relaxed text-neutral-400 sm:block">${esc(ep.summary)}</span>
      </span>
    </button>
  `;
}

async function loadEpisodes(item, modal) {
  const box = modal.querySelector("[data-episodes]");
  if (!box) return;

  const list = box.querySelector("[data-eplist]");
  const picker = box.querySelector("[data-season]");
  const meta = modal.querySelector("[data-eps-meta]");
  const seasons = item.seasons || [];

  if (!seasons.length) {
    list.textContent = "Daftar episode tidak tersedia untuk serial ini.";
    return;
  }

  meta.textContent = `${item.seasonCount} Season · ${item.episodeCount} Episode`;

  // Riwayat sudah ada di memori, jadi ini bisa ditetapkan sebelum daftar
  // episode selesai diambil -- tombol Play yang diklik cepat tetap melanjutkan.
  const resume = resumeEpisode(item);
  const resumeSeason = resume && seasons.find((s) => s.number === resume.season);
  if (resumeSeason) firstEpisode = resume;

  const playLabel = modal.querySelector("[data-play-label]");

  picker.innerHTML = seasons
    .map(
      (s) =>
        `<option value="${s.number}">Season ${s.number}${
          s.count ? ` (${s.count} episode)` : ""
        }</option>`
    )
    .join("");
  picker.classList.remove("hidden");

  const paint = async (season) => {
    list.className = "space-y-1 text-sm text-neutral-500";
    list.textContent = "Memuat...";

    let eps;
    try {
      eps = await fetchSeason(item.tmdbId, Number(season));
    } catch {
      list.textContent = "Episode season ini gagal dimuat.";
      return;
    }

    if (modal.innerHTML === "") return;

    list.className = "space-y-1";
    list.innerHTML = eps.map((ep) => episodeRow(item, ep)).join("");

    // episode terakhir yang ditonton ditandai, supaya jelas Play akan mulai
    // dari mana tanpa harus menghitung sendiri
    const onResumeSeason = resume && Number(season) === resume.season;
    const resumeEp = onResumeSeason && eps.find((ep) => ep.number === resume.number);

    list.querySelectorAll("[data-ep]").forEach((btn) => {
      const [s, n] = btn.dataset.ep.split("-").map(Number);
      btn.onclick = () => openPlayer(item, { season: s, number: n });
      if (resumeEp && n === resume.number) btn.classList.add("bg-neutral-800/60");
    });

    // Play melanjutkan episode terakhir kalau season-nya yang sedang dibuka;
    // di season lain ia mengikuti episode pertama season tersebut.
    if (resumeEp) {
      firstEpisode = resume;
      if (playLabel) {
        const at = Auth.progressOf(item.id);
        const where = at && at.key === Auth.playKey(resume) ? ` ${clockText(at.seconds)}` : "";
        playLabel.textContent = `Lanjutkan S${resume.season}:E${resume.number}${where}`;
      }
    } else if (eps.length) {
      firstEpisode = { season: eps[0].season, number: eps[0].number };
      if (playLabel) playLabel.textContent = "Play";
    }
  };

  const startSeason = resumeSeason ? resumeSeason.number : seasons[0].number;
  picker.value = String(startSeason);
  picker.onchange = () => paint(picker.value);
  paint(startSeason);
}

function closeDetail() {
  const modal = document.getElementById("modal");
  if (modal.classList.contains("hidden")) return;

  clearTrailerTimers();

  const clear = () => {
    modal.className = "hidden";
    modal.innerHTML = ""; // iframe pratinjau ikut terbuang -> tidak ada yang menyala di latar
  };

  const panel = modal.firstElementChild;
  if (!panel || reducedMotion) return clear();

  panel.animate(
    [
      { opacity: 1, transform: "none" },
      { opacity: 0, transform: "scale(.96)" },
    ],
    { duration: 160, easing: "ease-in" }
  );
  modal.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: "ease-in" }).onfinish =
    clear;
}

// ---------- Player fullscreen ----------
let barTimer = null;

function requestFullscreen(el) {
  const fn = el.requestFullscreen || el.webkitRequestFullscreen;
  try {
    const result = fn?.call(el, { navigationUI: "hide" });
    result?.catch?.(() => {}); // ditolak browser (mis. tanpa gestur) -> tetap tampil
  } catch {
    /* diabaikan */
  }
}

function exitFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else if (document.webkitFullscreenElement) document.webkitExitFullscreen?.();
}

function isPlayerOpen() {
  return !document.getElementById("player").classList.contains("hidden");
}

// ---------- Posisi tontonan ----------
// Pemutar mengabarkan posisinya lewat postMessage (PLAYER_EVENT). Kabar itu
// dicatat ke riwayat profil yang sedang aktif, lalu dipakai lagi sebagai
// ?resumeAt= saat judul yang sama dibuka lain kali.

// Tontonan yang tinggal sisa sedikit dianggap tamat: posisinya dinolkan supaya
// pemutaran berikutnya mulai dari awal, bukan langsung ke layar credit.
const NEAR_END = 0.95;

// Di bawah ini belum ada yang perlu dilanjutkan -- biasanya iklan pembuka atau
// pemutar yang baru memanaskan diri.
const MIN_PROGRESS_SEC = 30;

// Kabar bisa datang tiap detik. Salinan memori memang murah, tapi tidak ada
// gunanya menyentuh entri riwayat setiap kali untuk selisih satu detik.
const PROGRESS_STEP_SEC = 5;

let nowPlaying = null; // { item, ep } yang sedang diputar
let lastSavedSec = 0;
let progressLogged = false;

function savedPosition(item, ep) {
  const saved = Auth.progressOf(item.id);
  if (!saved || saved.key !== Auth.playKey(ep)) return 0;
  return saved.seconds;
}

// Bentuk payload pemutar tidak dijamin: ada yang mengirim detik sebagai angka
// biasa, ada yang membungkusnya bersama durasi. Semua bentuk yang masuk akal
// diterima, sisanya diabaikan diam-diam.
function readProgress(data) {
  const raw = data?.player_progress;
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

  if (typeof raw === "number" || typeof raw === "string") {
    return { seconds: num(raw), duration: num(data?.player_duration) };
  }

  if (raw && typeof raw === "object") {
    return {
      seconds: num(raw.watched ?? raw.current ?? raw.currentTime ?? raw.position ?? raw.seconds),
      duration: num(raw.duration ?? raw.total ?? raw.length),
    };
  }

  return { seconds: 0, duration: 0 };
}

window.addEventListener("message", (e) => {
  if (e.data?.type !== "PLAYER_EVENT") return;

  // Pengirimnya dicocokkan ke iframe pemutar yang sedang terbuka, bukan ke
  // daftar origin: halaman embed bebas berpindah domain kapan saja, sedangkan
  // window pengirim tidak bisa dipalsukan halaman lain.
  const frame = document.querySelector("#player iframe");
  if (!frame || e.source !== frame.contentWindow || !nowPlaying) return;

  const info = e.data.data || {};

  // Kabar pertama dicetak sekali: dokumentasi pemutar tidak menyebut satuan
  // player_progress, dan ini cara tercepat memastikannya detik -- bukan persen.
  if (!progressLogged) {
    progressLogged = true;
    console.debug("PLAYER_EVENT pertama:", info);
  }

  const status = info.player_status;
  const { seconds, duration } = readProgress(info);
  const { item, ep } = nowPlaying;

  // Tamat = tidak ada yang perlu dilanjutkan. Posisinya dinolkan supaya judulnya
  // tidak menyisakan bilah hampir penuh yang kalau ditekan langsung ke credit.
  if (status === "ended") {
    Auth.recordProgress(item.id, ep, 0, duration);
    Auth.flushProgress();
    return;
  }

  if (status !== "playing" && status !== "paused") return;
  if (seconds < MIN_PROGRESS_SEC) return;

  // jeda adalah titik simpan yang wajar, jadi ia melewati saringan langkah
  const paused = status === "paused";
  if (!paused && Math.abs(seconds - lastSavedSec) < PROGRESS_STEP_SEC) return;

  lastSavedSec = seconds;

  // sudah di ujung -> juga dianggap tamat
  const keep = duration > 0 && seconds / duration >= NEAR_END ? 0 : seconds;

  Auth.recordProgress(item.id, ep, keep, duration);
  if (paused) Auth.flushProgress();
});

// Jeda tulis Firestore (15 detik) terlalu lama untuk momen-momen ini: posisi
// terakhir bisa hilang kalau tabnya keburu ditutup.
window.addEventListener("pagehide", () => Auth.flushProgress());
document.addEventListener("visibilitychange", () => {
  if (document.hidden) Auth.flushProgress();
});

function openPlayer(item, ep = null) {
  // posisi dibaca sebelum recordPlay, karena recordPlay ikut menyentuh entri
  // riwayat yang sama
  const url = playerUrl(item, ep, savedPosition(item, ep));
  if (!url) return;

  // trailer di modal dihentikan dulu, kalau tidak suaranya bertabrakan dengan
  // film yang mulai diputar di atasnya
  stopModalTrailer();

  // satu-satunya pintu pemutaran, jadi cukup dicatat di sini; untuk serial
  // ep sudah membawa season dan nomor episodenya
  Auth.recordPlay(item, ep);
  renderHistoryRow();

  // dipakai penerima kabar posisi di bawah: tanpa ini ia tidak tahu kabar yang
  // masuk itu milik tayangan yang mana
  nowPlaying = { item, ep };
  lastSavedSec = 0;

  const el = document.getElementById("player");
  el.className = "fixed inset-0 z-[60] bg-black";
  el.innerHTML = `
    <iframe
      src="${esc(url)}"
      title="${esc(item.title)}"
      class="absolute inset-0 h-full w-full border-0"
      allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
      allowfullscreen; unmuted; unmuted; web-share
      referrerpolicy="origin"
    ></iframe>
    

    <div data-bar class="absolute inset-x-0 top-0 z-20 flex items-center gap-2 bg-gradient-to-b from-black/90 via-black/50 to-transparent p-3 transition-opacity duration-300 sm:gap-4 sm:p-4">
      <button type="button" data-back
        class="flex shrink-0 items-center gap-2 rounded-full bg-black/70 px-3 py-2 text-sm font-semibold hover:bg-black sm:px-4">
        &#8592; <span class="hidden sm:inline">Kembali</span>
      </button>
      <div class="min-w-0">
        <p class="truncate text-sm font-semibold sm:text-base">${esc(item.title)}</p>
        <p class="truncate text-[11px] text-neutral-400 sm:text-xs">
          ${ep ? `S${ep.season}:E${ep.number} &middot; ` : ""}${esc(item.year)} &middot; ${duration(item)}
        </p>
      </div>
    </div>
  `;

  const bar = el.querySelector("[data-bar]");

  const showBar = (autoHide = true) => {
    bar.classList.remove("opacity-0");
    clearTimeout(barTimer);
    if (autoHide) {
      barTimer = setTimeout(() => bar.classList.add("opacity-0"), 3000);
    }
  };

  el.querySelector("[data-back]").onclick = () => closePlayer();

  el.addEventListener("mousemove", () => showBar());
  el.addEventListener("touchstart", () => showBar(), { passive: true });

  showBar();
  requestFullscreen(el);

  // supaya tombol back browser menutup player, bukan meninggalkan halaman
  history.pushState({ netflixPlayer: true }, "");
}

function closePlayer(fromPopstate = false) {
  const el = document.getElementById("player");
  if (el.classList.contains("hidden")) return;

  clearTimeout(barTimer);
  el.className = "hidden";
  el.innerHTML = ""; // menghapus iframe = playback berhenti
  exitFullscreen();

  nowPlaying = null;

  // posisi terakhir ditulis sekarang, lalu barisnya digambar ulang supaya bilah
  // hijaunya langsung sepadan dengan yang barusan ditonton
  Auth.flushProgress();
  renderHistoryRow();

  if (!fromPopstate && history.state?.netflixPlayer) history.back();
}

document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && isPlayerOpen()) closePlayer();
});
document.addEventListener("webkitfullscreenchange", () => {
  if (!document.webkitFullscreenElement && isPlayerOpen()) closePlayer();
});
window.addEventListener("popstate", () => closePlayer(true));

// ---------- Hero ----------
// Judul yang dipajang di hero beserta trailer lokalnya. Ditambatkan ke satu
// judul, bukan mengikuti baris pertama, karena videonya berkas tetap.
const HERO = {
  tmdbId: 111110, // ONE PIECE (2023)
  type: "SHOW",
  video:
    "assets/YTDown.com_YouTube_ONE-PIECE-Official-Trailer-Netflix_Media_Ades3pQbeh8_002_720p.mp4",
};

async function loadHero() {
  try {
    const data = await tmdb(`/tv/${HERO.tmdbId}`);
    const item = normalize({ ...data, media_type: "tv" }, HERO.type);
    catalog.set(item.id, item);
    fillHero(item);
  } catch (err) {
    console.error("Hero gagal dimuat", err);
  }
}

// ---------- Trailer di hero ----------
// Berkasnya 14 MB. Tanpa penjagaan, tiap pengunjung mengunduhnya sekalipun
// tidak pernah melihatnya. Karena itu video baru disentuh setelah semua syarat
// di bawah terpenuhi, dan dilepas lagi begitu tidak terlihat.
function heroVideoAllowed() {
  const conn = navigator.connection || {};

  if (reducedMotion) return false;
  if (conn.saveData) return false; // pengguna minta hemat data
  if (/(^|-)(2g|slow-2g)$/.test(conn.effectiveType || "")) return false;
  if (window.matchMedia("(max-width: 767px)").matches) return false; // layar kecil = kuota seluler

  return true;
}

const SPEAKER_ON = `<svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 9v6h4l5 4V5L9 9H5Z" stroke-linejoin="round"/><path d="M17 9a4 4 0 0 1 0 6" stroke-linecap="round"/></svg>`;
const SPEAKER_OFF = `<svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 9v6h4l5 4V5L9 9H5Z" stroke-linejoin="round"/><path d="m17 10 4 4m0-4-4 4" stroke-linecap="round"/></svg>`;

function setupHeroVideo() {
  const video = document.getElementById("hero-video");
  const mute = document.getElementById("hero-mute");
  if (!video || video.dataset.ready) return;
  video.dataset.ready = "1";

  if (!heroVideoAllowed()) return;

  const paintMute = () => {
    mute.innerHTML = video.muted ? SPEAKER_OFF : SPEAKER_ON;
    mute.title = video.muted ? "Nyalakan suara" : "Bisukan";
  };

  const show = () => {
    video.classList.add("opacity-100");
    mute.classList.remove("hidden");
    mute.classList.add("flex");
  };

  const hide = () => {
    video.classList.remove("opacity-100");
    mute.classList.add("hidden");
    mute.classList.remove("flex");
  };

  video.addEventListener("canplay", show, { once: true });
  video.addEventListener("ended", hide); // selesai -> kembali ke gambar
  video.addEventListener("error", hide);

  mute.onclick = () => {
    video.muted = !video.muted;
    paintMute();
  };
  paintMute();

  // hero berhenti kalau tergulir keluar layar: tidak ada gunanya membebani
  // prosesor untuk sesuatu yang tidak terlihat
  const hero = document.getElementById("hero");
  new IntersectionObserver(
    ([entry]) => {
      if (!video.src) return;
      if (entry.isIntersecting) video.play().catch(() => {});
      else video.pause();
    },
    { threshold: 0.25 }
  ).observe(hero);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) video.pause();
  });

  // unduhan ditunda sampai halaman tidak sibuk lagi, supaya baris film dan
  // gambarnya yang lebih penting tidak berebut jalur dengan video 14 MB
  const later = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
  later(
    () => {
      video.src = HERO.video;
      video.play().catch(() => {}); // ditolak = biarkan gambarnya saja
    },
    { timeout: 4000 }
  );
}

function fillHero(item) {
  if (!item) return;

  document.getElementById("hero").style.backgroundImage =
    `linear-gradient(to top, rgba(0,0,0,.85), rgba(0,0,0,.1)), url('${item.backdrop}')`;
  document.getElementById("hero-title").textContent = item.title;
  document.getElementById("hero-meta").innerHTML = [
    item.type === "SHOW" ? "Series" : "Movie",
    duration(item),
    item.year,
    item.rating ? `${item.rating}% match` : "",
  ]
    .filter(Boolean)
    .map((t) => `<span>${esc(t)}</span>`)
    .join("");
  document.getElementById("hero-desc").textContent = item.overview || "";

  document.getElementById("hero-play").onclick = () => openDetail(item);
  document.getElementById("hero-info").onclick = () => openDetail(item);

  // sinopsis, durasi, dan logo judul baru ada setelah detail dimuat
  fetchDetail(item)
    .then(() => {
      const desc = document.getElementById("hero-desc");
      if (item.overview) desc.textContent = item.overview;

      if (item.logo) {
        document.getElementById("hero-title").innerHTML =
          `<img src="${esc(item.logo)}" alt="${esc(item.title)}"
             class="max-h-24 w-auto max-w-md object-contain object-left drop-shadow-lg md:max-h-32" />`;
      }
    })
    .catch((err) => console.error("Detail hero gagal dimuat", err));
}

// ---------- Event global ----------
document.addEventListener("click", (e) => {
  const arrow = e.target.closest("[data-scroll]");
  if (arrow) {
    const track = arrow.closest("section").querySelector("[data-track]");
    track.scrollBy({
      left: Number(arrow.dataset.scroll) * track.clientWidth * 0.8,
      behavior: "smooth",
    });
    return;
  }

  const card = e.target.closest("[data-id]");
  if (!card) return;

  // posisi kartu direkam supaya modal bisa tumbuh dari tempat kartunya berada
  openFromRect = card.getBoundingClientRect();

  // kartu di My List / Lanjutkan Menonton datang dari Firestore, bukan katalog
  const item =
    catalog.get(card.dataset.id) || savedById(card.dataset.id) || historyById(card.dataset.id);
  if (item) openDetail({ providers: [], rating: null, runtime: 0, ...item });
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (isPlayerOpen()) closePlayer();
    else closeDetail();
  }
});

// ---------- Pencarian ----------
// Hasilnya menggantikan seluruh beranda seperti di Netflix, bukan disisipkan
// sebagai satu baris. Kotak dikosongkan -> beranda kembali seperti semula.
const SEARCH_DEBOUNCE_MS = 350;

let searchTimer = null;
let searchToken = 0; // menjaga hasil lama tidak menimpa hasil ketikan terbaru

function showHome() {
  document.getElementById("search-results").classList.add("hidden");
  document.getElementById("hero").classList.remove("hidden");
  document.getElementById("rows").classList.remove("hidden");
}

function showSearch() {
  document.getElementById("search-results").classList.remove("hidden");
  document.getElementById("hero").classList.add("hidden");
  document.getElementById("rows").classList.add("hidden");
}

function skeletonGridCard() {
  return `<div class="animate-pulse"><div class="aspect-video rounded-md bg-neutral-800"></div></div>`;
}

async function runSearch(query) {
  const grid = document.getElementById("search-grid");
  const status = document.getElementById("search-status");
  const token = ++searchToken;

  showSearch();
  status.textContent = `Mencari "${query}"...`;
  grid.innerHTML = skeletonGridCard().repeat(10);

  let items;
  try {
    items = await fetchList(`/search/multi?query=${encodeURIComponent(query)}`);
  } catch (err) {
    console.error(err);
    if (token !== searchToken) return;
    status.textContent = "Pencarian gagal. Coba lagi sebentar.";
    grid.innerHTML = "";
    return;
  }

  if (token !== searchToken) return; // sudah ada ketikan yang lebih baru

  if (!items.length) {
    status.textContent = `Tidak ada hasil untuk "${query}".`;
    grid.innerHTML = "";
    return;
  }

  status.innerHTML = `${items.length} hasil untuk <span class="font-semibold text-white">${esc(query)}</span>`;
  grid.innerHTML = items
    .map((item, i) => cardTemplate(item, { logo: true, grid: true, index: i }))
    .join("");

  setupLogos("search", items, grid, null);
}

function onSearchInput() {
  const query = document.getElementById("search-input").value.trim();
  clearTimeout(searchTimer);

  if (!query) {
    searchToken++; // batalkan hasil yang masih dalam perjalanan
    showHome();
    return;
  }

  searchTimer = setTimeout(() => runSearch(query), SEARCH_DEBOUNCE_MS);
}

document.getElementById("search-input").addEventListener("input", onSearchInput);

document.getElementById("search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  clearTimeout(searchTimer);

  const query = document.getElementById("search-input").value.trim();
  if (query) runSearch(query);
});

// ---------- Init ----------
const QUEUE_GAP_MS = 200; // jeda antar-fetch di dalam antrian

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// tab yang tidak terlihat tidak perlu ikut menembak API
function whenVisible() {
  if (!document.hidden) return Promise.resolve();

  return new Promise((resolve) => {
    const onChange = () => {
      if (document.hidden) return;
      document.removeEventListener("visibilitychange", onChange);
      resolve();
    };
    document.addEventListener("visibilitychange", onChange);
  });
}

// Antrian berputar: satu fetch dalam satu waktu, urut sesuai ROWS. Baris yang
// gagal dikembalikan ke belakang antrian, jadi baris di belakangnya tidak ikut
// tertahan dan yang gagal tetap dicoba lagi sampai berhasil.
async function runQueue(rows) {
  const queue = [...rows];
  const attempts = new Map();

  while (queue.length) {
    const row = queue.shift();
    const attempt = (attempts.get(row.key) || 0) + 1;
    attempts.set(row.key, attempt);

    try {
      const items = await fetchList(row.path, row.type);
      fillRow(row.key, items, { top10: row.top10, logo: true });
      renderSavedRow(); // lengkapi My List dengan data dari catalog
    } catch (err) {
      console.error(`Gagal memuat baris "${row.title}" (percobaan ${attempt})`, err);
      queue.push(row); // antre lagi di belakang
    }

    await wait(QUEUE_GAP_MS);
    await whenVisible();
  }
}

// ---------- Bagian navbar ----------
let activeSection = "";

// Baris riwayat dan My List hanya ada di Home, jadi disisipkan ke wadah Home.
function homeBox() {
  return document.querySelector('[data-section="home"]') || document.getElementById("rows");
}

function paintNav(key) {
  document.querySelectorAll("[data-section-link]").forEach((link) => {
    const on = link.dataset.sectionLink === key;
    link.classList.toggle("text-white", on);
    link.classList.toggle("font-semibold", on);
    link.classList.toggle("text-neutral-400", !on);
  });
}

function showSection(key) {
  const def = SECTIONS.find((s) => s.key === key);
  if (!def) return;

  activeSection = key;
  paintNav(key);
  showHome(); // pastikan hasil pencarian tertutup

  const rows = document.getElementById("rows");
  let box = rows.querySelector(`[data-section="${key}"]`);

  if (!box) {
    box = document.createElement("div");
    box.dataset.section = key;
    box.innerHTML = def.rows.map((r) => rowShell(r.key, r.title)).join("");
    rows.appendChild(box);

    if (key === "home") {
      renderHistoryRow();
      renderSavedRow();
      loadHero();
      setupHeroVideo();
    }

    runQueue(def.rows); // hanya sekali; kunjungan berikutnya memakai yang sudah ada
  }

  rows.querySelectorAll("[data-section]").forEach((el) => {
    el.classList.toggle("hidden", el.dataset.section !== key);
  });

  box.classList.add("gate-rise");
  box.addEventListener("animationend", () => box.classList.remove("gate-rise"), { once: true });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll("[data-section-link]").forEach((link) => {
  link.onclick = () => showSection(link.dataset.sectionLink);
});

let homeStarted = false;

async function init() {
  // Baris TMDB dibangun sekali saja. Menggambar ulang saat ganti profil akan
  // mengembalikan semuanya jadi skeleton padahal antriannya sudah selesai --
  // dan tidak akan pernah terisi lagi.
  if (!homeStarted) {
    homeStarted = true;
    document.getElementById("rows").innerHTML = "";
    showSection("home");
    return;
  }

  // ganti profil: bagian yang sudah dimuat tetap, hanya milik profil digambar ulang
  renderHistoryRow();
  renderSavedRow();
}

// ---------- Gerbang: daftar, masuk, pilih profil ----------
const gate = document.getElementById("gate");
const appEl = document.getElementById("app");

function showGate(html) {
  gate.innerHTML = html;
  gate.classList.remove("hidden");
  appEl.classList.add("hidden");
}

function showApp() {
  gate.classList.add("hidden");
  gate.innerHTML = "";
  appEl.classList.remove("hidden");
}

const FIELD =
  "w-full rounded border border-neutral-700 bg-neutral-900 px-4 py-3 text-sm outline-none " +
  "placeholder:text-neutral-500 focus:border-neutral-400";

function authScreen(mode = "signin", message = "") {
  const isSignup = mode === "signup";

  showGate(`
    <div class="flex min-h-full items-center justify-center p-4">
      <div class="w-full max-w-md rounded-lg bg-[#181818] p-6 shadow-2xl md:p-10">
        <p class="mb-1 text-2xl font-semibold tracking-wide text-red-600">CinemaHub</p>
        <h1 class="mb-6 text-2xl font-bold md:text-3xl">
          ${isSignup ? "Buat akun" : "Masuk"}
        </h1>

        <form data-form class="space-y-3">
          <input data-username class="${FIELD}" placeholder="Username" autocomplete="username" />
          ${
            isSignup
              ? `<input data-email type="email" class="${FIELD}" placeholder="Email (gmail)" autocomplete="email" />`
              : ""
          }
          <input data-password type="password" class="${FIELD}" placeholder="Password"
            autocomplete="${isSignup ? "new-password" : "current-password"}" />

          <p data-error class="min-h-5 text-sm text-red-500">${esc(message)}</p>

          <button data-submit type="submit"
            class="w-full rounded bg-red-600 py-3 font-semibold hover:bg-red-500 disabled:opacity-50">
            ${isSignup ? "Daftar" : "Masuk"}
          </button>
        </form>

        <p class="mt-6 text-sm text-neutral-400">
          ${isSignup ? "Sudah punya akun?" : "Belum punya akun?"}
          <button data-switch type="button" class="font-semibold text-white hover:underline">
            ${isSignup ? "Masuk" : "Daftar sekarang"}
          </button>
        </p>
      </div>
    </div>
  `);

  const form = gate.querySelector("[data-form]");
  const errorEl = gate.querySelector("[data-error]");
  const submit = gate.querySelector("[data-submit]");

  gate.querySelector("[data-switch]").onclick = () =>
    authScreen(isSignup ? "signin" : "signup");

  form.onsubmit = async (e) => {
    e.preventDefault();
    errorEl.textContent = "";
    submit.disabled = true;

    const username = gate.querySelector("[data-username]").value;
    const password = gate.querySelector("[data-password]").value;
    const email = isSignup ? gate.querySelector("[data-email]").value : "";

    try {
      if (isSignup) await Auth.signUp({ username, email, password });
      else await Auth.signIn({ username, password });
      // onAuth yang melanjutkan ke pemilih profil
    } catch (err) {
      errorEl.textContent = Auth.authMessage(err);
      submit.disabled = false;
    }
  };
}

function initials(name) {
  return String(name || "?").trim().charAt(0).toUpperCase();
}

// wajah tersenyum sederhana, digambar sendiri sebagai SVG supaya tidak perlu
// berkas gambar dan ikut warna kotaknya
const FACE_SVG = `
  <svg viewBox="0 0 100 100" class="h-full w-full" aria-hidden="true">
    <circle cx="34" cy="40" r="6.5" fill="#fff" />
    <circle cx="66" cy="40" r="6.5" fill="#fff" />
    <path d="M31 60 Q50 76 69 60" fill="none" stroke="#fff" stroke-width="6.5" stroke-linecap="round" />
  </svg>`;

const LOCK_SVG = `
  <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <rect x="4" y="10" width="16" height="11" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </svg>`;

// versi isi penuh untuk daftar profil di menu navbar
const LOCK_SVG_LG = `
  <svg viewBox="0 0 24 24" class="h-6 w-6" fill="currentColor" aria-hidden="true">
    <path d="M17 9V7a5 5 0 0 0-10 0v2H5.5A1.5 1.5 0 0 0 4 10.5v10A1.5 1.5 0 0 0 5.5 22h13a1.5 1.5 0 0 0 1.5-1.5v-10A1.5 1.5 0 0 0 18.5 9H17Zm-8 0V7a3 3 0 0 1 6 0v2H9Zm3 5a1.6 1.6 0 0 1 .8 3v1.7a.8.8 0 0 1-1.6 0V17A1.6 1.6 0 0 1 12 14Z" />
  </svg>`;

function gateBrand() {
  return `<div class="absolute left-5 top-5 md:left-10 md:top-8">
    <span class="text-xl font-semibold tracking-wide text-red-600 md:text-2xl">CinemaHub</span>
  </div>`;
}

function profilePicker(message = "") {
  const list = Auth.allProfiles();

  const tiles = list
    .map(
      (p) => `
      <button type="button" data-profile="${esc(p.id)}"
        class="group flex w-[104px] flex-col items-center md:w-[140px]">
        <span class="aspect-square w-full overflow-hidden rounded-md ${esc(p.skin)}
          ring-white transition duration-200 group-hover:ring-4">
          ${FACE_SVG}
        </span>
        <span class="mt-3 w-full truncate text-center text-base text-neutral-400 transition group-hover:text-white md:text-lg">
          ${esc(p.name)}
        </span>
        ${
          Auth.hasPin(p)
            ? `<span class="mt-2 text-neutral-500" title="Profil terkunci">${LOCK_SVG}</span>`
            : ""
        }
      </button>`
    )
    .join("");

  const addTile =
    list.length < Auth.MAX_PROFILES
      ? `<button type="button" data-add class="group flex w-[104px] flex-col items-center md:w-[140px]">
           <span class="flex aspect-square w-full items-center justify-center rounded-md border-2 border-neutral-700
             text-5xl font-light text-neutral-600 transition group-hover:border-white group-hover:text-white">+</span>
           <span class="mt-3 text-center text-base text-neutral-400 group-hover:text-white md:text-lg">Tambah Profil</span>
         </button>`
      : "";

  showGate(`
    <div class="relative min-h-full">
      ${gateBrand()}

      <div class="flex min-h-screen flex-col items-center justify-center px-6 py-24">
        <h1 class="gate-rise mb-10 text-center text-3xl font-normal md:mb-14 md:text-6xl">
          Siapa yang menonton?
        </h1>

        <div class="gate-stagger flex flex-wrap items-start justify-center gap-5 md:gap-8">${tiles}${addTile}</div>

        <p data-error class="mt-8 min-h-5 text-sm text-red-500">${esc(message)}</p>

        <div class="gate-rise mt-10 flex flex-wrap items-center justify-center gap-3 md:mt-14">
          <button type="button" data-manage
            class="border border-neutral-600 px-6 py-2 text-xs uppercase tracking-[0.2em] text-neutral-400
              transition hover:border-white hover:text-white md:text-sm">Kelola Profil</button>
          <button type="button" data-logout
            class="border border-transparent px-6 py-2 text-xs uppercase tracking-[0.2em] text-neutral-500
              transition hover:text-white md:text-sm">Keluar</button>
        </div>
      </div>
    </div>
  `);

  gate.querySelectorAll("[data-profile]").forEach((btn) => {
    btn.onclick = () => {
      const profile = list.find((p) => p.id === btn.dataset.profile);
      if (Auth.hasPin(profile)) pinScreen(profile);
      else enterApp(profile.id);
    };
  });

  const addBtn = gate.querySelector("[data-add]");
  if (addBtn) addBtn.onclick = () => profileForm();

  gate.querySelector("[data-manage]").onclick = () => manageScreen();
  gate.querySelector("[data-logout]").onclick = () => Auth.logout();
}

function pinScreen(profile) {
  showGate(`
    <div class="relative min-h-full">
      ${gateBrand()}

      <button type="button" data-back
        class="absolute right-5 top-5 text-3xl font-light leading-none text-neutral-300 transition hover:text-white md:right-10 md:top-8 md:text-4xl">
        &times;
      </button>

      <div class="flex min-h-screen flex-col items-center justify-center px-6 py-24">
        <p class="mb-3 text-center text-sm text-neutral-400 md:text-base">
          Profil ${esc(profile.name)} sedang dikunci.
        </p>
        <h1 class="mb-10 max-w-2xl text-center text-2xl font-bold md:mb-14 md:text-5xl">
          Masukkan PIN untuk membuka profil ini.
        </h1>

        <form data-form class="flex justify-center gap-3 md:gap-4">
          ${[0, 1, 2, 3]
            .map(
              (i) => `<input data-pin="${i}" inputmode="numeric" maxlength="1" type="password"
                class="h-16 w-14 border-2 border-white bg-transparent text-center text-3xl font-bold
                  outline-none focus:border-red-600 md:h-20 md:w-20 md:text-4xl" />`
            )
            .join("")}
        </form>

        <p data-error class="mt-6 min-h-6 text-center text-sm text-red-500 md:text-base"></p>

        <button type="button" data-forgot
          class="mt-10 text-base text-neutral-400 transition hover:text-white md:mt-16 md:text-lg">
          Lupa PIN?
        </button>
      </div>
    </div>
  `);

  const boxes = [...gate.querySelectorAll("[data-pin]")];
  const errorEl = gate.querySelector("[data-error]");

  const submit = async () => {
    const pin = boxes.map((b) => b.value).join("");
    if (pin.length < 4) return;

    if (await Auth.checkPin(profile, pin)) {
      enterApp(profile.id);
      return;
    }

    errorEl.textContent = "PIN salah.";
    boxes.forEach((b) => (b.value = ""));
    boxes[0].focus();
  };

  boxes.forEach((box, i) => {
    box.oninput = () => {
      box.value = box.value.replace(/\D/g, "").slice(0, 1);
      if (box.value && i < 3) boxes[i + 1].focus();
      if (boxes.every((b) => b.value)) submit();
    };

    // backspace di kotak kosong mundur ke kotak sebelumnya
    box.onkeydown = (e) => {
      if (e.key === "Backspace" && !box.value && i > 0) boxes[i - 1].focus();
    };

    // tempel 4 digit sekaligus
    box.onpaste = (e) => {
      const digits = (e.clipboardData.getData("text") || "").replace(/\D/g, "").slice(0, 4);
      if (!digits) return;
      e.preventDefault();
      digits.split("").forEach((d, j) => (boxes[j].value = d));
      if (digits.length === 4) submit();
    };
  });

  gate.querySelector("[data-form]").onsubmit = (e) => e.preventDefault();
  gate.querySelector("[data-back]").onclick = () => profilePicker();

  // tidak ada email pemulihan di sini; PIN dilepas lewat Kelola Profil
  gate.querySelector("[data-forgot]").onclick = () => manageScreen();

  boxes[0].focus();
}

function profileForm(profile = null) {
  const editing = Boolean(profile);

  showGate(`
    <div class="flex min-h-full items-center justify-center p-4">
      <div class="w-full max-w-md rounded-lg bg-[#181818] p-6 shadow-2xl md:p-10">
        <h1 class="mb-6 text-2xl font-bold">${editing ? "Ubah Profil" : "Profil Baru"}</h1>

        <form data-form class="space-y-4">
          <input data-name class="${FIELD}" placeholder="Nama profil" maxlength="20"
            value="${esc(profile?.name || "")}" />

          <div>
            <label class="flex items-center gap-2 text-sm text-neutral-300">
              <input data-usepin type="checkbox" class="h-4 w-4"
                ${editing && Auth.hasPin(profile) ? "checked" : ""} />
              Kunci profil ini dengan PIN 4 digit
            </label>
            <input data-pin inputmode="numeric" maxlength="4"
              class="${FIELD} mt-3 ${editing && Auth.hasPin(profile) ? "" : "hidden"}"
              placeholder="${editing && Auth.hasPin(profile) ? "PIN baru (kosongkan = tetap)" : "4 digit angka"}" />
            <p class="mt-2 text-xs text-neutral-500">
              PIN memisahkan profil antar anggota keluarga. Ini bukan pengaman data.
            </p>
          </div>

          <p data-error class="min-h-5 text-sm text-red-500"></p>

          <div class="flex gap-3">
            <button data-submit type="submit"
              class="flex-1 rounded bg-red-600 py-3 font-semibold hover:bg-red-500 disabled:opacity-50">Simpan</button>
            <button type="button" data-cancel
              class="rounded border border-neutral-600 px-5 hover:bg-neutral-800">Batal</button>
          </div>
        </form>

        ${
          editing
            ? `<button type="button" data-delete
                 class="mt-6 text-sm text-red-500 hover:underline">Hapus profil ini</button>`
            : ""
        }
      </div>
    </div>
  `);

  const usePin = gate.querySelector("[data-usepin]");
  const pinInput = gate.querySelector("[data-pin]");
  const errorEl = gate.querySelector("[data-error]");
  const submit = gate.querySelector("[data-submit]");

  usePin.onchange = () => pinInput.classList.toggle("hidden", !usePin.checked);
  pinInput.oninput = () => (pinInput.value = pinInput.value.replace(/\D/g, "").slice(0, 4));

  gate.querySelector("[data-cancel]").onclick = () => (editing ? manageScreen() : profilePicker());

  const del = gate.querySelector("[data-delete]");
  if (del) {
    del.onclick = async () => {
      if (!confirm(`Hapus profil "${profile.name}" beserta riwayat dan My List-nya?`)) return;
      del.disabled = true;
      try {
        await Auth.deleteProfile(profile.id);
        manageScreen();
      } catch (err) {
        errorEl.textContent = err.message;
        del.disabled = false;
      }
    };
  }

  gate.querySelector("[data-form]").onsubmit = async (e) => {
    e.preventDefault();
    errorEl.textContent = "";

    const name = gate.querySelector("[data-name]").value;
    const pin = usePin.checked ? pinInput.value : "";

    if (usePin.checked && pin && pin.length !== 4) {
      errorEl.textContent = "PIN harus 4 digit.";
      return;
    }
    if (usePin.checked && !pin && !(editing && Auth.hasPin(profile))) {
      errorEl.textContent = "Isi PIN-nya, atau lepas centangnya.";
      return;
    }
    if (pin && !Auth.pinSupported()) {
      errorEl.textContent = "PIN butuh situs dibuka lewat https atau localhost.";
      return;
    }

    submit.disabled = true;
    try {
      if (editing) {
        await Auth.renameProfile(profile.id, name);
        // kosong + centang menyala = PIN lama dipertahankan
        if (!usePin.checked) await Auth.setProfilePin(profile.id, "");
        else if (pin) await Auth.setProfilePin(profile.id, pin);
        manageScreen();
      } else {
        await Auth.createProfile(name, pin);
        profilePicker();
      }
    } catch (err) {
      errorEl.textContent = err.message;
      submit.disabled = false;
    }
  };
}

function manageScreen() {
  const list = Auth.allProfiles();

  showGate(`
    <div class="flex min-h-full items-center justify-center p-6">
      <div class="w-full max-w-lg">
        <h1 class="mb-8 text-center text-2xl font-bold md:text-3xl">Kelola Profil</h1>

        <div class="space-y-2">
          ${list
            .map(
              (p) => `
            <button type="button" data-edit="${esc(p.id)}"
              class="flex w-full items-center gap-4 rounded border border-neutral-800 p-3 text-left hover:bg-neutral-800">
              <span class="flex h-12 w-12 items-center justify-center rounded ${esc(p.skin)} font-bold">
                ${esc(initials(p.name))}
              </span>
              <span class="flex-1">
                <span class="block font-semibold">${esc(p.name)}</span>
                <span class="text-xs text-neutral-400">
                  ${Auth.hasPin(p) ? "Terkunci PIN" : "Tanpa PIN"}
                </span>
              </span>
              <span class="text-neutral-500">Ubah</span>
            </button>`
            )
            .join("")}
        </div>

        <p class="mt-4 text-xs text-neutral-500">
          ${list.length} dari ${Auth.MAX_PROFILES} profil terpakai.
        </p>

        <button type="button" data-done
          class="mt-8 w-full rounded border border-neutral-600 py-3 text-sm hover:bg-neutral-800">Selesai</button>
      </div>
    </div>
  `);

  gate.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.onclick = () => profileForm(list.find((p) => p.id === btn.dataset.edit));
  });

  gate.querySelector("[data-done]").onclick = () => profilePicker();
}

// Bunyi klik profil. Dibuat sekali lalu dipakai ulang supaya tidak ada jeda
// unduh di klik pertama.
const clickSound = new Audio("assets/netflix_profile_click.mp3");
clickSound.preload = "auto";

function playClickSound() {
  try {
    clickSound.currentTime = 0;
    // browser boleh menolak kalau belum ada interaksi; bukan alasan menggagalkan
    clickSound.play().catch(() => {});
  } catch {
    /* diabaikan */
  }
}

// Layar antara: gambar profil membesar di tengah, nama di bawahnya, lalu
// pemuat. Ditahan sebentar supaya animasinya sempat terlihat walau datanya
// sudah siap seketika.
const SPLASH_MIN_MS = 1100;

function profileSplash(profile) {
  showGate(`
    <div class="relative min-h-full">
      ${gateBrand()}

      <div data-splash class="flex min-h-screen flex-col items-center justify-center px-6">
        <div class="gate-zoom flex flex-col items-center">
          <span class="aspect-square w-32 overflow-hidden rounded-md ${esc(profile.skin)} shadow-2xl md:w-44">
            ${FACE_SVG}
          </span>
          <p class="mt-6 text-xl font-medium md:text-2xl">${esc(profile.name)}</p>

          <div class="mt-8 h-0.5 w-40 overflow-hidden rounded bg-white/15 md:w-56">
            <div class="gate-sweep h-full w-1/4 rounded bg-red-600"></div>
          </div>
        </div>
      </div>
    </div>
  `);
}

async function enterApp(profileId, withSound = true) {
  const profile = Auth.allProfiles().find((p) => p.id === profileId);
  if (!profile) return profilePicker("Profil tidak ditemukan.");

  if (withSound) playClickSound();
  profileSplash(profile);

  const started = Date.now();

  try {
    await Auth.enterProfile(profileId);
    paintProfileButton(profile);
    await init();
  } catch (err) {
    console.error("Gagal membuka profil", err);
    profilePicker("Gagal membuka profil. Coba lagi.");
    return;
  }

  await wait(Math.max(0, SPLASH_MIN_MS - (Date.now() - started)));

  const splash = gate.querySelector("[data-splash]");
  if (splash) splash.classList.add("gate-out");
  await wait(320);

  showApp();
}

// ---------- Tombol profil di header ----------
function paintProfileButton(profile) {
  const avatar = document.getElementById("profile-avatar");
  avatar.className = `block h-8 w-8 overflow-hidden rounded ${profile.skin}`;
  avatar.innerHTML = FACE_SVG;
}

const profileMenu = document.getElementById("profile-menu");
const profileCaret = document.getElementById("profile-caret");

// Kelas transisi dipakai untuk membuka-tutup, bukan "hidden", supaya
// animasinya sempat berjalan sebelum menu benar-benar disembunyikan.
const MENU_OPEN = ["visible", "opacity-100", "translate-y-0", "scale-100"];
const MENU_SHUT = ["invisible", "opacity-0", "-translate-y-2", "scale-95"];

function menuIsOpen() {
  return profileMenu.classList.contains("visible");
}

function closeProfileMenu() {
  profileMenu.classList.remove(...MENU_OPEN);
  profileMenu.classList.add(...MENU_SHUT);
  profileCaret.classList.remove("rotate-180");
}

function openProfileMenu() {
  const others = Auth.allProfiles().filter((p) => p.id !== Auth.currentProfile()?.id);

  const row = (label, icon, attr) => `
    <button type="button" ${attr}
      class="flex w-full items-center gap-4 px-4 py-2.5 text-left text-[15px] text-neutral-200 transition hover:bg-white/10">
      <span class="flex h-6 w-6 shrink-0 items-center justify-center text-neutral-300">${icon}</span>
      ${label}
    </button>`;

  const pencil = `<svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 20h4L20 8l-4-4L4 16v4Z" stroke-linejoin="round"/></svg>`;
  const exit = `<svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const person = `<svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" stroke-linecap="round"/></svg>`;
  const power = `<svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3v9M6.6 6.6a9 9 0 1 0 10.8 0" stroke-linecap="round"/></svg>`;

  profileMenu.innerHTML = `
    ${others
      .map(
        (p) => `
      <button type="button" data-goto="${esc(p.id)}"
        class="flex w-full items-center gap-4 px-4 py-2.5 text-left transition hover:bg-white/10">
        <span class="block h-11 w-11 shrink-0 overflow-hidden rounded-md ${esc(p.skin)}">${FACE_SVG}</span>
        <span class="flex-1 truncate text-[15px] text-neutral-100">${esc(p.name)}</span>
        ${
          Auth.hasPin(p)
            ? `<span class="shrink-0 text-neutral-300">${LOCK_SVG_LG}</span>`
            : ""
        }
      </button>`
      )
      .join("")}

    ${others.length ? `<div class="my-2 border-t border-white/10"></div>` : ""}

    ${row("Kelola Profil", pencil, "data-manage")}
    ${row("Ganti Profil", exit, "data-switch")}
    ${row("Akun", person, "data-account")}
    ${row("Keluar", power, "data-logout")}
  `;

  profileMenu.classList.remove(...MENU_SHUT);
  profileMenu.classList.add(...MENU_OPEN);
  profileCaret.classList.add("rotate-180");

  // pindah profil langsung dari menu, lengkap dengan PIN kalau ada
  profileMenu.querySelectorAll("[data-goto]").forEach((btn) => {
    btn.onclick = () => {
      closeProfileMenu();
      const target = Auth.allProfiles().find((p) => p.id === btn.dataset.goto);
      Auth.clearActiveProfile();
      if (Auth.hasPin(target)) pinScreen(target);
      else enterApp(target.id);
    };
  });

  profileMenu.querySelector("[data-manage]").onclick = () => {
    closeProfileMenu();
    manageScreen();
  };
  profileMenu.querySelector("[data-switch]").onclick = () => {
    closeProfileMenu();
    Auth.clearActiveProfile();
    profilePicker();
  };
  profileMenu.querySelector("[data-account]").onclick = () => {
    closeProfileMenu();
    accountScreen();
  };
  profileMenu.querySelector("[data-logout]").onclick = () => Auth.logout();
}

document.getElementById("profile-button").onclick = (e) => {
  e.stopPropagation();
  if (menuIsOpen()) closeProfileMenu();
  else openProfileMenu();
};

document.addEventListener("click", () => menuIsOpen() && closeProfileMenu());

function accountScreen() {
  const account = Auth.currentAccount();

  showGate(`
    <div class="relative min-h-full">
      ${gateBrand()}
      <button type="button" data-back
        class="absolute right-5 top-5 text-3xl font-light leading-none text-neutral-300 hover:text-white md:right-10 md:top-8 md:text-4xl">&times;</button>

      <div class="gate-rise flex min-h-screen flex-col items-center justify-center px-6">
        <div class="w-full max-w-md rounded-lg bg-[#181818] p-6 md:p-10">
          <h1 class="mb-6 text-2xl font-bold">Akun</h1>

          <dl class="space-y-4 text-sm">
            <div>
              <dt class="text-neutral-500">Username</dt>
              <dd class="text-lg">${esc(account?.username || "-")}</dd>
            </div>
            <div>
              <dt class="text-neutral-500">Email</dt>
              <dd class="text-lg">${esc(account?.email || "-")}</dd>
            </div>
            <div>
              <dt class="text-neutral-500">Profil</dt>
              <dd class="text-lg">${Auth.allProfiles().length} dari ${Auth.MAX_PROFILES}</dd>
            </div>
          </dl>

          <button type="button" data-close
            class="mt-8 w-full rounded border border-neutral-600 py-3 text-sm hover:bg-neutral-800">Kembali</button>
        </div>
      </div>
    </div>
  `);

  const back = () => {
    const active = Auth.currentProfile();
    if (active) showApp();
    else profilePicker();
  };

  gate.querySelector("[data-back]").onclick = back;
  gate.querySelector("[data-close]").onclick = back;
}

// ---------- Boot ----------
// onAuth menyala sekali saat halaman dimuat (sesi Firebase bertahan sendiri di
// browser) dan tiap kali status login berubah.
Auth.onAuth(async (account) => {
  if (!account) {
    authScreen("signin");
    return;
  }

  const list = Auth.allProfiles();

  // belum punya profil sama sekali -> langsung ke pembuatan
  if (!list.length) {
    profileForm();
    return;
  }

  // profil terakhir diingat, jadi buka ulang situs tidak menanyakan apa pun
  const remembered = Auth.savedProfileId();
  if (remembered && list.some((p) => p.id === remembered)) {
    // buka ulang halaman bukan hasil klik, jadi tanpa bunyi -- browser pun
    // akan menolak memutarnya tanpa interaksi lebih dulu
    await enterApp(remembered, false);
    return;
  }

  profilePicker();
});
