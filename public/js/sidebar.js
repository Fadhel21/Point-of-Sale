// Sidebar: ciutkan/lebarkan (diingat di localStorage), laci menu di layar kecil.
// Dimuat tanpa defer di <head> agar status ciut diterapkan sebelum halaman tampil (tanpa kedip).
(function () {
  'use strict';
  var KUNCI = 'pos.sidebar.ciut';
  try { if (localStorage.getItem(KUNCI) === '1') document.documentElement.classList.add('sb-ciut-aktif'); } catch (_) { /* abaikan */ }

  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-ciut]')) {
      var ciut = document.documentElement.classList.toggle('sb-ciut-aktif');
      try { localStorage.setItem(KUNCI, ciut ? '1' : '0'); } catch (_) { /* abaikan */ }
      // Saat diciutkan, tutup submenu yang terbuka agar tidak meluber
      if (ciut) document.querySelectorAll('.sb-kelompok[open]').forEach(function (d) { d.open = false; });
      return;
    }
    if (e.target.closest('[data-menu-hp]')) { document.documentElement.classList.toggle('sb-hp-buka'); return; }
    // Klik di luar sidebar menutup laci di layar kecil
    if (document.documentElement.classList.contains('sb-hp-buka') && !e.target.closest('#sidebar')) {
      document.documentElement.classList.remove('sb-hp-buka');
    }
    // Mode ciut: klik grup membuka sidebar dulu
    var s = e.target.closest('.sb-kelompok > summary');
    if (s && document.documentElement.classList.contains('sb-ciut-aktif')) {
      document.documentElement.classList.remove('sb-ciut-aktif');
      try { localStorage.setItem(KUNCI, '0'); } catch (_) { /* abaikan */ }
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') document.documentElement.classList.remove('sb-hp-buka');
  });
})();
