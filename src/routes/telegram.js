const express = require('express');
const pool = require('../db');
const tgService = require('../services/telegram');
const { loadOwnedGroup, isValidDate, wrap } = require('../middleware/auth');

// /api/groups/:groupId/telegram
const router = express.Router({ mergeParams: true });
router.use(loadOwnedGroup);

async function ensureCode(groupId) {
  const { rows } = await pool.query('SELECT teacher_link_code, telegram_channel_id FROM groups WHERE id = $1', [groupId]);
  let code = rows[0].teacher_link_code;
  if (!code) {
    code = tgService.newLinkCode();
    await pool.query('UPDATE groups SET teacher_link_code = $1 WHERE id = $2', [code, groupId]);
  }
  return { code, channelConfigured: Boolean(rows[0].telegram_channel_id || tgService.DEFAULT_CHANNEL) };
}

async function state(groupId) {
  if (!tgService.enabled()) return { enabled: false };
  const me = await tgService.getBotInfo().catch(() => null);
  const { code, channelConfigured } = await ensureCode(groupId);
  const { rows: teachers } = await pool.query(
    'SELECT id, teacher_name AS name, linked_at AS "linkedAt" FROM group_teachers WHERE group_id = $1 ORDER BY linked_at', [groupId]
  );
  return {
    enabled: true,
    botUsername: me?.username || null,
    code,
    deepLink: me ? `https://t.me/${me.username}?start=${code}` : null,
    channelConfigured,
    teachers,
  };
}

router.get('/', wrap(async (req, res) => res.json(await state(req.groupId))));

// Eski havolani bekor qilib yangisini beradi (allaqachon ulangan ustozlar saqlanadi)
router.post('/regenerate-code', wrap(async (req, res) => {
  await pool.query('UPDATE groups SET teacher_link_code = $1 WHERE id = $2', [tgService.newLinkCode(), req.groupId]);
  res.json(await state(req.groupId));
}));

router.delete('/teachers/:teacherId', wrap(async (req, res) => {
  if (!/^\d+$/.test(req.params.teacherId)) return res.status(400).json({ error: 'id noto\'g\'ri' });
  await pool.query('DELETE FROM group_teachers WHERE id = $1 AND group_id = $2', [req.params.teacherId, req.groupId]);
  res.json({ ok: true });
}));

// Davomat hisobotini yuborish (qayta yuborilsa avvalgi xabar yangilanadi)
const lastSend = new Map();
router.post('/send', wrap(async (req, res) => {
  const { date } = req.body || {};
  if (!isValidDate(date)) return res.status(400).json({ error: "date YYYY-MM-DD formatida bo'lishi kerak" });
  const last = lastSend.get(req.groupId) || 0;
  if (Date.now() - last < 5000) return res.status(429).json({ error: 'Iltimos, bir necha soniya kuting' });
  lastSend.set(req.groupId, Date.now());
  try {
    res.json(await tgService.sendAttendanceReport(req.groupId, date));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Telegramga yuborishda xatolik' });
    if (!e.status) console.error(e);
  }
}));

module.exports = router;
