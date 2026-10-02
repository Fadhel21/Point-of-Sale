-- Skema awal aplikasi POS
-- Konvensi: uang NUMERIC(15,2), kuantitas NUMERIC(15,4), waktu TIMESTAMPTZ,
-- setiap tabel punya id, created_at, updated_at, deleted_at.

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ===================== Pengaturan & pengguna =====================
CREATE TABLE outlets (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(10) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  address TEXT,
  phone VARCHAR(40),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  username VARCHAR(60) NOT NULL,
  email VARCHAR(160),
  password_hash VARCHAR(100) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('pemilik','manajer','kasir','gudang')),
  outlet_id BIGINT REFERENCES outlets(id),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX users_username_uq ON users (lower(username)) WHERE deleted_at IS NULL;

CREATE TABLE settings (
  id BIGSERIAL PRIMARY KEY,
  key VARCHAR(60) NOT NULL UNIQUE,
  value JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- Penomoran dokumen: satu baris per outlet, jenis dokumen, dan tanggal (dikunci FOR UPDATE)
CREATE TABLE doc_counters (
  id BIGSERIAL PRIMARY KEY,
  outlet_id BIGINT NOT NULL REFERENCES outlets(id),
  doc_type VARCHAR(10) NOT NULL,
  doc_date DATE NOT NULL,
  last_no INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (outlet_id, doc_type, doc_date)
);

CREATE TABLE payment_methods (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(60) NOT NULL,
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('tunai','transfer','qris','kartu','ewallet','piutang','poin')),
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id),
  action VARCHAR(60) NOT NULL,
  entity VARCHAR(60),
  entity_id BIGINT,
  data JSONB,
  ip VARCHAR(60),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);

-- ===================== Produk =====================
CREATE TABLE categories (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE TABLE brands (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE TABLE units (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(40) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE products (
  id BIGSERIAL PRIMARY KEY,
  parent_id BIGINT REFERENCES products(id),      -- varian menunjuk ke produk induk
  variant_name VARCHAR(120),                     -- mis. "Merah / XL"
  sku VARCHAR(60) NOT NULL,
  barcode VARCHAR(60),
  name VARCHAR(200) NOT NULL,
  category_id BIGINT REFERENCES categories(id),
  brand_id BIGINT REFERENCES brands(id),
  unit_id BIGINT REFERENCES units(id),           -- satuan dasar
  cost_price NUMERIC(15,2) NOT NULL DEFAULT 0,   -- harga pokok (rata-rata tertimbang)
  sell_price NUMERIC(15,2) NOT NULL DEFAULT 0,
  min_stock NUMERIC(15,4) NOT NULL DEFAULT 0,
  photo VARCHAR(200),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CHECK (cost_price >= 0 AND sell_price >= 0)
);
CREATE UNIQUE INDEX products_sku_uq ON products (lower(sku)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX products_barcode_uq ON products (barcode) WHERE deleted_at IS NULL AND barcode IS NOT NULL AND barcode <> '';
CREATE INDEX products_name_idx ON products (lower(name));

-- Satuan bertingkat: 1 dus = factor x satuan dasar
CREATE TABLE product_units (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id),
  unit_id BIGINT NOT NULL REFERENCES units(id),
  factor NUMERIC(15,4) NOT NULL CHECK (factor > 0),
  barcode VARCHAR(60),
  sell_price NUMERIC(15,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX product_units_barcode_uq ON product_units (barcode) WHERE deleted_at IS NULL AND barcode IS NOT NULL AND barcode <> '';

-- ===================== Persediaan =====================
CREATE TABLE stocks (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id),
  outlet_id BIGINT NOT NULL REFERENCES outlets(id),
  qty NUMERIC(15,4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (product_id, outlet_id)
);

-- Kartu stok: setiap perubahan stok tercatat di sini
CREATE TABLE stock_moves (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id),
  outlet_id BIGINT NOT NULL REFERENCES outlets(id),
  qty_change NUMERIC(15,4) NOT NULL,
  qty_after NUMERIC(15,4) NOT NULL,
  unit_cost NUMERIC(15,2) NOT NULL DEFAULT 0,
  ref_type VARCHAR(30) NOT NULL,   -- penjualan, retur_jual, penerimaan, retur_beli, penyesuaian, opname, mutasi_keluar, mutasi_masuk, void
  ref_id BIGINT,
  ref_no VARCHAR(40),
  note TEXT,
  user_id BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX stock_moves_product_idx ON stock_moves (product_id, outlet_id, created_at);

CREATE TABLE stock_adjustments (
  id BIGSERIAL PRIMARY KEY,
  number VARCHAR(40) NOT NULL UNIQUE,
  outlet_id BIGINT NOT NULL REFERENCES outlets(id),
  product_id BIGINT NOT NULL REFERENCES products(id),
  qty_change NUMERIC(15,4) NOT NULL,
  reason VARCHAR(200) NOT NULL,
  user_id BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE stock_opnames (
  id BIGSERIAL PRIMARY KEY,
  number VARCHAR(40) NOT NULL UNIQUE,
  outlet_id BIGINT NOT NULL REFERENCES outlets(id),
  status VARCHAR(20) NOT NULL DEFAULT 'draf' CHECK (status IN ('draf','diajukan','disetujui','ditolak')),
  note TEXT,
  user_id BIGINT REFERENCES users(id),
  approved_by BIGINT REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE TABLE stock_opname_items (
  id BIGSERIAL PRIMARY KEY,
  opname_id BIGINT NOT NULL REFERENCES stock_opnames(id),
  product_id BIGINT NOT NULL REFERENCES products(id),
  system_qty NUMERIC(15,4) NOT NULL,
  counted_qty NUMERIC(15,4) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (opname_id, product_id)
);

CREATE TABLE stock_transfers (
  id BIGSERIAL PRIMARY KEY,
  number VARCHAR(40) NOT NULL UNIQUE,
  from_outlet_id BIGINT NOT NULL REFERENCES outlets(id),
  to_outlet_id BIGINT NOT NULL REFERENCES outlets(id),
  note TEXT,
  user_id BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CHECK (from_outlet_id <> to_outlet_id)
);
CREATE TABLE stock_transfer_items (
  id BIGSERIAL PRIMARY KEY,
  transfer_id BIGINT NOT NULL REFERENCES stock_transfers(id),
  product_id BIGINT NOT NULL REFERENCES products(id),
  qty NUMERIC(15,4) NOT NULL CHECK (qty > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- ===================== Pelanggan =====================
CREATE TABLE customers (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(30) NOT NULL,
  name VARCHAR(160) NOT NULL,
  phone VARCHAR(40),
  email VARCHAR(160),
  address TEXT,
  is_member BOOLEAN NOT NULL DEFAULT false,
  points NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (points >= 0),
  receivable NUMERIC(15,2) NOT NULL DEFAULT 0,     -- saldo piutang berjalan
  credit_limit NUMERIC(15,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX customers_code_uq ON customers (lower(code)) WHERE deleted_at IS NULL;

CREATE TABLE point_ledger (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(id),
  points NUMERIC(15,2) NOT NULL,
  ref_type VARCHAR(30) NOT NULL,
  ref_id BIGINT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- ===================== Promo =====================
CREATE TABLE discounts (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  product_id BIGINT REFERENCES products(id),
  category_id BIGINT REFERENCES categories(id),
  disc_type VARCHAR(10) NOT NULL CHECK (disc_type IN ('persen','nominal')),
  value NUMERIC(15,2) NOT NULL CHECK (value >= 0),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CHECK (product_id IS NOT NULL OR category_id IS NOT NULL)
);

CREATE TABLE vouchers (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(40) NOT NULL,
  disc_type VARCHAR(10) NOT NULL CHECK (disc_type IN ('persen','nominal')),
  value NUMERIC(15,2) NOT NULL CHECK (value >= 0),
  max_discount NUMERIC(15,2) NOT NULL DEFAULT 0,  -- 0 = tanpa batas
  min_purchase NUMERIC(15,2) NOT NULL DEFAULT 0,
  quota INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CHECK (used <= quota)
);
CREATE UNIQUE INDEX vouchers_code_uq ON vouchers (upper(code)) WHERE deleted_at IS NULL;

CREATE TABLE wholesale_prices (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id),
  min_qty NUMERIC(15,4) NOT NULL CHECK (min_qty > 0),
  price NUMERIC(15,2) NOT NULL CHECK (price >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- ===================== Shift & kas =====================
CREATE TABLE shifts (
  id BIGSERIAL PRIMARY KEY,
  outlet_id BIGINT NOT NULL REFERENCES outlets(id),
  user_id BIGINT NOT NULL REFERENCES users(id),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  opening_cash NUMERIC(15,2) NOT NULL CHECK (opening_cash >= 0),
  closed_at TIMESTAMPTZ,
  expected_cash NUMERIC(15,2),
  counted_cash NUMERIC(15,2),
  difference NUMERIC(15,2),
  status VARCHAR(10) NOT NULL DEFAULT 'buka' CHECK (status IN ('buka','tutup')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
-- Satu kasir hanya boleh punya satu shift terbuka
CREATE UNIQUE INDEX shifts_open_uq ON shifts (user_id) WHERE status = 'buka' AND deleted_at IS NULL;

CREATE TABLE cash_movements (
  id BIGSERIAL PRIMARY KEY,
  shift_id BIGINT NOT NULL REFERENCES shifts(id),
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('masuk','keluar')),
  amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  note VARCHAR(200) NOT NULL,
  user_id BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- ===================== Penjualan =====================
CREATE TABLE sales (
  id BIGSERIAL PRIMARY KEY,
  number VARCHAR(40) NOT NULL UNIQUE,
  idempotency_key UUID NOT NULL UNIQUE,      -- mencegah transaksi ganda
  outlet_id BIGINT NOT NULL REFERENCES outlets(id),
  shift_id BIGINT NOT NULL REFERENCES shifts(id),
  user_id BIGINT NOT NULL REFERENCES users(id),
  customer_id BIGINT REFERENCES customers(id),
  status VARCHAR(10) NOT NULL DEFAULT 'selesai' CHECK (status IN ('selesai','void')),
  subtotal NUMERIC(15,2) NOT NULL,          -- setelah diskon item, sebelum diskon transaksi
  item_discount NUMERIC(15,2) NOT NULL DEFAULT 0,
  trx_discount NUMERIC(15,2) NOT NULL DEFAULT 0,
  voucher_id BIGINT REFERENCES vouchers(id),
  voucher_discount NUMERIC(15,2) NOT NULL DEFAULT 0,
  points_used NUMERIC(15,2) NOT NULL DEFAULT 0,
  points_value NUMERIC(15,2) NOT NULL DEFAULT 0,
  dpp NUMERIC(15,2) NOT NULL DEFAULT 0,      -- dasar pengenaan pajak
  tax NUMERIC(15,2) NOT NULL DEFAULT 0,
  rounding NUMERIC(15,2) NOT NULL DEFAULT 0,
  total NUMERIC(15,2) NOT NULL,
  paid NUMERIC(15,2) NOT NULL,
  change_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  cost_total NUMERIC(15,2) NOT NULL DEFAULT 0,
  points_earned NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_inclusive BOOLEAN NOT NULL DEFAULT false,
  tax_rate NUMERIC(7,4) NOT NULL DEFAULT 0,
  note TEXT,
  void_reason TEXT,
  void_by BIGINT REFERENCES users(id),
  void_approved_by BIGINT REFERENCES users(id),
  void_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CHECK (total >= 0 AND paid >= 0 AND change_amount >= 0)
);
CREATE INDEX sales_created_idx ON sales (outlet_id, created_at);
CREATE INDEX sales_shift_idx ON sales (shift_id);

CREATE TABLE sale_items (
  id BIGSERIAL PRIMARY KEY,
  sale_id BIGINT NOT NULL REFERENCES sales(id),
  product_id BIGINT NOT NULL REFERENCES products(id),
  product_name VARCHAR(250) NOT NULL,       -- salinan saat transaksi
  sku VARCHAR(60) NOT NULL,
  unit_name VARCHAR(40),
  unit_factor NUMERIC(15,4) NOT NULL DEFAULT 1,
  qty NUMERIC(15,4) NOT NULL CHECK (qty > 0),       -- dalam satuan jual
  base_qty NUMERIC(15,4) NOT NULL,                  -- dalam satuan dasar (untuk stok)
  price NUMERIC(15,2) NOT NULL,                     -- harga jual per satuan jual
  cost NUMERIC(15,2) NOT NULL,                      -- harga pokok per satuan dasar
  discount NUMERIC(15,2) NOT NULL DEFAULT 0,        -- diskon item total (rupiah)
  trx_discount_share NUMERIC(15,2) NOT NULL DEFAULT 0, -- alokasi diskon transaksi/voucher/poin
  tax NUMERIC(15,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(15,2) NOT NULL,                -- qty*price - discount
  returned_qty NUMERIC(15,4) NOT NULL DEFAULT 0,
  note VARCHAR(200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CHECK (returned_qty >= 0 AND returned_qty <= qty)
);
CREATE INDEX sale_items_sale_idx ON sale_items (sale_id);

CREATE TABLE sale_payments (
  id BIGSERIAL PRIMARY KEY,
  sale_id BIGINT NOT NULL REFERENCES sales(id),
  method_code VARCHAR(20) NOT NULL,
  method_kind VARCHAR(20) NOT NULL,
  amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  reference VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX sale_payments_sale_idx ON sale_payments (sale_id);

CREATE TABLE held_sales (
  id BIGSERIAL PRIMARY KEY,
  outlet_id BIGINT NOT NULL REFERENCES outlets(id),
  user_id BIGINT NOT NULL REFERENCES users(id),
  label VARCHAR(120),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE sale_returns (
  id BIGSERIAL PRIMARY KEY,
  number VARCHAR(40) NOT NULL UNIQUE,
  sale_id BIGINT NOT NULL REFERENCES sales(id),
  outlet_id BIGINT NOT NULL REFERENCES outlets(id),
  shift_id BIGINT REFERENCES shifts(id),
  user_id BIGINT NOT NULL REFERENCES users(id),
  approved_by BIGINT REFERENCES users(id),
  reason TEXT NOT NULL,
  refund_method VARCHAR(20) NOT NULL,
  total NUMERIC(15,2) NOT NULL CHECK (total >= 0),
  tax NUMERIC(15,2) NOT NULL DEFAULT 0,
  cost_total NUMERIC(15,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE TABLE sale_return_items (
  id BIGSERIAL PRIMARY KEY,
  return_id BIGINT NOT NULL REFERENCES sale_returns(id),
  sale_item_id BIGINT NOT NULL REFERENCES sale_items(id),
  product_id BIGINT NOT NULL REFERENCES products(id),
  qty NUMERIC(15,4) NOT NULL CHECK (qty > 0),
  amount NUMERIC(15,2) NOT NULL,
  tax NUMERIC(15,2) NOT NULL DEFAULT 0,
  cost NUMERIC(15,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- Piutang pelanggan (mutasi): penjualan piutang (+), pelunasan/retur (-)
CREATE TABLE receivable_ledger (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(id),
  amount NUMERIC(15,2) NOT NULL,
  ref_type VARCHAR(30) NOT NULL,
  ref_id BIGINT,
  method_code VARCHAR(20),
  note TEXT,
  user_id BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- ===================== Pembelian =====================
CREATE TABLE suppliers (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  contact VARCHAR(120),
  phone VARCHAR(40),
  email VARCHAR(160),
  address TEXT,
  payable NUMERIC(15,2) NOT NULL DEFAULT 0,   -- saldo hutang berjalan
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE purchase_orders (
  id BIGSERIAL PRIMARY KEY,
  number VARCHAR(40) NOT NULL UNIQUE,
  supplier_id BIGINT NOT NULL REFERENCES suppliers(id),
  outlet_id BIGINT NOT NULL REFERENCES outlets(id),
  status VARCHAR(20) NOT NULL DEFAULT 'dipesan' CHECK (status IN ('dipesan','sebagian','selesai','batal')),
  total NUMERIC(15,2) NOT NULL DEFAULT 0,
  note TEXT,
  user_id BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE TABLE purchase_order_items (
  id BIGSERIAL PRIMARY KEY,
  po_id BIGINT NOT NULL REFERENCES purchase_orders(id),
  product_id BIGINT NOT NULL REFERENCES products(id),
  qty NUMERIC(15,4) NOT NULL CHECK (qty > 0),
  price NUMERIC(15,2) NOT NULL CHECK (price >= 0),
  received_qty NUMERIC(15,4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CHECK (received_qty >= 0)
);

CREATE TABLE goods_receipts (
  id BIGSERIAL PRIMARY KEY,
  number VARCHAR(40) NOT NULL UNIQUE,
  po_id BIGINT REFERENCES purchase_orders(id),
  supplier_id BIGINT NOT NULL REFERENCES suppliers(id),
  outlet_id BIGINT NOT NULL REFERENCES outlets(id),
  invoice_no VARCHAR(60),
  due_date DATE,
  total NUMERIC(15,2) NOT NULL DEFAULT 0,
  paid NUMERIC(15,2) NOT NULL DEFAULT 0,
  note TEXT,
  user_id BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CHECK (paid >= 0)
);
CREATE TABLE goods_receipt_items (
  id BIGSERIAL PRIMARY KEY,
  receipt_id BIGINT NOT NULL REFERENCES goods_receipts(id),
  po_item_id BIGINT REFERENCES purchase_order_items(id),
  product_id BIGINT NOT NULL REFERENCES products(id),
  qty NUMERIC(15,4) NOT NULL CHECK (qty > 0),
  price NUMERIC(15,2) NOT NULL CHECK (price >= 0),
  returned_qty NUMERIC(15,4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CHECK (returned_qty >= 0 AND returned_qty <= qty)
);

CREATE TABLE purchase_returns (
  id BIGSERIAL PRIMARY KEY,
  number VARCHAR(40) NOT NULL UNIQUE,
  receipt_id BIGINT NOT NULL REFERENCES goods_receipts(id),
  supplier_id BIGINT NOT NULL REFERENCES suppliers(id),
  outlet_id BIGINT NOT NULL REFERENCES outlets(id),
  reason TEXT NOT NULL,
  total NUMERIC(15,2) NOT NULL DEFAULT 0,
  user_id BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE TABLE purchase_return_items (
  id BIGSERIAL PRIMARY KEY,
  return_id BIGINT NOT NULL REFERENCES purchase_returns(id),
  receipt_item_id BIGINT NOT NULL REFERENCES goods_receipt_items(id),
  product_id BIGINT NOT NULL REFERENCES products(id),
  qty NUMERIC(15,4) NOT NULL CHECK (qty > 0),
  price NUMERIC(15,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- Hutang pemasok (mutasi): penerimaan (+), pembayaran/retur (-)
CREATE TABLE payable_ledger (
  id BIGSERIAL PRIMARY KEY,
  supplier_id BIGINT NOT NULL REFERENCES suppliers(id),
  receipt_id BIGINT REFERENCES goods_receipts(id),
  amount NUMERIC(15,2) NOT NULL,
  ref_type VARCHAR(30) NOT NULL,
  ref_id BIGINT,
  method_code VARCHAR(20),
  note TEXT,
  user_id BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- ===================== Pengeluaran =====================
CREATE TABLE expense_categories (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE TABLE expenses (
  id BIGSERIAL PRIMARY KEY,
  number VARCHAR(40) NOT NULL UNIQUE,
  outlet_id BIGINT NOT NULL REFERENCES outlets(id),
  category_id BIGINT NOT NULL REFERENCES expense_categories(id),
  expense_date DATE NOT NULL,
  amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  description VARCHAR(250) NOT NULL,
  user_id BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- Trigger updated_at untuk semua tabel
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT table_name FROM information_schema.columns
           WHERE table_schema = 'public' AND column_name = 'updated_at'
  LOOP
    EXECUTE format('CREATE TRIGGER trg_%I_updated BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END $$;
