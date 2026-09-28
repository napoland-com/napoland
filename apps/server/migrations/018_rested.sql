-- Rested while away (packages/shared/src/progress.ts): the cup of rest each player saved up, in XP.
-- Time away fills it when the player arrives, from last_seen_at (one XP every 20 minutes, three days'
-- worth at most: 216), and stashing spends it, earning as much again. 0, the default: empty.
-- Only a new column with a default: the previous release keeps working on this schema (it never reads
-- it, and its saves leave it as it is).
ALTER TABLE players ADD COLUMN rested integer NOT NULL DEFAULT 0;
