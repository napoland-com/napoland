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
2. Walk out through the town into the wilds. Energy drains outside town, faster the farther you are, at night and in the rain. Street lights and home refill it.
3. Gather resources and power-ups. What you pick up goes in your bag (limited slots).
4. Come home and stash what you carry. Stashing earns XP; levels and home upgrades let you go farther next time.
5. **If your energy runs out** you wake up at home. Your whole bag drops where you fell, as a backpack anyone can take, you included if you go back for it. Equipment is kept.

## World structure

| Layer | Who shares it | Notes |
|---|---|---|
| Your cabin | Only you (and guests you invite later) | Upgradeable. Holds your stash and the gear locker. |
| Your street | About 30 neighbors | Streets fill up; new streets open as players join. Friends can live on the same street. |
| Town square (Stonebrook) | Everyone | Workbench, notice board, the road out. Splits into copies of ~150 players when crowded, keeping friends together. |
| The wilds | Everyone | One fixed map split into regions. A region holds a few hundred players; only an overcrowded region gets extra copies. The game remembers which copy a dropped backpack is in. |

Everything in the world is shared (the ground, dropped backpacks, weather, time of day); only inventory and personal items are private.

## Movement and controls

- **Tile by tile** in four directions, like Pokemon FireRed, at **one speed** (a steady run). No sprint button.
- **Controls:** a **joystick** bottom left (it picks one of four directions), **A** (pick up, talk, open) and **B** (bag, back) bottom right. No text labels on the buttons.
- Joystick: a quick flick in a new direction **turns in place**; holding walks; the direction you already face walks at once; changing direction while walking does not stop.
- Tapping the ground walks there along the shortest path. Tapping a person or a sign walks up to it and talks.
- Top right there is only a **menu button**. **No map, ever:** napoland is a mapless game, you learn the world by walking it (and players share what they learn).
- The text box and the bag **never cover A and B**, so B can always close them. In portrait they sit above the controls; in landscape they take the joystick's side (it hides while you read). Pushing the joystick or tapping the world closes the bag and the menu.
- Mobile first. On desktop the mouse acts as a finger; nothing needs a keyboard.

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

## Look and feel

- Low-poly 3D with the structure of Pokemon FireRed: a steep, almost top-down camera over a tile grid, ledges and walls of trees, chunky chibi characters, two-tone toon shading with outlines, a text box at the bottom for talking.
- A **dark world** in the mood of **Pacific Drive**: a Pacific Northwest forest of tall firs, fog, rain, night, abandoned cabins, orange sodium street lights, utility poles, glowing anomalies (the Old Stone, wisps).
- Dark interface: dark panels with cream borders, Fredoka and Nunito fonts.
- **Any screen shape works:** nothing forces portrait or landscape. The camera shows the same circle of world around you on every screen; controls sit in the thumb corners and are sized from the short side; panels open where they cover the least.

## Platform

A web game for phones first (any modern browser), also playable on desktop. It can later be packaged for app stores and Steam without a rewrite. See [ARCHITECTURE.md](ARCHITECTURE.md).
