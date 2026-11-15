require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../src/db');

(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
    await pool.query(sql);
    console.log("✅ Ma'lumotlar bazasi sxemasi tayyor.");
  } catch (err) {
    console.error('❌ Sxemani yaratishda xatolik:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
