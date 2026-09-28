-- Outfits (packages/shared/src/outfits.ts): the id of the outfit each player's character wears over
-- their gear. Null, the default: none, their gear shows. Which outfits a player may wear follows from
-- their level and from signing in, so nothing else is kept.
-- Only a new column: the previous release keeps working on this schema (it never reads it).
ALTER TABLE players ADD COLUMN outfit text;
