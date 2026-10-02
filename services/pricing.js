// Mesin perhitungan harga penjualan. SATU-SATUNYA sumber angka subtotal, diskon, pajak, total.
// Angka kiriman browser tidak pernah dipakai; browser hanya mengirim id produk, satuan, qty,
// dan instruksi diskon manual (yang dibatasi di sini).
const settings = require('./settings');
const { AppError } = require('../lib/errors');
const M = require('../lib/money');

const { toSen, toQty, mulQty, pct, divRound, min, QTY } = M;

/** Diskon manual: {tipe:'persen'|'nominal', nilai} terhadap basis (sen) */
function hitungDiskon(basis, tipe, nilai) {
  if (!nilai) return 0n;
  if (tipe === 'persen') {
    const p = toSen(nilai); // persen dengan 2 desimal, mis 12.5% -> 1250n
    if (p < 0n || p > 10000n) throw new AppError('Diskon persen harus 0-100.');
    return pct(basis, p);
  }
  const n = toSen(nilai);
  if (n < 0n) throw new AppError('Diskon tidak boleh negatif.');
  return min(n, basis);
}

/** Bagi `jumlah` ke baris-baris secara proporsional terhadap `bobot`, sisa ke baris terbesar */
function alokasi(jumlah, bobot) {
  const total = bobot.reduce((a, b) => a + b, 0n);
  if (jumlah === 0n || total === 0n) return bobot.map(() => 0n);
  const hasil = bobot.map((b) => (jumlah * b) / total);
  let sisa = jumlah - hasil.reduce((a, b) => a + b, 0n);
  const urut = bobot.map((b, i) => [b, i]).sort((a, b) => (b[0] > a[0] ? 1 : b[0] < a[0] ? -1 : 0));
  for (let k = 0; sisa > 0n; k = (k + 1) % urut.length) { hasil[urut[k][1]] += 1n; sisa -= 1n; }
  return hasil;
}

async function konfigurasi(client) {
  // Berurutan: satu client transaksi tidak boleh menjalankan query paralel
  const pajak = await settings.get('pajak', client);
  const pembulatan = await settings.get('pembulatan', client);
  const poin = await settings.get('poin', client);
  return {
    pajakAktif: !!(pajak && pajak.aktif),
    tarif: pajak && pajak.aktif ? toSen(pajak.tarif || 0) : 0n, // 11% -> 1100n
    termasuk: !!(pajak && pajak.termasuk),
    bulatAktif: !!(pembulatan && pembulatan.aktif),
    kelipatan: pembulatan && pembulatan.aktif ? toSen(pembulatan.kelipatan || 0) : 0n,
    modeBulat: (pembulatan && pembulatan.mode) || 'terdekat',
    poinAktif: !!(poin && poin.aktif),
    belanjaPerPoin: poin ? toSen(poin.belanjaPerPoin || 0) : 0n,
    nilaiPoin: poin ? toSen(poin.nilaiPoin || 0) : 0n,
  };
}

/** Pembulatan total tunai ke kelipatan tertentu */
function bulatkan(total, kelipatan, mode) {
  if (!kelipatan || kelipatan <= 0n) return total;
  const sisa = total % kelipatan;
  if (sisa === 0n) return total;
  if (mode === 'bawah') return total - sisa;
  if (mode === 'atas') return total - sisa + kelipatan;
  return sisa * 2n >= kelipatan ? total - sisa + kelipatan : total - sisa;
}

/**
 * Hitung transaksi.
 * input: { items: [{product_id, unit_id?, qty, disc_type?, disc_value?, note?}],
 *          customer_id?, voucher_code?, trx_disc_type?, trx_disc_value?, points_use? }
 * opts: { lock: true } untuk mengunci baris voucher & pelanggan saat menyimpan.
 */
async function hitung(client, input, opts = {}) {
  const cfg = await konfigurasi(client);
  const itemsIn = Array.isArray(input.items) ? input.items : [];
  if (!itemsIn.length) throw new AppError('Keranjang masih kosong.');
  if (itemsIn.length > 500) throw new AppError('Jumlah baris terlalu banyak.');

  const ids = [...new Set(itemsIn.map((i) => String(i.product_id)))];
  if (ids.some((id) => !/^\d+$/.test(id))) throw new AppError('Produk tidak valid.');
  const { rows: prods } = await client.query(
    `SELECT p.id, p.name, p.variant_name, p.sku, p.sell_price, p.cost_price, p.category_id, p.unit_id, u.name AS unit_name
     FROM products p LEFT JOIN units u ON u.id = p.unit_id
     WHERE p.id = ANY($1::bigint[]) AND p.deleted_at IS NULL AND p.active`, [ids]);
  const prodMap = new Map(prods.map((p) => [String(p.id), p]));

  const { rows: unitRows } = await client.query(
    `SELECT pu.product_id, pu.unit_id, pu.factor, pu.sell_price, u.name AS unit_name
     FROM product_units pu JOIN units u ON u.id = pu.unit_id
     WHERE pu.product_id = ANY($1::bigint[]) AND pu.deleted_at IS NULL`, [ids]);
  const { rows: grosir } = await client.query(
    `SELECT product_id, min_qty, price FROM wholesale_prices
     WHERE product_id = ANY($1::bigint[]) AND deleted_at IS NULL ORDER BY min_qty DESC`, [ids]);
  const { rows: promo } = await client.query(
    `SELECT id, name, product_id, category_id, disc_type, value FROM discounts
     WHERE deleted_at IS NULL AND active AND now() BETWEEN starts_at AND ends_at
       AND (product_id = ANY($1::bigint[]) OR category_id IN (SELECT category_id FROM products WHERE id = ANY($1::bigint[])))`, [ids]);

  // Total qty dasar per produk (untuk harga grosir lintas baris produk yang sama)
  const qtyDasarPerProduk = new Map();
  const baris = itemsIn.map((it) => {
    const p = prodMap.get(String(it.product_id));
    if (!p) throw new AppError('Ada produk yang tidak ditemukan atau sudah nonaktif. Muat ulang keranjang.');
    const qty = toQty(it.qty);
    if (qty <= 0n) throw new AppError(`Jumlah "${p.name}" harus lebih dari 0.`);
    if (qty > toQty('99999999')) throw new AppError(`Jumlah "${p.name}" terlalu besar.`);
    let factor = QTY; let unitName = p.unit_name; let hargaSatuan = toSen(p.sell_price); let unitId = null;
    if (it.unit_id && String(it.unit_id) !== String(p.unit_id || '')) {
      const u = unitRows.find((r) => String(r.product_id) === String(p.id) && String(r.unit_id) === String(it.unit_id));
      if (!u) throw new AppError(`Satuan tidak valid untuk "${p.name}".`);
      factor = toQty(u.factor);
      unitName = u.unit_name;
      unitId = u.unit_id;
      const hs = toSen(u.sell_price);
      hargaSatuan = hs > 0n ? hs : mulQty(toSen(p.sell_price), factor);
    }
    const baseQty = divRound(qty * factor, QTY);
    qtyDasarPerProduk.set(String(p.id), (qtyDasarPerProduk.get(String(p.id)) || 0n) + baseQty);
    return { it, p, qty, factor, unitId, unitName, hargaSatuan, baseQty };
  });

  let itemDiscountTotal = 0n;
  const lines = baris.map((b) => {
    const { it, p, qty, factor } = b;
    let harga = b.hargaSatuan;
    // Harga grosir otomatis berdasar total qty dasar produk ini (harga per satuan dasar)
    const tier = grosir.find((g) => String(g.product_id) === String(p.id) && qtyDasarPerProduk.get(String(p.id)) >= toQty(g.min_qty));
    let grosirDipakai = false;
    if (tier) {
      const hg = mulQty(toSen(tier.price), factor);
      if (hg < harga) { harga = hg; grosirDipakai = true; }
    }
    const bruto = mulQty(harga, qty);
    // Promo otomatis: pilih yang memberi potongan terbesar
    let auto = 0n; let promoNama = null;
    for (const d of promo) {
      if (!(String(d.product_id) === String(p.id) || (d.category_id && String(d.category_id) === String(p.category_id)))) continue;
      const nilai = d.disc_type === 'persen' ? pct(bruto, toSen(d.value)) : min(mulQty(toSen(d.value), qty), bruto);
      if (nilai > auto) { auto = nilai; promoNama = d.name; }
    }
    const manual = hitungDiskon(bruto - auto, it.disc_type, it.disc_value);
    const diskon = min(auto + manual, bruto);
    itemDiscountTotal += diskon;
    return {
      product_id: String(p.id),
      name: p.variant_name ? `${p.name} - ${p.variant_name}` : p.name,
      sku: p.sku,
      unit_id: b.unitId,
      unit_name: b.unitName,
      unit_factor: factor,
      qty,
      base_qty: b.baseQty,
      price: harga,
      normal_price: b.hargaSatuan,
      cost: toSen(p.cost_price),
      gross: bruto,
      discount: diskon,
      promo: promoNama,
      grosir: grosirDipakai,
      disc_type: it.disc_type || null,
      disc_value: it.disc_value || null,
      line_total: bruto - diskon,
      note: it.note ? String(it.note).slice(0, 200) : null,
    };
  });

  const subtotal = lines.reduce((a, l) => a + l.line_total, 0n);
  let sisa = subtotal;

  // Diskon transaksi
  const trxDiscount = hitungDiskon(sisa, input.trx_disc_type, input.trx_disc_value);
  sisa -= trxDiscount;

  // Pelanggan
  let customer = null;
  if (input.customer_id) {
    const { rows } = await client.query(
      `SELECT id, code, name, is_member, points, receivable, credit_limit, email FROM customers
       WHERE id = $1 AND deleted_at IS NULL ${opts.lock ? 'FOR UPDATE' : ''}`, [input.customer_id]);
    if (!rows[0]) throw new AppError('Pelanggan tidak ditemukan.');
    customer = rows[0];
  }

  // Voucher
  let voucher = null; let voucherDiscount = 0n;
  if (input.voucher_code && String(input.voucher_code).trim()) {
    const { rows } = await client.query(
      `SELECT * FROM vouchers WHERE upper(code) = upper($1) AND deleted_at IS NULL ${opts.lock ? 'FOR UPDATE' : ''}`,
      [String(input.voucher_code).trim()]);
    const v = rows[0];
    if (!v || !v.active) throw new AppError('Kode voucher tidak ditemukan atau nonaktif.');
    const now = new Date();
    if (now < new Date(v.starts_at) || now > new Date(v.ends_at)) throw new AppError('Voucher di luar masa berlaku.');
    if (v.used >= v.quota) throw new AppError('Kuota voucher sudah habis.');
    if (subtotal < toSen(v.min_purchase)) throw new AppError(`Voucher butuh minimal belanja ${M.rupiah(v.min_purchase)}.`);
    voucherDiscount = v.disc_type === 'persen' ? pct(sisa, toSen(v.value)) : toSen(v.value);
    const maks = toSen(v.max_discount);
    if (maks > 0n) voucherDiscount = min(voucherDiscount, maks);
    voucherDiscount = min(voucherDiscount, sisa);
    sisa -= voucherDiscount;
    voucher = v;
  }

  // Poin
  let pointsUsed = 0n; let pointsValue = 0n;
  if (input.points_use && toSen(input.points_use) > 0n) {
    if (!cfg.poinAktif) throw new AppError('Fitur poin tidak aktif.');
    if (!customer || !customer.is_member) throw new AppError('Poin hanya untuk member.');
    pointsUsed = toSen(input.points_use);
    if (pointsUsed % 100n !== 0n) throw new AppError('Poin yang dipakai harus bilangan bulat.');
    if (pointsUsed > toSen(customer.points)) throw new AppError('Poin member tidak cukup.');
    // pointsUsed dalam sen-poin; nilai = poin x nilaiPoin
    pointsValue = (pointsUsed * cfg.nilaiPoin) / 100n;
    if (pointsValue > sisa) throw new AppError('Nilai poin melebihi total belanja.');
    sisa -= pointsValue;
  }

  // Pajak
  let dpp; let tax; let total;
  if (!cfg.pajakAktif || cfg.tarif === 0n) { dpp = sisa; tax = 0n; total = sisa; }
  else if (cfg.termasuk) {
    dpp = divRound(sisa * 10000n, 10000n + cfg.tarif);
    tax = sisa - dpp;
    total = sisa;
  } else {
    dpp = sisa;
    tax = pct(sisa, cfg.tarif);
    total = sisa + tax;
  }

  // Alokasi diskon level transaksi & pajak ke baris (untuk retur dan laba per item)
  const bobot = lines.map((l) => l.line_total);
  const shares = alokasi(trxDiscount + voucherDiscount + pointsValue, bobot);
  const taxes = alokasi(tax, lines.map((l, i) => l.line_total - shares[i]));
  lines.forEach((l, i) => { l.trx_share = shares[i]; l.tax = taxes[i]; });

  const costTotal = lines.reduce((a, l) => a + mulQty(l.cost, l.base_qty), 0n);
  const totalTunai = cfg.bulatAktif ? bulatkan(total, cfg.kelipatan, cfg.modeBulat) : total;

  return {
    lines, customer, voucher, cfg,
    subtotal, itemDiscount: itemDiscountTotal, trxDiscount, voucherDiscount,
    pointsUsed, pointsValue, dpp, tax, total, totalTunai, costTotal,
  };
}

/** Poin yang didapat (dalam sen-poin, kelipatan 100 = bilangan bulat) */
function poinDidapat(cfg, total, customer) {
  if (!cfg.poinAktif || !customer || !customer.is_member || cfg.belanjaPerPoin <= 0n) return 0n;
  return (total / cfg.belanjaPerPoin) * 100n;
}

/** Ringkasan untuk dikirim ke browser (semua string, tanpa harga pokok) */
function ringkas(h) {
  const s = M.senToStr;
  return {
    lines: h.lines.map((l) => ({
      product_id: l.product_id, name: l.name, sku: l.sku, unit_id: l.unit_id, unit_name: l.unit_name,
      qty: M.qtyToStr(l.qty), price: s(l.price), normal_price: s(l.normal_price), gross: s(l.gross), discount: s(l.discount),
      line_total: s(l.line_total), promo: l.promo, grosir: l.grosir, note: l.note,
    })),
    customer: h.customer ? { id: h.customer.id, name: h.customer.name, points: h.customer.points, is_member: h.customer.is_member } : null,
    voucher: h.voucher ? h.voucher.code : null,
    subtotal: s(h.subtotal), item_discount: s(h.itemDiscount), trx_discount: s(h.trxDiscount),
    voucher_discount: s(h.voucherDiscount), points_value: s(h.pointsValue), dpp: s(h.dpp), tax: s(h.tax),
    total: s(h.total), total_tunai: s(h.totalTunai), tax_inclusive: h.cfg.termasuk, tax_rate: s(h.cfg.tarif),
    rounding: s(h.totalTunai - h.total),
  };
}

module.exports = { hitung, ringkas, poinDidapat, bulatkan, alokasi, hitungDiskon };
