// Aritmetika uang & kuantitas tanpa float.
// Uang disimpan sebagai BigInt dalam satuan sen (1/100 rupiah).
// Kuantitas disimpan sebagai BigInt dalam 1/10000 satuan.

const SEN = 100n;
const QTY = 10000n;

function parseDecimal(input, scale) {
  if (input === null || input === undefined || input === '') return 0n;
  let s = String(input).trim().replace(/\s/g, '');
  // Titik selalu desimal ("1250000.50"). Koma diterima sebagai desimal hanya bila tanpa titik ("12,5").
  // Pemisah ribuan sengaja TIDAK didukung: "1.500" bisa berarti 1,5 atau 1500 -> terlalu berbahaya.
  if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`Angka tidak valid: ${input}`);
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  const [intPart, frac = ''] = s.split('.');
  const digits = String(scale).length - 1;
  // Bulatkan setengah ke atas pada digit berikutnya
  const fracPadded = (frac + '0'.repeat(digits + 1)).slice(0, digits + 1);
  let v = BigInt(intPart) * scale + BigInt(fracPadded.slice(0, digits) || '0');
  if (Number(fracPadded[digits]) >= 5) v += 1n;
  return neg ? -v : v;
}

/** String/number rupiah -> sen (BigInt) */
const toSen = (v) => parseDecimal(v, SEN);
/** String kuantitas -> 1/10000 (BigInt) */
const toQty = (v) => parseDecimal(v, QTY);

function formatScaled(v, scale) {
  const digits = String(scale).length - 1;
  const neg = v < 0n;
  const a = neg ? -v : v;
  const i = a / scale;
  const f = (a % scale).toString().padStart(digits, '0');
  return (neg ? '-' : '') + i.toString() + '.' + f;
}

/** sen -> string untuk NUMERIC(15,2), mis. "12500.00" */
const senToStr = (v) => formatScaled(v, SEN);
/** qty -> string untuk NUMERIC(15,4) */
const qtyToStr = (v) => formatScaled(v, QTY);

/** Pembagian dibulatkan setengah menjauhi nol */
function divRound(a, b) {
  if (b === 0n) throw new Error('Pembagian dengan nol');
  const neg = (a < 0n) !== (b < 0n);
  const aa = a < 0n ? -a : a;
  const bb = b < 0n ? -b : b;
  let q = aa / bb;
  if ((aa % bb) * 2n >= bb) q += 1n;
  return neg ? -q : q;
}

/** harga (sen) x qty (1/10000) -> sen */
const mulQty = (sen, qty) => divRound(sen * qty, QTY);
/** nilai (sen) x persen (sen persen, mis. 11% = 1100n) -> sen */
const pct = (sen, pctSen) => divRound(sen * pctSen, 100n * SEN);

const min = (a, b) => (a < b ? a : b);
const max = (a, b) => (a > b ? a : b);

/** Format tampilan Rupiah dari string NUMERIC / BigInt sen */
function rupiah(v, { sen = false } = {}) {
  const s = typeof v === 'bigint' ? v : toSen(v ?? 0);
  const neg = s < 0n;
  const a = neg ? -s : s;
  const i = (a / SEN).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const f = (a % SEN).toString().padStart(2, '0');
  return (neg ? '-' : '') + 'Rp ' + i + (sen || f !== '00' ? ',' + f : '');
}

/** Format kuantitas, buang nol di belakang koma */
function angka(v) {
  const q = typeof v === 'bigint' ? v : toQty(v ?? 0);
  const neg = q < 0n;
  const a = neg ? -q : q;
  const i = (a / QTY).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const f = (a % QTY).toString().padStart(4, '0').replace(/0+$/, '');
  return (neg ? '-' : '') + i + (f ? ',' + f : '');
}

module.exports = { SEN, QTY, toSen, toQty, senToStr, qtyToStr, divRound, mulQty, pct, min, max, rupiah, angka };
