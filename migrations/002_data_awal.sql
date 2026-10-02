-- Data awal: outlet utama, metode pembayaran, pengaturan bawaan

INSERT INTO outlets (code, name, address) VALUES ('UTM', 'Outlet Utama', '-');

INSERT INTO payment_methods (code, name, kind, sort_order) VALUES
  ('TUNAI', 'Tunai', 'tunai', 1),
  ('TRANSFER', 'Transfer Bank', 'transfer', 2),
  ('QRIS', 'QRIS', 'qris', 3),
  ('DEBIT', 'Kartu Debit', 'kartu', 4),
  ('KREDIT', 'Kartu Kredit', 'kartu', 5),
  ('EWALLET', 'E-Wallet', 'ewallet', 6),
  ('PIUTANG', 'Piutang', 'piutang', 7);

INSERT INTO settings (key, value) VALUES
  ('toko', '{"nama":"Toko Saya","alamat":"","telepon":"","email":"","npwp":"","logo":""}'),
  ('pajak', '{"aktif":true,"tarif":"11","termasuk":false}'),
  ('pembulatan', '{"aktif":false,"kelipatan":"100","mode":"terdekat"}'),
  ('struk', '{"lebar":"58","header":"Terima kasih telah berbelanja","footer":"Barang yang sudah dibeli tidak dapat dikembalikan tanpa struk","tampilLogo":false}'),
  ('poin', '{"aktif":true,"belanjaPerPoin":"10000","nilaiPoin":"100"}'),
  ('nomor', '{"PJ":"{OUTLET}-{YYMMDD}-{NNNN}","RJ":"RJ-{OUTLET}-{YYMMDD}-{NNN}","PO":"PO-{YYMM}-{NNNN}","GR":"GR-{YYMM}-{NNNN}","RB":"RB-{YYMM}-{NNN}","ADJ":"ADJ-{YYMM}-{NNN}","OP":"OP-{YYMM}-{NNN}","MT":"MT-{YYMM}-{NNN}","BY":"BY-{YYMM}-{NNN}"}'),
  ('cadangan', '{"aktif":true,"jam":"23:30","simpanHari":"14"}');

INSERT INTO units (name) VALUES ('pcs'), ('lusin'), ('dus'), ('kg'), ('liter'), ('pak');
INSERT INTO expense_categories (name) VALUES ('Listrik & Air'), ('Gaji'), ('Sewa'), ('Transportasi'), ('Lain-lain');
