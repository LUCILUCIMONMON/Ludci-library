ALTER TABLE attribute_entries
  ADD COLUMN owner_id TEXT REFERENCES profiles(id) ON DELETE CASCADE;
