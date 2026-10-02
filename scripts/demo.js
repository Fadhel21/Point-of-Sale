// Mengisi akun & data demo (aman dijalankan berulang).
// Pemakaian: node scripts/demo.js
const db = require('../config/db');
const users = require('../services/users');
const products = require('../services/products');
const purchases = require('../services/purchases');
const customers = require('../services/customers');
const { AKUN_DEMO } = require('../lib/demo');

async function main() {
  const { rows: [outlet] } = await db.query('SELECT id FROM outlets WHERE deleted_at IS NULL ORDER BY id LIMIT 1');
  let pemilik = null;
  for (const a of AKUN_DEMO) {
    const ada = (await db.query('SELECT id FROM users WHERE lower(username)=lower($1) AND deleted_at IS NULL', [a.username])).rows[0];
    const id = ada ? ada.id : await users.create({ name: a.nama, username: a.username, password: a.password, role: a.role, outlet_id: outlet.id });
    if (ada) await users.update(id, { name: a.nama, username: a.username, password: a.password, role: a.role, outlet_id: outlet.id, active: true });
    console.log(`${ada ? 'Diperbarui' : 'Dibuat'}: ${a.username} / ${a.password} (${a.role})`);
    if (a.role === 'pemilik') pemilik = await users.findById(id);
  }

  const { rows: [{ n }] } = await db.query('SELECT count(*)::int n FROM products WHERE deleted_at IS NULL');
  if (n > 0) { console.log('Produk sudah ada, data contoh tidak ditambahkan.'); return; }

  const contoh = [
    ['KOPI-01', '8991001000011', 'Kopi Bubuk 200g', '18000', '25000', '5'],
    ['TEH-01', '8991001000028', 'Teh Celup isi 25', '6500', '9000', '10'],
    ['GULA-01', '8991001000035', 'Gula Pasir 1kg', '14000', '17500', '10'],
    ['MIE-01', '8991001000042', 'Mie Instan Goreng', '2600', '3500', '40'],
    ['AIR-01', '8991001000059', 'Air Mineral 600ml', '2000', '4000', '24'],
    ['SUSU-01', '8991001000066', 'Susu UHT 250ml', '4500', '6500', '12'],
    ['ROTI-01', '8991001000073', 'Roti Tawar', '11000', '15000', '5'],
    ['SABUN-01', '8991001000080', 'Sabun Mandi 85g', '3200', '4500', '12'],
  ];
  const items = [];
  for (const [sku, barcode, name, beli, jual, min] of contoh) {
    const id = await products.save(null, { sku, barcode, name, cost_price: beli, sell_price: jual, min_stock: min });
    items.push({ product_id: id, qty: '50', price: beli });
  }
  const { rows: [sup] } = await db.query("INSERT INTO suppliers (name, phone) VALUES ('Distributor Demo', '0800000000') RETURNING id");
  await purchases.receive({ supplierId: sup.id, outletId: outlet.id, items, paidNow: '0', invoiceNo: 'DEMO-001', user: pemilik });
  await customers.save(null, { name: 'Pelanggan Member Demo', phone: '081234567890', is_member: '1', credit_limit: '500000' });
  console.log(`${contoh.length} produk contoh dengan stok 50, 1 pemasok, dan 1 member dibuat.`);
}

main()
  .catch((e) => { console.error('Gagal:', e.message); process.exitCode = 1; })
  .finally(() => db.pool.end());
