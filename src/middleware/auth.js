const pool = require('../db');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isUuid(v) {
  return typeof v === 'string' && UUID_RE.test(v);
}

function isValidDate(v) {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ error: 'Tizimga kirish talab qilinadi' });
}

// async route'lardagi xatolarni Express'ga uzatish
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Guruh shu foydalanuvchiga tegishliligini tekshiradi (boshqa starostaning ma'lumotiga kirishni oldini oladi)
const loadOwnedGroup = wrap(async (req, res, next) => {
  const groupId = req.params.groupId || req.query.group_id || req.body?.group_id;
  if (!isUuid(groupId)) return res.status(400).json({ error: "group_id noto'g'ri" });
  const { rows } = await pool.query(
    'SELECT id FROM groups WHERE id = $1 AND owner_id = $2',
    [groupId, req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Guruh topilmadi' });
  req.groupId = groupId;
  next();
});

module.exports = { requireAuth, loadOwnedGroup, isUuid, isValidDate, wrap };
