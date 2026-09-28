-- Your street (world.ts): whether a player keeps their name off their door and their window dark to their
-- neighbors (the setting in the menu; false: both show, as for everyone until they choose), and whether they
-- read the letter that tells them so, the first time they came home since streets came. Only new columns
-- with defaults: the previous release keeps working on this schema, and never reads or writes them.
ALTER TABLE players ADD COLUMN door_off boolean NOT NULL DEFAULT false;
ALTER TABLE players ADD COLUMN street_told boolean NOT NULL DEFAULT false;
