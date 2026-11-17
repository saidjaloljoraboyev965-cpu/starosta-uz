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
const telegramRoutes = require('./routes/telegram');
const adminRoutes = require('./routes/admin');
const adminSession = require('./middleware/adminSession');
const tgService = require('./services/telegram');

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

// Admin API: alohida sessiya (starosta sessiyasidan oldin ulanadi)
if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD_HASH) {
  console.warn("⚠️  ADMIN_USERNAME / ADMIN_PASSWORD_HASH sozlanmagan — admin panelga kirib bo'lmaydi (npm run admin:hash)");
}
app.use('/api/admin', adminSession, adminRoutes);

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

// Qurilma "oxirgi faollik" vaqtini yangilash (daqiqasiga 1 martadan ko'p emas)
app.use('/api', (req, _res, next) => {
  if (req.isAuthenticated() && req.session) {
    const d = (req.session.device = req.session.device || { loginAt: Date.now(), ua: String(req.get('user-agent') || '').slice(0, 300) });
    if (!d.lastSeen || Date.now() - d.lastSeen > 60 * 1000) { d.lastSeen = Date.now(); d.ip = req.ip; }
  }
  next();
});

// Umumiy cheklov + login uchun qattiqroq cheklov
app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false }));

// API
app.use('/api/auth', authRoutes);
app.use('/api/groups/:groupId/students', requireAuth, groupStudents);
app.use('/api/groups/:groupId/telegram', requireAuth, telegramRoutes);
app.use('/api/groups', requireAuth, groupRoutes);
app.use('/api/students', requireAuth, students);
app.use('/api/attendance', requireAuth, attendanceRoutes);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint topilmadi' }));

// Frontend
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, '../public/admin.html')));
app.use(express.static(path.join(__dirname, '../public')));

// Xatoliklar
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Serverda ichki xatolik yuz berdi' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 Starosta.uz: ${process.env.BASE_URL} (port ${port})`);
  tgService.startPolling();
});
