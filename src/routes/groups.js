const express = require('express');
const pool = require('../db');
const { loadOwnedGroup, wrap } = require('../middleware/auth');

const router = express.Router();

const GROUP_COLS = `g.id, g.name, g.faculty, g.university, g.starosta_name AS starosta`;

// GET /api/groups — joriy foydalanuvchining guruhlari
router.get(
  '/',
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT ${GROUP_COLS},
              (SELECT count(*)::int FROM students s WHERE s.group_id = g.id) AS "studentCount"
         FROM groups g
        WHERE g.owner_id = $1
        ORDER BY g.created_at`,
      [req.user.id]
    );
    res.json({ groups: rows });
  })
);

// POST /api/groups — yangi guruh
router.post(
  '/',
  wrap(async (req, res) => {
    const name = String(req.body.name || '').trim();
    const faculty = String(req.body.faculty || '').trim();
    const university = String(req.body.university || '').trim();
    const starosta = String(req.body.starosta || req.user.full_name || '').trim();
    if (!name) return res.status(400).json({ error: 'Guruh nomi majburiy' });

    try {
      const { rows } = await pool.query(
        `INSERT INTO groups (owner_id, name, faculty, university, starosta_name)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, faculty, university, starosta_name AS starosta`,
        [req.user.id, name, faculty, university, starosta]
      );
      res.status(201).json({ group: { ...rows[0], studentCount: 0 } });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Bunday nomli guruh allaqachon mavjud' });
      }
      throw err;
    }
  })
);

// PUT /api/groups/:groupId — guruh sozlamalarini yangilash
router.put(
  '/:groupId',
  loadOwnedGroup,
  wrap(async (req, res) => {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Guruh nomi majburiy' });
    try {
      const { rows } = await pool.query(
        `UPDATE groups
            SET name = $1, faculty = $2, university = $3, starosta_name = $4
          WHERE id = $5
      RETURNING id, name, faculty, university, starosta_name AS starosta`,
        [
          name,
          String(req.body.faculty || '').trim(),
          String(req.body.university || '').trim(),
          String(req.body.starosta || '').trim(),
          req.groupId,
        ]
      );
      res.json({ group: rows[0] });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Bunday nomli guruh allaqachon mavjud' });
      }
      throw err;
    }
  })
);

// DELETE /api/groups/:groupId — guruhni (talabalar va davomati bilan) o'chirish
router.delete(
  '/:groupId',
  loadOwnedGroup,
  wrap(async (req, res) => {
    await pool.query('DELETE FROM groups WHERE id = $1', [req.groupId]);
    res.json({ ok: true });
  })
);

module.exports = router;
