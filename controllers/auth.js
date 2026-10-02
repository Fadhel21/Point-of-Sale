// Masuk, keluar, akun sendiri
const users = require('../services/users');
const outlets = require('../services/outlets');
const audit = require('../services/audit');
const authMw = require('../middleware/auth');
const { h, ip, ok } = require('../lib/http');

// Batas percobaan login sederhana per IP+username (di memori)
const gagal = new Map();
function terkunci(kunci) {
  const g = gagal.get(kunci);
  return g && g.n >= 5 && Date.now() - g.t < 5 * 60 * 1000;
}

const config = require('../config');
const { AKUN_DEMO } = require('../lib/demo');

// Akun demo hanya dikirim ke tampilan bila DEMO_LOGIN=true
const demo = () => (config.demoLogin ? AKUN_DEMO : []);

const amanNext = (n) => (typeof n === 'string' && /^\/(?!\/)/.test(n) ? n : '/');

exports.formLogin = (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { pesan: null, next: amanNext(req.query.next), demo: demo() });
};

exports.login = h(async (req, res) => {
  const { username, password } = req.body;
  const next = amanNext(req.body.next);
  const kunci = `${ip(req)}|${String(username || '').toLowerCase()}`;
  if (terkunci(kunci)) return res.status(429).render('login', { pesan: 'Terlalu banyak percobaan. Coba lagi 5 menit lagi.', next, demo: demo() });
  const u = await users.verify(username, password);
  if (!u) {
    const g = gagal.get(kunci) || { n: 0, t: Date.now() };
    gagal.set(kunci, { n: g.n + 1, t: Date.now() });
    await audit.log(null, { action: 'login.gagal', data: { username }, ip: ip(req) });
    return res.status(401).render('login', { pesan: 'Username atau password salah.', next, demo: demo() });
  }
  gagal.delete(kunci);
  authMw.login(res, u);
  await audit.log(null, { userId: u.id, action: 'login', ip: ip(req) });
  res.redirect(u.role === 'kasir' && next === '/' ? '/kasir' : next);
});

exports.logout = (req, res) => {
  authMw.logout(res);
  res.redirect('/login');
};

exports.gantiOutlet = h(async (req, res) => {
  const o = await outlets.get(req.body.outlet_id);
  if (o) authMw.setOutlet(res, o.id);
  res.redirect(req.get('referer') && new URL(req.get('referer')).host === req.headers.host ? new URL(req.get('referer')).pathname : '/');
});

exports.akun = (req, res) => res.render('akun', { title: 'Akun Saya' });

exports.gantiPassword = h(async (req, res) => {
  if (req.body.password_baru !== req.body.password_ulang) return res.redirect('/akun?err=' + encodeURIComponent('Konfirmasi password tidak sama.'));
  await users.changePassword(req.user.id, req.body.password_lama, req.body.password_baru);
  await audit.log(null, { userId: req.user.id, action: 'password.ganti', ip: ip(req) });
  ok(res, '/akun', 'Password berhasil diganti.');
});
