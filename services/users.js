// Pengguna & autentikasi
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { AppError } = require('../lib/errors');

const DUMMY_HASH = bcrypt.hashSync('tidak-dipakai', 10);
const KOLOM = 'u.id, u.name, u.username, u.email, u.role, u.outlet_id, u.active, u.created_at, o.name AS outlet_name';

async function verify(username, password) {
  const { rows } = await db.query(
    `SELECT u.*, o.name AS outlet_name FROM users u LEFT JOIN outlets o ON o.id = u.outlet_id
     WHERE lower(u.username) = lower($1) AND u.deleted_at IS NULL`, [username]);
  const u = rows[0];
  // Tetap jalankan bcrypt walau user tidak ada supaya waktu respons tidak membocorkan info
  const ok = await bcrypt.compare(password || '', u ? u.password_hash : DUMMY_HASH);
  if (!u || !ok || !u.active) return null;
  delete u.password_hash;
  return u;
}

/** Verifikasi persetujuan supervisor (pemilik/manajer) lewat username+password */
async function verifySupervisor(username, password) {
  const u = await verify(username, password);
  if (!u || !['pemilik', 'manajer'].includes(u.role)) {
    throw new AppError('Persetujuan supervisor gagal: username/password salah atau bukan supervisor.');
  }
  return u;
}

async function findById(id) {
  const { rows } = await db.query(
    `SELECT ${KOLOM} FROM users u LEFT JOIN outlets o ON o.id = u.outlet_id WHERE u.id = $1 AND u.deleted_at IS NULL`, [id]);
  return rows[0] || null;
}

async function list() {
  const { rows } = await db.query(
    `SELECT ${KOLOM} FROM users u LEFT JOIN outlets o ON o.id = u.outlet_id WHERE u.deleted_at IS NULL ORDER BY u.name`);
  return rows;
}

function validasi(d, baru) {
  if (!d.name || !d.username) throw new AppError('Nama dan username wajib diisi.');
  if (!['pemilik', 'manajer', 'kasir', 'gudang'].includes(d.role)) throw new AppError('Peran tidak valid.');
  if (baru && (!d.password || d.password.length < 6)) throw new AppError('Password minimal 6 karakter.');
  if (!baru && d.password && d.password.length < 6) throw new AppError('Password minimal 6 karakter.');
}

async function create(d) {
  validasi(d, true);
  const hash = await bcrypt.hash(d.password, 10);
  try {
    const { rows } = await db.query(
      `INSERT INTO users (name, username, email, password_hash, role, outlet_id, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [d.name, d.username, d.email || null, hash, d.role, d.outlet_id || null, d.active !== false]);
    return rows[0].id;
  } catch (e) {
    if (e.code === '23505') throw new AppError('Username sudah dipakai.');
    throw e;
  }
}

async function update(id, d) {
  validasi(d, false);
  const p = [d.name, d.username, d.email || null, d.role, d.outlet_id || null, d.active !== false, id];
  let setPass = '';
  if (d.password) { p.push(await bcrypt.hash(d.password, 10)); setPass = `, password_hash = $${p.length}`; }
  try {
    await db.query(
      `UPDATE users SET name=$1, username=$2, email=$3, role=$4, outlet_id=$5, active=$6 ${setPass}
       WHERE id=$7 AND deleted_at IS NULL`, p);
  } catch (e) {
    if (e.code === '23505') throw new AppError('Username sudah dipakai.');
    throw e;
  }
}

async function remove(id, currentUserId) {
  if (String(id) === String(currentUserId)) throw new AppError('Tidak bisa menghapus akun sendiri.');
  await db.query('UPDATE users SET deleted_at = now(), active = false WHERE id = $1', [id]);
}

async function changePassword(id, oldPass, newPass) {
  const { rows } = await db.query('SELECT password_hash FROM users WHERE id=$1', [id]);
  if (!rows[0] || !(await bcrypt.compare(oldPass || '', rows[0].password_hash))) throw new AppError('Password lama salah.');
  if (!newPass || newPass.length < 6) throw new AppError('Password baru minimal 6 karakter.');
  await db.query('UPDATE users SET password_hash=$1 WHERE id=$2', [await bcrypt.hash(newPass, 10), id]);
}

async function count() {
  const { rows } = await db.query('SELECT count(*)::int AS n FROM users WHERE deleted_at IS NULL');
  return rows[0].n;
}

module.exports = { verify, verifySupervisor, findById, list, create, update, remove, changePassword, count };
