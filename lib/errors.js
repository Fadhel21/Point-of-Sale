// Kesalahan yang aman ditampilkan ke pengguna (validasi / aturan bisnis)
class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
    this.expose = true;
  }
}

module.exports = { AppError };
