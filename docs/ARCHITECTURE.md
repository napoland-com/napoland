# napoland: architecture

How the game is built, and why it is built that way. The main constraint: Claude builds, tests, play-tests, releases and maintains every part, so everything is text in one repository, one language (TypeScript) runs everywhere, and every check is a command.

## Pieces

```
 phone / desktop browser                       one server (Docker)
 +---------------------------+   WebSocket    +-------------------------------+     +------------+
 | apps/client               |  /ws (JSON)    | apps/server                   |     | PostgreSQL |
 |  three.js world  (view/)  | <------------> |  net.ts    sessions, limits   | --> | players    |
 |  HUD + controls  (hud.ts) |                |  world.ts  rules, no I/O      |     +------------+
 |  prediction      (game.ts)|   HTTP         |  http.ts   /health, client,   |
 |  sign-in      (signin.ts) | <------------> |            /auth-config       |
 +---------------------------+                |  auth.ts   who is signing in  |
               |                              |  storage.ts memory | postgres |
               | email and code               +-------------------------------+
               v                                              |
 +---------------------------+   its public keys (JWKS)       |
 | Supabase Auth             | <------------------------------+
 +---------------------------+
            both import packages/shared: maps, movement and energy rules, protocol
```

- **packages/shared** is the contract: `TileMap` (walkable tiles, exits, lamp light and the distance home, from the map data), movement (`STEP_MS`, `findPath`), energy (`energyRate`), the protocol (zod schemas for every client message, types for every server message, how to sign in) and content validation. Client and server can never disagree about the rules because they run the same code.
- **apps/server** owns the world. `world.ts` holds the rules as plain functions of state and time (easy to test, replayable); `net.ts` turns WebSocket messages into world calls and world events into messages; `auth.ts` checks who is signing in; `storage.ts` keeps players in PostgreSQL (or in memory for tests and quick development).
- **apps/client** draws the world and sends intentions. It predicts your own steps so walking feels instant, and animates everyone else from the server's reports.
- **Supabase Auth** only proves who someone is (an email and a code, later Google and Apple). The game keeps its own players and everything they own in its own database.

## Movement: authoritative server, predicted client

- The world is a grid. A step moves one tile in 200 ms (`STEP_MS`), one speed for everyone.
- The client sends `{t:'step', dir, seq}`. The server accepts it when the player's previous step has finished (40 ms tolerance for network jitter) and the target tile is walkable; early steps wait in a queue of two. On average nobody can walk faster than one tile per 200 ms, however fast they send.
- Accepted: everyone gets `{t:'step', id, x, y, dir}`; the mover also gets its `seq` back. Refused: the mover gets `{t:'reject', seq, x, y, dir}` with the real position and snaps back.
- The client walks immediately (prediction) and stays at most two steps ahead of the server's confirmations. Other players are drawn sliding from where they are to the reported tile over one step's time.
- Turning in place sends `{t:'face', dir}`.

## Maps, exits and energy

- The world is several maps joined by exits, like FireRed's towns and routes: Stonebrook (a town) and the Near Woods (the wilds, depth 1) so far, plus the inside of every building (kind `inside`): a house's door (`doorOf`, the middle of its front row) is an exit into a small map of its own, and the validator refuses a house whose door leads nowhere. A map is a zone: the server tells you only what happens on your map (`join`, `leave`, `step`, `face`), which also keeps the traffic down as the world grows.
- An exit is a strip of tiles on a map's edge. When your step lands on one, the server confirms the step, then moves you to the arrival tile on the other map at once: the old map gets `leave`, the new one `join`, and you get `{t:'zone', map, x, y, dir, players, reason:'exit'}`. The client stops predicting on an exit tile, fades to black, swaps the map and fades in with its name.
- Energy (`energy.ts`) is the server's: every tick it moves each player's energy by `energyRate` for their tile: a refill within `FIRE_RADIUS` of a fireplace (shelters and some houses keep one burning, always), nothing in towns and insides, and a drain in the wilds that grows with the map's depth, the walking distance to the home exit (`TileMap.homeSteps`) and bad weather. Street lights (`LAMP_RADIUS`) are for seeing, not energy. You get `{t:'energy', energy:{value, max, rate}}` when the rate changes noticeably and every `ENERGY_SYNC_MS` while it changes; the client counts on between messages.
- At zero you collapse: the server puts you on the home town's spawn with full energy and sends `zone` with `reason:'collapse'`.

## Finds, the bag and piles

- Items are data (`content/items.json`, checked by `validateItems`): what each item is, its stack size, what using it does, and **find rules**: which map, which tiles (kinds, walking distance from the way home, nearness to objects such as wrecks or poles), how many lie out there at once and how long a picked one takes to grow back. The rules and the bag's arithmetic are pure functions in `packages/shared/src/items.ts`.
- The server owns every find: it places them at start on tiles that fit their rule, and when someone picks one (`{t:'pick', x, y}`, on your own tile or the one next to you), it is gone for everyone (`findGone`) and a new one grows later on another tile that fits the same rule (`find`). Finds live in memory; a restart places them afresh.
- Your bag (8 slots, stacks) is the server's too; you hear it whole after any change (`bag`), plus `got` for the "+1 Glowcap" and `refused` with a reason when something did not happen. `use` (a thermos: +30 energy) and `discard` work on a slot.
- Collapsing turns what you carried into a pile where you fell (one per player, a new collapse replaces it). Its owner gets everything back; anyone else gets a random half (`halfOf`) and the rest is lost; it fades an hour after the collapse (`DROP_LIFETIME_MS`). Bags are saved with the player (`players.bag`) and piles in their own table (`drops`), so both survive a restart.

## What wears you down, and what helps

The rules are in `packages/shared` (so client and server agree) and the World runs them; everything is per tick (`TICK_MS`) with no timers of its own.

- **The drain** (`energy.ts`, `energyRate(map, x, y, weather, conditions)`): on top of depth, distance and weather, factors for the bag's load (`bagLoad`: item weights over `CARRY_KG`), wetness, a hitchhiker and a surge whose front has passed your tile (`inSurge`; a street light shelters you). A warm tile refills only while its fire burns, as warm as it burns (`fireHeat`). The World recomputes every player's rates each tick and tells them (`energy` with a `body`: wet, wetRate, load, hitched) when a rate turns or moves more than 10%; the client counts energy and wetness on between reports.
- **Fires** (`apps/server/src/fires.ts`): every fireplace, with the game time it goes out. Fires in town and in the houses whose door opens onto a town are tended (never out, `left: null`), and a map can mark one `tended`; the rest start between half and full (`FIRE_MAX_S`, 30 minutes) at start-up, in memory only. `{t:'feed', x, y, slot}` puts one of an item with `fuel` into a fire next to you (diagonals too); the map hears `fire` with the seconds left, and the client counts down to draw the flames.
- **The sky** (`sky.ts`): `weatherAt(wall)` is the day (with `WEATHER=cycle`, the default, the World follows it every tick; a fixed `WEATHER` still works for trying things out), and `surgeAt(rule, wall)` a region's surge clock from its map's `surge` rule. Both follow the wall clock, so restarts never shift them. The World tells a map when its phase changes (`surge`), puts the rules' `when: 'unstable'` finds out while a region is restless or surging and takes them back when it is calm; `when: 'aurora'` finds likewise on aurora nights. The front's position is `surgeFront(rule, map.deepest, view)`, which the client computes too.
- **Watchers** (a map's `watchers` rule): server-side creatures that wake on tiles of their rule far from every player, step every `WATCHER_STEP_MS` toward the nearest exposed player within reach along a short breadth-first path (never onto light, fire, exits or near a flare), and freeze while any player within sight faces them (`faces`). Reaching someone: `touched` (energy and one random unit of the bag lost), and away for a while. The map hears `creature` and `creatureGone`.
- **Hitchhikers, flares, marks**: a hitchhiker is a flag on the player, rolled each tick in the dark, deep in (`hitch` tells them). A flare (`use`) lasts `use.flare` seconds on its tile (`flare` to the map); the client gives the nearest one a real light of its own, always in the scene so the shader never changes. Marks (`use` of an item with `use.mark`) are records like piles: saved in their own table (`marks`), faded after a day, at most `MARKS_PER_PLAYER` each.
- **The Old Stone**: the first `stone` object in the world. Shards (`charge`) fed to it (`feed`) add up; at `STONE_NEED` it wakes, burns one every `STONE_SHARD_S` and sleeps at none. Everyone online hears `stone` (an Outgoing to `'all'`). Saved in `world_state` under `stone`, with the wall time of its charge, so it keeps burning across a restart.
- **Strange objects** (`use.identify`) turn into one of their `reveals` (by weight), only in town or a house whose door opens onto one. **Charms** (kind `charm`) change `Mods` while in the bag, like feats (`feats.ts`): the server counts `rainSteps`, `nightSteps`, `heavySteps` and `fed` in `players.stats`, and a feat reached is announced (`feat`).
- **Echoes**: the World keeps each player's last `TRAIL_STEPS` tiles in the wilds; a pile carries them (`drops.trail`, and `trail` in `DropView`).
- **The notice board** (a map object `board`): `{t:'board', x, y}` next to one gets `board` with plain lines about the weather, the surges, fires that are low or out, the last hour's collapses and the Old Stone.

## Connecting and signing in

The server runs in one of three sign-in modes (`AUTH_MODE`, `apps/server/src/auth.ts`), and `GET /auth-config` tells the client which. It is never cached, so the page loaded after a release that changes the mode sees it.

| Mode | `/auth-config` | Who you are |
|---|---|---|
| `legacy` (the default) | `{mode:'legacy'}` | No sign-in: a name makes a character, and its token (kept in the browser's localStorage; only its SHA-256 is stored) logs back in. |
| `dev` | `{mode:'dev'}` | An email, believed without a code, so each tab can be someone else. For development and tests (`npm run dev` and the local `compose.yaml` set it); refused when `NODE_ENV=production` unless `ALLOW_DEV_AUTH=1`. The identity is `dev:` and the email in lower case. |
| `supabase` | `{mode:'supabase', url, publishableKey}` | Supabase Auth: the client (`supabase.ts`, supabase-js) has a 6-digit code emailed and checks it, and Supabase keeps the session in the browser and refreshes it. The server checks the access token (a JWT) with jose against the project's public keys (`<url>/auth/v1/.well-known/jwks.json`, kept 10 minutes and fetched again early for a key it has not seen; HS256 with `SUPABASE_JWT_SECRET` only for projects that still sign with a shared secret): issuer `<url>/auth/v1`, audience `authenticated`, not expired (30 s of clock difference allowed), not an anonymous user. The identity is the token's `sub`, Supabase's user id. |

1. The client asks `/auth-config`, shows the matching card (`signin.ts`, a small state machine tested without a page: email, code, name), then opens `/ws` and sends `hello` with `v` (protocol version, now 5) and:
   - legacy: a saved `token`, or a `name` for a new character;
   - dev and supabase: `auth` (the email, or Supabase's access token, asked for afresh before every connection), the `token` kept in this browser from before sign-in if there is one, and a `name` once the server has asked for one.
2. With sign-in, the server gives the identity its character (`players.auth_sub`: one per identity). Without one, the character of the hello's `token`, if nobody has claimed it yet, becomes theirs: that is how a character made before sign-in carries over, by signing in on the browser that made it. Without that, a new character with the `name` (the name rules and the limit of new players per address apply); without a name, `need_name`, and the client asks "Choose a name for your character". No `auth`, or one that proves nothing (malformed, expired, forged, for another project), gets `sign_in_required`: the client refreshes its session once and reconnects, and after that asks to sign in again. If Supabase's keys cannot be fetched, the connection closes with 1011 and the client tries again later.
3. The server answers `welcome`: your id and name, the map you are on (id and version; a client with another version reloads) with everyone, every find and every pile on it, `stepMs`, the weather, your energy and body, your bag, the fires, marks, creatures, flares and surge clock of your map, the Old Stone, your feat counts and the version of `content/items.json` (another version also makes the client reload). Only in legacy mode it has your `token`; `claimed: true` says this sign-in just made a character from before sign-in yours. Everyone on your map gets `join`.
4. Errors are explicit: `bad_version` makes the client reload, `unknown_token` (legacy) shows the name card, `bad_name` explains the problem, `need_name` and `sign_in_required` as above, `replaced` means the same player connected from another screen, `server_full` means try again soon.
5. Phones drop connections often; the client reconnects with backoff and says hello again (with a refreshed access token when it signs in).

The hello may be up to 9 KiB, since a Supabase token grows with the profile a provider such as Google adds; every other message stays under 1 KiB. The client prepares its hello before it opens the socket, so a token refresh never eats into the 5 s the server waits for it. Tokens and emails are never logged.

## Limits

No single client can wear the server down (`net.ts`, `limits.ts`):

- Each connection: messages of at most 1 KiB (the hello 9 KiB), 30 a second (bursts of 60), `hello` within 5 s, an answer to the heartbeat ping every 30 s. At most `MAX_PLAYERS` (500) online.
- Each address: `MAX_CONNECTIONS_PER_IP` (20) open connections; one more gets HTTP 429 before a WebSocket exists. `NEW_PLAYERS_PER_IP_PER_HOUR` (10) new players in any hour, counted in memory; one more gets `bad_name` ("Too many new players from your network"). Coming back to a character (with a token, with sign-in, or claiming one) is never limited.
- The address is the socket's. Behind our own proxy (Caddy), `TRUST_PROXY=1` makes it the last `X-Forwarded-For` entry, the one the proxy added; the game port must then only be reachable through the proxy, or clients could claim any address. Addresses are never logged.

## Saving

Players (position, map, energy, bag, wetness, feat counts) live in memory while online and are written to PostgreSQL every 15 s, when they leave and on shutdown, and at once whenever items move between a bag and a pile (or a watcher takes one, or a feat is earned). A player's row also says whose it is (`auth_sub`, empty for a character made before sign-in until someone claims it) and, for characters made without sign-in, holds the hash of their token. Piles and marks are written on every change and loaded at start (the last hour's piles, the last day's marks; older ones are deleted), and so is the Old Stone (`world_state`); finds, fires, watchers and flares live in memory only. Schema changes are SQL files in `apps/server/migrations`, applied in order at start-up and recorded in `schema_migrations`; they only add, so the previous release still runs if a new one rolls back.

## Rendering

three.js with low-poly geometry, flat faceted normals, a three-step toon ramp and back-face outlines. The terrain is one mesh built from the tile map (flat tops, vertical walls for ledges and banks); trees (a tree object, or one per forest tile, varied by position) and ferns are instanced in blocks of 8x8 tiles with computed bounds so blocks off screen are skipped (the Near Woods has thousands of trees); rocks, mushrooms and road lines are instanced too. The props that never move (houses, cars, signs, lamps, poles, barrels, fences) are hundreds of little outlined boxes, so each map joins them into a few meshes (`bake` in `view/toon.ts`): one for every plain color (as vertex colors), one for all their outlines, and one for each material that glows (lit windows, lamp heads, car lights). The whole town's props then cost about six draw calls instead of a hundred and more; they are a few thousand triangles, cheaper drawn whole than split. What moves (people, the Old Stone's crystal and rocks) stays separate. Street lamps and fires share four real lights, nearest first, handed over as you walk; the rest glow through their material, and the scene always holds the same lights (inside or out), so switching maps never recompiles shaders. Insides (`view/interior.ts`, `fire.ts`) are a plank floor, log walls with the front row cut down to a baseboard so this camera sees in, furniture and a hearth whose fire burns the same in any weather; around a room everything is black, and rain, mist and wisps stay outside. A room without a fireplace is cold and dark. Outside, a house's doorway glows when its room has a fire, and its chimney smokes (`view/lighting.ts` decides how each kind of map looks in each weather). Finds and piles (`view/loot.ts`) are small glowing models, one instanced mesh per kind of item rebuilt only when the lists change, with a soft pool of light under each so they read as colored lights in the dark; your own pile has a ring in your jacket color. One WebGL renderer lives for the whole session; each map gets a view that frees everything it made when you leave. No shadow maps: round blob shadows under things, cheaper on phones and closer to the FireRed look. Weather (overcast, rain, night) changes lights, fog, rain and glow; at night your character carries a flashlight.

The camera keeps the same circle of world (radius 6.2 tiles) around you on every screen shape: it fits the short side, and a longer screen only adds view at the edges. On upright screens the view shifts so your character is above your thumbs.

## Interface

HTML over the canvas, sized with container query units from the screen's short side, so it scales from small phones to desktops and works in any orientation: joystick bottom left (four directions with a dead zone), A and B bottom right, status top left (your name, the players here, the connection and a slim energy bar: red below 25%, pulsing below 10%, a bright tip while refilling), one menu button top right (no map: the game is mapless), the text box and the bag where they never cover A and B. The bag shows eight slots with an icon per item (`icons.ts`, inline SVG) and a count; a slot opens its details with Use and Throw away, and B backs out one step at a time. A picks up what lies on your tile or the one you face before it talks; tapping a find walks there and picks it up. Below 20% energy the screen's edges darken. Arriving on a map (logging in, an exit, a collapse) fades in from black under a banner with the map's name, or with what happened. The menu's About (`about.ts`) opens where the bag does: who makes and publishes the game, the source code first (the AGPL offers it to everyone who plays), the privacy policy, the legal notice, the licenses and the version the server runs; every sign-in card ends with the same links in small print. The fonts (Fredoka and Nunito, from `@fontsource-variable`) are bundled with the client, so the page loads nothing from other sites.

## Content

The world is data in `content/maps/*.json`: what the map is (town or wilds, depth), rows of tile letters (`t` is dense forest), rows of height levels, exits to other maps, and a list of objects (trees, cabins, lamps, signs with their text, people with their lines). The maps are generated from fixed seeds (`npm run gen:map` for Stonebrook, `npm run gen:woods` for the Near Woods), so the world never reshuffles and players can share routes; the rooms inside buildings are drawn by hand in `tools/gen-interiors.ts` (`npm run gen:interiors`, run after the other two: it checks that every door leads into its room and back out in front of it). `npm run validate` checks every map on its own (sizes, tile letters, overlapping objects, a walkable spawn, reachable tiles, exits on walkable tiles, a way home in the wilds, signs and people you can stand in front of) and then how they fit together (every exit leads to a real map, onto walkable ground that is not another exit, and every map can be reached from town).

## Verification

| Check | Command | Covers |
|---|---|---|
| Types | `npm run typecheck` | all packages, the tools and the tests |
| Content | `npm run validate` | every map |
| Unit and integration tests | `npm test` | shared rules, server world rules, the server over real WebSockets, client prediction logic |
| Test players | `npm run bot` | a running server, end to end |
| Play-test | browser pane at phone and desktop sizes | the look, the controls, two players at once |

## Running it

- **Development:** `npm run dev` (server in memory on :8080, Vite on :5173 with hot reload, reachable from phones on the same Wi-Fi). Sign-in is dev mode: any email, no code.
- **Docker:** `docker compose up -d --build` builds one small image (Node + bundled server + built client + content + migrations) next to PostgreSQL 17. Settings in `.env`. Sign-in is dev mode here too (`AUTH_MODE` in `.env` changes it).
- **Sign-in:** `AUTH_MODE` is `legacy` (the default), `dev`, or `supabase` with `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (both public; `SUPABASE_ANON_KEY` is the older name). Production runs `supabase`; what the Supabase project needs is in [OPERATIONS.md](OPERATIONS.md).
- **Checking a server:** `/health` answers `ok`, the players online, the uptime and `version` (from `APP_VERSION`, default `dev`), so a deploy can be checked from outside. The About panel shows that `version` too, linked to exactly that commit's code when it is one.
- **Maps:** the server loads every map in `MAPS_DIR` (default `content/maps`) and refuses to start if any fails validation; `HOME_MAP` (default `stonebrook`) is where new players start and collapsed players wake up; `ITEMS_FILE` (default `content/items.json`) holds the items and find rules, checked against the maps at start.

## Growing later

The design's layers (your cabin, your street, the town square, the wilds) map onto the same server code: a zone is a map plus the players in it, and players already only hear about their own map. When one process is not enough, zones move to separate processes (cabins and streets start on demand, the town square and busy regions get copies), with a small message bus between them for chat, parties and cross-zone presence; `zone` messages already tell the client everything it needs when it changes maps.

Production (one AWS server with Caddy, CI on every push, automatic releases with rollback, nightly backups) is described in [OPERATIONS.md](OPERATIONS.md). Still to come: a scheduled bot that signs in with a saved token, plays a little and reports when something breaks.
