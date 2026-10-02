// Pelanggan, member & poin, piutang
const db = require('../config/db');
const audit = require('./audit');
const { AppError } = require('../lib/errors');
const { toSen, senToStr } = require('../lib/money');

async function list({ q, member, piutang, page = 1, perPage = 50 }) {
  const p = [];
  const w = ['deleted_at IS NULL'];
  if (q) { p.push(`%${q}%`); w.push(`(name ILIKE $${p.length} OR code ILIKE $${p.length} OR phone ILIKE $${p.length})`); }
  if (member) w.push('is_member');
  if (piutang) w.push('receivable > 0');
  p.push(perPage, (page - 1) * perPage);
  const { rows } = await db.query(
    `SELECT * FROM customers WHERE ${w.join(' AND ')} ORDER BY name LIMIT $${p.length - 1} OFFSET $${p.length}`, p);
  return rows;
}

async function search(q) {
  const { rows } = await db.query(
    `SELECT id, code, name, phone, is_member, points, receivable FROM customers
     WHERE deleted_at IS NULL AND (name ILIKE $1 OR code ILIKE $1 OR phone ILIKE $1) ORDER BY name LIMIT 10`, [`%${q}%`]);
  return rows;
}

async function get(id) {
  const { rows } = await db.query('SELECT * FROM customers WHERE id=$1 AND deleted_at IS NULL', [id]);
  return rows[0] || null;
}

async function save(id, d) {
  if (!d.name || !String(d.name).trim()) throw new AppError('Nama pelanggan wajib diisi.');
  const limit = toSen(d.credit_limit || 0);
  if (limit < 0n) throw new AppError('Batas piutang tidak boleh negatif.');
  const member = d.is_member === 'on' || d.is_member === true || d.is_member === '1';
  return db.withTransaction(async (client) => {
    let code = d.code && String(d.code).trim();
    if (!code) {
      const { rows } = await client.query("SELECT 'PLG' || lpad((COALESCE(MAX(id),0)+1)::text, 5, '0') AS c FROM customers");
      code = rows[0].c;
    }
    const p = [code, String(d.name).trim(), d.phone || null, d.email || null, d.address || null, member, senToStr(limit)];
    try {
      if (id) {
        await client.query(`UPDATE customers SET code=$1, name=$2, phone=$3, email=$4, address=$5, is_member=$6, credit_limit=$7 WHERE id=$8`, [...p, id]);
        return id;
      }
      const { rows } = await client.query(
        `INSERT INTO customers (code, name, phone, email, address, is_member, credit_limit) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, p);
      return rows[0].id;
    } catch (e) {
      if (e.code === '23505') throw new AppError('Kode pelanggan sudah dipakai.');
      throw e;
    }
  });
}

async function remove(id) {
  const c = await get(id);
  if (c && toSen(c.receivable) !== 0n) throw new AppError('Pelanggan masih punya piutang, tidak bisa dihapus.');
  await db.query('UPDATE customers SET deleted_at=now() WHERE id=$1', [id]);
}

async function history(id, limit = 50) {
  const { rows } = await db.query(
    `SELECT s.id, s.number, s.created_at, s.total, s.status, s.points_earned, s.points_used
     FROM sales s WHERE s.customer_id=$1 AND s.deleted_at IS NULL ORDER BY s.id DESC LIMIT $2`, [id, limit]);
  return rows;
}

async function pointLedger(id) {
  const { rows } = await db.query('SELECT * FROM point_ledger WHERE customer_id=$1 AND deleted_at IS NULL ORDER BY id DESC LIMIT 100', [id]);
  return rows;
}

async function receivableLedger(id) {
  const { rows } = await db.query(
    `SELECT r.*, u.name AS user_name, s.number AS sale_number FROM receivable_ledger r
     LEFT JOIN users u ON u.id = r.user_id LEFT JOIN sales s ON s.id = r.ref_id AND r.ref_type = 'penjualan'
     WHERE r.customer_id=$1 AND r.deleted_at IS NULL ORDER BY r.id DESC LIMIT 200`, [id]);
  return rows;
}

/** Pelunasan piutang (sebagian/penuh) */
async function payReceivable({ customerId, amount, methodCode, note, user, ip }) {
  const n = toSen(amount);
  if (n <= 0n) throw new AppError('Jumlah pembayaran harus lebih dari 0.');
  return db.withTransaction(async (client) => {
    const { rows } = await client.query('SELECT id, name, receivable FROM customers WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [customerId]);
    const c = rows[0];
    if (!c) throw new AppError('Pelanggan tidak ditemukan.', 404);
    if (n > toSen(c.receivable)) throw new AppError('Pembayaran melebihi sisa piutang.');
    const m = await client.query("SELECT code, kind FROM payment_methods WHERE code=$1 AND active AND kind <> 'piutang' AND deleted_at IS NULL", [methodCode]);
    if (!m.rows[0]) throw new AppError('Metode pembayaran tidak valid.');
    // Pelunasan tunai masuk ke kas shift penerima bila shift terbuka
    if (m.rows[0].kind === 'tunai') {
      const sh = await client.query("SELECT id FROM shifts WHERE user_id=$1 AND status='buka'", [user.id]);
      if (sh.rows[0]) {
        await client.query('INSERT INTO cash_movements (shift_id, direction, amount, note, user_id) VALUES ($1,$2,$3,$4,$5)',
          [sh.rows[0].id, 'masuk', senToStr(n), `Pelunasan piutang ${c.name}`, user.id]);
      }
    }
    await client.query('UPDATE customers SET receivable = receivable - $2 WHERE id=$1', [customerId, senToStr(n)]);
    const ins = await client.query(
      'INSERT INTO receivable_ledger (customer_id, amount, ref_type, method_code, note, user_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [customerId, senToStr(-n), 'pelunasan', methodCode, note || null, user.id]);
    await audit.log(client, { userId: user.id, action: 'piutang.bayar', entity: 'customers', entityId: customerId, data: { jumlah: senToStr(n), metode: methodCode }, ip });
    return ins.rows[0].id;
  });
}

/** Penyesuaian poin manual */
async function adjustPoints({ customerId, points, note, user, ip }) {
  const n = toSen(points);
  if (n === 0n || n % 100n !== 0n) throw new AppError('Poin harus bilangan bulat dan tidak nol.');
  if (!note) throw new AppError('Keterangan wajib diisi.');
  return db.withTransaction(async (client) => {
    const { rows } = await client.query('SELECT points, is_member FROM customers WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [customerId]);
    if (!rows[0] || !rows[0].is_member) throw new AppError('Pelanggan bukan member.');
    if (toSen(rows[0].points) + n < 0n) throw new AppError('Poin tidak boleh menjadi negatif.');
    await client.query('UPDATE customers SET points = points + $2 WHERE id=$1', [customerId, senToStr(n)]);
    await client.query("INSERT INTO point_ledger (customer_id, points, ref_type, note) VALUES ($1,$2,'manual',$3)", [customerId, senToStr(n), note]);
    await audit.log(client, { userId: user.id, action: 'poin.sesuaikan', entity: 'customers', entityId: customerId, data: { poin: senToStr(n), note }, ip });
  });
}

module.exports = { list, search, get, save, remove, history, pointLedger, receivableLedger, payReceivable, adjustPoints };
