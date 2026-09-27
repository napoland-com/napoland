-- Finds and the bag: what each player carries, and the piles dropped when someone collapses.
-- Only additions: the previous release, which knows nothing of either, keeps working on this schema
-- if a release rolls back (it never reads the bag, its new players get an empty one, and it never
-- touches drops).
ALTER TABLE players ADD COLUMN bag jsonb NOT NULL DEFAULT '[]';

-- At most one pile per player: what they carried when they last collapsed, where they fell. It fades
-- an hour after dropped_at; the server forgets older rows when it starts.
CREATE TABLE drops (
  owner      uuid PRIMARY KEY REFERENCES players (id) ON DELETE CASCADE,
  map        text NOT NULL,
  x          integer NOT NULL,
  y          integer NOT NULL,
  items      jsonb NOT NULL,
  dropped_at timestamptz NOT NULL
);
