-- Play first, sign in to keep it: on a server with sign-in, a first visit plays at once as a guest, a
-- character nobody has signed in with (auth_sub is empty) whose token lives in the browser that made
-- it. A guest who has not played for 30 days is deleted, with their pile and marks (their rows go with
-- the player's). last_seen_at (001_players.sql) already says when each player last played: every save
-- sets it. The server looks for such guests at start-up and once a day; this index keeps that cheap
-- however many players there are.
-- Only a new index: the previous release keeps working on this schema.
CREATE INDEX players_guests_last_seen ON players (last_seen_at) WHERE auth_sub IS NULL;
