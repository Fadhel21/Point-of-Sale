// Interaksi halaman masuk: tampil/sembunyi password, peringatan Caps Lock, status memuat
(function () {
  'use strict';
  // Kartu akun demo: isi username & password lalu langsung masuk
  document.addEventListener('click', function (e) {
    var d = e.target.closest('[data-demo-u]');
    if (!d || d.closest('.sibuk')) return;
    var u = document.getElementById('u'); var p = document.getElementById('p');
    u.value = d.getAttribute('data-demo-u');
    p.value = d.getAttribute('data-demo-p');
    [u, p].forEach(function (el) { el.setAttribute('aria-invalid', 'false'); el.classList.add('terisi'); });
    d.classList.add('memuat');
    d.closest('.demo-grid').classList.add('sibuk');
    d.setAttribute('aria-busy', 'true');
    u.form.requestSubmit();
  });

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
