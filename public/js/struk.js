// Cetak struk otomatis lalu tutup jendela popup
(function () {
  var s = document.currentScript;
  document.addEventListener('click', function (e) { if (e.target.closest('[data-cetak]')) window.print(); });
  if (s && s.getAttribute('data-otomatis') === '1') {
    window.addEventListener('load', function () {
      window.print();
      window.addEventListener('afterprint', function () { if (window.opener) window.close(); });
    });
  }
})();
