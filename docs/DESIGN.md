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
2. Walk out through the town into the wilds. Energy drains in the wilds, faster the farther you are, at night and in the rain; in town and inside buildings it holds. The only way to get it back is **a fireplace**. Fires in town (your home's, the lodge's) are tended and never go out, and so is the fire of the shelter nearest to town (the Near Woods' old cabin), so a new player always has one safe fire. **The other fires out in the wilds burn down**: a well-fed one gives energy back at the full rate, a low one (under 3 minutes of fuel) only glows and gives 40%, a dead one gives nothing. Anyone can feed one (A, facing it) with what burns: resin (5 minutes), cloth (1.5); a fire holds 30 at most. So players keep the shelters going for each other without ever meeting, and whoever arrives cold at a dead fire had better carry resin. Tuned so that standing at the edge of the Near Woods in the rain, dry and light, empties a full bar in about 5.5 minutes, and its deepest corner in under 2.
   - **What else wears you down out there** (each a factor on the drain): a **heavy bag** (items weigh something; at 10 kg or more the drain is 40% faster, so every find is a choice), being **wet** (rain soaks you through in 2.5 minutes, anywhere outdoors; soaked drains 50% faster; a burning fire dries you in 25 seconds, a roof slowly), a **surge** (below), and a **hitchhiker**: at night, 25 steps or more from home and away from light, something may cling to your back (50% faster) until you reach a street light, a burning fire, a roof or light a flare.
3. Gather resources and power-ups. What you pick up goes in your bag (limited slots). Finds are shared: when someone takes one, a new one of the same kind grows later somewhere else in the same kind of place (deep finds stay deep).
4. Come home and stash what you carry. Stashing earns XP; levels and home upgrades let you go farther next time.
   - **Built:** the stash is the chest by the fire at home (A, facing it); each player sees only their own things in it. Everything put in earns its item's XP (`xp` in `content/items.json`: a glowcap 1, resin 2, scrap 3, a shard 12, a strange object 15, a charm 25...), once: what you take out and bring back earns nothing again, and what you use up after taking it out (a thermos drunk, resin burned) no longer counts against new finds, so XP cannot be farmed. Reaching level L takes 30 × (L − 1)² XP in all (level 2 at 30, 5 at 480, 10 at 2,430, 20, the top, at 10,830), and every level makes the energy bar 5 bigger (100 at level 1, 195 at 20). Home upgrades wait for your own cabin.
5. **If your energy runs out** you wake up at home. What you carried falls out where you collapsed, as a small pile on the ground (the bag itself is equipment and stays with you, like all equipment). If you go back for it, you get everything. If someone else finds it first, they get a random half and the rest is lost. The pile disappears one hour after you collapsed, and a new collapse replaces your old pile: each player has at most one.

**Light is not energy.** Street lights, and later torches and gadgets, let you see where you walk; some areas will be almost dark without them. They do not refill energy, but they shelter you from a surge and shake off a hitchhiker.

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
- Mobile first. On desktop the mouse acts as a finger, and the keyboard is a shortcut, never a need: **WASD** or the **arrow keys** walk (with the joystick's rules), **Enter** is A and **Backspace** is B. Keys are read by where they sit, so WASD is the same four keys on any layout (ZQSD on a French one); with several direction keys held, the last one pressed wins. Behind the sign-in cards, and in any text field, the keys stay the page's.

## Creatures

Creatures do not fight. They chase. You are a little faster than them, so you escape by moving away in time. If one catches you, you lose energy and drop something. They do not follow you into town or under a street light.

The first kind are the **watchers** of the Near Woods (three, in its deeper half): tall figures with pale blank faces that come closer **only while nobody on the map looks their way** (faces them, with the four-way facing everyone already has). Face one and it freezes; a friend facing it holds it for you. Out of the light and within 9 steps, it walks toward you (slower than you walk); reaching you, it takes 15 energy and one thing you carry, then goes away for a minute or two. They never stand in light, next to a fire or near a flare. On aurora nights they are faster.

## Cooperation (how groups go farther)

Built so far, working even when nobody is online at the same time:

- **Shelter fires** (all but the nearest one) burn down and anyone can feed them: you arrive at a fire someone else kept going.
- **Marks**: crush a glowcap (Use in the bag) to paint a glowing arrow on the ground where you stand, pointing where you face, in your jacket color. Everyone sees it for a day; each player keeps their newest 6. Routes spread without a map.
- **The notice board** in Stonebrook, next to Mira: the weather and when it changes, each region's surge clock, which shelter fires are low or out, the collapses of the last hour, the Old Stone.
- **The Old Stone** wakes when the whole server has fed it 20 shards (A, facing it). Awake, it halves the extra drain of every surge, and burns a shard every 30 minutes; at none left it sleeps, and the count starts again. It is kept across restarts. (It is where a new region will open, later.)
- **Echoes**: a pile keeps the last 16 steps its owner walked out there; near it, a pale figure walks them again and sinks where they fell. You see where it went wrong.

Ideas to build and test:

- **Shared light:** deep areas drain energy fast unless you stand in someone's lantern light; more lanterns mean a bigger safe area.
- **Group gates:** some passages open only with several people pulling at once.
- **Rescue:** friends can carry you home when you collapse near them.
- **Heavy finds:** the best finds need two people to carry.
- **Camps:** a group can build a shared camp that works as a temporary home out in the woods.
- Solo players must still progress: better gear lets them go a bit deeper, just more slowly.

## Weather, seasons, day and night

Each region has its own climate (rainforest, snowy ridge, marsh, burnt forest...), its own weather cycle and seasons, and there is day and night. Weather changes what you find (glowcaps after rain, shards at night, frozen lakes you can cross in winter) and how dangerous it is. The server owns all of it, so everyone sees the same sky.

So far there is one day for the whole world, 48 minutes long and set by the wall clock (so a restart never jumps the sky, and players can learn it): 12 overcast, 12 rain, 8 overcast, 16 night. **Every third night is an aurora**: green light, the dead power lines hum and glow, copper wire turns up by the poles (finds that grow only then), watchers are restless. Only rain soaks you, so only rain falls on screen. Weather per region is still to come ([regional-weather](../roadmap/regional-weather.md)); so far a region's own weather is its storms (Hazards below).

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
- **Surges are built** (before the elements): each region can have a surge clock, fixed to the wall clock so everyone learns it ("the woods surge at a quarter to"). The Near Woods: every 40 minutes, 6 restless, then a surge of 2.5 minutes. Restless, rare finds show up deep in (shards, strange objects), and they are gone when the calm comes back: the best loot sits right before the danger. The surge's front starts at the deepest tile and reaches the way home in 90 seconds; wherever it has passed, away from a street light, energy drains 3 times as fast. Every phase is announced with a banner, and a clock shows in the status panel.
- **Storms and flashes are built.** Each region can have a storm clock, fixed to the wall clock like its surges. The Near Woods: every 40 minutes, halfway between two surges, a storm is announced a minute before and blows for 3 minutes. Out in it energy drains 1.5 times as fast (wind and electricity each cut half of the extra), it soaks you like rain, and being wet in its wind chills you half as much again (cold). The sky darkens, the fog closes in, lightning blinks. While it blows, shards turn up by the old poles. A flash starts every minute and a quarter near someone 30 steps or more out, often right under them: the ground glows for 8 seconds, faster and brighter, then discharges for 4 (a spark is electric, a fire flash hot); standing in it drains 6 times as fast. The status panel says what drains you, element by element.
- A shelter protects from everything outside. Resistance never makes you immune: it cuts the loss (a percentage per element).

## Equipment and stats

Six slots: **cap, shirt, gloves, pants, shoes, bag**. Better equipment means better resistances, so you can stay out longer and go where the weather or the anomalies would stop you.

- Each piece gives resistances to some elements (a raincoat: wind and cold; rubber gloves and boots: electricity; a lead-lined cap: radiation). Some also give a little extra energy.
- The **bag** decides how many slots you carry (a tote 6, a backpack 8, a hiking pack 12, an expedition pack 16).
- Gear comes in tiers (worn, sturdy, rugged, expedition, anomalous). It comes from **crafting at the town's workbench** with what you bring home, from rare finds deep in, and from trading with friends.
- Gear is put on and taken off **only at home**, so choosing it is part of planning a trip. It is kept when you collapse. Your character wears what you equip, so others see your gear.
- **Built:** everyone starts in worn clothes (they resist nothing) and a backpack (8 slots). The chest at home is where gear goes on and comes off: tap a piece you wear to put it in the stash, tap gear in the stash to put it on (what it replaces goes into the stash); the bag can be changed, never taken off, and a smaller one has to hold what you carry. The **workbench in Stonebrook Lodge** makes gear from what your stash holds, into your stash (recipes are data: `recipes` in `content/items.json`). Sturdy gear takes cloth, resin, scrap and wire; rugged and expedition gear takes shards too; anomalous gear only comes out of strange objects. Bags: a backpack 8, a hiking pack 12, an expedition pack 16. Some pieces add energy to the bar.
- **What resistances do so far** (the five elements are in Hazards below): **cold** softens the extra drain of rain, night and aurora and of being wet; **wind** slows how fast rain soaks you (a raincoat); **electricity** and **radiation** each cut half of a surge's extra drain, so full protection takes both; **wind** and **electricity** each cut half of a storm's extra drain; **heat** cuts a fire flash's, **electricity** a spark's (welding gloves are the first heat gear). Resistances add up over what you wear and stop at 75%.
- Still to come ([gear-wear-quirks](../roadmap/gear-wear-quirks.md)): gear that wears out and is mended at the workbench, and quirks on anomalous gear.

## Items

Everything is data (`content/items.json`: name, what it is, stack size, stats, where it grows), so the list can grow and be tuned without code. A first set:

- **Resources** (for crafting and XP): glowcaps (they paint marks), fir resin and cloth scraps (they burn), scrap metal (heavy), copper wire, anomaly shards (rare, deep in; the Old Stone wants them).
- **Consumables** (used from the bag): a thermos (+30 energy), a road flare (45 seconds of red light: creatures keep off, a hitchhiker lets go), hand warmers (cold resistance for a while), rad tablets (radiation resistance for a while).
- **Strange objects**, found deep in (more while a region is restless): what they are shows only when you look at them in town, in the light (a house in town counts). Mostly shards, a thermos or flares; now and then a charm.
- **Charms** work while they are in your bag, one of each kind: a warm pebble (rain soaks you 40% slower), a hollow feather (your bag feels 25% lighter), a humming bead (hitchhikers find you 60% less often). They stand in for the quirks of anomalous gear until equipment exists.
- Every item has a **weight** (it shows in the bag with what burns and what a charm does).
- **Equipment**: a few pieces per slot and tier, starting with worn clothes everyone has.

## Status

A status tab (in the menu) shows your level and XP, energy (maximum, now, and what is draining it at the moment, element by element), your five resistances with where they come from (each piece of gear), and any effects running (a hand warmer, a storm you are in).

Built so far: energy, how wet you are, your load, what clings to you, your charms, the surge, the Old Stone, and your **feats**. Feats are small perks for good, earned by what you do out there, not bought: Rain walker (1,500 steps in the rain: rain soaks you 20% slower), Night owl (1,000 steps in the dark: hitchhikers half as often), Pack mule (800 steps with a heavy bag: it feels 15% lighter), Fire keeper (20 fires fed: fires warm you 15% faster). Earning one is announced with a banner.

Your level shows next to your name, and the Status panel starts with your level and the XP to the next one.

## Together: chat and friends

- **World chat** for everyone online, and **local chat** for whoever is near you: it shows as a speech bubble over your head (FireRed style) and in the chat log. Reached from the menu; the menu button shows a dot when there is something new.
- **Friends**: send a request (tap a player, or by name), accept or decline; the friends list shows who is online and where they are. **Private messages** between friends, kept until read.
  **Built:** Friends in the menu (a dot there when someone asked you or wrote you): ask by name, answer requests, see friends online and on which map, open someone's card to write to them, unfriend, block or report them. Tapping a player's name tag opens their card. Messages are deleted from the server once read, so a conversation lasts only as long as the session. Blocking ends a friendship and keeps them from asking or writing again; whoever is blocked hears only that you take no requests. Reports are kept for the maintainers with what was written, as the reporter quoted it. A setting turns friend requests off. Limits: 200 characters a message, 20 a minute, 50 unread from one friend, 20 requests waiting. The word filter comes with chat.
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
