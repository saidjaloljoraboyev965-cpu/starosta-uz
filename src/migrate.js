const fs = require('fs');
const path = require('path');
const pool = require('./db');

// Server ishga tushganda db/schema.sql ni ishlatadi. Fayl takroran ishga tushirish uchun xavfsiz (IF NOT EXISTS),
// va bitta so'rov sifatida bajariladi: xato bo'lsa hech narsa yarim holda qolmaydi.
module.exports = async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('✅ Ma\'lumotlar bazasi sxemasi tekshirildi va yangilandi');
};
