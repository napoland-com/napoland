-- What people left behind (packages/shared/src/notes.ts): the notes each player read and the keepsakes
-- they brought home, each a list of ids in the order they came. Null, the default: nothing yet. Both
-- only ever grow, and a save that carries none leaves them as they are.
-- Only new columns: the previous release keeps working on this schema (it never reads or writes them).
ALTER TABLE players ADD COLUMN notes jsonb;
ALTER TABLE players ADD COLUMN keepsakes jsonb;
