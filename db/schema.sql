-- Starosta.uz — PostgreSQL sxemasi (PostgreSQL 13+)
-- Ishga tushirish: npm run db:init

-- 1) Starostalar (Google akkaunti orqali kirganlar)
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_id     TEXT NOT NULL UNIQUE,
  email         TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  avatar_url    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2) Guruhlar (har bir guruh bitta starostaga tegishli)
CREATE TABLE IF NOT EXISTS groups (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  faculty       TEXT NOT NULL DEFAULT '',
  university    TEXT NOT NULL DEFAULT '',
  starosta_name TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, name)
);
CREATE INDEX IF NOT EXISTS idx_groups_owner ON groups(owner_id);

-- 3) Talabalar
CREATE TABLE IF NOT EXISTS students (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id     UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  full_name    TEXT NOT NULL,
  student_code TEXT NOT NULL,
  phone        TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, student_code)
);
CREATE INDEX IF NOT EXISTS idx_students_group ON students(group_id);

-- 4) Davomat: kun/dars (sessiya) — guruh + sana bo'yicha bitta yozuv
CREATE TABLE IF NOT EXISTS attendance_sessions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  date       DATE NOT NULL,
  lesson     TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, date)
);

-- 5) Davomat: har bir talabaning shu kundagi holati
CREATE TABLE IF NOT EXISTS attendance_records (
  session_id UUID NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  status     TEXT NOT NULL CHECK (status IN ('present','late','excused','absent')),
  note       TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_records_student ON attendance_records(student_id);

-- ====================== v2: Admin panel + Telegram ======================
-- (qayta ishga tushirish xavfsiz: npm run db:init)

-- Admin foydalanuvchini bloklashi mumkin
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN NOT NULL DEFAULT false;

-- Guruh uchun Telegram sozlamalari
ALTER TABLE groups ADD COLUMN IF NOT EXISTS telegram_channel_id TEXT;   -- bo'sh bo'lsa .env dagi TELEGRAM_CHANNEL_ID ishlatiladi
ALTER TABLE groups ADD COLUMN IF NOT EXISTS teacher_link_code  TEXT UNIQUE; -- ustoz botga /start <kod> yuborib ulanadi

-- Guruhga ulangan ustozlar (ularning Telegram chat_id si)
CREATE TABLE IF NOT EXISTS group_teachers (
  id           BIGSERIAL PRIMARY KEY,
  group_id     UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  chat_id      BIGINT NOT NULL,
  teacher_name TEXT NOT NULL DEFAULT '',
  linked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, chat_id)
);

-- Yuborilgan xabarlar (qayta yuborilsa yangisini yozmasdan, mavjudini tahrirlash uchun)
CREATE TABLE IF NOT EXISTS telegram_messages (
  session_id UUID NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  chat_id    TEXT NOT NULL,
  message_id BIGINT NOT NULL,
  PRIMARY KEY (session_id, chat_id)
);

-- Yuborish jurnali (admin panel statistikasi uchun)
CREATE TABLE IF NOT EXISTS telegram_log (
  id         BIGSERIAL PRIMARY KEY,
  group_id   UUID REFERENCES groups(id) ON DELETE SET NULL,
  target     TEXT NOT NULL,           -- 'channel' | 'teacher' | 'test'
  chat_id    TEXT,
  ok         BOOLEAN NOT NULL,
  info       TEXT NOT NULL DEFAULT '', -- sent / edited / xato matni
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tglog_created ON telegram_log(created_at DESC);
