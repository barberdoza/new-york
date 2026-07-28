(function () {
  "use strict";

  const METRIC_LABEL = {
    establishments: "Shops",
    employees: "Employees",
    payroll_annual_thousands: "Payroll",
    "nonemployer.establishments": "Solo shops",
    "nonemployer.receipts_thousands": "Solo receipts",
  };

  function getMetric(cat, metric) {
    if (!cat) return null;
    if (metric.startsWith("nonemployer.")) {
      const field = metric.split(".")[1];
      return cat.nonemployer ? cat.nonemployer[field] ?? null : null;
    }
    return cat[metric] ?? null;
  }

  const state = {
    data: null,
    metric: "establishments",
    selectedFips: null, // null = show national totals
  };

  const els = {
    search: document.getElementById("state-search"),
    stateList: document.getElementById("state-list"),
    metricBtns: Array.from(document.querySelectorAll(".metric-btn")),
    detail: document.getElementById("detail"),
    rankTitle: document.getElementById("rank-title"),
    rankSub: document.getElementById("rank-sub"),
    rankChart: document.getElementById("rank-chart"),
    tableBody: document.getElementById("data-table-body"),
    sampleBanner: document.getElementById("sample-banner"),
    sourceLabel: document.getElementById("source-label"),
    updatedLabel: document.getElementById("updated-label"),
  };

  function fmtNumber(n) {
    if (n === null || n === undefined) return null;
    return n.toLocaleString("en-US");
  }

  function fmtPayroll(thousands) {
    if (thousands === null || thousands === undefined) return null;
    const dollars = thousands * 1000;
    if (dollars >= 1_000_000_000) return "$" + (dollars / 1_000_000_000).toFixed(2) + "B";
    if (dollars >= 1_000_000) return "$" + (dollars / 1_000_000).toFixed(1) + "M";
    return "$" + fmtNumber(dollars);
  }

  function formatMetric(metric, value) {
    if (value === null || value === undefined) return null;
    return metric.endsWith("_thousands") ? fmtPayroll(value) : fmtNumber(value);
  }

  function categoryTotal(stateObj, metric) {
    let total = 0;
    let any = false;
    Object.values(stateObj.categories).forEach((cat) => {
      const v = getMetric(cat, metric);
      if (v !== null && v !== undefined) {
        total += v;
        any = true;
      }
    });
    return any ? total : null;
  }

  function findState(query) {
    if (!query) return null;
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return (
      state.data.states.find((s) => s.state.toLowerCase() === q) ||
      state.data.states.find((s) => s.abbr.toLowerCase() === q) ||
      state.data.states.find((s) => s.state.toLowerCase().startsWith(q)) ||
      null
    );
  }

  function nationalTotals() {
    const totals = {};
    Object.keys(state.data.categories).forEach((code) => {
      totals[code] = { establishments: 0, employees: 0, payroll_annual_thousands: 0, label: state.data.categories[code] };
    });
    state.data.states.forEach((s) => {
      Object.entries(s.categories).forEach(([code, cat]) => {
        ["establishments", "employees", "payroll_annual_thousands"].forEach((m) => {
          if (cat[m] !== null && cat[m] !== undefined) totals[code][m] += cat[m];
        });
      });
    });
    return totals;
  }

  function renderDetail() {
    const sel = state.selectedFips ? state.data.states.find((s) => s.state_fips === state.selectedFips) : null;
    const title = sel ? sel.state : "United States (all states)";
    let rankBadge = "";
    if (sel) {
      const rank = rankStates(state.metric).findIndex((r) => r.state_fips === sel.state_fips) + 1;
      rankBadge = `<span class="rank-badge">#${rank} of ${state.data.states.length} in ${METRIC_LABEL[state.metric].toLowerCase()}</span>`;
    }
    const categories = sel ? sel.categories : nationalTotals();

    const boards = Object.entries(categories)
      .map(([code, cat]) => {
        const employerRows = [
          ["Establishments", formatMetric("establishments", cat.establishments)],
          ["Employees", formatMetric("employees", cat.employees)],
          ["Annual payroll", formatMetric("payroll_annual_thousands", cat.payroll_annual_thousands)],
        ];
        const nonemp = cat.nonemployer || {};
        const nonempRows = [
          ["Solo/self-employed shops", formatMetric("nonemployer.establishments", nonemp.establishments)],
          ["Annual receipts", formatMetric("nonemployer.receipts_thousands", nonemp.receipts_thousands)],
        ];
        const rowHtml = ([label, value]) =>
          `<div class="row"><dt>${label}</dt><dd>${value === null ? '<span class="na">withheld</span>' : value}</dd></div>`;
        return `<div class="board">
          <h3>${cat.label}</h3>
          <p class="board-group-label">Employer shops (paid staff)</p>
          <dl>${employerRows.map(rowHtml).join("")}</dl>
          <p class="board-group-label">No paid employees</p>
          <dl>${nonempRows.map(rowHtml).join("")}</dl>
        </div>`;
      })
      .join("");

    els.detail.innerHTML = `
      <div class="detail-heading">
        <h2>${title}</h2>
        ${rankBadge}
      </div>
      <div class="board-grid">${boards}</div>
    `;
  }

  function rankStates(metric) {
    return state.data.states
      .map((s) => ({ ...s, _value: categoryTotal(s, metric) }))
      .sort((a, b) => (b._value ?? -1) - (a._value ?? -1));
  }

  function renderRankChart() {
    els.rankTitle.textContent = "How states compare — " + METRIC_LABEL[state.metric];
    els.rankSub.textContent = `Ranked by total ${METRIC_LABEL[state.metric].toLowerCase()} across barbershops, beauty salons & nail salons.`;

    const ranked = rankStates(state.metric);
    const max = ranked[0]._value || 1;
    const showCount = 15;
    let list = ranked.slice(0, showCount);

    if (state.selectedFips && !list.find((s) => s.state_fips === state.selectedFips)) {
      const sel = ranked.find((s) => s.state_fips === state.selectedFips);
      if (sel) list = list.concat([sel]);
    }

    els.rankChart.innerHTML = list
      .map((s) => {
        const pct = s._value ? Math.max(2, (s._value / max) * 100) : 0;
        const isCurrent = s.state_fips === state.selectedFips;
        const valueLabel = formatMetric(state.metric, s._value) ?? "—";
        return `
          <div class="rank-row${isCurrent ? " is-current" : ""}">
            <div class="rank-name">${s.state}</div>
            <div class="rank-bar-track"><div class="rank-bar-fill" style="width:${pct}%"></div></div>
            <div class="rank-value">${valueLabel}</div>
          </div>`;
      })
      .join("");

    if (ranked.length > showCount) {
      const rankMore = document.createElement("p");
      rankMore.className = "rank-more";
      rankMore.textContent = `Showing top ${showCount} of ${ranked.length}${state.selectedFips ? " (plus your selected state)" : ""}. Full list in the table below.`;
      els.rankChart.appendChild(rankMore);
    }
  }

  function renderTable() {
    const query = els.search.value.trim().toLowerCase();
    const rows = state.data.states
      .filter((s) => !query || s.state.toLowerCase().includes(query) || s.abbr.toLowerCase() === query)
      .map((s) => {
        const c = s.categories;
        const get = (code, field) => c[code] ? c[code][field] : null;
        const totalEmp = categoryTotal(s, "employees");
        const totalPay = categoryTotal(s, "payroll_annual_thousands");
        const totalSolo = categoryTotal(s, "nonemployer.establishments");
        const cell = (v) => (v === null || v === undefined ? '<span class="na">—</span>' : fmtNumber(v));
        const isCurrent = s.state_fips === state.selectedFips;
        return `
          <tr class="${isCurrent ? "is-current-row" : ""}" data-fips="${s.state_fips}">
            <td>${s.state}</td>
            <td>${cell(get("812111", "establishments"))}</td>
            <td>${cell(get("812112", "establishments"))}</td>
            <td>${cell(get("812113", "establishments"))}</td>
            <td>${cell(totalEmp)}</td>
            <td>${totalPay === null ? '<span class="na">—</span>' : fmtPayroll(totalPay)}</td>
            <td>${cell(totalSolo)}</td>
          </tr>`;
      })
      .join("");

    els.tableBody.innerHTML = rows || `<tr><td colspan="7">No states match “${els.search.value}”.</td></tr>`;
  }

  function renderAll() {
    renderDetail();
    renderRankChart();
    renderTable();
  }

  function selectFromSearch() {
    const match = findState(els.search.value);
    state.selectedFips = match ? match.state_fips : null;
    renderAll();
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
    }) + ` (CBP ${data.year})`;

    els.stateList.innerHTML = data.states.map((s) => `<option value="${s.state}"></option>`).join("");

    els.search.addEventListener("input", selectFromSearch);

    els.metricBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        els.metricBtns.forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        state.metric = btn.dataset.metric;
        renderAll();
      });
    });

    els.tableBody.addEventListener("click", (e) => {
      const row = e.target.closest("tr[data-fips]");
      if (!row) return;
      const s = state.data.states.find((s) => s.state_fips === row.dataset.fips);
      if (s) {
        els.search.value = s.state;
        state.selectedFips = s.state_fips;
        renderAll();
      }
    });

    renderAll();
  }

  fetch("data/cbp_data.json")
    .then((r) => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(init)
    .catch((err) => {
      els.detail.innerHTML = `<p class="muted">Couldn't load data/cbp_data.json (${err.message}). If you're running this locally, serve the folder with a local server (e.g. <code>python3 -m http.server</code>) rather than opening the file directly.</p>`;
    });
})();
