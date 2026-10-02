// Uji integrasi alur uang & stok di database terpisah "<nama_db>_test".
// Database uji dibuat ulang dari nol setiap kali dijalankan.
const path = require('path');
const { spawnSync } = require('child_process');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const asli = process.env.DATABASE_URL;
if (!asli || asli.includes('GANTI_PASSWORD')) {
  console.log('DATABASE_URL belum diisi di .env — uji integrasi DILEWATI.');
  process.exit(0);
}
const u = new URL(asli);
const namaUji = `${u.pathname.slice(1) || 'pos'}_test`;
const urlUji = new URL(asli); urlUji.pathname = `/${namaUji}`;
const urlAdmin = new URL(asli); urlAdmin.pathname = '/postgres';

async function siapkanDb() {
  const c = new Client({ connectionString: urlAdmin.toString() });
  await c.connect();
  await c.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, [namaUji]);
  await c.query(`DROP DATABASE IF EXISTS "${namaUji}"`);
  await c.query(`CREATE DATABASE "${namaUji}"`);
  await c.end();
  const env = { ...process.env, DATABASE_URL: urlUji.toString() };
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'migrate.js')], { env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('Migrasi gagal: ' + r.stdout + r.stderr);
}

async function main() {
  await siapkanDb();
  process.env.DATABASE_URL = urlUji.toString();
  const assert = require('assert');
  const db = require('../config/db');
  const users = require('../services/users');
  const products = require('../services/products');
  const purchases = require('../services/purchases');
  const shifts = require('../services/shifts');
  const sales = require('../services/sales');
  const settings = require('../services/settings');
  const customers = require('../services/customers');
  const promo = require('../services/promo');
  const inventory = require('../services/inventory');
  const stock = require('../services/stock');
  const reports = require('../services/reports');
  const { v4: uuid } = require('uuid');

  const lulus = (m) => console.log('  ✓', m);
  const outletId = (await db.query('SELECT id FROM outlets LIMIT 1')).rows[0].id;
  const ownerId = await users.create({ name: 'Pemilik', username: 'bos', password: 'rahasia1', role: 'pemilik', outlet_id: outletId });
  const kasirId = await users.create({ name: 'Kasir', username: 'kasir', password: 'rahasia1', role: 'kasir', outlet_id: outletId });
  const owner = await users.findById(ownerId);
  const kasir = await users.findById(kasirId);

  // Produk & penerimaan barang (harga pokok rata-rata)
  const pA = await products.save(null, { name: 'Kopi', sku: 'KOPI', barcode: '899001', cost_price: '0', sell_price: '15000', min_stock: '5' });
  const pB = await products.save(null, { name: 'Gula', sku: 'GULA', cost_price: '0', sell_price: '3333.33' });
  const sup = (await db.query("INSERT INTO suppliers (name) VALUES ('PT Sumber') RETURNING id")).rows[0].id;
  await purchases.receive({ supplierId: sup, outletId, items: [{ product_id: pA, qty: '10', price: '10000' }, { product_id: pB, qty: '100', price: '2000' }], user: owner });
  await purchases.receive({ supplierId: sup, outletId, items: [{ product_id: pA, qty: '10', price: '12000' }], paidNow: '50000', user: owner });
  let a = await products.get(pA);
  assert.strictEqual(a.cost_price, '11000.00');
  assert.strictEqual(await stock.qtyOf(pA, outletId), '20.0000');
  assert.strictEqual((await purchases.getSupplier(sup)).payable, '370000.00');
  lulus('penerimaan: stok bertambah, HPP rata-rata 11.000, hutang 370.000');

  // Penjualan tanpa shift ditolak
  await assert.rejects(sales.create({ user: kasir, outletId, input: { idempotency_key: uuid(), items: [{ product_id: pA, qty: '1' }], payments: [{ method_code: 'TUNAI', amount: '20000' }] } }), /shift/i);
  await shifts.open({ userId: kasirId, outletId, openingCash: '100000' });
  lulus('penjualan tanpa shift ditolak');

  // Pajak 11% belum termasuk, tanpa pembulatan; angka kiriman browser diabaikan
  const kunci = uuid();
  const input = { idempotency_key: kunci, items: [{ product_id: pA, qty: '2', price: '1' }, { product_id: pB, qty: '3' }], total: '1', payments: [{ method_code: 'TUNAI', amount: '50000' }] };
  // subtotal = 30000 + 9999.99 = 39999.99 ; pajak = 4400.00 ; total = 44399.99
  const r1 = await sales.create({ user: kasir, outletId, input });
  const s1 = await sales.get(r1.id);
  assert.strictEqual(s1.subtotal, '39999.99');
  assert.strictEqual(s1.tax, '4400.00');
  assert.strictEqual(s1.total, '44399.99');
  assert.strictEqual(s1.change_amount, '5600.01');
  assert.strictEqual(s1.items[0].cost, '11000.00');
  assert.strictEqual(s1.items[0].product_name, 'Kopi');
  lulus('server menghitung ulang subtotal/pajak/total/kembalian (harga dari browser diabaikan)');

  // Idempotensi: kirim ulang & paralel dengan kunci sama -> satu transaksi
  const [d1, d2] = await Promise.all([sales.create({ user: kasir, outletId, input }), sales.create({ user: kasir, outletId, input })]);
  assert.strictEqual(String(d1.id), String(r1.id));
  assert.strictEqual(String(d2.id), String(r1.id));
  assert.strictEqual((await db.query('SELECT count(*)::int n FROM sales')).rows[0].n, 1);
  assert.strictEqual(await stock.qtyOf(pA, outletId), '18.0000');
  lulus('klik bayar ganda/paralel hanya menyimpan satu transaksi');

  // Salinan harga: ubah harga produk tidak mengubah transaksi lama
  await products.save(pA, { name: 'Kopi Baru', sku: 'KOPI', barcode: '899001', cost_price: '11000', sell_price: '99999', min_stock: '5' });
  const s1b = await sales.get(r1.id);
  assert.strictEqual(s1b.items[0].price, '15000.00');
  assert.strictEqual(s1b.items[0].product_name, 'Kopi');
  lulus('transaksi lama menyimpan salinan nama & harga');
  await products.save(pA, { name: 'Kopi', sku: 'KOPI', barcode: '899001', cost_price: '11000', sell_price: '15000', min_stock: '5' });

  // Atomik: pembayaran kurang -> tidak ada yang tersimpan, stok utuh
  await assert.rejects(sales.create({ user: kasir, outletId, input: { idempotency_key: uuid(), items: [{ product_id: pA, qty: '1' }], payments: [{ method_code: 'TUNAI', amount: '100' }] } }), /kurang/);
  await assert.rejects(sales.create({ user: kasir, outletId, input: { idempotency_key: uuid(), items: [{ product_id: pA, qty: '1000' }], payments: [{ method_code: 'TUNAI', amount: '99999999' }] } }), /Stok/);
  assert.strictEqual(await stock.qtyOf(pA, outletId), '18.0000');
  assert.strictEqual((await db.query('SELECT count(*)::int n FROM sales')).rows[0].n, 1);
  assert.strictEqual((await db.query("SELECT last_no FROM doc_counters WHERE doc_type='PJ'")).rows[0].last_no, 1);
  lulus('gagal di tengah -> ROLLBACK penuh (stok, nomor struk tidak bolong)');

  // Non-tunai tidak boleh menghasilkan kembalian
  await assert.rejects(sales.create({ user: kasir, outletId, input: { idempotency_key: uuid(), items: [{ product_id: pA, qty: '1' }], payments: [{ method_code: 'QRIS', amount: '20000' }] } }), /non-tunai/);
  lulus('pembayaran non-tunai melebihi total ditolak');

  // Pembulatan tunai & harga termasuk pajak
  await settings.set('pajak', { aktif: true, tarif: '11', termasuk: true });
  await settings.set('pembulatan', { aktif: true, kelipatan: '100', mode: 'terdekat' });
  const r2 = await sales.create({ user: kasir, outletId, input: { idempotency_key: uuid(), items: [{ product_id: pB, qty: '1' }], payments: [{ method_code: 'TUNAI', amount: '5000' }] } });
  const s2 = await sales.get(r2.id);
  // 3333.33 termasuk pajak: dpp = 3333.33 / 1.11 = 3003.00, pajak = 330.33, total tunai = 3300 (pembulatan -33.33)
  assert.strictEqual(s2.dpp, '3003.00');
  assert.strictEqual(s2.tax, '330.33');
  assert.strictEqual(s2.total, '3300.00');
  assert.strictEqual(s2.rounding, '-33.33');
  assert.strictEqual(s2.change_amount, '1700.00');
  assert.ok(s2.number.endsWith('-0002'));
  lulus('harga termasuk pajak + pembulatan tunai + nomor struk berurutan');

  // Split payment: kartu + tunai -> pembulatan karena ada tunai
  const r3 = await sales.create({ user: kasir, outletId, input: { idempotency_key: uuid(), items: [{ product_id: pA, qty: '1' }],
    payments: [{ method_code: 'DEBIT', amount: '10000' }, { method_code: 'TUNAI', amount: '10000' }] } });
  assert.strictEqual((await sales.get(r3.id)).change_amount, '5000.00');
  lulus('pembayaran lebih dari satu metode');

  // Member, poin, voucher, piutang
  const cust = await customers.save(null, { name: 'Budi', is_member: '1', credit_limit: '0' });
  await promo.saveVoucher(null, { code: 'HEMAT', disc_type: 'nominal', value: '5000', quota: '1', starts_at: '2000-01-01T00:00', ends_at: '2100-01-01T00:00', active: '1' });
  const r4 = await sales.create({ user: kasir, outletId, input: { idempotency_key: uuid(), customer_id: cust, voucher_code: 'hemat',
    items: [{ product_id: pA, qty: '2' }], payments: [{ method_code: 'PIUTANG', amount: '25000' }] } });
  const s4 = await sales.get(r4.id);
  assert.strictEqual(s4.voucher_discount, '5000.00');
  assert.strictEqual(s4.total, '25000.00');
  assert.strictEqual(s4.points_earned, '2.00');
  let c = await customers.get(cust);
  assert.strictEqual(c.points, '2.00');
  assert.strictEqual(c.receivable, '25000.00');
  await assert.rejects(sales.create({ user: kasir, outletId, input: { idempotency_key: uuid(), voucher_code: 'HEMAT', items: [{ product_id: pA, qty: '1' }], payments: [{ method_code: 'TUNAI', amount: '20000' }] } }), /Kuota/);
  lulus('voucher (kuota habis ditolak), poin member, penjualan piutang');

  // Void: hanya dengan supervisor, mengembalikan stok, voucher, poin, piutang
  await assert.rejects(sales.voidSale({ id: r4.id, user: kasir, reason: 'salah input', supervisorUsername: 'kasir', supervisorPassword: 'rahasia1' }), /supervisor/);
  const stokSebelum = await stock.qtyOf(pA, outletId);
  await sales.voidSale({ id: r4.id, user: kasir, reason: 'salah input', supervisorUsername: 'bos', supervisorPassword: 'rahasia1' });
  c = await customers.get(cust);
  assert.strictEqual(c.points, '0.00');
  assert.strictEqual(c.receivable, '0.00');
  assert.strictEqual((await db.query("SELECT used FROM vouchers WHERE code='HEMAT'")).rows[0].used, 0);
  assert.strictEqual((await stock.qtyOf(pA, outletId)), (BigInt(stokSebelum.replace('.', '')) + 20000n).toString().replace(/(\d{4})$/, '.$1'));
  lulus('void butuh supervisor & membalik stok, voucher, poin, piutang');

  // Retur sebagian: refund proporsional, total retur penuh = yang dibayar
  const r5 = await sales.create({ user: kasir, outletId, input: { idempotency_key: uuid(), trx_disc_type: 'nominal', trx_disc_value: '1000',
    items: [{ product_id: pB, qty: '3' }], payments: [{ method_code: 'TUNAI', amount: '10000' }] } });
  const s5 = await sales.get(r5.id);
  const itemId = s5.items[0].id;
  const ret1 = await sales.createReturn({ saleId: r5.id, user: owner, items: [{ sale_item_id: itemId, qty: '1' }], reason: 'rusak', refundMethod: 'TUNAI' })
    .catch((e) => e);
  assert.ok(ret1 instanceof Error && /shift/.test(ret1.message), 'retur tunai tanpa shift pemilik harus ditolak');
  const retA = await sales.createReturn({ saleId: r5.id, user: kasir, items: [{ sale_item_id: itemId, qty: '1' }], reason: 'rusak', refundMethod: 'TUNAI', supervisorUsername: 'bos', supervisorPassword: 'rahasia1' });
  const retB = await sales.createReturn({ saleId: r5.id, user: kasir, items: [{ sale_item_id: itemId, qty: '2' }], reason: 'rusak', refundMethod: 'TUNAI', supervisorUsername: 'bos', supervisorPassword: 'rahasia1' });
  const dibayar = (await db.query('SELECT total - rounding AS v FROM sales WHERE id=$1', [r5.id])).rows[0].v;
  const { rows: [jml] } = await db.query('SELECT ($1::numeric + $2::numeric) AS v', [retA.total, retB.total]);
  assert.strictEqual(jml.v, dibayar);
  await assert.rejects(sales.createReturn({ saleId: r5.id, user: kasir, items: [{ sale_item_id: itemId, qty: '1' }], reason: 'lagi', refundMethod: 'TUNAI', supervisorUsername: 'bos', supervisorPassword: 'rahasia1' }), /melebihi/);
  lulus('retur sebagian proporsional; total retur penuh = yang dibayar; retur berlebih ditolak');

  // Tutup shift: kas seharusnya dihitung dari modal + tunai bersih - retur tunai
  const ring = await shifts.ringkasan((await shifts.current(kasirId)).id);
  // modal 100000 + tunai bersih (r1 44399.99, r2 3300, r3 5000 karena 10000 tunai - 5000 kembalian, r5) - retur tunai
  const { rows: [harap] } = await db.query(
    `SELECT 100000 + 44399.99 + 3300 + 5000 + (SELECT total FROM sales WHERE id=$1) - $2::numeric - $3::numeric AS v`, [r5.id, retA.total, retB.total]);
  assert.strictEqual(ring.expected_now, harap.v);
  await shifts.close({ userId: kasirId, countedCash: harap.v });
  const tutup = await shifts.ringkasan(ring.id);
  assert.strictEqual(tutup.difference, '0.00');
  lulus('kas seharusnya & selisih shift benar');

  // Opname & laporan
  const op = await inventory.createOpname({ outletId, user: owner });
  const o = await inventory.getOpname(op);
  const itA = o.items.find((i) => String(i.product_id) === String(pA));
  await inventory.saveCounts(op, { [itA.id]: '10' }, true);
  await inventory.approveOpname({ id: op, approve: true, user: owner });
  assert.strictEqual(await stock.qtyOf(pA, outletId), '10.0000');
  lulus('stok opname menyesuaikan stok sebesar selisih');

  const lap = await reports.DAFTAR.penjualan.fn({ from: '2000-01-01', to: '2100-01-01', outletId });
  assert.ok(lap.baris.length >= 1);
  const lapMetode = await reports.DAFTAR.pembayaran.fn({ from: '2000-01-01', to: '2100-01-01', outletId });
  const tunai = lapMetode.baris.find((b) => b.metode === 'Tunai');
  assert.ok(tunai);
  for (const k of Object.keys(reports.DAFTAR)) await reports.DAFTAR[k].fn({ from: '2000-01-01', to: '2100-01-01', outletId, lihatLaba: true, lihatHargaBeli: true });
  lulus('semua laporan berjalan');

  await db.pool.end();
  console.log('Semua uji integrasi lulus.');
}

main().catch((e) => { console.error('UJI GAGAL:', e); process.exit(1); });
