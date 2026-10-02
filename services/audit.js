// Log audit
const db = require('../config/db');

async function log(client, { userId, action, entity, entityId, data, ip }) {
  await (client || db).query(
    'INSERT INTO audit_logs (user_id, action, entity, entity_id, data, ip) VALUES ($1,$2,$3,$4,$5,$6)',
    [userId || null, action, entity || null, entityId || null, data ? JSON.stringify(data) : null, ip || null]
  );
}

async function list({ from, to, userId, action, page = 1, perPage = 50 }) {
  const p = [];
  const w = ['a.deleted_at IS NULL'];
  if (from) { p.push(from); w.push(`a.created_at >= $${p.length}::date`); }
  if (to) { p.push(to); w.push(`a.created_at < $${p.length}::date + 1`); }
  if (userId) { p.push(userId); w.push(`a.user_id = $${p.length}`); }
  if (action) { p.push(`%${action}%`); w.push(`a.action ILIKE $${p.length}`); }
  p.push(perPage, (page - 1) * perPage);
  const { rows } = await db.query(
    `SELECT a.*, u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
     WHERE ${w.join(' AND ')} ORDER BY a.id DESC LIMIT $${p.length - 1} OFFSET $${p.length}`, p);
  return rows;
}

module.exports = { log, list };
