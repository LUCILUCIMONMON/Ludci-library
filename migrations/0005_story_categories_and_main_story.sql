ALTER TABLE articles ADD COLUMN story_categories_json TEXT NOT NULL DEFAULT '["Canon"]';
ALTER TABLE articles ADD COLUMN is_hidden_story INTEGER NOT NULL DEFAULT 0 CHECK (is_hidden_story IN (0, 1));
ALTER TABLE articles ADD COLUMN main_story_id TEXT;

CREATE INDEX articles_main_story_idx ON articles(main_story_id);
