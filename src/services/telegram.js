const pool = require('../db');
const crypto = require('crypto');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DEFAULT_CHANNEL = process.env.TELEGRAM_CHANNEL_ID || '';
const enabled = () => Boolean(TOKEN);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
const fmtDate = (d) => {
  const [y, m, day] = d.split('-');
  return `${parseInt(day, 10)}-${MONTHS[parseInt(m, 10) - 1]}, ${y}`;
};
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---- Telegram Bot API -----------------------------------------------------
async function tg(method, params = {}, retry = true) {
  if (!TOKEN) throw new Error('TELEGRAM_BOT_TOKEN sozlanmagan');
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
  if (!data.ok) {
    const retryAfter = data.parameters?.retry_after;
    if (retry && data.error_code === 429 && retryAfter && retryAfter <= 5) {
      await sleep((retryAfter + 0.5) * 1000);
      return tg(method, params, false);
    }
    const err = new Error(data.description || 'Telegram xatoligi');
    err.code = data.error_code;
    throw err;
  }
  return data.result;
}

let botInfoCache = null;
async function getBotInfo() {
  if (!enabled()) return null;
  if (!botInfoCache) botInfoCache = await tg('getMe');
  return botInfoCache;
}

// ---- Hisobot matni -----------------------------------------------------------
function buildReport({ group, lesson, date, rows }) {
  const c = { present: 0, late: 0, excused: 0, absent: 0 };
  rows.forEach((r) => { c[r.status] += 1; });
  const total = rows.length;
  const rate = total ? Math.round(((c.present + c.late) / total) * 100) : 0;

  const lines = ['📋 <b>Davomat hisoboti</b>'];
  if (group.university) lines.push(`🏫 ${esc(group.university)}`);
  lines.push(`👥 Guruh: <b>${esc(group.name)}</b>${group.faculty ? ` (${esc(group.faculty)})` : ''}`);
  lines.push(`📅 Sana: ${fmtDate(date)}`);
  if (lesson) lines.push(`📖 Dars: ${esc(lesson)}`);
  if (group.starosta_name) lines.push(`👤 Starosta: ${esc(group.starosta_name)}`);
  lines.push('');
  lines.push(`✅ Keldi: <b>${c.present}</b>   ⏰ Kechikdi: <b>${c.late}</b>   📝 Sababli: <b>${c.excused}</b>   ❌ Kelmadi: <b>${c.absent}</b>`);
  lines.push(`📊 Jami: ${total} ta · Davomat: <b>${rate}%</b>`);

  const section = (title, status) => {
    const list = rows.filter((r) => r.status === status);
    if (!list.length) return;
    lines.push('', title);
    list.forEach((r, i) => lines.push(`${i + 1}. ${esc(r.name)}${r.note ? ` — <i>${esc(r.note)}</i>` : ''}`));
  };
  section('❌ <b>Kelmaganlar:</b>', 'absent');
  section('⏰ <b>Kechikkanlar:</b>', 'late');
  section('📝 <b>Sababli:</b>', 'excused');

  // Telegram limiti 4096 belgi: HTML teglar buzilmasligi uchun butun qatorlarni olib tashlaymiz
  let text = lines.join('\n');
  let cut = false;
  while (text.length > 3900 && lines.length > 8) { lines.pop(); cut = true; text = lines.join('\n'); }
  return cut ? `${text}\n…` : text;
}

// ---- Yuborish -----------------------------------------------------------------
async function deliver(chatId, text, sessionId) {
  const key = String(chatId);
  const existing = (await pool.query(
    'SELECT message_id FROM telegram_messages WHERE session_id = $1 AND chat_id = $2', [sessionId, key]
  )).rows[0];

  const base = { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true };
  if (existing) {
    try {
      await tg('editMessageText', { ...base, message_id: Number(existing.message_id) });
      return 'edited';
    } catch (e) {
      if (/not modified/i.test(e.message)) return 'unchanged';
      // xabar o'chirilgan bo'lishi mumkin — yangisini yuboramiz
    }
  }
  const msg = await tg('sendMessage', base);
  await pool.query(
    `INSERT INTO telegram_messages (session_id, chat_id, message_id) VALUES ($1, $2, $3)
     ON CONFLICT (session_id, chat_id) DO UPDATE SET message_id = EXCLUDED.message_id`,
    [sessionId, key, msg.message_id]
  );
  return 'sent';
}

async function log(groupId, target, chatId, ok, info) {
  await pool.query(
    'INSERT INTO telegram_log (group_id, target, chat_id, ok, info) VALUES ($1, $2, $3, $4, $5)',
    [groupId, target, String(chatId ?? ''), ok, String(info).slice(0, 300)]
  ).catch(() => {});
}

// Kunlik davomat hisobotini kanalga va guruhga ulangan ustozlarga yuboradi
async function sendAttendanceReport(groupId, date) {
  if (!enabled()) { const e = new Error('Telegram bot serverda sozlanmagan'); e.status = 503; throw e; }

  const g = (await pool.query(
    `SELECT id, name, faculty, university, starosta_name, telegram_channel_id FROM groups WHERE id = $1`, [groupId]
  )).rows[0];
  const session = (await pool.query(
    'SELECT id, lesson FROM attendance_sessions WHERE group_id = $1 AND date = $2', [groupId, date]
  )).rows[0];
  if (!session) { const e = new Error('Bu kun uchun davomat hali saqlanmagan'); e.status = 404; throw e; }

  const rows = (await pool.query(
    `SELECT s.full_name AS name, COALESCE(r.status, 'present') AS status, COALESCE(r.note, '') AS note
       FROM students s
  LEFT JOIN attendance_records r ON r.student_id = s.id AND r.session_id = $2
      WHERE s.group_id = $1 ORDER BY s.full_name`, [groupId, session.id]
  )).rows;
  if (rows.length === 0) { const e = new Error('Guruhda talabalar yo\'q'); e.status = 400; throw e; }

  const channel = g.telegram_channel_id || DEFAULT_CHANNEL;
  const teachers = (await pool.query(
    'SELECT chat_id, teacher_name FROM group_teachers WHERE group_id = $1 ORDER BY linked_at', [groupId]
  )).rows;
  if (!channel && teachers.length === 0) {
    const e = new Error('Telegram manzillari yo\'q: kanal sozlanmagan va ustoz ulanmagan'); e.status = 400; throw e;
  }

  const text = buildReport({ group: g, lesson: session.lesson, date, rows });
  const targets = [];
  if (channel) targets.push({ target: 'channel', label: 'Kanal', chatId: channel });
  teachers.forEach((t) => targets.push({ target: 'teacher', label: t.teacher_name || 'Ustoz', chatId: t.chat_id }));

  const results = [];
  for (const t of targets) {
    try {
      const action = await deliver(t.chatId, text, session.id);
      await log(groupId, t.target, t.chatId, true, action);
      results.push({ target: t.target, label: t.label, ok: true, action });
    } catch (e) {
      await log(groupId, t.target, t.chatId, false, e.message);
      // Ustoz botni bloklagan bo'lsa (403) — foydalanuvchiga tushunarli xabar
      const error = e.code === 403 ? 'Bot bloklangan yoki yozishga ruxsat yo\'q' : e.message;
      results.push({ target: t.target, label: t.label, ok: false, error });
    }
  }
  return { results };
}

// ---- Bot: /start <kod> orqali ustozni guruhga ulash (long polling) ------------------
function newLinkCode() {
  return crypto.randomBytes(5).toString('hex'); // 10 belgi, /start parametriga mos
}

async function handleMessage(msg) {
  if (!msg || msg.chat?.type !== 'private' || !msg.text) return;
  const chatId = msg.chat.id;
  const name = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || msg.from?.username || '';
  const reply = (text) => tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' }).catch(() => {});
  const [cmd, arg] = msg.text.trim().split(/\s+/);

  if (cmd === '/start' && arg) {
    const g = (await pool.query('SELECT id, name FROM groups WHERE teacher_link_code = $1', [arg])).rows[0];
    if (!g) return reply('❌ Havola eskirgan yoki noto\'g\'ri. Starostadan yangi havola so\'rang.');
    await pool.query(
      `INSERT INTO group_teachers (group_id, chat_id, teacher_name) VALUES ($1, $2, $3)
       ON CONFLICT (group_id, chat_id) DO UPDATE SET teacher_name = EXCLUDED.teacher_name`,
      [g.id, chatId, name]
    );
    return reply(`✅ Ulandi! Endi <b>${esc(g.name)}</b> guruhi davomat hisobotlari shu yerga keladi.\n\nUzish uchun: /stop`);
  }
  if (cmd === '/stop') {
    const r = await pool.query('DELETE FROM group_teachers WHERE chat_id = $1', [chatId]);
    return reply(r.rowCount ? '🔕 Barcha guruhlardan uzildingiz.' : 'Siz hech qaysi guruhga ulanmagansiz.');
  }
  if (cmd === '/start' || cmd === '/help') {
    return reply('👋 Salom! Men <b>Starosta.uz</b> botiman.\nGuruh davomat hisobotlarini olish uchun starosta bergan havolani oching yoki <code>/start KOD</code> yuboring.\n\n/stop — hisobotlarni to\'xtatish');
  }
}

let polling = false;
async function startPolling() {
  if (!TOKEN || polling) return;
  polling = true;
  try {
    await tg('deleteWebhook', { drop_pending_updates: false });
    const me = await getBotInfo();
    console.log(`🤖 Telegram bot ishga tushdi: @${me.username}`);
  } catch (e) {
    console.error('Telegram bot ishga tushmadi:', e.message);
  }
  let offset = 0;
  (async () => {
    while (polling) {
      try {
        const updates = await tg('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] });
        for (const u of updates) {
          offset = u.update_id + 1;
          try { await handleMessage(u.message); } catch (e) { console.error('Bot xabarini qayta ishlashda xatolik:', e.message); }
        }
      } catch (e) {
        console.error('Telegram polling:', e.message);
        await sleep(5000);
      }
    }
  })();
}

module.exports = { enabled, tg, getBotInfo, buildReport, sendAttendanceReport, startPolling, newLinkCode, log, DEFAULT_CHANNEL, esc };
