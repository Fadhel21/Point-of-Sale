// Membuat akun Pemilik pertama.
// Pemakaian: node scripts/buat-pemilik.js <username> <password> [nama]
const db = require('../config/db');
const users = require('../services/users');

async function main() {
  const [username, password, ...nama] = process.argv.slice(2);
  if (!username || !password) {
    console.log('Pemakaian: node scripts/buat-pemilik.js <username> <password> [nama lengkap]');
    process.exit(1);
  }
  const { rows } = await db.query('SELECT id FROM outlets WHERE deleted_at IS NULL ORDER BY id LIMIT 1');
  const id = await users.create({ name: nama.join(' ') || 'Pemilik', username, password, role: 'pemilik', outlet_id: rows[0] ? rows[0].id : null });
  console.log(`Akun pemilik "${username}" dibuat (id ${id}).`);
}

main()
  .catch((e) => { console.error('Gagal:', e.message); process.exitCode = 1; })
  .finally(() => db.pool.end());
