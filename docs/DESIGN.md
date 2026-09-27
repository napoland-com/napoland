# napoland: game design

The decisions so far, with the reason for each. Change this file when a decision changes.

## The pitch

**Pacific Drive without the car, as an online game for phones.** You live in a cabin in Stonebrook, a small town at the edge of a strange, dark forest. You go out to gather what the forest gives (resources, power-ups), and you have to come back before your energy runs out. The farther you go, the more dangerous it gets and the better the finds. Alone you can explore the near woods; to go really far, you need other people.

## Pillars

1. **No fights, no PvP, no missions.** Tension comes from the world: distance, energy, weather, night, creatures that chase you, anomalies. Other players are only ever help.
2. **Leave home, come back.** Every trip is a decision: one more find, or turn back now. Trips last 5 to 15 minutes, which suits phones.
3. **Farther is harder and richer.** Difficulty and rewards grow with distance from home.
4. **Together you go farther.** Deep areas need several people (see Cooperation).
5. **One fixed world you learn.** The map does not reshuffle, so players can share guides, routes and strategies. It grows over time as new regions are added farther out.

## The loop

1. Wake up at home (your cabin). Equip gear. Equipment can be put on or taken off **only at home**, so choosing gear is part of planning a trip.
2. Walk out through the town into the wilds. Energy drains in the wilds, faster the farther you are, at night and in the rain; in town and inside buildings it holds. The only way to get it back is **a fireplace**: shelters out in the wilds (and some buildings, your home among them) keep one burning, always. Sit near it and you recover. Tuned so that standing at the edge of the Near Woods in the rain empties a full bar in about 5.5 minutes, and its deepest corner in under 2.
3. Gather resources and power-ups. What you pick up goes in your bag (limited slots). Finds are shared: when someone takes one, a new one of the same kind grows later somewhere else in the same kind of place (deep finds stay deep).
4. Come home and stash what you carry. Stashing earns XP; levels and home upgrades let you go farther next time.
5. **If your energy runs out** you wake up at home. What you carried falls out where you collapsed, as a small pile on the ground (the bag itself is equipment and stays with you, like all equipment). If you go back for it, you get everything. If someone else finds it first, they get a random half and the rest is lost. The pile disappears one hour after you collapsed, and a new collapse replaces your old pile: each player has at most one.

**Light is not energy.** Street lights, and later torches and gadgets, let you see where you walk; some areas will be almost dark without them. They do not refill energy.

**Every building can be entered**, like in FireRed: walk into the door and you are inside a small room (a map of its own). Shelters and some houses have a fireplace; empty houses are dark.

## World structure

| Layer | Who shares it | Notes |
|---|---|---|
| Your cabin | Only you (and guests you invite later) | Upgradeable. Holds your stash and the gear locker. |
| Your street | About 30 neighbors | Streets fill up; new streets open as players join. Friends can live on the same street. |
| Town square (Stonebrook) | Everyone | Workbench, notice board, the road out. Splits into copies of ~150 players when crowded, keeping friends together. |
| The wilds | Everyone | One fixed map split into regions. A region holds a few hundred players; only an overcrowded region gets extra copies. The game remembers which copy a dropped backpack is in. |

Everything in the world is shared (the ground, dropped backpacks, weather, time of day); only inventory and personal items are private.

Regions are separate maps joined at their edges, like FireRed's towns and routes: walking off the end of a road fades to the next map, which greets you with its name. So far: **Stonebrook** (the town) and, up its north road, **the Near Woods** (depth 1). Deeper regions will open beyond it.

## Movement and controls

- **Tile by tile** in four directions, like Pokemon FireRed, at **one speed** (a steady run). No sprint button.
- **Controls:** a **joystick** bottom left (it picks one of four directions), **A** (pick up, talk, open) and **B** (bag, back) bottom right. No text labels on the buttons.
- Joystick: a quick flick in a new direction **turns in place**; holding walks; the direction you already face walks at once; changing direction while walking does not stop.
- Tapping the ground walks there along the shortest path. Tapping a person or a sign walks up to it and talks.
- Top right there is only a **menu button**. **No minimap and no position marker, ever:** you learn the world by walking it (and players share what they learn). The one map is an old **paper map drawn by hand**, a permanent tool in your bag: it shows the region's roads, trails, cabins and landmarks but never where you are, so you work that out from what you see around you (planned: [paper-map](../roadmap/paper-map.md)).
- The text box and the bag **never cover A and B**, so B can always close them. In portrait they sit above the controls; in landscape they take the joystick's side (it hides while you read). Pushing the joystick or tapping the world closes the bag and the menu.
- Mobile first. On desktop the mouse acts as a finger, and the keyboard is a shortcut, never a need: **WASD** or the **arrow keys** walk (with the joystick's rules), **Enter** is A and **Backspace** is B (planned: [keyboard-controls](../roadmap/keyboard-controls.md)).

## Creatures

Creatures do not fight. They chase. You are a little faster than them, so you escape by moving away in time. If one catches you, you lose energy and drop something. They do not follow you into town or under a street light.

## Cooperation (how groups go farther)

Ideas to build and test:

- **Shared light:** deep areas drain energy fast unless you stand in someone's lantern light; more lanterns mean a bigger safe area.
- **Group gates:** some passages open only with several people pulling at once.
- **Rescue:** friends can carry you home when you collapse near them.
- **Heavy finds:** the best finds need two people to carry.
- **Camps:** a group can build a shared camp that works as a temporary home out in the woods.
- Solo players must still progress: better gear lets them go a bit deeper, just more slowly.

## Weather, seasons, day and night

Each region has its own climate (rainforest, snowy ridge, marsh, burnt forest...), its own weather cycle and seasons, and there is day and night. Weather changes what you find (glowcaps after rain, shards at night, frozen lakes you can cross in winter) and how dangerous it is. The server owns all of it, so everyone sees the same sky.

## Hazards, anomalies and resistances

Like in Pacific Drive, the world itself wears you down, on top of the steady drain of being out there. Five elements, each with its own resistance:

| Element | Comes from (examples) |
|---|---|
| **Heat** | the burnt forest, summer afternoons, fire anomalies |
| **Cold** | night, winter, the snowy ridge, being wet in the wind |
| **Wind** | storms, open ridges and clearings |
| **Electricity** | electrical storms, flashes, broken power lines |
| **Radiation** | glowing anomalies, shards, the deepest places |

- **Anomalies are events**, shared by everyone on the map and announced before they hit so you can react: a **storm** rolls in over a region (wind, electricity, less to see); a **flash** marks a patch of ground that glows and then discharges; a **surge** near the Old Stone and the shards. Being caught costs energy, less with the right resistance. Some anomalies leave rare finds behind.
- A shelter protects from everything outside. Resistance never makes you immune: it cuts the loss (a percentage per element).

## Equipment and stats

Six slots: **cap, shirt, gloves, pants, shoes, bag**. Better equipment means better resistances, so you can stay out longer and go where the weather or the anomalies would stop you.

- Each piece gives resistances to some elements (a raincoat: wind and cold; rubber gloves and boots: electricity; a lead-lined cap: radiation). Some also give a little extra energy.
- The **bag** decides how many slots you carry (a tote 6, a backpack 8, a hiking pack 12, an expedition pack 16).
- Gear comes in tiers (worn, sturdy, rugged, expedition, anomalous). It comes from **crafting at the town's workbench** with what you bring home, from rare finds deep in, and from trading with friends.
- Gear is put on and taken off **only at home**, so choosing it is part of planning a trip. It is kept when you collapse. Your character wears what you equip, so others see your gear.

## Items

Everything is data (`content/items.json`: name, what it is, stack size, stats, where it grows), so the list can grow and be tuned without code. A first set:

- **Resources** (for crafting and XP): glowcaps, fir resin, scrap metal, copper wire, cloth scraps, anomaly shards (rare, deep in).
- **Consumables** (used from the bag): a thermos (+30 energy), hand warmers (cold resistance for a while), rad tablets (radiation resistance for a while).
- **Equipment**: a few pieces per slot and tier, starting with worn clothes everyone has.

## Status

A status tab (in the menu) shows your level and XP, energy (maximum, now, and what is draining it at the moment, element by element), your five resistances with where they come from (each piece of gear), and any effects running (a hand warmer, a storm you are in).

## Together: chat and friends

- **World chat** for everyone online, and **local chat** for whoever is near you: it shows as a speech bubble over your head (FireRed style) and in the chat log. Reached from the menu; the menu button shows a dot when there is something new.
- **Friends**: send a request (tap a player, or by name), accept or decline; the friends list shows who is online and where they are. **Private messages** between friends, kept until read.
- **Exchange, face to face only**: two friends on the same map, at most **10 tiles** apart, open a trade: each puts in items or gear, both confirm the final offer, and the server swaps them in one step (nothing can go missing halfway). Walking farther apart cancels it.
- **Settings** (in the menu): anyone can turn off friend requests and trade requests.
- Safety from day one: limits on length and speed, a word filter, block and report.
- **Sign-in first**: chat, friends and items are worth keeping, so players sign in before these go to the public. Today that is **an email and a one-time code, through Supabase Auth**; Google and Apple come later, through the same sign-in ([sign-in-google-apple](../roadmap/sign-in-google-apple.md)). The game server checks the Supabase login and keeps its own players and game data in its own database; a character made before sign-in, which lived only in the browser that made it, is claimed by signing in on that browser.

## Roadmap

The roadmap lives in [roadmap/](../roadmap/): one file per item, each with its status (done, now, next, planned or idea) and its order. `npm run roadmap` prints it in order. It changes through pull requests, like the code; [roadmap/README.md](../roadmap/README.md) explains how. Each step goes live when it is done, so it can be played and tuned.

## Look and feel

- Low-poly 3D with the structure of Pokemon FireRed: a steep, almost top-down camera over a tile grid, ledges and walls of trees, chunky chibi characters, two-tone toon shading with outlines, a text box at the bottom for talking.
- A **dark world** in the mood of **Pacific Drive**: a Pacific Northwest forest of tall firs, fog, rain, night, abandoned cabins, orange sodium street lights, utility poles, glowing anomalies (the Old Stone, wisps).
- Dark interface: dark panels with cream borders, Fredoka and Nunito fonts.
- **Any screen shape works:** nothing forces portrait or landscape. The camera shows the same circle of world around you on every screen; controls sit in the thumb corners and are sized from the short side; panels open where they cover the least.

## References

Games we learn from when designing what comes next:

- **Pacific Drive** (Ironwood Studios): the mood (a dark Pacific Northwest forest, rain, abandoned things, glowing anomalies), and the loop of leaving a safe place, pushing your luck out there and coming back changed. Anomalies and storms that wear you down.
- **Pokémon FireRed** (Game Freak): the structure: a tile grid under a steep camera, towns and routes as separate maps, every building enterable, a text box for talking, controls that stay simple.
- **The Long Dark** (Hinterland Studio): survival as quiet pressure: cold, wind and exposure, fire as the thing that keeps you going, cabins to scavenge and shelter in, and maps drawn by hand that never show where you are, so you learn the land by its landmarks.

## Platform

A web game for phones first (any modern browser), also playable on desktop. It can later be packaged for app stores and Steam without a rewrite. See [ARCHITECTURE.md](ARCHITECTURE.md).
