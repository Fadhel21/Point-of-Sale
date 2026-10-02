// Koneksi PostgreSQL dan helper transaksi tunggal untuk semua service.
const { Pool, types } = require('pg');
const config = require('./index');

// NUMERIC (1700) dan BIGINT (20) dibiarkan sebagai string agar tidak lewat float JavaScript.
types.setTypeParser(1700, (v) => v);
types.setTypeParser(20, (v) => v);
// DATE (1082) dikembalikan apa adanya 'YYYY-MM-DD' supaya tidak bergeser zona waktu.
types.setTypeParser(1082, (v) => v);

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: config.dbPoolMax,
  // Zona waktu sesi supaya CURRENT_DATE / date_trunc konsisten dengan jam toko.
  options: `-c TimeZone=${config.timezone}`,
});

pool.on('error', (err) => {
  console.error('Kesalahan koneksi database (idle):', err.message);
});

/** Query biasa di luar transaksi. */
function query(text, params) {
  return pool.query(text, params);
}

/**
 * Jalankan fn(client) di dalam BEGIN ... COMMIT; ROLLBACK otomatis bila gagal.
 * Bila `client` sudah diberikan (transaksi bersarang), fn dijalankan di transaksi yang sama.
 */
async function withTransaction(fn, existingClient) {
  if (existingClient) return fn(existingClient);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* abaikan */ }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };
