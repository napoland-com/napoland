-- Gear piece by piece: the condition and quirk of what each player wears, by slot. Null for a player
-- who has worn nothing since pieces existed: their gear is as good as new, and the game fills it in
-- when they join. The stash keeps counting gear in `stash.items` as before, with the pieces' details
-- next to them (`stash.pieces`), so a release that knows no pieces still reads every stash right.
-- Only a new column without a default: the previous release keeps working on this schema.
ALTER TABLE players ADD COLUMN worn jsonb;
