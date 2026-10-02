// Pengaturan sistem (hanya Pemilik)
const settings = require('../services/settings');
const outlets = require('../services/outlets');
const usersSvc = require('../services/users');
const payments = require('../services/payments');
const backup = require('../services/backup');
const audit = require('../services/audit');
const { simpanGambar } = require('../services/uploads');
const { toSen, senToStr } = require('../lib/money');
const { AppError } = require('../lib/errors');
const { h, ip, ok, page } = require('../lib/http');

const centang = (v) => [].concat(v || []).includes('1');

async function catat(req, aksi, data) {
  await audit.log(null, { userId: req.user.id, action: `pengaturan.${aksi}`, data, ip: ip(req) });
}

function desimal(v, nama, { min = 0n, max = null } = {}) {
  let n;
  try { n = toSen(v || 0); } catch (_) { throw new AppError(`${nama} tidak valid.`); }
  if (n < min || (max !== null && n > max)) throw new AppError(`${nama} di luar batas.`);
  return senToStr(n).replace(/\.00$/, '');
}

// ----- Profil toko -----
exports.toko = h(async (req, res) => res.render('pengaturan/toko', { title: 'Profil Toko', s: (await settings.get('toko')) || {} }));
exports.simpanToko = h(async (req, res) => {
  const lama = (await settings.get('toko')) || {};
  const logo = req.body.logo_data ? simpanGambar(req.body.logo_data, 'logo') : lama.logo || '';
  const v = { nama: String(req.body.nama || '').trim(), alamat: req.body.alamat || '', telepon: req.body.telepon || '',
    email: req.body.email || '', npwp: req.body.npwp || '', logo };
  if (!v.nama) throw new AppError('Nama toko wajib diisi.');
  await settings.set('toko', v);
  await catat(req, 'toko', v);
  ok(res, '/pengaturan/toko', 'Profil toko tersimpan.');
});

// ----- Outlet -----
exports.outlet = h(async (req, res) => {
  const rows = await outlets.list();
  res.render('pengaturan/outlet', { title: 'Outlet', rows, edit: req.query.edit ? rows.find((o) => String(o.id) === req.query.edit) : null });
});
exports.simpanOutlet = h(async (req, res) => {
  await outlets.save(req.body.id || null, { ...req.body, active: centang(req.body.active) });
  await catat(req, 'outlet', { kode: req.body.code });
  ok(res, '/pengaturan/outlet', 'Outlet tersimpan.');
});
exports.hapusOutlet = h(async (req, res) => {
  await outlets.remove(req.params.id);
  await catat(req, 'outlet.hapus', { id: req.params.id });
  ok(res, '/pengaturan/outlet', 'Outlet dihapus.');
});

// ----- Pengguna -----
exports.pengguna = h(async (req, res) => {
  const rows = await usersSvc.list();
  res.render('pengaturan/pengguna', { title: 'Pengguna & Peran', rows, semuaOutlet: await outlets.list(),
    edit: req.query.edit ? rows.find((u) => String(u.id) === req.query.edit) : null });
});
exports.simpanPengguna = h(async (req, res) => {
  const d = { ...req.body, active: centang(req.body.active) };
  if (req.body.id) {
    if (String(req.body.id) === String(req.user.id) && (d.role !== 'pemilik' || !d.active)) {
      throw new AppError('Tidak bisa menurunkan peran atau menonaktifkan akun sendiri.');
    }
    await usersSvc.update(req.body.id, d);
  } else {
    await usersSvc.create(d);
  }
  await catat(req, 'pengguna', { username: d.username, role: d.role, active: d.active });
  ok(res, '/pengaturan/pengguna', 'Pengguna tersimpan.');
});
exports.hapusPengguna = h(async (req, res) => {
  await usersSvc.remove(req.params.id, req.user.id);
  await catat(req, 'pengguna.hapus', { id: req.params.id });
  ok(res, '/pengaturan/pengguna', 'Pengguna dihapus.');
});

// ----- Metode pembayaran -----
exports.pembayaran = h(async (req, res) => {
  const rows = await payments.list();
  res.render('pengaturan/pembayaran', { title: 'Metode Pembayaran', rows, jenis: payments.JENIS,
    edit: req.query.edit ? rows.find((m) => String(m.id) === req.query.edit) : null });
});
exports.simpanPembayaran = h(async (req, res) => {
  await payments.save({ ...req.body, active: centang(req.body.active) ? '1' : '0' });
  await catat(req, 'pembayaran', { kode: req.body.code });
  ok(res, '/pengaturan/pembayaran', 'Metode pembayaran tersimpan.');
});

// ----- Pajak, pembulatan, poin, stok -----
exports.pajak = h(async (req, res) => {
  const [pajak, pembulatan, poin, stok] = await Promise.all(['pajak', 'pembulatan', 'poin', 'stok'].map((k) => settings.get(k)));
  res.render('pengaturan/pajak', { title: 'Pajak & Pembulatan', pajak: pajak || {}, pembulatan: pembulatan || {}, poin: poin || {}, stok: stok || {} });
});
exports.simpanPajak = h(async (req, res) => {
  const b = req.body;
  const pajak = { aktif: centang(b.pajak_aktif), tarif: desimal(b.tarif, 'Tarif pajak', { max: 10000n }), termasuk: b.termasuk === '1' };
  const mode = ['terdekat', 'atas', 'bawah'].includes(b.mode) ? b.mode : 'terdekat';
  const pembulatan = { aktif: centang(b.bulat_aktif), kelipatan: desimal(b.kelipatan, 'Kelipatan pembulatan', { max: 10000000n }), mode };
  const poin = { aktif: centang(b.poin_aktif), belanjaPerPoin: desimal(b.belanjaPerPoin, 'Belanja per poin'), nilaiPoin: desimal(b.nilaiPoin, 'Nilai poin') };
  const stok = { bolehMinus: centang(b.boleh_minus) };
  for (const [k, v] of Object.entries({ pajak, pembulatan, poin, stok })) await settings.set(k, v);
  await catat(req, 'pajak', { pajak, pembulatan, poin, stok });
  ok(res, '/pengaturan/pajak', 'Pengaturan tersimpan. Berlaku untuk transaksi berikutnya.');
});

// ----- Struk -----
exports.struk = h(async (req, res) => res.render('pengaturan/struk', { title: 'Struk', s: (await settings.get('struk')) || {} }));
exports.simpanStruk = h(async (req, res) => {
  const v = { lebar: req.body.lebar === '80' ? '80' : '58', header: String(req.body.header || '').slice(0, 300),
    footer: String(req.body.footer || '').slice(0, 300), tampilLogo: centang(req.body.tampilLogo) };
  await settings.set('struk', v);
  await catat(req, 'struk', v);
  ok(res, '/pengaturan/struk', 'Pengaturan struk tersimpan.');
});

// ----- Nomor dokumen -----
const JENIS_DOK = { PJ: 'Penjualan (struk)', RJ: 'Retur penjualan', PO: 'Pesanan pembelian', GR: 'Penerimaan barang', RB: 'Retur pembelian',
  ADJ: 'Penyesuaian stok', OP: 'Stok opname', MT: 'Mutasi', BY: 'Biaya operasional' };
exports.nomor = h(async (req, res) => res.render('pengaturan/nomor', { title: 'Nomor Dokumen', s: (await settings.get('nomor')) || {}, jenis: JENIS_DOK }));
exports.simpanNomor = h(async (req, res) => {
  const v = {};
  for (const k of Object.keys(JENIS_DOK)) {
    const t = String(req.body[k] || '').trim();
    if (!/\{N{3,6}\}/.test(t)) throw new AppError(`Format ${JENIS_DOK[k]} harus memuat {NNN} s.d. {NNNNNN}.`);
    if (!/^[A-Za-z0-9\-_/.{}]+$/.test(t) || t.length > 40) throw new AppError(`Format ${JENIS_DOK[k]} berisi karakter tidak valid.`);
    // Struk wajib direset per hari supaya urut per outlet per hari
    if (k === 'PJ' && !/\{(YYMMDD|YYYYMMDD|DD)\}/.test(t)) throw new AppError('Format struk wajib memuat tanggal ({YYMMDD} atau {YYYYMMDD}).');
    v[k] = t;
  }
  await settings.set('nomor', v);
  await catat(req, 'nomor', v);
  ok(res, '/pengaturan/nomor', 'Format nomor tersimpan.');
});

// ----- Cadangan -----
exports.cadangan = h(async (req, res) => {
  let daftar = []; let galat = null;
  try { daftar = backup.list(); } catch (e) { galat = e.message; }
  res.render('pengaturan/cadangan', { title: 'Cadangan Data', s: (await settings.get('cadangan')) || {}, daftar, galat });
});
exports.simpanCadangan = h(async (req, res) => {
  const jam = /^([01]\d|2[0-3]):[0-5]\d$/.test(req.body.jam || '') ? req.body.jam : '23:30';
  const hari = Math.min(Math.max(parseInt(req.body.simpanHari || '14', 10) || 14, 1), 365);
  await settings.set('cadangan', { aktif: centang(req.body.aktif), jam, simpanHari: String(hari) });
  await catat(req, 'cadangan', { jam, hari });
  ok(res, '/pengaturan/cadangan', 'Jadwal cadangan tersimpan. Berlaku setelah worker dijalankan ulang.');
});
exports.jalankanCadangan = h(async (req, res) => {
  const nama = await backup.run();
  await catat(req, 'cadangan.manual', { file: nama });
  ok(res, '/pengaturan/cadangan', `Cadangan dibuat: ${nama}`);
});
exports.unduhCadangan = h(async (req, res) => {
  const p = backup.filePath(req.params.nama);
  await catat(req, 'cadangan.unduh', { file: req.params.nama });
  res.download(p);
});

// ----- Log audit -----
exports.audit = h(async (req, res) => {
  const rows = await audit.list({ from: req.query.from, to: req.query.to, userId: req.query.user_id, action: req.query.action, page: page(req) });
  res.render('pengaturan/audit', { title: 'Log Audit', rows, kasir: await usersSvc.list(), f: req.query });
});
