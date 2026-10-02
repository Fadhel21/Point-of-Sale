// Pembuatan PDF dengan pdfmake (font Roboto bawaan pdfmake, tanpa Puppeteer)
const path = require('path');
const pdfmake = require('pdfmake');
const { rupiah, angka } = require('./money');

const fontDir = path.join(path.dirname(require.resolve('pdfmake/package.json')), 'build', 'fonts', 'Roboto');
pdfmake.setFonts({
  Roboto: {
    normal: path.join(fontDir, 'Roboto-Regular.ttf'),
    bold: path.join(fontDir, 'Roboto-Medium.ttf'),
    italics: path.join(fontDir, 'Roboto-Italic.ttf'),
    bolditalics: path.join(fontDir, 'Roboto-MediumItalic.ttf'),
  },
});
// Larang pengambilan sumber dari internet; hanya font lokal di folder pdfmake
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy((p) => path.resolve(p).startsWith(fontDir));

/** Render docDefinition ke Buffer */
function render(doc) {
  return pdfmake.createPdf({ pageSize: 'A4', pageMargins: [30, 40, 30, 40], defaultStyle: { fontSize: 8 }, ...doc }).getBuffer();
}

function sel(v, tipe) {
  if (v === null || v === undefined) return '';
  if (tipe === 'uang') return rupiah(v);
  if (tipe === 'qty') return angka(v);
  return String(v);
}

/** PDF dari hasil laporan standar { judul, kolom, baris, total, catatan } */
function laporan({ judul, kolom, baris, total, catatan }, { toko, periode, outlet }) {
  const kanan = (k) => ['uang', 'qty', 'angka'].includes(k.tipe);
  const body = [
    kolom.map((k) => ({ text: k.label, bold: true, fillColor: '#eeeeee', alignment: kanan(k) ? 'right' : 'left' })),
    ...baris.map((r) => kolom.map((k) => ({ text: sel(r[k.key], k.tipe), alignment: kanan(k) ? 'right' : 'left' }))),
  ];
  if (Object.keys(total || {}).length) {
    body.push(kolom.map((k, i) => ({ text: i === 0 ? 'TOTAL' : (total[k.key] !== undefined ? sel(total[k.key], k.tipe) : ''), bold: true, alignment: kanan(k) ? 'right' : 'left' })));
  }
  return render({
    pageOrientation: kolom.length > 6 ? 'landscape' : 'portrait',
    content: [
      { text: toko || 'Toko', fontSize: 12, bold: true },
      { text: judul, fontSize: 11, margin: [0, 2, 0, 0] },
      { text: `${outlet ? 'Outlet: ' + outlet + ' · ' : ''}Periode: ${periode}`, color: '#555', margin: [0, 0, 0, 8] },
      { table: { headerRows: 1, widths: kolom.map(() => 'auto'), body }, layout: 'lightHorizontalLines' },
      ...(catatan || []).map(([l, v]) => ({ text: `${l}: ${rupiah(v)}`, bold: true, margin: [0, 6, 0, 0] })),
    ],
    footer: (cur, count) => ({ text: `Halaman ${cur} dari ${count}`, alignment: 'right', margin: [0, 10, 30, 0], fontSize: 7, color: '#777' }),
  });
}

module.exports = { render, laporan };
