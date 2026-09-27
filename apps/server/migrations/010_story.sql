-- The story (content/story.json): the id of the latest chapter each player reached. Null for a player
-- who never started it: they are in the first chapter. An id the server's story does not have comes
-- from a newer release; it is kept as it is. Only a new column without a default: the previous
-- release keeps working on this schema.
ALTER TABLE players ADD COLUMN story text;
