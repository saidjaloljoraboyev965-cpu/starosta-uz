const express = require('express');
const pool = require('../db');
const { loadOwnedGroup, isUuid, wrap } = require('../middleware/auth');

const STUDENT_COLS = `id, full_name AS name, student_code AS code, phone`;

// --- /api/groups/:groupId/students --------------------------------------
const groupStudents = express.Router({ mergeParams: true });

// GET — guruh talabalari
groupStudents.get(
  '/',
  loadOwnedGroup,
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT ${STUDENT_COLS} FROM students WHERE group_id = $1 ORDER BY full_name`,
      [req.groupId]
    );
    res.json({ students: rows });
  })
);

function cleanStudent(body) {
  return {
    name: String(body?.name || '').trim(),
    code: String(body?.code || '').trim(),
    phone: String(body?.phone || '').trim(),
  };
}

// POST — bitta talaba yoki { students: [...] } ko'rinishida bir nechta talaba qo'shish
groupStudents.post(
  '/',
  loadOwnedGroup,
  wrap(async (req, res) => {
    const list = Array.isArray(req.body.students) ? req.body.students : [req.body];
    const items = list.map(cleanStudent);
    if (items.length === 0 || items.length > 200 || items.some((s) => !s.name || !s.code)) {
      return res.status(400).json({ error: 'Talabaning F.I.Sh. va ID raqami majburiy' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const created = [];
      for (const s of items) {
        const { rows } = await client.query(
          `INSERT INTO students (group_id, full_name, student_code, phone)
           VALUES ($1, $2, $3, $4) RETURNING ${STUDENT_COLS}`,
          [req.groupId, s.name, s.code, s.phone]
        );
        created.push(rows[0]);
      }
      await client.query('COMMIT');
      res.status(201).json(Array.isArray(req.body.students) ? { students: created } : { student: created[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Bu ID raqamli talaba guruhda allaqachon bor' });
      }
      throw err;
    } finally {
      client.release();
    }
  })
);

// --- /api/students/:studentId -------------------------------------------
const students = express.Router();

// Talaba shu foydalanuvchining guruhiga tegishli ekanini tekshirib, group_id ni oladi
const ownedStudentSql = `
  SELECT s.id FROM students s
    JOIN groups g ON g.id = s.group_id
   WHERE s.id = $1 AND g.owner_id = $2`;

// PUT — talabani tahrirlash
students.put(
  '/:studentId',
  wrap(async (req, res) => {
    const { studentId } = req.params;
    if (!isUuid(studentId)) return res.status(400).json({ error: "studentId noto'g'ri" });
    const s = cleanStudent(req.body);
    if (!s.name || !s.code) return res.status(400).json({ error: 'Talabaning F.I.Sh. va ID raqami majburiy' });

    const own = await pool.query(ownedStudentSql, [studentId, req.user.id]);
    if (!own.rows[0]) return res.status(404).json({ error: 'Talaba topilmadi' });

    try {
      const { rows } = await pool.query(
        `UPDATE students SET full_name = $1, student_code = $2, phone = $3
          WHERE id = $4 RETURNING ${STUDENT_COLS}`,
        [s.name, s.code, s.phone, studentId]
      );
      res.json({ student: rows[0] });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Bu ID raqamli talaba guruhda allaqachon bor' });
      }
      throw err;
    }
  })
);

// DELETE — talabani (davomat yozuvlari bilan) o'chirish
students.delete(
  '/:studentId',
  wrap(async (req, res) => {
    const { studentId } = req.params;
    if (!isUuid(studentId)) return res.status(400).json({ error: "studentId noto'g'ri" });
    const own = await pool.query(ownedStudentSql, [studentId, req.user.id]);
    if (!own.rows[0]) return res.status(404).json({ error: 'Talaba topilmadi' });
    await pool.query('DELETE FROM students WHERE id = $1', [studentId]);
    res.json({ ok: true });
  })
);

module.exports = { groupStudents, students };
