// Titik masuk server web
const config = require('./config');
const app = require('./app');

app.listen(config.port, () => {
  console.log(`POS berjalan di http://localhost:${config.port}`);
});
