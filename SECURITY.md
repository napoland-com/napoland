# Security

napoland is a live online game with real players at https://www.napoland.com, so security problems matter. Thank you for looking, and for telling us first.

## Report it privately

Use GitHub's private vulnerability reporting: open the **Security** tab of this repository and choose **Report a vulnerability**, or go straight to https://github.com/napoland-com/napoland/security/advisories/new. Only you and the maintainers can see the report.

Please **do not** report a security problem in a public issue, a pull request, a discussion or a chat.

Tell us:

- what the problem is, and what someone could do with it;
- how to make it happen, on a local copy (see below);
- the commit you looked at, and, if it concerns the live game, the `version` shown at https://www.napoland.com/health.

We will confirm that we got your report, keep you posted in the advisory while we fix it, and credit you when the fix is out, if you want to be credited. Please give us a reasonable time to fix it before you tell anyone else.

A secret (a key, a password, a token) that you find in this repository or its history counts too: report it the same way.

## What is in scope

- **The game server** (`apps/server`, and the protocol checks in `packages/shared`): anything that lets a player act as someone else, break the game's rules (walk through walls, pick up what is not there, get items twice), read what they should not, or take the server down with little effort.
- **Sign-in and accounts**: login tokens, sign-in, sessions, and anything that lets someone take over a character or an account.
- **The client** (`apps/client`): anything that runs code or shows something harmful to other players (for example through names, signs or chat), or leaks a player's login.
- **This repository's automation** (`.github/workflows`, `tools/deploy.mjs`, `deploy/`, `infra/`), when you can show the problem by reading it: for example a workflow that could run a pull request's code with write access, or reach production.

## What is not

- Services we use (GitHub, AWS, Google, Apple, Supabase): report problems in those to them.
- Load tests and denial of service against the live game, spam, social engineering, and anything physical.
- Reports from automated scanners that do not show a real problem.

## Test on your own copy, never on production

Run napoland on your own computer (`npm run dev`, or `docker compose up -d --build` for the full stack with PostgreSQL; see the [README](README.md)) and test there. Against www.napoland.com: no load tests, no exploits, no scanners or fuzzers, no bots, and never touch other players' characters or data. Playing normally is fine. If you run into a problem by accident while playing, stop there and report it.

## Supported versions

Only what runs at www.napoland.com (the latest `main`) gets security fixes.
