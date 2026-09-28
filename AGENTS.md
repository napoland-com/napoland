# AGENTS.md

The guide for AI coding agents working on napoland (Codex, Cursor, Copilot, Gemini CLI, Aider, Claude Code and others). Read it at the start of every session. People: see [CONTRIBUTING.md](CONTRIBUTING.md).

napoland is a mobile-first online exploration game in the browser: leave home, gather what glows, get back before your energy runs out. One TypeScript codebase: a three.js web client and an authoritative Node server that decides everything.

## Commands

| | |
|---|---|
| Install | `npm install` (Node 24, npm workspaces) |
| Run | `npm run dev`: server on :8080 (in memory), client on http://localhost:5173 with hot reload. Sign-in is dev mode (`AUTH_MODE=dev`): any email, no code, so every tab can be another player. `GAME_SERVER=localhost:8097` points the client at another server. |
| Check everything | `npm run check`: types, content, roadmap, all tests. Must pass before every push. |
| Tests | `npm test` (Vitest). The PostgreSQL tests run only when `DATABASE_URL_TEST` is set. |
| Content | `npm run validate`: every map, how the maps join up, the items |
| Generated maps | `npm run gen` (runs `gen:map`, `gen:woods`, `gen:south`, `gen:interiors` in that order), then `npm run validate` |
| Roadmap | `npm run roadmap`: checks `roadmap/*.md` and prints the roadmap in order |
| Test players | `npm run bot -- --count 3 --steps 30`, against a running dev server |
| Full stack | `cp .env.example .env`, then `docker compose up -d --build`, then http://localhost:8080 |

## How it is built

- `packages/shared`: the contract both sides run. Maps (`TileMap`), movement (`STEP_MS`, `findPath`), energy and what wears you down (`energy.ts`), the day, surges, storms and flashes (`sky.ts`), feats (`feats.ts`), the stash, XP and levels (`progress.ts`), equipment (`gear.ts`), the story's chapters (`story.ts`), items, the protocol (zod schemas for every client message), content validation.
- `apps/server`: `world.ts` (the rules, no I/O), `fires.ts` (fires burning down), `net.ts` (WebSocket sessions, the hello, limits), `auth.ts` (who is signing in: legacy, dev or Supabase), `http.ts` (health, `/auth-config`, the static client), `social.ts` (friends, requests, blocks, private messages and reports), `chat.ts` (world and local chat), `storage.ts` (memory or PostgreSQL), `migrations/`.
- `apps/client`: `game.ts` (state and prediction), `hud.ts` (interface), `status.ts` (the status panel and banners), `friends.ts` (the friends panel), `journal.ts` (the journal panel), `view/` (three.js world; `wilds.ts` for marks, watchers, flares, flashes, echoes; `napo.ts` for NAPO's buildings, signs and masts), `net.ts`, `signin.ts` (the sign-in cards), `supabase.ts` (Supabase Auth, loaded only in that mode), `about.ts` (the About panel and the sign-in small print), `papermap.ts` (the hand-drawn paper map).
- `content/`: maps, items and the story's chapters as JSON. `tools/`: generators, validators, test bots. `roadmap/`: one file per roadmap item.
- Before changing behavior, read [docs/DESIGN.md](docs/DESIGN.md) (what the game is and why; its pillars) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (how it works).

## Rules

1. **The server decides everything.** Clients send intentions (step, face, pick up); the server checks them and tells everyone. Never trust a client message: parse every one with the zod schemas in `packages/shared/src/protocol.ts`.
2. **`packages/shared` is the contract.** Change it on purpose, bump `PROTOCOL_VERSION` when old clients would break, and update client, server and tests in the same change.
3. **Migrations only add.** A database change is a new numbered file in `apps/server/migrations`: new tables, new columns with defaults, so the previous release still runs on it. Never edit a migration that is on `main`.
4. **Content is data.** Prefer changing `content/` over code. Generated maps (Stonebrook, the Near Woods, the South Road, every room) are never edited by hand: change the generator in `tools/`, run `npm run gen`, commit both. When a map, `content/items.json` or `content/story.json` changes, bump its `version`. Story chapters are only ever added, at the end: never remove, rename or reorder one.
5. **Tests come with changes.** Game rules: unit tests. Server behavior: tests over real WebSockets in `apps/server/test`. Client logic without a browser: `apps/client/test`. Tools: `tools/test`.
6. **Every screen shape works.** HUD sizes come from the screen's short side (container query units), controls stay in the thumb corners, nothing forces an orientation. Check portrait and landscape.
7. TypeScript strict, ESM, imports without extensions. Comments explain why, not what. Plain words in UI text and docs.
8. `apps/server/src` is bundled to CommonJS by esbuild: no `import.meta` and no top-level await there.
9. Secrets never go in the repository. `.env` is git-ignored; tokens are stored hashed and never logged. Supabase's URL and publishable key are public; its secret keys never go anywhere near the game (the server refuses to start with one).
10. **The privacy policy is a promise.** [apps/client/public/privacy.html](apps/client/public/privacy.html) tells players what the game keeps, logs and shares. A change that keeps or logs something new about players, or sends their data to a new service, updates that page in the same pull request. Never log IP addresses, emails, codes or tokens, and load nothing from other sites (fonts and libraries are bundled).

## Play-testing

- Run `npm run dev` and open http://localhost:5173 at phone size (for example 390x844) and in landscape. Walk with the joystick, by tapping and with the keyboard (WASD or arrows, E or Space for A, Q or Escape for B, Q held for a call and 1 to 3 to pick it, Enter for the chat, M for the map), talk to Mira, read signs, pick things up. A second tab is a second player.
- Automation tools may send key events without a `code` (the game reads `code`): to hold a key, dispatch one from the page, for example `dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }))`, then the matching `keyup`.
- Dev builds expose the game as `window.napoland`: `game`, `maps`, `items`, `hud`, `view`, `signin`, and `receive(msg)` to play a server message by hand.
- Headless browsers and hidden tabs often do not run `requestAnimationFrame`, so the game stands still. Pump it from the page: `const pump = setInterval(() => napoland.game.update(0.05, performance.now()), 50)`, and `clearInterval(pump)` when done (seconds, then milliseconds). The picture only redraws when a real frame runs.
- Check the browser console and the server log.

## Pull requests

- One roadmap item or one fix per pull request, as small as it can be.
- Run `npm run check` before every push. Add tests. Attach screenshots in portrait and landscape for anything visible.
- Roadmap changes are files in `roadmap/` ([roadmap/README.md](roadmap/README.md)). A pull request that finishes an item sets its `status` to `done`.
- When `main` moves: merge it into the branch (or rebase). Never hand-merge generated files: take main's version, then run `npm run gen` (maps) or `npm install` (`package-lock.json`). Check that your migration number and version bumps do not collide with main's.
- Title and commits: one plain line that says what changes, no prefixes like `feat:`.
- The description says which parts an AI wrote, and that a person read the whole change and ran it.

## Hard limits

- **Never deploy, and never touch production or AWS.** Do not run `tools/deploy.mjs`, `aws`, CloudFormation, or anything from `infra/` or `deploy/` against a real system. Merges to `main` are released by CI; releasing is the maintainers' job. `docs/OPERATIONS.md` and `docs/MAINTAINING.md` are for maintainers only: do not act on them.
- Never use real credentials or the production Supabase project, in tests or anywhere else: use `AUTH_MODE=dev`.
- Never commit secrets, `.env` files or tokens.
- Never weaken, skip or delete tests (or CI checks) to make them pass. Fix the code, or explain in the pull request why a test was wrong.
- Never change LICENSE files. Never add large binary files.
