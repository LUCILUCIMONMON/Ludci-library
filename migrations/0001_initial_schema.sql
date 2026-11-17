CREATE TABLE profiles (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE articles (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('Dunia', 'Karakter', 'Alur', 'Tempat', 'Catatan')),
  summary TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'draft' CHECK (visibility IN ('draft', 'published')),
  parent_id TEXT REFERENCES articles(id) ON DELETE SET NULL,
  image_key TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE article_links (
  source_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (source_id, target_id),
  CHECK (source_id <> target_id)
);

CREATE TABLE image_assets (
  key TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX articles_owner_updated_idx ON articles(owner_id, updated_at DESC);
CREATE INDEX articles_public_slug_idx ON articles(visibility, slug);
CREATE INDEX articles_parent_idx ON articles(parent_id);
CREATE INDEX article_links_target_idx ON article_links(target_id);
CREATE INDEX image_assets_owner_idx ON image_assets(owner_id);
