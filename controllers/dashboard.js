// Dashboard
const reports = require('../services/reports');
const stock = require('../services/stock');
const shifts = require('../services/shifts');
const { boleh } = require('../lib/akses');
const { h } = require('../lib/http');

exports.index = h(async (req, res) => {
  const hari = req.query.hari === '30' ? 30 : 7;
  const semua = boleh(req.user.role, 'transaksi.semua');
  const data = await reports.dashboard({
    outletId: req.outletId,
    userId: semua ? null : req.user.id,
    lihatLaba: boleh(req.user.role, 'lihat.laba'),
    hari,
  });
  const menipis = boleh(req.user.role, 'persediaan') || semua ? await stock.lowStock(req.outletId, 10) : [];
  const shiftSaya = await shifts.current(req.user.id);
  res.render('dashboard', { title: 'Dashboard', ...data, menipis, shiftSaya, hari });
});
