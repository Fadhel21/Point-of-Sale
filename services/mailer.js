// Pengiriman email (struk, peringatan stok)
const nodemailer = require('nodemailer');
const config = require('../config');
const { AppError } = require('../lib/errors');

let transporter = null;

function siap() {
  return !!(config.smtp.host && config.smtp.from);
}

function transport() {
  if (!siap()) throw new AppError('Email belum dikonfigurasi (isi SMTP_HOST dan SMTP_FROM di .env).');
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    });
  }
  return transporter;
}

async function kirim({ to, subject, html, text, attachments }) {
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new AppError('Alamat email tidak valid.');
  await transport().sendMail({ from: config.smtp.from, to, subject, html, text, attachments });
}

module.exports = { kirim, siap };
