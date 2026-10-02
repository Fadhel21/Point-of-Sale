// Menjalankan semua file *.test.js di folder tests secara berurutan.
// Uji yang butuh database dilewati bila database belum bisa dihubungi.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js')).sort();
let gagal = 0;
for (const f of files) {
  process.stdout.write(`\n== ${f}\n`);
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit' });
  if (r.status !== 0) gagal++;
}
console.log(gagal ? `\n${gagal} file uji GAGAL.` : '\nSemua uji lulus.');
process.exit(gagal ? 1 : 0);
