-- Homes in gardens of their own, built up at the workbench (roadmap/home-lots.md, packages/shared/src/house.ts):
-- how far each player's house is built (null, the default: the garage every house starts as), and whether they
-- read the letter about home in its own garden (false: not yet). Streets are no more, but street, lot, door_off
-- and street_told stay as they were: only new columns with defaults, so the previous release keeps working on
-- this schema, and never reads or writes them.
ALTER TABLE players ADD COLUMN house smallint;
ALTER TABLE players ADD COLUMN home_told boolean NOT NULL DEFAULT false;
