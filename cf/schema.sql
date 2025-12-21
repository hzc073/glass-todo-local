-- D1 schema for Glass Todo
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  password TEXT NOT NULL,
  is_admin INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS data (
  username TEXT PRIMARY KEY,
  json_data TEXT NOT NULL,
  version INTEGER NOT NULL,
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  expiration_time INTEGER,
  created_at INTEGER,
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pomodoro_settings (
  username TEXT PRIMARY KEY,
  work_min INTEGER NOT NULL,
  short_break_min INTEGER NOT NULL,
  long_break_min INTEGER NOT NULL,
  long_break_every INTEGER NOT NULL,
  auto_start_next INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pomodoro_state (
  username TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  remaining_ms INTEGER NOT NULL,
  is_running INTEGER NOT NULL,
  target_end INTEGER,
  cycle_count INTEGER NOT NULL DEFAULT 0,
  current_task_id INTEGER,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pomodoro_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  task_id INTEGER,
  task_title TEXT,
  started_at INTEGER,
  ended_at INTEGER NOT NULL,
  duration_min INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pomodoro_daily_stats (
  username TEXT NOT NULL,
  date_key TEXT NOT NULL,
  work_sessions INTEGER NOT NULL DEFAULT 0,
  work_minutes INTEGER NOT NULL DEFAULT 0,
  break_minutes INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (username, date_key),
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_data_username ON data(username);
CREATE INDEX IF NOT EXISTS idx_push_username ON push_subscriptions(username);
CREATE INDEX IF NOT EXISTS idx_pomodoro_sessions_user_time ON pomodoro_sessions(username, ended_at);
CREATE INDEX IF NOT EXISTS idx_pomodoro_daily_user_date ON pomodoro_daily_stats(username, date_key);
