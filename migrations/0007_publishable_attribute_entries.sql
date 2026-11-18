ALTER TABLE attribute_entries
  ADD COLUMN visibility TEXT NOT NULL DEFAULT 'draft'
  CHECK (visibility IN ('draft', 'published'));

UPDATE attribute_entries
SET visibility = 'published'
WHERE EXISTS (
  SELECT 1
  FROM story_attribute_links l
  JOIN articles s ON s.id = l.story_id
  WHERE l.attribute_id = attribute_entries.id
    AND s.visibility = 'published'
);
