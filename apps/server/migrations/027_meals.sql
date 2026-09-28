-- Cooking at a fire (packages/shared/src/meals.ts): the meals each player ate this trip, a list of item ids
-- in the order eaten. They work until the player comes home into their cabin, or collapses, so they outlast
-- a reconnect or a restart. Null, the default: no meal. Only a new column that may be null: the previous
-- release keeps working on this schema, and never reads or writes it.
ALTER TABLE players ADD COLUMN meals jsonb;
