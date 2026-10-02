// Layar kasir (API JSON untuk komponen Alpine di public/js/kasir.js)
const { v4: uuidv4 } = require('uuid');
const sales = require('../services/sales');
const products = require('../services/products');
const customers = require('../services/customers');
const shifts = require('../services/shifts');
const payments = require('../services/payments');
const master = require('../services/master');
const { h, ip } = require('../lib/http');

exports.index = h(async (req, res) => {
  res.render('kasir', {
    title: 'Kasir',
    shift: await shifts.current(req.user.id),
    metode: await payments.listActive(),
    kategori: await master.list('kategori'),
    kunci: uuidv4(),
    heldId: /^\d+$/.test(req.query.lanjut || '') ? req.query.lanjut : '',
  });
});

exports.cari = h(async (req, res) => {
  const rows = await products.searchForPos(req.query.q, req.outletId);
  const units = await products.unitsFor([...new Set(rows.map((r) => r.id))]);
  res.json({ ok: true, rows: rows.map((r) => ({ ...r, units: units.filter((u) => String(u.product_id) === String(r.id)) })) });
});

exports.grid = h(async (req, res) => {
  const cat = /^\d+$/.test(req.query.kategori || '') ? req.query.kategori : null;
  const rows = await products.gridForPos({ outletId: req.outletId, categoryId: cat });
  const units = await products.unitsFor([...new Set(rows.map((r) => r.id))]);
  res.json({ ok: true, rows: rows.map((r) => ({ ...r, units: units.filter((u) => String(u.product_id) === String(r.id)) })) });
});

exports.cariPelanggan = h(async (req, res) => {
  res.json({ ok: true, rows: await customers.search(String(req.query.q || '')) });
});

exports.hitung = h(async (req, res) => {
  res.json({ ok: true, hasil: await sales.preview(req.body) });
});

exports.bayar = h(async (req, res) => {
  const r = await sales.create({ user: req.user, outletId: req.outletId, input: req.body, ip: ip(req) });
  res.json({ ok: true, ...r, kunci_baru: uuidv4() });
});

exports.tahan = h(async (req, res) => {
  const id = await sales.hold({ user: req.user, outletId: req.outletId, payload: req.body, label: req.body.label });
  res.json({ ok: true, id });
});

exports.ambilDitahan = h(async (req, res) => {
  const hld = await sales.getHeld(req.params.id, req.user);
  const units = await products.unitsFor([...new Set(hld.payload.items.map((i) => i.product_id))]);
  res.json({ ok: true, id: hld.id, payload: hld.payload, units });
});
