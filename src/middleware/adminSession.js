const session = require('express-session');
const PgStore = require('connect-pg-simple')(session);
const pool = require('../db');

// Admin sessiyasi starosta sessiyasidan butunlay alohida: boshqa cookie, boshqa jadval, qisqa muddat
module.exports = session({
  name: 'admin.sid',
  // Jadval db/schema.sql da yaratiladi (kutubxona ikkinchi jadval uchun ham 'session_pkey' nomini ishlatib, xato beradi)
  store: new PgStore({ pool, tableName: 'admin_session' }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/api/admin',
    maxAge: 1000 * 60 * 60 * 8, // 8 soat
  },
});
