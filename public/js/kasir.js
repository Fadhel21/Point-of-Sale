// Komponen layar kasir (Alpine.js).
// Browser hanya menyimpan pilihan (produk, satuan, qty, diskon manual). Semua angka uang
// dihitung server lewat /kasir/hitung, dan dihitung ulang lagi saat /kasir/bayar.
document.addEventListener('alpine:init', function () {
  'use strict';

  // ---- Uang di browser: BigInt sen (hanya untuk tampilan kembalian, bukan sumber kebenaran) ----
  function toSen(v) {
    var s = String(v == null || v === '' ? '0' : v).trim().replace(/\s/g, '');
    if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');
    if (!/^-?\d+(\.\d+)?$/.test(s)) return 0n;
    var neg = s.charAt(0) === '-'; if (neg) s = s.slice(1);
    var p = s.split('.'); var f = ((p[1] || '') + '00').slice(0, 2);
    var r = BigInt(p[0]) * 100n + BigInt(f);
    return neg ? -r : r;
  }
  function fromSen(n) {
    var neg = n < 0n; var a = neg ? -n : n;
    return (neg ? '-' : '') + (a / 100n).toString() + '.' + (a % 100n).toString().padStart(2, '0');
  }

  async function api(url, body) {
    var res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    if (res.status === 401) { location.href = '/login?next=/kasir'; throw new Error('Sesi habis'); }
    var data;
    try { data = await res.json(); } catch (e) { throw new Error('Respons server tidak valid.'); }
    if (!data.ok) throw new Error(data.pesan || 'Terjadi kesalahan.');
    return data;
  }

  var kosong = { subtotal: '0.00', trx_discount: '0.00', voucher_discount: '0.00', points_value: '0.00', tax: '0.00', total: '0.00', total_tunai: '0.00', tax_rate: '0.00', lines: [] };
  var urut = 0;

  Alpine.data('kasir', function () {
    return {
      q: '', hasilCari: [], idxHasil: 0,
      qPelanggan: '', hasilPelanggan: [],
      items: [], aktif: -1,
      customer: null, points_use: '', voucher_code: '', trx_disc_type: 'persen', trx_disc_value: '',
      panelDiskon: false, hasil: Object.assign({}, kosong), galat: '',
      metode: [], payments: [], dialogBayar: false, sibuk: false, selesai: null,
      kunci: '', heldId: '', pecahan: ['20000', '50000', '100000'],
      grid: [], kategori: '', memuatGrid: false,
      _req: 0,

      init: function () {
        this.kunci = this.$el.dataset.kunci;
        this.metode = JSON.parse(this.$el.dataset.metode || '[]');
        if (this.$el.dataset.held) this.lanjutkan(this.$el.dataset.held);
        this.muatGrid();
        var self = this;
        window.addEventListener('keydown', function (e) { self.pintasan(e); });
        window.addEventListener('beforeunload', function (e) { if (self.items.length && !self.selesai) { e.preventDefault(); e.returnValue = ''; } });
      },

      rupiah: function (v) { return window.rupiah(v); },
      angka: function (v) {
        var s = String(v == null ? '0' : v); var p = s.split('.');
        var i = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.'); var f = (p[1] || '').replace(/0+$/, '');
        return i + (f ? ',' + f : '');
      },
      nz: function (v) { return toSen(v) !== 0n; },
      // Perbandingan stok untuk tampilan saja (bukan perhitungan uang)
      num: function (v) { return Number(v || 0); },
      inisial: function (n) { return String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase(); },
      jumlahItem: function () { return this.items.reduce(function (a, it) { return a + toQtyN(it.qty); }, 0n) === 0n ? 0 : fromQty(this.items.reduce(function (a, it) { return a + toQtyN(it.qty); }, 0n)); },
      qtyDiKeranjang: function (id) {
        var t = this.items.filter(function (it) { return String(it.product_id) === String(id); }).reduce(function (a, it) { return a + toQtyN(it.qty); }, 0n);
        return t > 0n ? fromQty(t) : '';
      },
      muatGrid: async function () {
        this.memuatGrid = true;
        try { this.grid = (await api('/kasir/produk?kategori=' + encodeURIComponent(this.kategori))).rows; }
        catch (e) { this.galat = e.message; }
        finally { this.memuatGrid = false; }
      },
      pilihKategori: function (k) { this.kategori = k; this.muatGrid(); },
      fromSen: fromSen,
      jenis: function (code) { var m = this.metode.find(function (x) { return x.code === code; }); return m ? m.kind : ''; },

      // ---------- Pencarian ----------
      cari: async function () {
        var q = this.q.trim();
        if (q.length < 2) { this.hasilCari = []; return; }
        try {
          var d = await api('/kasir/cari?q=' + encodeURIComponent(q));
          if (this.q.trim() === q) { this.hasilCari = d.rows; this.idxHasil = 0; }
        } catch (e) { this.galat = e.message; }
      },
      enterCari: async function () {
        var q = this.q.trim();
        if (!q) return;
        // Scanner barcode mengetik cepat lalu Enter: selalu cari persis dulu
        if (this.hasilCari.length && this.idxHasil >= 0 && this.hasilCari[this.idxHasil] && !/^\d{6,}$/.test(q)) {
          return this.tambah(this.hasilCari[this.idxHasil]);
        }
        try {
          var d = await api('/kasir/cari?q=' + encodeURIComponent(q));
          if (d.rows.length === 1 || (d.rows[0] && d.rows[0].exact)) this.tambah(d.rows[0]);
          else if (!d.rows.length) { this.galat = 'Produk "' + q + '" tidak ditemukan.'; this.q = ''; }
          else { this.hasilCari = d.rows; this.idxHasil = 0; }
        } catch (e) { this.galat = e.message; }
      },
      pilihHasil: function (d) {
        if (!this.hasilCari.length) return;
        this.idxHasil = (this.idxHasil + d + this.hasilCari.length) % this.hasilCari.length;
      },

      // ---------- Keranjang ----------
      tambah: function (p) {
        this.galat = '';
        var unitId = p.unit_id ? String(p.unit_id) : '';
        var ada = this.items.findIndex(function (it) { return String(it.product_id) === String(p.id) && String(it.unit_id || '') === unitId && !it.note; });
        if (ada >= 0) {
          this.items[ada].qty = fromQty(toQtyN(this.items[ada].qty) + 10000n);
          this.aktif = ada;
        } else {
          this.items.push({
            key: ++urut, product_id: p.id, name: p.name + (p.variant_name ? ' - ' + p.variant_name : ''), sku: p.sku,
            unit_id: unitId, unit_name: p.unit_name, base_unit: p.unit_id ? '' : p.unit_name, units: p.units || [],
            qty: '1', disc_type: 'persen', disc_value: '', note: '', price: p.price, line_total: p.price, discount: '0.00', buka: false,
          });
          this.aktif = this.items.length - 1;
        }
        this.q = ''; this.hasilCari = [];
        this.hitungUlang();
        var self = this;
        this.$nextTick(function () { var el = document.querySelector('.ks-baris.aktif'); if (el) el.scrollIntoView({ block: 'nearest' }); });
        this.$refs.cari.focus();
      },
      hapus: function (i) {
        this.items.splice(i, 1);
        this.aktif = Math.min(this.aktif, this.items.length - 1);
        this.hitungUlang();
      },
      ubahQty: function (d) {
        if (this.aktif < 0 || !this.items[this.aktif]) return;
        var it = this.items[this.aktif];
        var q = toQtyN(it.qty) + BigInt(d) * 10000n;
        if (q <= 0n) return this.hapus(this.aktif);
        it.qty = fromQty(q);
        this.hitungUlang();
      },
      batal: function () {
        if (this.items.length && !confirm('Batalkan transaksi ini?')) return;
        this.reset();
      },
      reset: function () {
        this.items = []; this.aktif = -1; this.customer = null; this.qPelanggan = ''; this.points_use = '';
        this.voucher_code = ''; this.trx_disc_value = ''; this.hasil = Object.assign({}, kosong);
        this.galat = ''; this.heldId = ''; this.payments = []; this.panelDiskon = false;
        this.$refs.cari && this.$refs.cari.focus();
      },

      payload: function () {
        return {
          items: this.items.map(function (it) {
            return { product_id: it.product_id, unit_id: it.unit_id || null, qty: String(it.qty).replace(',', '.'),
              disc_type: it.disc_value ? it.disc_type : null, disc_value: it.disc_value || null, note: it.note || null, name: it.name };
          }),
          customer_id: this.customer ? this.customer.id : null,
          customer_name: this.customer ? this.customer.name : null,
          voucher_code: this.voucher_code || null,
          trx_disc_type: this.trx_disc_value ? this.trx_disc_type : null,
          trx_disc_value: this.trx_disc_value || null,
          points_use: this.points_use || null,
          held_id: this.heldId || null,
        };
      },

      hitungUlang: async function () {
        if (!this.items.length) { this.hasil = Object.assign({}, kosong); this.galat = ''; return; }
        var n = ++this._req;
        try {
          var d = await api('/kasir/hitung', this.payload());
          if (n !== this._req) return; // abaikan respons lama
          this.hasil = d.hasil;
          var self = this;
          d.hasil.lines.forEach(function (l, i) {
            var it = self.items[i]; if (!it) return;
            it.price = l.price; it.line_total = l.line_total; it.discount = l.discount; it.promo = l.promo; it.grosir = l.grosir;
            if (!it.unit_name) it.unit_name = l.unit_name;
          });
          if (d.hasil.customer) this.customer = Object.assign({}, this.customer, d.hasil.customer);
          this.galat = '';
        } catch (e) { if (n === this._req) this.galat = e.message; }
      },

      // ---------- Pelanggan ----------
      cariPelanggan: async function () {
        var q = this.qPelanggan.trim();
        if (q.length < 2) { this.hasilPelanggan = []; return; }
        try { this.hasilPelanggan = (await api('/kasir/pelanggan?q=' + encodeURIComponent(q))).rows; } catch (e) { this.galat = e.message; }
      },
      pilihPelanggan: function (c) {
        this.customer = c; this.hasilPelanggan = []; this.qPelanggan = '';
        this.hitungUlang();
        this.$refs.cari.focus();
      },

      // ---------- Tahan ----------
      tahan: async function () {
        if (!this.items.length) return;
        var label = prompt('Label transaksi ditahan (opsional):', this.customer ? this.customer.name : '');
        if (label === null) return;
        try {
          var p = this.payload(); p.label = label;
          await api('/kasir/tahan', p);
          this.reset();
        } catch (e) { this.galat = e.message; }
      },
      lanjutkan: async function (id) {
        try {
          var d = await api('/kasir/ditahan/' + encodeURIComponent(id));
          var p = d.payload;
          this.items = p.items.map(function (i) {
            return { key: ++urut, product_id: i.product_id, name: i.name, sku: '', unit_id: i.unit_id ? String(i.unit_id) : '',
              units: d.units.filter(function (u) { return String(u.product_id) === String(i.product_id); }),
              qty: i.qty, disc_type: i.disc_type || 'persen', disc_value: i.disc_value || '', note: i.note || '', price: '0', line_total: '0', discount: '0' };
          });
          this.customer = p.customer_id ? { id: p.customer_id, name: p.customer_name } : null;
          this.voucher_code = p.voucher_code || ''; this.trx_disc_type = p.trx_disc_type || 'persen'; this.trx_disc_value = p.trx_disc_value || '';
          this.heldId = d.id;
          history.replaceState(null, '', '/kasir');
          this.hitungUlang();
        } catch (e) { this.galat = e.message; }
      },

      // ---------- Bayar ----------
      totalBayar: function () {
        var adaTunai = this.payments.some(function (p) { return this.jenis(p.method_code) === 'tunai'; }, this);
        return adaTunai ? this.hasil.total_tunai : this.hasil.total;
      },
      dibayarSen: function () { return this.payments.reduce(function (a, p) { return a + toSen(p.amount); }, 0n); },
      sisaSen: function () { return toSen(this.totalBayar()) - this.dibayarSen(); },
      bukaBayar: async function () {
        if (!this.items.length || this.sibuk) return;
        await this.hitungUlang();
        if (this.galat) return;
        if (!this.payments.length) {
          var tunai = this.metode.find(function (m) { return m.kind === 'tunai'; }) || this.metode[0];
          this.payments = [{ method_code: tunai.code, amount: '', reference: '' }];
        }
        this.dialogBayar = true;
        var self = this;
        this.$nextTick(function () { var el = document.getElementById('bayar0'); if (el) { el.focus(); el.select(); } });
      },
      tambahMetode: function () {
        var sisa = this.sisaSen();
        var lain = this.metode.find(function (m) { return m.kind !== 'tunai'; }) || this.metode[0];
        this.payments.push({ method_code: lain.code, amount: sisa > 0n ? fromSen(sisa) : '', reference: '' });
      },
      uangPas: function () {
        var lainnya = this.payments.slice(1).reduce(function (a, p) { return a + toSen(p.amount); }, 0n);
        this.payments[0].amount = fromSen(toSen(this.totalBayar()) - lainnya);
      },
      setTunai: function (n) {
        var p = this.payments.find(function (x) { return this.jenis(x.method_code) === 'tunai'; }, this);
        if (p) p.amount = n;
      },
      simpan: async function () {
        if (this.sibuk || this.sisaSen() > 0n) return;
        this.sibuk = true; this.galat = '';
        try {
          var body = this.payload();
          body.idempotency_key = this.kunci; // kunci yang sama dipakai bila tombol tertekan dua kali / dicoba ulang
          body.payments = this.payments.filter(function (p) { return toSen(p.amount) > 0n; });
          var d = await api('/kasir/bayar', body);
          this.kunci = d.kunci_baru;
          this.selesai = d;
          this.dialogBayar = false;
          var self = this;
          this.$nextTick(function () { self.$refs.baru && self.$refs.baru.focus(); });
        } catch (e) {
          this.galat = e.message;
        } finally {
          this.sibuk = false;
        }
      },
      cetak: function () {
        if (this.selesai) window.open('/transaksi/' + this.selesai.id + '/struk?cetak=1', 'struk', 'width=420,height=640');
      },
      transaksiBaru: function () { this.selesai = null; this.reset(); this.muatGrid(); },

      // ---------- Pintasan keyboard ----------
      pintasan: function (e) {
        if (this.selesai) {
          if (e.key === 'Enter') { e.preventDefault(); this.transaksiBaru(); }
          else if (e.key === 'p' || e.key === 'P') { e.preventDefault(); this.cetak(); }
          return;
        }
        var tag = (e.target.tagName || '').toLowerCase();
        var diInput = tag === 'input' || tag === 'select' || tag === 'textarea';
        switch (e.key) {
          case 'F2': e.preventDefault(); this.$refs.cari.focus(); this.$refs.cari.select(); break;
          case 'F3': e.preventDefault(); if (this.$refs.pelanggan) this.$refs.pelanggan.focus(); break;
          case 'F4': e.preventDefault(); this.panelDiskon = true; var s = this; this.$nextTick(function () { s.$refs.diskon.focus(); }); break;
          case 'F8': e.preventDefault(); this.tahan(); break;
          case 'F9': e.preventDefault(); this.bukaBayar(); break;
          case 'Delete':
            if (e.ctrlKey) { e.preventDefault(); this.batal(); }
            else if (!diInput && this.aktif >= 0) { e.preventDefault(); this.hapus(this.aktif); }
            break;
          case '+': if (!diInput) { e.preventDefault(); this.ubahQty(1); } break;
          case '-': if (!diInput) { e.preventDefault(); this.ubahQty(-1); } break;
          case 'ArrowDown': if (!diInput && this.items.length) { e.preventDefault(); this.aktif = Math.min(this.aktif + 1, this.items.length - 1); } break;
          case 'ArrowUp': if (!diInput && this.items.length) { e.preventDefault(); this.aktif = Math.max(this.aktif - 1, 0); } break;
        }
      },
    };
  });

  function toQtyN(v) {
    var s = String(v == null || v === '' ? '0' : v).replace(',', '.');
    if (!/^\d+(\.\d+)?$/.test(s)) return 0n;
    var p = s.split('.'); return BigInt(p[0]) * 10000n + BigInt(((p[1] || '') + '0000').slice(0, 4));
  }
  function fromQty(n) {
    var i = (n / 10000n).toString(); var f = (n % 10000n).toString().padStart(4, '0').replace(/0+$/, '');
    return f ? i + '.' + f : i;
  }
});
