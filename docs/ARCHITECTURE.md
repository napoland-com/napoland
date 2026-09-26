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
            both import packages/shared: maps, movement and energy rules, protocol
```

- **packages/shared** is the contract: `TileMap` (walkable tiles, exits, lamp light and the distance home, from the map data), movement (`STEP_MS`, `findPath`), energy (`energyRate`), the protocol (zod schemas for every client message, types for every server message) and content validation. Client and server can never disagree about the rules because they run the same code.
- **apps/server** owns the world. `world.ts` holds the rules as plain functions of state and time (easy to test, replayable); `net.ts` turns WebSocket messages into world calls and world events into messages; `storage.ts` keeps players in PostgreSQL (or in memory for tests and quick development).
- **apps/client** draws the world and sends intentions. It predicts your own steps so walking feels instant, and animates everyone else from the server's reports.

## Movement: authoritative server, predicted client

- The world is a grid. A step moves one tile in 200 ms (`STEP_MS`), one speed for everyone.
- The client sends `{t:'step', dir, seq}`. The server accepts it when the player's previous step has finished (40 ms tolerance for network jitter) and the target tile is walkable; early steps wait in a queue of two. On average nobody can walk faster than one tile per 200 ms, however fast they send.
- Accepted: everyone gets `{t:'step', id, x, y, dir}`; the mover also gets its `seq` back. Refused: the mover gets `{t:'reject', seq, x, y, dir}` with the real position and snaps back.
- The client walks immediately (prediction) and stays at most two steps ahead of the server's confirmations. Other players are drawn sliding from where they are to the reported tile over one step's time.
- Turning in place sends `{t:'face', dir}`.

## Maps, exits and energy

- The world is several maps joined by exits, like FireRed's towns and routes: Stonebrook (a town) and the Near Woods (the wilds, depth 1) so far. A map is a zone: the server tells you only what happens on your map (`join`, `leave`, `step`, `face`), which also keeps the traffic down as the world grows.
- An exit is a strip of tiles on a map's edge. When your step lands on one, the server confirms the step, then moves you to the arrival tile on the other map at once: the old map gets `leave`, the new one `join`, and you get `{t:'zone', map, x, y, dir, players, reason:'exit'}`. The client stops predicting on an exit tile, fades to black, swaps the map and fades in with its name.
- Energy (`energy.ts`) is the server's: every tick it moves each player's energy by `energyRate` for their tile: a refill in towns and within `LAMP_RADIUS` of a street lamp, a drain in the wilds that grows with the map's depth, the walking distance to the home exit (`TileMap.homeSteps`) and bad weather. You get `{t:'energy', energy:{value, max, rate}}` when the rate changes noticeably and every `ENERGY_SYNC_MS`; the client counts on between messages.
- At zero you collapse: the server puts you on the home town's spawn with full energy and sends `zone` with `reason:'collapse'`.

## Connecting

1. The client opens `/ws` and sends `hello` with `v` (protocol version, now 2) and either a saved `token` or a new `name`.
2. The server answers `welcome`: your id, name and token (kept in localStorage; only its SHA-256 is stored), the map you are on (id and version; a client with another version reloads) and everyone on it, `stepMs`, the weather and your energy. Everyone on your map gets `join`.
3. Errors are explicit: `bad_version` makes the client reload, `unknown_token` shows the name screen, `bad_name` explains the problem, `replaced` means the same player connected from another screen.
4. Phones drop connections often; the client reconnects with backoff and logs back in with its token.

## Limits

No single client can wear the server down (`net.ts`, `limits.ts`):

- Each connection: messages of at most 1 KiB, 30 a second (bursts of 60), `hello` within 5 s, an answer to the heartbeat ping every 30 s. At most `MAX_PLAYERS` (500) online.
- Each address: `MAX_CONNECTIONS_PER_IP` (20) open connections; one more gets HTTP 429 before a WebSocket exists. `NEW_PLAYERS_PER_IP_PER_HOUR` (10) new players in any hour, counted in memory; one more gets `bad_name` ("Too many new players from your network"). Signing in with a token is never limited.
- The address is the socket's. Behind our own proxy (Caddy), `TRUST_PROXY=1` makes it the last `X-Forwarded-For` entry, the one the proxy added; the game port must then only be reachable through the proxy, or clients could claim any address. Addresses are never logged.

## Saving

Players (position, map, energy) live in memory while online and are written to PostgreSQL every 15 s, when they leave and on shutdown. Schema changes are SQL files in `apps/server/migrations`, applied in order at start-up and recorded in `schema_migrations`; they only add, so the previous release still runs if a new one rolls back.

## Rendering

three.js with low-poly geometry, flat faceted normals, a three-step toon ramp and back-face outlines. The terrain is one mesh built from the tile map (flat tops, vertical walls for ledges and banks); trees (a tree object, or one per forest tile, varied by position), rocks, ferns and fences are instanced, in blocks of 8x8 tiles with computed bounds so blocks off screen are skipped (the Near Woods has thousands of trees). Only the four street lamps nearest you carry a real light, handed over as you walk; the rest glow through their material, and the light count never changes, so switching maps never recompiles shaders. One WebGL renderer lives for the whole session; each map gets a view that frees everything it made when you leave. No shadow maps: round blob shadows under things, cheaper on phones and closer to the FireRed look. Weather (overcast, rain, night) changes lights, fog, rain and glow; at night your character carries a flashlight.

The camera keeps the same circle of world (radius 6.2 tiles) around you on every screen shape: it fits the short side, and a longer screen only adds view at the edges. On upright screens the view shifts so your character is above your thumbs.

## Interface

HTML over the canvas, sized with container query units from the screen's short side, so it scales from small phones to desktops and works in any orientation: joystick bottom left (four directions with a dead zone), A and B bottom right, status top left (your name, the players here, the connection and a slim energy bar: red below 25%, pulsing below 10%, a bright tip while refilling), one menu button top right (no map: the game is mapless), the text box and the bag where they never cover A and B. Below 20% energy the screen's edges darken. Arriving on a map (logging in, an exit, a collapse) fades in from black under a banner with the map's name, or with what happened.

## Content

The world is data in `content/maps/*.json`: what the map is (town or wilds, depth), rows of tile letters (`t` is dense forest), rows of height levels, exits to other maps, and a list of objects (trees, cabins, lamps, signs with their text, people with their lines). The maps are generated from fixed seeds (`npm run gen:map` for Stonebrook, `npm run gen:woods` for the Near Woods), so the world never reshuffles and players can share routes. `npm run validate` checks every map on its own (sizes, tile letters, overlapping objects, a walkable spawn, reachable tiles, exits on walkable tiles, a way home in the wilds, signs and people you can stand in front of) and then how they fit together (every exit leads to a real map, onto walkable ground that is not another exit, and every map can be reached from town).

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
- **Checking a server:** `/health` answers `ok`, the players online, the uptime and `version` (from `APP_VERSION`, default `dev`), so a deploy can be checked from outside.
- **Maps:** the server loads every map in `MAPS_DIR` (default `content/maps`) and refuses to start if any fails validation; `HOME_MAP` (default `stonebrook`) is where new players start and collapsed players wake up.

## Growing later

The design's layers (your cabin, your street, the town square, the wilds) map onto the same server code: a zone is a map plus the players in it, and players already only hear about their own map. When one process is not enough, zones move to separate processes (cabins and streets start on demand, the town square and busy regions get copies), with a small message bus between them for chat, parties and cross-zone presence; `zone` messages already tell the client everything it needs when it changes maps.

Production (one AWS server with Caddy, CI on every push, automatic releases with rollback, nightly backups) is described in [OPERATIONS.md](OPERATIONS.md). Still to come: a scheduled bot that signs in with a saved token, plays a little and reports when something breaks.
