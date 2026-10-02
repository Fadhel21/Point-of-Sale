// Pembelian: pemasok, PO, penerimaan barang, retur pembelian, hutang
const purchases = require('../services/purchases');
const payments = require('../services/payments');
const stock = require('../services/stock');
const { AppError } = require('../lib/errors');
const { h, ip, ok, asArray } = require('../lib/http');

exports.pemasok = h(async (req, res) => {
  const rows = await purchases.listSuppliers(req.query.q);
  const edit = req.query.edit ? await purchases.getSupplier(req.query.edit) : null;
  res.render('pembelian/pemasok', { title: 'Pemasok', rows, edit, q: req.query.q || '' });
});

exports.simpanPemasok = h(async (req, res) => {
  await purchases.saveSupplier(req.body.id || null, req.body);
  ok(res, '/pembelian/pemasok', 'Pemasok tersimpan.');
});

exports.hapusPemasok = h(async (req, res) => {
  await purchases.removeSupplier(req.params.id);
  ok(res, '/pembelian/pemasok', 'Pemasok dihapus.');
});

exports.po = h(async (req, res) => {
  res.render('pembelian/po', { title: 'Pesanan Pembelian (PO)', rows: await purchases.listPo({ outletId: req.outletId, status: req.query.status }), status: req.query.status || '' });
});

exports.formPo = h(async (req, res) => {
  let awal = [];
  if (req.query.minimum) {
    // Isi otomatis dari produk di bawah stok minimum (qty = kekurangan)
    awal = (await stock.lowStock(req.outletId, 200)).map((r) => ({
      product_id: r.id, name: r.name + (r.variant_name ? ' - ' + r.variant_name : ''), sku: r.sku,
      qty: r.kurang.replace(/\.?0+$/, '') || '1', price: r.cost_price, stok: r.qty,
    }));
  }
  res.render('pembelian/po-form', { title: 'PO Baru', pemasok: await purchases.listSuppliers(), awal });
});

exports.simpanPo = h(async (req, res) => {
  const id = await purchases.createPo({ supplierId: req.body.supplier_id, outletId: req.outletId, items: asArray(req.body.items), note: req.body.note, user: req.user, ip: ip(req) });
  ok(res, `/pembelian/po/${id}`, 'PO tersimpan.');
});

exports.detailPo = h(async (req, res) => {
  const po = await purchases.getPo(req.params.id);
  if (!po) throw new AppError('PO tidak ditemukan.', 404);
  res.render('pembelian/po-detail', { title: `PO ${po.number}`, po });
});

exports.batalPo = h(async (req, res) => {
  await purchases.cancelPo(req.params.id, req.user);
  ok(res, `/pembelian/po/${req.params.id}`, 'PO dibatalkan.');
});

exports.penerimaan = h(async (req, res) => {
  res.render('pembelian/penerimaan', { title: 'Penerimaan Barang', rows: await purchases.listReceipts({ outletId: req.outletId }) });
});

exports.formPenerimaan = h(async (req, res) => {
  let po = null; let awal = [];
  if (req.query.po) {
    po = await purchases.getPo(req.query.po);
    if (!po) throw new AppError('PO tidak ditemukan.', 404);
    awal = po.items.filter((i) => Number(i.sisa) > 0).map((i) => ({
      product_id: i.product_id, name: i.name, sku: i.sku, qty: i.sisa.replace(/\.?0+$/, ''), price: i.price,
    }));
  }
  res.render('pembelian/penerimaan-form', { title: 'Terima Barang', po, awal, pemasok: await purchases.listSuppliers(), metode: await payments.listActive() });
});

exports.simpanPenerimaan = h(async (req, res) => {
  const id = await purchases.receive({ poId: req.body.po_id || null, supplierId: req.body.supplier_id, outletId: req.outletId,
    items: asArray(req.body.items), invoiceNo: req.body.invoice_no, dueDate: req.body.due_date || null, paidNow: req.body.paid_now,
    methodCode: req.body.method_code, note: req.body.note, user: req.user, ip: ip(req) });
  ok(res, `/pembelian/penerimaan/${id}`, 'Barang diterima, stok dan harga pokok diperbarui.');
});

exports.detailPenerimaan = h(async (req, res) => {
  const g = await purchases.getReceipt(req.params.id);
  if (!g) throw new AppError('Penerimaan tidak ditemukan.', 404);
  res.render('pembelian/penerimaan-detail', { title: `Penerimaan ${g.number}`, g, metode: await payments.listActive() });
});

exports.retur = h(async (req, res) => {
  res.render('pembelian/retur', { title: 'Retur Pembelian', rows: await purchases.listReturns(req.outletId) });
});

exports.formRetur = h(async (req, res) => {
  const g = req.query.penerimaan ? await purchases.getReceipt(req.query.penerimaan) : null;
  res.render('pembelian/retur-form', { title: 'Retur Pembelian', g, daftar: g ? [] : await purchases.listReceipts({ outletId: req.outletId }) });
});

exports.simpanRetur = h(async (req, res) => {
  await purchases.createReturn({ receiptId: req.body.receipt_id, items: asArray(req.body.items).filter((i) => i && i.qty), reason: req.body.reason, user: req.user, ip: ip(req) });
  ok(res, '/pembelian/retur', 'Retur pembelian tersimpan.');
});

exports.hutang = h(async (req, res) => {
  res.render('pembelian/hutang', { title: 'Hutang Pemasok', ringkas: await purchases.payableSummary(),
    faktur: await purchases.listReceipts({ outletId: req.outletId, unpaid: true }), metode: await payments.listActive() });
});

exports.bayarHutang = h(async (req, res) => {
  await purchases.payPayable({ receiptId: req.body.receipt_id, amount: req.body.amount, methodCode: req.body.method_code, note: req.body.note, user: req.user, ip: ip(req) });
  ok(res, req.body.kembali === 'detail' ? `/pembelian/penerimaan/${req.body.receipt_id}` : '/pembelian/hutang', 'Pembayaran hutang tercatat.');
});
