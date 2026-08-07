const API = "https://imdb.iamidiotareyoutoo.com/justwatch";
const PLAYER = "https://streamimdb.ru/embed";
// JustWatch tidak mengembalikan jumlah season/episode, jadi daftar episode
// diambil dari TVmaze -- gratis, tanpa API key, dan bisa dicari lewat imdbId.
const TVMAZE = "https://api.tvmaze.com";
const STORAGE_KEY = "netflix:saved";

// Baris default. API ini hanya punya endpoint search,
// jadi tiap baris diisi dari satu kata kunci pencarian.
const ROWS = [
  { key: "next", title: "Your Next Watch", query: "spider-man", top10: true },
  { key: "trending", title: "Trending Now", query: "avatar" },
  { key: "series", title: "Serial Populer", query: "stranger things" },
  { key: "anime", title: "Anime", query: "anime" },
  { key: "local", title: "Film Indonesia", query: "pengabdi setan" },
];

// Semua judul yang pernah dimuat, dipakai saat kartu diklik.
const catalog = new Map();

// ---------- API ----------
async function searchTitles(query) {
  const res = await fetch(`${API}?q=${encodeURIComponent(query)}`);

  // 5xx = server API yang bermasalah, bukan kesalahan di sisi kita
  if (!res.ok) {
    throw new Error(
      res.status >= 500
        ? `Server API sedang bermasalah (HTTP ${res.status})`
        : `Permintaan ditolak (HTTP ${res.status})`
    );
  }

  const json = await res.json();
  if (!json.ok) throw new Error("Pencarian gagal diproses server");

  const items = (json.description || []).map(normalize);
  items.forEach((item) => catalog.set(item.id, item));
  return items;
}

function normalize(raw) {
  const providers = [];
  (raw.offers || []).forEach((offer) => {
    if (!providers.some((p) => p.name === offer.name)) {
      providers.push({ name: offer.name, url: offer.url, type: offer.type });
    }
  });

  return {
    id: raw.id, // <- id JustWatch, ini yang disimpan
    imdbId: raw.imdbId || "",
    tmdbId: raw.tmdbId || "",
    title: raw.title || "Tanpa judul",
    year: raw.year || "",
    runtime: raw.runtime || 0,
    type: raw.type || "MOVIE",
    url: raw.url || "#",
    poster: (raw.photo_url || [])[0] || "",
    backdrop: (raw.backdrops || [])[0] || (raw.photo_url || [])[0] || "",
    rating: raw.jwRating ? Math.round(raw.jwRating * 100) : null,
    tomato: raw.tomatoMeter,
    providers,
  };
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

// ---------- Daftar episode (TVmaze) ----------
const episodeCache = new Map();

// summary dari TVmaze berisi HTML; DOMParser membuat dokumen inert,
// jadi tidak ada script/gambar yang ikut jalan saat tag dibuang
function stripHtml(html) {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (doc.body.textContent || "").trim();
}

async function fetchEpisodes(imdbId) {
  if (episodeCache.has(imdbId)) return episodeCache.get(imdbId);

  const res = await fetch(`${TVMAZE}/lookup/shows?imdb=${encodeURIComponent(imdbId)}`);
  if (!res.ok) throw new Error("Serial ini tidak ada di TVmaze");
  const show = await res.json();

  const [seasons, episodes] = await Promise.all([
    fetch(`${TVMAZE}/shows/${show.id}/seasons`).then((r) => r.json()),
    fetch(`${TVMAZE}/shows/${show.id}/episodes`).then((r) => r.json()),
  ]);

  const data = {
    seasons: seasons.map((s) => ({ number: s.number, count: s.episodeOrder || 0 })),
    episodes: episodes.map((e) => ({
      season: e.season,
      number: e.number,
      name: e.name || `Episode ${e.number}`,
      runtime: e.runtime || 0,
      image: e.image?.medium || "",
      summary: stripHtml(e.summary),
    })),
  };

  episodeCache.set(imdbId, data);
  return data;
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
    track.innerHTML = `<p class="py-8 text-sm text-neutral-500">Tidak ada hasil untuk kata kunci ini.</p>`;
    return;
  }

  track.innerHTML = items
    .map((item, i) => cardTemplate(item, { top10: opts.top10 && i < 3 }))
    .join("");
}

// dibedakan dari "tidak ada hasil": ini API-nya yang gagal dihubungi
function rowError(key, message, retryKey = "") {
  const track = document.querySelector(`[data-row="${key}"] [data-track]`);
  if (!track) return;

  track.innerHTML = `
    <div class="py-6">
      <p class="text-sm text-neutral-300">${esc(message)}</p>
      <p class="mt-1 text-xs text-neutral-500">Sumber datanya sedang tidak bisa dihubungi, bukan masalah di halaman ini.</p>
      ${
        retryKey
          ? `<button type="button" data-retry="${esc(retryKey)}"
               class="mt-3 rounded bg-neutral-800 px-3 py-1.5 text-xs font-semibold hover:bg-neutral-700">Coba lagi</button>`
          : ""
      }
    </div>
  `;
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
  const player = playerUrl(item);
  firstEpisode = null;

  const providers = item.providers.length
    ? item.providers
        .slice(0, 8)
        .map(
          (p) =>
            `<a href="${esc(p.url)}" target="_blank" rel="noopener"
               class="text-white underline-offset-2 hover:underline">${esc(p.name)}</a>`
        )
        .join(", ")
    : `<span class="text-neutral-500">Belum tersedia di layanan streaming.</span>`;

  const badge = (text, extra = "") =>
    `<span class="rounded border border-neutral-500 px-1.5 text-[11px] leading-5 text-neutral-300 ${extra}">${text}</span>`;

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
            <button type="button" data-play ${player ? "" : "disabled"}
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
            ${duration(item) ? `<span class="text-neutral-300">${duration(item)}</span>` : ""}
            ${item.type === "SHOW" ? `<span data-eps-meta class="text-neutral-300"></span>` : ""}
            ${badge("HD")}
            ${item.rating ? `<span class="font-semibold text-green-500">${item.rating}% match</span>` : ""}
          </div>

          ${
            item.rating >= 90 || item.tomato >= 85
              ? `<p class="flex items-center gap-2 font-semibold">
                   <span class="flex h-6 w-6 items-center justify-center rounded bg-red-600 text-xs">&#128077;</span>
                   Most Liked
                 </p>`
              : ""
          }

          <p class="text-sm leading-relaxed text-neutral-200">
            ${esc(item.title)}${item.year ? ` (${esc(item.year)})` : ""} &mdash;
            ${item.type === "SHOW" ? "serial" : "film"} dengan
            ${item.rating ? `skor penonton ${item.rating}%` : "skor penonton belum tersedia"}${
              item.tomato ? ` dan Rotten Tomatoes ${item.tomato}%` : ""
            }.
          </p>
        </div>

        <div class="space-y-4 text-sm">
          <p class="leading-relaxed">
            <span class="text-neutral-500">Tonton di: </span>${providers}
          </p>
          ${
            item.tomato
              ? `<p><span class="text-neutral-500">Rotten Tomatoes: </span>${item.tomato}%${
                  item.tomato >= 75 ? " (Fresh)" : ""
                }</p>`
              : ""
          }
          <p class="leading-relaxed">
            <span class="text-neutral-500">ID: </span>
            <span class="font-mono text-xs">${esc(item.id)}</span> &middot;
            <span class="font-mono text-xs">${esc(item.imdbId || "-")}</span>
          </p>
          ${
            player
              ? ""
              : `<p class="text-xs text-neutral-500">ID IMDb tidak tersedia, video tidak bisa diputar.</p>`
          }
        </div>
      </div>

      ${
        item.type === "SHOW" && player
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

  if (player) playBtn.onclick = () => openPlayer(item, firstEpisode);

  if (item.type === "SHOW" && player) loadEpisodes(item, modal);
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
  const list = box.querySelector("[data-eplist]");
  const picker = box.querySelector("[data-season]");
  const meta = modal.querySelector("[data-eps-meta]");

  let data;
  try {
    data = await fetchEpisodes(item.imdbId);
  } catch {
    list.textContent = "Daftar episode tidak tersedia untuk serial ini.";
    return;
  }

  if (modal.innerHTML === "") return; // modal keburu ditutup

  const seasons = data.seasons.filter((s) => data.episodes.some((e) => e.season === s.number));
  if (!seasons.length) {
    list.textContent = "Daftar episode tidak tersedia untuk serial ini.";
    return;
  }

  if (meta) {
    meta.textContent = `${seasons.length} Season · ${data.episodes.length} Episode`;
  }

  picker.innerHTML = seasons
    .map((s) => `<option value="${s.number}">Season ${s.number}</option>`)
    .join("");
  picker.classList.remove("hidden");

  const paint = (season) => {
    const eps = data.episodes.filter((e) => e.season === Number(season));
    list.className = "space-y-1";
    list.innerHTML = eps.map((ep) => episodeRow(item, ep)).join("");

    list.querySelectorAll("[data-ep]").forEach((btn) => {
      const [s, n] = btn.dataset.ep.split("-").map(Number);
      btn.onclick = () => openPlayer(item, { season: s, number: n });
    });
  };

  picker.onchange = () => paint(picker.value);
  paint(seasons[0].number);

  const first = data.episodes.find((e) => e.season === seasons[0].number);
  if (first) firstEpisode = { season: first.season, number: first.number };
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

  const retry = e.target.closest("[data-retry]");
  if (retry) {
    const row = ROWS.find((r) => r.key === retry.dataset.retry);
    if (row) {
      retry.closest("[data-track]").innerHTML = skeletonCard().repeat(6);
      loadRow(row);
    }
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
    fillRow("search", await searchTitles(query));
  } catch (err) {
    rowError("search", err.message);
    console.error(err);
  }
});

// ---------- Init ----------
async function loadRow(row) {
  try {
    const items = await searchTitles(row.query);
    fillRow(row.key, items, { top10: row.top10 });
    if (row.key === "next") fillHero(items[0]);
  } catch (err) {
    rowError(row.key, err.message, row.key);
    console.error(`Gagal memuat baris "${row.title}"`, err);
  }
}

async function init() {
  const rows = document.getElementById("rows");
  rows.innerHTML = ROWS.map((r) => rowShell(r.key, r.title)).join("");
  renderSavedRow();

  await Promise.all(ROWS.map(loadRow));

  renderSavedRow(); // isi ulang memakai data lengkap dari catalog
}

init();
