// Pengaturan toko (tabel settings, nilai JSONB per kunci)
const db = require('../config/db');

let cache = new Map();

async function get(key, client) {
  if (!client && cache.has(key)) return cache.get(key);
  const { rows } = await (client || db).query('SELECT value FROM settings WHERE key = $1 AND deleted_at IS NULL', [key]);
  const v = rows[0] ? rows[0].value : null;
  if (!client) cache.set(key, v);
  return v;
}

async function getAll() {
  const { rows } = await db.query('SELECT key, value FROM settings WHERE deleted_at IS NULL');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

async function set(key, value, client) {
  await (client || db).query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, deleted_at = NULL`,
    [key, JSON.stringify(value)]
  );
  cache.delete(key);
}

module.exports = { get, getAll, set, clearCache: () => (cache = new Map()) };
