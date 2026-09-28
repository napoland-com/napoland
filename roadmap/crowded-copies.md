---
id: crowded-copies
title: Copies of crowded places
status: done
order: 500
area: tech
---

When the town square gets crowded, it splits into copies of about 150 players, keeping friends together. A region of the wilds holds a few hundred players, and only an overcrowded one gets extra copies. The game remembers which copy a dropped pile is in.

Built: 150 to a copy of the town square and 300 to a copy of a region, counting the rooms off it, which follow the copy they are entered from. You come into a friend's copy if it has room, else the first with room; an empty copy closes. Nothing ever tells you which copy you are in.

Why: so the game can grow without its busiest places turning into a crowd you cannot move in. The server already keeps each copy of a map apart (who hears whom, its finds, fires and creatures, and the copy a pile lies in: [Zones](../docs/ARCHITECTURE.md#zones)); what is left is when a place splits, and who goes into which copy.

More: [World structure](../docs/DESIGN.md#world-structure), [Growing later](../docs/ARCHITECTURE.md#growing-later).
