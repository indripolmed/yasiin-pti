// Membuat instrumen UAT dan kuesioner SUS (versi admin mitra & versi calon peserta).
// node build_uat_sus.js <folder-output>
const fs = require('fs');
const path = require('path');
const { Packer, Paragraph, TextRun, AlignmentType, PageBreak } = require('docx');
const { create, documentOf, TITLE } = require('./lib');
const { UAT, SUS_ITEMS, SUS_REF } = require('./data_uat_sus');

const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });
const HDR = 'Sistem Promosi Digital Terintegrasi SEO & Machine Learning';
const save = (doc, name) => Packer.toBuffer(doc).then((b) => { fs.writeFileSync(path.join(OUT, name), b); console.log('OK', name); });
const line = (label, w = 60) => new Paragraph({ spacing: { after: 160 },
  children: [new TextRun({ text: `${label}`, size: 23 }), new TextRun({ text: ' : ' + '.'.repeat(w), size: 23 })] });
const sign = (left, right) => {
  const h = create();
  return h.table(null, [[
    { text: `${left[0]}\n\n\n\n\n**${left[1]}**\n${left[2]}`, align: 'center' },
    { text: `${right[0]}\n\n\n\n\n**${right[1]}**\n${right[2]}`, align: 'center' },
  ]], [50, 50], null, null, { size: 22, noBorder: true });
};

// ===================== UAT =====================
function buildUat() {
  const h = create();
  const total = UAT.reduce((a, g) => a + g.items.length, 0);
  const critical = UAT.flatMap((g) => g.items).filter((i) => i.critical).map((i) => i.id);
  const children = [
    h.title('INSTRUMEN USER ACCEPTANCE TEST (UAT)', 28, 60),
    h.center(TITLE, { bold: true, size: 22, after: 60 }),
    h.center('Versi program 1.0', { size: 22, after: 300 }),
    h.H2('A. Tujuan'),
    h.P('Instrumen ini dipakai untuk memastikan bahwa program komputer memenuhi kebutuhan operasional mitra (Yayasan Sinergi Inspirasi Indonesia) sebelum dipakai penuh. Pengujian dilakukan oleh admin mitra dan didampingi tim peneliti pada lingkungan operasional (website mitra dan dashboard di server produksi).'),
    h.H2('B. Identitas Pengujian'),
    line('Nama penguji'), line('Jabatan / peran'), line('Tanggal pengujian'), line('Perangkat & peramban'),
    line('Alamat dashboard'), line('Versi / tanggal rilis program'),
    h.H2('C. Petunjuk'),
    ...h.steps([
      'Jalankan setiap skenario sesuai langkah yang tertulis, berurutan dari atas.',
      'Bandingkan hasil di layar dengan kolom **Hasil yang diharapkan**.',
      'Beri tanda **✓** pada kolom **S** (Sesuai) atau **TS** (Tidak Sesuai).',
      'Jika Tidak Sesuai, tuliskan apa yang terjadi di kolom **Catatan** (sertakan tangkapan layar bila ada).',
      'Skenario bertanda bintang (*) adalah **skenario kritis**.',
    ]),
    h.note('Gunakan data uji, misalnya nama "UJI COBA" dan nomor HP tim peneliti. Setelah selesai, lead uji dapat ditandai **batal** dan diberi catatan "data uji" agar tidak menjadi data latih yang keliru.'),
  ];
  for (const g of UAT) {
    // kelompok besar dimulai di halaman baru agar judul tidak terpisah dari tabelnya
    children.push(new Paragraph({ children: [], pageBreakBefore: g.code === 'A' || g.items.length >= 9 }));
    children.push(h.H2(`${g.code}. ${g.title}`));
    if (g.note) children.push(h.PN(g.note));
    children.push(...h.table(['Kode', 'Skenario & langkah', 'Hasil yang diharapkan', 'S', 'TS', 'Catatan'],
      g.items.map((i) => [i.id + (i.critical ? '*' : ''), `**${i.name}**\n${i.steps}`, i.expected, '', '', '']),
      [9, 33, 31, 6, 6, 15], null, null, { size: 19, centerHead: true }));
  }
  children.push(
    h.H1('REKAPITULASI HASIL UAT'),
    ...h.table(['Kelompok', 'Jumlah skenario', 'Sesuai', 'Tidak sesuai', '% Sesuai'],
      [...UAT.map((g) => [`${g.code}. ${g.title}`, { text: String(g.items.length), align: 'center' }, '', '', '']),
        [{ text: 'Total', bold: true }, { text: String(total), align: 'center', bold: true }, '', '', '']],
      [44, 16, 13, 14, 13], null, null, { size: 21, centerHead: true }),
    h.H2('Kriteria Penerimaan'),
    ...h.bullets([
      `Program **diterima** jika minimal **90%** skenario berstatus Sesuai **dan** seluruh skenario kritis (${critical.join(', ')}) berstatus Sesuai.`,
      'Program **diterima dengan perbaikan** jika minimal 90% Sesuai tetapi ada skenario non-kritis yang Tidak Sesuai; perbaikan dicatat dan diuji ulang.',
      'Program **belum diterima** jika kurang dari 90% Sesuai atau ada skenario kritis yang Tidak Sesuai.',
    ]),
    h.H2('Daftar Temuan & Tindak Lanjut'),
    ...h.table(['No', 'Kode skenario', 'Temuan', 'Tindak lanjut', 'Status uji ulang'],
      [1, 2, 3, 4, 5, 6].map((n) => [String(n), '', '', '', '']), [6, 16, 32, 30, 16], null, null, { size: 21, centerHead: true }),
    new Paragraph({ children: [new PageBreak()] }),
    h.title('BERITA ACARA USER ACCEPTANCE TEST', 26, 300),
    h.P('Pada hari ini ……………… tanggal ……… bulan ………………… tahun 2026, bertempat di Yayasan Sinergi Inspirasi Indonesia, Jl. Darussalam No. 16/22, Medan, telah dilaksanakan User Acceptance Test (UAT) terhadap program komputer:'),
    h.center(`**${TITLE}**`, { size: 23, after: 200 }),
    h.P(`Pengujian meliputi ${total} skenario pada ${UAT.length} kelompok fungsi. Berdasarkan rekapitulasi hasil pengujian, sebanyak ……… skenario (………%) berstatus Sesuai, dengan kesimpulan program:`),
    ...h.bullets(['☐ Diterima', '☐ Diterima dengan perbaikan sebagaimana tercantum pada Daftar Temuan', '☐ Belum diterima']),
    h.P('Demikian berita acara ini dibuat untuk dipergunakan sebagaimana mestinya.'),
    new Paragraph({ spacing: { after: 300 }, children: [] }),
    ...sign(['Pihak Mitra,\nYayasan Sinergi Inspirasi Indonesia', '(………………………………………)', 'Jabatan: ……………………'],
      ['Tim Peneliti,\nPoliteknik Negeri Medan', 'Indri Sulistianingsih, S.Kom., M.Kom.', 'Ketua Peneliti']),
  );
  return save(documentOf({ title: 'Instrumen UAT', headerText: 'Instrumen UAT — ' + HDR, sections: [{ pageStart: 1, children }] }), 'Instrumen-UAT.docx');
}

// ===================== SUS =====================
function buildSus(variant) {
  const h = create();
  const isAdmin = variant === 'admin';
  const object = isAdmin ? 'dashboard manajemen lead' : 'website pendaftaran pelatihan';
  const children = [
    h.title('KUESIONER SYSTEM USABILITY SCALE (SUS)', 28, 60),
    h.center(isAdmin ? 'Responden: Admin / Pengelola Mitra' : 'Responden: Calon Peserta Pelatihan', { bold: true, size: 23, after: 60 }),
    h.center(TITLE, { size: 21, after: 240 }),
    h.PN(`Yth. Bapak/Ibu/Saudara/i,`),
    h.P(`Kuesioner ini merupakan bagian dari penelitian Politeknik Negeri Medan bersama Yayasan Sinergi Inspirasi Indonesia. Kami ingin mengetahui seberapa mudah ${object} digunakan. Tidak ada jawaban benar atau salah; jawablah sesuai pengalaman Anda setelah mencoba ${isAdmin ? 'dashboard' : 'website'}. Pengisian membutuhkan sekitar 5 menit. Data Anda dijaga kerahasiaannya dan hanya dilaporkan dalam bentuk ringkasan.`),
    h.H2('A. Data Responden'),
    line('Nama / inisial'),
    ...(isAdmin
      ? [line('Jabatan / peran'), line('Lama menggunakan dashboard'), line('Tanggal pengisian')]
      : [line('Usia'), line('Program pelatihan yang diminati'), line('Perangkat yang dipakai (HP / laptop)'), line('Tanggal pengisian')]),
    h.PN('☐ Saya bersedia jawaban saya digunakan untuk keperluan penelitian.'),
    new Paragraph({ children: [new PageBreak()] }),
    h.H2('B. Pernyataan'),
    h.PN(`Beri tanda **✓** pada satu kotak di setiap baris. Yang dimaksud **"sistem ini"** adalah ${object}.`),
    h.PN('**1** = Sangat Tidak Setuju, **2** = Tidak Setuju, **3** = Ragu-ragu, **4** = Setuju, **5** = Sangat Setuju'),
    ...h.table(['No', 'Pernyataan', '1', '2', '3', '4', '5'],
      SUS_ITEMS.map((t, i) => [{ text: String(i + 1), align: 'center' }, t, ...Array(5).fill({ text: '☐', align: 'center' })]),
      [7, 58, 7, 7, 7, 7, 7], null, null, { size: 22, centerHead: true }),
    h.H2('C. Pertanyaan Terbuka'),
    ...(isAdmin
      ? ['Fitur apa yang paling membantu pekerjaan Anda?', 'Bagian mana yang paling membingungkan atau sulit digunakan?', 'Apa saran Anda untuk perbaikan dashboard?']
      : ['Apa yang paling membantu Anda saat mencari informasi pelatihan di website ini?', 'Apakah ada bagian yang membingungkan atau sulit digunakan?', 'Apa saran Anda untuk perbaikan website?'])
      .flatMap((q, i) => [h.PN(`${i + 1}. ${q}`), ...[1, 2].map(() => new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: '.'.repeat(118), size: 20 })] }))]),
    h.center('Terima kasih atas partisipasi Anda.', { bold: true, after: 0 }),
    h.H1('PEDOMAN PENILAIAN SUS (untuk peneliti)'),
    h.PN(`Butir pernyataan merupakan adaptasi Bahasa Indonesia SUS (Brooke, 1996) yang mengacu pada ${SUS_REF}.`),
    h.H3('Perhitungan skor per responden'),
    ...h.steps([
      'Butir **ganjil** (1, 3, 5, 7, 9): skor kontribusi = jawaban − 1.',
      'Butir **genap** (2, 4, 6, 8, 10): skor kontribusi = 5 − jawaban.',
      'Jumlahkan kontribusi kesepuluh butir (rentang 0–40), lalu kalikan **2,5**. Hasilnya skor SUS 0–100.',
      'Skor sistem = rata-rata skor SUS seluruh responden. Responden yang tidak menjawab lengkap tidak dihitung.',
    ]),
    h.PN('Contoh: jawaban 4, 2, 5, 1, 4, 2, 4, 2, 5, 3 → (3+3+4+4+3+3+3+3+4+2) = 32 → 32 × 2,5 = **80**.'),
    h.H3('Interpretasi'),
    ...h.table(['Skor SUS', 'Penerimaan (Bangor dkk., 2008)', 'Kategori adjektif (Bangor dkk., 2009)'], [
      ['> 85', 'Acceptable', 'Best imaginable / Excellent'],
      ['70 – 85', 'Acceptable', 'Good – Excellent'],
      ['68', '(rata-rata umum SUS)', 'Batas di atas/bawah rata-rata'],
      ['50 – 69,9', 'Marginal', 'OK – Good'],
      ['< 50', 'Not acceptable', 'Poor – Worst imaginable'],
    ], [22, 38, 40], null, null, { size: 21, centerHead: true }),
    h.PN('Disarankan minimal **12 responden** per kelompok agar hasil stabil. Laporkan rata-rata, simpangan baku, dan jumlah responden. Lembar perhitungan otomatis tersedia pada berkas **Kalkulator-SUS-dan-Rekap-UAT.xlsx**.'),
  ];
  const name = isAdmin ? 'Kuesioner-SUS-Admin-Mitra.docx' : 'Kuesioner-SUS-Calon-Peserta.docx';
  return save(documentOf({ title: 'Kuesioner SUS', headerText: 'Kuesioner SUS — ' + HDR, sections: [{ pageStart: 1, children }] }), name);
}

Promise.all([buildUat(), buildSus('admin'), buildSus('peserta')]);
