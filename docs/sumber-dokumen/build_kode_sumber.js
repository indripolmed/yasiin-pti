// Membuat PDF kode sumber untuk HKI:
//   1) listing lengkap bernomor baris
//   2) potongan halaman awal & akhir (default 10 + 10 halaman) dengan halaman sampul
// node build_kode_sumber.js <root-repo> <folder-output> [jumlah-halaman-awal-akhir]
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { chromium } = require(execSync('npm root -g').toString().trim() + '/playwright');
const { SOURCE_FILES } = require('./daftar_kode');

const [ROOT, OUT, N_ARG] = process.argv.slice(2);
const N = Number(N_ARG || 10);
const TITLE = 'Sistem Promosi Digital Terintegrasi Berbasis SEO dan Machine Learning untuk Prediksi Perilaku Calon Peserta Pelatihan';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const CSS = `
@page { size: A4; margin: 18mm 14mm 16mm 18mm; }
body { font-family: 'DejaVu Sans Mono', 'Courier New', monospace; font-size: 8.3pt; color: #111; margin: 0; }
.file { margin-bottom: 14px; }
.fh { break-after: avoid; font-family: Arial, sans-serif; font-size: 9.5pt; font-weight: bold; background: #e6f2eb; border-left: 4px solid #0b5c39;
      padding: 5px 8px; margin: 0 0 6px; }
.fh span { font-weight: normal; color: #444; }
table { border-collapse: collapse; width: 100%; }
td { vertical-align: top; padding: 0; line-height: 1.32; }
td.n { width: 3.2em; text-align: right; padding-right: .8em; color: #888; user-select: none; }
td.c { white-space: pre-wrap; word-break: break-all; }
tr { break-inside: avoid; }`;

function listingHtml() {
  let total = 0;
  const parts = SOURCE_FILES.map(([rel, desc]) => {
    const lines = fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\n$/, '').split('\n');
    total += lines.length;
    const rows = lines.map((l, i) => `<tr><td class="n">${i + 1}</td><td class="c">${esc(l) || ' '}</td></tr>`).join('');
    return `<section class="file"><div class="fh">${esc(rel)} <span>— ${esc(desc)} (${lines.length} baris)</span></div><table>${rows}</table></section>`;
  });
  return { html: `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${parts.join('')}</body></html>`, total };
}

const headerTpl = `<div style="font-family:Arial;font-size:7.5pt;color:#555;width:100%;padding:0 14mm 0 18mm;display:flex;justify-content:space-between">
  <span>Kode Sumber Program Komputer — Sistem Promosi Digital Terintegrasi SEO &amp; Machine Learning v1.0</span></div>`;
const footerTpl = (label) => `<div style="font-family:Arial;font-size:7.5pt;color:#555;width:100%;text-align:center">${label}</div>`;

function coverHtml(totalPages, totalLines, n) {
  const rows = SOURCE_FILES.map(([rel, desc], i) => `<tr><td>${i + 1}</td><td><code>${esc(rel)}</code></td><td>${esc(desc)}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 22mm 20mm; } body { font-family: 'Times New Roman', serif; font-size: 11.5pt; color:#111 }
  h1 { text-align:center; font-size:17pt; margin:0 0 4px } h2 { text-align:center; font-size:13pt; margin:0 0 18px; font-weight:normal }
  .t { text-align:center; font-weight:bold; font-size:12.5pt; margin: 0 30px 18px }
  table { border-collapse: collapse; width:100%; font-size:9.5pt } td,th { border:1px solid #8a949e; padding:3px 6px; text-align:left }
  th { background:#dcefe4 } code { font-size:8.8pt } .box { border:1px solid #b7791f; background:#fff7e6; padding:8px 10px; margin:12px 0; font-size:10.5pt }
  </style></head><body>
  <h1>KODE SUMBER PROGRAM KOMPUTER</h1><h2>Halaman awal dan halaman akhir</h2>
  <div class="t">${esc(TITLE)}<br><span style="font-weight:normal">Versi 1.0 — Pemegang Hak Cipta: Politeknik Negeri Medan</span></div>
  <div class="box">Dokumen ini memuat <b>${n} halaman pertama</b> dan <b>${n} halaman terakhir</b> dari listing kode sumber lengkap
  sebanyak <b>${totalPages} halaman</b> (${SOURCE_FILES.length} berkas, ${totalLines.toLocaleString('id-ID')} baris). Nomor halaman pada bagian bawah
  setiap halaman merujuk pada nomor halaman listing lengkap. Urutan berkas sesuai tabel berikut.</div>
  <table><tr><th>No</th><th>Berkas</th><th>Fungsi</th></tr>${rows}</table></body></html>`;
}

function gapHtml(from, to) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:0}
  body{margin:0;height:297mm;display:flex;align-items:center;justify-content:center;font-family:'Times New Roman',serif}
  div{border:1.5px dashed #8a949e;padding:28px 40px;text-align:center;font-size:14pt}</style></head><body>
  <div><b>Halaman ${from} – ${to} tidak ditampilkan</b><br><span style="font-size:11.5pt">Bagian berikutnya adalah halaman terakhir listing kode sumber.</span></div></body></html>`;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const { html, total } = listingHtml();
  await page.setContent(html, { waitUntil: 'load' });
  const full = path.join(OUT, 'Kode-Sumber-Lengkap.pdf');
  await page.pdf({ path: full, format: 'A4', displayHeaderFooter: true, headerTemplate: headerTpl,
    footerTemplate: footerTpl('Halaman <span class="pageNumber"></span> dari <span class="totalPages"></span>'),
    margin: { top: '18mm', bottom: '16mm', left: '18mm', right: '14mm' } });
  const pages = Number(execSync(`pdfinfo "${full}"`).toString().match(/Pages:\s+(\d+)/)[1]);

  const tmp = path.join(OUT, '.tmp'); fs.mkdirSync(tmp, { recursive: true });
  await page.setContent(coverHtml(pages, total, N)); await page.pdf({ path: path.join(tmp, 'cover.pdf'), format: 'A4' });
  await page.setContent(gapHtml(N + 1, pages - N)); await page.pdf({ path: path.join(tmp, 'gap.pdf'), format: 'A4' });
  await browser.close();

  execSync(`pdfseparate -f 1 -l ${N} "${full}" "${tmp}/a-%03d.pdf"`);
  execSync(`pdfseparate -f ${pages - N + 1} -l ${pages} "${full}" "${tmp}/z-%03d.pdf"`);
  const a = fs.readdirSync(tmp).filter((f) => f.startsWith('a-')).sort().map((f) => `"${tmp}/${f}"`);
  const z = fs.readdirSync(tmp).filter((f) => f.startsWith('z-')).sort().map((f) => `"${tmp}/${f}"`);
  const excerpt = path.join(OUT, 'Kode-Sumber-Halaman-Awal-dan-Akhir.pdf');
  execSync(`pdfunite "${tmp}/cover.pdf" ${a.join(' ')} "${tmp}/gap.pdf" ${z.join(' ')} "${excerpt}"`);
  fs.rmSync(tmp, { recursive: true });
  console.log(`listing lengkap: ${pages} halaman, ${total} baris; potongan: ${N} awal + ${N} akhir -> ${excerpt}`);
})();
