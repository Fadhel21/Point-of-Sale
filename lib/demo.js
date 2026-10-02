// Akun demo. Hanya ditampilkan di halaman masuk bila DEMO_LOGIN=true di .env.
const AKUN_DEMO = [
  { username: 'demo.pemilik', password: 'demo1234', role: 'pemilik', nama: 'Demo Pemilik', ket: 'Semua akses' },
  { username: 'demo.manajer', password: 'demo1234', role: 'manajer', nama: 'Demo Manajer', ket: 'Kelola & setujui' },
  { username: 'demo.kasir', password: 'demo1234', role: 'kasir', nama: 'Demo Kasir', ket: 'Kasir & shift' },
  { username: 'demo.gudang', password: 'demo1234', role: 'gudang', nama: 'Demo Gudang', ket: 'Produk & stok' },
];

module.exports = { AKUN_DEMO };
