// Grafik penjualan dashboard
window.addEventListener('DOMContentLoaded', function () {
  var el = document.getElementById('grafik');
  if (!el || !window.Chart) return;
  var label = JSON.parse(el.dataset.label || '[]');
  // Nilai hanya untuk menggambar grafik (bukan perhitungan uang)
  var nilai = JSON.parse(el.dataset.nilai || '[]').map(Number);
  new window.Chart(el, {
    type: 'bar',
    data: { labels: label, datasets: [{ label: 'Penjualan', data: nilai, backgroundColor: '#0f766e' }] },
    options: {
      responsive: true,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { return window.rupiah(el.dataset.nilai ? JSON.parse(el.dataset.nilai)[c.dataIndex] : c.raw); } } } },
      scales: { y: { beginAtZero: true, ticks: { callback: function (v) { return window.rupiah(String(v)); } } } },
    },
  });
});
