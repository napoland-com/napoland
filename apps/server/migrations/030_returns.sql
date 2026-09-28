-- Carry a stranger's pile home (lostfound.ts). Whoever finds someone else's pile may carry all of it to
-- the lost and found box in Stonebrook Lodge, where it goes into its owner's chest, online or not. What
-- came back, one row a bundle (each comes back once): whose it is, who carried it (their name kept for
-- the letter if they are gone), where it was lost, what it held, the XP the carrier got for it, when, and
-- whether the owner was told. The ids go up in the order things come back.
CREATE TABLE returns (
  id           bigint PRIMARY KEY,
  bundle       text NOT NULL UNIQUE,
  owner        uuid NOT NULL REFERENCES players (id) ON DELETE CASCADE,
  carrier      uuid REFERENCES players (id) ON DELETE SET NULL,
  carrier_name text NOT NULL,
  map          text NOT NULL,
  x            integer NOT NULL,
  y            integer NOT NULL,
  items        jsonb NOT NULL,
  xp           integer NOT NULL,
  at           timestamptz NOT NULL,
  told         boolean NOT NULL DEFAULT false
);
CREATE INDEX returns_owner_key ON returns (owner);

-- Up to which of those the player's stash holds already, saved in the same row as the stash, so nothing
-- that came back goes into a chest twice (or never), whatever write is lost around it.
ALTER TABLE players ADD COLUMN returned bigint NOT NULL DEFAULT 0;

-- Of each item in a pile, how many its owner had taken out of their stash as they collapsed: carried back,
-- those earn nobody XP. Null for a pile of an older release: all of it counts so.
ALTER TABLE drops ADD COLUMN owed jsonb;

-- Only additions: the previous release keeps working on this schema if a release rolls back (it never
-- reads the new table or columns, and leaves `returned` as it is when it saves a player).
