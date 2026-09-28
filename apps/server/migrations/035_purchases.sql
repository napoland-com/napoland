-- The shop for looks (packages/shared/src/shop.ts): a look bought, as Stripe's webhook said it was paid,
-- one row a checkout (Stripe's Checkout Session id is the key, so an event sent twice is kept once). Who
-- bought it, which look, what was paid and in what currency (minor units: 299 is 2.99), Stripe's payment
-- (which a refund names), whether it is still paid or was refunded, and when. Never anything about the
-- card, or who the buyer is at Stripe.
-- A deleted character leaves its purchases without whose they were (ON DELETE SET NULL): the payments
-- stay, as the accounts need them. A player's looks are the looks of their paid purchases, read with them.
CREATE TABLE purchases (
  session        text PRIMARY KEY,
  player         uuid REFERENCES players (id) ON DELETE SET NULL,
  look           text NOT NULL,
  amount         integer NOT NULL,
  currency       text NOT NULL,
  payment_intent text UNIQUE,
  status         text NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'refunded')),
  created        timestamptz NOT NULL,
  refunded       timestamptz
);
CREATE INDEX purchases_player_key ON purchases (player);

-- Only a new table: the previous release keeps working on this schema if a release rolls back (it never
-- reads it; its players simply wear no look from the shop until this release is back).
