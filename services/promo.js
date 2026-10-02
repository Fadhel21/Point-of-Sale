// Promo: diskon per produk/kategori, voucher, harga grosir
const db = require('../config/db');
const { AppError } = require('../lib/errors');
const { toSen, toQty, senToStr, qtyToStr } = require('../lib/money');

function cekPeriode(d) {
  if (!d.starts_at || !d.ends_at) throw new AppError('Tanggal mulai dan selesai wajib diisi.');
  if (new Date(d.ends_at) < new Date(d.starts_at)) throw new AppError('Tanggal selesai harus setelah tanggal mulai.');
}

function cekNilai(tipe, nilai) {
  if (!['persen', 'nominal'].includes(tipe)) throw new AppError('Jenis diskon tidak valid.');
  const v = toSen(nilai);
  if (v <= 0n) throw new AppError('Nilai diskon harus lebih dari 0.');
  if (tipe === 'persen' && v > 10000n) throw new AppError('Diskon persen maksimal 100.');
  return senToStr(v);
}

const aktif = (v) => v === 'on' || v === true || v === '1';

async function listDiscounts() {
  const { rows } = await db.query(
    `SELECT d.*, p.name AS product_name, c.name AS category_name,
            (now() BETWEEN d.starts_at AND d.ends_at AND d.active) AS berlaku
     FROM discounts d LEFT JOIN products p ON p.id = d.product_id LEFT JOIN categories c ON c.id = d.category_id
     WHERE d.deleted_at IS NULL ORDER BY d.starts_at DESC`);
  return rows;
}

async function getDiscount(id) {
  const { rows } = await db.query('SELECT * FROM discounts WHERE id=$1 AND deleted_at IS NULL', [id]);
  return rows[0];
}

async function saveDiscount(id, d) {
  if (!d.name) throw new AppError('Nama diskon wajib diisi.');
  if (!d.product_id && !d.category_id) throw new AppError('Pilih produk atau kategori.');
  cekPeriode(d);
  const nilai = cekNilai(d.disc_type, d.value);
  const p = [d.name, d.product_id || null, d.product_id ? null : d.category_id, d.disc_type, nilai, d.starts_at, d.ends_at, aktif(d.active)];
  if (id) await db.query('UPDATE discounts SET name=$1, product_id=$2, category_id=$3, disc_type=$4, value=$5, starts_at=$6, ends_at=$7, active=$8 WHERE id=$9', [...p, id]);
  else await db.query('INSERT INTO discounts (name, product_id, category_id, disc_type, value, starts_at, ends_at, active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', p);
}

async function listVouchers() {
  const { rows } = await db.query(
    `SELECT v.*, (now() BETWEEN v.starts_at AND v.ends_at AND v.active AND v.used < v.quota) AS berlaku
     FROM vouchers v WHERE deleted_at IS NULL ORDER BY v.id DESC`);
  return rows;
}

async function getVoucher(id) {
  const { rows } = await db.query('SELECT * FROM vouchers WHERE id=$1 AND deleted_at IS NULL', [id]);
  return rows[0];
}

async function saveVoucher(id, d) {
  const code = String(d.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,40}$/.test(code)) throw new AppError('Kode voucher 3-40 karakter (huruf, angka, - atau _).');
  cekPeriode(d);
  const nilai = cekNilai(d.disc_type, d.value);
  const quota = parseInt(d.quota, 10);
  if (!Number.isInteger(quota) || quota < 1) throw new AppError('Kuota minimal 1.');
  const minBeli = toSen(d.min_purchase || 0); const maks = toSen(d.max_discount || 0);
  if (minBeli < 0n || maks < 0n) throw new AppError('Nilai tidak boleh negatif.');
  const p = [code, d.disc_type, nilai, senToStr(maks), senToStr(minBeli), quota, d.starts_at, d.ends_at, aktif(d.active)];
  try {
    if (id) {
      const lama = await getVoucher(id);
      if (lama && quota < lama.used) throw new AppError(`Kuota tidak boleh kurang dari yang sudah terpakai (${lama.used}).`);
      await db.query('UPDATE vouchers SET code=$1, disc_type=$2, value=$3, max_discount=$4, min_purchase=$5, quota=$6, starts_at=$7, ends_at=$8, active=$9 WHERE id=$10', [...p, id]);
    } else {
      await db.query('INSERT INTO vouchers (code, disc_type, value, max_discount, min_purchase, quota, starts_at, ends_at, active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', p);
    }
  } catch (e) {
    if (e.code === '23505') throw new AppError('Kode voucher sudah ada.');
    throw e;
  }
}

async function listWholesale() {
  const { rows } = await db.query(
    `SELECT w.*, p.name AS product_name, p.sku, p.sell_price FROM wholesale_prices w JOIN products p ON p.id = w.product_id
     WHERE w.deleted_at IS NULL AND p.deleted_at IS NULL ORDER BY p.name, w.min_qty`);
  return rows;
}

async function saveWholesale(d) {
  if (!d.product_id) throw new AppError('Pilih produk.');
  const q = toQty(d.min_qty); const pr = toSen(d.price);
  if (q <= 0n) throw new AppError('Minimal qty harus lebih dari 0.');
  if (pr <= 0n) throw new AppError('Harga harus lebih dari 0.');
  await db.query('INSERT INTO wholesale_prices (product_id, min_qty, price) VALUES ($1,$2,$3)', [d.product_id, qtyToStr(q), senToStr(pr)]);
}

const TABEL = { diskon: 'discounts', voucher: 'vouchers', grosir: 'wholesale_prices' };
async function remove(jenis, id) {
  const t = TABEL[jenis];
  if (!t) throw new AppError('Jenis promo tidak dikenal.', 404);
  await db.query(`UPDATE ${t} SET deleted_at=now() WHERE id=$1`, [id]);
}

module.exports = { listDiscounts, getDiscount, saveDiscount, listVouchers, getVoucher, saveVoucher, listWholesale, saveWholesale, remove };
