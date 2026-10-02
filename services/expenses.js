// Biaya operasional
const db = require('../config/db');
const docnumber = require('./docnumber');
const audit = require('./audit');
const { AppError } = require('../lib/errors');
const { toSen, senToStr } = require('../lib/money');

async function list({ outletId, from, to, categoryId }) {
  const p = [outletId]; const w = ['e.outlet_id=$1', 'e.deleted_at IS NULL'];
  if (from) { p.push(from); w.push(`e.expense_date >= $${p.length}`); }
  if (to) { p.push(to); w.push(`e.expense_date <= $${p.length}`); }
  if (categoryId) { p.push(categoryId); w.push(`e.category_id = $${p.length}`); }
  const { rows } = await db.query(
    `SELECT e.*, c.name AS category_name, u.name AS user_name FROM expenses e JOIN expense_categories c ON c.id = e.category_id
     LEFT JOIN users u ON u.id = e.user_id WHERE ${w.join(' AND ')} ORDER BY e.expense_date DESC, e.id DESC LIMIT 500`, p);
  return rows;
}

async function get(id) {
  const { rows } = await db.query('SELECT * FROM expenses WHERE id=$1 AND deleted_at IS NULL', [id]);
  return rows[0];
}

async function save(id, d, { outletId, user, ip }) {
  const n = toSen(d.amount);
  if (n <= 0n) throw new AppError('Jumlah harus lebih dari 0.');
  if (!d.category_id) throw new AppError('Pilih kategori biaya.');
  if (!d.expense_date) throw new AppError('Tanggal wajib diisi.');
  if (!d.description) throw new AppError('Keterangan wajib diisi.');
  return db.withTransaction(async (client) => {
    if (id) {
      await client.query('UPDATE expenses SET category_id=$1, expense_date=$2, amount=$3, description=$4 WHERE id=$5 AND deleted_at IS NULL',
        [d.category_id, d.expense_date, senToStr(n), d.description, id]);
    } else {
      const number = await docnumber.next(client, outletId, 'BY');
      const { rows } = await client.query(
        'INSERT INTO expenses (number, outlet_id, category_id, expense_date, amount, description, user_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
        [number, outletId, d.category_id, d.expense_date, senToStr(n), d.description, user.id]);
      id = rows[0].id;
    }
    await audit.log(client, { userId: user.id, action: 'biaya.simpan', entity: 'expenses', entityId: id, data: { jumlah: senToStr(n) }, ip });
    return id;
  });
}

async function remove(id, user) {
  await db.query('UPDATE expenses SET deleted_at=now() WHERE id=$1', [id]);
  await audit.log(null, { userId: user.id, action: 'biaya.hapus', entity: 'expenses', entityId: id });
}

module.exports = { list, get, save, remove };
