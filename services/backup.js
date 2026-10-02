// Cadangan data memakai pg_dump (format custom). Dipulihkan dengan pg_restore.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const dayjs = require('dayjs');
const config = require('../config');
const settings = require('./settings');
const { AppError } = require('../lib/errors');

function dir() {
  fs.mkdirSync(config.backupDir, { recursive: true });
  return config.backupDir;
}

function run() {
  return new Promise((resolve, reject) => {
    const nama = `pos-${dayjs().format('YYYYMMDD-HHmmss')}.dump`;
    const tujuan = path.join(dir(), nama);
    execFile(config.pgDumpPath, ['--format=custom', '--no-owner', `--file=${tujuan}`, `--dbname=${config.databaseUrl}`],
      { timeout: 10 * 60 * 1000, windowsHide: true },
      (err, _out, stderr) => {
        if (err) {
          try { fs.unlinkSync(tujuan); } catch (_) { /* abaikan */ }
          return reject(new AppError(`Cadangan gagal: ${(stderr || err.message).toString().trim().slice(0, 300)}`));
        }
        resolve(nama);
      });
  });
}

function list() {
  return fs.readdirSync(dir())
    .filter((f) => /^pos-\d{8}-\d{6}\.dump$/.test(f))
    .map((f) => { const st = fs.statSync(path.join(dir(), f)); return { nama: f, ukuran: st.size, waktu: st.mtime }; })
    .sort((a, b) => b.waktu - a.waktu);
}

/** Path aman untuk diunduh (nama divalidasi ketat agar tidak bisa keluar folder) */
function filePath(nama) {
  if (!/^pos-\d{8}-\d{6}\.dump$/.test(nama)) throw new AppError('Nama file tidak valid.', 404);
  const p = path.join(dir(), nama);
  if (!fs.existsSync(p)) throw new AppError('File tidak ditemukan.', 404);
  return p;
}

/** Hapus cadangan lebih lama dari pengaturan simpanHari */
async function prune() {
  const s = (await settings.get('cadangan')) || {};
  const hari = parseInt(s.simpanHari || '14', 10);
  const batas = Date.now() - hari * 86400000;
  for (const f of list()) if (f.waktu.getTime() < batas) fs.unlinkSync(path.join(dir(), f.nama));
}

module.exports = { run, list, filePath, prune };
