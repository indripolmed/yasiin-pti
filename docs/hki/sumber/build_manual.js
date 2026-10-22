const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, AlignmentType,
  HeadingLevel, PageBreak, Header, Footer, PageNumber, WidthType, ShadingType, BorderStyle,
  LevelFormat, TableOfContents, NumberFormat, TabStopType, VerticalAlign,
} = require('docx');

const DIR = process.argv[2];
const OUT = process.argv[3];
const SHOT = (f) => path.join(DIR, 'shots', f);
const DIAG = (f) => path.join(DIR, 'diag', f);

const FONT = 'Times New Roman';
const MONO = 'Courier New';
const GREEN = '0B5C39';
const CONTENT_W = 9071; // A4 (11906) - kiri 4 cm (2268) - kanan 3 cm (1701) = 7937 ... dipakai untuk tabel
const TABLE_W = 7937;
const IMG_MAX_W = 528; // px pada 96 dpi ≈ 14 cm

// ---------------- helper teks ----------------
function runs(text, base = {}) {
  // **tebal**, `kode`, _miring_
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|(?<![A-Za-z0-9])_[^_]+_(?![A-Za-z0-9]))/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), ...base }));
    const t = m[0];
    if (t.startsWith('**')) out.push(new TextRun({ text: t.slice(2, -2), bold: true, ...base }));
    else if (t.startsWith('`')) out.push(new TextRun({ text: t.slice(1, -1), font: MONO, size: 21, ...base }));
    else out.push(new TextRun({ text: t.slice(1, -1), italics: true, ...base }));
    last = m.index + t.length;
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), ...base }));
  return out;
}
const P = (text, opts = {}) => new Paragraph({
  children: runs(text), alignment: AlignmentType.JUSTIFIED,
  spacing: { after: 120, line: 360 }, indent: opts.noIndent ? undefined : { firstLine: 567 }, ...opts.p,
});
const PN = (text, opts = {}) => P(text, { noIndent: true, ...opts });
const H1 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new TextRun(text)] });
const H2 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(text)] });
const H3 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(text)] });

let listInstance = 0;
const bullets = (items) => items.map((t) => new Paragraph({
  children: runs(t), numbering: { reference: 'bullet', level: 0 }, alignment: AlignmentType.JUSTIFIED,
  spacing: { after: 60, line: 320 },
}));
const steps = (items, cont = false) => {
  const inst = cont ? listInstance : ++listInstance;
  return items.map((t) => new Paragraph({
    children: runs(t), numbering: { reference: 'steps', level: 0, instance: inst }, alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 80, line: 320 },
  }));
};
const code = (lines) => lines.map((l, i) => new Paragraph({
  children: [new TextRun({ text: l === '' ? ' ' : l, font: MONO, size: 18 })],
  shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F1F3F5' },
  spacing: { before: i === 0 ? 80 : 0, after: i === lines.length - 1 ? 160 : 0, line: 260 },
  indent: { left: 170, right: 170 },
  keepNext: i < lines.length - 1,
}));
const note = (text) => new Paragraph({
  children: runs(text, { size: 22 }),
  shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'FFF7E6' },
  border: { left: { style: BorderStyle.SINGLE, size: 18, color: 'B7791F', space: 8 } },
  spacing: { before: 80, after: 160, line: 300 }, indent: { left: 200, right: 100 },
});

// ---------------- gambar ----------------
let figNo = {};
function figure(file, caption, chapter, maxW = IMG_MAX_W, maxH = 640) {
  const buf = fs.readFileSync(file);
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  let tw = maxW, th = Math.round(h * maxW / w);
  if (th > maxH) { th = maxH; tw = Math.round(w * maxH / h); }
  figNo[chapter] = (figNo[chapter] || 0) + 1;
  const label = `Gambar ${chapter}.${figNo[chapter]}`;
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 120, after: 60 },
      children: [new ImageRun({ type: 'png', data: buf, transformation: { width: tw, height: th },
        altText: { title: caption, description: caption, name: label } })],
    }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 },
      children: [new TextRun({ text: `${label} `, bold: true, size: 22 }), new TextRun({ text: caption, size: 22 })] }),
  ];
}

// ---------------- tabel ----------------
let tblNo = {};
const border = { style: BorderStyle.SINGLE, size: 4, color: '8A949E' };
const borders = { top: border, bottom: border, left: border, right: border };
function table(headers, rows, widthsPct, chapter, caption) {
  const widths = widthsPct.map((p) => Math.round(TABLE_W * p / 100));
  widths[widths.length - 1] = TABLE_W - widths.slice(0, -1).reduce((a, b) => a + b, 0);
  const cell = (text, i, head) => new TableCell({
    borders, width: { size: widths[i], type: WidthType.DXA }, verticalAlign: VerticalAlign.TOP,
    shading: head ? { type: ShadingType.CLEAR, color: 'auto', fill: 'DCEFE4' } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: String(text).split('\n').map((line) => new Paragraph({ spacing: { after: 0, line: 260 },
      children: runs(line, { size: 21, bold: head || undefined }) })),
  });
  const out = [];
  if (caption) {
    tblNo[chapter] = (tblNo[chapter] || 0) + 1;
    out.push(new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 160, after: 80 },
      children: [new TextRun({ text: `Tabel ${chapter}.${tblNo[chapter]} `, bold: true, size: 22 }), new TextRun({ text: caption, size: 22 })] }));
  }
  out.push(new Table({
    width: { size: TABLE_W, type: WidthType.DXA }, columnWidths: widths,
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((h, i) => cell(h, i, true)) }),
      ...rows.map((r) => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, i, false)) })),
    ],
  }));
  out.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
  return out;
}

// ================= ISI =================
const TITLE = 'Sistem Promosi Digital Terintegrasi Berbasis SEO dan Machine Learning untuk Prediksi Perilaku Calon Peserta Pelatihan';
const TEAM = [
  ['1', 'Indri Sulistianingsih, S.Kom., M.Kom.', 'Ketua Peneliti', 'Politeknik Negeri Medan'],
  ['2', 'Fristi Riandari, M.Kom.', 'Anggota Peneliti', 'Politeknik Negeri Medan'],
  ['3', "Efori Bu'ulolo, S.Kom., M.Kom.", 'Anggota Peneliti', 'Politeknik Negeri Medan'],
  ['4', 'Dr. Sri Wahyuni, S.Kom., M.Kom.', 'Anggota Mitra', 'Yayasan Sinergi Inspirasi Indonesia'],
  ['5', 'Amelia Cahya Nabila', 'Mahasiswa', 'Politeknik Negeri Medan'],
  ['6', 'Calysta Adelia Putri Zulfa', 'Mahasiswa', 'Politeknik Negeri Medan'],
  ['7', 'Diwa Dinata Simarmata', 'Mahasiswa', 'Politeknik Negeri Medan'],
  ['8', 'Imanuel Reformata Hulu', 'Mahasiswa', 'Politeknik Negeri Medan'],
  ['9', 'Refandy Dawson Sinarta Sinaga', 'Mahasiswa', 'Politeknik Negeri Medan'],
];

const cover = [
  new Paragraph({ spacing: { before: 600, after: 120 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'MANUAL BOOK', bold: true, size: 40, color: GREEN })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 480 },
    children: [new TextRun({ text: 'PANDUAN INSTALASI DAN PENGGUNAAN PROGRAM KOMPUTER', bold: true, size: 26 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200, line: 360 },
    children: [new TextRun({ text: TITLE.toUpperCase(), bold: true, size: 30 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 600 },
    children: [new TextRun({ text: 'Versi 1.0', size: 24 })] }),
  ...figure(DIAG('arsitektur.png'), '', 'S', 420, 220).slice(0, 1),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 500, after: 60 },
    children: [new TextRun({ text: 'Disusun oleh:', size: 24 })] }),
  ...TEAM.slice(0, 4).map(([, n]) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 20 },
    children: [new TextRun({ text: n, size: 24 })] })),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 500, after: 40 },
    children: [new TextRun({ text: 'JURUSAN TEKNIK KOMPUTER DAN INFORMATIKA', bold: true, size: 24 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 },
    children: [new TextRun({ text: 'POLITEKNIK NEGERI MEDAN', bold: true, size: 28 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 },
    children: [new TextRun({ text: 'bekerja sama dengan Yayasan Sinergi Inspirasi Indonesia', size: 24 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: '2026', bold: true, size: 26 })] }),
];

const identitas = [
  new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new TextRun('IDENTITAS PROGRAM KOMPUTER')] }),
  ...table(['Keterangan', 'Isi'], [
    ['Judul ciptaan', TITLE],
    ['Jenis ciptaan', 'Program Komputer'],
    ['Versi', '1.0'],
    ['Uraian singkat', 'Program komputer berbasis web yang dipasang berdampingan dengan website lembaga pelatihan vokasi untuk (1) merekam perilaku pengunjung secara anonim dengan persetujuan, (2) menghubungkan pengunjung dengan pendaftar dari form website dan WhatsApp, (3) memprediksi peluang calon peserta mendaftar menggunakan machine learning, (4) menampilkan prioritas tindak lanjut dalam dashboard, (5) memantau kinerja SEO dari Google Search Console, dan (6) menampilkan rekomendasi program yang dipersonalisasi.'],
    ['Bahasa pemrograman', 'Python 3.13, JavaScript (ES2017), HTML5, CSS3, SQL, PHP (plugin WordPress)'],
    ['Kerangka kerja & pustaka utama', 'FastAPI, SQLAlchemy, scikit-learn, pandas, APScheduler, Chart.js'],
    ['Basis data', 'PostgreSQL 16 (produksi), SQLite (pengembangan)'],
    ['Platform', 'Aplikasi web; server Linux dengan Docker; klien peramban modern (desktop & ponsel)'],
    ['Pemegang hak cipta', 'Politeknik Negeri Medan'],
    ['Mitra pengguna', 'Yayasan Sinergi Inspirasi Indonesia, Jl. Darussalam No. 16/22, Medan'],
    ['Skema penelitian', 'Penelitian Terapan Inovasi (PTI) Tahun 2026'],
  ], [30, 70]),
  new Paragraph({ spacing: { before: 120, after: 80 }, children: [new TextRun({ text: 'Tim pencipta', bold: true })] }),
  ...table(['No', 'Nama', 'Peran', 'Institusi'], TEAM, [7, 41, 20, 32]),
];

const toc = [
  new Paragraph({ pageBreakBefore: true, alignment: AlignmentType.CENTER, spacing: { after: 360 }, children: [new TextRun({ text: 'DAFTAR ISI', bold: true, size: 28 })] }),
  new TableOfContents('Daftar Isi', { hyperlink: true, headingStyleRange: '1-2' }),
];

// ---------- BAB 1 ----------
const bab1 = [
  H1('BAB 1 PENDAHULUAN'),
  H2('1.1 Latar Belakang'),
  P('Mesin pencari menjadi titik sentuh pertama bagi sebagian besar calon peserta pelatihan vokasi. Optimasi mesin pencari (SEO) mampu meningkatkan jumlah pengunjung website, tetapi peningkatan pengunjung tidak otomatis meningkatkan jumlah peserta. Tim pemasaran lembaga pelatihan umumnya memperlakukan semua calon peserta secara sama karena tidak memiliki informasi tentang siapa yang paling berpotensi mendaftar.'),
  P('Program komputer ini dikembangkan untuk menjawab masalah tersebut. Data perilaku pengunjung yang datang melalui SEO diolah oleh model _machine learning_ untuk menghasilkan skor peluang konversi, sehingga tim mitra dapat memprioritaskan calon peserta yang paling serius dan menampilkan konten yang relevan bagi setiap pengunjung.'),
  H2('1.2 Tujuan Program'),
  ...bullets([
    'Menyediakan satu platform yang memadukan modul SEO dan modul _machine learning_ untuk lembaga pelatihan vokasi.',
    'Memprediksi peluang calon peserta menjadi peserta berdasarkan perilaku digitalnya (durasi baca, kedalaman scroll, halaman yang dibuka, sumber traffic, dan interaksi).',
    'Membantu admin mitra memprioritaskan tindak lanjut melalui segmentasi lead **Hot**, **Warm**, dan **Cold**.',
    'Mengintegrasikan pendaftaran dari form website dan WhatsApp tanpa membangun ulang website yang sudah ada.',
    'Menyediakan data terukur untuk evaluasi kinerja SEO dan akurasi prediksi.',
  ]),
  H2('1.3 Fitur Utama'),
  ...table(['No', 'Modul', 'Fungsi'], [
    ['1', 'SEO Engine', 'Menarik data klik, impresi, CTR, dan posisi kata kunci dari Google Search Console setiap hari; menampilkan kata kunci dan halaman teratas serta halaman dengan CTR rendah.'],
    ['2', 'User Behavior Tracking', 'Script `tracker.js` merekam kunjungan halaman, waktu aktif, kedalaman scroll, klik WhatsApp/tombol ajakan, melihat biaya, unduh brosur, dan pengisian form, setelah pengunjung menyetujui cookie.'],
    ['3', 'ML Predictive Engine', 'Membandingkan Logistic Regression, Random Forest, dan Gradient Boosting; memilih model terbaik; menghitung skor peluang konversi.'],
    ['4', 'Dashboard Manajemen Lead', 'Menampilkan KPI, daftar lead terurut skor, perjalanan pengunjung, alasan skor, status tindak lanjut, dan ekspor CSV.'],
    ['5', 'Pendaftaran Terintegrasi', 'Menyalin isi form website ke sistem dan menghubungkan chat WhatsApp ke riwayat kunjungan melalui kode referensi.'],
    ['6', 'Rekomendasi Konten Dinamis', 'Menampilkan program yang relevan dan ajakan (CTA) yang disesuaikan dengan segmen pengunjung.'],
  ], [7, 28, 65], 1, 'Modul program komputer'),
  H2('1.4 Pengguna Sistem'),
  ...table(['Pengguna', 'Akses', 'Kegiatan utama'], [
    ['Pengunjung / calon peserta', 'Website mitra', 'Membaca informasi program, menyetujui atau menolak cookie, mengisi form, menghubungi via WhatsApp.'],
    ['Admin mitra', 'Dashboard (login)', 'Memantau KPI, menghubungi lead, memperbarui status, mencatat lead WhatsApp, mengelola program.'],
    ['Administrator teknis', 'Server & dashboard', 'Instalasi, konfigurasi, integrasi website, pelatihan ulang model, pencadangan data.'],
  ], [26, 22, 52], 1, 'Jenis pengguna sistem'),
  H2('1.5 Sistematika Manual'),
  P('Bab 2 menjelaskan kebutuhan perangkat. Bab 3 menjelaskan arsitektur dan cara kerja. Bab 4 berisi langkah instalasi dan integrasi. Bab 5 berisi panduan penggunaan dashboard bagi admin. Bab 6 menunjukkan tampilan di sisi pengunjung website. Bab 7 membahas pemeliharaan dan pemecahan masalah. Lampiran memuat daftar endpoint API, event, fitur model, dan glosarium.'),
];

// ---------- BAB 2 ----------
const bab2 = [
  H1('BAB 2 SPESIFIKASI KEBUTUHAN'),
  H2('2.1 Kebutuhan Perangkat Keras Server'),
  ...table(['Komponen', 'Minimum', 'Disarankan'], [
    ['Prosesor', '2 vCPU', '2–4 vCPU'],
    ['Memori (RAM)', '2 GB', '4 GB'],
    ['Penyimpanan', '20 GB SSD', '40 GB SSD'],
    ['Jaringan', 'IP publik, port 80 dan 443 terbuka', 'IP publik statis'],
  ], [30, 35, 35], 2, 'Kebutuhan perangkat keras server'),
  H2('2.2 Kebutuhan Perangkat Lunak Server'),
  ...table(['Perangkat lunak', 'Keterangan'], [
    ['Sistem operasi', 'Linux 64-bit (disarankan Ubuntu Server 22.04/24.04 LTS)'],
    ['Docker Engine & Docker Compose v2', 'Menjalankan seluruh layanan dalam kontainer'],
    ['Git', 'Mengambil kode program dari repositori'],
    ['Domain / subdomain', 'Contoh `api.ysii.org` yang diarahkan ke IP server'],
    ['Akun Google Search Console (opsional)', 'Sumber data modul SEO'],
  ], [40, 60], 2, 'Kebutuhan perangkat lunak server'),
  H2('2.3 Kebutuhan Perangkat Klien'),
  PN('Dashboard dan website dapat dibuka dari komputer maupun ponsel dengan peramban modern: Google Chrome, Mozilla Firefox, Microsoft Edge, atau Safari versi terbaru, dengan JavaScript aktif.'),
  H2('2.4 Teknologi yang Digunakan'),
  ...table(['Lapisan', 'Teknologi', 'Versi'], [
    ['Backend API', 'Python, FastAPI, Uvicorn', '3.13 / 0.158 / 0.54'],
    ['Akses basis data', 'SQLAlchemy, psycopg', '2.1 / 3.3'],
    ['Machine learning', 'scikit-learn, pandas, NumPy, joblib', '1.9 / 3.0 / 2.5 / 1.6'],
    ['Basis data', 'PostgreSQL', '16'],
    ['Penjadwal', 'APScheduler', '3.11'],
    ['Data SEO', 'Google Search Console API', 'v1'],
    ['Antarmuka dashboard', 'HTML, CSS, JavaScript, Chart.js', '— / — / ES2017 / 4.4.1'],
    ['Script website', 'JavaScript murni (tanpa pustaka)', '±6 KB terkompresi'],
    ['Plugin website', 'PHP untuk WordPress', '≥ 7.4'],
    ['Server web', 'Nginx, Let’s Encrypt (Certbot)', '1.27 / 2.11'],
    ['Kontainer', 'Docker, Docker Compose', '—'],
  ], [28, 47, 25], 2, 'Teknologi yang digunakan'),
];

// ---------- BAB 3 ----------
const bab3 = [
  H1('BAB 3 ARSITEKTUR DAN CARA KERJA'),
  H2('3.1 Arsitektur Sistem'),
  P('Sistem dipasang **berdampingan** dengan website mitra. Website tetap berjalan seperti biasa; yang ditambahkan hanya satu baris script. Komponen utama berjalan di server terpisah (misalnya `api.ysii.org`) di dalam kontainer Docker: layanan API, basis data PostgreSQL, penjadwal, dan Nginx sebagai server web dengan HTTPS.'),
  ...figure(DIAG('arsitektur.png'), 'Arsitektur sistem promosi digital terintegrasi SEO dan machine learning', 3),
  H2('3.2 Alur Kerja'),
  ...figure(DIAG('alur.png'), 'Alur kerja dari kunjungan hingga pembelajaran ulang model (closed-loop learning)', 3),
  ...steps([
    'Calon peserta menemukan website mitra melalui Google (hasil SEO), media sosial, atau langsung.',
    'Setelah pengunjung menyetujui cookie, `tracker.js` mengirim data perilaku ke endpoint `/v1/collect`. Pengunjung diidentifikasi dengan ID acak, bukan nama atau alamat IP.',
    'Saat pengunjung mengisi form, isinya disalin ke `/v1/leads` sementara form asli tetap diproses website. Jika pengunjung memilih WhatsApp, pesan otomatis berisi kode referensi enam karakter yang dicatat admin di dashboard.',
    'Sistem menghitung skor peluang konversi dari perilaku pengunjung **sebelum** mendaftar dan menentukan segmen Hot, Warm, atau Cold.',
    'Admin menghubungi lead sesuai prioritas, lalu memperbarui statusnya. Status akhir menjadi label data latih, dan model dilatih ulang setiap minggu.',
  ]),
  H2('3.3 Struktur Basis Data'),
  ...table(['Tabel', 'Isi'], [
    ['visitors', 'Pengunjung anonim: ID acak, kode referensi WA, sumber & medium pertama, landing page, perangkat'],
    ['sessions', 'Satu kunjungan (habis setelah 30 menit tidak aktif): sumber, UTM, jumlah halaman, detik aktif, scroll maksimum'],
    ['events', 'Rincian aktivitas: jenis event, halaman, kategori halaman, slug program, nilai, label'],
    ['programs', 'Katalog program pelatihan: slug, nama, kategori, harga, URL, batch berikutnya, status aktif'],
    ['leads', 'Pendaftar dari form/WhatsApp: kontak, program, status tindak lanjut, label konversi, skor, segmen'],
    ['predictions', 'Riwayat skor yang pernah dihitung beserta versi model'],
    ['gsc_daily', 'Data harian Google Search Console per halaman dan kata kunci'],
    ['model_registry', 'Versi model, jenis tugas, algoritma, metrik evaluasi, status aktif, lokasi berkas'],
    ['admin_users', 'Akun admin dashboard (password tersimpan dalam bentuk hash PBKDF2)'],
  ], [24, 76], 3, 'Tabel basis data'),
  H2('3.4 Model Machine Learning'),
  P('Pengembangan model mengikuti tahapan CRISP-DM. Sistem memiliki **dua model** dengan tugas berbeda agar skor benar-benar berguna:'),
  ...table(['Model', 'Pertanyaan yang dijawab', 'Data latih', 'Dipakai untuk'], [
    ['lead', 'Seberapa besar peluang lead ini menjadi peserta?', 'Lead yang status akhirnya sudah diketahui (terdaftar/bayar = 1, batal = 0)', 'Mengurutkan lead di dashboard'],
    ['visitor', 'Seberapa besar peluang pengunjung ini menjadi lead?', 'Semua pengunjung (menjadi lead = 1)', 'Memilih rekomendasi dan ajakan di website'],
  ], [12, 30, 33, 25], 3, 'Dua tugas prediksi'),
  PN('Setiap pelatihan membandingkan tiga algoritma, yaitu **Logistic Regression** (baseline), **Random Forest**, dan **Gradient Boosting**, dengan langkah berikut:'),
  ...bullets([
    'Data dibagi menjadi 80% data latih dan 20% data uji secara bertingkat (_stratified_).',
    'Setiap algoritma dievaluasi dengan _stratified k-fold cross-validation_ (hingga 5 lipatan) menggunakan akurasi, presisi, recall, F1-score, dan AUC.',
    'Algoritma dengan F1-score rata-rata tertinggi dipilih, dilatih ulang dengan seluruh data, lalu disimpan dan diaktifkan.',
    'Kepentingan fitur dihitung dengan _permutation importance_ untuk menjelaskan perilaku yang paling menentukan.',
  ]),
  P('Untuk mencegah kebocoran label, fitur selalu dihitung dari perilaku **sebelum** pengunjung mendaftar. Pada model `visitor`, fitur klik WhatsApp dan mulai mengisi form tidak dipakai karena keduanya merupakan aksi menjadi lead itu sendiri.'),
  P('Selama data latih belum cukup (bawaan: minimal 30 contoh positif dan 30 contoh negatif), sistem memakai **skor berbasis aturan** yang transparan, misalnya bobot untuk melihat biaya, mengunduh brosur, membaca halaman program sampai bawah, dan kunjungan ulang. Skor dikelompokkan menjadi segmen berikut:'),
  ...table(['Segmen', 'Skor', 'Arti & tindakan'], [
    ['Hot', '≥ 0,70', 'Sangat berpotensi. Hubungi secepatnya (disarankan < 1 jam).'],
    ['Warm', '0,40 – 0,69', 'Berminat. Kirim informasi jadwal, testimoni, atau tawarkan konsultasi.'],
    ['Cold', '< 0,40', 'Masih mencari informasi. Kirim materi edukatif atau brosur.'],
  ], [16, 20, 64], 3, 'Segmentasi skor (ambang dapat diatur)'),
  H2('3.5 Keamanan dan Privasi'),
  ...bullets([
    'Perekaman perilaku hanya berjalan setelah pengunjung menekan **Setuju** pada banner persetujuan, sesuai UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi.',
    'Pengunjung diidentifikasi dengan ID acak di peramban; alamat IP tidak disimpan.',
    'Dashboard memerlukan login. Password disimpan dengan hash PBKDF2-SHA256, sesi memakai token JWT yang berlaku 12 jam, dan percobaan login dibatasi.',
    'Komunikasi dienkripsi dengan HTTPS. CORS dibatasi ke domain website mitra.',
    'Form dilengkapi pembatasan laju permintaan, _honeypot_ anti-spam, dan pengalihan hanya ke domain yang diizinkan.',
  ]),
];

// ---------- BAB 4 ----------
const bab4 = [
  H1('BAB 4 INSTALASI DAN KONFIGURASI'),
  H2('4.1 Struktur Berkas Program'),
  ...code([
    'yasiin-pti/',
    '├── backend/',
    '│   ├── app/            kode aplikasi (API, model data, ML, scoring)',
    '│   │   ├── routers/    endpoint publik & admin',
    '│   │   └── static/     tracker.js dan dashboard admin',
    '│   ├── ml/             perintah pelatihan model',
    '│   ├── jobs/           ETL Search Console & penjadwal',
    '│   ├── scripts/        buat admin, data simulasi',
    '│   └── tests/          pengujian otomatis',
    '├── integration/        plugin WordPress & contoh integrasi',
    '├── nginx/             konfigurasi server web & HTTPS',
    '├── docs/              dokumentasi',
    '├── docker-compose.yml',
    '└── .env.example       contoh konfigurasi',
  ]),
  H2('4.2 Instalasi di Server'),
  ...steps([
    'Siapkan server Linux dan pasang Docker beserta Docker Compose sesuai dokumentasi resmi Docker.',
    'Pada pengelola DNS domain, buat record **A** untuk `api.ysii.org` yang mengarah ke alamat IP server.',
    'Ambil kode program dan salin berkas konfigurasi:',
  ]),
  ...code([
    'git clone https://github.com/indripolmed/yasiin-pti.git',
    'cd yasiin-pti',
    'cp .env.example .env',
    'nano .env',
  ]),
  ...steps([
    'Isi berkas `.env` sesuai Tabel 4.1. Buat nilai `SECRET_KEY` dengan perintah `openssl rand -hex 32`.',
    'Jalankan seluruh layanan, lalu periksa statusnya:',
  ], true),
  ...code([
    'docker compose up -d --build',
    'docker compose ps',
    'curl http://api.ysii.org/v1/health',
  ]),
  PN('Perintah terakhir harus menampilkan `{"status":"ok", ...}`. Empat layanan berjalan: `db` (PostgreSQL), `api` (aplikasi), `scheduler` (tugas terjadwal), dan `nginx` (server web).'),
  ...table(['Variabel', 'Keterangan', 'Contoh'], [
    ['DB_PASSWORD', 'Password basis data PostgreSQL', 'string acak panjang'],
    ['SECRET_KEY', 'Kunci rahasia token login', 'hasil `openssl rand -hex 32`'],
    ['ALLOWED_ORIGINS', 'Domain website yang boleh mengirim data', 'https://ysii.org,https://www.ysii.org'],
    ['PUBLIC_API_URL', 'Alamat publik sistem', 'https://api.ysii.org'],
    ['API_DOMAIN', 'Domain untuk sertifikat HTTPS', 'api.ysii.org'],
    ['WHATSAPP_ADMIN', 'Nomor WhatsApp admin (format 62…)', '6281234567890'],
    ['HOT_THRESHOLD / WARM_THRESHOLD', 'Ambang segmen Hot dan Warm', '0.7 / 0.4'],
    ['MIN_POSITIVE_SAMPLES', 'Data minimal sebelum model ML menggantikan skor aturan', '30'],
    ['GSC_SITE_URL', 'Properti Google Search Console', 'sc-domain:ysii.org'],
    ['GSC_CREDENTIALS_FILE', 'Lokasi kunci service account (opsional)', '/secrets/gsc-sa.json'],
    ['HOT_LEAD_WEBHOOK_URL', 'Webhook notifikasi lead Hot (opsional)', 'URL n8n / Make / Slack'],
  ], [30, 40, 30], 4, 'Variabel konfigurasi berkas .env'),
  H2('4.3 Mengaktifkan HTTPS'),
  PN('HTTPS wajib aktif sebelum script dipasang di website. Jalankan:'),
  ...code([
    'docker compose run --rm certbot certonly --webroot -w /var/www/certbot \\',
    '  -d api.ysii.org --email admin@ysii.org --agree-tos --no-eff-email',
    'cp nginx/https.conf.example nginx/templates/https.inc.template',
    'docker compose restart nginx',
  ]),
  PN('Agar sertifikat diperpanjang otomatis, tambahkan baris berikut ke `crontab -e` di server:'),
  ...code(['0 3 1 * * cd /root/yasiin-pti && docker compose run --rm certbot renew && docker compose restart nginx']),
  H2('4.4 Membuat Akun Admin'),
  ...code(['docker compose exec api python -m scripts.create_admin admin']),
  PN('Masukkan password minimal 10 karakter. Perintah yang sama dipakai untuk mengganti password. Dashboard dapat dibuka di `https://api.ysii.org/dashboard/`.'),
  H2('4.5 Menghubungkan Google Search Console'),
  ...steps([
    'Di Google Cloud Console, buat project, aktifkan **Google Search Console API**, buat _service account_, lalu unduh kuncinya (JSON) ke `secrets/gsc-sa.json` di server.',
    'Di Search Console, buka Setelan → Pengguna dan izin, lalu tambahkan email service account dengan izin _Terbatas_.',
    'Isi `GSC_CREDENTIALS_FILE=/secrets/gsc-sa.json` pada `.env`, lalu jalankan `docker compose up -d`.',
    'Tarik data historis (±16 bulan) sebagai data awal: `docker compose exec api python -m jobs.gsc_etl --days 480`. Setelah itu data diperbarui otomatis setiap hari pukul 06.00 WIB.',
  ]),
  H2('4.6 Integrasi ke Website Mitra'),
  H3('a. Website berbasis WordPress'),
  ...steps([
    'Kompres folder `integration/wordpress/ysii-tracker/` menjadi `ysii-tracker.zip`.',
    'Di WordPress Admin, buka Plugin → Tambah Baru → Unggah Plugin, pilih berkas zip, lalu klik Aktifkan.',
    'Buka **Pengaturan → YSII Tracker**, isi URL API, alamat halaman kebijakan privasi, nomor WhatsApp admin, dan URL halaman pendaftaran, lalu simpan.',
    'Tambahkan shortcode `[ysii_reco]` pada halaman program untuk menampilkan widget rekomendasi.',
  ]),
  H3('b. Website non-WordPress'),
  PN('Tempelkan baris berikut di dalam tag `<head>` setiap halaman (atau melalui Google Tag Manager → Custom HTML):'),
  ...code([
    '<script src="https://api.ysii.org/static/tracker.js" defer',
    '        data-privacy-url="https://ysii.org/kebijakan-privasi"></script>',
  ]),
  PN('Untuk widget rekomendasi, tambahkan `<div id="ysii-reco" data-whatsapp="62…" data-daftar-url="…"></div>` pada halaman program.'),
  H3('c. Penanda halaman (opsional, meningkatkan kualitas data)'),
  ...table(['Penanda', 'Fungsi'], [
    ['URL berpola `/program/<slug>` atau `<meta name="ysii:program" content="slug">`', 'Mengenali halaman program; slug harus sama dengan yang didaftarkan di dashboard'],
    ['`id="harga"`, `id="biaya"`, atau `id="jadwal"` pada bagian biaya', 'Mencatat event melihat biaya/jadwal'],
    ['Tautan ke berkas `.pdf` atau berisi kata "brosur"', 'Mencatat event unduh brosur'],
    ['`data-track="click_cta"` pada tombol penting', 'Mencatat klik tombol ajakan'],
    ['Atribut `data-ysii-form` pada form', 'Menandai form yang disalin jika mode "hanya form bertanda" dipilih'],
  ], [50, 50], 4, 'Penanda halaman pada website'),
  note('**Catatan:** form pendaftaran dan tombol WhatsApp yang sudah ada **tidak perlu diubah**. Nama kolom form dikenali otomatis untuk form HTML biasa, Contact Form 7, Elementor Forms, dan WPForms. Form pencarian, komentar, dan login diabaikan.'),
  H3('d. Pemeriksaan setelah integrasi'),
  ...steps([
    'Buka halaman program dalam mode penyamaran (incognito). Banner persetujuan cookie harus muncul; klik **Setuju**.',
    'Arahkan kursor ke tombol WhatsApp. Alamat tautannya harus berakhir dengan `(Kode: XXXXXX)`.',
    'Isi form uji coba. Dalam beberapa detik lead harus muncul di tab **Lead** pada dashboard.',
    'Jalankan PageSpeed Insights untuk memastikan skor kecepatan website tidak turun.',
  ]),
  H2('4.7 Instalasi untuk Pengembangan dan Uji Coba'),
  PN('Untuk mencoba program di komputer sendiri tanpa Docker (memerlukan Python 3.12 atau lebih baru):'),
  ...code([
    'cd backend',
    'python -m venv .venv && source .venv/bin/activate',
    'pip install -r requirements-dev.txt',
    'python -m scripts.create_admin admin',
    'python -m scripts.generate_synthetic --visitors 3000',
    'python -m ml.train',
    'uvicorn app.main:app --reload',
  ]),
  PN('Dashboard tersedia di `http://localhost:8000/dashboard/` dan dokumentasi API interaktif di `http://localhost:8000/docs`.'),
  note('**Penting:** perintah `generate_synthetic` mengisi **data simulasi** untuk demonstrasi. Data dan metriknya bukan data nyata dan tidak boleh dipakai sebagai hasil penelitian. Perintah ini menolak berjalan pada basis data yang sudah berisi data.'),
  H2('4.8 Pengujian Otomatis'),
  ...code(['cd backend', 'pytest -q']),
  PN('Pengujian mencakup klasifikasi sumber traffic, pengenalan kolom form, pencatatan event, pembuatan dan pencegahan lead ganda, autentikasi admin, alur lead WhatsApp, rekomendasi, batas waktu fitur (anti kebocoran label), dan pelatihan kedua model.'),
];

// ---------- BAB 5 ----------
const bab5 = [
  H1('BAB 5 PANDUAN PENGGUNAAN DASHBOARD ADMIN'),
  P('Dashboard dibuka melalui peramban di alamat `https://api.ysii.org/dashboard/`. Seluruh gambar pada bab ini menggunakan **data simulasi**.'),
  H2('5.1 Masuk ke Dashboard'),
  ...steps([
    'Buka alamat dashboard. Halaman login akan tampil.',
    'Isi **Username** dan **Password** akun admin, lalu klik **Masuk**.',
    'Sesi login berlaku 12 jam. Setelah itu sistem meminta login ulang.',
  ]),
  ...figure(SHOT('01-login.png'), 'Halaman login dashboard', 5),
  H2('5.2 Menu Ringkasan'),
  P('Menu **Ringkasan** menampilkan kinerja promosi pada periode 7, 30, atau 90 hari yang dipilih di kanan atas.'),
  ...figure(SHOT('02-ringkasan.png'), 'Menu Ringkasan', 5),
  ...table(['Elemen', 'Penjelasan'], [
    ['Pengunjung', 'Jumlah pengunjung unik yang aktif pada periode tersebut'],
    ['Sesi organik (Google)', 'Jumlah kunjungan dari pencarian Google dibanding seluruh kunjungan'],
    ['Lead baru / Menjadi peserta', 'Jumlah pendaftar baru dan yang sudah berstatus terdaftar/bayar'],
    ['Konversi pengunjung → lead', 'Persentase pengunjung yang mengisi form atau menghubungi WhatsApp'],
    ['Konversi lead → peserta', 'Persentase lead yang menjadi peserta'],
    ['Lead HOT', 'Jumlah lead dengan skor tinggi pada periode tersebut'],
    ['Grafik harian', 'Garis: sesi dan sesi organik. Batang: jumlah lead per hari'],
    ['Segmen lead', 'Jumlah lead Hot, Warm, dan Cold'],
    ['Sumber traffic teratas', 'Asal kunjungan, misalnya google / organic atau instagram / social'],
    ['Model prediksi aktif', 'Algoritma dan metrik model yang sedang dipakai untuk skor lead'],
  ], [32, 68], 5, 'Elemen menu Ringkasan'),
  H2('5.3 Mengelola Lead'),
  H3('a. Daftar lead'),
  P('Menu **Lead** menampilkan lead yang **masih berjalan** (status baru, dihubungi, atau tertarik), diurutkan dari skor tertinggi. Hubungi lead **Hot** terlebih dahulu dengan tombol **WhatsApp** di ujung baris.'),
  ...figure(SHOT('03-daftar-lead.png'), 'Daftar lead terurut berdasarkan skor', 5),
  H3('b. Mencari dan menyaring'),
  P('Gunakan kotak pencarian (nama, nomor HP, atau email) dan penyaring segmen, status, program, serta urutan. Pilih "Semua status" untuk melihat lead yang sudah selesai.'),
  ...figure(SHOT('05-filter-hot.png'), 'Menyaring lead dengan segmen Hot', 5),
  H3('c. Melihat detail lead'),
  P('Klik baris lead untuk membuka detailnya. Bagian kiri menampilkan skor, kontak, sumber kunjungan pertama, kode referensi WhatsApp, dan **faktor pendorong skor**. Bagian kanan menampilkan riwayat sesi dan aktivitas pengunjung sebelum mendaftar. Informasi ini membantu admin menyesuaikan percakapan, misalnya menjelaskan biaya kepada calon peserta yang sudah melihat bagian harga.'),
  ...figure(SHOT('04-detail-lead.png'), 'Detail lead beserta perjalanan pengunjung', 5),
  H3('d. Memperbarui status tindak lanjut'),
  P('Ubah status melalui kotak pilihan di daftar lead atau di detail lead, lalu tambahkan catatan bila perlu dan klik **Simpan**. Status ini adalah bahan belajar model, jadi **harus selalu diperbarui**.'),
  ...table(['Status', 'Arti', 'Label untuk model'], [
    ['baru', 'Lead baru masuk, belum dihubungi', 'belum diketahui'],
    ['dihubungi', 'Sudah dihubungi, menunggu jawaban', 'belum diketahui'],
    ['tertarik', 'Menyatakan minat, belum mendaftar', 'belum diketahui'],
    ['terdaftar', 'Sudah mendaftar sebagai peserta', 'positif (1)'],
    ['bayar', 'Sudah membayar biaya pelatihan', 'positif (1)'],
    ['batal', 'Tidak jadi mendaftar', 'negatif (0)'],
  ], [20, 50, 30], 5, 'Status lead'),
  H3('e. Mencatat lead dari WhatsApp'),
  P('Pesan WhatsApp yang dikirim dari tombol di website otomatis diakhiri dengan **(Kode: XXXXXX)**. Saat chat masuk, klik **+ Lead dari WhatsApp**, isi nama, nomor WhatsApp, **kode referensi**, program, dan isi pesan, lalu klik **Simpan**. Lead akan terhubung dengan riwayat kunjungan pengunjung tersebut dan langsung mendapat skor.'),
  ...figure(SHOT('06-lead-whatsapp.png'), 'Formulir pencatatan lead dari WhatsApp', 5),
  H3('f. Mengunduh data lead'),
  P('Klik **Unduh CSV** untuk mengunduh seluruh lead dalam format CSV yang dapat dibuka di Microsoft Excel atau Google Sheets.'),
  H2('5.4 Mengelola Program Pelatihan'),
  P('Menu **Program** dipakai untuk mendaftarkan program pelatihan. Data ini dipakai oleh widget rekomendasi dan untuk menampilkan nama program pada lead. Isi slug, nama, kategori, harga, URL halaman, dan tanggal batch berikutnya, lalu klik **Simpan**. Klik **Ubah** untuk memperbarui atau **Hapus** untuk menghapus program.'),
  note('**Slug** harus sama dengan bagian URL halaman program di website. Contoh: `https://ysii.org/program/barista` memiliki slug `barista`.'),
  ...figure(SHOT('07-program.png'), 'Menu Program', 5),
  H2('5.5 Memantau Kinerja SEO'),
  P('Menu **SEO** menampilkan data Google Search Console 28 hari terakhir: total klik, impresi, CTR, rata-rata posisi, tren harian, kata kunci dan halaman teratas, serta daftar halaman dengan impresi tinggi tetapi CTR di bawah 2%. Halaman pada daftar terakhir perlu diperbaiki judul dan deskripsinya agar lebih menarik di hasil pencarian.'),
  ...figure(SHOT('08-seo.png'), 'Menu SEO', 5),
  H2('5.6 Mengelola Model Machine Learning'),
  P('Menu **Model ML** menampilkan jumlah data berlabel, perbandingan ketiga algoritma untuk setiap tugas (akurasi, presisi, recall, F1, AUC pada validasi silang dan data uji), _confusion matrix_, kepentingan fitur, serta riwayat model.'),
  ...figure(SHOT('09-model-ml.png'), 'Menu Model ML: perbandingan algoritma model lead', 5),
  ...steps([
    'Untuk melatih ulang, pilih tugas (**Semua model**, **lead → peserta**, atau **pengunjung → lead**), lalu klik **Latih ulang model**. Proses berjalan di latar belakang dan hasilnya tampil otomatis.',
    'Centang **Paksa** hanya untuk uji coba bila data masih sedikit. Hasil dengan data sedikit tidak dapat diandalkan.',
    'Pada **Riwayat model**, klik **Aktifkan** untuk kembali ke versi model sebelumnya.',
    'Klik **Kembali ke skor aturan untuk tugas ini** untuk menonaktifkan model ML dan memakai skor berbasis aturan.',
  ]),
  note('Model juga dilatih ulang otomatis setiap Senin pukul 02.00 WIB. Skor lead yang masih berjalan diperbarui dengan model baru, sedangkan skor lead yang sudah selesai tidak diubah agar ketepatan prediksi dapat dievaluasi.'),
  H2('5.7 Dashboard di Ponsel'),
  P('Dashboard menyesuaikan diri dengan layar ponsel sehingga admin dapat memeriksa dan menghubungi lead dari mana saja.'),
  ...figure(SHOT('15-dashboard-hp.png'), 'Tampilan dashboard pada ponsel', 5, 260, 520),
  H2('5.8 Keluar'),
  P('Klik **Keluar** di kanan atas untuk mengakhiri sesi, terutama saat memakai komputer bersama.'),
  H2('5.9 Prosedur Harian Admin'),
  ...steps([
    'Buka menu **Lead**; hubungi semua lead **Hot** yang berstatus baru.',
    'Catat setiap chat WhatsApp yang berisi kode referensi melalui **+ Lead dari WhatsApp**.',
    'Perbarui status setiap lead yang sudah dihubungi, dan tandai **terdaftar**, **bayar**, atau **batal** begitu hasilnya diketahui.',
    'Sekali seminggu, periksa menu **Ringkasan** dan **SEO** untuk memantau tren.',
    'Perbarui tanggal batch di menu **Program** setiap kali jadwal berubah.',
  ]),
];

// ---------- BAB 6 ----------
const bab6 = [
  H1('BAB 6 TAMPILAN DI SISI PENGUNJUNG WEBSITE'),
  P('Bab ini menunjukkan bagaimana sistem tampil bagi calon peserta yang membuka website mitra. Gambar diambil dari halaman contoh pada tampilan ponsel.'),
  H2('6.1 Banner Persetujuan Cookie'),
  P('Saat pertama kali membuka website, pengunjung melihat banner di bagian bawah layar. Perilaku hanya direkam jika pengunjung menekan **Setuju**. Jika menekan **Tolak**, website tetap dapat dipakai, tombol WhatsApp tetap berfungsi, dan isi form pendaftaran tetap diterima sistem tanpa riwayat kunjungan.'),
  ...figure(SHOT('11-banner-persetujuan.png'), 'Banner persetujuan cookie', 6, 260, 520),
  H2('6.2 Tombol WhatsApp dengan Kode Referensi'),
  P('Tombol WhatsApp pada website tidak berubah tampilannya. Sistem menambahkan kode referensi pada akhir pesan, sehingga admin dapat menghubungkan chat dengan riwayat kunjungan (lihat Subbab 5.3e). Kotak bergaris pada gambar hanya ditambahkan untuk memperlihatkan isi pesan yang terkirim.'),
  ...figure(SHOT('12-kode-whatsapp.png'), 'Isi pesan WhatsApp yang otomatis diberi kode referensi', 6, 320, 520),
  H2('6.3 Form Pendaftaran'),
  P('Form pendaftaran yang sudah ada tetap dipakai. Saat pengunjung menekan tombol kirim, isi form disalin ke sistem sebagai lead baru, sementara form tetap diproses oleh website seperti biasa, misalnya diarahkan ke halaman terima kasih.'),
  ...figure(SHOT('14-form-pendaftaran.png'), 'Form pendaftaran pada website', 6, 320, 520),
  H2('6.4 Widget Rekomendasi'),
  P('Widget rekomendasi menampilkan program lain yang relevan, berdasarkan program yang pernah dilihat pengunjung dan pola pengunjung lain, beserta ajakan yang disesuaikan dengan segmennya. Pengunjung Cold diarahkan ke informasi program, Warm ke konsultasi WhatsApp, dan Hot ke halaman pendaftaran.'),
  ...figure(SHOT('13-widget-rekomendasi.png'), 'Widget rekomendasi program', 6, 320, 520),
];

// ---------- BAB 7 ----------
const bab7 = [
  H1('BAB 7 PEMELIHARAAN DAN PEMECAHAN MASALAH'),
  H2('7.1 Pencadangan Data'),
  PN('Tambahkan baris berikut ke `crontab -e` di server untuk mencadangkan basis data setiap hari pukul 01.30:'),
  ...code(['30 1 * * * cd /root/yasiin-pti && docker compose exec -T db pg_dump -U ysii ysii | gzip > /root/backup/ysii-$(date +\\%F).sql.gz']),
  PN('Untuk memulihkan dari berkas cadangan:'),
  ...code(['gunzip -c /root/backup/ysii-2026-11-01.sql.gz | docker compose exec -T db psql -U ysii ysii']),
  PN('Simpan salinan cadangan secara berkala di lokasi lain (misalnya penyimpanan awan institusi).'),
  H2('7.2 Memperbarui Program'),
  ...code(['cd /root/yasiin-pti', 'git pull', 'docker compose up -d --build']),
  PN('Struktur tabel baru dibuat otomatis saat aplikasi dijalankan. Lakukan pencadangan sebelum memperbarui.'),
  H2('7.3 Pemantauan'),
  ...table(['Kebutuhan', 'Perintah / cara'], [
    ['Status layanan', '`docker compose ps`'],
    ['Log aplikasi', '`docker compose logs -f api`'],
    ['Log tugas terjadwal', '`docker compose logs -f scheduler`'],
    ['Cek kesehatan sistem', '`https://api.ysii.org/v1/health` (dapat dipantau dengan layanan seperti UptimeRobot)'],
    ['Melatih model secara manual', '`docker compose exec api python -m ml.train`'],
    ['Ekspor dataset untuk analisis', '`docker compose exec api python -m ml.train --task lead --export-dataset /app/models/lead.csv`'],
  ], [32, 68], 7, 'Perintah pemantauan dan pemeliharaan'),
  H2('7.4 Pemecahan Masalah'),
  ...table(['Masalah', 'Kemungkinan penyebab', 'Solusi'], [
    ['Banner cookie tidak muncul', 'Script belum terpasang, atau pengunjung sudah pernah memilih', 'Periksa sumber halaman berisi `tracker.js`; uji di mode penyamaran'],
    ['Lead dari form tidak masuk', 'Domain website tidak ada di `ALLOWED_ORIGINS`, form tanpa kolom HP/email, atau mode salin form "Mati"', 'Perbaiki `.env` lalu `docker compose up -d`; periksa pengaturan plugin'],
    ['Kode WA tidak muncul di pesan', 'Tombol WA dibuat dengan JavaScript, bukan tautan biasa', 'Ganti dengan tautan `<a href="https://wa.me/62…">`'],
    ['Kode referensi tidak ditemukan', 'Salah ketik atau pengunjung menolak cookie', 'Periksa kode (6 karakter, huruf A–F dan angka); simpan lead tanpa kode bila perlu'],
    ['Semua skor memakai aturan', 'Data berlabel belum mencapai batas minimal', 'Normal pada awal pemakaian; terus perbarui status lead'],
    ['Menu SEO kosong', 'Search Console belum terhubung', 'Ikuti Subbab 4.5'],
    ['Gagal login / "Terlalu banyak percobaan"', 'Password salah atau terlalu banyak percobaan', 'Tunggu 1 menit; reset password dengan `scripts.create_admin`'],
    ['Halaman error 502', 'Layanan `api` mati atau sedang dimulai ulang', 'Periksa `docker compose ps` dan `docker compose logs api`'],
  ], [26, 37, 37], 7, 'Pemecahan masalah umum'),
];

// ---------- LAMPIRAN ----------
const lampiran = [
  H1('LAMPIRAN'),
  H2('Lampiran A. Daftar Endpoint API'),
  ...table(['Metode', 'Endpoint', 'Fungsi', 'Akses'], [
    ['POST', '/v1/collect', 'Menerima data perilaku dari tracker', 'Publik'],
    ['POST', '/v1/leads', 'Menerima data form pendaftaran', 'Publik'],
    ['GET', '/v1/recommend/{visitor_id}', 'Rekomendasi program dan ajakan', 'Publik'],
    ['GET', '/v1/health', 'Pemeriksaan kesehatan sistem', 'Publik'],
    ['POST', '/v1/auth/login', 'Login admin, menghasilkan token', 'Publik'],
    ['GET', '/v1/admin/kpi', 'Ringkasan KPI', 'Admin'],
    ['GET', '/v1/admin/leads', 'Daftar lead dengan filter', 'Admin'],
    ['POST', '/v1/admin/leads', 'Mencatat lead dari WhatsApp', 'Admin'],
    ['GET / PATCH', '/v1/admin/leads/{id}', 'Detail lead / ubah status dan catatan', 'Admin'],
    ['POST', '/v1/admin/leads/{id}/rescore', 'Menghitung ulang skor lead', 'Admin'],
    ['GET', '/v1/admin/export/leads.csv', 'Ekspor lead ke CSV', 'Admin'],
    ['GET / PUT / DELETE', '/v1/admin/programs[/{slug}]', 'Mengelola program pelatihan', 'Admin'],
    ['GET', '/v1/admin/seo', 'Data kinerja SEO', 'Admin'],
    ['GET', '/v1/admin/model', 'Informasi dan riwayat model', 'Admin'],
    ['POST', '/v1/admin/model/retrain', 'Melatih ulang model', 'Admin'],
    ['POST', '/v1/admin/model/{versi}/activate', 'Mengaktifkan versi model', 'Admin'],
    ['POST', '/v1/admin/model/deactivate', 'Kembali ke skor berbasis aturan', 'Admin'],
  ], [16, 36, 34, 14], 'A', 'Endpoint API'),
  PN('Dokumentasi interaktif seluruh endpoint tersedia di `https://api.ysii.org/docs`.'),
  H2('Lampiran B. Daftar Event Perilaku'),
  ...table(['Event', 'Kapan tercatat'], [
    ['page_view', 'Pengunjung membuka halaman'],
    ['heartbeat', 'Akumulasi detik aktif (tab terlihat dan ada interaksi)'],
    ['scroll', 'Pengunjung mencapai 25%, 50%, 75%, atau 100% halaman'],
    ['view_price', 'Bagian biaya/jadwal terlihat di layar'],
    ['download_brochure', 'Klik tautan brosur atau berkas PDF'],
    ['click_cta', 'Klik tombol ajakan, misalnya "Daftar"'],
    ['click_whatsapp', 'Klik tautan WhatsApp'],
    ['form_start', 'Mulai mengisi form'],
    ['form_submit', 'Mengirim form'],
    ['site_search', 'Melakukan pencarian di website'],
  ], [30, 70], 'B', 'Event yang direkam tracker'),
  H2('Lampiran C. Fitur Model Machine Learning'),
  ...table(['Kelompok', 'Fitur'], [
    ['Sesi', 'n_sessions, n_pageviews, total_active_sec, avg_active_per_session, avg_pages_per_session, bounce_rate, is_returning, n_active_days, engagement_span_days'],
    ['Scroll', 'max_scroll_pct, avg_session_scroll_pct, n_deep_program_reads'],
    ['Konten', 'n_program_views, n_distinct_programs, n_article_views'],
    ['Interaksi', 'n_click_cta, n_click_whatsapp*, n_view_price, n_download_brochure, n_form_start*, n_site_search'],
    ['Waktu', 'first_visit_hour, first_visit_weekend'],
    ['Kategorikal', 'first_medium, first_source, device_type, landing_category, landing_query_intent'],
  ], [22, 78], 'C', 'Fitur model'),
  PN('* Tidak dipakai pada model `visitor` untuk mencegah kebocoran label. Fitur `landing_query_intent` diturunkan dari kata kunci dominan Google Search Console pada halaman pendaratan pengunjung, karena Google tidak menyediakan kata kunci per pengunjung.'),
  H2('Lampiran D. Glosarium'),
  ...table(['Istilah', 'Pengertian'], [
    ['Lead', 'Calon peserta yang sudah meninggalkan kontak melalui form atau WhatsApp'],
    ['Konversi', 'Perubahan status, misalnya dari pengunjung menjadi lead atau dari lead menjadi peserta'],
    ['SEO', 'Search Engine Optimization; upaya meningkatkan peringkat website di hasil mesin pencari'],
    ['CTR', 'Click-through rate; persentase tayangan di Google yang diklik'],
    ['Slug', 'Bagian akhir URL yang menjadi pengenal program, misalnya "barista"'],
    ['Segmen Hot / Warm / Cold', 'Pengelompokan lead berdasarkan skor peluang konversi'],
    ['F1-score', 'Rata-rata harmonis presisi dan recall; metrik utama pada data tidak seimbang'],
    ['AUC', 'Area under ROC curve; kemampuan model membedakan kelas positif dan negatif'],
    ['Cross-validation', 'Teknik evaluasi dengan membagi data latih menjadi beberapa lipatan secara bergantian'],
    ['Closed-loop learning', 'Hasil tindak lanjut menjadi data latih baru sehingga model terus diperbarui'],
    ['Kebocoran label', 'Kondisi ketika fitur memuat informasi hasil yang hendak diprediksi sehingga akurasi tampak tinggi secara semu'],
  ], [28, 72], 'D', 'Glosarium'),
];

// ================= DOKUMEN =================
const HEADER = () => new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT,
  border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '8A949E', space: 4 } },
  children: [new TextRun({ text: 'Manual Book — Sistem Promosi Digital Terintegrasi SEO & Machine Learning', size: 18, italics: true, color: '555555' })] })] });
const FOOTER = () => new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER,
  children: [new TextRun({ children: [PageNumber.CURRENT], size: 20 })] })] });
const doc = new Document({
  creator: 'Tim PTI Politeknik Negeri Medan',
  title: 'Manual Book — ' + TITLE,
  description: 'Panduan instalasi dan penggunaan program komputer',
  features: { updateFields: true },
  styles: {
    default: { document: { run: { font: FONT, size: 24 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 28, bold: true, font: FONT, color: '000000' },
        paragraph: { alignment: AlignmentType.CENTER, spacing: { before: 0, after: 360 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 24, bold: true, font: FONT, color: GREEN },
        paragraph: { spacing: { before: 280, after: 120 }, keepNext: true, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 24, bold: true, italics: false, font: FONT },
        paragraph: { spacing: { before: 200, after: 80 }, keepNext: true, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [
      { reference: 'bullet', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 567, hanging: 284 } } } }] },
      { reference: 'steps', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 567, hanging: 340 } } } }] },
    ],
  },
  sections: [
    {
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1701, bottom: 1701, left: 2268, right: 1701 } } },
      children: cover,
    },
    {
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1701, bottom: 1701, left: 2268, right: 1701 },
        pageNumbers: { start: 1, formatType: NumberFormat.LOWER_ROMAN } } },
      headers: { default: HEADER() },
      footers: { default: FOOTER() },
      children: [...identitas, ...toc],
    },
    {
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1701, bottom: 1701, left: 2268, right: 1701 },
        pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } } },
      headers: { default: HEADER() },
      footers: { default: FOOTER() },
      children: [...bab1, ...bab2, ...bab3, ...bab4, ...bab5, ...bab6, ...bab7, ...lampiran],
    },
  ],
});

Packer.toBuffer(doc).then((buf) => { fs.writeFileSync(OUT, buf); console.log('OK', OUT, buf.length); });
