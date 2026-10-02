// Uji aritmetika uang: node tests/money.test.js
const assert = require('assert');
const M = require('../lib/money');
const { alokasi, bulatkan } = require('../services/pricing');

assert.strictEqual(M.toSen('1250000'), 125000000n);
assert.strictEqual(M.toSen('1250000,50'), 125000050n);
assert.throws(() => M.toSen('1.250.000,50')); // format ambigu ditolak
assert.strictEqual(M.toQty('1.500'), 15000n); // 1,5 bukan 1500
assert.strictEqual(M.toSen('0.1'), 10n);
assert.strictEqual(M.toSen('10.005'), 1001n); // dibulatkan setengah ke atas
assert.strictEqual(M.senToStr(M.toSen('0.1') + M.toSen('0.2')), '0.30'); // bukan 0.30000000000000004
assert.strictEqual(M.toQty('1.5'), 15000n);
assert.strictEqual(M.mulQty(M.toSen('3333.33'), M.toQty('3')), 999999n);
assert.strictEqual(M.pct(M.toSen('100000'), M.toSen('11')), M.toSen('11000'));
assert.strictEqual(M.divRound(5n, 2n), 3n);
assert.strictEqual(M.divRound(-5n, 2n), -3n);
assert.strictEqual(M.rupiah('1250000.00'), 'Rp 1.250.000');
assert.strictEqual(M.rupiah('1250000.5'), 'Rp 1.250.000,50');
assert.strictEqual(M.angka('12.5000'), '12,5');

// Alokasi selalu berjumlah persis
const a = alokasi(1000n, [333n, 333n, 334n]);
assert.strictEqual(a.reduce((x, y) => x + y, 0n), 1000n);
const b = alokasi(7n, [1n, 1n, 1n]);
assert.strictEqual(b.reduce((x, y) => x + y, 0n), 7n);

// Pembulatan tunai
assert.strictEqual(bulatkan(M.toSen('12345'), M.toSen('100'), 'terdekat'), M.toSen('12300'));
assert.strictEqual(bulatkan(M.toSen('12350'), M.toSen('100'), 'terdekat'), M.toSen('12400'));
assert.strictEqual(bulatkan(M.toSen('12301'), M.toSen('100'), 'atas'), M.toSen('12400'));
assert.strictEqual(bulatkan(M.toSen('12399'), M.toSen('100'), 'bawah'), M.toSen('12300'));

assert.throws(() => M.toSen('abc'));
console.log('Semua uji uang lulus.');
