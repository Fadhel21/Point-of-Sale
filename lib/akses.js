// Hak akses per peran dan struktur menu sidebar.
// Setiap izin dipetakan ke daftar peran yang boleh.

const SEMUA = ['pemilik', 'manajer', 'kasir', 'gudang'];
const PM = ['pemilik', 'manajer'];
const PMG = ['pemilik', 'manajer', 'gudang'];

const IZIN = {
  dashboard: SEMUA,
  kasir: ['pemilik', 'manajer', 'kasir'],
  'transaksi.lihat': ['pemilik', 'manajer', 'kasir'],
  'transaksi.semua': PM,          // melihat transaksi kasir lain
  'transaksi.retur': ['pemilik', 'manajer', 'kasir'], // kasir mengajukan, perlu persetujuan supervisor
  'transaksi.void': ['pemilik', 'manajer', 'kasir'],
  'transaksi.setujui': PM,        // bisa menyetujui void/retur
  shift: ['pemilik', 'manajer', 'kasir'],
  'shift.semua': PM,
  produk: PMG,
  'produk.lihat': SEMUA,
  persediaan: PMG,
  'persediaan.setujui': PM,
  pembelian: PMG,
  pelanggan: ['pemilik', 'manajer', 'kasir'],
  'pelanggan.piutang': PM,
  promo: PM,
  pengeluaran: PM,
  laporan: PM,
  'lihat.hargabeli': PMG,         // kasir tidak melihat harga beli & laba
  'lihat.laba': PM,
  pengaturan: ['pemilik'],
};

function boleh(role, izin) {
  const r = IZIN[izin];
  return !!r && r.includes(role);
}

const MENU = [
  { label: 'Dashboard', href: '/', izin: 'dashboard', ikon: 'dashboard', grup: 'Operasional' },
  { label: 'Kasir', href: '/kasir', izin: 'kasir', ikon: 'kasir' },
  { label: 'Transaksi', izin: 'transaksi.lihat', ikon: 'transaksi', anak: [
    { label: 'Riwayat Penjualan', href: '/transaksi' },
    { label: 'Transaksi Ditahan', href: '/transaksi/ditahan' },
    { label: 'Retur Penjualan', href: '/transaksi/retur' },
    { label: 'Pembatalan (Void)', href: '/transaksi/void' },
  ] },
  { label: 'Shift & Kas', izin: 'shift', ikon: 'shift', anak: [
    { label: 'Buka / Tutup Shift', href: '/shift' },
    { label: 'Kas Masuk & Keluar', href: '/shift/kas' },
    { label: 'Riwayat Shift', href: '/shift/riwayat' },
  ] },
  { label: 'Produk', izin: 'produk', ikon: 'produk', grup: 'Inventori', anak: [
    { label: 'Daftar Produk', href: '/produk' },
    { label: 'Kategori', href: '/master/kategori' },
    { label: 'Satuan', href: '/master/satuan' },
    { label: 'Merek', href: '/master/merek' },
    { label: 'Cetak Label Barcode', href: '/produk/label' },
  ] },
  { label: 'Persediaan', izin: 'persediaan', ikon: 'persediaan', anak: [
    { label: 'Stok Saat Ini', href: '/persediaan' },
    { label: 'Kartu Stok', href: '/persediaan/kartu' },
    { label: 'Penyesuaian Stok', href: '/persediaan/penyesuaian' },
    { label: 'Stok Opname', href: '/persediaan/opname' },
    { label: 'Mutasi Antar Outlet', href: '/persediaan/mutasi' },
    { label: 'Stok Minimum', href: '/persediaan/minimum' },
  ] },
  { label: 'Pembelian', izin: 'pembelian', ikon: 'pembelian', anak: [
    { label: 'Pemasok', href: '/pembelian/pemasok' },
    { label: 'Pesanan Pembelian (PO)', href: '/pembelian/po' },
    { label: 'Penerimaan Barang', href: '/pembelian/penerimaan' },
    { label: 'Retur Pembelian', href: '/pembelian/retur' },
    { label: 'Hutang Pemasok', href: '/pembelian/hutang' },
  ] },
  { label: 'Pelanggan', izin: 'pelanggan', ikon: 'pelanggan', grup: 'Bisnis', anak: [
    { label: 'Daftar Pelanggan', href: '/pelanggan' },
    { label: 'Member & Poin', href: '/pelanggan/member' },
    { label: 'Piutang Pelanggan', href: '/pelanggan/piutang', izin: 'pelanggan.piutang' },
  ] },
  { label: 'Promo', izin: 'promo', ikon: 'promo', anak: [
    { label: 'Diskon', href: '/promo/diskon' },
    { label: 'Voucher', href: '/promo/voucher' },
    { label: 'Harga Grosir / Bertingkat', href: '/promo/grosir' },
  ] },
  { label: 'Pengeluaran', izin: 'pengeluaran', ikon: 'pengeluaran', anak: [
    { label: 'Biaya Operasional', href: '/pengeluaran' },
    { label: 'Kategori Biaya', href: '/master/kategori-biaya' },
  ] },
  { label: 'Laporan', izin: 'laporan', ikon: 'laporan', anak: [
    { label: 'Penjualan', href: '/laporan/penjualan' },
    { label: 'Per Produk / Kategori', href: '/laporan/produk' },
    { label: 'Per Kasir', href: '/laporan/kasir' },
    { label: 'Metode Pembayaran', href: '/laporan/pembayaran' },
    { label: 'Laba Kotor', href: '/laporan/laba' },
    { label: 'Shift & Selisih Kas', href: '/laporan/shift' },
    { label: 'Stok & Nilai Persediaan', href: '/laporan/stok' },
    { label: 'Pembelian', href: '/laporan/pembelian' },
    { label: 'Retur & Void', href: '/laporan/retur' },
    { label: 'Pajak', href: '/laporan/pajak' },
    { label: 'Pengeluaran', href: '/laporan/pengeluaran' },
  ] },
  { label: 'Pengaturan', izin: 'pengaturan', ikon: 'pengaturan', grup: 'Sistem', anak: [
    { label: 'Profil Toko', href: '/pengaturan/toko' },
    { label: 'Outlet', href: '/pengaturan/outlet' },
    { label: 'Pengguna & Peran', href: '/pengaturan/pengguna' },
    { label: 'Metode Pembayaran', href: '/pengaturan/pembayaran' },
    { label: 'Pajak & Pembulatan', href: '/pengaturan/pajak' },
    { label: 'Struk', href: '/pengaturan/struk' },
    { label: 'Nomor Dokumen', href: '/pengaturan/nomor' },
    { label: 'Cadangan Data', href: '/pengaturan/cadangan' },
    { label: 'Log Audit', href: '/pengaturan/audit' },
  ] },
];

// Setiap item mewarisi kelompok item sebelumnya, supaya judul kelompok tetap ada walau item pertamanya tersaring
let grupAktif = null;
for (const m of MENU) { grupAktif = m.grup || grupAktif; m.grup = grupAktif; }

function menuUntuk(role) {
  return MENU.filter((m) => boleh(role, m.izin)).map((m) => ({
    ...m,
    anak: m.anak && m.anak.filter((a) => !a.izin || boleh(role, a.izin)),
  }));
}

const NAMA_PERAN = { pemilik: 'Pemilik', manajer: 'Manajer/Supervisor', kasir: 'Kasir', gudang: 'Gudang' };

module.exports = { IZIN, boleh, menuUntuk, NAMA_PERAN };
