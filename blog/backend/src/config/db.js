const mysql = require('mysql2/promise');

// Credentials come from the environment (Kubernetes Secret / ConfigMap, or backend/.env locally).
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  namedPlaceholders: true, // queries use :name placeholders
  decimalNumbers: true,
});

module.exports = pool;
