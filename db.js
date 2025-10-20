const sql = require('mssql');
require('dotenv').config();

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true', // Ler de variável de ambiente (true/false)
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true' // Ler de variável de ambiente (true/false)
  },
  port: parseInt(process.env.DB_PORT || '1433') // Default para 1433 se não definido
};

let pool;

async function getPool() {
  // Se a pool já existe e está conectada, retorna-a para evitar reconexões desnecessárias
  if (pool && pool.connected) {
    return pool;
  }
  
  try {
    console.log('--- Configuração de Conexão do DB ---');
    console.log('Server (DB_SERVER):', config.server);
    console.log('Port (DB_PORT):', config.port);
    console.log('Database (DB_DATABASE):', config.database);
    console.log('User (DB_USER):', config.user);
    // Para depuração, vamos verificar se a senha está sendo lida.
    // Em produção, NUNCA logue a senha.
    console.log('Password (DB_PASSWORD):', config.password ? '****** (Definida)' : 'NÃO DEFINIDA');
    console.log('Encrypt (DB_ENCRYPT):', config.options.encrypt);
    console.log('TrustServerCertificate (DB_TRUST_SERVER_CERTIFICATE):', config.options.trustServerCertificate);
    console.log('------------------------------------');

    // Tenta estabelecer a conexão
    pool = await sql.connect(config);
    console.log('✅ Conexão bem-sucedida ao SQL Server!');
    return pool;
  } catch (err) {
    console.error('❌ Erro ao conectar ao SQL Server:', err.message);
    // Se houver um erro, garante que a pool seja resetada para tentar novamente depois
    if (pool && pool.connected) {
        await pool.close();
    }
    pool = null; // Garante que a próxima tentativa de getPool crie uma nova conexão
    throw err; // Re-lança o erro para que a rota que chamou possa tratá-lo
  }
}

// Garante que a conexão com o banco de dados seja fechada elegantemente ao desligar o processo
process.on('SIGTERM', async () => {
    if (pool && pool.connected) {
        await pool.close();
        console.log('🚫 Conexão com SQL Server fechada via SIGTERM.');
    }
    process.exit(0);
});

// Outro evento para fechar a conexão em caso de saída não-SIGTERM
process.on('SIGINT', async () => {
    if (pool && pool.connected) {
        await pool.close();
        console.log('🚫 Conexão com SQL Server fechada via SIGINT.');
    }
    process.exit(0);
});


module.exports = {
  sql,
  getPool
};