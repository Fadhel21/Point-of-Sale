// Autentikasi JWT di signed cookie + otorisasi per izin
const jwt = require('jsonwebtoken');
const config = require('../config');
const users = require('../services/users');
const outlets = require('../services/outlets');
const { boleh, menuUntuk, NAMA_PERAN } = require('../lib/akses');

const COOKIE = 'pos_token';
const COOKIE_OUTLET = 'pos_outlet';

function cookieOpts() {
  return {
    httpOnly: true,
    signed: true,
    sameSite: 'strict',
    secure: config.env === 'production',
    maxAge: config.sessionHours * 3600 * 1000,
  };
}

function login(res, user) {
  const token = jwt.sign({ uid: String(user.id) }, config.jwtSecret, { expiresIn: `${config.sessionHours}h` });
  res.cookie(COOKIE, token, cookieOpts());
}

function logout(res) {
  res.clearCookie(COOKIE);
  res.clearCookie(COOKIE_OUTLET);
}

async function loadUser(req, res, next) {
  try {
    const token = req.signedCookies[COOKIE];
    if (!token) return next();
    let payload;
    try { payload = jwt.verify(token, config.jwtSecret); } catch (_) { logout(res); return next(); }
    const user = await users.findById(payload.uid);
    if (!user || !user.active) { logout(res); return next(); }
    req.user = user;

    // Outlet aktif: pemilik/manajer boleh berpindah outlet, peran lain terikat outlet-nya
    let outletId = user.outlet_id;
    const pilihan = req.signedCookies[COOKIE_OUTLET];
    if (['pemilik', 'manajer'].includes(user.role) && pilihan) outletId = pilihan;
    const daftarOutlet = await outlets.listActive();
    if (!outletId || !daftarOutlet.some((o) => String(o.id) === String(outletId))) {
      outletId = daftarOutlet[0] ? daftarOutlet[0].id : null;
    }
    req.outletId = outletId ? String(outletId) : null;

    res.locals.user = user;
    res.locals.outletId = req.outletId;
    res.locals.outlets = daftarOutlet;
    res.locals.outletAktif = daftarOutlet.find((o) => String(o.id) === req.outletId);
    res.locals.menu = menuUntuk(user.role);
    res.locals.namaPeran = NAMA_PERAN;
    res.locals.boleh = (izin) => boleh(user.role, izin);
    next();
  } catch (err) {
    next(err);
  }
}

function wajibLogin(req, res, next) {
  if (req.user) return next();
  if (req.headers['hx-request']) {
    res.set('HX-Redirect', '/login');
    return res.status(401).end();
  }
  return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
}

/** Middleware: pengguna harus punya salah satu izin */
function izin(...daftar) {
  return (req, res, next) => {
    if (req.user && daftar.some((i) => boleh(req.user.role, i))) return next();
    const err = new Error('Anda tidak punya akses ke halaman ini.');
    err.status = 403;
    err.expose = true;
    next(err);
  };
}

function setOutlet(res, outletId) {
  res.cookie(COOKIE_OUTLET, String(outletId), cookieOpts());
}

module.exports = { login, logout, loadUser, wajibLogin, izin, setOutlet };
