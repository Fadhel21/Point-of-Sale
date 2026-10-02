# POS — Aplikasi Kasir Retail

Aplikasi Point of Sale ringan: Node.js + Express + EJS + HTMX/Alpine.js + PostgreSQL.
Tanpa tahap build, tanpa ORM, tanpa library native.

## Persiapan (PowerShell)

1. Buat database (sesuaikan path PostgreSQL bila versinya berbeda):

   ```powershell
   & "C:\Program Files\PostgreSQL\18\bin\createdb.exe" -U postgres pos
   ```

2. Salin `.env.example` ke `.env` (bila belum ada), lalu isi `DATABASE_URL`:

   ```powershell
   Copy-Item .env.example .env
   notepad .env
   ```

   `JWT_SECRET` dan `COOKIE_SECRET` wajib diisi string acak panjang. Isi `SMTP_*` bila ingin mengirim
   struk dan peringatan stok lewat email.

3. Pasang dependency, jalankan migrasi, lalu buat akun pemilik:

   ```powershell
   npm install
   npm run migrate
   npm run buat-pemilik -- admin PasswordKuat123 "Nama Pemilik"
   ```

4. Jalankan aplikasi (dua jendela terminal):

   ```powershell
   npm start          # web, http://localhost:3000
   npm run worker     # job terjadwal: cadangan harian, peringatan stok minimum
   ```

## Pengujian

```powershell
npm test
```

Uji integrasi (`tests/transaksi.test.js`) membuat database terpisah `<nama_db>_test` lalu menghapusnya
dan membuatnya ulang setiap kali dijalankan. Database `pos` tidak disentuh.

## Struktur

| Folder | Isi |
|---|---|
| `config/` | konfigurasi & koneksi DB, helper transaksi `withTransaction` |
| `migrations/` | file SQL bernomor; **jangan edit migrasi yang sudah dijalankan**, buat file baru |
| `services/` | seluruh SQL & aturan bisnis |
| `controllers/` | baca request → panggil service → render (tanpa SQL) |
| `routes/` | peta URL & izin per peran |
| `views/` | template EJS |
| `public/` | CSS & JS statis (HTMX, Alpine.js, Chart.js, kasir.js) |
| `worker/` | proses node-cron terpisah |
| `lib/` | uang (BigInt), CSV, PDF, barcode, hak akses |

## Aturan uang & data

- Uang `NUMERIC(15,2)`, kuantitas `NUMERIC(15,4)`. Di JavaScript, uang dihitung sebagai BigInt sen
  (`lib/money.js`), tidak pernah float.
- Input angka memakai titik sebagai desimal, **tanpa** pemisah ribuan (`12500.50`, bukan `12.500,50`).
- Total penjualan selalu dihitung ulang di server (`services/pricing.js`). Browser hanya mengirim
  produk, satuan, qty, dan diskon manual.
- Penjualan, item, pembayaran, stok, voucher, poin, dan piutang disimpan dalam satu transaksi DB.
- Form bayar membawa kunci UUID; klik ganda atau kirim ulang hanya menghasilkan satu transaksi.
- Nomor struk berurutan per outlet per hari, dibuat di dalam transaksi penjualan, jadi transaksi
  yang gagal tidak meninggalkan nomor bolong.
- Void hanya selama shift transaksi masih buka dan butuh persetujuan supervisor. Setelah shift
  ditutup, gunakan retur.

## Pintasan kasir

| Tombol | Aksi |
|---|---|
| F2 | fokus ke pencarian / scan |
| F3 | cari pelanggan |
| F4 | diskon transaksi & voucher |
| F8 | tahan transaksi |
| F9 | bayar |
| Enter (di dialog bayar) | simpan |
| Ctrl+Del | batalkan transaksi |
| + / − | ubah qty baris aktif |
| Del | hapus baris aktif |
| ↑ / ↓ | pilih baris |
| P / Enter (setelah bayar) | cetak struk / transaksi baru |

## Cadangan & pemulihan

Cadangan dibuat dengan `pg_dump` (format custom) ke folder `backups/`, otomatis oleh worker atau
manual dari Pengaturan → Cadangan Data. Atur `PG_DUMP_PATH` di `.env`.

Pemulihan ke database baru:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\createdb.exe" -U postgres pos_pulih
& "C:\Program Files\PostgreSQL\18\bin\pg_restore.exe" -U postgres -d pos_pulih --no-owner backups\pos-20260101-233000.dump
```

## Peran

| Peran | Akses |
|---|---|
| Pemilik | semua |
| Manajer/Supervisor | semua kecuali pengaturan sistem; menyetujui void, retur, opname |
| Kasir | kasir, shift sendiri, riwayat sendiri, pelanggan; tanpa harga beli & laba |
| Gudang | produk, persediaan, pembelian |
