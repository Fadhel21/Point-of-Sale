// Uji halaman web lewat HTTP sungguhan, memakai database uji yang disiapkan transaksi.test.js.
// Login sebagai tiap peran, buka semua halaman menu, jalankan alur kasir lewat API.
const path = require('path');
const assert = require('assert');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const asli = process.env.DATABASE_URL;
if (!asli || asli.includes('GANTI_PASSWORD')) {
  console.log('DATABASE_URL belum diisi di .env — uji web DILEWATI.');
  process.exit(0);
}
const u = new URL(asli);
u.pathname = `/${u.pathname.slice(1) || 'pos'}_test`;
process.env.DATABASE_URL = u.toString();

const app = require('../app');
const db = require('../config/db');
const { menuUntuk } = require('../lib/akses');

let server; let base;

async function req(jar, method, url, body, json, extraHeaders) {
  const headers = { Cookie: jar.cookie || '', Origin: base, ...(extraHeaders || {}) };
  let data;
  if (body && json) { headers['Content-Type'] = 'application/json'; headers.Accept = 'application/json'; data = JSON.stringify(body); }
  else if (body) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; data = new URLSearchParams(body).toString(); }
  const r = await fetch(base + url, { method, headers, body: data, redirect: 'manual' });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  for (const c of set) {
    const [kv] = c.split(';');
    const [k] = kv.split('=');
    jar.map = jar.map || {};
    jar.map[k] = kv;
    jar.cookie = Object.values(jar.map).join('; ');
  }
  return { status: r.status, lokasi: r.headers.get('location'), teks: await r.text() };
}

async function login(username) {
  const jar = {};
  // Tiru Chrome: submit form dengan Origin "null" + Sec-Fetch-Site same-origin
  const r = await req(jar, 'POST', '/login', { username, password: 'rahasia1', next: '/' }, false, { Origin: 'null', 'Sec-Fetch-Site': 'same-origin' });
  assert.strictEqual(r.status, 302, `login ${username} gagal`);
  return jar;
}

async function main() {
  await new Promise((ok) => { server = app.listen(0, ok); });
  base = `http://127.0.0.1:${server.address().port}`;
  const lulus = (m) => console.log('  ✓', m);

  // Pengguna tambahan untuk peran manajer & gudang
  const users = require('../services/users');
  const outletId = (await db.query('SELECT id FROM outlets LIMIT 1')).rows[0].id;
  for (const role of ['manajer', 'gudang']) {
    await users.create({ name: role, username: role, password: 'rahasia1', role, outlet_id: outletId }).catch(() => {});
  }

  // Semua halaman menu untuk tiap peran harus tampil tanpa error
  const ids = (await db.query(`SELECT (SELECT max(id) FROM sales) s, (SELECT max(id) FROM products) p, (SELECT max(id) FROM customers) c,
    (SELECT max(id) FROM shifts) sh, (SELECT max(id) FROM stock_opnames) op, (SELECT max(id) FROM goods_receipts) g,
    (SELECT max(id) FROM sale_returns) r`)).rows[0];
  const ekstra = [`/transaksi/${ids.s}`, `/transaksi/${ids.s}/struk`, `/transaksi/${ids.s}/retur`, `/produk/${ids.p}`, '/produk/baru',
    `/produk/baru?parent=${ids.p}`, '/produk/impor', `/produk/label?jumlah[${ids.p}]=2`, `/pelanggan/${ids.c}`, `/shift/${ids.sh}`,
    `/persediaan/opname/${ids.op}`, `/persediaan/kartu?product_id=${ids.p}`, `/pembelian/penerimaan/${ids.g}`, '/pembelian/po/baru',
    '/pembelian/po/baru?minimum=1', '/pembelian/penerimaan/baru', '/pembelian/retur/baru', `/pembelian/retur/baru?penerimaan=${ids.g}`,
    `/transaksi/retur/${ids.r}`, '/akun', '/?hari=30', '/laporan/penjualan?grup=bulan', '/laporan/produk?grup=kategori',
    '/laporan/penjualan?format=csv', '/laporan/laba?format=pdf', '/produk/ekspor'];

  for (const [username, role] of [['bos', 'pemilik'], ['manajer', 'manajer'], ['kasir', 'kasir'], ['gudang', 'gudang']]) {
    const jar = await login(username);
    const urls = ['/'];
    for (const m of menuUntuk(role)) { if (m.href) urls.push(m.href); for (const a of m.anak || []) urls.push(a.href); }
    if (role === 'pemilik') urls.push(...ekstra);
    for (const url of urls) {
      const r = await req(jar, 'GET', url);
      assert.ok(r.status === 200, `${role} ${url} -> ${r.status} ${r.teks.slice(0, 300)}`);
      assert.ok(!/Terjadi kesalahan pada server/.test(r.teks), `${role} ${url} error server`);
    }
    lulus(`${role}: ${urls.length} halaman tampil tanpa error`);
  }

  // Kasir tidak boleh membuka pengaturan/laporan, dan tidak melihat harga beli
  const kasir = await login('kasir');
  assert.strictEqual((await req(kasir, 'GET', '/pengaturan/toko')).status, 403);
  assert.strictEqual((await req(kasir, 'GET', '/laporan/laba')).status, 403);
  const cari = JSON.parse((await req(kasir, 'GET', '/produk/cari?q=KOPI')).teks);
  assert.strictEqual(cari.rows[0].cost_price, null);
  lulus('kasir ditolak di pengaturan & laporan laba, harga beli disembunyikan');

  // Alur kasir lewat API JSON
  await req(kasir, 'POST', '/shift/buka', { opening_cash: '50000' });
  const hasilCari = JSON.parse((await req(kasir, 'GET', '/kasir/cari?q=899001')).teks);
  assert.ok(hasilCari.rows[0].exact, 'scan barcode harus menemukan produk persis');
  const pid = hasilCari.rows[0].id;
  const hitung = JSON.parse((await req(kasir, 'POST', '/kasir/hitung', { items: [{ product_id: pid, qty: '2' }] }, true)).teks);
  assert.ok(hitung.ok && hitung.hasil.total);
  const kunci = require('uuid').v4();
  const bayar = { idempotency_key: kunci, items: [{ product_id: pid, qty: '1' }], payments: [{ method_code: 'TUNAI', amount: '100000' }] };
  const b1 = JSON.parse((await req(kasir, 'POST', '/kasir/bayar', bayar, true)).teks);
  const b2 = JSON.parse((await req(kasir, 'POST', '/kasir/bayar', bayar, true)).teks);
  assert.ok(b1.ok && b1.number, JSON.stringify(b1));
  assert.strictEqual(String(b2.id), String(b1.id));
  const salah = JSON.parse((await req(kasir, 'POST', '/kasir/bayar', { ...bayar, idempotency_key: require('uuid').v4(), payments: [{ method_code: 'TUNAI', amount: '1' }] }, true)).teks);
  assert.strictEqual(salah.ok, false);
  assert.ok(/kurang/.test(salah.pesan));
  const struk = await req(kasir, 'GET', `/transaksi/${b1.id}/struk`);
  assert.ok(struk.teks.includes(b1.number));
  const tahan = JSON.parse((await req(kasir, 'POST', '/kasir/tahan', { items: [{ product_id: pid, qty: '1', name: 'Kopi' }], label: 'meja 1' }, true)).teks);
  const ambil = JSON.parse((await req(kasir, 'GET', `/kasir/ditahan/${tahan.id}`)).teks);
  assert.strictEqual(ambil.payload.items.length, 1);
  lulus('kasir: scan, hitung, bayar (idempoten), bayar kurang ditolak, struk, tahan & lanjutkan');

  // Permintaan dari situs lain ditolak (CSRF)
  const r = await fetch(base + '/kasir/tahan', { method: 'POST', headers: { Cookie: kasir.cookie, Origin: 'http://jahat.example', 'Content-Type': 'application/json' }, body: '{}' });
  assert.strictEqual(r.status, 403);
  const r2 = await fetch(base + '/kasir/tahan', { method: 'POST', headers: { Cookie: kasir.cookie, Origin: 'null', 'Sec-Fetch-Site': 'cross-site', 'Content-Type': 'application/json' }, body: '{}' });
  assert.strictEqual(r2.status, 403);
  lulus('POST dari origin lain / cross-site ditolak; Origin null dari situs sendiri diterima');

  server.close();
  await db.pool.end();
  console.log('Semua uji web lulus.');
}

main().catch((e) => { console.error('UJI GAGAL:', e.message); if (server) server.close(); process.exit(1); });
