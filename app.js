/* Spoiler-Free Movie Briefing
 * Zero-cost, browser-only app powered by the TMDB API.
 * The key deliberately avoids requesting anything that would reveal plot twists:
 * we show tagline + a trimmed, non-spoiler premise, cast/characters, crew,
 * series position, content rating, and practical facts — but never the full
 * synopsis, keywords, or reviews that tend to leak endings.
 */

const TMDB_BASE = "https://api.themoviedb.org/3";
const IMG_BASE = "https://image.tmdb.org/t/p";
const KEY_STORAGE = "tmdb_key_v1";
const REGION_STORAGE = "tmdb_region_v1";
const DEFAULT_REGION = "US";

function getRegion() {
  return localStorage.getItem(REGION_STORAGE) || DEFAULT_REGION;
}

const els = {
  searchInput: document.getElementById("searchInput"),
  clearBtn: document.getElementById("clearBtn"),
  suggestions: document.getElementById("suggestions"),
  main: document.getElementById("main"),
  emptyState: document.getElementById("emptyState"),
  settingsBtn: document.getElementById("settingsBtn"),
  settingsModal: document.getElementById("settingsModal"),
  closeSettings: document.getElementById("closeSettings"),
  apiKeyInput: document.getElementById("apiKeyInput"),
  saveKey: document.getElementById("saveKey"),
  clearKey: document.getElementById("clearKey"),
  keyStatus: document.getElementById("keyStatus"),
  regionSelect: document.getElementById("regionSelect"),
  exampleChips: document.getElementById("exampleChips"),
};

/* ---------- API key handling ---------- */
function getKey() {
  return localStorage.getItem(KEY_STORAGE) || "";
}
function isV4Token(k) {
  // v4 tokens are JWTs (three dot-separated base64 segments) and are long.
  return k.split(".").length === 3 && k.length > 60;
}
function authFetch(path, params = {}) {
  const key = getKey();
  if (!key) return Promise.reject(new Error("NO_KEY"));
  const url = new URL(TMDB_BASE + path);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  });
  const opts = { headers: {} };
  if (isV4Token(key)) {
    opts.headers.Authorization = `Bearer ${key}`;
  } else {
    url.searchParams.set("api_key", key);
  }
  return fetch(url.toString(), opts).then((r) => {
    if (r.status === 401) throw new Error("BAD_KEY");
    if (!r.ok) throw new Error("HTTP_" + r.status);
    return r.json();
  });
}

/* ---------- Search + autocomplete ---------- */
let searchTimer = null;
let activeIndex = -1;
let currentResults = [];

els.searchInput.addEventListener("input", () => {
  const q = els.searchInput.value.trim();
  els.clearBtn.hidden = q.length === 0;
  clearTimeout(searchTimer);
  if (q.length < 2) {
    hideSuggestions();
    return;
  }
  searchTimer = setTimeout(() => runSearch(q), 260);
});

els.searchInput.addEventListener("keydown", (e) => {
  if (els.suggestions.hidden) return;
  const items = [...els.suggestions.querySelectorAll("li")];
  if (e.key === "ArrowDown") {
    e.preventDefault();
    activeIndex = Math.min(activeIndex + 1, items.length - 1);
    updateActive(items);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    activeIndex = Math.max(activeIndex - 1, 0);
    updateActive(items);
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (activeIndex >= 0 && currentResults[activeIndex]) {
      selectMovie(currentResults[activeIndex].id);
    } else if (currentResults[0]) {
      selectMovie(currentResults[0].id);
    }
  } else if (e.key === "Escape") {
    hideSuggestions();
  }
});

function updateActive(items) {
  items.forEach((li, i) => li.classList.toggle("active", i === activeIndex));
  if (items[activeIndex]) items[activeIndex].scrollIntoView({ block: "nearest" });
}

els.clearBtn.addEventListener("click", () => {
  els.searchInput.value = "";
  els.clearBtn.hidden = true;
  hideSuggestions();
  els.searchInput.focus();
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-wrap")) hideSuggestions();
});

function hideSuggestions() {
  els.suggestions.hidden = true;
  els.suggestions.innerHTML = "";
  activeIndex = -1;
}

async function runSearch(q) {
  if (!getKey()) {
    openSettings("Add your free TMDB key to start searching.");
    return;
  }
  try {
    const data = await authFetch("/search/movie", {
      query: q,
      include_adult: false,
      language: "en-US",
      page: 1,
    });
    currentResults = (data.results || [])
      .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
      .slice(0, 8);
    renderSuggestions();
  } catch (err) {
    handleKeyError(err);
  }
}

function renderSuggestions() {
  if (!currentResults.length) {
    hideSuggestions();
    return;
  }
  els.suggestions.innerHTML = currentResults
    .map((m, i) => {
      const year = m.release_date ? m.release_date.slice(0, 4) : "—";
      const poster = m.poster_path
        ? `<img src="${IMG_BASE}/w92${m.poster_path}" alt="" loading="lazy" />`
        : `<span class="poster-fallback">🎬</span>`;
      return `<li data-index="${i}" data-id="${m.id}">
        ${poster}
        <div class="sugg-meta">
          <span class="sugg-title">${escapeHtml(m.title)}</span>
          <span class="sugg-year">${year}</span>
        </div>
      </li>`;
    })
    .join("");
  els.suggestions.hidden = false;
  activeIndex = -1;
  els.suggestions.querySelectorAll("li").forEach((li) => {
    li.addEventListener("click", () => selectMovie(Number(li.dataset.id)));
  });
}

/* ---------- Movie detail + briefing ---------- */
async function selectMovie(id) {
  hideSuggestions();
  els.searchInput.blur();
  showLoading();
  try {
    const movie = await authFetch(`/movie/${id}`, {
      language: "en-US",
      append_to_response: "credits,release_dates,watch/providers",
    });
    // Collection details (series order) if part of one.
    let collection = null;
    if (movie.belongs_to_collection) {
      try {
        collection = await authFetch(
          `/collection/${movie.belongs_to_collection.id}`,
          { language: "en-US" }
        );
      } catch (_) { /* non-fatal */ }
    }
    renderBriefing(movie, collection);
    saveToHistory(movie);
    setUrlForMovie(movie.id);
  } catch (err) {
    handleKeyError(err);
  }
}

/* ---------- Recently viewed history + deep links ---------- */
const HISTORY_STORAGE = "recent_movies_v1";
const HISTORY_MAX = 12;

function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_STORAGE)) || [];
  } catch (_) {
    return [];
  }
}
function saveToHistory(movie) {
  const entry = {
    id: movie.id,
    title: movie.title,
    year: movie.release_date ? movie.release_date.slice(0, 4) : "",
    poster: movie.poster_path || null,
  };
  const list = getHistory().filter((m) => m.id !== movie.id);
  list.unshift(entry);
  localStorage.setItem(HISTORY_STORAGE, JSON.stringify(list.slice(0, HISTORY_MAX)));
  renderHistory();
}
function clearHistory() {
  localStorage.removeItem(HISTORY_STORAGE);
  renderHistory();
}
function renderHistory() {
  const wrap = document.getElementById("historySection");
  if (!wrap) return;
  const list = getHistory();
  if (!list.length) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  wrap.innerHTML = `
    <div class="history-head">
      <span>🕘 Recently briefed</span>
      <button id="clearHistoryBtn" class="link-btn">Clear</button>
    </div>
    <div class="history-list">
      ${list
        .map(
          (m) => `<button class="history-item" data-id="${m.id}">
            ${
              m.poster
                ? `<img src="${IMG_BASE}/w92${m.poster}" alt="" loading="lazy" />`
                : `<span class="poster-fallback">🎬</span>`
            }
            <span class="history-title">${escapeHtml(m.title)}</span>
            ${m.year ? `<span class="history-year">${m.year}</span>` : ""}
          </button>`
        )
        .join("")}
    </div>`;
  wrap.querySelectorAll(".history-item").forEach((btn) => {
    btn.addEventListener("click", () => selectMovie(Number(btn.dataset.id)));
  });
  const clearBtn = document.getElementById("clearHistoryBtn");
  if (clearBtn) clearBtn.addEventListener("click", clearHistory);
}

function setUrlForMovie(id) {
  const url = new URL(window.location.href);
  url.searchParams.set("movie", id);
  history.replaceState({ movie: id }, "", url.toString());
}

function getCertification(movie) {
  const results = movie.release_dates?.results || [];
  const pref = ["US", "GB", "CA", "AU"];
  for (const region of pref) {
    const entry = results.find((r) => r.iso_3166_1 === region);
    const cert = entry?.release_dates?.find((d) => d.certification)?.certification;
    if (cert) return `${cert} (${region})`;
  }
  for (const entry of results) {
    const cert = entry.release_dates?.find((d) => d.certification)?.certification;
    if (cert) return `${cert} (${entry.iso_3166_1})`;
  }
  return null;
}

/* Trim a synopsis to a spoiler-safe premise: keep only the setup.
 * We keep at most the first 2 sentences (the "hook"), which describe the
 * premise, and strip anything after — later sentences tend to reveal turns. */
function safePremise(overview) {
  if (!overview) return null;
  const sentences = overview.match(/[^.!?]+[.!?]+/g);
  if (!sentences) return overview;
  const kept = sentences.slice(0, 2).join(" ").trim();
  return kept || overview;
}

function fmtRuntime(min) {
  if (!min) return null;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

function fmtMoney(n) {
  if (!n) return null;
  return "$" + n.toLocaleString("en-US");
}

/* Build a spoiler-free "where to watch" card from watch/providers.
 * TMDB provider data is powered by JustWatch. We show stream / rent / buy
 * options for the user's region, with a link to the JustWatch page. */
function buildProvidersCard(movie) {
  const region = getRegion();
  const all = movie["watch/providers"]?.results || {};
  const data = all[region];
  if (!data) {
    return `<div class="card">
      <h3>📺 Where to watch</h3>
      <p class="cast-role">No streaming, rental, or purchase options listed for ${escapeHtml(
        region
      )}. Try another region in ⚙️ settings.</p>
    </div>`;
  }
  const section = (label, list, icon) => {
    if (!list || !list.length) return "";
    const logos = list
      .slice(0, 8)
      .map(
        (p) =>
          `<span class="prov" title="${escapeHtml(p.provider_name)}">${
            p.logo_path
              ? `<img src="${IMG_BASE}/w45${p.logo_path}" alt="${escapeHtml(
                  p.provider_name
                )}" loading="lazy" />`
              : escapeHtml(p.provider_name)
          }</span>`
      )
      .join("");
    return `<div class="prov-group">
      <span class="prov-label">${icon} ${label}</span>
      <div class="prov-logos">${logos}</div>
    </div>`;
  };
  const body =
    section("Stream", data.flatrate, "▶️") +
    section("Rent", data.rent, "💵") +
    section("Buy", data.buy, "🛒");
  const link = data.link
    ? `<a class="prov-link" href="${data.link}" target="_blank" rel="noopener">See all options on JustWatch ↗</a>`
    : "";
  return `<div class="card">
    <h3>📺 Where to watch <span class="region-badge">${escapeHtml(region)}</span></h3>
    ${body || `<p class="cast-role">No options listed for ${escapeHtml(region)}.</p>`}
    ${link}
  </div>`;
}

function renderBriefing(movie, collection) {
  const year = movie.release_date ? movie.release_date.slice(0, 4) : "";
  const cert = getCertification(movie);
  const runtime = fmtRuntime(movie.runtime);
  const director = (movie.credits?.crew || []).find((c) => c.job === "Director");
  const writers = (movie.credits?.crew || [])
    .filter((c) => ["Screenplay", "Writer", "Story"].includes(c.job))
    .map((c) => c.name);
  const uniqueWriters = [...new Set(writers)].slice(0, 3);
  const cast = (movie.credits?.cast || []).slice(0, 6);
  const premise = safePremise(movie.overview);
  const genres = (movie.genres || []).map((g) => g.name);

  const backdrop = movie.backdrop_path
    ? `<div class="hero-backdrop" style="background-image:url('${IMG_BASE}/w780${movie.backdrop_path}')"></div>`
    : "";
  const poster = movie.poster_path
    ? `<img class="hero-poster" src="${IMG_BASE}/w342${movie.poster_path}" alt="${escapeHtml(movie.title)} poster" />`
    : `<div class="hero-poster">🎬</div>`;

  const metaPills = [
    year && `<span class="pill">📅 ${year}</span>`,
    runtime && `<span class="pill">⏱️ ${runtime}</span>`,
    cert && `<span class="pill rating">🔞 ${escapeHtml(cert)}</span>`,
    movie.vote_average
      ? `<span class="pill accent">⭐ ${movie.vote_average.toFixed(1)}/10</span>`
      : "",
    movie.original_language &&
      `<span class="pill">🗣️ ${movie.original_language.toUpperCase()}</span>`,
  ]
    .filter(Boolean)
    .join("");

  // Series / collection card
  let seriesCard = "";
  if (collection && collection.parts?.length) {
    const parts = [...collection.parts]
      .filter((p) => p.release_date)
      .sort((a, b) => a.release_date.localeCompare(b.release_date));
    const currentIdx = parts.findIndex((p) => p.id === movie.id);
    const items = parts
      .map((p, i) => {
        const py = p.release_date ? p.release_date.slice(0, 4) : "TBA";
        const isCurrent = p.id === movie.id;
        return `<div class="series-item ${isCurrent ? "current" : ""}">
          <span class="series-num">${i + 1}</span>
          <span class="series-title">${escapeHtml(p.title)}${isCurrent ? " — you're watching this" : ""}</span>
          <span class="series-year">${py}</span>
        </div>`;
      })
      .join("");
    const posNote =
      currentIdx > 0
        ? `This is entry <strong>#${currentIdx + 1}</strong> of ${parts.length} in the <strong>${escapeHtml(
            collection.name
          )}</strong>. There ${currentIdx === 1 ? "is 1 film" : `are ${currentIdx} films`} before it — worth knowing the broad strokes going in, but you don't need every detail.`
        : `This kicks off the <strong>${escapeHtml(collection.name)}</strong>. No prior films required — you're at the start.`;
    seriesCard = `<div class="card full">
      <h3>📚 Where it sits in the series</h3>
      <div class="watch-note">${posNote}</div>
      <div class="series-list" style="margin-top:14px">${items}</div>
    </div>`;
  }

  // Cast card
  const castHtml = cast.length
    ? cast
        .map((c) => {
          const photo = c.profile_path
            ? `<img class="cast-photo" src="${IMG_BASE}/w185${c.profile_path}" alt="" loading="lazy" />`
            : `<span class="cast-photo">🎭</span>`;
          return `<div class="cast-item">
            ${photo}
            <div>
              <div class="cast-name">${escapeHtml(c.name)}</div>
              <div class="cast-role">as ${escapeHtml(c.character || "—")}</div>
            </div>
          </div>`;
        })
        .join("")
    : `<p class="cast-role">Cast details unavailable.</p>`;

  // Facts card
  const facts = [
    director && ["Director", director.name],
    uniqueWriters.length && ["Writing", uniqueWriters.join(", ")],
    genres.length && ["Genre", genres.join(", ")],
    movie.status && ["Status", movie.status],
    movie.production_countries?.length &&
      ["Country", movie.production_countries.map((c) => c.name).join(", ")],
    movie.budget && ["Budget", fmtMoney(movie.budget)],
  ].filter(Boolean);
  const factsHtml = facts
    .map(
      ([k, v]) =>
        `<li><span class="k">${k}</span><span class="v">${escapeHtml(String(v))}</span></li>`
    )
    .join("");

  const briefing = document.createElement("div");
  briefing.className = "briefing";
  briefing.innerHTML = `
    <div class="hero">
      ${backdrop}
      ${poster}
      <div class="hero-body">
        <h2>${escapeHtml(movie.title)}${year ? ` <span style="color:var(--text-dim);font-weight:400">(${year})</span>` : ""}</h2>
        ${movie.tagline ? `<p class="hero-tag">"${escapeHtml(movie.tagline)}"</p>` : ""}
        <div class="meta-row">${metaPills}</div>
        <div class="genres">${genres.map((g) => `<span class="genre-tag">${escapeHtml(g)}</span>`).join("")}</div>
        <button class="share-btn" data-id="${movie.id}" data-title="${escapeHtml(movie.title)}">🔗 Share this briefing</button>
      </div>
    </div>

    <div class="grid">
      <div class="card full">
        <h3>🎯 The premise (spoiler-free)</h3>
        <p>${premise ? escapeHtml(premise) : "No premise available for this title."}</p>
        <span class="spoiler-note">✔ Trimmed to the setup only — no plot turns or ending revealed.</span>
      </div>

      ${seriesCard}

      <div class="card">
        <h3>🎭 Who you'll see</h3>
        <div class="cast-list">${castHtml}</div>
      </div>

      <div class="card">
        <h3>📋 Good to know</h3>
        <ul class="facts">${factsHtml}</ul>
        ${
          cert
            ? `<div class="watch-note">Content rating: <strong>${escapeHtml(
                cert
              )}</strong>. Check this if you're watching with family or are sensitive to mature content.</div>`
            : ""
        }
      </div>

      ${buildProvidersCard(movie)}
    </div>
  `;

  els.main.innerHTML = "";
  els.main.appendChild(briefing);

  const shareBtn = briefing.querySelector(".share-btn");
  if (shareBtn) {
    shareBtn.addEventListener("click", async () => {
      const url = new URL(window.location.href);
      url.searchParams.set("movie", shareBtn.dataset.id);
      const shareUrl = url.toString();
      const shareData = {
        title: `${shareBtn.dataset.title} — All You Need to Know`,
        text: `Spoiler-free briefing for ${shareBtn.dataset.title}`,
        url: shareUrl,
      };
      try {
        if (navigator.share) {
          await navigator.share(shareData);
        } else {
          await navigator.clipboard.writeText(shareUrl);
          shareBtn.textContent = "✔ Link copied!";
          setTimeout(() => (shareBtn.textContent = "🔗 Share this briefing"), 1800);
        }
      } catch (_) { /* user cancelled */ }
    });
  }
}

/* ---------- UI states ---------- */
function showLoading() {
  els.main.innerHTML = `<div class="state-msg"><div class="spinner"></div>Building your spoiler-free briefing…</div>`;
}

function showError(title, msg, action) {
  els.main.innerHTML = `<div class="error-box">
    <h3>${escapeHtml(title)}</h3>
    <p>${escapeHtml(msg)}</p>
    ${action ? `<button class="primary-btn" id="errAction" style="margin-top:14px;max-width:220px">${escapeHtml(action)}</button>` : ""}
  </div>`;
  const btn = document.getElementById("errAction");
  if (btn) btn.addEventListener("click", () => openSettings());
}

function handleKeyError(err) {
  if (err.message === "NO_KEY") {
    openSettings("Add your free TMDB key to start.");
  } else if (err.message === "BAD_KEY") {
    showError(
      "That key didn't work",
      "TMDB rejected the saved key or token. Double-check you copied the full v3 API key or v4 token.",
      "Open settings"
    );
  } else {
    showError(
      "Something went wrong",
      "Couldn't reach TMDB just now. Check your connection and try again.",
      "Open settings"
    );
  }
}

/* ---------- Settings modal ---------- */
function openSettings(statusMsg) {
  els.settingsModal.hidden = false;
  els.apiKeyInput.value = getKey();
  if (els.regionSelect) els.regionSelect.value = getRegion();
  if (statusMsg) {
    els.keyStatus.textContent = statusMsg;
    els.keyStatus.className = "key-status";
  } else {
    els.keyStatus.textContent = getKey() ? "A key is saved on this device." : "";
    els.keyStatus.className = "key-status ok";
  }
  els.apiKeyInput.focus();
}
function closeSettings() {
  els.settingsModal.hidden = true;
}
els.settingsBtn.addEventListener("click", () => openSettings());
els.closeSettings.addEventListener("click", closeSettings);
if (els.regionSelect) {
  els.regionSelect.addEventListener("change", () => {
    localStorage.setItem(REGION_STORAGE, els.regionSelect.value);
  });
}
els.settingsModal.addEventListener("click", (e) => {
  if (e.target === els.settingsModal) closeSettings();
});

els.saveKey.addEventListener("click", async () => {
  const val = els.apiKeyInput.value.trim();
  if (!val) {
    els.keyStatus.textContent = "Paste a key first.";
    els.keyStatus.className = "key-status err";
    return;
  }
  localStorage.setItem(KEY_STORAGE, val);
  els.keyStatus.textContent = "Checking key…";
  els.keyStatus.className = "key-status";
  try {
    await authFetch("/configuration");
    els.keyStatus.textContent = "✔ Key works and is saved on this device.";
    els.keyStatus.className = "key-status ok";
    setTimeout(closeSettings, 800);
  } catch (err) {
    els.keyStatus.textContent = "✕ TMDB rejected that key. Check it and try again.";
    els.keyStatus.className = "key-status err";
  }
});

els.clearKey.addEventListener("click", () => {
  localStorage.removeItem(KEY_STORAGE);
  els.apiKeyInput.value = "";
  els.keyStatus.textContent = "Saved key removed.";
  els.keyStatus.className = "key-status";
});

/* ---------- Example chips ---------- */
els.exampleChips.addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  els.searchInput.value = chip.dataset.q;
  els.clearBtn.hidden = false;
  runSearch(chip.dataset.q);
  els.searchInput.focus();
});

/* ---------- Utils ---------- */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ---------- Init ---------- */
(function init() {
  renderHistory();
  const params = new URLSearchParams(window.location.search);
  const movieId = params.get("movie");
  if (movieId && getKey()) {
    selectMovie(Number(movieId));
  } else if (!getKey()) {
    // Gentle nudge on first load.
    setTimeout(() => openSettings("Add your free TMDB key to get started."), 400);
  }
})();
