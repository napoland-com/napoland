# Working on napoland

napoland is a mobile-first online exploration game (web client + authoritative Node server). The owner wants Claude to build, test, play-test, release and maintain everything; they make product decisions. Read [docs/DESIGN.md](docs/DESIGN.md) (what the game is and why) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (how it is built) before changing behavior.

## Commands

| | |
|---|---|
| Install | `npm install` (npm workspaces; Node 24) |
| Run for development | `npm run dev` (server :8080 in memory, client :5173 with hot reload; phones on the same Wi-Fi can open `http://<PC IP>:5173`). `GAME_SERVER=localhost:8097` points Vite at another server; in dev builds `window.napoland` exposes the game for inspection |
| Everything a change must pass | `npm run check` (typecheck + content validation + tests) |
| Tests only | `npm test` (Vitest) |
| Rebuild the maps | `npm run gen:map` (Stonebrook), `npm run gen:woods` (the Near Woods), then `npm run gen:interiors` (every room; it checks each door against its room), then `npm run validate` |
| Test players against a running server | `npm run bot -- --count 3 --steps 30` |
| Full stack in Docker (Postgres) | `docker compose up -d --build`, then http://localhost:8080 |
| Release to production | push to `main` (CI tests, then deploys); by hand: `AWS_PROFILE=napoland node tools/deploy.mjs` |
| Roll back production | `AWS_PROFILE=napoland node tools/deploy.mjs --version <earlier tag>` |
| Production logs | `aws logs tail /napoland/prod --log-stream-names napoland-game-1 --follow --profile napoland --region us-east-1` |

## Rules of the codebase

- **The server decides everything.** Clients send intentions (step, face); the server validates and broadcasts. Never trust a client message; every one is parsed with the zod schemas in `packages/shared/src/protocol.ts`.
- **`packages/shared` is the contract** between client and server: map format, movement rules, protocol. Change it deliberately, bump `PROTOCOL_VERSION` when old clients would break, and update both sides plus tests in the same change.
- **Database changes are migrations.** Add a new numbered file in `apps/server/migrations` (never edit one that ran); the server applies it at start, inside a transaction. Keep it additive (new tables, new columns with defaults) so the previous release still runs on it, because a release that fails its health check rolls back by itself; drop or rename old things only in a later release. Before a risky one, run `backup.sh` on the server.
- **Content is data.** Maps live in `content/maps/*.json` and must pass `npm run validate`. Prefer changing data over code.
- **Tests come with changes.** Game rules get unit tests; server behavior gets tests over real WebSockets (`apps/server/test`); client logic that does not need a browser gets tests in `apps/client/test`.
- **Every screen shape must work.** HUD sizes come from the screen's short side (container query units), controls stay in the thumb corners, nothing forces an orientation. Check portrait and landscape.
- TypeScript strict, ESM, imports without extensions. Comments explain why, not what. Plain words in UI text and docs.
- The server is bundled to CommonJS by esbuild: no `import.meta` or top-level await in `apps/server/src`.
- Secrets live in `.env` (git-ignored). Tokens are stored hashed; never log them.

## Layout

| Path | What |
|---|---|
| `packages/shared` | Map (`TileMap`), movement (`STEP_MS`, `findPath`), protocol (messages + validation), map validation |
| `apps/server` | Game server: `world.ts` (rules, no I/O), `net.ts` (WebSocket sessions), `http.ts` (health + static client), `storage.ts` (memory or Postgres), `migrations/` |
| `apps/client` | Web client: `game.ts` (prediction and state), `hud.ts` (interface), `view/` (three.js world), `net.ts` |
| `content/maps` | The world as data |
| `content/items.json` | Items and where finds grow (checked with the maps by `npm run validate`) |
| `tools` | Map generator, content validator, test bots, dev runner, `deploy.mjs` |
| `infra` | The AWS stack as CloudFormation (server, data disk, IP, DNS, registry, bucket, deploy role) |
| `deploy` | What runs on the production server: compose file, Caddyfile, `release.sh`, backups |
| `.github/workflows` | CI: tests on every push, release of main |
| `docs` | Design, architecture, and [OPERATIONS.md](docs/OPERATIONS.md) (production runbook) |

## Production

https://www.napoland.com runs on one AWS server (account of the napoland.com domain, us-east-1); read
[docs/OPERATIONS.md](docs/OPERATIONS.md) before touching it. The AWS account also holds the owner's other
projects: only touch resources of the `napoland-prod` stack. Releases go through `main` and CI; check
`https://www.napoland.com/health` (`version` is the commit) after one.

## Play-testing

Start the stack, open the game in the built-in browser pane at phone size (for example 390x844) and landscape, and play: walk with the joystick and by tapping, talk to Mira, read signs. Open a second tab to see two players. Check the browser console and the server log. For a real phone, use this PC's LAN address.
