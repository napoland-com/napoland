-- How the trip went: each player's best trips (the farthest, the longest in seconds, the most XP brought
-- home), as jsonb (null: no trip yet). Only a new column that may be null: the previous release keeps
-- working on this schema, and never reads or writes it.
ALTER TABLE players ADD COLUMN bests jsonb;
