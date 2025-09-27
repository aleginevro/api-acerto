const sql = require('mssql');
require('dotenv').config();

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  options: {
    encrypt: true,
    trustServerCertificate: false
  },
  port: parseInt(process.env.DB_PORT || '1433')
};

let pool;

async function getPool() {
  if (pool && pool.connected) {
    return pool;
  }
  try {
    pool = await sql.connect(config);
    console.log('🔗 Conectado ao SQL Server!');
    return pool;
  } catch (err) {
    console.error('❌ Erro ao conectar ao SQL Server:', err);
    if (pool && pool.connected) {
        await pool.close();
    }
    pool = null;
    throw err;
  }
}

process.on('SIGTERM', async () => {
    if (pool && pool.connected) {
        await pool.close();
        console.log('🚫 Conexão com SQL Server fechada.');
    }
    process.exit(0);
});

module.exports = {
  sql,
  getPool
};