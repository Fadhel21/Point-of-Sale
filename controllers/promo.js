// Promo: diskon, voucher, harga grosir
const promo = require('../services/promo');
const master = require('../services/master');
const products = require('../services/products');
const { h, ok } = require('../lib/http');

exports.diskon = h(async (req, res) => {
  const edit = req.query.edit ? await promo.getDiscount(req.query.edit) : null;
  const produkEdit = edit && edit.product_id ? await products.get(edit.product_id) : null;
  res.render('promo/diskon', { title: 'Diskon', rows: await promo.listDiscounts(), edit, produkEdit, kategori: await master.list('kategori') });
});

exports.simpanDiskon = h(async (req, res) => {
  await promo.saveDiscount(req.body.id || null, req.body);
  ok(res, '/promo/diskon', 'Diskon tersimpan.');
});

exports.voucher = h(async (req, res) => {
  const edit = req.query.edit ? await promo.getVoucher(req.query.edit) : null;
  res.render('promo/voucher', { title: 'Voucher', rows: await promo.listVouchers(), edit });
});

exports.simpanVoucher = h(async (req, res) => {
  await promo.saveVoucher(req.body.id || null, req.body);
  ok(res, '/promo/voucher', 'Voucher tersimpan.');
});

exports.grosir = h(async (req, res) => {
  res.render('promo/grosir', { title: 'Harga Grosir / Bertingkat', rows: await promo.listWholesale() });
});

exports.simpanGrosir = h(async (req, res) => {
  await promo.saveWholesale(req.body);
  ok(res, '/promo/grosir', 'Harga grosir tersimpan.');
});

exports.hapus = h(async (req, res) => {
  await promo.remove(req.params.jenis, req.params.id);
  ok(res, `/promo/${req.params.jenis}`, 'Dihapus.');
});
