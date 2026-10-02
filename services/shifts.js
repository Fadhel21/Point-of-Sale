// Shift kasir & kas
const db = require('../config/db');
const audit = require('./audit');
const { AppError } = require('../lib/errors');
const { toSen, senToStr } = require('../lib/money');

async function current(userId, client) {
  const { rows } = await (client || db).query(
    `SELECT s.*, o.name AS outlet_name FROM shifts s JOIN outlets o ON o.id = s.outlet_id
     WHERE s.user_id = $1 AND s.status = 'buka' AND s.deleted_at IS NULL`, [userId]);
  return rows[0] || null;
}

async function open({ userId, outletId, openingCash, note, ip }) {
  const modal = toSen(openingCash || 0);
  if (modal < 0n) throw new AppError('Modal awal tidak boleh negatif.');
  return db.withTransaction(async (client) => {
    if (await current(userId, client)) throw new AppError('Anda masih punya shift yang terbuka.');
    try {
      const { rows } = await client.query(
        'INSERT INTO shifts (outlet_id, user_id, opening_cash, note) VALUES ($1,$2,$3,$4) RETURNING id',
        [outletId, userId, senToStr(modal), note || null]);
      await audit.log(client, { userId, action: 'shift.buka', entity: 'shifts', entityId: rows[0].id, data: { modal: senToStr(modal) }, ip });
      return rows[0].id;
    } catch (e) {
      if (e.code === '23505') throw new AppError('Anda masih punya shift yang terbuka.');
      throw e;
    }
  });
}

async function cashMove({ userId, direction, amount, note, ip }) {
  const n = toSen(amount);
  if (n <= 0n) throw new AppError('Jumlah harus lebih dari 0.');
  if (!['masuk', 'keluar'].includes(direction)) throw new AppError('Jenis kas tidak valid.');
  if (!note || !String(note).trim()) throw new AppError('Keterangan wajib diisi.');
  return db.withTransaction(async (client) => {
    const { rows } = await client.query(
      "SELECT id FROM shifts WHERE user_id=$1 AND status='buka' AND deleted_at IS NULL FOR UPDATE", [userId]);
    if (!rows[0]) throw new AppError('Buka shift terlebih dahulu.');
    if (direction === 'keluar') {
      const r = await ringkasan(rows[0].id, client);
      if (toSen(r.expected_cash) < n) throw new AppError('Kas keluar melebihi uang tunai di laci.');
    }
    const ins = await client.query(
      'INSERT INTO cash_movements (shift_id, direction, amount, note, user_id) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [rows[0].id, direction, senToStr(n), String(note).trim().slice(0, 200), userId]);
    await audit.log(client, { userId, action: `kas.${direction}`, entity: 'cash_movements', entityId: ins.rows[0].id, data: { jumlah: senToStr(n), note }, ip });
  });
}

/** Ringkasan shift: semua angka dihitung di SQL */
async function ringkasan(shiftId, client) {
  const { rows } = await (client || db).query(
    `SELECT s.*, u.name AS user_name, o.name AS outlet_name,
       COALESCE(pj.jml, 0) AS sales_count,
       COALESCE(pj.total, 0) AS sales_total,
       COALESCE(tunai.masuk, 0) AS cash_sales,
       COALESCE(km.masuk, 0) AS cash_in,
       COALESCE(km.keluar, 0) AS cash_out,
       COALESCE(rt.tunai, 0) AS cash_refund,
       COALESCE(vd.jml, 0) AS void_count,
       s.opening_cash + COALESCE(tunai.masuk, 0) + COALESCE(km.masuk, 0) - COALESCE(km.keluar, 0) - COALESCE(rt.tunai, 0) AS expected_now
     FROM shifts s
     JOIN users u ON u.id = s.user_id JOIN outlets o ON o.id = s.outlet_id
     LEFT JOIN LATERAL (SELECT count(*) jml, SUM(total) total FROM sales WHERE shift_id = s.id AND status = 'selesai' AND deleted_at IS NULL) pj ON true
     LEFT JOIN LATERAL (SELECT count(*) jml FROM sales WHERE shift_id = s.id AND status = 'void') vd ON true
     LEFT JOIN LATERAL (
        SELECT SUM(sp.amount) - COALESCE((SELECT SUM(change_amount) FROM sales WHERE shift_id = s.id AND status = 'selesai'), 0) AS masuk
        FROM sale_payments sp JOIN sales x ON x.id = sp.sale_id
        WHERE x.shift_id = s.id AND x.status = 'selesai' AND sp.method_kind = 'tunai' AND sp.deleted_at IS NULL) tunai ON true
     LEFT JOIN LATERAL (
        SELECT SUM(amount) FILTER (WHERE direction='masuk') masuk, SUM(amount) FILTER (WHERE direction='keluar') keluar
        FROM cash_movements WHERE shift_id = s.id AND deleted_at IS NULL) km ON true
     LEFT JOIN LATERAL (SELECT SUM(total) tunai FROM sale_returns WHERE shift_id = s.id AND refund_method = 'TUNAI' AND deleted_at IS NULL) rt ON true
     WHERE s.id = $1`, [shiftId]);
  const r = rows[0];
  if (!r) return null;
  r.expected_cash = r.status === 'tutup' ? r.expected_cash : r.expected_now;
  return r;
}

async function paymentsBreakdown(shiftId) {
  const { rows } = await db.query(
    `SELECT sp.method_code, pm.name, SUM(sp.amount) AS total, count(DISTINCT sp.sale_id) AS jml
     FROM sale_payments sp JOIN sales x ON x.id = sp.sale_id LEFT JOIN payment_methods pm ON pm.code = sp.method_code
     WHERE x.shift_id = $1 AND x.status = 'selesai' AND sp.deleted_at IS NULL
     GROUP BY sp.method_code, pm.name, pm.sort_order ORDER BY pm.sort_order`, [shiftId]);
  return rows;
}

async function cashMovements(shiftId) {
  const { rows } = await db.query('SELECT * FROM cash_movements WHERE shift_id=$1 AND deleted_at IS NULL ORDER BY id', [shiftId]);
  return rows;
}

async function close({ userId, countedCash, note, ip }) {
  const hitung = toSen(countedCash);
  if (hitung < 0n) throw new AppError('Uang fisik tidak boleh negatif.');
  return db.withTransaction(async (client) => {
    const { rows } = await client.query(
      "SELECT id FROM shifts WHERE user_id=$1 AND status='buka' AND deleted_at IS NULL FOR UPDATE", [userId]);
    if (!rows[0]) throw new AppError('Tidak ada shift yang terbuka.');
    const id = rows[0].id;
    const { rows: ditahan } = await client.query('SELECT count(*)::int n FROM held_sales WHERE user_id=$1 AND deleted_at IS NULL', [userId]);
    const r = await ringkasan(id, client);
    await client.query(
      `UPDATE shifts SET status='tutup', closed_at=now(), expected_cash=$2, counted_cash=$3, difference=$3::numeric - $2::numeric,
         note = COALESCE(note || E'\\n', '') || $4 WHERE id=$1`,
      [id, r.expected_now, senToStr(hitung), note || '']);
    await audit.log(client, { userId, action: 'shift.tutup', entity: 'shifts', entityId: id,
      data: { seharusnya: r.expected_now, fisik: senToStr(hitung), transaksiDitahan: ditahan[0].n }, ip });
    return id;
  });
}

async function list({ outletId, userId, from, to, page = 1, perPage = 50 }) {
  const p = [];
  const w = ['s.deleted_at IS NULL'];
  if (outletId) { p.push(outletId); w.push(`s.outlet_id = $${p.length}`); }
  if (userId) { p.push(userId); w.push(`s.user_id = $${p.length}`); }
  if (from) { p.push(from); w.push(`s.opened_at >= $${p.length}::date`); }
  if (to) { p.push(to); w.push(`s.opened_at < $${p.length}::date + 1`); }
  p.push(perPage, (page - 1) * perPage);
  const { rows } = await db.query(
    `SELECT s.*, u.name AS user_name, o.name AS outlet_name,
       (SELECT SUM(total) FROM sales WHERE shift_id = s.id AND status='selesai') AS sales_total
     FROM shifts s JOIN users u ON u.id = s.user_id JOIN outlets o ON o.id = s.outlet_id
     WHERE ${w.join(' AND ')} ORDER BY s.id DESC LIMIT $${p.length - 1} OFFSET $${p.length}`, p);
  return rows;
}

module.exports = { current, open, cashMove, ringkasan, paymentsBreakdown, cashMovements, close, list };
