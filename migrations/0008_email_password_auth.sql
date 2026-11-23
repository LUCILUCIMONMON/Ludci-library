ALTER TABLE profiles
  ADD COLUMN role TEXT NOT NULL DEFAULT 'editor'
  CHECK (role IN ('owner', 'editor'));

ALTER TABLE profiles ADD COLUMN password_salt TEXT;
ALTER TABLE profiles ADD COLUMN password_hash TEXT;

CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX auth_sessions_expiry_idx ON auth_sessions(expires_at);

CREATE TABLE auth_rate_limits (
  key TEXT PRIMARY KEY NOT NULL,
  attempts INTEGER NOT NULL,
  window_started_at TEXT NOT NULL
);
