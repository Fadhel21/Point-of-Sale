// Penomoran dokumen berurutan. Dipanggil DI DALAM transaksi dokumen yang bersangkutan,
// sehingga bila transaksi gagal, nomor ikut di-rollback dan tidak ada nomor bolong.
const settings = require('./settings');

const DEFAULT = {
  PJ: '{OUTLET}-{YYMMDD}-{NNNN}',
};

/**
 * Ambil nomor berikutnya.
 * Template berisi {DD} -> urutan direset per hari; tanpa {DD} -> per bulan.
 * Urutan selalu per outlet.
 */
async function next(client, outletId, docType) {
  const templates = await settings.get('nomor', client);
  const tpl = (templates && templates[docType]) || DEFAULT[docType] || `${docType}-{YYMMDD}-{NNNN}`;
  const perHari = /\{(YYMMDD|DD|YYYYMMDD)\}/.test(tpl);

  const { rows } = await client.query(
    `WITH o AS (SELECT code FROM outlets WHERE id = $1),
          up AS (
            INSERT INTO doc_counters (outlet_id, doc_type, doc_date, last_no)
            VALUES ($1, $2, CASE WHEN $3 THEN CURRENT_DATE ELSE date_trunc('month', CURRENT_DATE)::date END, 1)
            ON CONFLICT (outlet_id, doc_type, doc_date)
            DO UPDATE SET last_no = doc_counters.last_no + 1
            RETURNING last_no
          )
     SELECT up.last_no, o.code, to_char(CURRENT_DATE, 'YYYYMMDD') AS ymd FROM up, o`,
    [outletId, docType, perHari]
  );
  if (!rows.length) throw new Error('Outlet tidak ditemukan untuk penomoran dokumen');
  const { last_no: no, code, ymd } = rows[0];
  return tpl
    .replace('{OUTLET}', code)
    .replace('{YYYYMMDD}', ymd)
    .replace('{YYMMDD}', ymd.slice(2))
    .replace('{YYMM}', ymd.slice(2, 6))
    .replace('{DD}', ymd.slice(6))
    .replace(/\{(N+)\}/, (_, n) => String(no).padStart(n.length, '0'));
}

module.exports = { next };
