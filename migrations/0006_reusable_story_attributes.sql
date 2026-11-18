CREATE TABLE attribute_entries (
  id TEXT PRIMARY KEY NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('Dunia', 'Karakter', 'Alur', 'Tempat', 'Catatan')),
  summary TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE story_attribute_links (
  story_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  attribute_id TEXT NOT NULL REFERENCES attribute_entries(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (story_id, attribute_id)
);

CREATE INDEX story_attribute_links_attribute_idx ON story_attribute_links(attribute_id, story_id);

CREATE TABLE attribute_migration_map (
  legacy_name TEXT NOT NULL,
  legacy_value TEXT NOT NULL,
  attribute_id TEXT NOT NULL UNIQUE,
  PRIMARY KEY (legacy_name, legacy_value)
);

INSERT INTO attribute_migration_map (legacy_name, legacy_value, attribute_id)
SELECT name, value, 'legacy-' || lower(hex(randomblob(16)))
FROM article_attributes
GROUP BY name, value;

INSERT INTO attribute_entries (
  id, slug, title, type, summary, content, created_at, updated_at
)
SELECT map.attribute_id, map.attribute_id, map.legacy_value, 'Catatan',
  'Atribut lama: ' || map.legacy_name, '', MIN(old.created_at), MAX(old.created_at)
FROM attribute_migration_map map
JOIN article_attributes old
  ON old.name = map.legacy_name AND old.value = map.legacy_value
GROUP BY map.attribute_id, map.legacy_name, map.legacy_value;

INSERT OR IGNORE INTO story_attribute_links (story_id, attribute_id, created_at)
SELECT old.article_id, map.attribute_id, old.created_at
FROM article_attributes old
JOIN attribute_migration_map map
  ON map.legacy_name = old.name AND map.legacy_value = old.value;

DROP TABLE attribute_migration_map;
