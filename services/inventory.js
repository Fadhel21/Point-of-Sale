// Penyesuaian stok, stok opname, mutasi antar outlet
const db = require('../config/db');
const stock = require('./stock');
const docnumber = require('./docnumber');
const audit = require('./audit');
const { AppError } = require('../lib/errors');
const { toQty, qtyToStr } = require('../lib/money');

async function costOf(client, productId) {
  const { rows } = await client.query('SELECT cost_price FROM products WHERE id=$1 AND deleted_at IS NULL', [productId]);
  if (!rows[0]) throw new AppError('Produk tidak ditemukan.');
  return rows[0].cost_price;
}

// ---------- Penyesuaian ----------
async function adjust({ outletId, productId, qtyChange, reason, user, ip }) {
  const q = toQty(qtyChange);
  if (q === 0n) throw new AppError('Jumlah penyesuaian tidak boleh 0.');
  if (!reason || String(reason).trim().length < 3) throw new AppError('Alasan penyesuaian wajib diisi.');
  return db.withTransaction(async (client) => {
    const cost = await costOf(client, productId);
    const number = await docnumber.next(client, outletId, 'ADJ');
    const { rows } = await client.query(
      'INSERT INTO stock_adjustments (number, outlet_id, product_id, qty_change, reason, user_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [number, outletId, productId, qtyToStr(q), String(reason).trim(), user.id]);
    await stock.move(client, { productId, outletId, qtyChange: q, unitCost: cost, refType: 'penyesuaian', refId: rows[0].id, refNo: number, note: reason, userId: user.id });
    await audit.log(client, { userId: user.id, action: 'stok.penyesuaian', entity: 'stock_adjustments', entityId: rows[0].id, data: { nomor: number, qty: qtyToStr(q), reason }, ip });
    return rows[0].id;
  });
}

async function listAdjustments({ outletId }) {
  const { rows } = await db.query(
    `SELECT a.*, p.name AS product_name, p.sku, u.name AS user_name FROM stock_adjustments a
     JOIN products p ON p.id = a.product_id LEFT JOIN users u ON u.id = a.user_id
     WHERE a.outlet_id=$1 AND a.deleted_at IS NULL ORDER BY a.id DESC LIMIT 200`, [outletId]);
  return rows;
}

// ---------- Stok opname ----------
async function createOpname({ outletId, note, categoryId, user }) {
  return db.withTransaction(async (client) => {
    const number = await docnumber.next(client, outletId, 'OP');
    const { rows } = await client.query('INSERT INTO stock_opnames (number, outlet_id, note, user_id) VALUES ($1,$2,$3,$4) RETURNING id',
      [number, outletId, note || null, user.id]);
    const id = rows[0].id;
    // Isi daftar produk beserta stok sistem saat ini (hitungan fisik awal = stok sistem)
    await client.query(
      `INSERT INTO stock_opname_items (opname_id, product_id, system_qty, counted_qty)
       SELECT $1, p.id, COALESCE(s.qty,0), COALESCE(s.qty,0) FROM products p
       LEFT JOIN stocks s ON s.product_id = p.id AND s.outlet_id = $2
       WHERE p.deleted_at IS NULL AND p.active ${categoryId ? 'AND p.category_id = $3' : ''}
         AND NOT EXISTS (SELECT 1 FROM products c WHERE c.parent_id = p.id AND c.deleted_at IS NULL)`,
      categoryId ? [id, outletId, categoryId] : [id, outletId]);
    return id;
  });
}

async function getOpname(id) {
  const { rows } = await db.query(
    `SELECT o.*, ot.name AS outlet_name, u.name AS user_name, a.name AS approver_name FROM stock_opnames o
     JOIN outlets ot ON ot.id = o.outlet_id LEFT JOIN users u ON u.id = o.user_id LEFT JOIN users a ON a.id = o.approved_by
     WHERE o.id=$1 AND o.deleted_at IS NULL`, [id]);
  if (!rows[0]) return null;
  rows[0].items = (await db.query(
    `SELECT i.*, p.name, p.sku, p.variant_name, p.cost_price, (i.counted_qty - i.system_qty) AS selisih,
            ROUND((i.counted_qty - i.system_qty) * p.cost_price, 2) AS nilai_selisih
     FROM stock_opname_items i JOIN products p ON p.id = i.product_id WHERE i.opname_id=$1 ORDER BY p.name`, [id])).rows;
  return rows[0];
}

async function listOpnames(outletId) {
  const { rows } = await db.query(
    `SELECT o.*, u.name AS user_name, (SELECT count(*) FROM stock_opname_items WHERE opname_id=o.id AND counted_qty <> system_qty) AS jml_selisih
     FROM stock_opnames o LEFT JOIN users u ON u.id = o.user_id WHERE o.outlet_id=$1 AND o.deleted_at IS NULL ORDER BY o.id DESC`, [outletId]);
  return rows;
}

/** counts: { [item_id]: qty } */
async function saveCounts(id, counts, submit) {
  return db.withTransaction(async (client) => {
    const { rows } = await client.query('SELECT status FROM stock_opnames WHERE id=$1 FOR UPDATE', [id]);
    if (!rows[0]) throw new AppError('Opname tidak ditemukan.', 404);
    if (rows[0].status !== 'draf') throw new AppError('Opname sudah diajukan, tidak bisa diubah.');
    for (const [itemId, val] of Object.entries(counts || {})) {
      if (val === '' || val === undefined) continue;
      const q = toQty(val);
      if (q < 0n) throw new AppError('Hasil hitung tidak boleh negatif.');
      await client.query('UPDATE stock_opname_items SET counted_qty=$1 WHERE id=$2 AND opname_id=$3', [qtyToStr(q), itemId, id]);
    }
    if (submit) await client.query("UPDATE stock_opnames SET status='diajukan' WHERE id=$1", [id]);
  });
}

/**
 * Setujui opname: stok disesuaikan sebesar selisih (hitung fisik - stok sistem saat opname dibuat),
 * sehingga penjualan yang terjadi selama hitung fisik tetap tercatat benar.
 */
async function approveOpname({ id, approve, user, ip }) {
  return db.withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM stock_opnames WHERE id=$1 FOR UPDATE', [id]);
    const o = rows[0];
    if (!o) throw new AppError('Opname tidak ditemukan.', 404);
    if (o.status !== 'diajukan') throw new AppError('Opname belum diajukan atau sudah diproses.');
    if (approve) {
      const { rows: items } = await client.query(
        `SELECT i.product_id, i.counted_qty - i.system_qty AS selisih, p.cost_price FROM stock_opname_items i
         JOIN products p ON p.id = i.product_id WHERE i.opname_id=$1 AND i.counted_qty <> i.system_qty ORDER BY i.product_id`, [id]);
      for (const it of items) {
        await stock.move(client, { productId: it.product_id, outletId: o.outlet_id, qtyChange: toQty(it.selisih), unitCost: it.cost_price,
          refType: 'opname', refId: o.id, refNo: o.number, userId: user.id, note: 'Stok opname', cekMinus: false });
      }
    }
    await client.query('UPDATE stock_opnames SET status=$2, approved_by=$3, approved_at=now() WHERE id=$1', [id, approve ? 'disetujui' : 'ditolak', user.id]);
    await audit.log(client, { userId: user.id, action: approve ? 'opname.setujui' : 'opname.tolak', entity: 'stock_opnames', entityId: id, data: { nomor: o.number }, ip });
  });
}

// ---------- Mutasi antar outlet ----------
async function transfer({ fromOutletId, toOutletId, items, note, user, ip }) {
  if (!toOutletId || String(fromOutletId) === String(toOutletId)) throw new AppError('Pilih outlet tujuan yang berbeda.');
  const list = (Array.isArray(items) ? items : []).filter((i) => i.product_id && toQty(i.qty || 0) > 0n);
  if (!list.length) throw new AppError('Tambahkan minimal satu produk.');
  return db.withTransaction(async (client) => {
    const number = await docnumber.next(client, fromOutletId, 'MT');
    const { rows } = await client.query(
      'INSERT INTO stock_transfers (number, from_outlet_id, to_outlet_id, note, user_id) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [number, fromOutletId, toOutletId, note || null, user.id]);
    const id = rows[0].id;
    list.sort((a, b) => Number(a.product_id) - Number(b.product_id));
    for (const it of list) {
      const q = toQty(it.qty);
      const cost = await costOf(client, it.product_id);
      await client.query('INSERT INTO stock_transfer_items (transfer_id, product_id, qty) VALUES ($1,$2,$3)', [id, it.product_id, qtyToStr(q)]);
      await stock.move(client, { productId: it.product_id, outletId: fromOutletId, qtyChange: -q, unitCost: cost, refType: 'mutasi_keluar', refId: id, refNo: number, userId: user.id, note });
      await stock.move(client, { productId: it.product_id, outletId: toOutletId, qtyChange: q, unitCost: cost, refType: 'mutasi_masuk', refId: id, refNo: number, userId: user.id, note });
    }
    await audit.log(client, { userId: user.id, action: 'stok.mutasi', entity: 'stock_transfers', entityId: id, data: { nomor: number }, ip });
    return id;
  });
}

async function listTransfers(outletId) {
  const { rows } = await db.query(
    `SELECT t.*, f.name AS from_name, o.name AS to_name, u.name AS user_name,
            (SELECT count(*) FROM stock_transfer_items WHERE transfer_id=t.id) AS jml_item
     FROM stock_transfers t JOIN outlets f ON f.id = t.from_outlet_id JOIN outlets o ON o.id = t.to_outlet_id
     LEFT JOIN users u ON u.id = t.user_id
     WHERE (t.from_outlet_id=$1 OR t.to_outlet_id=$1) AND t.deleted_at IS NULL ORDER BY t.id DESC LIMIT 200`, [outletId]);
  return rows;
}

async function getTransfer(id) {
  const { rows } = await db.query(
    `SELECT t.*, f.name AS from_name, o.name AS to_name, u.name AS user_name FROM stock_transfers t
     JOIN outlets f ON f.id = t.from_outlet_id JOIN outlets o ON o.id = t.to_outlet_id LEFT JOIN users u ON u.id = t.user_id WHERE t.id=$1`, [id]);
  if (!rows[0]) return null;
  rows[0].items = (await db.query(
    'SELECT i.*, p.name, p.sku FROM stock_transfer_items i JOIN products p ON p.id = i.product_id WHERE i.transfer_id=$1', [id])).rows;
  return rows[0];
}

module.exports = { adjust, listAdjustments, createOpname, getOpname, listOpnames, saveCounts, approveOpname, transfer, listTransfers, getTransfer };
