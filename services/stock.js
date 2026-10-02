// Mutasi stok. SEMUA perubahan stok wajib lewat move() supaya kartu stok selalu lengkap.
const db = require('../config/db');
const settings = require('./settings');
const { AppError } = require('../lib/errors');
const { qtyToStr, toQty, angka } = require('../lib/money');

async function bolehMinus(client) {
  const s = await settings.get('stok', client);
  return !!(s && s.bolehMinus);
}

/**
 * Ubah stok satu produk di satu outlet (harus di dalam transaksi).
 * qtyChange: BigInt dalam 1/10000 satuan dasar (negatif = keluar).
 */
async function move(client, { productId, outletId, qtyChange, unitCost = '0', refType, refId, refNo, note, userId, cekMinus = true }) {
  if (typeof qtyChange !== 'bigint') throw new Error('qtyChange harus BigInt');
  if (qtyChange === 0n) return null;
  const { rows } = await client.query(
    `INSERT INTO stocks (product_id, outlet_id, qty) VALUES ($1, $2, $3)
     ON CONFLICT (product_id, outlet_id) DO UPDATE SET qty = stocks.qty + EXCLUDED.qty
     RETURNING qty`,
    [productId, outletId, qtyToStr(qtyChange)]
  );
  const after = rows[0].qty;
  if (cekMinus && qtyChange < 0n && toQty(after) < 0n && !(await bolehMinus(client))) {
    const { rows: p } = await client.query('SELECT name FROM products WHERE id=$1', [productId]);
    const sisa = toQty(after) - qtyChange;
    throw new AppError(`Stok "${p[0] ? p[0].name : productId}" tidak cukup (tersedia ${angka(sisa)}).`);
  }
  await client.query(
    `INSERT INTO stock_moves (product_id, outlet_id, qty_change, qty_after, unit_cost, ref_type, ref_id, ref_no, note, user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [productId, outletId, qtyToStr(qtyChange), after, unitCost, refType, refId || null, refNo || null, note || null, userId || null]
  );
  return after;
}

/**
 * Perbarui harga pokok rata-rata tertimbang saat barang masuk dengan harga beli tertentu.
 * Dipanggil SEBELUM move() penerimaan. Stok negatif dianggap nol.
 */
async function updateAverageCost(client, productId, qtyIn, priceStr) {
  await client.query(
    `UPDATE products p SET cost_price = ROUND(
        (GREATEST(s.total, 0) * p.cost_price + $2::numeric * $3::numeric) / NULLIF(GREATEST(s.total, 0) + $2::numeric, 0), 2)
     FROM (SELECT COALESCE(SUM(qty), 0) AS total FROM stocks WHERE product_id = $1) s
     WHERE p.id = $1`,
    [productId, qtyToStr(qtyIn), priceStr]
  );
}

async function current({ outletId, q, categoryId, onlyLow, page = 1, perPage = 50 }) {
  const p = [outletId];
  const w = ['p.deleted_at IS NULL', 'p.active'];
  if (q) { p.push(`%${q}%`); w.push(`(p.name ILIKE $${p.length} OR p.sku ILIKE $${p.length} OR p.barcode = $${p.length})`); }
  if (categoryId) { p.push(categoryId); w.push(`p.category_id = $${p.length}`); }
  if (onlyLow) w.push('COALESCE(s.qty,0) <= p.min_stock AND p.min_stock > 0');
  p.push(perPage, (page - 1) * perPage);
  const { rows } = await db.query(
    `SELECT p.id, p.sku, p.name, p.variant_name, p.min_stock, p.cost_price, u.name AS unit_name, c.name AS category_name,
            COALESCE(s.qty, 0) AS qty, ROUND(COALESCE(s.qty, 0) * p.cost_price, 2) AS nilai
     FROM products p
     LEFT JOIN stocks s ON s.product_id = p.id AND s.outlet_id = $1
     LEFT JOIN units u ON u.id = p.unit_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE ${w.join(' AND ')}
     ORDER BY p.name LIMIT $${p.length - 1} OFFSET $${p.length}`, p);
  return rows;
}

async function qtyOf(productId, outletId, client) {
  const { rows } = await (client || db).query('SELECT qty FROM stocks WHERE product_id=$1 AND outlet_id=$2', [productId, outletId]);
  return rows[0] ? rows[0].qty : '0';
}

async function card({ productId, outletId, from, to }) {
  const p = [productId, outletId];
  const w = ['m.product_id = $1', 'm.outlet_id = $2', 'm.deleted_at IS NULL'];
  if (from) { p.push(from); w.push(`m.created_at >= $${p.length}::date`); }
  if (to) { p.push(to); w.push(`m.created_at < $${p.length}::date + 1`); }
  const { rows } = await db.query(
    `SELECT m.*, u.name AS user_name FROM stock_moves m LEFT JOIN users u ON u.id = m.user_id
     WHERE ${w.join(' AND ')} ORDER BY m.id`, p);
  return rows;
}

async function lowStock(outletId, limit = 100) {
  const { rows } = await db.query(
    `SELECT p.id, p.sku, p.name, p.variant_name, p.min_stock, COALESCE(s.qty,0) AS qty, p.min_stock - COALESCE(s.qty,0) AS kurang,
            p.cost_price, o.name AS outlet_name, o.id AS outlet_id
     FROM products p CROSS JOIN outlets o
     LEFT JOIN stocks s ON s.product_id = p.id AND s.outlet_id = o.id
     WHERE p.deleted_at IS NULL AND p.active AND p.min_stock > 0 AND o.deleted_at IS NULL AND o.active
       AND COALESCE(s.qty,0) <= p.min_stock ${outletId ? 'AND o.id = $2' : ''}
     ORDER BY (COALESCE(s.qty,0) - p.min_stock), p.name LIMIT $1`,
    outletId ? [limit, outletId] : [limit]);
  return rows;
}

module.exports = { move, updateAverageCost, current, qtyOf, card, lowStock };
