-- The field notes (packages/shared/src/notebook.ts): the pages of each player's notebook that opened,
-- and the blanks on them that filled in, as {"pages": [ids], "blanks": [ids]} in the order they came.
-- Null, the default: nothing yet. It only ever grows, and a save that carries none leaves it as it is.
-- Only a new column: the previous release keeps working on this schema (it never reads or writes it).
ALTER TABLE players ADD COLUMN notebook jsonb;
