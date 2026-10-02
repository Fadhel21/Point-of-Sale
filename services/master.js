// Master data sederhana (hanya kolom nama): kategori, merek, satuan, kategori biaya
const db = require('../config/db');
const { AppError } = require('../lib/errors');

// Hanya tabel di daftar ini yang boleh diakses (nama tabel tidak pernah dari input pengguna)
const JENIS = {
  kategori: { table: 'categories', label: 'Kategori', pakai: 'SELECT 1 FROM products WHERE category_id=$1 AND deleted_at IS NULL LIMIT 1' },
  merek: { table: 'brands', label: 'Merek', pakai: 'SELECT 1 FROM products WHERE brand_id=$1 AND deleted_at IS NULL LIMIT 1' },
  satuan: { table: 'units', label: 'Satuan', pakai: 'SELECT 1 FROM products WHERE unit_id=$1 AND deleted_at IS NULL UNION ALL SELECT 1 FROM product_units WHERE unit_id=$1 AND deleted_at IS NULL LIMIT 1' },
  'kategori-biaya': { table: 'expense_categories', label: 'Kategori Biaya', pakai: 'SELECT 1 FROM expenses WHERE category_id=$1 AND deleted_at IS NULL LIMIT 1' },
};

function jenis(j) {
  const x = JENIS[j];
  if (!x) throw new AppError('Jenis data tidak dikenal.', 404);
  return x;
}

async function list(j) {
  const { table } = jenis(j);
  const { rows } = await db.query(`SELECT id, name FROM ${table} WHERE deleted_at IS NULL ORDER BY name`);
  return rows;
}

async function save(j, id, name) {
  const { table } = jenis(j);
  name = String(name || '').trim();
  if (!name) throw new AppError('Nama wajib diisi.');
  const dup = await db.query(`SELECT id FROM ${table} WHERE lower(name)=lower($1) AND deleted_at IS NULL AND id <> COALESCE($2::bigint, 0)`, [name, id || null]);
  if (dup.rows[0]) throw new AppError('Nama sudah ada.');
  if (id) await db.query(`UPDATE ${table} SET name=$1 WHERE id=$2`, [name, id]);
  else await db.query(`INSERT INTO ${table} (name) VALUES ($1)`, [name]);
}

async function remove(j, id) {
  const x = jenis(j);
  const { rows } = await db.query(x.pakai, [id]);
  if (rows.length) throw new AppError(`${x.label} masih dipakai, tidak bisa dihapus.`);
  await db.query(`UPDATE ${x.table} SET deleted_at=now() WHERE id=$1`, [id]);
}

module.exports = { JENIS, list, save, remove };
