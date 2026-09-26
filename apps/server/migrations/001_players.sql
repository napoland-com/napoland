-- One row per player. Only the SHA-256 of the login token is stored, never the token.
CREATE TABLE players (
  id           uuid PRIMARY KEY,
  name         text NOT NULL,
  token_hash   text NOT NULL,
  x            integer NOT NULL,
  y            integer NOT NULL,
  dir          text NOT NULL CHECK (dir IN ('up', 'down', 'left', 'right')),
  color        text NOT NULL,
  created_at   timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL
);

-- "Aldo" and "aldo" are the same name.
CREATE UNIQUE INDEX players_name_lower_key ON players (lower(name));
CREATE UNIQUE INDEX players_token_hash_key ON players (token_hash);
