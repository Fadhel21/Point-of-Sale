// Aplikasi web POS (Express + EJS + HTMX)
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const config = require('./config');
const { loadUser } = require('./middleware/auth');
const { cekOrigin, helperTampilan } = require('./middleware/common');
const routes = require('./routes');

const app = express();
app.disable('x-powered-by');
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 'loopback');

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // Alpine.js versi standar membutuhkan 'unsafe-eval' untuk mengevaluasi ekspresi x-data
      scriptSrc: ["'self'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      upgradeInsecureRequests: null,
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '7d' }));
app.use('/uploads', express.static(config.uploadDir, { maxAge: '1d' }));
app.use(express.urlencoded({ extended: true, limit: '6mb' }));
app.use(express.json({ limit: '6mb' }));
app.use(cookieParser(config.cookieSecret));
app.use(cekOrigin);
app.use(helperTampilan);
app.use(loadUser);
app.use(routes);

// 404
app.use((req, res) => {
  res.status(404).render('error', { title: 'Tidak ditemukan', pesan: 'Halaman tidak ditemukan.', status: 404 });
});

// Penanganan kesalahan terpusat
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  const pesan = err.expose ? err.message : 'Terjadi kesalahan pada server. Silakan coba lagi.';
  if (status >= 500) console.error(err);
  if (req.headers['hx-request'] || req.xhr || (req.headers.accept || '').includes('application/json')) {
    if ((req.headers.accept || '').includes('application/json')) return res.status(status).json({ ok: false, pesan });
    res.set('HX-Retarget', '#notif');
    res.set('HX-Reswap', 'innerHTML');
    return res.status(200).render('partials/notif', { jenis: 'error', pesan });
  }
  res.status(status).render('error', { title: 'Kesalahan', pesan, status });
});

module.exports = app;
