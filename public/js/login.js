// Interaksi halaman masuk: tampil/sembunyi password, peringatan Caps Lock, status memuat
(function () {
  'use strict';
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-lihat]');
    if (!b) return;
    var input = document.getElementById(b.getAttribute('data-lihat'));
    var tampil = input.type === 'password';
    input.type = tampil ? 'text' : 'password';
    b.setAttribute('aria-pressed', String(tampil));
    b.setAttribute('aria-label', tampil ? 'Sembunyikan password' : 'Tampilkan password');
    input.focus();
  });

  function cekCaps(e) {
    var caps = document.getElementById('caps');
    if (caps && e.getModifierState) caps.hidden = !e.getModifierState('CapsLock');
  }
  document.addEventListener('keydown', cekCaps);
  document.addEventListener('keyup', cekCaps);

  document.addEventListener('submit', function (e) {
    var f = e.target;
    var u = f.querySelector('#u'); var p = f.querySelector('#p');
    // Validasi ringan di dekat field
    [u, p].forEach(function (el) { el.setAttribute('aria-invalid', el.value.trim() ? 'false' : 'true'); });
    if (!u.value.trim()) { e.preventDefault(); u.focus(); return; }
    if (!p.value) { e.preventDefault(); p.focus(); return; }
    var btn = f.querySelector('.tombol-masuk');
    btn.classList.add('memuat');
    btn.disabled = true;
    btn.querySelector('.label').textContent = 'Memeriksa…';
  });
})();
