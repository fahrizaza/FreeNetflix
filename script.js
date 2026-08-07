// TMDB dipakai karena mengirim header CORS "*", jadi bisa dipanggil langsung
// dari browser di domain mana pun -- tidak perlu proxy seperti API sebelumnya.
const TMDB_KEY = "e514a26ed1063ffba53ecce04eeb969d";
const TMDB = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p";
const REGION = "ID"; // dipakai untuk daftar layanan streaming
const PLAYER = "https://streamimdb.ru/embed";
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
    genres: [],
    seasonCount: 0,
    episodeCount: 0,
    providers: [],
    detailLoaded: false,
  };
}

// Satu request mengambil semua yang kurang: durasi, genre, imdb_id untuk
// player, jumlah season, dan daftar layanan streaming.
async function fetchDetail(item) {
  if (item.detailLoaded) return item;

  const kind = item.type === "SHOW" ? "tv" : "movie";
  const data = await tmdb(
    `/${kind}/${item.tmdbId}?append_to_response=external_ids,watch/providers`
  );

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

// ---------- Penyimpanan id ----------
function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function persist(saved) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
}

function isSaved(id) {
  return Boolean(loadSaved()[id]);
}

function toggleSaved(item) {
  const saved = loadSaved();

  if (saved[item.id]) {
    delete saved[item.id];
  } else {
    // id JustWatch + id IMDb disimpan supaya bisa dipakai lagi tanpa search ulang
    saved[item.id] = {
      id: item.id,
      imdbId: item.imdbId,
      tmdbId: item.tmdbId,
      title: item.title,
      year: item.year,
      type: item.type,
      backdrop: item.backdrop,
      poster: item.poster,
      savedAt: new Date().toISOString(),
    };
  }

  persist(saved);
  renderSavedRow();
  return Boolean(saved[item.id]);
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
function playerUrl(item, ep = null) {
  if (!validImdbId(item.imdbId)) return "";

  const id = item.imdbId.trim();
  const query = new URLSearchParams(PLAYER_PARAMS);

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
  const { top10 = false } = opts;

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
    <button type="button" data-id="${esc(item.id)}" class="group/card w-[240px] shrink-0 snap-start text-left">
      <div class="relative aspect-video overflow-hidden rounded-md bg-neutral-800 transition duration-300 group-hover/card:ring-2 group-hover/card:ring-white/60">
        ${top10Badge}
        ${netflix}
        ${image}
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
  return `<div class="w-[240px] shrink-0 animate-pulse"><div class="aspect-video rounded-md bg-neutral-800"></div></div>`;
}

// ---------- Baris ----------
function rowShell(key, title) {
  return `
    <section data-row="${esc(key)}" class="group/row relative mb-10">
      <h2 class="mb-3 px-8 text-xl font-bold md:text-2xl">${esc(title)}</h2>

      <button type="button" data-scroll="-1"
        class="absolute left-0 top-1/2 z-20 hidden h-24 w-8 -translate-y-1/2 items-center justify-center rounded-r-md bg-black/60 text-2xl opacity-0 transition group-hover/row:opacity-100 md:flex">&#8249;</button>

      <div data-track
        class="flex snap-x snap-mandatory gap-2 overflow-x-auto scroll-smooth px-8 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        ${skeletonCard().repeat(6)}
      </div>

      <button type="button" data-scroll="1"
        class="absolute right-0 top-1/2 z-20 hidden h-24 w-8 -translate-y-1/2 items-center justify-center rounded-l-md bg-black/60 text-2xl opacity-0 transition group-hover/row:opacity-100 md:flex">&#8250;</button>
    </section>
  `;
}

function fillRow(key, items, opts = {}) {
  const track = document.querySelector(`[data-row="${key}"] [data-track]`);
  if (!track) return;

  if (!items.length) {
    track.innerHTML = `<p class="px-0 py-8 text-sm text-neutral-500">Tidak ada hasil.</p>`;
    return;
  }

  track.innerHTML = items
    .map((item, i) => cardTemplate(item, { top10: opts.top10 && i < 3 }))
    .join("");
}

// ---------- Baris "My List" (dari id yang disimpan) ----------
function renderSavedRow() {
  const items = Object.values(loadSaved()).sort((a, b) =>
    b.savedAt.localeCompare(a.savedAt)
  );
  const existing = document.querySelector('[data-row="saved"]');

  if (!items.length) {
    existing?.remove();
    return;
  }

  if (!existing) {
    document
      .getElementById("rows")
      .insertAdjacentHTML("afterbegin", rowShell("saved", "My List"));
  }

  // item tersimpan hanya menyimpan field ringkas -> lengkapi dari catalog bila ada
  fillRow(
    "saved",
    items.map((s) => catalog.get(s.id) || { ...s, providers: [], rating: null })
  );
}

// ---------- Modal detail ----------
function stageImage(item) {
  return item.backdrop
    ? `<img src="${esc(item.backdrop)}" alt="${esc(item.title)}" class="h-full w-full object-cover" />`
    : `<div class="flex h-full w-full items-center justify-center bg-neutral-800 text-sm text-neutral-500">${esc(item.title)}</div>`;
}

function openDetail(item) {
  const modal = document.getElementById("modal");
  firstEpisode = null;

  modal.className =
    "fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/80 p-4 py-10";
  modal.innerHTML = `
    <div class="w-full max-w-4xl overflow-hidden rounded-lg bg-[#181818] shadow-2xl">

      <div class="relative aspect-video bg-black">
        <div data-stage class="absolute inset-0">${stageImage(item)}</div>

        <!-- lapisan bening: klik tidak pernah sampai ke halaman embed -->
        <div data-shield class="absolute inset-0 z-10"></div>

        <div class="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-2/3 bg-gradient-to-t from-[#181818] via-[#181818]/60 to-transparent"></div>

        <button type="button" data-close
          class="absolute right-4 top-4 z-30 flex h-10 w-10 items-center justify-center rounded-full bg-[#181818] text-xl hover:bg-black">&times;</button>

        <div class="absolute inset-x-0 bottom-0 z-20 p-6 md:p-10">
          <h3 class="max-w-[70%] text-3xl font-black tracking-tight drop-shadow-lg md:text-5xl">${esc(item.title)}</h3>

          <div class="mt-5 flex items-center gap-3">
            <button type="button" data-play disabled
              class="flex items-center gap-2 rounded bg-white px-7 py-2 text-lg font-bold text-black hover:bg-white/80 disabled:cursor-not-allowed disabled:opacity-40">
              <span class="text-xl leading-none">&#9654;</span> Play
            </button>

            <button type="button" data-save title="My List"
              class="flex h-10 w-10 items-center justify-center rounded-full border-2 border-neutral-400 bg-black/40 text-xl leading-none hover:border-white"></button>

            <button type="button" data-like title="Suka"
              class="flex h-10 w-10 items-center justify-center rounded-full border-2 border-neutral-400 bg-black/40 hover:border-white">&#128077;</button>
          </div>
        </div>
      </div>

      <div class="grid gap-8 p-6 md:grid-cols-[2fr_1fr] md:p-10 md:pt-6">
        <div class="space-y-4">
          <div class="flex flex-wrap items-center gap-3 text-sm">
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
          ? `<div data-episodes class="border-t border-neutral-800 p-6 md:p-10 md:pt-6">
               <div class="mb-4 flex items-center justify-between gap-4">
                 <h4 class="text-xl font-bold">Episode</h4>
                 <select data-season
                   class="hidden rounded border border-neutral-600 bg-[#181818] px-3 py-2 text-sm outline-none"></select>
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
    toggleSaved(item);
    paintSave();
  };

  likeBtn.onclick = () => {
    likeBtn.classList.toggle("border-white");
    likeBtn.classList.toggle("bg-white/20");
  };

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
  } else {
    set("[data-imdb]", "tidak ada ID IMDb");
  }

  if (item.type === "SHOW") loadEpisodes(item, modal);
}

// episode pertama dipakai tombol Play setelah daftar episode selesai dimuat
let firstEpisode = null;

function episodeRow(item, ep) {
  const thumb = ep.image
    ? `<img src="${esc(ep.image)}" alt="" loading="lazy" class="h-full w-full object-cover" />`
    : "";

  return `
    <button type="button" data-ep="${ep.season}-${ep.number}"
      class="flex w-full items-center gap-4 rounded p-3 text-left hover:bg-neutral-800">
      <span class="w-6 shrink-0 text-center text-lg text-neutral-400">${ep.number}</span>
      <span class="h-16 w-28 shrink-0 overflow-hidden rounded bg-neutral-800">${thumb}</span>
      <span class="min-w-0 flex-1">
        <span class="flex items-baseline justify-between gap-3">
          <span class="truncate font-semibold">${esc(ep.name)}</span>
          ${ep.runtime ? `<span class="shrink-0 text-xs text-neutral-400">${ep.runtime}m</span>` : ""}
        </span>
        <span class="mt-1 line-clamp-2 block text-xs leading-relaxed text-neutral-400">${esc(ep.summary)}</span>
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

  picker.innerHTML = seasons
    .map((s) => `<option value="${s.number}">Season ${s.number}</option>`)
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

    list.querySelectorAll("[data-ep]").forEach((btn) => {
      const [s, n] = btn.dataset.ep.split("-").map(Number);
      btn.onclick = () => openPlayer(item, { season: s, number: n });
    });

    // tombol Play utama mengikuti episode pertama season yang sedang dibuka
    if (eps.length) firstEpisode = { season: eps[0].season, number: eps[0].number };
  };

  picker.onchange = () => paint(picker.value);
  paint(seasons[0].number);
}

function closeDetail() {
  const modal = document.getElementById("modal");
  modal.className = "hidden";
  modal.innerHTML = "";
}

// ---------- Player fullscreen ----------
// Halaman embed mendeteksi atribut "sandbox" dan langsung redirect, jadi klik
// diblokir pakai lapisan bening di atas iframe (bukan sandbox).
let screenLocked = true;
let barTimer = null;
let toastTimer = null;
let toggleLock = null; // diisi saat player terbuka, dipakai shortcut keyboard

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

function openPlayer(item, ep = null) {
  const url = playerUrl(item, ep);
  if (!url) return;

  const el = document.getElementById("player");
  el.className = "fixed inset-0 z-[60] bg-black";
  el.innerHTML = `
    <iframe
      src="${esc(url)}"
      title="${esc(item.title)}"
      class="absolute inset-0 h-full w-full border-0"
      allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
      allowfullscreen
      referrerpolicy="origin"
    ></iframe>
    

    <div data-shield class="absolute inset-0 z-10"></div>

    <div data-bar class="absolute inset-x-0 top-0 z-20 flex items-center gap-4 bg-gradient-to-b from-black/90 via-black/50 to-transparent p-4 transition-opacity duration-300">
      <button type="button" data-back
        class="flex shrink-0 items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-sm font-semibold hover:bg-black">
        &#8592; Kembali
      </button>
      <div class="min-w-0">
        <p class="truncate font-semibold">${esc(item.title)}</p>
        <p class="truncate text-xs text-neutral-400">
          ${ep ? `S${ep.season}:E${ep.number} &middot; ` : ""}${esc(item.year)} &middot; ${esc(item.imdbId)}
        </p>
      </div>
      <button type="button" data-relock
        class="ml-auto hidden shrink-0 rounded-full bg-black/70 px-4 py-2 text-xs font-semibold hover:bg-black">
        &#128274; Kunci lagi
      </button>
    </div>

    <div data-toast
      class="pointer-events-none absolute bottom-8 left-1/2 z-20 -translate-x-1/2 rounded-full bg-black/80 px-4 py-2 text-sm font-semibold opacity-0 transition-opacity duration-300"></div>
  `;

  const shield = el.querySelector("[data-shield]");
  const bar = el.querySelector("[data-bar]");
  const toast = el.querySelector("[data-toast]");
  const relockBtn = el.querySelector("[data-relock]");

  const showToast = (html, ms = 2000) => {
    toast.innerHTML = html;
    toast.classList.remove("opacity-0");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.add("opacity-0"), ms);
  };

  const applyLock = (announce = false) => {
    shield.classList.toggle("pointer-events-none", !screenLocked);

    // saat terkunci tidak ada tombol kunci; baru muncul setelah dibuka, karena
    // shortcut "L" tidak terbaca kalau fokus sudah pindah ke dalam iframe
    relockBtn.classList.toggle("hidden", screenLocked);

    if (announce) {
      showToast(
        screenLocked
          ? "&#128274; Layar dikunci"
          : "&#128275; Layar dibuka &middot; tekan L untuk mengunci"
      );
    }

    if (!screenLocked) showBar(false); // kontrol player dipakai -> bar jangan hilang
  };

  const showBar = (autoHide = true) => {
    bar.classList.remove("opacity-0");
    clearTimeout(barTimer);
    if (autoHide && screenLocked) {
      barTimer = setTimeout(() => bar.classList.add("opacity-0"), 3000);
    }
  };

  el.querySelector("[data-back]").onclick = () => closePlayer();

  // tidak ada tombolnya di layar -> hanya lewat shortcut "L"
  toggleLock = () => {
    screenLocked = !screenLocked;
    applyLock(true);
    showBar();
  };
  relockBtn.onclick = toggleLock;

  // pointer di atas shield tetap terbaca karena shield anak dari #player
  el.addEventListener("mousemove", () => showBar());
  el.addEventListener("touchstart", () => showBar(), { passive: true });

  applyLock();
  showBar();
  requestFullscreen(el);

  // supaya tombol back browser menutup player, bukan meninggalkan halaman
  history.pushState({ netflixPlayer: true }, "");
}

function closePlayer(fromPopstate = false) {
  const el = document.getElementById("player");
  if (el.classList.contains("hidden")) return;

  clearTimeout(barTimer);
  clearTimeout(toastTimer);
  toggleLock = null;
  screenLocked = true; // sesi player berikutnya selalu mulai dalam keadaan terkunci
  el.className = "hidden";
  el.innerHTML = ""; // menghapus iframe = playback berhenti
  exitFullscreen();

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
  document.getElementById("hero-desc").textContent = item.providers.length
    ? `Tersedia di ${item.providers.slice(0, 3).map((p) => p.name).join(", ")}.`
    : "Belum tersedia di layanan streaming.";

  document.getElementById("hero-play").onclick = () => openDetail(item);
  document.getElementById("hero-info").onclick = () => openDetail(item);
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

  // kartu di baris "My List" bisa berasal dari localStorage, bukan dari hasil search
  const item = catalog.get(card.dataset.id) || loadSaved()[card.dataset.id];
  if (item) openDetail({ providers: [], rating: null, runtime: 0, ...item });
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (isPlayerOpen()) closePlayer();
    else closeDetail();
    return;
  }

  // shortcut tersembunyi: buka/kunci lagi lapisan pelindung player
  if (e.key.toLowerCase() === "l" && isPlayerOpen()) {
    e.preventDefault();
    toggleLock?.();
  }
});

document.getElementById("search-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = document.getElementById("search-input").value.trim();
  if (!query) return;

  const rows = document.getElementById("rows");
  document.querySelector('[data-row="search"]')?.remove();
  rows.insertAdjacentHTML("afterbegin", rowShell("search", `Hasil untuk "${query}"`));
  rows.scrollIntoView({ behavior: "smooth" });

  try {
    fillRow("search", await fetchList(`/search/multi?query=${encodeURIComponent(query)}`));
  } catch (err) {
    fillRow("search", []);
    console.error(err);
  }
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
async function runQueue() {
  const queue = [...ROWS];
  const attempts = new Map();

  while (queue.length) {
    const row = queue.shift();
    const attempt = (attempts.get(row.key) || 0) + 1;
    attempts.set(row.key, attempt);

    try {
      const items = await fetchList(row.path, row.type);
      fillRow(row.key, items, { top10: row.top10 });
      if (row.key === "next") fillHero(items[0]);
      renderSavedRow(); // lengkapi My List dengan data dari catalog
    } catch (err) {
      console.error(`Gagal memuat baris "${row.title}" (percobaan ${attempt})`, err);
      queue.push(row); // antre lagi di belakang
    }

    await wait(QUEUE_GAP_MS);
    await whenVisible();
  }
}

async function init() {
  const rows = document.getElementById("rows");
  rows.innerHTML = ROWS.map((r) => rowShell(r.key, r.title)).join("");
  renderSavedRow();

  runQueue();
}

init();
