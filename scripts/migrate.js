// Menjalankan file migrasi SQL bernomor di folder migrations/ secara berurutan.
// Pemakaian: node scripts/migrate.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');
const config = require('../config');
const { pool } = require('../config/db');

/** Buat database tujuan bila belum ada (lewat database "postgres") */
async function pastikanDatabase() {
  const u = new URL(config.databaseUrl);
  const nama = decodeURIComponent(u.pathname.slice(1));
  if (!/^[A-Za-z0-9_]+$/.test(nama)) throw new Error(`Nama database tidak valid: ${nama}`);
  u.pathname = '/postgres';
  const c = new Client({ connectionString: u.toString() });
  await c.connect();
  try {
    const { rowCount } = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [nama]);
    if (!rowCount) {
      await c.query(`CREATE DATABASE "${nama}"`);
      console.log(`Database "${nama}" dibuat.`);
    }
  } finally {
    await c.end();
  }
}

async function main() {
  await pastikanDatabase();
  const dir = path.join(__dirname, '..', 'migrations');
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      id BIGSERIAL PRIMARY KEY,
      filename VARCHAR(200) NOT NULL UNIQUE,
      checksum VARCHAR(64) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    )`);
    const { rows } = await client.query('SELECT filename, checksum FROM schema_migrations');
    const done = new Map(rows.map((r) => [r.filename, r.checksum]));

    const files = fs.readdirSync(dir).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
    let jumlah = 0;
    for (const file of files) {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      const sum = crypto.createHash('sha256').update(sql).digest('hex');
      if (done.has(file)) {
        if (done.get(file) !== sum) {
          throw new Error(`Migrasi ${file} sudah dijalankan tetapi isinya berubah. Migrasi lama tidak boleh diedit; buat file baru.`);
        }
        continue;
      }
      process.stdout.write(`Menjalankan ${file} ... `);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [file, sum]);
        await client.query('COMMIT');
        console.log('selesai');
        jumlah++;
      } catch (err) {
        await client.query('ROLLBACK');
        console.log('GAGAL');
        throw err;
      }
    }
    console.log(jumlah ? `${jumlah} migrasi dijalankan.` : 'Database sudah mutakhir.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Migrasi gagal:', err.message);
  process.exit(1);
});
