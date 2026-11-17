const { Pool, types } = require('pg');

// DATE (OID 1082) ni JS Date emas, 'YYYY-MM-DD' qator sifatida qaytarish (vaqt zonasi xatolarini oldini oladi)
types.setTypeParser(1082, (val) => val);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => console.error('PG pool xatoligi:', err.message));

module.exports = pool;
