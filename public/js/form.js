// Komponen Alpine bersama: pemilih produk & daftar item (PO, penerimaan, mutasi, penyesuaian)
document.addEventListener('alpine:init', function () {
  'use strict';

  // String desimal -> BigInt berskala (tanpa float)
  function skala(v, digit) {
    var s = String(v == null ? '' : v).trim().replace(',', '.');
    if (!/^\d+(\.\d+)?$/.test(s)) return 0n;
    var p = s.split('.');
    return BigInt(p[0] + ((p[1] || '') + '0000').slice(0, digit));
  }

  async function cariProduk(q) {
    var r = await fetch('/produk/cari?q=' + encodeURIComponent(q), { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
    var d = await r.json();
    return d.ok ? d.rows : [];
  }

  // Satu produk: <div x-data="pilihProduk" data-nama="input_name">
  Alpine.data('pilihProduk', function () {
    return {
      q: '', hasil: [], pilih: null,
      cari: async function () { this.hasil = this.q.trim().length < 2 ? [] : await cariProduk(this.q.trim()); },
      ambil: function (p) { this.pilih = p; this.hasil = []; this.q = p.name + ' (' + p.sku + ')'; },
    };
  });

  // Banyak item: <div x-data="daftarItem" data-awal='[...]' data-harga="cost|none">
  Alpine.data('daftarItem', function () {
    return {
      q: '', hasil: [], items: [],
      init: function () {
        try { this.items = JSON.parse(this.$el.dataset.awal || '[]'); } catch (e) { this.items = []; }
      },
      cari: async function () { this.hasil = this.q.trim().length < 2 ? [] : await cariProduk(this.q.trim()); },
      ambil: function (p) {
        if (!this.items.some(function (i) { return String(i.product_id) === String(p.id); })) {
          this.items.push({ product_id: p.id, name: p.name, sku: p.sku, qty: '1', price: p.cost_price || '0', stok: p.stok, unit_name: p.unit_name });
        }
        this.hasil = []; this.q = '';
      },
      hapus: function (i) { this.items.splice(i, 1); },
      enter: function () { if (this.hasil.length) this.ambil(this.hasil[0]); },
      // Tampilan subtotal saja; server menghitung ulang total
      subtotal: function (it) {
        var q = skala(it.qty, 4); var p = skala(it.price, 2);
        var sen = (q * p + 5000n) / 10000n; // dibulatkan setengah ke atas
        return window.rupiah((sen / 100n).toString() + '.' + (sen % 100n).toString().padStart(2, '0'));
      },
    };
  });
});
