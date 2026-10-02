// Proses worker terpisah untuk job terjadwal (node-cron).
// Jalankan: node worker/index.js
const cron = require('node-cron');
const config = require('../config');
const db = require('../config/db');
const settings = require('../services/settings');
const backup = require('../services/backup');
const stock = require('../services/stock');
const mailer = require('../services/mailer');
const audit = require('../services/audit');
const { angka } = require('../lib/money');

const log = (...a) => console.log(new Date().toISOString(), ...a);

// Cegah job yang sama berjalan dobel (mis. dua worker aktif) dengan advisory lock
async function denganKunci(nama, fn) {
  const client = await db.pool.connect();
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock(hashtextextended($1, 1)) AS ok', [nama]);
    if (!rows[0].ok) { log(`[${nama}] dilewati: sedang berjalan di proses lain`); return; }
    try { await fn(); } finally { await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 1))', [nama]); }
  } catch (e) {
    log(`[${nama}] GAGAL:`, e.message);
    await audit.log(null, { action: `job.${nama}.gagal`, data: { pesan: e.message } }).catch(() => {});
  } finally {
    client.release();
  }
}

async function jobCadangan() {
  await denganKunci('cadangan', async () => {
    const nama = await backup.run();
    await backup.prune();
    log('[cadangan] dibuat', nama);
    await audit.log(null, { action: 'job.cadangan', data: { file: nama } });
  });
}

async function jobStokMinimum() {
  await denganKunci('stok-minimum', async () => {
    const rows = await stock.lowStock(null, 500);
    if (!rows.length) return log('[stok-minimum] semua aman');
    if (!mailer.siap()) return log(`[stok-minimum] ${rows.length} produk menipis; email belum dikonfigurasi`);
    const { rows: penerima } = await db.query(
      "SELECT email FROM users WHERE deleted_at IS NULL AND active AND role IN ('pemilik','manajer','gudang') AND email IS NOT NULL AND email <> ''");
    if (!penerima.length) return log('[stok-minimum] tidak ada penerima email');
    const toko = (await settings.get('toko')) || {};
    const baris = rows.map((r) => `<tr><td>${esc(r.outlet_name)}</td><td>${esc(r.sku)}</td><td>${esc(r.name)}${r.variant_name ? ' - ' + esc(r.variant_name) : ''}</td>
      <td style="text-align:right">${angka(r.qty)}</td><td style="text-align:right">${angka(r.min_stock)}</td></tr>`).join('');
    const html = `<p>${rows.length} produk berada di bawah stok minimum:</p>
      <table border="1" cellpadding="4" cellspacing="0"><tr><th>Outlet</th><th>SKU</th><th>Produk</th><th>Stok</th><th>Minimum</th></tr>${baris}</table>`;
    for (const p of penerima) await mailer.kirim({ to: p.email, subject: `[${toko.nama || 'POS'}] Peringatan stok minimum`, html });
    log(`[stok-minimum] email terkirim ke ${penerima.length} penerima`);
  });
}

// Transaksi ditahan lebih dari 7 hari dibersihkan (soft delete)
async function jobBersihkan() {
  await denganKunci('bersihkan', async () => {
    const { rowCount } = await db.query("UPDATE held_sales SET deleted_at = now() WHERE deleted_at IS NULL AND created_at < now() - interval '7 days'");
    if (rowCount) log(`[bersihkan] ${rowCount} transaksi ditahan kedaluwarsa dihapus`);
  });
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

async function main() {
  await db.query('SELECT 1');
  const c = (await settings.get('cadangan')) || {};
  const opsi = { timezone: config.timezone };
  if (c.aktif !== false) {
    const [jam, menit] = String(c.jam || '23:30').split(':').map((x) => parseInt(x, 10));
    cron.schedule(`${menit} ${jam} * * *`, jobCadangan, opsi);
    log(`Cadangan harian dijadwalkan pukul ${c.jam || '23:30'}`);
  }
  cron.schedule('0 7 * * *', jobStokMinimum, opsi);
  cron.schedule('15 3 * * *', jobBersihkan, opsi);
  log('Worker POS berjalan. Job: cadangan harian, peringatan stok minimum (07:00), pembersihan (03:15).');

  if (process.argv.includes('--sekarang')) {
    await jobStokMinimum();
    await jobCadangan();
  }
}

main().catch((e) => {
  console.error('Worker gagal dijalankan:', e.message);
  process.exit(1);
});
