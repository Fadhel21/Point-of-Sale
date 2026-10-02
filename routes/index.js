// Peta rute aplikasi
const express = require('express');
const { wajibLogin, izin } = require('../middleware/auth');

const auth = require('../controllers/auth');
const dashboard = require('../controllers/dashboard');
const kasir = require('../controllers/kasir');
const transaksi = require('../controllers/transaksi');
const shift = require('../controllers/shift');
const produk = require('../controllers/produk');
const master = require('../controllers/master');
const persediaan = require('../controllers/persediaan');
const pembelian = require('../controllers/pembelian');
const pelanggan = require('../controllers/pelanggan');
const promo = require('../controllers/promo');
const pengeluaran = require('../controllers/pengeluaran');
const laporan = require('../controllers/laporan');
const pengaturan = require('../controllers/pengaturan');

const r = express.Router();

// Publik
r.get('/login', auth.formLogin);
r.post('/login', auth.login);
r.get('/sehat', (req, res) => res.json({ ok: true }));

r.use(wajibLogin);
r.post('/logout', auth.logout);
r.post('/outlet', izin('transaksi.semua'), auth.gantiOutlet);
r.get('/akun', auth.akun);
r.post('/akun/password', auth.gantiPassword);

r.get('/', izin('dashboard'), dashboard.index);

// Kasir
r.get('/kasir', izin('kasir'), kasir.index);
r.get('/kasir/cari', izin('kasir'), kasir.cari);
r.get('/kasir/produk', izin('kasir'), kasir.grid);
r.get('/kasir/pelanggan', izin('kasir'), kasir.cariPelanggan);
r.post('/kasir/hitung', izin('kasir'), kasir.hitung);
r.post('/kasir/bayar', izin('kasir'), kasir.bayar);
r.post('/kasir/tahan', izin('kasir'), kasir.tahan);
r.get('/kasir/ditahan/:id', izin('kasir'), kasir.ambilDitahan);

// Transaksi
r.get('/transaksi', izin('transaksi.lihat'), transaksi.riwayat);
r.get('/transaksi/ditahan', izin('transaksi.lihat'), transaksi.ditahan);
r.post('/transaksi/ditahan/:id/hapus', izin('transaksi.lihat'), transaksi.hapusDitahan);
r.get('/transaksi/retur', izin('transaksi.lihat'), transaksi.daftarRetur);
r.get('/transaksi/retur/:id', izin('transaksi.lihat'), transaksi.detailRetur);
r.get('/transaksi/void', izin('transaksi.lihat'), transaksi.daftarVoid);
r.get('/transaksi/:id', izin('transaksi.lihat'), transaksi.detail);
r.get('/transaksi/:id/struk', izin('transaksi.lihat'), transaksi.struk);
r.post('/transaksi/:id/email', izin('transaksi.lihat'), transaksi.email);
r.post('/transaksi/:id/void', izin('transaksi.void'), transaksi.voidSale);
r.get('/transaksi/:id/retur', izin('transaksi.retur'), transaksi.formRetur);
r.post('/transaksi/:id/retur', izin('transaksi.retur'), transaksi.simpanRetur);

// Shift
r.get('/shift', izin('shift'), shift.index);
r.post('/shift/buka', izin('shift'), shift.buka);
r.post('/shift/tutup', izin('shift'), shift.tutup);
r.get('/shift/kas', izin('shift'), shift.kas);
r.post('/shift/kas', izin('shift'), shift.simpanKas);
r.get('/shift/riwayat', izin('shift'), shift.riwayat);
r.get('/shift/:id', izin('shift'), shift.detail);

// Produk
r.get('/produk', izin('produk'), produk.index);
r.get('/produk/baru', izin('produk'), produk.form);
r.get('/produk/ekspor', izin('produk'), produk.ekspor);
r.get('/produk/impor', izin('produk'), produk.formImpor);
r.post('/produk/impor', izin('produk'), produk.impor);
r.get('/produk/label', izin('produk'), produk.label);
r.get('/produk/cari', izin('produk.lihat'), produk.cariJson);
r.post('/produk', izin('produk'), produk.simpan);
r.get('/produk/:id', izin('produk'), produk.form);
r.post('/produk/:id', izin('produk'), produk.simpan);
r.post('/produk/:id/hapus', izin('produk'), produk.hapus);

// Master sederhana (kategori, merek, satuan, kategori biaya)
r.get('/master/:jenis', master.cekIzin, master.index);
r.post('/master/:jenis', master.cekIzin, master.simpan);
r.post('/master/:jenis/:id/hapus', master.cekIzin, master.hapus);

// Persediaan
r.get('/persediaan', izin('persediaan'), persediaan.stok);
r.get('/persediaan/kartu', izin('persediaan'), persediaan.kartu);
r.get('/persediaan/penyesuaian', izin('persediaan'), persediaan.penyesuaian);
r.post('/persediaan/penyesuaian', izin('persediaan'), persediaan.simpanPenyesuaian);
r.get('/persediaan/opname', izin('persediaan'), persediaan.opname);
r.post('/persediaan/opname', izin('persediaan'), persediaan.buatOpname);
r.get('/persediaan/opname/:id', izin('persediaan'), persediaan.detailOpname);
r.post('/persediaan/opname/:id', izin('persediaan'), persediaan.simpanOpname);
r.post('/persediaan/opname/:id/setujui', izin('persediaan.setujui'), persediaan.setujuiOpname);
r.get('/persediaan/mutasi', izin('persediaan'), persediaan.mutasi);
r.post('/persediaan/mutasi', izin('persediaan'), persediaan.simpanMutasi);
r.get('/persediaan/mutasi/:id', izin('persediaan'), persediaan.detailMutasi);
r.get('/persediaan/minimum', izin('persediaan'), persediaan.minimum);

// Pembelian
r.get('/pembelian/pemasok', izin('pembelian'), pembelian.pemasok);
r.post('/pembelian/pemasok', izin('pembelian'), pembelian.simpanPemasok);
r.post('/pembelian/pemasok/:id/hapus', izin('pembelian'), pembelian.hapusPemasok);
r.get('/pembelian/po', izin('pembelian'), pembelian.po);
r.get('/pembelian/po/baru', izin('pembelian'), pembelian.formPo);
r.post('/pembelian/po', izin('pembelian'), pembelian.simpanPo);
r.get('/pembelian/po/:id', izin('pembelian'), pembelian.detailPo);
r.post('/pembelian/po/:id/batal', izin('pembelian'), pembelian.batalPo);
r.get('/pembelian/penerimaan', izin('pembelian'), pembelian.penerimaan);
r.get('/pembelian/penerimaan/baru', izin('pembelian'), pembelian.formPenerimaan);
r.post('/pembelian/penerimaan', izin('pembelian'), pembelian.simpanPenerimaan);
r.get('/pembelian/penerimaan/:id', izin('pembelian'), pembelian.detailPenerimaan);
r.get('/pembelian/retur', izin('pembelian'), pembelian.retur);
r.get('/pembelian/retur/baru', izin('pembelian'), pembelian.formRetur);
r.post('/pembelian/retur', izin('pembelian'), pembelian.simpanRetur);
r.get('/pembelian/hutang', izin('pembelian'), pembelian.hutang);
r.post('/pembelian/hutang/bayar', izin('pembelian'), pembelian.bayarHutang);

// Pelanggan
r.get('/pelanggan', izin('pelanggan'), pelanggan.index);
r.get('/pelanggan/member', izin('pelanggan'), pelanggan.member);
r.get('/pelanggan/piutang', izin('pelanggan.piutang'), pelanggan.piutang);
r.post('/pelanggan', izin('pelanggan'), pelanggan.simpan);
r.get('/pelanggan/:id', izin('pelanggan'), pelanggan.detail);
r.post('/pelanggan/:id', izin('pelanggan'), pelanggan.simpan);
r.post('/pelanggan/:id/hapus', izin('pelanggan.piutang'), pelanggan.hapus);
r.post('/pelanggan/:id/bayar', izin('pelanggan.piutang'), pelanggan.bayar);
r.post('/pelanggan/:id/poin', izin('pelanggan.piutang'), pelanggan.poin);

// Promo
r.get('/promo/diskon', izin('promo'), promo.diskon);
r.post('/promo/diskon', izin('promo'), promo.simpanDiskon);
r.get('/promo/voucher', izin('promo'), promo.voucher);
r.post('/promo/voucher', izin('promo'), promo.simpanVoucher);
r.get('/promo/grosir', izin('promo'), promo.grosir);
r.post('/promo/grosir', izin('promo'), promo.simpanGrosir);
r.post('/promo/:jenis/:id/hapus', izin('promo'), promo.hapus);

// Pengeluaran
r.get('/pengeluaran', izin('pengeluaran'), pengeluaran.index);
r.post('/pengeluaran', izin('pengeluaran'), pengeluaran.simpan);
r.post('/pengeluaran/:id/hapus', izin('pengeluaran'), pengeluaran.hapus);

// Laporan
r.get('/laporan/:jenis', izin('laporan'), laporan.tampil);

// Pengaturan
r.use('/pengaturan', izin('pengaturan'));
r.get('/pengaturan/toko', pengaturan.toko);
r.post('/pengaturan/toko', pengaturan.simpanToko);
r.get('/pengaturan/outlet', pengaturan.outlet);
r.post('/pengaturan/outlet', pengaturan.simpanOutlet);
r.post('/pengaturan/outlet/:id/hapus', pengaturan.hapusOutlet);
r.get('/pengaturan/pengguna', pengaturan.pengguna);
r.post('/pengaturan/pengguna', pengaturan.simpanPengguna);
r.post('/pengaturan/pengguna/:id/hapus', pengaturan.hapusPengguna);
r.get('/pengaturan/pembayaran', pengaturan.pembayaran);
r.post('/pengaturan/pembayaran', pengaturan.simpanPembayaran);
r.get('/pengaturan/pajak', pengaturan.pajak);
r.post('/pengaturan/pajak', pengaturan.simpanPajak);
r.get('/pengaturan/struk', pengaturan.struk);
r.post('/pengaturan/struk', pengaturan.simpanStruk);
r.get('/pengaturan/nomor', pengaturan.nomor);
r.post('/pengaturan/nomor', pengaturan.simpanNomor);
r.get('/pengaturan/cadangan', pengaturan.cadangan);
r.post('/pengaturan/cadangan', pengaturan.simpanCadangan);
r.post('/pengaturan/cadangan/jalankan', pengaturan.jalankanCadangan);
r.get('/pengaturan/cadangan/unduh/:nama', pengaturan.unduhCadangan);
r.get('/pengaturan/audit', pengaturan.audit);

module.exports = r;
