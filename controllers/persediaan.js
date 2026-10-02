// Persediaan: stok, kartu stok, penyesuaian, opname, mutasi, stok minimum
const stock = require('../services/stock');
const inventory = require('../services/inventory');
const products = require('../services/products');
const master = require('../services/master');
const { boleh } = require('../lib/akses');
const { AppError } = require('../lib/errors');
const { h, ip, ok, page, rentang, asArray } = require('../lib/http');

exports.stok = h(async (req, res) => {
  const f = { outletId: req.outletId, q: req.query.q, categoryId: req.query.category_id, page: page(req) };
  res.render('persediaan/stok', { title: 'Stok Saat Ini', rows: await stock.current(f), f, kategori: await master.list('kategori'),
    lihatHpp: boleh(req.user.role, 'lihat.hargabeli') });
});

exports.kartu = h(async (req, res) => {
  const { from, to } = rentang(req, 30);
  const p = req.query.product_id ? await products.get(req.query.product_id) : null;
  const rows = p ? await stock.card({ productId: p.id, outletId: req.outletId, from, to }) : [];
  res.render('persediaan/kartu', { title: 'Kartu Stok', p, rows, f: { from, to }, stokSekarang: p ? await stock.qtyOf(p.id, req.outletId) : null });
});

exports.penyesuaian = h(async (req, res) => {
  res.render('persediaan/penyesuaian', { title: 'Penyesuaian Stok', rows: await inventory.listAdjustments({ outletId: req.outletId }) });
});

exports.simpanPenyesuaian = h(async (req, res) => {
  if (!req.body.product_id) throw new AppError('Pilih produk.');
  const arah = req.body.arah === 'kurang' ? '-' : '';
  const qty = String(req.body.qty || '').replace(/^-/, '');
  await inventory.adjust({ outletId: req.outletId, productId: req.body.product_id, qtyChange: arah + qty, reason: req.body.reason, user: req.user, ip: ip(req) });
  ok(res, '/persediaan/penyesuaian', 'Penyesuaian stok tersimpan.');
});

exports.opname = h(async (req, res) => {
  res.render('persediaan/opname', { title: 'Stok Opname', rows: await inventory.listOpnames(req.outletId), kategori: await master.list('kategori') });
});

exports.buatOpname = h(async (req, res) => {
  const id = await inventory.createOpname({ outletId: req.outletId, note: req.body.note, categoryId: req.body.category_id || null, user: req.user });
  ok(res, `/persediaan/opname/${id}`, 'Lembar opname dibuat. Isi hasil hitung fisik.');
});

exports.detailOpname = h(async (req, res) => {
  const o = await inventory.getOpname(req.params.id);
  if (!o) throw new AppError('Opname tidak ditemukan.', 404);
  res.render('persediaan/opname-detail', { title: `Opname ${o.number}`, o, lihatHpp: boleh(req.user.role, 'lihat.hargabeli') });
});

exports.simpanOpname = h(async (req, res) => {
  await inventory.saveCounts(req.params.id, req.body.count || {}, req.body.aksi === 'ajukan');
  ok(res, `/persediaan/opname/${req.params.id}`, req.body.aksi === 'ajukan' ? 'Opname diajukan untuk disetujui.' : 'Hasil hitung disimpan.');
});

exports.setujuiOpname = h(async (req, res) => {
  await inventory.approveOpname({ id: req.params.id, approve: req.body.aksi === 'setujui', user: req.user, ip: ip(req) });
  ok(res, `/persediaan/opname/${req.params.id}`, req.body.aksi === 'setujui' ? 'Opname disetujui, stok disesuaikan.' : 'Opname ditolak.');
});

exports.mutasi = h(async (req, res) => {
  res.render('persediaan/mutasi', { title: 'Mutasi Antar Outlet', rows: await inventory.listTransfers(req.outletId) });
});

exports.simpanMutasi = h(async (req, res) => {
  const id = await inventory.transfer({ fromOutletId: req.outletId, toOutletId: req.body.to_outlet_id, items: asArray(req.body.items),
    note: req.body.note, user: req.user, ip: ip(req) });
  ok(res, `/persediaan/mutasi/${id}`, 'Mutasi tersimpan.');
});

exports.detailMutasi = h(async (req, res) => {
  const t = await inventory.getTransfer(req.params.id);
  if (!t) throw new AppError('Mutasi tidak ditemukan.', 404);
  res.render('persediaan/mutasi-detail', { title: `Mutasi ${t.number}`, t });
});

exports.minimum = h(async (req, res) => {
  res.render('persediaan/minimum', { title: 'Stok Minimum', rows: await stock.lowStock(req.query.semua ? null : req.outletId, 500) });
});
