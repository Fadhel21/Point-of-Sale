// Pembelian: pemasok, PO, penerimaan barang, retur pembelian, hutang
const db = require('../config/db');
const stock = require('./stock');
const docnumber = require('./docnumber');
const audit = require('./audit');
const { AppError } = require('../lib/errors');
const { toSen, toQty, senToStr, qtyToStr, mulQty } = require('../lib/money');

// ---------- Pemasok ----------
async function listSuppliers(q) {
  const p = []; let w = '';
  if (q) { p.push(`%${q}%`); w = 'AND (name ILIKE $1 OR phone ILIKE $1)'; }
  const { rows } = await db.query(`SELECT * FROM suppliers WHERE deleted_at IS NULL ${w} ORDER BY name`, p);
  return rows;
}
async function getSupplier(id) {
  const { rows } = await db.query('SELECT * FROM suppliers WHERE id=$1 AND deleted_at IS NULL', [id]);
  return rows[0];
}
async function saveSupplier(id, d) {
  if (!d.name) throw new AppError('Nama pemasok wajib diisi.');
  const p = [d.name, d.contact || null, d.phone || null, d.email || null, d.address || null];
  if (id) await db.query('UPDATE suppliers SET name=$1, contact=$2, phone=$3, email=$4, address=$5 WHERE id=$6', [...p, id]);
  else await db.query('INSERT INTO suppliers (name, contact, phone, email, address) VALUES ($1,$2,$3,$4,$5)', p);
}
async function removeSupplier(id) {
  const s = await getSupplier(id);
  if (s && toSen(s.payable) !== 0n) throw new AppError('Pemasok masih punya hutang, tidak bisa dihapus.');
  await db.query('UPDATE suppliers SET deleted_at=now() WHERE id=$1', [id]);
}

function bersihkanItem(items) {
  const list = (Array.isArray(items) ? items : []).filter((i) => i && i.product_id && i.qty !== '' && toQty(i.qty || 0) > 0n);
  if (!list.length) throw new AppError('Tambahkan minimal satu produk.');
  return list.map((i) => {
    const qty = toQty(i.qty); const price = toSen(i.price || 0);
    if (price < 0n) throw new AppError('Harga beli tidak boleh negatif.');
    return { ...i, qty, price };
  });
}

// ---------- PO ----------
async function createPo({ supplierId, outletId, items, note, user, ip }) {
  if (!supplierId) throw new AppError('Pilih pemasok.');
  const list = bersihkanItem(items);
  return db.withTransaction(async (client) => {
    const number = await docnumber.next(client, outletId, 'PO');
    const total = list.reduce((a, i) => a + mulQty(i.price, i.qty), 0n);
    const { rows } = await client.query(
      'INSERT INTO purchase_orders (number, supplier_id, outlet_id, total, note, user_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [number, supplierId, outletId, senToStr(total), note || null, user.id]);
    for (const i of list) {
      await client.query('INSERT INTO purchase_order_items (po_id, product_id, qty, price) VALUES ($1,$2,$3,$4)',
        [rows[0].id, i.product_id, qtyToStr(i.qty), senToStr(i.price)]);
    }
    await audit.log(client, { userId: user.id, action: 'po.buat', entity: 'purchase_orders', entityId: rows[0].id, data: { nomor: number, total: senToStr(total) }, ip });
    return rows[0].id;
  });
}

async function listPo({ outletId, status }) {
  const p = [outletId]; let w = '';
  if (status) { p.push(status); w = 'AND po.status = $2'; }
  const { rows } = await db.query(
    `SELECT po.*, s.name AS supplier_name FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
     WHERE po.outlet_id=$1 AND po.deleted_at IS NULL ${w} ORDER BY po.id DESC LIMIT 200`, p);
  return rows;
}

async function getPo(id) {
  const { rows } = await db.query(
    `SELECT po.*, s.name AS supplier_name, s.address AS supplier_address, s.phone AS supplier_phone, o.name AS outlet_name, u.name AS user_name
     FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id JOIN outlets o ON o.id = po.outlet_id
     LEFT JOIN users u ON u.id = po.user_id WHERE po.id=$1 AND po.deleted_at IS NULL`, [id]);
  if (!rows[0]) return null;
  rows[0].items = (await db.query(
    `SELECT i.*, p.name, p.sku, u.name AS unit_name, (i.qty - i.received_qty) AS sisa FROM purchase_order_items i
     JOIN products p ON p.id = i.product_id LEFT JOIN units u ON u.id = p.unit_id WHERE i.po_id=$1 AND i.deleted_at IS NULL ORDER BY i.id`, [id])).rows;
  return rows[0];
}

async function cancelPo(id, user) {
  return db.withTransaction(async (client) => {
    const { rows } = await client.query('SELECT status FROM purchase_orders WHERE id=$1 FOR UPDATE', [id]);
    if (!rows[0]) throw new AppError('PO tidak ditemukan.', 404);
    if (rows[0].status !== 'dipesan') throw new AppError('Hanya PO yang belum diterima yang bisa dibatalkan.');
    await client.query("UPDATE purchase_orders SET status='batal' WHERE id=$1", [id]);
    await audit.log(client, { userId: user.id, action: 'po.batal', entity: 'purchase_orders', entityId: id });
  });
}

// ---------- Penerimaan barang ----------
/**
 * Terima barang (dari PO sebagian/penuh, atau tanpa PO).
 * Menambah stok, memperbarui harga pokok rata-rata, mencatat hutang.
 */
async function receive({ poId, supplierId, outletId, items, invoiceNo, dueDate, paidNow, methodCode, note, user, ip }) {
  const list = bersihkanItem(items);
  return db.withTransaction(async (client) => {
    let po = null;
    if (poId) {
      const r = await client.query('SELECT * FROM purchase_orders WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [poId]);
      po = r.rows[0];
      if (!po) throw new AppError('PO tidak ditemukan.');
      if (!['dipesan', 'sebagian'].includes(po.status)) throw new AppError('PO sudah selesai atau dibatalkan.');
      supplierId = po.supplier_id;
      outletId = po.outlet_id;
    }
    if (!supplierId) throw new AppError('Pilih pemasok.');
    const number = await docnumber.next(client, outletId, 'GR');
    const total = list.reduce((a, i) => a + mulQty(i.price, i.qty), 0n);
    const bayar = toSen(paidNow || 0);
    if (bayar < 0n || bayar > total) throw new AppError('Pembayaran awal tidak valid.');

    const { rows: [gr] } = await client.query(
      `INSERT INTO goods_receipts (number, po_id, supplier_id, outlet_id, invoice_no, due_date, total, paid, note, user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [number, poId || null, supplierId, outletId, invoiceNo || null, dueDate || null, senToStr(total), senToStr(bayar), note || null, user.id]);

    list.sort((a, b) => Number(a.product_id) - Number(b.product_id));
    for (const i of list) {
      let poItemId = null;
      if (po) {
        const r = await client.query('SELECT * FROM purchase_order_items WHERE po_id=$1 AND product_id=$2 AND deleted_at IS NULL FOR UPDATE', [po.id, i.product_id]);
        const pi = r.rows[0];
        if (!pi) throw new AppError('Ada produk yang tidak ada di PO.');
        if (toQty(pi.received_qty) + i.qty > toQty(pi.qty)) throw new AppError('Qty diterima melebihi sisa PO.');
        await client.query('UPDATE purchase_order_items SET received_qty = received_qty + $2 WHERE id=$1', [pi.id, qtyToStr(i.qty)]);
        poItemId = pi.id;
      }
      await client.query('INSERT INTO goods_receipt_items (receipt_id, po_item_id, product_id, qty, price) VALUES ($1,$2,$3,$4,$5)',
        [gr.id, poItemId, i.product_id, qtyToStr(i.qty), senToStr(i.price)]);
      await client.query('SELECT id FROM products WHERE id=$1 FOR UPDATE', [i.product_id]);
      await stock.updateAverageCost(client, i.product_id, i.qty, senToStr(i.price));
      await stock.move(client, { productId: i.product_id, outletId, qtyChange: i.qty, unitCost: senToStr(i.price),
        refType: 'penerimaan', refId: gr.id, refNo: number, userId: user.id });
    }
    if (po) {
      const { rows: [st] } = await client.query(
        'SELECT bool_and(received_qty >= qty) AS lengkap FROM purchase_order_items WHERE po_id=$1 AND deleted_at IS NULL', [po.id]);
      await client.query('UPDATE purchase_orders SET status=$2 WHERE id=$1', [po.id, st.lengkap ? 'selesai' : 'sebagian']);
    }
    // Hutang: total masuk, pembayaran awal mengurangi
    await client.query('UPDATE suppliers SET payable = payable + $2 WHERE id=$1', [supplierId, senToStr(total - bayar)]);
    await client.query('INSERT INTO payable_ledger (supplier_id, receipt_id, amount, ref_type, ref_id, note, user_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [supplierId, gr.id, senToStr(total), 'penerimaan', gr.id, `Penerimaan ${number}`, user.id]);
    if (bayar > 0n) {
      await client.query('INSERT INTO payable_ledger (supplier_id, receipt_id, amount, ref_type, method_code, note, user_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [supplierId, gr.id, senToStr(-bayar), 'pembayaran', methodCode || 'TUNAI', `Bayar saat terima ${number}`, user.id]);
    }
    await audit.log(client, { userId: user.id, action: 'pembelian.terima', entity: 'goods_receipts', entityId: gr.id, data: { nomor: number, total: senToStr(total) }, ip });
    return gr.id;
  });
}

async function listReceipts({ outletId, supplierId, unpaid }) {
  const p = [outletId]; const w = ['g.outlet_id=$1', 'g.deleted_at IS NULL'];
  if (supplierId) { p.push(supplierId); w.push(`g.supplier_id=$${p.length}`); }
  const { rows } = await db.query(
    `SELECT * FROM (SELECT g.*, s.name AS supplier_name, po.number AS po_number,
            g.total - g.paid - COALESCE((SELECT SUM(total) FROM purchase_returns r WHERE r.receipt_id = g.id AND r.deleted_at IS NULL),0) AS sisa
     FROM goods_receipts g JOIN suppliers s ON s.id = g.supplier_id LEFT JOIN purchase_orders po ON po.id = g.po_id
     WHERE ${w.join(' AND ')}) x ${unpaid ? 'WHERE sisa > 0' : ''} ORDER BY id DESC LIMIT 300`, p);
  return rows;
}

async function getReceipt(id) {
  const { rows } = await db.query(
    `SELECT g.*, s.name AS supplier_name, po.number AS po_number, o.name AS outlet_name, u.name AS user_name,
            g.total - g.paid - COALESCE((SELECT SUM(total) FROM purchase_returns r WHERE r.receipt_id = g.id AND r.deleted_at IS NULL),0) AS sisa
     FROM goods_receipts g JOIN suppliers s ON s.id = g.supplier_id LEFT JOIN purchase_orders po ON po.id = g.po_id
     JOIN outlets o ON o.id = g.outlet_id LEFT JOIN users u ON u.id = g.user_id WHERE g.id=$1`, [id]);
  if (!rows[0]) return null;
  rows[0].items = (await db.query(
    `SELECT i.*, p.name, p.sku, (i.qty - i.returned_qty) AS sisa_retur FROM goods_receipt_items i JOIN products p ON p.id = i.product_id
     WHERE i.receipt_id=$1 ORDER BY i.id`, [id])).rows;
  return rows[0];
}

// ---------- Retur pembelian ----------
async function createReturn({ receiptId, items, reason, user, ip }) {
  if (!reason) throw new AppError('Alasan retur wajib diisi.');
  return db.withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM goods_receipts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [receiptId]);
    const g = rows[0];
    if (!g) throw new AppError('Penerimaan tidak ditemukan.');
    const pilih = (Array.isArray(items) ? items : []).filter((i) => i && toQty(i.qty || 0) > 0n);
    if (!pilih.length) throw new AppError('Pilih barang yang diretur.');
    const number = await docnumber.next(client, g.outlet_id, 'RB');
    const { rows: [ret] } = await client.query(
      'INSERT INTO purchase_returns (number, receipt_id, supplier_id, outlet_id, reason, user_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [number, g.id, g.supplier_id, g.outlet_id, reason, user.id]);
    let total = 0n;
    pilih.sort((a, b) => Number(a.receipt_item_id) - Number(b.receipt_item_id));
    for (const r of pilih) {
      const { rows: [it] } = await client.query('SELECT * FROM goods_receipt_items WHERE id=$1 AND receipt_id=$2 FOR UPDATE', [r.receipt_item_id, g.id]);
      if (!it) throw new AppError('Item retur tidak valid.');
      const q = toQty(r.qty);
      if (q > toQty(it.qty) - toQty(it.returned_qty)) throw new AppError('Qty retur melebihi qty diterima.');
      const amount = mulQty(toSen(it.price), q);
      total += amount;
      await client.query('UPDATE goods_receipt_items SET returned_qty = returned_qty + $2 WHERE id=$1', [it.id, qtyToStr(q)]);
      await client.query('INSERT INTO purchase_return_items (return_id, receipt_item_id, product_id, qty, price) VALUES ($1,$2,$3,$4,$5)',
        [ret.id, it.id, it.product_id, qtyToStr(q), it.price]);
      await stock.move(client, { productId: it.product_id, outletId: g.outlet_id, qtyChange: -q, unitCost: it.price,
        refType: 'retur_beli', refId: ret.id, refNo: number, userId: user.id, note: reason });
    }
    await client.query('UPDATE purchase_returns SET total=$2 WHERE id=$1', [ret.id, senToStr(total)]);
    // Retur mengurangi hutang (bisa membuat saldo negatif = pemasok berutang ke toko / deposit)
    await client.query('UPDATE suppliers SET payable = payable - $2 WHERE id=$1', [g.supplier_id, senToStr(total)]);
    await client.query('INSERT INTO payable_ledger (supplier_id, receipt_id, amount, ref_type, ref_id, note, user_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [g.supplier_id, g.id, senToStr(-total), 'retur_beli', ret.id, `Retur ${number}`, user.id]);
    await audit.log(client, { userId: user.id, action: 'pembelian.retur', entity: 'purchase_returns', entityId: ret.id, data: { nomor: number, total: senToStr(total) }, ip });
    return ret.id;
  });
}

async function listReturns(outletId) {
  const { rows } = await db.query(
    `SELECT r.*, s.name AS supplier_name, g.number AS receipt_number FROM purchase_returns r
     JOIN suppliers s ON s.id = r.supplier_id JOIN goods_receipts g ON g.id = r.receipt_id
     WHERE r.outlet_id=$1 AND r.deleted_at IS NULL ORDER BY r.id DESC LIMIT 200`, [outletId]);
  return rows;
}

// ---------- Hutang ----------
async function payPayable({ receiptId, amount, methodCode, note, user, ip }) {
  const n = toSen(amount);
  if (n <= 0n) throw new AppError('Jumlah pembayaran harus lebih dari 0.');
  return db.withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT g.*, g.total - g.paid - COALESCE((SELECT SUM(total) FROM purchase_returns r WHERE r.receipt_id = g.id AND r.deleted_at IS NULL),0) AS sisa
       FROM goods_receipts g WHERE g.id=$1 FOR UPDATE`, [receiptId]);
    const g = rows[0];
    if (!g) throw new AppError('Faktur tidak ditemukan.');
    if (n > toSen(g.sisa)) throw new AppError('Pembayaran melebihi sisa hutang faktur ini.');
    await client.query('UPDATE goods_receipts SET paid = paid + $2 WHERE id=$1', [g.id, senToStr(n)]);
    await client.query('UPDATE suppliers SET payable = payable - $2 WHERE id=$1', [g.supplier_id, senToStr(n)]);
    await client.query('INSERT INTO payable_ledger (supplier_id, receipt_id, amount, ref_type, method_code, note, user_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [g.supplier_id, g.id, senToStr(-n), 'pembayaran', methodCode || 'TRANSFER', note || null, user.id]);
    await audit.log(client, { userId: user.id, action: 'hutang.bayar', entity: 'goods_receipts', entityId: g.id, data: { jumlah: senToStr(n) }, ip });
  });
}

async function payableSummary() {
  const { rows } = await db.query(
    `SELECT s.id, s.name, s.payable,
       (SELECT min(due_date) FROM goods_receipts g WHERE g.supplier_id = s.id AND g.total > g.paid AND g.deleted_at IS NULL) AS jatuh_tempo
     FROM suppliers s WHERE s.deleted_at IS NULL AND s.payable <> 0 ORDER BY s.name`);
  return rows;
}

module.exports = { listSuppliers, getSupplier, saveSupplier, removeSupplier, createPo, listPo, getPo, cancelPo,
  receive, listReceipts, getReceipt, createReturn, listReturns, payPayable, payableSummary };
