-- A new player's first steps (roadmap/first-steps.md): the step to take now, 1 to 3; null once done, and for
-- everyone who played before first steps came. Only adds: the previous release never reads it.
ALTER TABLE players ADD COLUMN first_steps smallint;
