-- Vidcom v4 schema
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS experiences (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  qr_id TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pairs (
  id TEXT PRIMARY KEY,
  experience_id TEXT NOT NULL,
  image_asset_id TEXT NOT NULL,
  video_asset_id TEXT NOT NULL,
  image_fingerprint TEXT NOT NULL,
  threshold REAL NOT NULL,
  priority INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (experience_id) REFERENCES experiences(id),
  FOREIGN KEY (image_asset_id) REFERENCES assets(id),
  FOREIGN KEY (video_asset_id) REFERENCES assets(id)
);

CREATE INDEX IF NOT EXISTS idx_pairs_experience ON pairs(experience_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
