PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE IF NOT EXISTS "d1_migrations"(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(1,'0001_initial_schema.sql','2026-11-17 15:14:12');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(2,'0002_store_images_in_d1.sql','2026-11-17 16:06:31');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(3,'0003_public_submission_limits.sql','2026-11-18 04:15:16');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(4,'0004_story_graph_and_playlists.sql','2026-11-18 04:34:23');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(5,'0005_story_categories_and_main_story.sql','2026-11-18 05:00:15');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(6,'0006_reusable_story_attributes.sql','2026-11-18 05:17:59');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(7,'0007_publishable_attribute_entries.sql','2026-11-18 05:31:51');
CREATE TABLE profiles (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO "profiles" ("id","email","display_name","created_at","updated_at") VALUES('local-dev-owner','owner@example.test','owner','2026-11-17T15:14:36.008Z','2026-11-18T06:00:13.982Z');
INSERT INTO "profiles" ("id","email","display_name","created_at","updated_at") VALUES('public-contributor','public-contributor@lucimon.invalid','Kontributor publik','2026-11-18T04:15:48.634Z','2026-11-18T06:26:36.241Z');
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
, story_categories_json TEXT NOT NULL DEFAULT '["Canon"]', is_hidden_story INTEGER NOT NULL DEFAULT 0 CHECK (is_hidden_story IN (0, 1)), main_story_id TEXT);
INSERT INTO "articles" ("id","owner_id","slug","title","type","summary","content","visibility","parent_id","image_key","tags_json","created_at","updated_at","story_categories_json","is_hidden_story","main_story_id") VALUES('d971a759-ef0b-401f-aca9-ac9febf060f5','local-dev-owner','fdvfdvfd-0bbc7a85','fdvfdvfd','Catatan','cxcc','<p>xzx z</p>','published',NULL,'','[]','2026-11-18T06:00:13.899Z','2026-11-18T06:00:13.899Z','["Canon"]',0,NULL);
INSERT INTO "articles" ("id","owner_id","slug","title","type","summary","content","visibility","parent_id","image_key","tags_json","created_at","updated_at","story_categories_json","is_hidden_story","main_story_id") VALUES('718425cc-bf32-4b4d-8f29-ecf2caf06700','local-dev-owner','xxzsdc-f7f6a98b','xxzsdc','Catatan','cc','','published',NULL,'','[]','2026-11-18T06:00:13.899Z','2026-11-18T06:00:13.899Z','["Canon"]',0,NULL);
INSERT INTO "articles" ("id","owner_id","slug","title","type","summary","content","visibility","parent_id","image_key","tags_json","created_at","updated_at","story_categories_json","is_hidden_story","main_story_id") VALUES('5375a19d-e6cb-469d-aacb-201c50c2d464','local-dev-owner','cccccc-a318f83c','cccccc','Catatan','c c c','<p>cc  </p>','published',NULL,'','[]','2026-11-18T06:00:13.899Z','2026-11-18T06:00:13.899Z','["Canon"]',0,NULL);
CREATE TABLE article_links (
  source_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL, relation_label TEXT NOT NULL DEFAULT 'terkait',
  PRIMARY KEY (source_id, target_id),
  CHECK (source_id <> target_id)
);
INSERT INTO "article_links" ("source_id","target_id","created_at","relation_label") VALUES('d971a759-ef0b-401f-aca9-ac9febf060f5','5375a19d-e6cb-469d-aacb-201c50c2d464','2026-11-18T06:00:13.899Z','terkait');
INSERT INTO "article_links" ("source_id","target_id","created_at","relation_label") VALUES('d971a759-ef0b-401f-aca9-ac9febf060f5','718425cc-bf32-4b4d-8f29-ecf2caf06700','2026-11-18T06:00:13.899Z','terkait');
INSERT INTO "article_links" ("source_id","target_id","created_at","relation_label") VALUES('718425cc-bf32-4b4d-8f29-ecf2caf06700','5375a19d-e6cb-469d-aacb-201c50c2d464','2026-11-18T06:00:13.899Z','terkait');
CREATE TABLE image_assets (
  key TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at TEXT NOT NULL
, data BLOB);
CREATE TABLE public_submission_limits (
  client_key TEXT PRIMARY KEY NOT NULL,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count > 0)
);
INSERT INTO "public_submission_limits" ("client_key","window_start","request_count") VALUES('f3c629a76da394bc7061b19c6833af16128b44e3f198cb05bf4c3196da40a04b',1794979306,2);
INSERT INTO "public_submission_limits" ("client_key","window_start","request_count") VALUES('12ca17b49af2289436f303e0166030a21e525d266e209267433801a8fd4071a0',1794980437,4);
INSERT INTO "public_submission_limits" ("client_key","window_start","request_count") VALUES('cbb122b02f237b7f492a87395526454c53644791a6bae0ed6e57b0ae0d169696',1794983195,1);
INSERT INTO "public_submission_limits" ("client_key","window_start","request_count") VALUES('4e50f98a756e96ccc6b1d8cabf50cfddc5f3820699a94c24d616875f0d104b24',1794983196,1);
INSERT INTO "public_submission_limits" ("client_key","window_start","request_count") VALUES('5e6a33c158bf94bcb10ee60910b0b2f49c1096160de1bb598142afdf67bbfea2',1794983197,1);
INSERT INTO "public_submission_limits" ("client_key","window_start","request_count") VALUES('08c6a55c53a8487fbed28b12744b84d18e322dc0acf9fbb73b1f1c79cd99e368',1794983197,1);
INSERT INTO "public_submission_limits" ("client_key","window_start","request_count") VALUES('ddc86d3d207a5e00e6db4437da023bfc2d069e31ed440addd0206503d1405625',1794983197,1);
INSERT INTO "public_submission_limits" ("client_key","window_start","request_count") VALUES('35413343c1f2a50e500b0c304f26ee6b167e85adfece20974d553660be5ba1d3',1794983197,1);
CREATE TABLE article_attributes (
  id TEXT PRIMARY KEY NOT NULL,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE playlists (
  id TEXT PRIMARY KEY NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE playlist_items (
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (playlist_id, article_id),
  UNIQUE (playlist_id, position)
);
CREATE TABLE attribute_entries (
  id TEXT PRIMARY KEY NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('Dunia', 'Karakter', 'Alur', 'Tempat', 'Catatan')),
  summary TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
, visibility TEXT NOT NULL DEFAULT 'draft'
  CHECK (visibility IN ('draft', 'published')));
INSERT INTO "attribute_entries" ("id","slug","title","type","summary","content","created_at","updated_at","visibility") VALUES('97d96c74-fc4b-4f05-bb03-f7ebedc2e7bc','ccc-97d96c74','ccc','Karakter','vv','<p>cc</p>','2026-11-18T05:40:37.265Z','2026-11-18T06:00:13.899Z','published');
CREATE TABLE story_attribute_links (
  story_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  attribute_id TEXT NOT NULL REFERENCES attribute_entries(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (story_id, attribute_id)
);
INSERT INTO "story_attribute_links" ("story_id","attribute_id","created_at") VALUES('718425cc-bf32-4b4d-8f29-ecf2caf06700','97d96c74-fc4b-4f05-bb03-f7ebedc2e7bc','2026-11-18T06:00:13.899Z');
DELETE FROM sqlite_sequence;
INSERT INTO "sqlite_sequence" ("name","seq") VALUES('d1_migrations',7);
CREATE INDEX articles_owner_updated_idx ON articles(owner_id, updated_at DESC);
CREATE INDEX articles_public_slug_idx ON articles(visibility, slug);
CREATE INDEX articles_parent_idx ON articles(parent_id);
CREATE INDEX article_links_target_idx ON article_links(target_id);
CREATE INDEX image_assets_owner_idx ON image_assets(owner_id);
CREATE INDEX article_attributes_lookup_idx ON article_attributes(name, value, article_id);
CREATE INDEX playlist_items_article_idx ON playlist_items(article_id);
CREATE INDEX articles_main_story_idx ON articles(main_story_id);
CREATE INDEX story_attribute_links_attribute_idx ON story_attribute_links(attribute_id, story_id);