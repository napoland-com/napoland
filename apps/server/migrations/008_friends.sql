-- Friends, friend requests and blocks: one row per link. A friendship is two rows (one each way),
-- a request one row from who asked to who was asked, a block one row from who blocks to who is
-- blocked. Only new tables and a new column with a default: the previous release keeps working on
-- this schema if a release rolls back (it never reads them).
CREATE TABLE links (
  player uuid NOT NULL REFERENCES players (id) ON DELETE CASCADE,
  other  uuid NOT NULL REFERENCES players (id) ON DELETE CASCADE,
  kind   text NOT NULL CHECK (kind IN ('friend', 'request', 'block')),
  since  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player, other, kind)
);
CREATE INDEX links_other_key ON links (other);

-- Private messages between friends, kept until read: reading one deletes it.
CREATE TABLE tells (
  id        bigserial PRIMARY KEY,
  sender    uuid NOT NULL REFERENCES players (id) ON DELETE CASCADE,
  recipient uuid NOT NULL REFERENCES players (id) ON DELETE CASCADE,
  body      text NOT NULL,
  sent_at   timestamptz NOT NULL
);
CREATE INDEX tells_recipient_key ON tells (recipient, id);

-- Reports for the maintainers to read: who reported whom, why, and what was written as the
-- reporter quoted it (the server keeps no messages once read, so it cannot check the quote).
CREATE TABLE reports (
  id       bigserial PRIMARY KEY,
  reporter uuid REFERENCES players (id) ON DELETE SET NULL,
  reported uuid REFERENCES players (id) ON DELETE SET NULL,
  reason   text NOT NULL,
  quote    text,
  made_at  timestamptz NOT NULL
);

-- The setting that turns friend requests off.
ALTER TABLE players ADD COLUMN requests_off boolean NOT NULL DEFAULT false;
