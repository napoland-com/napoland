-- A parcel a day (content/items.json, `parcels`): what the server keeps of each player to give them the
-- right one. Whether they had their welcome parcel; the calendar day of their last parcel (days since
-- 1970-01-01, UTC; null until the first); and the days of that day's week they came back on, one bit
-- each, Monday the lowest. Only new columns with defaults: the previous release keeps working on this
-- schema (it never reads them, and its new players get the defaults: a welcome parcel waits for them
-- once this release runs again).
ALTER TABLE players ADD COLUMN parcel_welcome boolean NOT NULL DEFAULT false;
ALTER TABLE players ADD COLUMN parcel_day integer;
ALTER TABLE players ADD COLUMN parcel_days smallint NOT NULL DEFAULT 0;
