// Pustaka pembantu pembuatan dokumen Word (docx-js) untuk dokumen penelitian & HKI.
// Format: A4, Times New Roman 12, margin kiri 4 cm, lainnya 3 cm.
const fs = require('fs');
const {
  Document, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, AlignmentType, HeadingLevel,
  Header, Footer, PageNumber, WidthType, ShadingType, BorderStyle, LevelFormat, VerticalAlign, NumberFormat,
} = require('docx');

const FONT = 'Times New Roman';
const MONO = 'Courier New';
const GREEN = '0B5C39';
const TABLE_W = 7937;
const IMG_MAX_W = 528;
const PAGE = { size: { width: 11906, height: 16838 }, margin: { top: 1701, bottom: 1701, left: 2268, right: 1701 } };

function runs(text, base = {}) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|(?<![A-Za-z0-9])_[^_]+_(?![A-Za-z0-9]))/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), ...base }));
    const t = m[0];
    if (t.startsWith('**')) out.push(new TextRun({ text: t.slice(2, -2), ...base, bold: true }));
    else if (t.startsWith('`')) out.push(new TextRun({ text: t.slice(1, -1), ...base, font: MONO, size: 21 }));
    else out.push(new TextRun({ text: t.slice(1, -1), ...base, italics: true }));
    last = m.index + t.length;
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), ...base }));
  return out;
}

function create() {
  let listInstance = 0;
  const figNo = {}, tblNo = {};
  const h = {};
  h.P = (text, o = {}) => new Paragraph({ children: runs(text), alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 120, line: 360 }, indent: o.noIndent ? undefined : { firstLine: 567 } });
  h.PN = (text) => h.P(text, { noIndent: true });
  h.H1 = (text, pageBreak = true) => new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: pageBreak, children: [new TextRun(text)] });
  h.H2 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(text)] });
  h.H3 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(text)] });
  h.title = (text, size = 28, after = 120) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after },
    children: [new TextRun({ text, bold: true, size })] });
  h.center = (text, o = {}) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: o.after ?? 60 },
    children: runs(text, { size: o.size ?? 24, bold: o.bold })});
  h.blank = (n = 1) => Array.from({ length: n }, () => new Paragraph({ children: [] }));
  h.bullets = (items) => items.map((t) => new Paragraph({ children: runs(t), numbering: { reference: 'bullet', level: 0 },
    alignment: AlignmentType.JUSTIFIED, spacing: { after: 60, line: 320 } }));
  h.steps = (items, cont = false) => {
    const inst = cont ? listInstance : ++listInstance;
    return items.map((t) => new Paragraph({ children: runs(t), numbering: { reference: 'steps', level: 0, instance: inst },
      alignment: AlignmentType.JUSTIFIED, spacing: { after: 80, line: 320 } }));
  };
  h.note = (text) => new Paragraph({ children: runs(text, { size: 22 }),
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'FFF7E6' },
    border: { left: { style: BorderStyle.SINGLE, size: 18, color: 'B7791F', space: 8 } },
    spacing: { before: 80, after: 160, line: 300 }, indent: { left: 200, right: 100 } });
  h.figure = (file, caption, chapter, maxW = IMG_MAX_W, maxH = 640) => {
    const buf = fs.readFileSync(file);
    const w = buf.readUInt32BE(16), hh = buf.readUInt32BE(20);
    let tw = maxW, th = Math.round(hh * maxW / w);
    if (th > maxH) { th = maxH; tw = Math.round(w * maxH / hh); }
    figNo[chapter] = (figNo[chapter] || 0) + 1;
    const label = `Gambar ${chapter}.${figNo[chapter]}`;
    return [
      new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 120, after: 60 },
        children: [new ImageRun({ type: 'png', data: buf, transformation: { width: tw, height: th },
          altText: { title: caption, description: caption, name: label } })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 },
        children: [new TextRun({ text: `${label} `, bold: true, size: 22 }), new TextRun({ text: caption, size: 22 })] }),
    ];
  };
  const border = { style: BorderStyle.SINGLE, size: 4, color: '8A949E' };
  const borders = { top: border, bottom: border, left: border, right: border };
  const nb = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const noBorders = { top: nb, bottom: nb, left: nb, right: nb };
  // rows: array of arrays; a cell may be a string or { text, fill, bold, align }
  h.table = (headers, rows, widthsPct, chapter, caption, o = {}) => {
    const widths = widthsPct.map((p) => Math.round(TABLE_W * p / 100));
    widths[widths.length - 1] = TABLE_W - widths.slice(0, -1).reduce((a, b) => a + b, 0);
    const size = o.size ?? 21;
    const cell = (c, i, head) => {
      const spec = typeof c === 'object' && c !== null ? c : { text: c };
      return new TableCell({
        borders: o.noBorder ? noBorders : borders, width: { size: widths[i], type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER,
        shading: head ? { type: ShadingType.CLEAR, color: 'auto', fill: 'DCEFE4' }
          : spec.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: spec.fill } : undefined,
        margins: { top: 50, bottom: 50, left: 90, right: 90 },
        children: String(spec.text ?? '').split('\n').map((line) => new Paragraph({ spacing: { after: 0, line: 260 },
          alignment: spec.align === 'center' || (head && o.centerHead) ? AlignmentType.CENTER : AlignmentType.LEFT,
          children: runs(line, { size, bold: head || spec.bold || undefined }) })),
      });
    };
    const out = [];
    if (caption) {
      tblNo[chapter] = (tblNo[chapter] || 0) + 1;
      out.push(new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 160, after: 80 },
        children: [new TextRun({ text: `Tabel ${chapter}.${tblNo[chapter]} `, bold: true, size: 22 }), new TextRun({ text: caption, size: 22 })] }));
    }
    out.push(new Table({
      width: { size: TABLE_W, type: WidthType.DXA }, columnWidths: widths,
      rows: [
        ...(headers ? [new TableRow({ tableHeader: true, children: headers.map((x, i) => cell(x, i, true)) })] : []),
        ...rows.map((r) => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, i, false)) })),
      ],
    }));
    out.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
    return out;
  };
  return h;
}

function header(text) {
  return new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT,
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '8A949E', space: 4 } },
    children: [new TextRun({ text, size: 18, italics: true, color: '555555' })] })] });
}
function footer() {
  return new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER,
    children: [new TextRun({ children: [PageNumber.CURRENT], size: 20 })] })] });
}

function documentOf({ title, headerText, sections, landscape = false }) {
  const page = landscape
    ? { size: { width: 11906, height: 16838, orientation: 'landscape' }, margin: { top: 1418, bottom: 1418, left: 1418, right: 1418 } }
    : PAGE;
  return new Document({
    creator: 'Tim PTI Politeknik Negeri Medan', title,
    features: { updateFields: true },
    styles: {
      default: { document: { run: { font: FONT, size: 24 } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 28, bold: true, font: FONT, color: '000000' },
          paragraph: { alignment: AlignmentType.CENTER, spacing: { before: 0, after: 300 }, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 24, bold: true, font: FONT, color: GREEN },
          paragraph: { spacing: { before: 260, after: 120 }, keepNext: true, outlineLevel: 1 } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 24, bold: true, font: FONT },
          paragraph: { spacing: { before: 200, after: 80 }, keepNext: true, outlineLevel: 2 } },
      ],
    },
    numbering: { config: [
      { reference: 'bullet', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 567, hanging: 284 } } } }] },
      { reference: 'steps', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 567, hanging: 340 } } } }] },
    ] },
    sections: sections.map((s) => ({
      properties: { page: { ...page, pageNumbers: s.pageStart ? { start: s.pageStart, formatType: s.roman ? NumberFormat.LOWER_ROMAN : NumberFormat.DECIMAL } : undefined } },
      headers: s.noHeader ? undefined : { default: header(headerText) },
      footers: s.noHeader ? undefined : { default: footer() },
      children: s.children,
    })),
  });
}

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

module.exports = { create, documentOf, runs, TITLE, TEAM, GREEN, MONO, FONT };
