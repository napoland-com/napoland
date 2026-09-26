-- The world is several maps now, and players have energy that drains in the wilds.
-- Only new columns with defaults: the previous release, which knows nothing of either, keeps
-- working on this schema if a release rolls back (its new players get the defaults).
ALTER TABLE players ADD COLUMN map text NOT NULL DEFAULT 'stonebrook';
ALTER TABLE players ADD COLUMN energy real NOT NULL DEFAULT 100;
