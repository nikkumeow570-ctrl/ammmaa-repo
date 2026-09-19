-- Ammmaa database schema (Cloudflare D1).
-- Apply once with: npm run db:init   (or paste into the D1 console in the Cloudflare dashboard)
CREATE TABLE IF NOT EXISTS subs (
  id          TEXT PRIMARY KEY,
  token_hash  TEXT NOT NULL,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  tz          TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  settings    TEXT NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL,
  last_test   INTEGER NOT NULL DEFAULT 0,
  sent_day    TEXT NOT NULL DEFAULT '',
  sent_count  INTEGER NOT NULL DEFAULT 0,
  fail_count  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS slots (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sub_id      TEXT NOT NULL,
  kind        TEXT NOT NULL,
  local_time  TEXT,
  dow         INTEGER,
  once        INTEGER NOT NULL DEFAULT 0,
  next_due    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_slots_due ON slots(next_due);
CREATE INDEX IF NOT EXISTS idx_slots_sub ON slots(sub_id);

CREATE TABLE IF NOT EXISTS ai_lines (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  lang        TEXT NOT NULL,
  tone        TEXT NOT NULL,
  kind        TEXT NOT NULL,
  text        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_lines ON ai_lines(lang, tone, kind);
