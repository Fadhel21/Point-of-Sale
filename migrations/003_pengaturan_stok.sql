-- Pengaturan stok: apakah penjualan boleh membuat stok minus
INSERT INTO settings (key, value) VALUES ('stok', '{"bolehMinus":false}')
ON CONFLICT (key) DO NOTHING;

-- Indeks pendukung laporan & pencarian
CREATE INDEX IF NOT EXISTS sale_returns_created_idx ON sale_returns (outlet_id, created_at);
CREATE INDEX IF NOT EXISTS expenses_date_idx ON expenses (outlet_id, expense_date);
CREATE INDEX IF NOT EXISTS customers_name_idx ON customers (lower(name));
