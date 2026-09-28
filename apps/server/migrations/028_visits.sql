-- Visiting your neighbors (world.ts, visits): whether a player lets only friends walk into their cabin (the
-- setting in the menu; false: their neighbors may, as for everyone until they choose). Only a new column
-- with a default: the previous release keeps working on this schema, and never reads or writes it.
ALTER TABLE players ADD COLUMN visits_off boolean NOT NULL DEFAULT false;
