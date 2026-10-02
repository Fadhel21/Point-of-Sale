// Utilitas controller
const { boleh } = require('./akses');

/** Bungkus handler async agar kesalahan diteruskan ke penanganan error */
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const ip = (req) => req.ip;
const page = (req) => Math.max(1, parseInt(req.query.page || '1', 10) || 1);

/** Redirect dengan pesan sukses */
function ok(res, url, pesan) {
  const sep = url.includes('?') ? '&' : '?';
  res.redirect(`${url}${sep}ok=${encodeURIComponent(pesan)}`);
}

/** Filter tanggal default: hari ini */
function rentang(req, defaultHari = 0) {
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const now = new Date();
  const awal = new Date(now); awal.setDate(now.getDate() - defaultHari);
  const valid = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null);
  return { from: valid(req.query.from) || iso(awal), to: valid(req.query.to) || iso(now) };
}

/** Kasir hanya boleh melihat datanya sendiri */
function filterPengguna(req) {
  if (boleh(req.user.role, 'transaksi.semua')) return req.query.user_id || null;
  return req.user.id;
}

/** Ubah field form "items[0][qty]" yang sudah di-parse express (extended) menjadi array */
function asArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'object') return Object.keys(v).sort((a, b) => a - b).map((k) => v[k]);
  return [];
}

module.exports = { h, ip, page, ok, rentang, filterPengguna, asArray };
