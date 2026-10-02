// Perilaku umum halaman (tanpa handler inline karena CSP)
(function () {
  'use strict';

  document.addEventListener('change', function (e) {
    if (e.target.matches('[data-autosubmit]')) e.target.form.submit();
  });

  // Konfirmasi sebelum aksi berbahaya: <form data-konfirmasi="Yakin?">
  document.addEventListener('submit', function (e) {
    var pesan = e.target.getAttribute('data-konfirmasi');
    if (pesan && !window.confirm(pesan)) { e.preventDefault(); return; }
    // Cegah submit ganda pada form biasa
    var btn = e.target.querySelector('button[type=submit],button:not([type])');
    if (btn && !e.target.hasAttribute('data-boleh-ulang')) setTimeout(function () { btn.disabled = true; }, 0);
  });

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-cetak]');
    if (t) { e.preventDefault(); window.print(); }
    var b = e.target.closest('[data-kembali]');
    if (b) { e.preventDefault(); history.back(); }
  });

  // Foto produk: baca file sebagai data URL ke input tersembunyi (tanpa library upload)
  document.addEventListener('change', function (e) {
    var el = e.target;
    if (!el.matches('[data-file-ke]')) return;
    var f = el.files && el.files[0];
    if (!f) return;
    var maks = parseInt(el.getAttribute('data-maks') || '2097152', 10);
    if (f.size > maks) { alert('Ukuran file terlalu besar.'); el.value = ''; return; }
    var r = new FileReader();
    r.onload = function () { document.getElementById(el.getAttribute('data-file-ke')).value = r.result; };
    if (el.hasAttribute('data-teks')) r.readAsText(f); else r.readAsDataURL(f);
  });

  // Notifikasi HTMX hilang sendiri
  document.addEventListener('htmx:afterSwap', function (e) {
    if (e.detail.target.id === 'notif') setTimeout(function () { e.detail.target.innerHTML = ''; }, 5000);
  });

  // Format rupiah untuk dipakai skrip lain (string desimal -> "Rp 1.234")
  window.rupiah = function (v) {
    var s = String(v == null ? '0' : v);
    var neg = s.charAt(0) === '-'; if (neg) s = s.slice(1);
    var p = s.split('.'); var i = p[0].replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    var f = ((p[1] || '') + '00').slice(0, 2);
    return (neg ? '-' : '') + 'Rp ' + i + (f !== '00' ? ',' + f : '');
  };
})();
