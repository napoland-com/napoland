-- Home: the stash and XP. What each player keeps in the chest at home (and what they took out of it,
-- which earns nothing when it goes back in), and their XP, from which the level follows.
-- Only new columns with defaults: the previous release, which knows nothing of either, keeps working
-- on this schema if a release rolls back (it never reads them, and its new players get the defaults).
ALTER TABLE players ADD COLUMN xp integer NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN stash jsonb NOT NULL DEFAULT '{"items": {}, "out": {}}';
