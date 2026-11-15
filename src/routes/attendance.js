const express = require('express');
const pool = require('../db');
const { loadOwnedGroup, isUuid, isValidDate, wrap } = require('../middleware/auth');

const router = express.Router();
const STATUSES = new Set(['present', 'late', 'excused', 'absent']);

// GET /api/attendance?group_id=X&date=YYYY-MM-DD
//   date berilsa  -> shu kunlik davomat: { date, lesson, records: { [studentId]: {status, note} }, exists }
//   date berilmasa -> butun tarix:       { attendance: { [date]: { lesson, records } } }
router.get(
  '/',
  loadOwnedGroup,
  wrap(async (req, res) => {
    const { date } = req.query;

    if (date !== undefined) {
      if (!isValidDate(date)) return res.status(400).json({ error: "date YYYY-MM-DD formatida bo'lishi kerak" });
      const { rows } = await pool.query(
        `SELECT s.lesson, r.student_id, r.status, r.note
           FROM attendance_sessions s
      LEFT JOIN attendance_records r ON r.session_id = s.id
          WHERE s.group_id = $1 AND s.date = $2`,
        [req.groupId, date]
      );
      if (rows.length === 0) return res.json({ date, lesson: '', records: {}, exists: false });
      const records = {};
      rows.forEach((r) => {
        if (r.student_id) records[r.student_id] = { status: r.status, note: r.note };
      });
      return res.json({ date, lesson: rows[0].lesson, records, exists: true });
    }

    const { rows } = await pool.query(
      `SELECT s.date, s.lesson, r.student_id, r.status, r.note
         FROM attendance_sessions s
    LEFT JOIN attendance_records r ON r.session_id = s.id
        WHERE s.group_id = $1
        ORDER BY s.date`,
      [req.groupId]
    );
    const attendance = {};
    rows.forEach((r) => {
      if (!attendance[r.date]) attendance[r.date] = { lesson: r.lesson, records: {} };
      if (r.student_id) attendance[r.date].records[r.student_id] = { status: r.status, note: r.note };
    });
    res.json({ attendance });
  })
);

// POST /api/attendance — kunlik davomatni saqlash/yangilash (upsert)
// body: { group_id, date, lesson, records: [{ student_id, status, note }] }
router.post(
  '/',
  loadOwnedGroup,
  wrap(async (req, res) => {
    const { date, lesson, records } = req.body;
    if (!isValidDate(date)) return res.status(400).json({ error: "date YYYY-MM-DD formatida bo'lishi kerak" });
    if (!Array.isArray(records) || records.length > 500) {
      return res.status(400).json({ error: 'records massivi noto\'g\'ri' });
    }
    for (const r of records) {
      if (!isUuid(r.student_id) || !STATUSES.has(r.status)) {
        return res.status(400).json({ error: "records ichida student_id yoki status noto'g'ri" });
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const sess = await client.query(
        `INSERT INTO attendance_sessions (group_id, date, lesson)
         VALUES ($1, $2, $3)
         ON CONFLICT (group_id, date)
         DO UPDATE SET lesson = EXCLUDED.lesson, updated_at = now()
         RETURNING id`,
        [req.groupId, date, String(lesson || '').trim()]
      );
      const sessionId = sess.rows[0].id;

      if (records.length > 0) {
        // Faqat shu guruhdagi talabalar yoziladi (JOIN students ... group_id)
        await client.query(
          `INSERT INTO attendance_records (session_id, student_id, status, note)
           SELECT $1, s.id, r.status, r.note
             FROM unnest($2::uuid[], $3::text[], $4::text[]) AS r(student_id, status, note)
             JOIN students s ON s.id = r.student_id AND s.group_id = $5
           ON CONFLICT (session_id, student_id)
           DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, updated_at = now()`,
          [
            sessionId,
            records.map((r) => r.student_id),
            records.map((r) => r.status),
            records.map((r) => String(r.note || '').slice(0, 500)),
            req.groupId,
          ]
        );
      }
      await client.query('COMMIT');
      res.json({ ok: true, session_id: sessionId });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  })
);

module.exports = router;
