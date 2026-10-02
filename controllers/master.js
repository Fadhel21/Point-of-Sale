// Master sederhana: kategori, merek, satuan, kategori biaya
const master = require('../services/master');
const { boleh } = require('../lib/akses');
const { AppError } = require('../lib/errors');
const { h, ok } = require('../lib/http');

exports.cekIzin = (req, res, next) => {
  const butuh = req.params.jenis === 'kategori-biaya' ? 'pengeluaran' : 'produk';
  if (!master.JENIS[req.params.jenis]) return next(new AppError('Halaman tidak ditemukan.', 404));
  if (!boleh(req.user.role, butuh)) return next(new AppError('Anda tidak punya akses ke halaman ini.', 403));
  next();
};

exports.index = h(async (req, res) => {
  const j = req.params.jenis;
  const rows = await master.list(j);
  const edit = req.query.edit ? rows.find((r) => String(r.id) === String(req.query.edit)) : null;
  res.render('master', { title: master.JENIS[j].label, jenis: j, label: master.JENIS[j].label, rows, edit });
});

exports.simpan = h(async (req, res) => {
  await master.save(req.params.jenis, req.body.id || null, req.body.name);
  ok(res, `/master/${req.params.jenis}`, 'Tersimpan.');
});

exports.hapus = h(async (req, res) => {
  await master.remove(req.params.jenis, req.params.id);
  ok(res, `/master/${req.params.jenis}`, 'Dihapus.');
});
