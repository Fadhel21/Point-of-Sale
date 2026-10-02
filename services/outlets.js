// Outlet
const db = require('../config/db');
const { AppError } = require('../lib/errors');

async function listActive() {
  const { rows } = await db.query('SELECT id, code, name FROM outlets WHERE deleted_at IS NULL AND active ORDER BY id');
  return rows;
}

async function list() {
  const { rows } = await db.query('SELECT * FROM outlets WHERE deleted_at IS NULL ORDER BY id');
  return rows;
}

async function get(id) {
  const { rows } = await db.query('SELECT * FROM outlets WHERE id=$1 AND deleted_at IS NULL', [id]);
  return rows[0] || null;
}

function validasi(d) {
  if (!d.code || !/^[A-Za-z0-9]{1,10}$/.test(d.code)) throw new AppError('Kode outlet 1-10 huruf/angka.');
  if (!d.name) throw new AppError('Nama outlet wajib diisi.');
}

async function save(id, d) {
  validasi(d);
  const p = [d.code.toUpperCase(), d.name, d.address || null, d.phone || null, d.active !== false];
  try {
    if (id) {
      await db.query('UPDATE outlets SET code=$1, name=$2, address=$3, phone=$4, active=$5 WHERE id=$6', [...p, id]);
      return id;
    }
    const { rows } = await db.query(
      'INSERT INTO outlets (code, name, address, phone, active) VALUES ($1,$2,$3,$4,$5) RETURNING id', p);
    return rows[0].id;
  } catch (e) {
    if (e.code === '23505') throw new AppError('Kode outlet sudah dipakai.');
    throw e;
  }
}

async function remove(id) {
  const { rows } = await db.query('SELECT count(*)::int n FROM outlets WHERE deleted_at IS NULL AND id <> $1', [id]);
  if (!rows[0].n) throw new AppError('Minimal harus ada satu outlet.');
  await db.query('UPDATE outlets SET deleted_at=now(), active=false WHERE id=$1', [id]);
}

module.exports = { listActive, list, get, save, remove };
