-- The setting that turns trade requests off (face-to-face exchange), beside the one for friend
-- requests. Only a new column with a default: the previous release keeps working on this schema if a
-- release rolls back (it never reads it).
ALTER TABLE players ADD COLUMN trades_off boolean NOT NULL DEFAULT false;
