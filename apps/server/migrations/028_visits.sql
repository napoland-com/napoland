-- Visits to your neighbors' cabins (world.ts, streets): whether a player keeps their neighbors out of their
-- cabin (the setting in the menu; false: neighbors may walk in to look, as for everyone until they choose;
-- friends come in either way). Only a new column with a default: the previous release keeps working on this
-- schema, and never reads or writes it.
ALTER TABLE players ADD COLUMN visits_off boolean NOT NULL DEFAULT false;
