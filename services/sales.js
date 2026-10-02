// Penjualan: simpan (atomik & idempoten), void, retur, transaksi ditahan, riwayat.
const db = require('../config/db');
const pricing = require('./pricing');
const stock = require('./stock');
const docnumber = require('./docnumber');
const audit = require('./audit');
const users = require('./users');
const { AppError } = require('../lib/errors');
const M = require('../lib/money');

const { toSen, senToStr, qtyToStr, toQty, divRound, mulQty } = M;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function metodeAktif(client) {
  const { rows } = await client.query('SELECT code, name, kind FROM payment_methods WHERE deleted_at IS NULL AND active');
  return new Map(rows.map((r) => [r.code, r]));
}

/** Hitung pratinjau untuk layar kasir (tanpa menyimpan) */
async function preview(input) {
  const client = await db.pool.connect();
  try {
    const h = await pricing.hitung(client, input);
    return pricing.ringkas(h);
  } finally {
    client.release();
  }
}

/**
 * Simpan penjualan. Semua dalam satu transaksi:
 * nomor struk, header, item, pembayaran, mutasi stok, voucher, poin, piutang, audit.
 * input.idempotency_key (uuid) menjamin klik ganda hanya menghasilkan satu transaksi.
 */
async function create({ user, outletId, input, ip }) {
  const key = String(input.idempotency_key || '');
  if (!UUID_RE.test(key)) throw new AppError('Kunci transaksi tidak valid. Muat ulang halaman kasir.');

  return db.withTransaction(async (client) => {
    // Kunci per kunci idempotensi: request kedua menunggu yang pertama selesai
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
    const ada = await client.query('SELECT id, user_id FROM sales WHERE idempotency_key = $1', [key]);
    if (ada.rows[0]) {
      if (String(ada.rows[0].user_id) !== String(user.id)) throw new AppError('Kunci transaksi bentrok.');
      return { id: ada.rows[0].id, duplikat: true };
    }

    const { rows: sh } = await client.query(
      "SELECT id, outlet_id FROM shifts WHERE user_id=$1 AND status='buka' AND deleted_at IS NULL FOR SHARE", [user.id]);
    if (!sh[0]) throw new AppError('Buka shift terlebih dahulu sebelum berjualan.');
    if (String(sh[0].outlet_id) !== String(outletId)) throw new AppError('Shift Anda terbuka di outlet lain. Pindah outlet atau tutup shift.');

    const h = await pricing.hitung(client, input, { lock: true });

    // ----- Pembayaran -----
    const metode = await metodeAktif(client);
    const bayarIn = Array.isArray(input.payments) ? input.payments : [];
    if (!bayarIn.length) throw new AppError('Pilih metode pembayaran.');
    const bayar = [];
    for (const b of bayarIn) {
      const m = metode.get(String(b.method_code));
      if (!m) throw new AppError('Metode pembayaran tidak valid.');
      const amt = toSen(b.amount);
      if (amt <= 0n) continue;
      bayar.push({ code: m.code, kind: m.kind, amount: amt, reference: b.reference ? String(b.reference).slice(0, 100) : null });
    }
    if (!bayar.length) throw new AppError('Jumlah pembayaran belum diisi.');

    const adaTunai = bayar.some((b) => b.kind === 'tunai');
    const total = adaTunai ? h.totalTunai : h.total;
    const rounding = total - h.total;
    const nonTunai = bayar.filter((b) => b.kind !== 'tunai').reduce((a, b) => a + b.amount, 0n);
    const tunai = bayar.filter((b) => b.kind === 'tunai').reduce((a, b) => a + b.amount, 0n);
    const paid = nonTunai + tunai;
    if (nonTunai > total) throw new AppError('Pembayaran non-tunai melebihi total. Kembalian hanya dari uang tunai.');
    if (paid < total) throw new AppError(`Pembayaran kurang ${M.rupiah(total - paid)}.`);
    const change = paid - total;
    if (change > tunai) throw new AppError('Kembalian melebihi uang tunai.');

    const piutang = bayar.filter((b) => b.kind === 'piutang').reduce((a, b) => a + b.amount, 0n);
    if (piutang > 0n) {
      if (!h.customer) throw new AppError('Pembayaran piutang wajib memilih pelanggan.');
      const limit = toSen(h.customer.credit_limit);
      if (limit > 0n && toSen(h.customer.receivable) + piutang > limit) {
        throw new AppError(`Melebihi batas piutang pelanggan (${M.rupiah(h.customer.credit_limit)}).`);
      }
    }

    const earned = pricing.poinDidapat(h.cfg, total, h.customer);
    const number = await docnumber.next(client, outletId, 'PJ');

    const { rows: [sale] } = await client.query(
      `INSERT INTO sales (number, idempotency_key, outlet_id, shift_id, user_id, customer_id, subtotal, item_discount,
          trx_discount, voucher_id, voucher_discount, points_used, points_value, dpp, tax, rounding, total, paid,
          change_amount, cost_total, points_earned, tax_inclusive, tax_rate, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) RETURNING id, number`,
      [number, key, outletId, sh[0].id, user.id, h.customer ? h.customer.id : null,
        senToStr(h.subtotal), senToStr(h.itemDiscount), senToStr(h.trxDiscount), h.voucher ? h.voucher.id : null,
        senToStr(h.voucherDiscount), senToStr(h.pointsUsed), senToStr(h.pointsValue), senToStr(h.dpp), senToStr(h.tax),
        senToStr(rounding), senToStr(total), senToStr(paid), senToStr(change), senToStr(h.costTotal), senToStr(earned),
        h.cfg.termasuk, senToStr(h.cfg.tarif), input.note ? String(input.note).slice(0, 500) : null]);

    for (const l of h.lines) {
      await client.query(
        `INSERT INTO sale_items (sale_id, product_id, product_name, sku, unit_name, unit_factor, qty, base_qty, price, cost,
           discount, trx_discount_share, tax, line_total, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [sale.id, l.product_id, l.name, l.sku, l.unit_name, qtyToStr(l.unit_factor), qtyToStr(l.qty), qtyToStr(l.base_qty),
          senToStr(l.price), senToStr(l.cost), senToStr(l.discount), senToStr(l.trx_share), senToStr(l.tax), senToStr(l.line_total), l.note]);
    }
    for (const b of bayar) {
      await client.query(
        'INSERT INTO sale_payments (sale_id, method_code, method_kind, amount, reference) VALUES ($1,$2,$3,$4,$5)',
        [sale.id, b.code, b.kind, senToStr(b.amount), b.reference]);
    }

    // Stok: urutkan per produk untuk menghindari deadlock antar transaksi
    const perProduk = new Map();
    for (const l of h.lines) {
      const x = perProduk.get(l.product_id) || { qty: 0n, cost: l.cost };
      x.qty += l.base_qty;
      perProduk.set(l.product_id, x);
    }
    for (const pid of [...perProduk.keys()].sort((a, b) => Number(a) - Number(b))) {
      const x = perProduk.get(pid);
      await stock.move(client, { productId: pid, outletId, qtyChange: -x.qty, unitCost: senToStr(x.cost),
        refType: 'penjualan', refId: sale.id, refNo: number, userId: user.id });
    }

    if (h.voucher) await client.query('UPDATE vouchers SET used = used + 1 WHERE id = $1', [h.voucher.id]);

    if (h.customer) {
      const delta = earned - h.pointsUsed;
      if (h.pointsUsed > 0n) {
        await client.query('INSERT INTO point_ledger (customer_id, points, ref_type, ref_id, note) VALUES ($1,$2,$3,$4,$5)',
          [h.customer.id, senToStr(-h.pointsUsed), 'penjualan', sale.id, `Dipakai di ${number}`]);
      }
      if (earned > 0n) {
        await client.query('INSERT INTO point_ledger (customer_id, points, ref_type, ref_id, note) VALUES ($1,$2,$3,$4,$5)',
          [h.customer.id, senToStr(earned), 'penjualan', sale.id, `Didapat dari ${number}`]);
      }
      if (delta !== 0n || piutang > 0n) {
        await client.query('UPDATE customers SET points = points + $2, receivable = receivable + $3 WHERE id = $1',
          [h.customer.id, senToStr(delta), senToStr(piutang)]);
      }
      if (piutang > 0n) {
        await client.query(
          'INSERT INTO receivable_ledger (customer_id, amount, ref_type, ref_id, note, user_id) VALUES ($1,$2,$3,$4,$5,$6)',
          [h.customer.id, senToStr(piutang), 'penjualan', sale.id, `Penjualan ${number}`, user.id]);
      }
    }

    // Transaksi ditahan yang dilanjutkan, dihapus (soft) sekaligus
    if (input.held_id) {
      await client.query('UPDATE held_sales SET deleted_at = now() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL', [input.held_id, user.id]);
    }

    await audit.log(client, { userId: user.id, action: 'penjualan.simpan', entity: 'sales', entityId: sale.id,
      data: { nomor: number, total: senToStr(total) }, ip });
    return { id: sale.id, number, change: senToStr(change), total: senToStr(total) };
  });
}

async function get(id) {
  const { rows } = await db.query(
    `SELECT s.*, u.name AS user_name, o.name AS outlet_name, o.address AS outlet_address, o.phone AS outlet_phone,
            c.name AS customer_name, c.code AS customer_code, c.email AS customer_email, c.points AS customer_points,
            v.code AS voucher_code, vu.name AS void_user_name, va.name AS void_approver_name
     FROM sales s JOIN users u ON u.id = s.user_id JOIN outlets o ON o.id = s.outlet_id
     LEFT JOIN customers c ON c.id = s.customer_id LEFT JOIN vouchers v ON v.id = s.voucher_id
     LEFT JOIN users vu ON vu.id = s.void_by LEFT JOIN users va ON va.id = s.void_approved_by
     WHERE s.id = $1 AND s.deleted_at IS NULL`, [id]);
  const s = rows[0];
  if (!s) return null;
  s.items = (await db.query('SELECT * FROM sale_items WHERE sale_id=$1 AND deleted_at IS NULL ORDER BY id', [id])).rows;
  s.payments = (await db.query(
    `SELECT sp.*, pm.name FROM sale_payments sp LEFT JOIN payment_methods pm ON pm.code = sp.method_code
     WHERE sp.sale_id=$1 AND sp.deleted_at IS NULL ORDER BY sp.id`, [id])).rows;
  s.returns = (await db.query(
    `SELECT r.*, u.name AS user_name FROM sale_returns r JOIN users u ON u.id = r.user_id
     WHERE r.sale_id=$1 AND r.deleted_at IS NULL ORDER BY r.id`, [id])).rows;
  return s;
}

function filterRiwayat(f) {
  const p = [];
  const w = ['s.deleted_at IS NULL'];
  if (f.from) { p.push(f.from); w.push(`s.created_at >= $${p.length}::date`); }
  if (f.to) { p.push(f.to); w.push(`s.created_at < $${p.length}::date + 1`); }
  if (f.outletId) { p.push(f.outletId); w.push(`s.outlet_id = $${p.length}`); }
  if (f.userId) { p.push(f.userId); w.push(`s.user_id = $${p.length}`); }
  if (f.status) { p.push(f.status); w.push(`s.status = $${p.length}`); }
  if (f.number) { p.push(`%${f.number}%`); w.push(`s.number ILIKE $${p.length}`); }
  if (f.method) { p.push(f.method); w.push(`EXISTS (SELECT 1 FROM sale_payments sp WHERE sp.sale_id = s.id AND sp.method_code = $${p.length})`); }
  if (f.customerId) { p.push(f.customerId); w.push(`s.customer_id = $${p.length}`); }
  return { p, w };
}

async function list(f) {
  const { p, w } = filterRiwayat(f);
  const perPage = f.perPage || 50;
  const { rows: [agg] } = await db.query(
    `SELECT count(*)::int n, COALESCE(SUM(total) FILTER (WHERE status='selesai'),0) total FROM sales s WHERE ${w.join(' AND ')}`, p);
  p.push(perPage, ((f.page || 1) - 1) * perPage);
  const { rows } = await db.query(
    `SELECT s.id, s.number, s.created_at, s.total, s.status, s.paid, s.change_amount, u.name AS user_name, o.name AS outlet_name,
            c.name AS customer_name,
            (SELECT string_agg(DISTINCT sp.method_code, ', ') FROM sale_payments sp WHERE sp.sale_id = s.id) AS methods,
            EXISTS (SELECT 1 FROM sale_returns r WHERE r.sale_id = s.id AND r.deleted_at IS NULL) AS ada_retur
     FROM sales s JOIN users u ON u.id = s.user_id JOIN outlets o ON o.id = s.outlet_id
     LEFT JOIN customers c ON c.id = s.customer_id
     WHERE ${w.join(' AND ')} ORDER BY s.id DESC LIMIT $${p.length - 1} OFFSET $${p.length}`, p);
  return { rows, total: agg.n, sum: agg.total };
}

/**
 * Void: membatalkan seluruh transaksi. Hanya bila shift transaksi masih terbuka
 * (setelah shift ditutup gunakan retur), belum ada retur, dan disetujui supervisor.
 */
async function voidSale({ id, user, reason, supervisorUsername, supervisorPassword, ip }) {
  if (!reason || String(reason).trim().length < 3) throw new AppError('Alasan void wajib diisi.');
  const approver = ['pemilik', 'manajer'].includes(user.role) && !supervisorUsername
    ? user : await users.verifySupervisor(supervisorUsername, supervisorPassword);

  return db.withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM sales WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [id]);
    const s = rows[0];
    if (!s) throw new AppError('Transaksi tidak ditemukan.', 404);
    if (s.status === 'void') throw new AppError('Transaksi sudah di-void.');
    if (user.role === 'kasir' && String(s.user_id) !== String(user.id)) throw new AppError('Kasir hanya bisa void transaksinya sendiri.');
    const { rows: sh } = await client.query('SELECT status FROM shifts WHERE id=$1', [s.shift_id]);
    if (sh[0].status !== 'buka') throw new AppError('Shift transaksi ini sudah ditutup. Gunakan retur penjualan.');
    const { rows: rt } = await client.query('SELECT 1 FROM sale_returns WHERE sale_id=$1 AND deleted_at IS NULL LIMIT 1', [id]);
    if (rt.length) throw new AppError('Transaksi sudah punya retur, tidak bisa di-void.');

    const { rows: items } = await client.query(
      'SELECT product_id, SUM(base_qty) AS qty, MAX(cost) AS cost FROM sale_items WHERE sale_id=$1 GROUP BY product_id ORDER BY product_id', [id]);
    for (const it of items) {
      await stock.move(client, { productId: it.product_id, outletId: s.outlet_id, qtyChange: toQty(it.qty), unitCost: it.cost,
        refType: 'void', refId: s.id, refNo: s.number, userId: user.id, note: reason });
    }
    if (s.voucher_id) await client.query('UPDATE vouchers SET used = GREATEST(used - 1, 0) WHERE id=$1', [s.voucher_id]);
    if (s.customer_id) {
      const { rows: c } = await client.query('SELECT points FROM customers WHERE id=$1 FOR UPDATE', [s.customer_id]);
      // Poin yang didapat ditarik (maksimal sebesar saldo), poin yang dipakai dikembalikan
      const tarik = M.min(toSen(s.points_earned), toSen(c[0].points) + toSen(s.points_used));
      const delta = toSen(s.points_used) - tarik;
      const piutang = (await client.query(
        "SELECT COALESCE(SUM(amount),0) AS n FROM sale_payments WHERE sale_id=$1 AND method_kind='piutang'", [id])).rows[0].n;
      await client.query('UPDATE customers SET points = points + $2, receivable = receivable - $3 WHERE id=$1',
        [s.customer_id, senToStr(delta), piutang]);
      if (delta !== 0n) {
        await client.query('INSERT INTO point_ledger (customer_id, points, ref_type, ref_id, note) VALUES ($1,$2,$3,$4,$5)',
          [s.customer_id, senToStr(delta), 'void', s.id, `Void ${s.number}`]);
      }
      if (toSen(piutang) > 0n) {
        await client.query(
          'INSERT INTO receivable_ledger (customer_id, amount, ref_type, ref_id, note, user_id) VALUES ($1,$2,$3,$4,$5,$6)',
          [s.customer_id, senToStr(-toSen(piutang)), 'void', s.id, `Void ${s.number}`, user.id]);
      }
    }
    await client.query(
      "UPDATE sales SET status='void', void_reason=$2, void_by=$3, void_approved_by=$4, void_at=now() WHERE id=$1",
      [id, String(reason).trim(), user.id, approver.id]);
    await audit.log(client, { userId: user.id, action: 'penjualan.void', entity: 'sales', entityId: s.id,
      data: { nomor: s.number, total: s.total, alasan: reason, disetujui: approver.username }, ip });
  });
}

/**
 * Retur sebagian/seluruhnya.
 * items: [{sale_item_id, qty}] (qty dalam satuan jual). Nilai refund = bagian proporsional dari yang benar-benar dibayar.
 */
async function createReturn({ saleId, user, outletId, items, reason, refundMethod, supervisorUsername, supervisorPassword, ip }) {
  if (!reason || String(reason).trim().length < 3) throw new AppError('Alasan retur wajib diisi.');
  const approver = ['pemilik', 'manajer'].includes(user.role) && !supervisorUsername
    ? user : await users.verifySupervisor(supervisorUsername, supervisorPassword);

  return db.withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM sales WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [saleId]);
    const s = rows[0];
    if (!s) throw new AppError('Transaksi tidak ditemukan.', 404);
    if (s.status !== 'selesai') throw new AppError('Transaksi void tidak bisa diretur.');
    if (user.role === 'kasir' && String(s.user_id) !== String(user.id)) throw new AppError('Kasir hanya bisa meretur transaksinya sendiri.');

    const metode = await metodeAktif(client);
    const m = metode.get(String(refundMethod));
    if (!m) throw new AppError('Metode pengembalian dana tidak valid.');
    if (m.kind === 'piutang' && !s.customer_id) throw new AppError('Transaksi tanpa pelanggan tidak bisa dikembalikan ke piutang.');

    let shiftId = null;
    if (m.kind === 'tunai') {
      const sh = await client.query("SELECT id, outlet_id FROM shifts WHERE user_id=$1 AND status='buka' FOR UPDATE", [user.id]);
      if (!sh.rows[0]) throw new AppError('Pengembalian tunai butuh shift yang terbuka.');
      if (String(sh.rows[0].outlet_id) !== String(s.outlet_id)) throw new AppError('Pengembalian tunai harus dari shift di outlet transaksi.');
      shiftId = sh.rows[0].id;
    }

    const { rows: saleItems } = await client.query('SELECT * FROM sale_items WHERE sale_id=$1 FOR UPDATE', [saleId]);
    const map = new Map(saleItems.map((i) => [String(i.id), i]));
    const pilih = (Array.isArray(items) ? items : []).filter((i) => i && toQty(i.qty || 0) > 0n);
    if (!pilih.length) throw new AppError('Pilih barang yang diretur.');

    const number = await docnumber.next(client, s.outlet_id, 'RJ');
    let total = 0n; let taxTotal = 0n; let costTotal = 0n;
    const detail = [];
    for (const r of pilih) {
      const it = map.get(String(r.sale_item_id));
      if (!it) throw new AppError('Item retur tidak valid.');
      const q = toQty(r.qty);
      const sisa = toQty(it.qty) - toQty(it.returned_qty);
      if (q > sisa) throw new AppError(`Qty retur "${it.product_name}" melebihi sisa (${M.angka(sisa)}).`);
      const itemQty = toQty(it.qty);
      // Yang dibayar pelanggan untuk baris ini
      const bersih = toSen(it.line_total) - toSen(it.trx_discount_share) + (s.tax_inclusive ? 0n : toSen(it.tax));
      // Gunakan selisih kumulatif supaya total retur penuh tepat sama dengan yang dibayar
      const sudah = toQty(it.returned_qty);
      const amount = divRound(bersih * (sudah + q), itemQty) - divRound(bersih * sudah, itemQty);
      const tax = divRound(toSen(it.tax) * (sudah + q), itemQty) - divRound(toSen(it.tax) * sudah, itemQty);
      const baseQ = divRound(q * toQty(it.unit_factor), M.QTY);
      const cost = mulQty(toSen(it.cost), baseQ);
      total += amount; taxTotal += tax; costTotal += cost;
      detail.push({ it, q, amount, tax, cost, baseQ });
    }

    const { rows: [ret] } = await client.query(
      `INSERT INTO sale_returns (number, sale_id, outlet_id, shift_id, user_id, approved_by, reason, refund_method, total, tax, cost_total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [number, s.id, s.outlet_id, shiftId, user.id, approver.id, String(reason).trim(), m.code, senToStr(total), senToStr(taxTotal), senToStr(costTotal)]);

    detail.sort((a, b) => Number(a.it.product_id) - Number(b.it.product_id));
    for (const d of detail) {
      await client.query(
        `INSERT INTO sale_return_items (return_id, sale_item_id, product_id, qty, amount, tax, cost) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [ret.id, d.it.id, d.it.product_id, qtyToStr(d.q), senToStr(d.amount), senToStr(d.tax), senToStr(d.cost)]);
      await client.query('UPDATE sale_items SET returned_qty = returned_qty + $2 WHERE id=$1', [d.it.id, qtyToStr(d.q)]);
      await stock.move(client, { productId: d.it.product_id, outletId: s.outlet_id, qtyChange: d.baseQ, unitCost: d.it.cost,
        refType: 'retur_jual', refId: ret.id, refNo: number, userId: user.id, note: reason });
    }

    if (s.customer_id) {
      const { rows: c } = await client.query('SELECT points FROM customers WHERE id=$1 FOR UPDATE', [s.customer_id]);
      // Tarik poin proporsional terhadap nilai retur
      let tarik = toSen(s.total) > 0n ? (toSen(s.points_earned) * total / toSen(s.total) / 100n) * 100n : 0n;
      tarik = M.min(tarik, toSen(c[0].points));
      const piutang = m.kind === 'piutang' ? total : 0n;
      await client.query('UPDATE customers SET points = points - $2, receivable = receivable - $3 WHERE id=$1',
        [s.customer_id, senToStr(tarik), senToStr(piutang)]);
      if (tarik > 0n) {
        await client.query('INSERT INTO point_ledger (customer_id, points, ref_type, ref_id, note) VALUES ($1,$2,$3,$4,$5)',
          [s.customer_id, senToStr(-tarik), 'retur_jual', ret.id, `Retur ${number}`]);
      }
      if (piutang > 0n) {
        await client.query(
          'INSERT INTO receivable_ledger (customer_id, amount, ref_type, ref_id, note, user_id) VALUES ($1,$2,$3,$4,$5,$6)',
          [s.customer_id, senToStr(-piutang), 'retur_jual', ret.id, `Retur ${number}`, user.id]);
      }
    }
    if (shiftId) {
      // Pastikan laci cukup
      const { rows: r } = await client.query(
        `SELECT s.opening_cash
           + COALESCE((SELECT SUM(sp.amount) FROM sale_payments sp JOIN sales x ON x.id=sp.sale_id WHERE x.shift_id=s.id AND x.status='selesai' AND sp.method_kind='tunai'),0)
           - COALESCE((SELECT SUM(change_amount) FROM sales WHERE shift_id=s.id AND status='selesai'),0)
           + COALESCE((SELECT SUM(CASE WHEN direction='masuk' THEN amount ELSE -amount END) FROM cash_movements WHERE shift_id=s.id AND deleted_at IS NULL),0)
           - COALESCE((SELECT SUM(total) FROM sale_returns WHERE shift_id=s.id AND refund_method='TUNAI' AND deleted_at IS NULL),0) AS kas
         FROM shifts s WHERE s.id=$1`, [shiftId]);
      if (toSen(r[0].kas) < 0n) throw new AppError('Uang tunai di laci tidak cukup untuk pengembalian.');
    }
    await audit.log(client, { userId: user.id, action: 'penjualan.retur', entity: 'sale_returns', entityId: ret.id,
      data: { nomor: number, penjualan: s.number, total: senToStr(total), disetujui: approver.username }, ip });
    void outletId;
    return { id: ret.id, number, total: senToStr(total) };
  });
}

async function listReturns(f) {
  const p = [];
  const w = ['r.deleted_at IS NULL'];
  if (f.from) { p.push(f.from); w.push(`r.created_at >= $${p.length}::date`); }
  if (f.to) { p.push(f.to); w.push(`r.created_at < $${p.length}::date + 1`); }
  if (f.outletId) { p.push(f.outletId); w.push(`r.outlet_id = $${p.length}`); }
  if (f.userId) { p.push(f.userId); w.push(`r.user_id = $${p.length}`); }
  const { rows } = await db.query(
    `SELECT r.*, s.number AS sale_number, u.name AS user_name, a.name AS approver_name
     FROM sale_returns r JOIN sales s ON s.id = r.sale_id JOIN users u ON u.id = r.user_id LEFT JOIN users a ON a.id = r.approved_by
     WHERE ${w.join(' AND ')} ORDER BY r.id DESC LIMIT 200`, p);
  return rows;
}

async function getReturn(id) {
  const { rows } = await db.query(
    `SELECT r.*, s.number AS sale_number, u.name AS user_name, a.name AS approver_name, o.name AS outlet_name
     FROM sale_returns r JOIN sales s ON s.id = r.sale_id JOIN users u ON u.id = r.user_id
     LEFT JOIN users a ON a.id = r.approved_by JOIN outlets o ON o.id = r.outlet_id WHERE r.id=$1`, [id]);
  if (!rows[0]) return null;
  rows[0].items = (await db.query(
    `SELECT ri.*, si.product_name, si.unit_name FROM sale_return_items ri JOIN sale_items si ON si.id = ri.sale_item_id
     WHERE ri.return_id=$1 ORDER BY ri.id`, [id])).rows;
  return rows[0];
}

// ----- Transaksi ditahan -----
async function hold({ user, outletId, payload, label }) {
  if (!payload || !Array.isArray(payload.items) || !payload.items.length) throw new AppError('Keranjang kosong, tidak ada yang ditahan.');
  const bersih = {
    items: payload.items.slice(0, 500).map((i) => ({ product_id: i.product_id, unit_id: i.unit_id || null, qty: String(i.qty),
      disc_type: i.disc_type || null, disc_value: i.disc_value || null, note: i.note || null, name: String(i.name || '').slice(0, 200) })),
    customer_id: payload.customer_id || null, customer_name: payload.customer_name || null,
    voucher_code: payload.voucher_code || null, trx_disc_type: payload.trx_disc_type || null, trx_disc_value: payload.trx_disc_value || null,
    note: payload.note || null,
  };
  return db.withTransaction(async (client) => {
    if (payload.held_id) await client.query('UPDATE held_sales SET deleted_at=now() WHERE id=$1 AND user_id=$2', [payload.held_id, user.id]);
    const { rows } = await client.query('INSERT INTO held_sales (outlet_id, user_id, label, payload) VALUES ($1,$2,$3,$4) RETURNING id',
      [outletId, user.id, label ? String(label).slice(0, 120) : null, JSON.stringify(bersih)]);
    return rows[0].id;
  });
}

async function listHeld({ outletId, userId }) {
  const p = [outletId];
  let w = '';
  if (userId) { p.push(userId); w = `AND h.user_id = $${p.length}`; }
  const { rows } = await db.query(
    `SELECT h.*, u.name AS user_name, jsonb_array_length(h.payload->'items') AS jml_item
     FROM held_sales h JOIN users u ON u.id = h.user_id WHERE h.outlet_id = $1 AND h.deleted_at IS NULL ${w} ORDER BY h.id DESC`, p);
  return rows;
}

async function getHeld(id, user) {
  const { rows } = await db.query('SELECT * FROM held_sales WHERE id=$1 AND deleted_at IS NULL', [id]);
  const h = rows[0];
  if (!h) throw new AppError('Transaksi ditahan tidak ditemukan.', 404);
  if (user.role === 'kasir' && String(h.user_id) !== String(user.id)) throw new AppError('Bukan transaksi Anda.', 403);
  return h;
}

async function deleteHeld(id, user) {
  await getHeld(id, user);
  await db.query('UPDATE held_sales SET deleted_at=now() WHERE id=$1', [id]);
}

module.exports = { preview, create, get, list, voidSale, createReturn, listReturns, getReturn, hold, listHeld, getHeld, deleteHeld };
