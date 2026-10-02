// Produk: daftar, form (varian, satuan bertingkat, harga grosir), impor/ekspor CSV, label barcode
const products = require('../services/products');
const master = require('../services/master');
const audit = require('../services/audit');
const barcode = require('../lib/barcode');
const { boleh } = require('../lib/akses');
const { AppError } = require('../lib/errors');
const { h, ip, ok, page, asArray } = require('../lib/http');

async function pilihan() {
  const [kategori, merek, satuan] = await Promise.all([master.list('kategori'), master.list('merek'), master.list('satuan')]);
  return { kategori, merek, satuan };
}

exports.index = h(async (req, res) => {
  const f = { q: req.query.q, categoryId: req.query.category_id, brandId: req.query.brand_id, active: req.query.active, page: page(req), outletId: req.outletId };
  const { rows, total } = await products.list(f);
  res.render('produk/index', { title: 'Daftar Produk', rows, total, f, ...(await pilihan()), lihatHpp: boleh(req.user.role, 'lihat.hargabeli') });
});

exports.form = h(async (req, res) => {
  let p = null; let parent = null;
  if (req.params.id) {
    p = await products.get(req.params.id);
    if (!p) throw new AppError('Produk tidak ditemukan.', 404);
  } else if (req.query.parent) {
    parent = await products.get(req.query.parent);
  }
  res.render('produk/form', { title: p ? `Ubah ${p.name}` : 'Produk Baru', p, parent, ...(await pilihan()), lihatHpp: boleh(req.user.role, 'lihat.hargabeli') });
});

exports.simpan = h(async (req, res) => {
  // Form selalu mengirim daftar satuan & grosir lengkap; kosong berarti semua dihapus.
  // Checkbox aktif: input tersembunyi "0" + checkbox "1" -> aktif bila ada "1".
  const d = { ...req.body, units: asArray(req.body.units), wholesale: asArray(req.body.wholesale),
    active: [].concat(req.body.active || []).includes('1') };
  const id = await products.save(req.params.id || null, d, { canSeeCost: boleh(req.user.role, 'lihat.hargabeli') });
  await audit.log(null, { userId: req.user.id, action: req.params.id ? 'produk.ubah' : 'produk.buat', entity: 'products', entityId: id,
    data: { sku: d.sku, harga_jual: d.sell_price }, ip: ip(req) });
  ok(res, `/produk/${id}`, 'Produk tersimpan.');
});

exports.hapus = h(async (req, res) => {
  await products.remove(req.params.id);
  await audit.log(null, { userId: req.user.id, action: 'produk.hapus', entity: 'products', entityId: req.params.id, ip: ip(req) });
  ok(res, '/produk', 'Produk dihapus.');
});

exports.ekspor = h(async (req, res) => {
  const csv = await products.exportCsv({ includeCost: boleh(req.user.role, 'lihat.hargabeli') });
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="produk.csv"');
  res.send(csv);
});

exports.formImpor = (req, res) => res.render('produk/impor', { title: 'Impor Produk CSV' });

exports.impor = h(async (req, res) => {
  const r = await products.importCsv(req.body.csv || '', { canSeeCost: boleh(req.user.role, 'lihat.hargabeli') });
  await audit.log(null, { userId: req.user.id, action: 'produk.impor', data: r, ip: ip(req) });
  ok(res, '/produk', `Impor selesai: ${r.baru} produk baru, ${r.ubah} diperbarui.`);
});

exports.label = h(async (req, res) => {
  const { rows } = await products.list({ q: req.query.q, active: '1', perPage: 200 });
  // jumlah[id] = jumlah label per produk
  const jumlah = req.query.jumlah || {};
  const label = [];
  for (const p of rows) {
    const n = Math.min(parseInt(jumlah[p.id] || '0', 10) || 0, 500);
    const kode = p.barcode || p.sku;
    let gambar = '';
    try { gambar = barcode.svg(kode); } catch (_) { continue; }
    for (let i = 0; i < n; i++) label.push({ p, kode, gambar });
  }
  res.render('produk/label', { title: 'Cetak Label Barcode', rows, label, q: req.query.q || '', jumlah });
});

exports.cariJson = h(async (req, res) => {
  const { rows } = await products.list({ q: req.query.q, active: '1', perPage: 20, outletId: req.outletId });
  const lihat = boleh(req.user.role, 'lihat.hargabeli');
  res.json({ ok: true, rows: rows.map((p) => ({ id: p.id, name: p.name + (p.variant_name ? ' - ' + p.variant_name : ''), sku: p.sku,
    sell_price: p.sell_price, cost_price: lihat ? p.cost_price : null, stok: p.stok, unit_name: p.unit_name })) });
});
