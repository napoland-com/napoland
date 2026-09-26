# napoland: architecture

How the game is built, and why it is built that way. The main constraint: Claude builds, tests, play-tests, releases and maintains every part, so everything is text in one repository, one language (TypeScript) runs everywhere, and every check is a command.

## Pieces

```
 phone / desktop browser                       one server (Docker)
 +---------------------------+   WebSocket    +-------------------------------+     +------------+
 | apps/client               |  /ws (JSON)    | apps/server                   |     | PostgreSQL |
 |  three.js world  (view/)  | <------------> |  net.ts    sessions, limits   | --> | players    |
 |  HUD + controls  (hud.ts) |                |  world.ts  rules, no I/O      |     +------------+
 |  prediction      (game.ts)|   HTTP         |  http.ts   /health, client    |
 +---------------------------+ <------------> |  storage.ts memory | postgres |
                                              +-------------------------------+
            both import packages/shared: map, movement rules, protocol
```

- **packages/shared** is the contract: `TileMap` (walkable tiles from the map data), movement (`STEP_MS`, `findPath`), the protocol (zod schemas for every client message, types for every server message) and map validation. Client and server can never disagree about the rules because they run the same code.
- **apps/server** owns the world. `world.ts` holds the rules as plain functions of state and time (easy to test, replayable); `net.ts` turns WebSocket messages into world calls and world events into messages; `storage.ts` keeps players in PostgreSQL (or in memory for tests and quick development).
- **apps/client** draws the world and sends intentions. It predicts your own steps so walking feels instant, and animates everyone else from the server's reports.

## Movement: authoritative server, predicted client

- The world is a grid. A step moves one tile in 200 ms (`STEP_MS`), one speed for everyone.
- The client sends `{t:'step', dir, seq}`. The server accepts it when the player's previous step has finished (40 ms tolerance for network jitter) and the target tile is walkable; early steps wait in a queue of two. On average nobody can walk faster than one tile per 200 ms, however fast they send.
- Accepted: everyone gets `{t:'step', id, x, y, dir}`; the mover also gets its `seq` back. Refused: the mover gets `{t:'reject', seq, x, y, dir}` with the real position and snaps back.
- The client walks immediately (prediction) and stays at most two steps ahead of the server's confirmations. Other players are drawn sliding from where they are to the reported tile over one step's time.
- Turning in place sends `{t:'face', dir}`.

## Connecting

1. The client opens `/ws` and sends `hello` with `v` (protocol version) and either a saved `token` or a new `name`.
2. The server answers `welcome`: your id, name and token (kept in localStorage; only its SHA-256 is stored), everyone online, `stepMs`, the map id and version, the weather. Everyone else gets `join`.
3. Errors are explicit: `bad_version` makes the client reload, `unknown_token` shows the name screen, `bad_name` explains the problem, `replaced` means the same player connected from another screen.
4. Phones drop connections often; the client reconnects with backoff and logs back in with its token.

## Saving

Players live in memory while online and are written to PostgreSQL every 15 s, when they leave and on shutdown. Schema changes are SQL files in `apps/server/migrations`, applied in order at start-up and recorded in `schema_migrations`.

## Rendering

three.js with low-poly geometry, flat faceted normals, a three-step toon ramp and back-face outlines. The terrain is one mesh built from the tile map (flat tops, vertical walls for ledges and banks); trees, rocks, ferns and fences are instanced (a few draw calls for thousands of objects). No shadow maps: round blob shadows under things, cheaper on phones and closer to the FireRed look. Weather (overcast, rain, night) changes lights, fog, rain and glow; at night your character carries a flashlight.

The camera keeps the same circle of world (radius 6.2 tiles) around you on every screen shape: it fits the short side, and a longer screen only adds view at the edges. On upright screens the view shifts so your character is above your thumbs.

## Interface

HTML over the canvas, sized with container query units from the screen's short side, so it scales from small phones to desktops and works in any orientation: joystick bottom left (four directions with a dead zone), A and B bottom right, status top left, one menu button top right (no map: the game is mapless), the text box above the controls (upright) or between them (sideways), the bag as a bottom sheet (upright) or a side panel (sideways).

## Content

The world is data in `content/maps/*.json`: rows of tile letters, rows of height levels, and a list of objects (trees, cabins, lamps, signs with their text, people with their lines). `tools/gen-map.ts` generated the first town from a fixed seed; from now on the JSON is the source of truth. `npm run validate` checks every map: sizes, tile letters, overlapping objects, a walkable spawn, reachable tiles, signs and people you can stand in front of.

## Verification

| Check | Command | Covers |
|---|---|---|
| Types | `npm run typecheck` | all packages, the tools and the tests |
| Content | `npm run validate` | every map |
| Unit and integration tests | `npm test` | shared rules, server world rules, the server over real WebSockets, client prediction logic |
| Test players | `npm run bot` | a running server, end to end |
| Play-test | browser pane at phone and desktop sizes | the look, the controls, two players at once |

## Running it

- **Development:** `npm run dev` (server in memory on :8080, Vite on :5173 with hot reload, reachable from phones on the same Wi-Fi).
- **Docker:** `docker compose up -d --build` builds one small image (Node + bundled server + built client + content + migrations) next to PostgreSQL 17. Settings in `.env`.

## Growing later

The design's layers (your cabin, your street, the town square, the wilds) map onto the same server code: a zone is a map plus the players in it. When one process is not enough, zones move to separate processes (cabins and streets start on demand, the town square and busy regions get copies), with a small message bus between them for chat, parties and cross-zone presence. Nothing in the protocol or the client has to change for that.

Still to set up when there are accounts to run it on: a cloud server with HTTPS (Caddy), CI on every change (GitHub Actions running `npm run check` and bot tests), automatic deploys with a smoke test and rollback, nightly database backups, and a scheduled bot that logs in and files issues when something breaks.
