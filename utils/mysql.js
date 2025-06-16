const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: process.env.MYSQL_PORT || 3306,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
});

async function init() {
  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY,
    contact VARCHAR(255) UNIQUE,
    firebase_uid VARCHAR(255) UNIQUE
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS resumes (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36),
    name VARCHAR(255),
    template_type VARCHAR(255),
    color VARCHAR(255),
    screenshot_url TEXT,
    screenshot_urls TEXT,
    created_at DATETIME,
    updated_at DATETIME,
    is_deleted TINYINT DEFAULT 0,
    INDEX(user_id)
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS user_data (
    user_id VARCHAR(36),
    resume_id VARCHAR(36),
    meta_data TEXT,
    chat TEXT,
    PRIMARY KEY(user_id, resume_id)
  )`);
}

init().catch(err => console.error('MySQL init error', err));

module.exports = pool;
