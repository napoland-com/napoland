-- Equipment: what each player wears, by slot. Null for a player who never chose: they wear the
-- starter gear (worn clothes and a backpack), which the game fills in when they join.
-- Only a new column without a default: the previous release, which knows nothing of gear, keeps
-- working on this schema if a release rolls back (it never reads it).
ALTER TABLE players ADD COLUMN gear jsonb;
