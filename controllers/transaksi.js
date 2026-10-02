// Riwayat penjualan, detail, struk, void, retur, transaksi ditahan
const ejs = require('ejs');
const path = require('path');
const sales = require('../services/sales');
const settings = require('../services/settings');
const payments = require('../services/payments');
const usersSvc = require('../services/users');
const mailer = require('../services/mailer');
const audit = require('../services/audit');
const { boleh } = require('../lib/akses');
const { AppError } = require('../lib/errors');
const { rupiah, angka } = require('../lib/money');
const { h, ip, ok, page, rentang, filterPengguna, asArray } = require('../lib/http');

/** Ambil transaksi dan pastikan pengguna berhak melihatnya */
async function ambil(req) {
  const s = await sales.get(req.params.id);
  if (!s) throw new AppError('Transaksi tidak ditemukan.', 404);
  if (!boleh(req.user.role, 'transaksi.semua') && String(s.user_id) !== String(req.user.id)) {
    throw new AppError('Anda hanya bisa melihat transaksi sendiri.', 403);
  }
  return s;
}

exports.riwayat = h(async (req, res) => {
  const { from, to } = rentang(req);
  const f = { from, to, outletId: req.query.outlet_id || req.outletId, userId: filterPengguna(req), method: req.query.method,
    number: req.query.number, status: req.query.status, page: page(req) };
  const data = await sales.list(f);
  res.render('transaksi/riwayat', { title: 'Riwayat Penjualan', ...data, f,
    metode: await payments.list(), kasir: boleh(req.user.role, 'transaksi.semua') ? await usersSvc.list() : [] });
});

exports.daftarVoid = h(async (req, res) => {
  const { from, to } = rentang(req, 30);
  const data = await sales.list({ from, to, outletId: req.outletId, userId: filterPengguna(req), status: 'void', perPage: 200 });
  res.render('transaksi/void', { title: 'Pembatalan (Void)', ...data, f: { from, to } });
});

exports.detail = h(async (req, res) => {
  const s = await ambil(req);
  res.render('transaksi/detail', { title: `Transaksi ${s.number}`, s, lihatLaba: boleh(req.user.role, 'lihat.laba') });
});

async function dataStruk(s) {
  const [toko, struk] = await Promise.all([settings.get('toko'), settings.get('struk')]);
  return { s, toko: toko || {}, struk: struk || {}, rupiah, angka };
}

exports.struk = h(async (req, res) => {
  const s = await ambil(req);
  if (req.query.cetak && req.query.ulang) {
    await audit.log(null, { userId: req.user.id, action: 'struk.cetak_ulang', entity: 'sales', entityId: s.id, ip: ip(req) });
  }
  res.render('transaksi/struk', { ...(await dataStruk(s)), cetak: !!req.query.cetak, layout: false });
});

exports.email = h(async (req, res) => {
  const s = await ambil(req);
  const to = String(req.body.email || s.customer_email || '').trim();
  const html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'transaksi', 'struk.ejs'),
    { ...(await dataStruk(s)), cetak: false, email: true, waktu: res.locals.waktu });
  await mailer.kirim({ to, subject: `Struk ${s.number}`, html });
  await audit.log(null, { userId: req.user.id, action: 'struk.email', entity: 'sales', entityId: s.id, data: { to }, ip: ip(req) });
  ok(res, `/transaksi/${s.id}`, `Struk dikirim ke ${to}.`);
});

exports.voidSale = h(async (req, res) => {
  const s = await ambil(req);
  await sales.voidSale({ id: s.id, user: req.user, reason: req.body.reason,
    supervisorUsername: req.body.supervisor_username, supervisorPassword: req.body.supervisor_password, ip: ip(req) });
  ok(res, `/transaksi/${s.id}`, 'Transaksi berhasil di-void.');
});

exports.formRetur = h(async (req, res) => {
  const s = await ambil(req);
  res.render('transaksi/retur-form', { title: `Retur ${s.number}`, s, metode: await payments.listActive() });
});

exports.simpanRetur = h(async (req, res) => {
  const s = await ambil(req);
  const items = asArray(req.body.items).filter((i) => i && i.qty);
  const r = await sales.createReturn({ saleId: s.id, user: req.user, outletId: req.outletId, items, reason: req.body.reason,
    refundMethod: req.body.refund_method, supervisorUsername: req.body.supervisor_username,
    supervisorPassword: req.body.supervisor_password, ip: ip(req) });
  ok(res, `/transaksi/retur/${r.id}`, `Retur ${r.number} tersimpan. Kembalikan ${rupiah(r.total)} ke pelanggan.`);
});

exports.daftarRetur = h(async (req, res) => {
  const { from, to } = rentang(req, 30);
  const rows = await sales.listReturns({ from, to, outletId: req.outletId, userId: filterPengguna(req) });
  res.render('transaksi/retur', { title: 'Retur Penjualan', rows, f: { from, to } });
});

exports.detailRetur = h(async (req, res) => {
  const r = await sales.getReturn(req.params.id);
  if (!r) throw new AppError('Retur tidak ditemukan.', 404);
  if (!boleh(req.user.role, 'transaksi.semua') && String(r.user_id) !== String(req.user.id)) throw new AppError('Bukan retur Anda.', 403);
  res.render('transaksi/retur-detail', { title: `Retur ${r.number}`, r });
});

exports.ditahan = h(async (req, res) => {
  const rows = await sales.listHeld({ outletId: req.outletId, userId: boleh(req.user.role, 'transaksi.semua') ? null : req.user.id });
  res.render('transaksi/ditahan', { title: 'Transaksi Ditahan', rows });
});

exports.hapusDitahan = h(async (req, res) => {
  await sales.deleteHeld(req.params.id, req.user);
  ok(res, '/transaksi/ditahan', 'Transaksi ditahan dihapus.');
});
