// Produk, varian, satuan bertingkat, impor/ekspor CSV
const db = require('../config/db');
const { simpanGambar } = require('./uploads');
const { AppError } = require('../lib/errors');
const { toSen, toQty, senToStr, qtyToStr } = require('../lib/money');
const { parseCsv, toCsv } = require('../lib/csv');

const SELECT = `
  SELECT p.*, c.name AS category_name, b.name AS brand_name, u.name AS unit_name,
         pp.name AS parent_name
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN brands b ON b.id = p.brand_id
  LEFT JOIN units u ON u.id = p.unit_id
  LEFT JOIN products pp ON pp.id = p.parent_id`;

async function list({ q, categoryId, brandId, active, page = 1, perPage = 50, outletId }) {
  const p = [];
  const w = ['p.deleted_at IS NULL'];
  if (q) { p.push(`%${q}%`); w.push(`(p.name ILIKE $${p.length} OR p.sku ILIKE $${p.length} OR p.barcode ILIKE $${p.length})`); }
  if (categoryId) { p.push(categoryId); w.push(`p.category_id = $${p.length}`); }
  if (brandId) { p.push(brandId); w.push(`p.brand_id = $${p.length}`); }
  if (active === '1') w.push('p.active'); else if (active === '0') w.push('NOT p.active');
  const { rows: [{ n }] } = await db.query(`SELECT count(*)::int n FROM products p WHERE ${w.join(' AND ')}`, p);
  let stokJoin = '';
  if (outletId) { p.push(outletId); stokJoin = `, (SELECT qty FROM stocks s WHERE s.product_id = p.id AND s.outlet_id = $${p.length}) AS stok`; }
  p.push(perPage, (page - 1) * perPage);
  const sql = `SELECT p.*, c.name AS category_name, b.name AS brand_name, u.name AS unit_name ${stokJoin}
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN brands b ON b.id = p.brand_id
     LEFT JOIN units u ON u.id = p.unit_id
     WHERE ${w.join(' AND ')}
     ORDER BY p.name, p.variant_name NULLS FIRST LIMIT $${p.length - 1} OFFSET $${p.length}`;
  const r = await db.query(sql, p);
  return { rows: r.rows, total: n };
}

async function get(id, client) {
  const { rows } = await (client || db).query(`${SELECT} WHERE p.id = $1 AND p.deleted_at IS NULL`, [id]);
  if (!rows[0]) return null;
  const prod = rows[0];
  const u = await (client || db).query(
    `SELECT pu.*, u.name AS unit_name FROM product_units pu JOIN units u ON u.id = pu.unit_id
     WHERE pu.product_id = $1 AND pu.deleted_at IS NULL ORDER BY pu.factor`, [id]);
  prod.units = u.rows;
  const v = await (client || db).query(
    'SELECT id, sku, barcode, variant_name, sell_price, active FROM products WHERE parent_id = $1 AND deleted_at IS NULL ORDER BY variant_name', [id]);
  prod.variants = v.rows;
  const g = await (client || db).query(
    'SELECT * FROM wholesale_prices WHERE product_id = $1 AND deleted_at IS NULL ORDER BY min_qty', [id]);
  prod.wholesale = g.rows;
  return prod;
}

function normalisasi(d) {
  if (!d.name || !String(d.name).trim()) throw new AppError('Nama produk wajib diisi.');
  if (!d.sku || !String(d.sku).trim()) throw new AppError('Kode/SKU wajib diisi.');
  const cost = toSen(d.cost_price || 0);
  const sell = toSen(d.sell_price || 0);
  const min = toQty(d.min_stock || 0);
  if (cost < 0n || sell < 0n || min < 0n) throw new AppError('Harga dan stok minimum tidak boleh negatif.');
  return {
    name: String(d.name).trim(),
    sku: String(d.sku).trim(),
    barcode: d.barcode ? String(d.barcode).trim() : null,
    category_id: d.category_id || null,
    brand_id: d.brand_id || null,
    unit_id: d.unit_id || null,
    cost_price: senToStr(cost),
    sell_price: senToStr(sell),
    min_stock: qtyToStr(min),
    active: d.active === undefined ? true : d.active === true || d.active === 'on' || d.active === '1' || d.active === 'true',
    parent_id: d.parent_id || null,
    variant_name: d.variant_name ? String(d.variant_name).trim() : null,
  };
}

function pesanUnik(e) {
  if (e.code === '23505') {
    if (/barcode/.test(e.constraint || '')) return new AppError('Barcode sudah dipakai produk lain.');
    return new AppError('Kode/SKU sudah dipakai produk lain.');
  }
  return e;
}

/**
 * Simpan produk beserta satuan bertingkat & harga grosir.
 * d.units: [{unit_id, factor, barcode, sell_price}], d.wholesale: [{min_qty, price}]
 */
async function save(id, d, { canSeeCost = true } = {}) {
  const n = normalisasi(d);
  const foto = d.photo_data ? simpanGambar(d.photo_data, 'produk') : undefined;
  return db.withTransaction(async (client) => {
    try {
      let pid = id;
      if (id) {
        const lama = await client.query('SELECT cost_price FROM products WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [id]);
        if (!lama.rows[0]) throw new AppError('Produk tidak ditemukan.', 404);
        // Pengguna tanpa akses harga beli tidak boleh mengubahnya
        if (!canSeeCost) n.cost_price = lama.rows[0].cost_price;
        await client.query(
          `UPDATE products SET name=$1, sku=$2, barcode=$3, category_id=$4, brand_id=$5, unit_id=$6, cost_price=$7,
             sell_price=$8, min_stock=$9, active=$10, variant_name=$11 ${foto ? ', photo=$13' : ''}
           WHERE id=$12`,
          [n.name, n.sku, n.barcode, n.category_id, n.brand_id, n.unit_id, n.cost_price, n.sell_price, n.min_stock, n.active, n.variant_name, id, ...(foto ? [foto] : [])]);
      } else {
        if (!canSeeCost) n.cost_price = '0.00';
        const { rows } = await client.query(
          `INSERT INTO products (name, sku, barcode, category_id, brand_id, unit_id, cost_price, sell_price, min_stock, active, parent_id, variant_name, photo)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
          [n.name, n.sku, n.barcode, n.category_id, n.brand_id, n.unit_id, n.cost_price, n.sell_price, n.min_stock, n.active, n.parent_id, n.variant_name, foto || null]);
        pid = rows[0].id;
      }

      if (Array.isArray(d.units)) {
        await client.query('UPDATE product_units SET deleted_at = now() WHERE product_id=$1 AND deleted_at IS NULL', [pid]);
        for (const u of d.units) {
          if (!u.unit_id) continue;
          const f = toQty(u.factor);
          if (f <= 0n) throw new AppError('Faktor konversi satuan harus lebih dari 0.');
          await client.query(
            'INSERT INTO product_units (product_id, unit_id, factor, barcode, sell_price) VALUES ($1,$2,$3,$4,$5)',
            [pid, u.unit_id, qtyToStr(f), u.barcode || null, senToStr(toSen(u.sell_price || 0))]);
        }
      }
      if (Array.isArray(d.wholesale)) {
        await client.query('UPDATE wholesale_prices SET deleted_at = now() WHERE product_id=$1 AND deleted_at IS NULL', [pid]);
        for (const g of d.wholesale) {
          if (!g.min_qty) continue;
          const q = toQty(g.min_qty);
          const pr = toSen(g.price);
          if (q <= 0n || pr < 0n) throw new AppError('Harga grosir tidak valid.');
          await client.query('INSERT INTO wholesale_prices (product_id, min_qty, price) VALUES ($1,$2,$3)', [pid, qtyToStr(q), senToStr(pr)]);
        }
      }
      return pid;
    } catch (e) {
      throw pesanUnik(e);
    }
  });
}

async function remove(id) {
  await db.query('UPDATE products SET deleted_at = now(), active = false WHERE (id = $1 OR parent_id = $1) AND deleted_at IS NULL', [id]);
}

/**
 * Pencarian cepat untuk layar kasir: barcode persis (produk atau satuan) dulu, lalu nama/SKU.
 * Mengembalikan baris yang siap dimasukkan ke keranjang.
 */
async function searchForPos(q, outletId, limit = 20) {
  q = String(q || '').trim();
  if (!q) return [];
  const exact = await db.query(
    `SELECT p.id, p.name, p.variant_name, p.sku, p.barcode, p.sell_price AS price, NULL::bigint AS unit_id, u.name AS unit_name, 1 AS factor,
            COALESCE(s.qty,0) AS stok, p.photo
     FROM products p LEFT JOIN units u ON u.id = p.unit_id
     LEFT JOIN stocks s ON s.product_id = p.id AND s.outlet_id = $2
     WHERE p.deleted_at IS NULL AND p.active AND (p.barcode = $1 OR lower(p.sku) = lower($1))
       AND NOT EXISTS (SELECT 1 FROM products c WHERE c.parent_id = p.id AND c.deleted_at IS NULL)
     UNION ALL
     SELECT p.id, p.name, p.variant_name, p.sku, pu.barcode, pu.sell_price, pu.unit_id, u.name, pu.factor, COALESCE(s.qty,0), p.photo
     FROM product_units pu JOIN products p ON p.id = pu.product_id JOIN units u ON u.id = pu.unit_id
     LEFT JOIN stocks s ON s.product_id = p.id AND s.outlet_id = $2
     WHERE pu.deleted_at IS NULL AND p.deleted_at IS NULL AND p.active AND pu.barcode = $1`, [q, outletId]);
  if (exact.rows.length) return exact.rows.map((r) => ({ ...r, exact: true }));
  const { rows } = await db.query(
    `SELECT p.id, p.name, p.variant_name, p.sku, p.barcode, p.sell_price AS price, NULL::bigint AS unit_id, u.name AS unit_name, 1 AS factor,
            COALESCE(s.qty,0) AS stok, p.photo
     FROM products p LEFT JOIN units u ON u.id = p.unit_id
     LEFT JOIN stocks s ON s.product_id = p.id AND s.outlet_id = $2
     WHERE p.deleted_at IS NULL AND p.active
       AND NOT EXISTS (SELECT 1 FROM products c WHERE c.parent_id = p.id AND c.deleted_at IS NULL)
       AND (p.name ILIKE $1 OR p.sku ILIKE $1 OR p.variant_name ILIKE $1)
     ORDER BY p.name, p.variant_name LIMIT $3`, [`%${q}%`, outletId, limit]);
  return rows;
}

/** Satuan alternatif untuk produk (dipakai di keranjang kasir) */
async function unitsFor(productIds) {
  if (!productIds.length) return [];
  const { rows } = await db.query(
    `SELECT pu.product_id, pu.unit_id, u.name AS unit_name, pu.factor FROM product_units pu JOIN units u ON u.id = pu.unit_id
     WHERE pu.product_id = ANY($1::bigint[]) AND pu.deleted_at IS NULL ORDER BY pu.factor`, [productIds]);
  return rows;
}

const KOLOM_CSV = ['sku', 'barcode', 'nama', 'varian', 'kategori', 'merek', 'satuan', 'harga_beli', 'harga_jual', 'stok_minimum', 'aktif'];

async function exportCsv({ includeCost }) {
  const { rows } = await db.query(
    `SELECT p.sku, p.barcode, p.name, p.variant_name, c.name AS kategori, b.name AS merek, u.name AS satuan,
            p.cost_price, p.sell_price, p.min_stock, p.active
     FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN brands b ON b.id = p.brand_id
     LEFT JOIN units u ON u.id = p.unit_id WHERE p.deleted_at IS NULL ORDER BY p.name`);
  const kolom = includeCost ? KOLOM_CSV : KOLOM_CSV.filter((k) => k !== 'harga_beli');
  return toCsv(kolom, rows.map((r) => {
    const o = { sku: r.sku, barcode: r.barcode, nama: r.name, varian: r.variant_name, kategori: r.kategori, merek: r.merek,
      satuan: r.satuan, harga_beli: r.cost_price, harga_jual: r.sell_price, stok_minimum: r.min_stock, aktif: r.active ? '1' : '0' };
    return o;
  }));
}

/** Cari atau buat master (kategori/merek/satuan) berdasarkan nama, di dalam transaksi */
async function idMaster(client, table, name, cache) {
  if (!name) return null;
  const key = `${table}:${name.toLowerCase()}`;
  if (cache.has(key)) return cache.get(key);
  let { rows } = await client.query(`SELECT id FROM ${table} WHERE lower(name) = lower($1) AND deleted_at IS NULL LIMIT 1`, [name]);
  if (!rows[0]) ({ rows } = await client.query(`INSERT INTO ${table} (name) VALUES ($1) RETURNING id`, [name]));
  cache.set(key, rows[0].id);
  return rows[0].id;
}

/** Impor CSV: produk dengan SKU yang sama diperbarui, selain itu dibuat baru. Semua atau tidak sama sekali. */
async function importCsv(text, { canSeeCost }) {
  const data = parseCsv(text);
  if (!data.length) throw new AppError('File CSV kosong.');
  const header = Object.keys(data[0]);
  for (const k of ['sku', 'nama', 'harga_jual']) if (!header.includes(k)) throw new AppError(`Kolom "${k}" wajib ada di CSV.`);
  return db.withTransaction(async (client) => {
    const cache = new Map();
    let baru = 0; let ubah = 0;
    for (let i = 0; i < data.length; i++) {
      const r = data[i];
      const baris = i + 2;
      try {
        const n = normalisasi({
          sku: r.sku, barcode: r.barcode, name: r.nama, variant_name: r.varian,
          cost_price: r.harga_beli || 0, sell_price: r.harga_jual, min_stock: r.stok_minimum || 0,
          active: r.aktif === undefined || r.aktif === '' ? true : ['1', 'ya', 'true', 'aktif'].includes(String(r.aktif).toLowerCase()),
        });
        n.category_id = await idMaster(client, 'categories', r.kategori, cache);
        n.brand_id = await idMaster(client, 'brands', r.merek, cache);
        n.unit_id = await idMaster(client, 'units', r.satuan, cache);
        const ada = await client.query('SELECT id FROM products WHERE lower(sku)=lower($1) AND deleted_at IS NULL', [n.sku]);
        if (ada.rows[0]) {
          await client.query(
            `UPDATE products SET barcode=$1, name=$2, variant_name=$3, category_id=$4, brand_id=$5, unit_id=$6,
               sell_price=$7, min_stock=$8, active=$9 ${canSeeCost && r.harga_beli !== undefined ? ', cost_price=$11' : ''} WHERE id=$10`,
            [n.barcode, n.name, n.variant_name, n.category_id, n.brand_id, n.unit_id, n.sell_price, n.min_stock, n.active, ada.rows[0].id,
              ...(canSeeCost && r.harga_beli !== undefined ? [n.cost_price] : [])]);
          ubah++;
        } else {
          await client.query(
            `INSERT INTO products (sku, barcode, name, variant_name, category_id, brand_id, unit_id, cost_price, sell_price, min_stock, active)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [n.sku, n.barcode, n.name, n.variant_name, n.category_id, n.brand_id, n.unit_id, canSeeCost ? n.cost_price : '0.00', n.sell_price, n.min_stock, n.active]);
          baru++;
        }
      } catch (e) {
        const err = pesanUnik(e);
        throw new AppError(`Baris ${baris}: ${err.expose ? err.message : 'data tidak valid'}`);
      }
    }
    return { baru, ubah };
  });
}

module.exports = { list, get, save, remove, searchForPos, unitsFor, exportCsv, importCsv };
