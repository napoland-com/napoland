-- Zones: a map can have several copies (world.ts). Each map's main copy is the world everyone shares,
-- '' here; any other copy has a key of its own. A player's row says which copy of their map they are
-- in, so they come back into it if it still makes sense; a pile and a mark say which copy they lie in,
-- since they are only ever found there.
-- Only new columns with defaults: the previous release keeps working on this schema. It never reads
-- them, and what it writes is in the main copy, as the defaults say; only its save over a pile or a mark
-- that lay in another copy keeps that copy's key, so that one stays there until it fades. A key that no
-- longer makes sense for where a player is saved is not followed (world.ts, rejoin).
ALTER TABLE players ADD COLUMN zone text NOT NULL DEFAULT '';
ALTER TABLE drops ADD COLUMN zone text NOT NULL DEFAULT '';
ALTER TABLE marks ADD COLUMN zone text NOT NULL DEFAULT '';
