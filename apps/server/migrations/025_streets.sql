-- Your street and your neighbors (world.ts, streets): where each player's cabin stands, the number of
-- their street (from 1) and their lot on it (from 0). Both null for a player who has not come home since
-- streets came: they are given a lot then. Only new columns that may be null: the previous release keeps
-- working on this schema, and never reads or writes them.
ALTER TABLE players ADD COLUMN street integer;
ALTER TABLE players ADD COLUMN lot smallint;
