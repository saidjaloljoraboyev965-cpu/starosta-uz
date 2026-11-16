const { Pool, types } = require('pg');

// DATE (OID 1082) ni JS Date emas, 'YYYY-MM-DD' qator sifatida qaytarish (vaqt zonasi xatolarini oldini oladi)
types.setTypeParser(1082, (val) => val);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => console.error('PG pool xatoligi:', err.message));

// Bazada users jadvali yo'q bo'lsa, avtomatik yaratish
const initDb = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          google_id VARCHAR(255) UNIQUE NOT NULL,
          email VARCHAR(255),
          full_name VARCHAR(255),
          avatar_url TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          last_login_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ 'users' jadvali muvaffaqiyatli tekshirildi/yaratildi");
  } catch (err) {
    console.error("❌ Jadvalni yaratishda xato:", err.message);
  }
};

initDb();

module.exports = pool;
