-- Sign-in: a character belongs to whoever signs in with it. auth_sub is who that is: Supabase's user
-- id (the access token's sub), or "dev:" and an email in development. It stays empty for characters
-- made before sign-in until someone claims one by signing in on the browser that made it; each
-- identity has at most one character.
-- Characters made after sign-in have no token of their own, so token_hash may be empty now.
-- Only a new column and a looser rule: the previous release, which knows nothing of sign-in, keeps
-- working on this schema if a release rolls back (it always sets token_hash, finds players only by
-- it, and never touches auth_sub).
ALTER TABLE players ADD COLUMN auth_sub text UNIQUE;
ALTER TABLE players ALTER COLUMN token_hash DROP NOT NULL;
