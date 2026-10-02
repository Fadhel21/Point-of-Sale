// Laporan. Semua agregasi uang dilakukan di SQL (NUMERIC), bukan di JavaScript.
// Setiap laporan mengembalikan { judul, kolom, baris, total } agar bisa ditampilkan, diekspor CSV, dan PDF.
const db = require('../config/db');
const M = require('../lib/money');

// Penjualan bersih tanpa pajak per item
const NET_ITEM = `(si.line_total - si.trx_discount_share - CASE WHEN s.tax_inclusive THEN si.tax ELSE 0 END)`;

function filter(f, alias = 's', kolomTanggal = 'created_at') {
  const p = [];
  const w = [`${alias}.deleted_at IS NULL`];
  if (f.from) { p.push(f.from); w.push(`${alias}.${kolomTanggal} >= $${p.length}::date`); }
  if (f.to) { p.push(f.to); w.push(`${alias}.${kolomTanggal} < $${p.length}::date + 1`); }
  if (f.outletId) { p.push(f.outletId); w.push(`${alias}.outlet_id = $${p.length}`); }
  if (f.userId && alias === 's') { p.push(f.userId); w.push(`${alias}.user_id = $${p.length}`); }
  return { p, w };
}

/** Baris total untuk kolom bertanda `jumlah`, dijumlah dengan BigInt (tanpa float) */
function hasil(judul, kolom, rows, extra = {}) {
  const total = {};
  for (const k of kolom) {
    if (!k.jumlah) continue;
    if (k.tipe === 'qty') total[k.key] = M.qtyToStr(rows.reduce((a, r) => a + M.toQty(r[k.key] || 0), 0n));
    else total[k.key] = M.senToStr(rows.reduce((a, r) => a + M.toSen(r[k.key] || 0), 0n));
  }
  return { judul, kolom, baris: rows, total, ...extra };
}

async function penjualan(f) {
  const { p, w } = filter(f);
  const grup = f.grup === 'bulan' ? "to_char(s.created_at, 'YYYY-MM')" : "to_char(s.created_at, 'YYYY-MM-DD')";
  const { rows } = await db.query(
    `WITH j AS (
       SELECT ${grup} AS periode, count(*) AS jml,
         SUM(s.subtotal + s.item_discount) AS bruto,
         SUM(s.item_discount + s.trx_discount + s.voucher_discount + s.points_value) AS diskon,
         SUM(s.dpp) AS bersih, SUM(s.tax) AS pajak, SUM(s.rounding) AS pembulatan, SUM(s.total) AS total
       FROM sales s WHERE ${w.join(' AND ')} AND s.status = 'selesai' GROUP BY 1),
     r AS (SELECT ${grup} AS periode, SUM(s.total) AS retur FROM sale_returns s WHERE ${w.join(' AND ')} GROUP BY 1)
     SELECT COALESCE(j.periode, r.periode) AS periode, COALESCE(j.jml,0) AS jml, COALESCE(j.bruto,0) AS bruto,
       COALESCE(j.diskon,0) AS diskon, COALESCE(j.bersih,0) AS bersih, COALESCE(j.pajak,0) AS pajak,
       COALESCE(j.pembulatan,0) AS pembulatan, COALESCE(j.total,0) AS total, COALESCE(r.retur,0) AS retur,
       COALESCE(j.total,0) - COALESCE(r.retur,0) AS total_bersih
     FROM j FULL JOIN r ON r.periode = j.periode ORDER BY 1`, p);
  return hasil('Laporan Penjualan', [
    { key: 'periode', label: 'Periode' },
    { key: 'jml', label: 'Transaksi', tipe: 'angka', jumlah: false },
    { key: 'bruto', label: 'Penjualan Kotor', tipe: 'uang', jumlah: true },
    { key: 'diskon', label: 'Diskon', tipe: 'uang', jumlah: true },
    { key: 'bersih', label: 'Penjualan Bersih (DPP)', tipe: 'uang', jumlah: true },
    { key: 'pajak', label: 'Pajak', tipe: 'uang', jumlah: true },
    { key: 'pembulatan', label: 'Pembulatan', tipe: 'uang', jumlah: true },
    { key: 'total', label: 'Total', tipe: 'uang', jumlah: true },
    { key: 'retur', label: 'Retur', tipe: 'uang', jumlah: true },
    { key: 'total_bersih', label: 'Total setelah Retur', tipe: 'uang', jumlah: true },
  ], rows);
}

async function perProduk(f) {
  const { p, w } = filter(f);
  const byKategori = f.grup === 'kategori';
  const { rows } = await db.query(
    `WITH jual AS (
       SELECT si.product_id, SUM(si.base_qty) AS qty, SUM(${NET_ITEM}) AS bersih, SUM(ROUND(si.cost * si.base_qty, 2)) AS hpp
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE ${w.join(' AND ')} AND s.status = 'selesai' AND si.deleted_at IS NULL GROUP BY si.product_id),
     retur AS (
       SELECT ri.product_id, SUM(ROUND(ri.qty * si.unit_factor, 4)) AS qty, SUM(ri.amount - ri.tax) AS bersih, SUM(ri.cost) AS hpp
       FROM sale_return_items ri JOIN sale_items si ON si.id = ri.sale_item_id JOIN sale_returns s ON s.id = ri.return_id
       WHERE ${w.join(' AND ').replace(/s\.user_id/g, 's.user_id')} GROUP BY ri.product_id)
     SELECT ${byKategori ? "COALESCE(c.name, '(Tanpa kategori)') AS nama, NULL AS sku" : "p.name || COALESCE(' - ' || p.variant_name, '') AS nama, p.sku"},
       SUM(COALESCE(j.qty,0) - COALESCE(r.qty,0)) AS qty,
       SUM(COALESCE(j.bersih,0) - COALESCE(r.bersih,0)) AS penjualan,
       SUM(COALESCE(j.hpp,0) - COALESCE(r.hpp,0)) AS hpp,
       SUM(COALESCE(j.bersih,0) - COALESCE(r.bersih,0) - COALESCE(j.hpp,0) + COALESCE(r.hpp,0)) AS laba
     FROM jual j FULL JOIN retur r ON r.product_id = j.product_id
     JOIN products p ON p.id = COALESCE(j.product_id, r.product_id) LEFT JOIN categories c ON c.id = p.category_id
     GROUP BY ${byKategori ? 'c.name' : 'p.id, p.name, p.variant_name, p.sku'} ORDER BY penjualan DESC`, p);
  const kolom = [
    { key: 'nama', label: byKategori ? 'Kategori' : 'Produk' },
    ...(byKategori ? [] : [{ key: 'sku', label: 'SKU' }]),
    { key: 'qty', label: 'Qty', tipe: 'qty', jumlah: true },
    { key: 'penjualan', label: 'Penjualan Bersih', tipe: 'uang', jumlah: true },
  ];
  if (f.lihatLaba) kolom.push({ key: 'hpp', label: 'HPP', tipe: 'uang', jumlah: true }, { key: 'laba', label: 'Laba Kotor', tipe: 'uang', jumlah: true });
  return hasil(byKategori ? 'Penjualan per Kategori' : 'Penjualan per Produk', kolom, rows);
}

async function perKasir(f) {
  const { p, w } = filter(f);
  const { rows } = await db.query(
    `SELECT u.name AS kasir, count(*) FILTER (WHERE s.status='selesai') AS jml, count(*) FILTER (WHERE s.status='void') AS jml_void,
       COALESCE(SUM(s.total) FILTER (WHERE s.status='selesai'),0) AS total,
       COALESCE(ROUND(AVG(s.total) FILTER (WHERE s.status='selesai'), 2),0) AS rata
     FROM sales s JOIN users u ON u.id = s.user_id WHERE ${w.join(' AND ')} GROUP BY u.name ORDER BY total DESC`, p);
  return hasil('Penjualan per Kasir', [
    { key: 'kasir', label: 'Kasir' }, { key: 'jml', label: 'Transaksi', tipe: 'angka' }, { key: 'jml_void', label: 'Void', tipe: 'angka' },
    { key: 'total', label: 'Total', tipe: 'uang', jumlah: true }, { key: 'rata', label: 'Rata-rata', tipe: 'uang' },
  ], rows);
}

async function metodeBayar(f) {
  const { p, w } = filter(f);
  // Tunai dikurangi kembalian supaya mencerminkan uang yang benar-benar diterima
  const { rows } = await db.query(
    `WITH per_jual AS (
       SELECT sp.sale_id, sp.method_code, sp.method_kind, SUM(sp.amount) AS amount, MAX(s.change_amount) AS kembalian
       FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
       WHERE ${w.join(' AND ')} AND s.status = 'selesai' AND sp.deleted_at IS NULL
       GROUP BY sp.sale_id, sp.method_code, sp.method_kind)
     SELECT COALESCE(pm.name, x.method_code) AS metode, count(*) AS jml,
       SUM(x.amount - CASE WHEN x.method_kind = 'tunai' THEN x.kembalian ELSE 0 END) AS total
     FROM per_jual x LEFT JOIN payment_methods pm ON pm.code = x.method_code
     GROUP BY COALESCE(pm.name, x.method_code) ORDER BY total DESC`, p);
  return hasil('Penjualan per Metode Pembayaran', [
    { key: 'metode', label: 'Metode' }, { key: 'jml', label: 'Transaksi', tipe: 'angka' }, { key: 'total', label: 'Diterima', tipe: 'uang', jumlah: true },
  ], rows);
}

async function laba(f) {
  const { p, w } = filter(f);
  const { p: pe, w: we } = filter({ ...f, userId: null }, 'e', 'expense_date');
  const { rows } = await db.query(
    `WITH j AS (SELECT s.created_at::date AS tgl, SUM(s.dpp) AS bersih, SUM(s.cost_total) AS hpp
                FROM sales s WHERE ${w.join(' AND ')} AND s.status='selesai' GROUP BY 1),
          r AS (SELECT s.created_at::date AS tgl, SUM(s.total - s.tax) AS bersih, SUM(s.cost_total) AS hpp
                FROM sale_returns s WHERE ${w.filter((x) => !x.includes('user_id')).join(' AND ')} GROUP BY 1)
     SELECT COALESCE(j.tgl, r.tgl)::text AS tanggal,
       COALESCE(j.bersih,0) - COALESCE(r.bersih,0) AS penjualan,
       COALESCE(j.hpp,0) - COALESCE(r.hpp,0) AS hpp,
       COALESCE(j.bersih,0) - COALESCE(r.bersih,0) - COALESCE(j.hpp,0) + COALESCE(r.hpp,0) AS laba
     FROM j FULL JOIN r ON r.tgl = j.tgl ORDER BY 1`, p);
  const { rows: [b] } = await db.query(`SELECT COALESCE(SUM(e.amount),0) AS biaya FROM expenses e WHERE ${we.join(' AND ')}`, pe);
  const out = await hasil('Laba Kotor', [
    { key: 'tanggal', label: 'Tanggal' },
    { key: 'penjualan', label: 'Penjualan Bersih', tipe: 'uang', jumlah: true },
    { key: 'hpp', label: 'HPP', tipe: 'uang', jumlah: true },
    { key: 'laba', label: 'Laba Kotor', tipe: 'uang', jumlah: true },
  ], rows);
  const { rows: [n] } = await db.query('SELECT $1::numeric - $2::numeric AS v', [out.total.laba, b.biaya]);
  out.catatan = [['Total biaya operasional', b.biaya], ['Laba setelah biaya operasional', n.v]];
  return out;
}

async function shift(f) {
  const { p, w } = filter({ ...f, userId: null }, 's', 'opened_at');
  if (f.userId) { p.push(f.userId); w.push(`s.user_id = $${p.length}`); }
  const { rows } = await db.query(
    `SELECT s.id, to_char(s.opened_at, 'DD/MM/YYYY HH24:MI') AS buka, to_char(s.closed_at, 'DD/MM/YYYY HH24:MI') AS tutup,
       u.name AS kasir, s.opening_cash, s.expected_cash, s.counted_cash, s.difference, s.status
     FROM shifts s JOIN users u ON u.id = s.user_id WHERE ${w.join(' AND ')} ORDER BY s.id DESC`, p);
  return hasil('Shift & Selisih Kas', [
    { key: 'buka', label: 'Buka' }, { key: 'tutup', label: 'Tutup' }, { key: 'kasir', label: 'Kasir' },
    { key: 'opening_cash', label: 'Modal', tipe: 'uang' }, { key: 'expected_cash', label: 'Seharusnya', tipe: 'uang' },
    { key: 'counted_cash', label: 'Fisik', tipe: 'uang' }, { key: 'difference', label: 'Selisih', tipe: 'uang', jumlah: true },
    { key: 'status', label: 'Status' },
  ], rows);
}

async function stok(f) {
  const p = []; const w = ['p.deleted_at IS NULL'];
  let outletJoin = 's.product_id = p.id';
  if (f.outletId) { p.push(f.outletId); outletJoin += ` AND s.outlet_id = $${p.length}`; }
  const { rows } = await db.query(
    `SELECT p.sku, p.name || COALESCE(' - ' || p.variant_name, '') AS nama, c.name AS kategori,
       COALESCE(SUM(s.qty),0) AS qty, p.cost_price, ROUND(COALESCE(SUM(s.qty),0) * p.cost_price, 2) AS nilai
     FROM products p LEFT JOIN stocks s ON ${outletJoin} LEFT JOIN categories c ON c.id = p.category_id
     WHERE ${w.join(' AND ')} AND NOT EXISTS (SELECT 1 FROM products x WHERE x.parent_id = p.id AND x.deleted_at IS NULL)
     GROUP BY p.id, p.sku, p.name, p.variant_name, c.name, p.cost_price ORDER BY p.name`, p);
  const kolom = [{ key: 'sku', label: 'SKU' }, { key: 'nama', label: 'Produk' }, { key: 'kategori', label: 'Kategori' }, { key: 'qty', label: 'Stok', tipe: 'qty', jumlah: true }];
  if (f.lihatHargaBeli) kolom.push({ key: 'cost_price', label: 'Harga Pokok', tipe: 'uang' }, { key: 'nilai', label: 'Nilai Persediaan', tipe: 'uang', jumlah: true });
  return hasil('Stok & Nilai Persediaan', kolom, rows);
}

async function pembelian(f) {
  const { p, w } = filter({ ...f, userId: null }, 'g');
  const { rows } = await db.query(
    `SELECT to_char(g.created_at, 'DD/MM/YYYY') AS tanggal, g.number, s.name AS pemasok, g.invoice_no, g.total,
       COALESCE((SELECT SUM(total) FROM purchase_returns r WHERE r.receipt_id = g.id AND r.deleted_at IS NULL),0) AS retur, g.paid,
       g.total - g.paid - COALESCE((SELECT SUM(total) FROM purchase_returns r WHERE r.receipt_id = g.id AND r.deleted_at IS NULL),0) AS sisa
     FROM goods_receipts g JOIN suppliers s ON s.id = g.supplier_id WHERE ${w.join(' AND ')} ORDER BY g.id`, p);
  return hasil('Laporan Pembelian', [
    { key: 'tanggal', label: 'Tanggal' }, { key: 'number', label: 'Nomor' }, { key: 'pemasok', label: 'Pemasok' }, { key: 'invoice_no', label: 'Faktur' },
    { key: 'total', label: 'Total', tipe: 'uang', jumlah: true }, { key: 'retur', label: 'Retur', tipe: 'uang', jumlah: true },
    { key: 'paid', label: 'Dibayar', tipe: 'uang', jumlah: true }, { key: 'sisa', label: 'Sisa Hutang', tipe: 'uang', jumlah: true },
  ], rows);
}

async function returVoid(f) {
  const { p, w } = filter(f);
  const { rows } = await db.query(
    `SELECT * FROM (
       SELECT r.created_at, to_char(r.created_at, 'DD/MM/YYYY HH24:MI') AS waktu, 'Retur' AS jenis, r.number, s.number AS penjualan,
              u.name AS oleh, a.name AS disetujui, r.reason AS alasan, r.total
       FROM sale_returns r JOIN sales s ON s.id = r.sale_id JOIN users u ON u.id = r.user_id LEFT JOIN users a ON a.id = r.approved_by
       WHERE ${w.join(' AND ').replace(/s\./g, 'r.')}
       UNION ALL
       SELECT s.void_at, to_char(s.void_at, 'DD/MM/YYYY HH24:MI'), 'Void', s.number, s.number, u.name, a.name, s.void_reason, s.total
       FROM sales s JOIN users u ON u.id = s.void_by LEFT JOIN users a ON a.id = s.void_approved_by
       WHERE ${w.join(' AND ')} AND s.status = 'void') x ORDER BY created_at`, p);
  return hasil('Retur & Void', [
    { key: 'waktu', label: 'Waktu' }, { key: 'jenis', label: 'Jenis' }, { key: 'number', label: 'Nomor' }, { key: 'penjualan', label: 'Penjualan' },
    { key: 'oleh', label: 'Oleh' }, { key: 'disetujui', label: 'Disetujui' }, { key: 'alasan', label: 'Alasan' }, { key: 'total', label: 'Nilai', tipe: 'uang', jumlah: true },
  ], rows);
}

async function pajak(f) {
  const { p, w } = filter(f);
  const { rows } = await db.query(
    `WITH j AS (SELECT s.created_at::date tgl, SUM(s.dpp) dpp, SUM(s.tax) pajak FROM sales s WHERE ${w.join(' AND ')} AND s.status='selesai' GROUP BY 1),
          r AS (SELECT s.created_at::date tgl, SUM(s.total - s.tax) dpp, SUM(s.tax) pajak FROM sale_returns s WHERE ${w.filter((x) => !x.includes('user_id')).join(' AND ')} GROUP BY 1)
     SELECT COALESCE(j.tgl, r.tgl)::text AS tanggal, COALESCE(j.dpp,0) AS dpp, COALESCE(j.pajak,0) AS pajak,
            COALESCE(r.pajak,0) AS pajak_retur, COALESCE(j.pajak,0) - COALESCE(r.pajak,0) AS pajak_bersih
     FROM j FULL JOIN r ON r.tgl = j.tgl ORDER BY 1`, p);
  return hasil('Laporan Pajak', [
    { key: 'tanggal', label: 'Tanggal' }, { key: 'dpp', label: 'DPP', tipe: 'uang', jumlah: true }, { key: 'pajak', label: 'Pajak Keluaran', tipe: 'uang', jumlah: true },
    { key: 'pajak_retur', label: 'Pajak Retur', tipe: 'uang', jumlah: true }, { key: 'pajak_bersih', label: 'Pajak Bersih', tipe: 'uang', jumlah: true },
  ], rows);
}

async function pengeluaran(f) {
  const { p, w } = filter({ ...f, userId: null }, 'e', 'expense_date');
  const { rows } = await db.query(
    `SELECT to_char(e.expense_date, 'DD/MM/YYYY') AS tanggal, e.number, c.name AS kategori, e.description, e.amount
     FROM expenses e JOIN expense_categories c ON c.id = e.category_id WHERE ${w.join(' AND ')} ORDER BY e.expense_date, e.id`, p);
  return hasil('Laporan Pengeluaran', [
    { key: 'tanggal', label: 'Tanggal' }, { key: 'number', label: 'Nomor' }, { key: 'kategori', label: 'Kategori' },
    { key: 'description', label: 'Keterangan' }, { key: 'amount', label: 'Jumlah', tipe: 'uang', jumlah: true },
  ], rows);
}

const DAFTAR = {
  penjualan: { fn: penjualan, judul: 'Penjualan' },
  produk: { fn: perProduk, judul: 'Per Produk / Kategori' },
  kasir: { fn: perKasir, judul: 'Per Kasir' },
  pembayaran: { fn: metodeBayar, judul: 'Metode Pembayaran' },
  laba: { fn: laba, judul: 'Laba Kotor', laba: true },
  shift: { fn: shift, judul: 'Shift & Selisih Kas' },
  stok: { fn: stok, judul: 'Stok & Nilai Persediaan' },
  pembelian: { fn: pembelian, judul: 'Pembelian' },
  retur: { fn: returVoid, judul: 'Retur & Void' },
  pajak: { fn: pajak, judul: 'Pajak' },
  pengeluaran: { fn: pengeluaran, judul: 'Pengeluaran' },
};

// ---------- Dashboard ----------
async function dashboard({ outletId, userId, lihatLaba, hari = 7 }) {
  const p = [outletId];
  const uw = userId ? (p.push(userId), `AND s.user_id = $${p.length}`) : '';
  const { rows: [hariIni] } = await db.query(
    `SELECT count(*) AS jml, COALESCE(SUM(total),0) AS total, COALESCE(ROUND(AVG(total),2),0) AS rata,
            COALESCE(SUM(dpp - cost_total),0) AS laba
     FROM sales s WHERE s.outlet_id=$1 AND s.status='selesai' AND s.deleted_at IS NULL AND s.created_at >= CURRENT_DATE ${uw}`, p);
  const { rows: [returHariIni] } = await db.query(
    `SELECT COALESCE(SUM(total - tax - cost_total),0) AS laba FROM sale_returns WHERE outlet_id=$1 AND created_at >= CURRENT_DATE AND deleted_at IS NULL`, [outletId]);
  const { rows: [l] } = await db.query('SELECT $1::numeric - $2::numeric AS v', [hariIni.laba, returHariIni.laba]);
  hariIni.laba = lihatLaba ? l.v : null;
  const { rows: grafik } = await db.query(
    `SELECT d::date::text AS tgl, COALESCE(SUM(s.total),0) AS total
     FROM generate_series(CURRENT_DATE - ($2::int - 1), CURRENT_DATE, '1 day') d
     LEFT JOIN sales s ON s.created_at::date = d::date AND s.outlet_id = $1 AND s.status='selesai' AND s.deleted_at IS NULL
     GROUP BY d ORDER BY d`, [outletId, hari]);
  const { rows: terlaris } = await db.query(
    `SELECT si.product_name AS nama, SUM(si.base_qty) AS qty, SUM(si.line_total) AS total
     FROM sale_items si JOIN sales s ON s.id = si.sale_id
     WHERE s.outlet_id=$1 AND s.status='selesai' AND s.created_at >= CURRENT_DATE - ($2::int - 1)
     GROUP BY si.product_name ORDER BY qty DESC LIMIT 10`, [outletId, hari]);
  const { rows: shiftBuka } = await db.query(
    `SELECT s.id, s.opened_at, u.name AS user_name FROM shifts s JOIN users u ON u.id = s.user_id
     WHERE s.outlet_id=$1 AND s.status='buka' AND s.deleted_at IS NULL ORDER BY s.opened_at`, [outletId]);
  return { hariIni, grafik, terlaris, shiftBuka };
}

module.exports = { DAFTAR, dashboard };
