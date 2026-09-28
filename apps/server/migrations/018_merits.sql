-- Past level 20, merits (packages/shared/src/merits.ts): every 1,500 XP past level 20's earns one, and
-- merits buy looks others see. How many a player earned follows from their XP, so only this is kept: the
-- merits they spent, the looks they bought (a jsonb list of ids, in the order they bought them; null:
-- none), and the jacket pattern and the name tag badge they wear (null, the default: none).
-- Only new columns, with a default where it needs one: the previous release keeps working on this schema
-- (it never reads them, and its saves leave them as they are).
ALTER TABLE players ADD COLUMN merits_spent integer NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN looks jsonb;
ALTER TABLE players ADD COLUMN pattern text;
ALTER TABLE players ADD COLUMN badge text;
