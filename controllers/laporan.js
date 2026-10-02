// Laporan: tampil, ekspor CSV, ekspor PDF
const reports = require('../services/reports');
const settings = require('../services/settings');
const usersSvc = require('../services/users');
const pdf = require('../lib/pdf');
const { toCsv } = require('../lib/csv');
const { boleh } = require('../lib/akses');
const { AppError } = require('../lib/errors');
const { h, rentang } = require('../lib/http');

exports.tampil = h(async (req, res) => {
  const jenis = req.params.jenis;
  const def = reports.DAFTAR[jenis];
  if (!def) throw new AppError('Laporan tidak ditemukan.', 404);
  if (def.laba && !boleh(req.user.role, 'lihat.laba')) throw new AppError('Anda tidak punya akses ke laporan laba.', 403);

  const { from, to } = rentang(req, jenis === 'penjualan' ? 6 : 0);
  const outletId = req.query.outlet_id === 'semua' ? null : (req.query.outlet_id || req.outletId);
  const f = { from, to, outletId, userId: req.query.user_id || null, grup: req.query.grup,
    lihatLaba: boleh(req.user.role, 'lihat.laba'), lihatHargaBeli: boleh(req.user.role, 'lihat.hargabeli') };
  const hasil = await def.fn(f);
  const periode = jenis === 'stok' ? 'per hari ini' : `${from} s.d. ${to}`;
  const namaOutlet = outletId ? (res.locals.outlets.find((o) => String(o.id) === String(outletId)) || {}).name : 'Semua outlet';

  if (req.query.format === 'csv') {
    const rows = hasil.baris.slice();
    if (Object.keys(hasil.total).length) rows.push({ ...hasil.total, [hasil.kolom[0].key]: 'TOTAL' });
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="laporan-${jenis}-${from}-${to}.csv"`);
    return res.send(toCsv(hasil.kolom.map((k) => ({ key: k.key, label: k.label })), rows));
  }
  if (req.query.format === 'pdf') {
    const toko = (await settings.get('toko')) || {};
    const buf = await pdf.laporan(hasil, { toko: toko.nama, periode, outlet: namaOutlet });
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename="laporan-${jenis}-${from}-${to}.pdf"`);
    return res.send(buf);
  }
  res.render('laporan', { title: hasil.judul, jenis, hasil, f: { ...f, outlet_id: req.query.outlet_id || req.outletId }, periode,
    kasir: await usersSvc.list(), daftar: reports.DAFTAR });
});
