// Shift & kas
const shifts = require('../services/shifts');
const usersSvc = require('../services/users');
const { boleh } = require('../lib/akses');
const { AppError } = require('../lib/errors');
const { h, ip, ok, page, rentang } = require('../lib/http');

exports.index = h(async (req, res) => {
  const s = await shifts.current(req.user.id);
  const r = s ? await shifts.ringkasan(s.id) : null;
  res.render('shift/index', { title: 'Buka / Tutup Shift', s: r,
    bayar: s ? await shifts.paymentsBreakdown(s.id) : [], kas: s ? await shifts.cashMovements(s.id) : [] });
});

exports.buka = h(async (req, res) => {
  await shifts.open({ userId: req.user.id, outletId: req.outletId, openingCash: req.body.opening_cash, note: req.body.note, ip: ip(req) });
  ok(res, req.body.kembali === '/kasir' ? '/kasir' : '/shift', 'Shift dibuka.');
});

exports.tutup = h(async (req, res) => {
  const id = await shifts.close({ userId: req.user.id, countedCash: req.body.counted_cash, note: req.body.note, ip: ip(req) });
  ok(res, `/shift/${id}?cetak=1`, 'Shift ditutup.');
});

exports.kas = h(async (req, res) => {
  const s = await shifts.current(req.user.id);
  res.render('shift/kas', { title: 'Kas Masuk & Keluar', s, kas: s ? await shifts.cashMovements(s.id) : [],
    r: s ? await shifts.ringkasan(s.id) : null });
});

exports.simpanKas = h(async (req, res) => {
  await shifts.cashMove({ userId: req.user.id, direction: req.body.direction, amount: req.body.amount, note: req.body.note, ip: ip(req) });
  ok(res, '/shift/kas', 'Kas tercatat.');
});

exports.riwayat = h(async (req, res) => {
  const { from, to } = rentang(req, 30);
  const semua = boleh(req.user.role, 'shift.semua');
  const rows = await shifts.list({ outletId: req.outletId, userId: semua ? req.query.user_id : req.user.id, from, to, page: page(req) });
  res.render('shift/riwayat', { title: 'Riwayat Shift', rows, f: { from, to, user_id: req.query.user_id }, kasir: semua ? await usersSvc.list() : [] });
});

exports.detail = h(async (req, res) => {
  const r = await shifts.ringkasan(req.params.id);
  if (!r) throw new AppError('Shift tidak ditemukan.', 404);
  if (!boleh(req.user.role, 'shift.semua') && String(r.user_id) !== String(req.user.id)) throw new AppError('Bukan shift Anda.', 403);
  res.render('shift/detail', { title: 'Laporan Shift', r, bayar: await shifts.paymentsBreakdown(r.id), kas: await shifts.cashMovements(r.id), cetak: !!req.query.cetak });
});
