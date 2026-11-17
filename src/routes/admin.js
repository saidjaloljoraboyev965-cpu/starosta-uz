const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const pool = require('../db');
const tgService = require('../services/telegram');
const { parseUA } = require('../utils/ua');
const { isUuid, wrap } = require('../middleware/auth');

const router = express.Router();
const TZ = process.env.APP_TIMEZONE || 'Asia/Tashkent';
const ONLINE_MS = 5 * 60 * 1000;

// ---------- Kirish: bitta admin, login + parol (.env) ----------
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();

function verifyPassword(password, stored) {
  const [alg, salt, hash] = String(stored || '').split(':');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(String(password), Buffer.from(salt, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Juda ko\'p urinish. 15 daqiqadan so\'ng qayta urinib ko\'ring.' },
});

router.post('/login', loginLimiter, wrap(async (req, res, next) => {
  const { ADMIN_USERNAME, ADMIN_PASSWORD_HASH } = process.env;
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD_HASH) {
    return res.status(503).json({ error: 'Admin hisobi .env da sozlanmagan' });
  }
  const { username = '', password = '' } = req.body || {};
  // Ikkala tekshiruv ham har doim bajariladi (vaqt farqi orqali login topilmasligi uchun)
  const userOk = crypto.timingSafeEqual(sha(username), sha(ADMIN_USERNAME));
  const passOk = verifyPassword(password, ADMIN_PASSWORD_HASH);
  if (!(userOk && passOk)) {
    await new Promise((r) => setTimeout(r, 600));
    return res.status(401).json({ error: 'Login yoki parol noto\'g\'ri' });
  }
  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.isAdmin = true;
    req.session.save(() => res.json({ ok: true }));
  });
}));

router.post('/logout', (req, res) => {
  req.session.destroy(() => { res.clearCookie('admin.sid', { path: '/api/admin' }); res.json({ ok: true }); });
});

router.get('/me', (req, res) => res.json({ isAdmin: Boolean(req.session?.isAdmin) }));

// Bundan keyingi barcha endpoint'lar faqat admin uchun
router.use((req, res, next) => {
  if (req.session?.isAdmin) return next();
  res.status(401).json({ error: 'Admin sifatida kiring' });
});

// ---------- Qurilmalar (faol sessiyalar) ----------
async function listDevices() {
  const { rows } = await pool.query(
    `SELECT s.sid, s.sess, s.expire, u.id AS user_id, u.full_name, u.email, u.avatar_url
       FROM session s
       JOIN users u ON u.id::text = s.sess->'passport'->>'user'
      WHERE s.expire > now()`
  );
  const now = Date.now();
  return rows.map((r) => {
    const d = r.sess.device || {};
    const ua = parseUA(d.ua || '');
    return {
      sid: r.sid, userId: r.user_id, userName: r.full_name, email: r.email, avatar: r.avatar_url,
      ip: d.ip || '—', userAgent: d.ua || '', ...ua,
      loginAt: d.loginAt || null, lastSeen: d.lastSeen || null,
      online: Boolean(d.lastSeen && now - d.lastSeen < ONLINE_MS),
      expiresAt: r.expire,
    };
  }).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
}

router.get('/devices', wrap(async (_req, res) => {
  const devices = await listDevices();
  res.json({ devices, online: devices.filter((d) => d.online).length, total: devices.length });
}));

router.delete('/devices/:sid', wrap(async (req, res) => {
  if (!/^[\w-]{10,}$/.test(req.params.sid)) return res.status(400).json({ error: 'sid noto\'g\'ri' });
  const r = await pool.query('DELETE FROM session WHERE sid = $1', [req.params.sid]);
  res.json({ ok: true, removed: r.rowCount });
}));

// ---------- Statistika ----------
router.get('/stats', wrap(async (_req, res) => {
  const today = `(now() AT TIME ZONE $1)::date`;
  const [totals, todayRows, statuses, daily, signups, topAbsent, tgStats, devices] = await Promise.all([
    pool.query(`SELECT
        (SELECT count(*)::int FROM users) AS users,
        (SELECT count(*)::int FROM users WHERE created_at > now() - interval '7 days') AS users_week,
        (SELECT count(*)::int FROM users WHERE is_blocked) AS blocked,
        (SELECT count(*)::int FROM groups) AS groups,
        (SELECT count(*)::int FROM students) AS students,
        (SELECT count(*)::int FROM attendance_sessions) AS sessions,
        (SELECT count(*)::int FROM attendance_records) AS records`),
    pool.query(`SELECT count(DISTINCT s.group_id)::int AS groups_marked,
                       count(*) FILTER (WHERE r.status = 'absent')::int AS absent,
                       count(r.*)::int AS total
                  FROM attendance_sessions s LEFT JOIN attendance_records r ON r.session_id = s.id
                 WHERE s.date = ${today}`, [TZ]),
    pool.query(`SELECT status, count(*)::int AS n FROM attendance_records GROUP BY status`),
    pool.query(`SELECT to_char(s.date, 'YYYY-MM-DD') AS date,
                       count(DISTINCT s.group_id)::int AS groups_marked,
                       count(*) FILTER (WHERE r.status = 'absent')::int AS absent,
                       count(r.*)::int AS total
                  FROM attendance_sessions s LEFT JOIN attendance_records r ON r.session_id = s.id
                 WHERE s.date >= ${today} - 13
                 GROUP BY s.date ORDER BY s.date`, [TZ]),
    pool.query(`SELECT to_char((created_at AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS date, count(*)::int AS n
                  FROM users WHERE created_at > now() - interval '30 days' GROUP BY 1 ORDER BY 1`, [TZ]),
    pool.query(`SELECT g.id, g.name, u.full_name AS owner,
                       count(r.*)::int AS total,
                       count(*) FILTER (WHERE r.status = 'absent')::int AS absent
                  FROM groups g JOIN users u ON u.id = g.owner_id
                  JOIN attendance_sessions s ON s.group_id = g.id
                  JOIN attendance_records r ON r.session_id = s.id
                 GROUP BY g.id, u.full_name HAVING count(r.*) > 0
                 ORDER BY (count(*) FILTER (WHERE r.status = 'absent'))::float / count(r.*) DESC LIMIT 5`),
    pool.query(`SELECT count(*) FILTER (WHERE ok)::int AS ok, count(*) FILTER (WHERE NOT ok)::int AS failed
                  FROM telegram_log WHERE created_at > now() - interval '7 days' AND target <> 'test'`),
    listDevices(),
  ]);

  res.json({
    totals: totals.rows[0],
    today: todayRows.rows[0],
    statuses: Object.fromEntries(statuses.rows.map((r) => [r.status, r.n])),
    daily: daily.rows,
    signups: signups.rows,
    topAbsent: topAbsent.rows,
    telegram: { ...tgStats.rows[0], enabled: tgService.enabled() },
    devices: { online: devices.filter((d) => d.online).length, total: devices.length },
  });
}));

// ---------- Foydalanuvchilar ----------
router.get('/users', wrap(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.full_name AS name, u.email, u.avatar_url AS avatar, u.is_blocked AS blocked,
            u.created_at AS "createdAt", u.last_login_at AS "lastLoginAt",
            (SELECT count(*)::int FROM groups g WHERE g.owner_id = u.id) AS groups,
            (SELECT count(*)::int FROM students s JOIN groups g ON g.id = s.group_id WHERE g.owner_id = u.id) AS students
       FROM users u ORDER BY u.last_login_at DESC`
  );
  res.json({ users: rows });
}));

const revokeSessions = (userId) =>
  pool.query(`DELETE FROM session WHERE sess->'passport'->>'user' = $1`, [userId]);

router.patch('/users/:id', wrap(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'id noto\'g\'ri' });
  const blocked = Boolean(req.body?.blocked);
  const r = await pool.query('UPDATE users SET is_blocked = $1 WHERE id = $2', [blocked, req.params.id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
  if (blocked) await revokeSessions(req.params.id); // bloklanganda barcha qurilmalardan chiqariladi
  res.json({ ok: true });
}));

router.delete('/users/:id', wrap(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'id noto\'g\'ri' });
  await revokeSessions(req.params.id);
  const r = await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]); // guruh/talaba/davomat CASCADE
  if (!r.rowCount) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
  res.json({ ok: true });
}));

// ---------- Guruhlar ----------
router.get('/groups', wrap(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT g.id, g.name, g.faculty, g.university, g.telegram_channel_id AS "channelId",
            u.full_name AS owner, u.email,
            (SELECT count(*)::int FROM students s WHERE s.group_id = g.id) AS students,
            (SELECT count(*)::int FROM group_teachers t WHERE t.group_id = g.id) AS teachers,
            (SELECT to_char(max(a.date), 'YYYY-MM-DD') FROM attendance_sessions a WHERE a.group_id = g.id) AS "lastAttendance",
            (SELECT round(100.0 * count(*) FILTER (WHERE r.status IN ('present','late')) / NULLIF(count(*), 0))::int
               FROM attendance_records r JOIN attendance_sessions a ON a.id = r.session_id
              WHERE a.group_id = g.id) AS rate
       FROM groups g JOIN users u ON u.id = g.owner_id ORDER BY g.created_at DESC`
  );
  res.json({ groups: rows, defaultChannel: tgService.DEFAULT_CHANNEL || null });
}));

// ---------- Telegram ----------
router.get('/telegram', wrap(async (_req, res) => {
  if (!tgService.enabled()) return res.json({ enabled: false });
  const out = { enabled: true, defaultChannel: tgService.DEFAULT_CHANNEL || null };
  try {
    const me = await tgService.getBotInfo();
    out.bot = { id: me.id, username: me.username, name: me.first_name };
    if (out.defaultChannel) {
      try {
        const chat = await tgService.tg('getChat', { chat_id: out.defaultChannel });
        const member = await tgService.tg('getChatMember', { chat_id: out.defaultChannel, user_id: me.id });
        out.channel = {
          ok: true, title: chat.title || chat.username, type: chat.type,
          botStatus: member.status,
          canPost: member.status === 'creator' || (member.status === 'administrator' && member.can_post_messages !== false),
        };
      } catch (e) {
        out.channel = { ok: false, error: e.message };
      }
    }
  } catch (e) {
    out.error = e.message;
  }
  res.json(out);
}));

router.post('/telegram/test', wrap(async (req, res) => {
  const chatId = String(req.body?.chat_id || tgService.DEFAULT_CHANNEL || '').trim();
  if (!chatId) return res.status(400).json({ error: 'Kanal ID si ko\'rsatilmagan' });
  try {
    await tgService.tg('sendMessage', { chat_id: chatId, text: '✅ Starosta.uz: test xabari. Bot ishlayapti!' });
    await tgService.log(null, 'test', chatId, true, 'sent');
    res.json({ ok: true });
  } catch (e) {
    await tgService.log(null, 'test', chatId, false, e.message);
    res.status(400).json({ error: e.message });
  }
}));

router.put('/groups/:id/telegram', wrap(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'id noto\'g\'ri' });
  const channel = String(req.body?.channel_id || '').trim();
  if (channel && !/^(@[A-Za-z0-9_]{5,}|-?\d{5,})$/.test(channel)) {
    return res.status(400).json({ error: 'Kanal ID si @nom yoki -100... ko\'rinishida bo\'lishi kerak' });
  }
  const r = await pool.query('UPDATE groups SET telegram_channel_id = $1 WHERE id = $2', [channel || null, req.params.id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Guruh topilmadi' });
  res.json({ ok: true });
}));

router.get('/telegram/log', wrap(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT l.id, l.target, l.chat_id AS "chatId", l.ok, l.info, l.created_at AS "createdAt", g.name AS "groupName"
       FROM telegram_log l LEFT JOIN groups g ON g.id = l.group_id
      ORDER BY l.id DESC LIMIT 50`
  );
  res.json({ log: rows });
}));

module.exports = router;
