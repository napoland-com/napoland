-- A crate for whoever comes next: each place out there where people rest by a fire keeps one, and
-- anyone can leave a thing in it and take one out. What lies in each crate, one row a thing (a crate
-- holds 6 at most): the crate (its map and tile), the item, who left it and when. It stays until someone
-- takes it; whoever left it takes theirs with them if their row goes (a guest who stayed away). The
-- server hands out the ids.
CREATE TABLE cache_items (
  id      bigint PRIMARY KEY,
  map     text NOT NULL,
  x       integer NOT NULL,
  y       integer NOT NULL,
  item    text NOT NULL,
  owner   uuid NOT NULL REFERENCES players (id) ON DELETE CASCADE,
  left_at timestamptz NOT NULL
);
CREATE INDEX cache_items_owner_key ON cache_items (owner);

-- Only a new table: the previous release keeps working on this schema if a release rolls back (it
-- never reads it, and its players simply find no crates).
