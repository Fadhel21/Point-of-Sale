// Uji generator Code 128: node tests/barcode.test.js
const assert = require('assert');
const { encode, POLA } = require('../lib/barcode');

// Setiap pola simbol Code 128 lebarnya 11 modul
POLA.forEach((p, i) => assert.strictEqual([...p].reduce((a, c) => a + Number(c), 0), 11, `pola ${i}`));
assert.strictEqual(new Set(POLA).size, POLA.length, 'pola harus unik');

// "PJ" : start B(104) + P(48) + J(42); cek = (104 + 48*1 + 42*2) % 103 = 236 % 103 = 30
const e = encode('PJ');
assert.strictEqual(e, POLA[104] + POLA[48] + POLA[42] + POLA[30] + '2331112');
assert.throws(() => encode(''));
assert.throws(() => encode('ä'));
console.log('Semua uji barcode lulus.');
