// Membuat dokumen "Deskripsi Program Komputer" untuk pendaftaran HKI.
// node build_deskripsi_hki.js <root-repo> arsitektur.png <output.docx>
const fs = require('fs');
const path = require('path');
const { Packer, Paragraph, TextRun, AlignmentType } = require('docx');
const { create, documentOf, TITLE, TEAM, GREEN } = require('./lib');
const { SOURCE_FILES } = require('./daftar_kode');

const [ROOT, DIAGRAM, OUT] = process.argv.slice(2);
const h = create();

const stats = SOURCE_FILES.map(([rel, desc]) => {
  const n = fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\n$/, '').split('\n').length;
  return { rel, desc, n };
});
const totalLines = stats.reduce((a, s) => a + s.n, 0);
const byLang = {};
for (const s of stats) {
  const ext = path.extname(s.rel) || path.basename(s.rel);
  const lang = { '.py': 'Python', '.js': 'JavaScript', '.html': 'HTML', '.css': 'CSS', '.php': 'PHP',
    '.yml': 'YAML (Docker Compose)', '.template': 'Konfigurasi Nginx', Dockerfile: 'Dockerfile' }[ext] || ext;
  byLang[lang] = (byLang[lang] || 0) + s.n;
}

const URAIAN = 'Program komputer berbasis web yang dipasang berdampingan dengan website lembaga pelatihan vokasi untuk memadukan Search Engine Optimization (SEO) dan machine learning. Program merekam perilaku pengunjung secara anonim dengan persetujuan, menghubungkan pengunjung dengan pendaftar dari form website dan WhatsApp melalui kode referensi, memprediksi peluang calon peserta mendaftar dengan membandingkan Logistic Regression, Random Forest, dan Gradient Boosting, menampilkan prioritas tindak lanjut (Hot/Warm/Cold) pada dashboard admin, memantau kinerja SEO dari Google Search Console, serta menampilkan rekomendasi program yang dipersonalisasi.';

const children = [
  h.title('DESKRIPSI PROGRAM KOMPUTER', 30, 80),
  h.center('Lampiran Permohonan Pencatatan Ciptaan', { after: 360 }),
  h.H2('1. Data Ciptaan'),
  ...h.table(null, [
    [{ text: 'Judul ciptaan', bold: true }, TITLE],
    [{ text: 'Jenis ciptaan', bold: true }, 'Program Komputer'],
    [{ text: 'Versi', bold: true }, '1.0'],
    [{ text: 'Pemegang hak cipta', bold: true }, 'Politeknik Negeri Medan'],
    [{ text: 'Mitra pengguna', bold: true }, 'Yayasan Sinergi Inspirasi Indonesia, Jl. Darussalam No. 16/22, Medan'],
    [{ text: 'Tanggal pertama kali diumumkan', bold: true }, '…………………………… 2026'],
    [{ text: 'Tempat pertama kali diumumkan', bold: true }, 'Medan'],
  ], [32, 68]),
  h.H2('2. Uraian Singkat Ciptaan'),
  h.note('Teks berikut dapat disalin ke kolom **Uraian Singkat Ciptaan** pada formulir e-hakcipta (±' + URAIAN.split(/\s+/).length + ' kata).'),
  h.P(URAIAN),
  h.H2('3. Latar Belakang dan Permasalahan'),
  h.P('Lembaga pelatihan vokasi mengandalkan mesin pencari sebagai pintu masuk utama calon peserta. Optimasi SEO dapat meningkatkan jumlah pengunjung, namun lembaga belum dapat mengetahui pengunjung mana yang berpotensi tinggi menjadi peserta, sehingga tim pemasaran memperlakukan semua calon peserta secara sama dan biaya akuisisi per peserta menjadi tidak efisien. Selain itu, pendaftaran yang masuk melalui WhatsApp umumnya tidak dapat dihubungkan dengan data kunjungan website.'),
  h.P('Program komputer ini menyatukan perolehan pengunjung melalui SEO dengan analitik prediktif berbasis _machine learning_ dalam satu sistem operasional, sehingga data perilaku langsung diolah menjadi skor prioritas tindak lanjut.'),
  h.H2('4. Fungsi dan Fitur Utama'),
  ...h.table(['No', 'Modul', 'Fungsi'], [
    ['1', 'SEO Engine', 'Mengambil data klik, impresi, CTR, dan posisi kata kunci dari Google Search Console setiap hari; menampilkan kata kunci, halaman teratas, dan halaman dengan CTR rendah.'],
    ['2', 'User Behavior Tracking', 'Script JavaScript ringan (±6 KB) merekam halaman, waktu aktif, kedalaman scroll, klik WhatsApp/ajakan, melihat biaya, unduh brosur, dan pengisian form setelah pengunjung menyetujui cookie.'],
    ['3', 'ML Predictive Engine', 'Membangun fitur perilaku, melatih dan membandingkan tiga algoritma dengan validasi silang, memilih model terbaik, serta menghitung skor peluang konversi.'],
    ['4', 'Dashboard Manajemen Lead', 'Menampilkan KPI, lead terurut skor, perjalanan pengunjung, alasan skor, status tindak lanjut, dan ekspor data.'],
    ['5', 'Pendaftaran Terintegrasi', 'Menyalin isi form website yang sudah ada ke sistem dan menghubungkan chat WhatsApp dengan riwayat kunjungan melalui kode referensi.'],
    ['6', 'Rekomendasi Konten Dinamis', 'Menampilkan program relevan dan ajakan yang disesuaikan dengan segmen pengunjung.'],
  ], [7, 27, 66], 4, 'Modul program komputer'),
  h.H2('5. Keunggulan dan Kebaruan'),
  ...h.bullets([
    '**Integrasi SEO dan machine learning dalam satu sistem operasional** untuk sektor pelatihan vokasi, yang selama ini umumnya dikaji terpisah atau pada sektor e-commerce.',
    '**Dipasang tanpa membangun ulang website**: cukup satu baris script atau plugin WordPress; form dan tombol WhatsApp yang sudah ada tetap dipakai.',
    '**Penghubung WhatsApp–website** melalui kode referensi otomatis pada pesan, sehingga pendaftar lewat chat tetap memiliki riwayat perilaku.',
    '**Dua model prediksi terpisah**: lead → peserta untuk prioritas tindak lanjut, dan pengunjung → lead untuk personalisasi konten.',
    '**Pencegahan kebocoran label**: fitur dihitung hanya dari perilaku sebelum mendaftar, dan aksi yang merupakan hasil itu sendiri dikeluarkan dari fitur.',
    '**Pembelajaran berkelanjutan (closed-loop)**: status tindak lanjut admin menjadi label data latih dan model dilatih ulang setiap minggu; skor berbasis aturan dipakai selama data belum cukup.',
    '**Mematuhi pelindungan data pribadi**: perekaman hanya setelah persetujuan, pengenal acak, dan alamat IP tidak disimpan.',
  ]),
  h.H2('6. Cara Kerja Singkat'),
  ...h.figure(DIAGRAM, 'Arsitektur program komputer', 6),
  ...h.steps([
    'Script pada website mengirim data perilaku pengunjung yang telah memberi persetujuan ke server.',
    'Isi form pendaftaran disalin ke server; chat WhatsApp dicatat admin beserta kode referensinya.',
    'Server menghitung fitur perilaku sebelum mendaftar dan memberi skor peluang konversi beserta segmennya.',
    'Admin menindaklanjuti lead sesuai prioritas dan mencatat hasil akhirnya, yang kemudian dipakai untuk melatih ulang model.',
  ]),
  h.H2('7. Spesifikasi Teknis'),
  ...h.table(null, [
    [{ text: 'Bahasa pemrograman', bold: true }, 'Python 3.13, JavaScript, HTML5, CSS3, SQL, PHP'],
    [{ text: 'Kerangka kerja & pustaka', bold: true }, 'FastAPI, SQLAlchemy, scikit-learn, pandas, NumPy, APScheduler, Chart.js'],
    [{ text: 'Basis data', bold: true }, 'PostgreSQL 16 (produksi), SQLite (pengembangan)'],
    [{ text: 'Algoritma', bold: true }, 'Logistic Regression, Random Forest, Histogram-based Gradient Boosting; stratified k-fold cross-validation; permutation importance'],
    [{ text: 'Antarmuka', bold: true }, 'Aplikasi web responsif (desktop dan ponsel); REST API terdokumentasi (OpenAPI)'],
    [{ text: 'Lingkungan operasi', bold: true }, 'Server Linux dengan Docker (2 vCPU, 4 GB RAM disarankan); peramban modern di sisi klien'],
    [{ text: 'Ukuran kode sumber', bold: true }, `${stats.length} berkas, ${totalLines.toLocaleString('id-ID')} baris (di luar pustaka pihak ketiga dan kode pengujian)`],
  ], [32, 68]),
  ...h.table(['Bahasa / jenis berkas', 'Jumlah baris'], Object.entries(byLang).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => [k, { text: v.toLocaleString('id-ID'), align: 'center' }]), [70, 30], 7, 'Komposisi kode sumber'),
  h.H2('8. Daftar Berkas Kode Sumber'),
  ...h.table(['No', 'Berkas', 'Fungsi', 'Baris'], stats.map((s, i) => [String(i + 1), `\`${s.rel}\``, s.desc, { text: String(s.n), align: 'center' }]),
    [6, 40, 42, 12], 8, 'Berkas kode sumber yang dicatatkan', { size: 19 }),
  h.H2('9. Pencipta'),
  ...h.table(['No', 'Nama', 'Peran', 'Institusi'], TEAM, [7, 41, 20, 32]),
  new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { before: 240, after: 0 }, keepNext: true,
    children: [new TextRun('Medan, ……………………… 2026')] }),
  ...[1, 2, 3, 4].map(() => new Paragraph({ keepNext: true, children: [] })),
  new Paragraph({ alignment: AlignmentType.RIGHT, keepNext: true, children: [new TextRun({ text: 'Indri Sulistianingsih, S.Kom., M.Kom.', bold: true, underline: {} })] }),
  new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun('Ketua Tim Pencipta')] }),
];

const doc = documentOf({ title: 'Deskripsi Program Komputer — ' + TITLE,
  headerText: 'Deskripsi Program Komputer — Sistem Promosi Digital Terintegrasi SEO & Machine Learning',
  sections: [{ pageStart: 1, children }] });
Packer.toBuffer(doc).then((b) => { fs.writeFileSync(OUT, b); console.log('OK', OUT, stats.length, 'berkas', totalLines, 'baris'); });
