// Konfigurasi aplikasi dari .env
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

function wajib(nama) {
  const v = process.env[nama];
  if (!v) throw new Error(`Variabel lingkungan ${nama} belum diisi di .env`);
  return v;
}

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  databaseUrl: wajib('DATABASE_URL'),
  dbPoolMax: parseInt(process.env.DB_POOL_MAX || '10', 10),
  jwtSecret: wajib('JWT_SECRET'),
  cookieSecret: wajib('COOKIE_SECRET'),
  sessionHours: parseInt(process.env.SESSION_HOURS || '12', 10),
  timezone: process.env.TZ_TOKO || 'Asia/Jakarta',
  rootDir: path.join(__dirname, '..'),
  uploadDir: path.join(__dirname, '..', 'uploads'),
  backupDir: process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups'),
  pgDumpPath: process.env.PG_DUMP_PATH || 'pg_dump',
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || '',
  },
};
