// Biaya operasional
const expenses = require('../services/expenses');
const master = require('../services/master');
const { h, ip, ok, rentang } = require('../lib/http');

exports.index = h(async (req, res) => {
  const { from, to } = rentang(req, 30);
  const rows = await expenses.list({ outletId: req.outletId, from, to, categoryId: req.query.category_id });
  const edit = req.query.edit ? await expenses.get(req.query.edit) : null;
  res.render('pengeluaran', { title: 'Biaya Operasional', rows, edit, kategori: await master.list('kategori-biaya'), f: { from, to, category_id: req.query.category_id } });
});

exports.simpan = h(async (req, res) => {
  await expenses.save(req.body.id || null, req.body, { outletId: req.outletId, user: req.user, ip: ip(req) });
  ok(res, '/pengeluaran', 'Biaya tersimpan.');
});

exports.hapus = h(async (req, res) => {
  await expenses.remove(req.params.id, req.user);
  ok(res, '/pengeluaran', 'Biaya dihapus.');
});
