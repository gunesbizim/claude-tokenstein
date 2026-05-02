import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import type { HtmlReportData, PeriodSummary } from "./html-data.js";

const HERE = dirname(fileURLToPath(import.meta.url));

function fmtTokens(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

function fmtCost(n: number, currency: string): string {
  const sym = currency === "eur" ? "€" : "$";
  return `${sym}${n.toFixed(2)}`;
}

function buildCards(p: PeriodSummary, currency: string): string {
  return `
    <div class="cards">
      <div class="card">
        <div class="card-label">Total (gen)</div>
        <div class="card-value">${fmtTokens(p.totalGen)}</div>
      </div>
      <div class="card">
        <div class="card-label">Total (all)</div>
        <div class="card-value">${fmtTokens(p.totalAll)}</div>
      </div>
      <div class="card cache-card">
        <div class="card-label">Cache Read</div>
        <div class="card-value cache-value">${fmtTokens(p.totalCacheRead)}</div>
        <div class="card-sub">${fmtCost(p.totalCacheReadCost, currency)}</div>
      </div>
      <div class="card">
        <div class="card-label">Total Cost</div>
        <div class="card-value">${fmtCost(p.totalCost, currency)}</div>
      </div>
      <div class="card">
        <div class="card-label">Turns</div>
        <div class="card-value">${p.turns.toLocaleString()}</div>
      </div>
    </div>`;
}

function buildTable(p: PeriodSummary, currency: string): string {
  const sym = currency === "eur" ? "€" : "$";
  if (p.rows.length === 0) {
    return `<div class="no-data">No data for this period.</div>`;
  }
  const rows = p.rows
    .map(
      (r) => `
      <tr>
        <td>${r.day}</td>
        <td class="model-cell">${r.model}</td>
        <td class="num">${fmtTokens(r.input)}</td>
        <td class="num">${fmtTokens(r.output)}</td>
        <td class="num">${fmtTokens(r.cache_write)}</td>
        <td class="num cache-val">${fmtTokens(r.cache_read)}</td>
        <td class="num">${fmtTokens(r.total)}</td>
        <td class="num">${fmtTokens(r.total_all)}</td>
        <td class="num cost-val">${sym}${r.cost.toFixed(4)}</td>
      </tr>`,
    )
    .join("");
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date</th><th>Model</th>
            <th class="num">Input</th><th class="num">Output</th>
            <th class="num">CacheW</th><th class="num cache-val">CacheR</th>
            <th class="num">Total (gen)</th><th class="num">Total (all)</th>
            <th class="num">Cost</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function buildSection(p: PeriodSummary, idx: number, currency: string): string {
  const active = idx === 0 ? " active" : "";
  const isTrend = p.period === "ytd" || p.period === "ltd";
  const trendChart = isTrend
    ? `<div class="chart-row chart-row-full"><canvas id="chart-trend-${p.period}"></canvas></div>`
    : "";
  return `
  <section id="tab-${p.period}" class="tab-content${active}">
    ${buildCards(p, currency)}
    <div class="chart-row">
      <div class="chart-box"><canvas id="chart-tokens-${p.period}"></canvas></div>
      <div class="chart-box"><canvas id="chart-cost-${p.period}"></canvas></div>
    </div>
    <div class="chart-row chart-row-full">
      <canvas id="chart-breakdown-${p.period}"></canvas>
    </div>
    ${trendChart}
    <div class="cache-note">
      Cache reads priced at ~10% of standard input rate — shown in <span class="cache-value">green</span>.
    </div>
    ${buildTable(p, currency)}
  </section>`;
}

const CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, -apple-system, sans-serif; background: #0f1117; color: #c9d1d9; min-height: 100vh; }
  header { padding: 1.5rem 2rem; border-bottom: 1px solid #21262d; }
  header h1 { font-size: 1.4rem; font-weight: 600; color: #e6edf3; }
  header .sub { font-size: 0.8rem; color: #8b949e; margin-top: 0.25rem; }
  .tabs { display: flex; gap: 0.25rem; padding: 1rem 2rem 0; border-bottom: 1px solid #21262d; overflow-x: auto; }
  .tab-btn { background: none; border: none; color: #8b949e; cursor: pointer; padding: 0.6rem 1rem; font-size: 0.9rem; border-bottom: 2px solid transparent; white-space: nowrap; transition: color 0.15s; }
  .tab-btn:hover { color: #c9d1d9; }
  .tab-btn.active { color: #7c6af7; border-bottom-color: #7c6af7; font-weight: 600; }
  .tab-content { display: none; padding: 1.5rem 2rem 3rem; }
  .tab-content.active { display: block; }
  .cards { display: flex; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.5rem; }
  .card { background: #1e2130; border: 1px solid #21262d; border-radius: 8px; padding: 1rem 1.25rem; min-width: 140px; flex: 1; }
  .cache-card { border-color: #1d4a3a; }
  .card-label { font-size: 0.75rem; color: #8b949e; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.4rem; }
  .card-value { font-size: 1.5rem; font-weight: 700; color: #e6edf3; }
  .card-sub { font-size: 0.8rem; color: #8b949e; margin-top: 0.2rem; }
  .cache-value { color: #34d399; }
  .cache-val { color: #34d399; }
  .cost-val { color: #a78bfa; }
  .chart-row { display: flex; gap: 1rem; margin-bottom: 1.5rem; }
  .chart-box { background: #1e2130; border: 1px solid #21262d; border-radius: 8px; padding: 1rem; flex: 1; min-height: 280px; position: relative; }
  .chart-row-full canvas { width: 100% !important; }
  .chart-row-full { background: #1e2130; border: 1px solid #21262d; border-radius: 8px; padding: 1rem; margin-bottom: 1.5rem; }
  .cache-note { font-size: 0.8rem; color: #8b949e; margin-bottom: 1rem; padding: 0.6rem 1rem; background: #161b22; border-left: 3px solid #34d399; border-radius: 0 4px 4px 0; }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
  thead th { background: #161b22; color: #8b949e; padding: 0.5rem 0.75rem; text-align: left; border-bottom: 1px solid #21262d; white-space: nowrap; }
  tbody tr:hover { background: #161b22; }
  tbody td { padding: 0.45rem 0.75rem; border-bottom: 1px solid #21262d; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .model-cell { font-size: 0.78rem; color: #a78bfa; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .no-data { color: #8b949e; padding: 2rem; text-align: center; }
  @media (max-width: 768px) {
    .chart-row { flex-direction: column; }
    header, .tabs, .tab-content { padding-left: 1rem; padding-right: 1rem; }
    .cards { flex-direction: column; }
  }
`;

const CLIENT_JS = `
(function() {
  var btns = document.querySelectorAll('.tab-btn');
  var sections = document.querySelectorAll('.tab-content');
  btns.forEach(function(btn) {
    btn.addEventListener('click', function() {
      btns.forEach(function(b) { b.classList.remove('active'); });
      sections.forEach(function(s) { s.classList.remove('active'); });
      btn.classList.add('active');
      var target = document.getElementById('tab-' + btn.dataset.period);
      if (target) target.classList.add('active');
    });
  });

  var COLORS = [
    '#7c6af7','#34d399','#f87171','#fbbf24','#60a5fa','#a78bfa','#fb923c','#4ade80'
  ];
  var INPUT_COLOR = '#60a5fa';
  var OUTPUT_COLOR = '#34d399';
  var CACHE_WRITE_COLOR = '#fbbf24';
  var CACHE_READ_COLOR = '#4ade80';

  function shortModel(m) {
    return m.replace('claude-', '').replace(/-\\d{8}$/, '');
  }

  function byModel(rows) {
    var map = {};
    rows.forEach(function(r) {
      if (!map[r.model]) map[r.model] = { input:0, output:0, cache_write:0, cache_read:0, cost:0 };
      var m = map[r.model];
      m.input += r.input; m.output += r.output;
      m.cache_write += r.cache_write; m.cache_read += r.cache_read;
      m.cost += r.cost;
    });
    return map;
  }

  function byTime(rows) {
    var map = {};
    rows.forEach(function(r) {
      map[r.day] = (map[r.day] || 0) + r.total_all;
    });
    var keys = Object.keys(map).sort();
    return { labels: keys, values: keys.map(function(k) { return map[k]; }) };
  }

  var chartInstances = {};

  function destroyChart(id) {
    if (chartInstances[id]) { chartInstances[id].destroy(); delete chartInstances[id]; }
  }

  function renderPeriod(period) {
    var rows = period.rows;
    var models = period.models;
    var modelMap = byModel(rows);
    var modelLabels = models.map(shortModel);

    // Stacked bar: input / output / cache_write / cache_read per model
    var tokensId = 'chart-tokens-' + period.period;
    destroyChart(tokensId);
    var tokensEl = document.getElementById(tokensId);
    if (tokensEl && rows.length > 0) {
      chartInstances[tokensId] = new Chart(tokensEl, {
        type: 'bar',
        data: {
          labels: modelLabels,
          datasets: [
            { label: 'Input', data: models.map(function(m) { return (modelMap[m]||{}).input||0; }), backgroundColor: INPUT_COLOR },
            { label: 'Output', data: models.map(function(m) { return (modelMap[m]||{}).output||0; }), backgroundColor: OUTPUT_COLOR },
            { label: 'Cache Write', data: models.map(function(m) { return (modelMap[m]||{}).cache_write||0; }), backgroundColor: CACHE_WRITE_COLOR },
            { label: 'Cache Read', data: models.map(function(m) { return (modelMap[m]||{}).cache_read||0; }), backgroundColor: CACHE_READ_COLOR },
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { labels: { color: '#c9d1d9', font: { size: 11 } } }, title: { display: true, text: 'Tokens by Model', color: '#e6edf3' } },
          scales: {
            x: { stacked: true, ticks: { color: '#8b949e' }, grid: { color: '#21262d' } },
            y: { stacked: true, ticks: { color: '#8b949e' }, grid: { color: '#21262d' } }
          }
        }
      });
    }

    // Doughnut: cost per model
    var costId = 'chart-cost-' + period.period;
    destroyChart(costId);
    var costEl = document.getElementById(costId);
    if (costEl && rows.length > 0) {
      chartInstances[costId] = new Chart(costEl, {
        type: 'doughnut',
        data: {
          labels: modelLabels,
          datasets: [{ data: models.map(function(m) { return (modelMap[m]||{}).cost||0; }), backgroundColor: COLORS }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: '#c9d1d9', font: { size: 11 } } },
            title: { display: true, text: 'Cost by Model', color: '#e6edf3' }
          }
        }
      });
    }

    // Grouped bar: token breakdown per model
    var breakdownId = 'chart-breakdown-' + period.period;
    destroyChart(breakdownId);
    var breakdownEl = document.getElementById(breakdownId);
    if (breakdownEl && rows.length > 0) {
      chartInstances[breakdownId] = new Chart(breakdownEl, {
        type: 'bar',
        data: {
          labels: modelLabels,
          datasets: [
            { label: 'Input', data: models.map(function(m) { return (modelMap[m]||{}).input||0; }), backgroundColor: INPUT_COLOR },
            { label: 'Output', data: models.map(function(m) { return (modelMap[m]||{}).output||0; }), backgroundColor: OUTPUT_COLOR },
            { label: 'Cache Write', data: models.map(function(m) { return (modelMap[m]||{}).cache_write||0; }), backgroundColor: CACHE_WRITE_COLOR },
            { label: 'Cache Read', data: models.map(function(m) { return (modelMap[m]||{}).cache_read||0; }), backgroundColor: CACHE_READ_COLOR },
          ]
        },
        options: {
          responsive: true,
          plugins: { legend: { labels: { color: '#c9d1d9', font: { size: 11 } } }, title: { display: true, text: 'Token Breakdown', color: '#e6edf3' } },
          scales: {
            x: { ticks: { color: '#8b949e' }, grid: { color: '#21262d' } },
            y: { ticks: { color: '#8b949e' }, grid: { color: '#21262d' } }
          }
        }
      });
    }

    // Trend line (YTD + LTD only)
    if (period.period === 'ytd' || period.period === 'ltd') {
      var trendId = 'chart-trend-' + period.period;
      destroyChart(trendId);
      var trendEl = document.getElementById(trendId);
      if (trendEl && rows.length > 0) {
        var td = byTime(rows);
        chartInstances[trendId] = new Chart(trendEl, {
          type: 'line',
          data: {
            labels: td.labels,
            datasets: [{
              label: 'Total Tokens (all)',
              data: td.values,
              borderColor: '#7c6af7',
              backgroundColor: 'rgba(124,106,247,0.15)',
              fill: true,
              tension: 0.3,
              pointRadius: td.labels.length > 60 ? 0 : 3,
            }]
          },
          options: {
            responsive: true,
            plugins: { legend: { labels: { color: '#c9d1d9' } }, title: { display: true, text: 'Token Trend', color: '#e6edf3' } },
            scales: {
              x: { ticks: { color: '#8b949e', maxRotation: 45, maxTicksLimit: 12 }, grid: { color: '#21262d' } },
              y: { ticks: { color: '#8b949e' }, grid: { color: '#21262d' } }
            }
          }
        });
      }
    }
  }

  // Render active tab on load
  var activeSection = document.querySelector('.tab-content.active');
  if (activeSection) {
    var activePeriod = activeSection.id.replace('tab-', '');
    var found = REPORT.periods.find(function(p) { return p.period === activePeriod; });
    if (found) renderPeriod(found);
  }

  // Render on tab switch
  btns.forEach(function(btn) {
    btn.addEventListener('click', function() {
      var p = REPORT.periods.find(function(p) { return p.period === btn.dataset.period; });
      if (p) renderPeriod(p);
    });
  });
})();
`;

export async function buildHtmlTemplate(data: HtmlReportData): Promise<string> {
  const chartJsSrc = await readFile(
    join(HERE, "../../node_modules/chart.js/dist/chart.umd.min.js"),
    "utf8",
  );

  const tabButtons = data.periods
    .map(
      (p, i) =>
        `<button class="tab-btn${i === 0 ? " active" : ""}" data-period="${p.period}">${p.label}</button>`,
    )
    .join("\n    ");

  const sections = data.periods
    .map((p, i) => buildSection(p, i, data.currency))
    .join("\n");

  const reportJson = JSON.stringify(data, (_k, v) =>
    typeof v === "bigint" ? Number(v) : v,
  );

  const sym = data.currency === "eur" ? "€" : "$";
  const genAt = new Date(data.generatedAt).toLocaleString();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Claude Token Report</title>
  <style>${CSS}</style>
</head>
<body>
  <header>
    <h1>Claude Token Report</h1>
    <div class="sub">Generated ${genAt} &nbsp;·&nbsp; Currency: ${sym} ${data.currency.toUpperCase()}</div>
  </header>
  <nav class="tabs">
    ${tabButtons}
  </nav>
  ${sections}
  <script>${chartJsSrc}</script>
  <script>const REPORT = ${reportJson};</script>
  <script>${CLIENT_JS}</script>
</body>
</html>`;
}
