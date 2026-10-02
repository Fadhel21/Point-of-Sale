// Pelanggan, member & poin, piutang
const customers = require('../services/customers');
const payments = require('../services/payments');
const { boleh } = require('../lib/akses');
const { AppError } = require('../lib/errors');
const { h, ip, ok, page } = require('../lib/http');

exports.index = h(async (req, res) => {
  const rows = await customers.list({ q: req.query.q, page: page(req) });
  const edit = req.query.edit ? await customers.get(req.query.edit) : null;
  res.render('pelanggan/index', { title: 'Daftar Pelanggan', rows, edit, q: req.query.q || '', judul: 'Daftar Pelanggan', mode: 'semua' });
});

exports.member = h(async (req, res) => {
  const rows = await customers.list({ q: req.query.q, member: true, page: page(req) });
  res.render('pelanggan/index', { title: 'Member & Poin', rows, edit: null, q: req.query.q || '', judul: 'Member & Poin', mode: 'member' });
});

exports.piutang = h(async (req, res) => {
  const rows = await customers.list({ q: req.query.q, piutang: true, page: page(req), perPage: 200 });
  res.render('pelanggan/index', { title: 'Piutang Pelanggan', rows, edit: null, q: req.query.q || '', judul: 'Piutang Pelanggan', mode: 'piutang' });
});

exports.simpan = h(async (req, res) => {
  const id = await customers.save(req.params.id || null, req.body);
  ok(res, req.params.id ? `/pelanggan/${id}` : '/pelanggan', 'Pelanggan tersimpan.');
});

exports.hapus = h(async (req, res) => {
  await customers.remove(req.params.id);
  ok(res, '/pelanggan', 'Pelanggan dihapus.');
});

exports.detail = h(async (req, res) => {
  const c = await customers.get(req.params.id);
  if (!c) throw new AppError('Pelanggan tidak ditemukan.', 404);
  const lihatPiutang = boleh(req.user.role, 'pelanggan.piutang');
  res.render('pelanggan/detail', { title: c.name, c, riwayat: await customers.history(c.id), poin: await customers.pointLedger(c.id),
    piutang: lihatPiutang ? await customers.receivableLedger(c.id) : [], lihatPiutang, metode: await payments.listActive() });
});

exports.bayar = h(async (req, res) => {
  await customers.payReceivable({ customerId: req.params.id, amount: req.body.amount, methodCode: req.body.method_code, note: req.body.note, user: req.user, ip: ip(req) });
  ok(res, `/pelanggan/${req.params.id}`, 'Pelunasan piutang tercatat.');
});

exports.poin = h(async (req, res) => {
  const tanda = req.body.arah === 'kurang' ? '-' : '';
  await customers.adjustPoints({ customerId: req.params.id, points: tanda + String(req.body.points || '').replace(/^-/, ''), note: req.body.note, user: req.user, ip: ip(req) });
  ok(res, `/pelanggan/${req.params.id}`, 'Poin disesuaikan.');
});
