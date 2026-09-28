-- Tools each player owns and keeps (the paper maps, and later tools made at the workbench or found): a
-- list of item ids, in the order they got them. Null for a player who never got one of their own: they
-- carry the starter tools (a map of every area there is), and the first tool they get writes the whole
-- list. A save never sets it back to null, so nothing takes a tool away. Tools never go into the bag, a
-- pile or the stash. Only a new column without a default: the previous release keeps working on this
-- schema (it never reads it, and gives everyone the starter tools as before).
ALTER TABLE players ADD COLUMN tools jsonb;
