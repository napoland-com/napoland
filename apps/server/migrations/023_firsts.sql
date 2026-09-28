-- First finders: the first player on the server to find each secret (packages/shared/src/firsts.ts: a
-- note read in its time, a keepsake picked up), kept with it and shown to everyone: which secret, who,
-- on which of the Zone's days and when. Only the first is ever kept (the secret is the key), and the
-- player's row takes theirs with it (a guest who stayed away): the secret waits for a new first finder.
CREATE TABLE firsts (
  secret   text PRIMARY KEY,
  player   uuid NOT NULL REFERENCES players (id) ON DELETE CASCADE,
  day      integer NOT NULL,
  found_at timestamptz NOT NULL
);
CREATE INDEX firsts_player_key ON firsts (player);

-- Only a new table: the previous release keeps working on this schema if a release rolls back (it
-- never reads it, and nobody is anybody's first finder there).
