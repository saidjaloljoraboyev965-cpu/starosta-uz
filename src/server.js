require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const PgStore = require('connect-pg-simple')(session);
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const pool = require('./db');
const passport = require('./config/passport');
const { requireAuth } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const groupRoutes = require('./routes/groups');
const { groupStudents, students } = require('./routes/students');
const attendanceRoutes = require('./routes/attendance');

for (const key of ['DATABASE_URL', 'SESSION_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'BASE_URL']) {
  if (!process.env[key]) {
    console.error(`❌ .env faylida ${key} topilmadi`);
    process.exit(1);
  }
}

const isProd = process.env.NODE_ENV === 'production';
const app = express();

// Nginx / Render / Railway kabi proxy ortida secure cookie ishlashi uchun
if (isProd) app.set('trust proxy', 1);

// Frontend CDN skriptlari (Tailwind, Chart.js, jsPDF) va inline kod ishlatadi, shuning uchun CSP o'chirilgan.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));

app.use(
  session({
    store: new PgStore({ pool, createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax', // cross-site POST/DELETE so'rovlarida cookie yuborilmaydi (CSRF himoyasi)
      secure: isProd,
      maxAge: 1000 * 60 * 60 * 24 * 30, // 30 kun
    },
  })
);
app.use(passport.initialize());
app.use(passport.session());

// Umumiy cheklov + login uchun qattiqroq cheklov
app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false }));

// API
app.use('/api/auth', authRoutes);
app.use('/api/groups/:groupId/students', requireAuth, groupStudents);
app.use('/api/groups', requireAuth, groupRoutes);
app.use('/api/students', requireAuth, students);
app.use('/api/attendance', requireAuth, attendanceRoutes);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint topilmadi' }));

// Frontend
app.use(express.static(path.join(__dirname, '../public')));

// Xatoliklar
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Serverda ichki xatolik yuz berdi' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🚀 Starosta.uz: ${process.env.BASE_URL} (port ${port})`));
