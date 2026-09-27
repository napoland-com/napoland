-- What wears you down out there, and what the world remembers between restarts. Only additions: the
-- previous release, which knows nothing of any of it, keeps working on this schema if a release rolls
-- back (it never reads the new columns, its new players get the defaults, and it never touches the new tables).

-- How wet each player is (0 dry to 1 soaked), and what counts toward their feats.
ALTER TABLE players ADD COLUMN wet real NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN stats jsonb NOT NULL DEFAULT '{}';

-- The last steps someone walked before they collapsed: their echo walks them, back to the pile.
ALTER TABLE drops ADD COLUMN trail jsonb NOT NULL DEFAULT '[]';

-- Arrows painted on the ground. A few per player; they fade a day after placed_at, and the server
-- forgets older rows when it starts. The server hands out the ids.
CREATE TABLE marks (
  id        bigint PRIMARY KEY,
  owner     uuid NOT NULL REFERENCES players (id) ON DELETE CASCADE,
  map       text NOT NULL,
  x         integer NOT NULL,
  y         integer NOT NULL,
  dir       text NOT NULL CHECK (dir IN ('up', 'down', 'left', 'right')),
  placed_at timestamptz NOT NULL
);

-- Things the whole world shares that must outlive a restart, one row each (the Old Stone: 'stone').
CREATE TABLE world_state (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);
