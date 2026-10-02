// Uji kompilasi semua template EJS & load semua modul (tanpa database)
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const root = path.join(__dirname, '..');
function walk(dir, ext, out = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p, ext, out); else if (p.endsWith(ext)) out.push(p);
  }
  return out;
}

let gagal = 0;
for (const f of walk(path.join(root, 'views'), '.ejs')) {
  try { ejs.compile(fs.readFileSync(f, 'utf8'), { filename: f }); } catch (e) { gagal++; console.error('TEMPLATE GAGAL', path.relative(root, f), '\n', e.message); }
}
for (const dir of ['services', 'controllers', 'lib', 'middleware', 'routes']) {
  for (const f of walk(path.join(root, dir), '.js')) {
    try { require(f); } catch (e) { gagal++; console.error('MODUL GAGAL', path.relative(root, f), '\n', e.message); }
  }
}
require(path.join(root, 'app.js'));
if (gagal) { console.error(`${gagal} kegagalan.`); process.exit(1); }
console.log('Semua template & modul OK.');
process.exit(0);
