-- The pieces of each torn paper map a player found (packages/shared/src/items.ts, FindRule.piece): the map's
-- item id to the quarters found, e.g. {"burn-map": [0, 3]}. A map they own whole (found before it was torn, or
-- given) is not listed. Null, the default: none found. Only a new column that may be null: the previous
-- release keeps working on this schema, and never reads or writes it.
ALTER TABLE players ADD COLUMN charts jsonb;
