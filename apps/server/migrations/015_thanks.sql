-- Thanks, and while you were away. Whoever warms at a fire someone fed, or follows someone's arrow, can
-- thank them once a UTC day. Kept for 7 days (the server deletes older ones), for that rule and for the
-- letter the helper reads when they come home: who thanked whom, the day (one row per giver, helper and
-- day), when, for what, and whether the helper was told already. Both players' rows take theirs with them.
CREATE TABLE thanks (
  giver  uuid NOT NULL REFERENCES players (id) ON DELETE CASCADE,
  helper uuid NOT NULL REFERENCES players (id) ON DELETE CASCADE,
  day    integer NOT NULL,
  at     timestamptz NOT NULL,
  what   jsonb NOT NULL,
  told   boolean NOT NULL DEFAULT false,
  PRIMARY KEY (giver, helper, day)
);
CREATE INDEX thanks_helper_key ON thanks (helper);
CREATE INDEX thanks_at_key ON thanks (at);

-- Thanks received, toward the Good neighbor feat. Others add to it, often while its owner is offline,
-- so it is a column of its own that only ever grows by one (UPDATE ... thanked + 1), and the save of a
-- whole player (the stats jsonb and the rest) never writes it.
ALTER TABLE players ADD COLUMN thanked integer NOT NULL DEFAULT 0;

-- A good neighbor's arrows last longer than a day: when each one fades. Null for arrows painted by a
-- release before this one, which fade a day after placed_at as they always did.
ALTER TABLE marks ADD COLUMN fades_at timestamptz;

-- Only additions: the previous release keeps working on this schema if a release rolls back (it never
-- reads the new table or columns, and fades every arrow a day after it was painted, as it always did).
