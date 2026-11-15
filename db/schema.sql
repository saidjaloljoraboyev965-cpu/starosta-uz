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
