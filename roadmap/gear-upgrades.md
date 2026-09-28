---
id: gear-upgrades
title: Gear upgrades, +1 to +9
status: done
order: 310
area: gameplay
depends: [workbench-at-home, gear-details, ask-first]
---

At the workbench, a piece of gear can be upgraded from +1 up to +9, like in Metin2. Each level costs materials, more and rarer the higher it goes: scrap, cloth and wire for the first levels, shards from +4, and strange objects for the last three. Each level makes the piece resist 5% more of what it already resists and wear 5% more slowly, so a +9 raincoat keeps out almost half again as much rain and wind and lasts almost half again as long out there.

Up to +6 an upgrade always works. From +7 it can fail: it works 70% of the time at +7, 50% at +8 and 30% at +9, and it asks first with the materials and the odds ([ask-first](ask-first.md)). A failure costs the materials and nothing else: the piece keeps its level, never breaks and never goes down. Worn clothes (which resist nothing) and bags (whose size is the point) are not upgraded; every other tier is, anomalous gear too. The level shows after the name everywhere ("Raincoat +3"), stays with the piece in the chest, the bag and a trade, and mending costs the same at any level.

As built: pieces you wear and pieces in the stash can be upgraded, paid from the stash; what each level costs and how often it works are data (`upgrades` in `content/items.json`), and the server rolls the dice. The workbench lists each piece that can go higher under Upgrade, between Mend and Make, with its next level, what that takes against the stash and its odds; its card shows what the next level changes ("Wind 35% → 37%", and how long it lasts out there), and Upgrade asks first ("Upgrade your raincoat to +7? It uses 4 shards and a strange object. It works 7 times in 10."). The text box says what happened: "The raincoat is +7 now." or "It did not take. The raincoat stays +6, and the materials are gone." The level shows in gold on a piece's slot in the chest, the bag and the Wearing rows, and after its name on its card, at the workbench, in the status panel's wear row, and in what the text box and a creature's touch say about it; it goes with the piece into the bag and a pile ([gear-on-the-road](gear-on-the-road.md)).

Why: gear stops being finished once you have your set, and spare materials get a long use (pillar 3: the deep finds, shards and strange objects, pay for the top levels). Resistances still stop at 75% in all, so no upgrade makes anyone immune.

More: [Equipment and stats](../docs/DESIGN.md#equipment-and-stats).
