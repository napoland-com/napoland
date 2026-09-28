-- A cozy cabin (comfort.ts): the furniture each player made for their own cabin, as a list of item ids
-- (null: nothing made yet), and until when they are cozy from standing by their own fire (null: they are
-- not). Only new columns that may be null: the previous release keeps working on this schema, and never
-- reads or writes them.
ALTER TABLE players ADD COLUMN furniture jsonb;
ALTER TABLE players ADD COLUMN cozy_until timestamptz;
