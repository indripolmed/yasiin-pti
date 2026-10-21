"use strict";

const STATUSES = ["baru", "dihubungi", "tertarik", "terdaftar", "bayar", "batal"];
const EVENT_TEXT = {
  page_view: "Membuka halaman", click_whatsapp: "Klik WhatsApp", click_cta: "Klik tombol",
  view_price: "Melihat biaya/jadwal", download_brochure: "Unduh brosur", form_start: "Mulai isi form",
  form_submit: "Kirim form", site_search: "Mencari di situs",
};
const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = (v) => (v == null ? "-" : `${(v * 100).toFixed(1)}%`);
const fmtDate = (s) => (s ? new Date(s).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "-");
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

let token = null;
try { token = sessionStorage.getItem("ysii_token"); } catch (e) {}
let me = null, programs = [], charts = {}, leadPage = 1;

// ---------------- API ----------------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
  });
  if (res.status === 401) { logout(); throw new Error("Sesi berakhir"); }
  if (!res.ok) {
    let msg = res.statusText;
    try { const d = await res.json(); msg = typeof d.detail === "string" ? d.detail : JSON.stringify(d.detail); } catch (e) {}
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

// ---------------- auth ----------------
function logout() {
  token = null;
  try { sessionStorage.removeItem("ysii_token"); } catch (e) {}
  $("#app-view").hidden = true;
  $("#login-view").hidden = false;
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  $("#login-error").textContent = "";
  try {
    const d = await api("/v1/auth/login", { method: "POST", body: JSON.stringify(Object.fromEntries(f)) });
    token = d.access_token;
    try { sessionStorage.setItem("ysii_token", token); } catch (e) {}
    boot();
  } catch (err) { $("#login-error").textContent = err.message; }
});
$("#logout").addEventListener("click", logout);

// ---------------- routing ----------------
function route() {
  const page = (location.hash || "#ringkasan").slice(1);
  document.querySelectorAll("[data-page]").forEach((s) => (s.hidden = s.dataset.page !== page));
  document.querySelectorAll("#tabs a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === `#${page}`));
  ({ ringkasan: loadKpi, lead: loadLeads, program: loadPrograms, seo: loadSeo, model: loadModel }[page] || loadKpi)();
}
addEventListener("hashchange", route);

async function boot() {
  try { me = await api("/v1/admin/me"); } catch (e) { return logout(); }
  $("#login-view").hidden = true;
  $("#app-view").hidden = false;
  await refreshPrograms();
  route();
}

async function refreshPrograms() {
  programs = await api("/v1/admin/programs");
  const opts = programs.map((p) => `<option value="${esc(p.slug)}">${esc(p.name)}</option>`).join("");
  $('#lead-filter [name="program"]').innerHTML = `<option value="">Semua program</option>${opts}`;
  $('#wa-form [name="program_slug"]').innerHTML = `<option value="">-</option>${opts}`;
}

function chart(id, config) {
  if (!window.Chart) return;
  charts[id]?.destroy();
  Chart.defaults.color = css("--muted");
  Chart.defaults.borderColor = css("--border");
  charts[id] = new Chart(document.getElementById(id), config);
}

// ---------------- ringkasan ----------------
$("#kpi-days").addEventListener("change", loadKpi);
async function loadKpi() {
  const d = await api(`/v1/admin/kpi?days=${$("#kpi-days").value}`);
  const tiles = [
    ["Pengunjung", d.visitors.toLocaleString("id-ID")],
    ["Sesi organik (Google)", `${d.organic_sessions.toLocaleString("id-ID")} / ${d.sessions.toLocaleString("id-ID")}`],
    ["Lead baru", d.leads],
    ["Menjadi peserta", d.converted],
    ["Konversi pengunjung → lead", pct(d.visitor_to_lead_rate)],
    ["Konversi lead → peserta", pct(d.lead_to_participant_rate)],
    ["Lead HOT", d.segments.hot || 0],
  ];
  $("#kpi-tiles").innerHTML = tiles.map(([l, v]) => `<div class="tile"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></div>`).join("");

  chart("chart-daily", {
    type: "line",
    data: {
      labels: d.series.map((s) => s.date.slice(5)),
      datasets: [
        { label: "Sesi", data: d.series.map((s) => s.sessions), borderColor: css("--cold"), tension: 0.3, yAxisID: "y" },
        { label: "Sesi organik", data: d.series.map((s) => s.organic), borderColor: css("--primary"), tension: 0.3, yAxisID: "y" },
        { label: "Lead", data: d.series.map((s) => s.leads), borderColor: css("--hot"), type: "bar", backgroundColor: css("--hot"), yAxisID: "y1" },
      ],
    },
    options: { interaction: { mode: "index", intersect: false }, scales: { y: { beginAtZero: true }, y1: { beginAtZero: true, position: "right", grid: { drawOnChartArea: false } } } },
  });
  const seg = ["hot", "warm", "cold"];
  chart("chart-segments", {
    type: "bar",
    data: { labels: ["Hot", "Warm", "Cold"], datasets: [{ label: "Lead", data: seg.map((s) => d.segments[s] || 0), backgroundColor: seg.map((s) => css(`--${s}`)) }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
  });
  $("#sources-table").innerHTML = "<tr><th>Sumber / medium</th><th class='num'>Sesi</th></tr>" +
    (d.sources.map(([s, n]) => `<tr><td>${esc(s)}</td><td class="num">${n}</td></tr>`).join("") || "<tr><td colspan=2 class='muted'>Belum ada data</td></tr>");
  const m = d.model;
  $("#model-summary").innerHTML = m.metrics
    ? `<dl class="kv"><dt>Algoritma</dt><dd>${esc(m.algorithm)}</dd><dt>Tugas</dt><dd>${esc(m.task_label)}</dd><dt>F1 (CV)</dt><dd>${m.metrics.f1}</dd><dt>AUC (CV)</dt><dd>${m.metrics.roc_auc ?? "-"}</dd><dt>Akurasi (CV)</dt><dd>${m.metrics.accuracy}</dd><dt>Dilatih</dt><dd>${fmtDate(m.trained_at)}</dd></dl>`
    : `<p>Memakai <b>skor berbasis aturan</b> karena data latih belum cukup. Model ML dapat dilatih di tab <a href="#model">Model ML</a>.</p>`;
}

// ---------------- lead ----------------
$('#lead-filter [name="status"]').innerHTML = `<option value="berjalan" selected>Masih berjalan</option><option value="">Semua status</option>${STATUSES.map((s) => `<option>${s}</option>`).join("")}`;
let filterTimer;
$("#lead-filter").addEventListener("input", () => { clearTimeout(filterTimer); filterTimer = setTimeout(() => { leadPage = 1; loadLeads(); }, 300); });
$("#lead-filter").addEventListener("submit", (e) => e.preventDefault());
$("#prev").addEventListener("click", () => { if (leadPage > 1) { leadPage--; loadLeads(); } });
$("#next").addEventListener("click", () => { leadPage++; loadLeads(); });

function waLink(phone, name) {
  if (!phone) return "";
  const text = encodeURIComponent(`Halo ${name || ""}, terima kasih sudah menghubungi Yayasan Sinergi Inspirasi Indonesia. `);
  return `<a class="btn small" target="_blank" rel="noopener" href="https://wa.me/${esc(phone)}?text=${text}">WhatsApp</a>`;
}
function scoreCell(l) {
  if (l.score == null) return "<span class='muted'>-</span>";
  return `<span class="badge ${esc(l.segment)}">${esc(l.segment)}</span> ${(l.score * 100).toFixed(0)}%<div class="bar"><i style="width:${(l.score * 100).toFixed(0)}%"></i></div>`;
}

async function loadLeads() {
  const params = new URLSearchParams(new FormData($("#lead-filter")));
  params.set("page", leadPage);
  params.set("limit", 25);
  const d = await api(`/v1/admin/leads?${params}`);
  const pages = Math.max(1, Math.ceil(d.total / d.limit));
  if (leadPage > pages) { leadPage = pages; return loadLeads(); }
  $("#lead-count").textContent = `${d.total} lead · halaman ${d.page} dari ${pages}`;
  $("#prev").disabled = leadPage <= 1;
  $("#next").disabled = leadPage >= pages;
  $("#lead-table").innerHTML =
    "<tr><th>Skor</th><th>Nama</th><th>Kontak</th><th>Program</th><th>Kanal</th><th>Masuk</th><th>Status</th><th></th></tr>" +
    (d.items.map((l) => `<tr class="click" data-id="${l.lead_id}">
      <td>${scoreCell(l)}</td><td>${esc(l.name || "-")}</td>
      <td>${esc(l.phone || "")}<br><span class="muted">${esc(l.email || "")}</span></td>
      <td>${esc(l.program_name || l.program_slug || "-")}</td><td>${esc(l.channel)}</td>
      <td>${fmtDate(l.created_at)}</td>
      <td><select data-status="${l.lead_id}" aria-label="Status">${STATUSES.map((s) => `<option ${s === l.status ? "selected" : ""}>${s}</option>`).join("")}</select></td>
      <td>${waLink(l.phone, l.name)}</td></tr>`).join("") || "<tr><td colspan=8 class='muted'>Belum ada lead</td></tr>");
}

$("#lead-table").addEventListener("change", async (e) => {
  const id = e.target.dataset.status;
  if (!id) return;
  try { await api(`/v1/admin/leads/${id}`, { method: "PATCH", body: JSON.stringify({ status: e.target.value }) }); }
  catch (err) { alert(err.message); }
});
$("#lead-table").addEventListener("click", (e) => {
  if (e.target.closest("select, a")) return;
  const tr = e.target.closest("tr[data-id]");
  if (tr) openLead(tr.dataset.id);
});

async function openLead(id) {
  const d = await api(`/v1/admin/leads/${id}`);
  const l = d.lead, v = d.visitor, s = d.score;
  const extra = l.extra ? Object.entries(l.extra).map(([k, val]) => `<dt>${esc(k)}</dt><dd>${esc(val)}</dd>`).join("") : "";
  $("#lead-detail").innerHTML = `
    <div class="row between"><h2>${esc(l.name || "Lead #" + l.lead_id)}</h2><button class="btn ghost" id="close-lead" type="button">Tutup</button></div>
    <div class="grid2">
      <div>
        <dl class="kv">
          <dt>Skor konversi</dt><dd>${scoreCell(l)}</dd>
          <dt>Kontak</dt><dd>${esc(l.phone || "-")} ${waLink(l.phone, l.name)}<br>${esc(l.email || "")}</dd>
          <dt>Program</dt><dd>${esc(l.program_name || l.program_slug || "-")}</dd>
          <dt>Kanal</dt><dd>${esc(l.channel)}</dd><dt>Masuk</dt><dd>${fmtDate(l.created_at)}</dd>
          <dt>Pesan</dt><dd>${esc(l.message || "-")}</dd>${extra}
          ${v ? `<dt>Sumber pertama</dt><dd>${esc(v.first_source)} / ${esc(v.first_medium)}</dd>
          <dt>Landing page</dt><dd>${esc(v.first_landing)}</dd><dt>Perangkat</dt><dd>${esc(v.device_type || "-")}</dd>
          <dt>Kode WA</dt><dd>${esc(v.ref_code)}</dd>` : "<dt>Riwayat</dt><dd class='muted'>Tidak terhubung dengan data kunjungan</dd>"}
        </dl>
        ${s ? `<h3 style="margin-top:12px">Faktor pendorong skor</h3><ul class="chips">${s.reasons.map((r) => `<li>${esc(r)}</li>`).join("") || "<li>-</li>"}</ul><p class="muted">Model: ${esc(s.model_version)}</p>` : ""}
        <form id="lead-edit" class="form-grid" style="margin-top:12px">
          <label>Status <select name="status">${STATUSES.map((x) => `<option ${x === l.status ? "selected" : ""}>${x}</option>`).join("")}</select></label>
          <label class="full">Catatan follow-up <textarea name="notes" rows="3">${esc(l.notes || "")}</textarea></label>
          <div class="row full end"><button class="btn ghost" type="button" id="rescore">Hitung ulang skor</button><button class="btn primary" type="submit">Simpan</button></div>
        </form>
      </div>
      <div>
        <h3>Riwayat kunjungan (${d.sessions.length} sesi)</h3>
        <table class="table"><tr><th>Waktu</th><th>Sumber</th><th class="num">Hal.</th><th class="num">Detik</th><th class="num">Scroll</th></tr>
          ${d.sessions.map((x) => `<tr><td>${fmtDate(x.started_at)}</td><td>${esc(x.source)}/${esc(x.medium)}${x.utm_term ? `<br><span class="muted">${esc(x.utm_term)}</span>` : ""}</td><td class="num">${x.page_count}</td><td class="num">${x.active_seconds}</td><td class="num">${x.max_scroll_pct}%</td></tr>`).join("")}
        </table>
        <h3>Aktivitas</h3>
        <ul class="timeline">${d.timeline.map((t) => `<li><span class="t">${fmtDate(t.ts)}</span>${esc(EVENT_TEXT[t.type] || t.type)} <span class="muted">${esc(t.label || t.page || "")}</span></li>`).join("") || "<li class='muted'>-</li>"}</ul>
      </div>
    </div>`;
  const dlg = $("#lead-dialog");
  $("#close-lead").onclick = () => dlg.close();
  $("#rescore").onclick = async () => { await api(`/v1/admin/leads/${id}/rescore`, { method: "POST" }); openLead(id); loadLeads(); };
  $("#lead-edit").onsubmit = async (e) => {
    e.preventDefault();
    await api(`/v1/admin/leads/${id}`, { method: "PATCH", body: JSON.stringify(Object.fromEntries(new FormData(e.target))) });
    dlg.close();
    loadLeads();
  };
  if (!dlg.open) dlg.showModal();
}

$("#export-csv").addEventListener("click", async (e) => {
  e.preventDefault();
  const res = await fetch("/v1/admin/export/leads.csv", { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return alert("Gagal mengunduh");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(await res.blob());
  a.download = `lead-ysii-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$("#btn-add-wa").addEventListener("click", () => { $("#wa-form").reset(); $("#wa-error").textContent = ""; $("#wa-dialog").showModal(); });
$("#wa-submit").addEventListener("click", async (e) => {
  e.preventDefault();
  const form = $("#wa-form");
  if (!form.reportValidity()) return;
  const body = Object.fromEntries(new FormData(form));
  Object.keys(body).forEach((k) => body[k] === "" && delete body[k]);
  try {
    await api("/v1/admin/leads", { method: "POST", body: JSON.stringify(body) });
    $("#wa-dialog").close();
    loadLeads();
  } catch (err) { $("#wa-error").textContent = err.message; }
});

// ---------------- program ----------------
async function loadPrograms() {
  await refreshPrograms();
  $("#program-table").innerHTML = "<tr><th>Slug</th><th>Nama</th><th>Kategori</th><th class='num'>Harga</th><th>Batch</th><th>Aktif</th><th></th></tr>" +
    (programs.map((p) => `<tr><td><code>${esc(p.slug)}</code></td><td>${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.name)}</a>` : esc(p.name)}</td>
      <td>${esc(p.category || "-")}</td><td class="num">${p.price != null ? Number(p.price).toLocaleString("id-ID") : "-"}</td>
      <td>${esc(p.next_batch || "-")}</td><td>${p.active ? "Ya" : "Tidak"}</td>
      <td class="row"><button class="btn small" data-edit="${esc(p.slug)}" type="button">Ubah</button><button class="btn small" data-del="${esc(p.slug)}" type="button">Hapus</button></td></tr>`).join("") ||
      "<tr><td colspan=7 class='muted'>Belum ada program. Tambahkan di bawah.</td></tr>");
}
$("#program-table").addEventListener("click", async (e) => {
  const edit = e.target.dataset.edit, del = e.target.dataset.del;
  if (edit) {
    const p = programs.find((x) => x.slug === edit);
    const f = $("#program-form");
    ["slug", "name", "category", "price", "url", "next_batch"].forEach((k) => (f.elements[k].value = p[k] ?? ""));
    f.elements.active.checked = p.active;
    f.scrollIntoView({ behavior: "smooth" });
  }
  if (del && confirm(`Hapus program ${del}?`)) { await api(`/v1/admin/programs/${del}`, { method: "DELETE" }); loadPrograms(); }
});
$("#program-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const body = {
    slug: f.elements.slug.value.trim(), name: f.elements.name.value.trim(), category: f.elements.category.value || null,
    price: f.elements.price.value ? Number(f.elements.price.value) : null, url: f.elements.url.value || null,
    next_batch: f.elements.next_batch.value || null, active: f.elements.active.checked,
  };
  try { await api(`/v1/admin/programs/${body.slug}`, { method: "PUT", body: JSON.stringify(body) }); f.reset(); loadPrograms(); }
  catch (err) { alert(err.message); }
});

// ---------------- SEO ----------------
async function loadSeo() {
  const d = await api("/v1/admin/seo?days=28");
  if (!d.available) {
    $("#seo-body").innerHTML = `<div class="card"><p>Belum ada data Google Search Console. Atur <code>GSC_CREDENTIALS_FILE</code> lalu jalankan
      <code>python -m jobs.gsc_etl --days 90</code> (lihat README).</p></div>`;
    return;
  }
  const rows = (list, key) => list.map((r) => `<tr><td>${esc(r[key])}</td><td class="num">${r.clicks}</td><td class="num">${r.impressions}</td><td class="num">${pct(r.ctr)}</td><td class="num">${r.position ?? "-"}</td></tr>`).join("");
  const head = (k) => `<tr><th>${k}</th><th class="num">Klik</th><th class="num">Impresi</th><th class="num">CTR</th><th class="num">Posisi</th></tr>`;
  $("#seo-body").innerHTML = `
    <div class="tiles">
      <div class="tile"><div class="v">${d.clicks.toLocaleString("id-ID")}</div><div class="l">Klik organik (28 hari)</div></div>
      <div class="tile"><div class="v">${d.impressions.toLocaleString("id-ID")}</div><div class="l">Impresi</div></div>
      <div class="tile"><div class="v">${pct(d.ctr)}</div><div class="l">CTR</div></div>
      <div class="tile"><div class="v">${d.avg_position ?? "-"}</div><div class="l">Rata-rata posisi</div></div>
    </div>
    <div class="card"><h3>Tren harian</h3><canvas id="chart-seo" height="90"></canvas></div>
    <div class="grid2">
      <div class="card"><h3>Kata kunci teratas</h3><table class="table">${head("Kata kunci")}${rows(d.top_queries, "query")}</table></div>
      <div class="card"><h3>Halaman teratas</h3><table class="table">${head("Halaman")}${rows(d.top_pages, "page")}</table></div>
    </div>
    ${d.low_ctr_pages.length ? `<div class="card"><h3>Perlu perbaikan judul/meta (impresi tinggi, CTR &lt; 2%)</h3><table class="table">${head("Halaman")}${rows(d.low_ctr_pages, "page")}</table></div>` : ""}`;
  chart("chart-seo", {
    type: "line",
    data: { labels: d.series.map((s) => s.date.slice(5)), datasets: [
      { label: "Klik", data: d.series.map((s) => s.clicks), borderColor: css("--primary"), yAxisID: "y", tension: 0.3 },
      { label: "Impresi", data: d.series.map((s) => s.impressions), borderColor: css("--cold"), yAxisID: "y1", tension: 0.3 },
    ] },
    options: { interaction: { mode: "index", intersect: false }, scales: { y: { beginAtZero: true }, y1: { beginAtZero: true, position: "right", grid: { drawOnChartArea: false } } } },
  });
}

// ---------------- model ----------------
let modelPoll;
const ALGO_NAME = { logistic_regression: "Logistic Regression (baseline)", random_forest: "Random Forest", gradient_boosting: "Gradient Boosting" };

function comparisonCard(m) {
  const r = m.report;
  const best = r.comparison[r.best_algorithm];
  return `<div class="card"><h3>${esc(r.task_label)} — model aktif <code>${esc(m.version)}</code></h3>
    <p class="muted">${r.n_samples} data (${r.n_positive} positif) · ${r.cv_folds}-fold stratified CV · data uji 20% · dilatih ${fmtDate(m.trained_at)}</p>
    <table class="table"><tr><th>Algoritma</th><th class="num">Akurasi</th><th class="num">Presisi</th><th class="num">Recall</th><th class="num">F1</th><th class="num">AUC</th><th class="num">F1 (uji)</th><th class="num">AUC (uji)</th></tr>
    ${Object.entries(r.comparison).map(([k, v]) => `<tr${k === r.best_algorithm ? ' style="font-weight:700"' : ""}><td>${esc(ALGO_NAME[k] || k)}${k === r.best_algorithm ? " ★" : ""}</td>
      <td class="num">${v.cv.accuracy}</td><td class="num">${v.cv.precision}</td><td class="num">${v.cv.recall}</td><td class="num">${v.cv.f1} ± ${v.cv.f1_std}</td><td class="num">${v.cv.roc_auc ?? "-"}</td>
      <td class="num">${v.holdout.f1}</td><td class="num">${v.holdout.roc_auc ?? "-"}</td></tr>`).join("")}</table>
    <p class="muted">Confusion matrix model terbaik pada data uji [[TN, FP], [FN, TP]]: ${esc(JSON.stringify(best.holdout.confusion_matrix))}</p>
    <h3>Kepentingan fitur (permutation importance)</h3>
    <table class="table"><tr><th>Fitur</th><th class="num">Penurunan AUC</th></tr>${r.feature_importance.slice(0, 10).map((f) => `<tr><td>${esc(f.feature)}</td><td class="num">${f.importance}</td></tr>`).join("")}</table>
    <button class="btn small" data-rules="${esc(m.task)}" type="button">Kembali ke skor aturan untuk tugas ini</button></div>`;
}

async function loadModel() {
  const d = await api("/v1/admin/model");
  const t = d.training;
  let status = "";
  if (t.running) status = "<p><b>Pelatihan sedang berjalan…</b></p>";
  else if (t.last_error) status = `<p class="error">${esc(t.last_error)}</p>`;
  else if (t.last_result) status = `<p>Hasil pelatihan terakhir:</p><ul>${Object.entries(t.last_result).map(([k, v]) => `<li><b>${esc(d.tasks[k])}</b>: ${esc(v)}</li>`).join("")}</ul>`;

  const activeCards = Object.keys(d.tasks).map((task) => {
    const m = d.models.find((x) => x.task === task && x.is_active);
    return m ? comparisonCard(m)
      : `<div class="card"><h3>${esc(d.tasks[task])}</h3><p>Memakai <b>skor berbasis aturan</b> (${esc(d.rule_version)}). Model ML aktif setelah ada minimal ${d.min_samples} contoh positif dan ${d.min_samples} negatif.</p></div>`;
  }).join("");

  $("#model-body").innerHTML = `
    <div class="card">${status}
      <p>Data berlabel: <b>${d.labeled.leads}</b> lead (${d.labeled.linked} terhubung dengan data kunjungan), <b>${d.labeled.converted}</b> menjadi peserta, <b>${d.labeled.batal}</b> batal.
      Status lead yang diisi tim di tab Lead menjadi data latih baru setiap kali model dilatih ulang (otomatis setiap Senin 02.00 WIB).</p>
    </div>
    ${activeCards}
    <div class="card"><h3>Riwayat model</h3><table class="table"><tr><th>Versi</th><th>Tugas</th><th>Dilatih</th><th class="num">Data</th><th class="num">Positif</th><th class="num">F1 CV</th><th class="num">AUC CV</th><th></th></tr>
      ${d.models.map((m) => { const cv = m.report.comparison[m.algorithm].cv; return `<tr><td><code>${esc(m.version)}</code></td><td>${esc(m.task)}</td><td>${fmtDate(m.trained_at)}</td><td class="num">${m.n_samples}</td><td class="num">${m.n_positive}</td>
        <td class="num">${cv.f1}</td><td class="num">${cv.roc_auc ?? "-"}</td><td>${m.is_active ? "<b>aktif</b>" : `<button class="btn small" data-activate="${esc(m.version)}" type="button">Aktifkan</button>`}</td></tr>`; }).join("") || "<tr><td colspan=8 class='muted'>Belum ada model</td></tr>"}
    </table></div>`;
  clearTimeout(modelPoll);
  if (t.running) modelPoll = setTimeout(loadModel, 3000);
}
$("#model-body").addEventListener("click", async (e) => {
  const v = e.target.dataset.activate, rules = e.target.dataset.rules;
  if (v) { await api(`/v1/admin/model/${encodeURIComponent(v)}/activate`, { method: "POST" }); loadModel(); }
  if (rules) { await api(`/v1/admin/model/deactivate?task=${encodeURIComponent(rules)}`, { method: "POST" }); loadModel(); }
});
$("#btn-retrain").addEventListener("click", async () => {
  try {
    await api("/v1/admin/model/retrain", { method: "POST", body: JSON.stringify({ task: $("#retrain-task").value, force: $("#retrain-force").checked }) });
    setTimeout(loadModel, 500);
  } catch (err) { alert(err.message); }
});

// ---------------- start ----------------
if (token) boot(); else logout();
