// Metode pembayaran
const db = require('../config/db');
const { AppError } = require('../lib/errors');

const JENIS = ['tunai', 'transfer', 'qris', 'kartu', 'ewallet', 'piutang'];

async function listActive() {
  const { rows } = await db.query('SELECT code, name, kind FROM payment_methods WHERE deleted_at IS NULL AND active ORDER BY sort_order, id');
  return rows;
}

async function list() {
  const { rows } = await db.query('SELECT * FROM payment_methods WHERE deleted_at IS NULL ORDER BY sort_order, id');
  return rows;
}

async function save(d) {
  const code = String(d.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9_]{2,20}$/.test(code)) throw new AppError('Kode 2-20 huruf/angka.');
  if (!d.name) throw new AppError('Nama wajib diisi.');
  if (!JENIS.includes(d.kind)) throw new AppError('Jenis tidak valid.');
  const aktif = d.active === 'on' || d.active === '1';
  const urut = parseInt(d.sort_order || '0', 10) || 0;
  if (d.id) {
    // Kode & jenis tidak boleh diubah setelah dipakai, supaya laporan lama tetap benar
    await db.query('UPDATE payment_methods SET name=$1, active=$2, sort_order=$3 WHERE id=$4', [d.name, aktif, urut, d.id]);
  } else {
    try {
      await db.query('INSERT INTO payment_methods (code, name, kind, active, sort_order) VALUES ($1,$2,$3,$4,$5)', [code, d.name, d.kind, aktif, urut]);
    } catch (e) {
      if (e.code === '23505') throw new AppError('Kode sudah dipakai.');
      throw e;
    }
  }
}

module.exports = { JENIS, listActive, list, save };
