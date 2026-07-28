(function () {
  "use strict";

  const state = {
    data: null,
    selectedCity: null, // null = statewide
    cityCentroids: null, // city -> {lat, lon}
    map: null,
    clusterLayer: null,
  };

  const els = {
    search: document.getElementById("city-search"),
    cityList: document.getElementById("city-list"),
    finderHint: document.getElementById("finder-hint"),
    summary: document.getElementById("summary"),
    rankTitle: document.getElementById("rank-title"),
    rankSub: document.getElementById("rank-sub"),
    rankChart: document.getElementById("rank-chart"),
    tableBody: document.getElementById("data-table-body"),
    sampleBanner: document.getElementById("sample-banner"),
    sourceLabel: document.getElementById("source-label"),
    updatedLabel: document.getElementById("updated-label"),
  };

  function fmtNumber(n) {
    if (n === null || n === undefined) return "—";
    return n.toLocaleString("en-US");
  }

  function categoryLabel(code) {
    return (state.data.categories && state.data.categories[code]) || code;
  }

  function findRollup(cityName) {
    const q = cityName.trim().toLowerCase();
    if (!q) return null;
    return (
      state.data.rollup.find((r) => r.city.toLowerCase() === q) ||
      state.data.rollup.find((r) => r.city.toLowerCase().startsWith(q)) ||
      null
    );
  }

  function statewideTotals() {
    const totals = { total: 0 };
    Object.keys(state.data.categories).forEach((code) => (totals[code] = 0));
    state.data.rollup.forEach((r) => {
      totals.total += r.total;
      Object.keys(state.data.categories).forEach((code) => {
        totals[code] += r[code] || 0;
      });
    });
    return totals;
  }

  function renderSummary() {
    const sel = state.selectedCity ? findRollup(state.selectedCity) : null;
    const title = sel ? sel.city : "New York State (all cities)";
    const totals = sel || statewideTotals();

    let rankBadge = "";
    if (sel) {
      const sorted = [...state.data.rollup].sort((a, b) => b.total - a.total);
      const rank = sorted.findIndex((r) => r.city === sel.city) + 1;
      rankBadge = `<span class="rank-badge">#${rank} of ${sorted.length} cities by total shops</span>`;
    }

    const boards = Object.entries(state.data.categories)
      .map(([code, label]) => `
        <div class="board">
          <h3>${label}</h3>
          <dl>
            <div class="row"><dt>Active licensed shops</dt><dd>${fmtNumber(totals[code] || 0)}</dd></div>
          </dl>
        </div>`)
      .join("");

    els.summary.innerHTML = `
      <div class="detail-heading">
        <h2>${title}</h2>
        ${rankBadge}
      </div>
      <p class="summary-total">
        <span class="summary-total-value">${fmtNumber(totals.total)}</span>
        total active licensed shops
      </p>
      <div class="board-grid">${boards}</div>
    `;
  }

  function renderRankChart() {
    const ranked = [...state.data.rollup].sort((a, b) => b.total - a.total);
    const max = ranked[0] ? ranked[0].total : 1;
    const showCount = 15;
    let list = ranked.slice(0, showCount);

    if (state.selectedCity) {
      const sel = findRollup(state.selectedCity);
      if (sel && !list.find((r) => r.city === sel.city)) list = list.concat([sel]);
    }

    els.rankChart.innerHTML = list
      .map((r) => {
        const pct = Math.max(2, (r.total / max) * 100);
        const isCurrent = state.selectedCity && r.city.toLowerCase() === state.selectedCity.trim().toLowerCase();
        return `
          <div class="rank-row${isCurrent ? " is-current" : ""}">
            <div class="rank-name">${r.city}</div>
            <div class="rank-bar-track"><div class="rank-bar-fill" style="width:${pct}%"></div></div>
            <div class="rank-value">${fmtNumber(r.total)}</div>
          </div>`;
      })
      .join("");

    if (ranked.length > showCount) {
      const more = document.createElement("p");
      more.className = "rank-more";
      more.textContent = `Showing top ${showCount} of ${ranked.length} cities. Full list in the table below.`;
      els.rankChart.appendChild(more);
    }
  }

  function renderTable() {
    const query = els.search.value.trim().toLowerCase();
    const rows = state.data.rollup
      .filter((r) => !query || r.city.toLowerCase().includes(query))
      .map((r) => {
        const isCurrent = state.selectedCity && r.city.toLowerCase() === state.selectedCity.trim().toLowerCase();
        return `
          <tr class="${isCurrent ? "is-current-row" : ""}" data-city="${r.city}">
            <td>${r.city}</td>
            <td>${fmtNumber(r.DOSBARSHOPOWNER || 0)}</td>
            <td>${fmtNumber(r.DOSAEBUSINESS || 0)}</td>
            <td class="td-total">${fmtNumber(r.total)}</td>
          </tr>`;
      })
      .join("");

    els.tableBody.innerHTML = rows || `<tr><td colspan="4">No cities match "${els.search.value}".</td></tr>`;
  }

  function computeCityCentroids() {
    const sums = {}; // city -> {lat, lon, n}
    state.data.shops.forEach(([, , , city, , lat, lon]) => {
      if (lat == null || lon == null) return;
      const b = sums[city] || (sums[city] = { lat: 0, lon: 0, n: 0 });
      b.lat += lat;
      b.lon += lon;
      b.n += 1;
    });
    const out = {};
    Object.entries(sums).forEach(([city, b]) => {
      out[city] = { lat: b.lat / b.n, lon: b.lon / b.n };
    });
    return out;
  }

  function buildMap() {
    state.map = L.map("map", { scrollWheelZoom: true }).setView([42.9, -75.5], 7);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 18,
    }).addTo(state.map);

    state.clusterLayer = L.markerClusterGroup({ maxClusterRadius: 50 });

    state.data.shops.forEach(([name, category, address, city, zip, lat, lon]) => {
      if (lat == null || lon == null) return;
      const marker = L.marker([lat, lon]);
      marker.bindPopup(
        `<div class="shop-popup"><strong>${escapeHtml(name)}</strong><br />
         <span class="shop-popup-cat">${escapeHtml(categoryLabel(category))}</span><br />
         ${escapeHtml(address)}, ${escapeHtml(city)} ${escapeHtml(zip)}</div>`
      );
      state.clusterLayer.addLayer(marker);
    });

    state.map.addLayer(state.clusterLayer);
  }

  function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  function flyToCity(cityName) {
    if (!state.map) return;
    const centroid = state.cityCentroids[cityName];
    if (centroid) {
      state.map.flyTo([centroid.lat, centroid.lon], 12, { duration: 0.8 });
    }
  }

  function renderAll() {
    renderSummary();
    renderRankChart();
    renderTable();
  }

  function selectFromSearch() {
    const q = els.search.value.trim();
    const match = q ? findRollup(q) : null;
    state.selectedCity = match ? match.city : null;
    els.finderHint.textContent = state.selectedCity
      ? `Showing ${state.selectedCity}. Clear the search to see statewide totals.`
      : "Showing statewide totals until you pick a city.";
    renderAll();
    if (match) flyToCity(match.city);
  }

  function init(data) {
    state.data = data;

    if (data.is_sample) {
      els.sampleBanner.hidden = false;
    }
    els.sourceLabel.textContent = data.source;
    els.updatedLabel.textContent = new Date(data.generated_at).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    els.cityList.innerHTML = data.rollup.map((r) => `<option value="${r.city}"></option>`).join("");

    state.cityCentroids = computeCityCentroids();

    els.search.addEventListener("input", selectFromSearch);

    els.tableBody.addEventListener("click", (e) => {
      const row = e.target.closest("tr[data-city]");
      if (!row) return;
      els.search.value = row.dataset.city;
      selectFromSearch();
    });

    buildMap();
    renderAll();
  }

  fetch("data/ny_shops.json")
    .then((r) => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(init)
    .catch((err) => {
      els.summary.innerHTML = `<p class="muted">Couldn't load data/ny_shops.json (${err.message}). If you're running this locally, serve the folder with a local server (e.g. <code>python3 -m http.server</code>) rather than opening the file directly.</p>`;
    });
})();
