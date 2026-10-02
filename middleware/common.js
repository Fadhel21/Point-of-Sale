// Middleware umum: proteksi CSRF berbasis Origin, helper tampilan
const dayjs = require('dayjs');
const { rupiah, angka } = require('../lib/money');

/** Tolak request yang mengubah data bila Origin/Referer berasal dari situs lain */
function cekOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  // Browser modern mengirim Sec-Fetch-Site; situs lain tidak bisa memalsukannya.
  const site = req.headers['sec-fetch-site'];
  if (site) {
    if (site === 'same-origin' || site === 'none') return next();
  } else {
    // Cadangan untuk klien tanpa Sec-Fetch-Site. Origin "null" (mis. karena Referrer-Policy)
    // tidak dianggap asing; cookie SameSite=strict tetap melindungi.
    const origin = req.headers.origin && req.headers.origin !== 'null' ? req.headers.origin : null;
    const sumber = origin || req.headers.referer;
    if (!sumber) return next();
    try {
      if (new URL(sumber).host === req.headers.host) return next();
    } catch (_) { /* jatuh ke penolakan */ }
  }
  const err = new Error('Permintaan ditolak (asal tidak sah).');
  err.status = 403;
  err.expose = true;
  next(err);
}

function helperTampilan(req, res, next) {
  res.locals.rupiah = rupiah;
  res.locals.angka = angka;
  // Nilai mentah untuk isi <input>: "12.5000" -> "12.5", "3.0000" -> "3"
  res.locals.nilaiQty = (v) => {
    const s = String(v ?? '0');
    return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
  };
  res.locals.tgl = (v, f = 'DD/MM/YYYY') => (v ? dayjs(v).format(f) : '-');
  res.locals.waktu = (v) => (v ? dayjs(v).format('DD/MM/YYYY HH:mm') : '-');
  res.locals.path = req.path;
  res.locals.query = req.query;
  res.locals.title = 'POS';
  res.locals.flash = req.query.ok ? { jenis: 'ok', pesan: String(req.query.ok) } : (req.query.err ? { jenis: 'error', pesan: String(req.query.err) } : null);
  next();
}

module.exports = { cekOrigin, helperTampilan };
