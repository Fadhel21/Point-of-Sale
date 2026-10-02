// Penyimpanan gambar dari data URL (base64) yang dikirim browser; tanpa library upload.
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const { AppError } = require('../lib/errors');

function simpanGambar(dataUrl, awalan) {
  if (!dataUrl) return null;
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new AppError('Format gambar harus PNG, JPG, atau WEBP.');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 2 * 1024 * 1024) throw new AppError('Ukuran gambar maksimal 2 MB.');
  // Periksa tanda tangan file, jangan percaya tipe dari browser
  const sig = buf.subarray(0, 12);
  const png = sig[0] === 0x89 && sig[1] === 0x50;
  const jpg = sig[0] === 0xff && sig[1] === 0xd8;
  const webp = sig.toString('ascii', 0, 4) === 'RIFF' && sig.toString('ascii', 8, 12) === 'WEBP';
  if (!png && !jpg && !webp) throw new AppError('Isi file bukan gambar yang valid.');
  const nama = `${awalan}-${uuidv4()}.${png ? 'png' : jpg ? 'jpg' : 'webp'}`;
  fs.mkdirSync(config.uploadDir, { recursive: true });
  fs.writeFileSync(path.join(config.uploadDir, nama), buf);
  return nama;
}

module.exports = { simpanGambar };
