# The napoland roadmap

What is done, what is being built and what comes after, one Markdown file per item in this folder. Anyone can propose a change to it with a pull request; the maintainers decide what gets merged.

To read it in order, run `npm run roadmap`. CI runs it on every pull request too, so the log of each pull request shows the roadmap as it would be after merging. On GitHub, open any file: the table at the top is the item's front matter.

## An item

`roadmap/home-stash-xp-levels.md`:

```markdown
---
id: home-stash-xp-levels
title: "Home: stash, XP and levels"
status: next
order: 10
depends: [finds-bag-piles]
area: gameplay
---

Come home and put what you carry into your stash. Stashing earns XP...

Why: it closes the loop (leave home, gather, come back)...
```

| Field | |
|---|---|
| `id` | The file name without `.md`: lowercase words joined by hyphens. Links point to it, so keep it once the item is merged. |
| `title` | A few plain words. Put it in "quotes" if it has a colon in it. |
| `status` | `done`, `now`, `next`, `planned` or `idea` (below). |
| `order` | A number that sorts the items of one status: lower comes first. |
| `depends` | Optional. The ids of items that have to come first, as `[a, b]`. No circles. |
| `area` | Optional. `gameplay`, `world`, `social` or `tech`; a new one if none fits. |

The body says what the item is and why, in plain words: what players get, and which part of the [design](../docs/DESIGN.md) it serves. Link to the design for the details instead of copying them.

## Status

| Status | Means |
|---|---|
| `done` | Live at [www.napoland.com](https://www.napoland.com). |
| `now` | Being built. |
| `next` | Comes after what is being built. A good place to help. |
| `planned` | Agreed, not started. `order` is the rough sequence. |
| `idea` | Not scheduled: proposals, and parts of the design that have no place in the order yet. New proposals start here. |

## Order

Items sort by status, then by `order`, then by id. Leave gaps of 10 (10, 20, 30) so that a new item fits between two others without touching them: between 20 and 30, take 25. Renumbering touches many files and invites conflicts, so do it rarely, in a pull request of its own. If two items of one status end up with the same number, nothing breaks: they sort by id, and `npm run roadmap` warns about it.

## Proposing a change

Everything happens in pull requests:

- **A new idea:** add `roadmap/<id>.md` with `status: idea`. Say what it is and why, and how it fits the [pillars](../docs/DESIGN.md#pillars) (no fights, no PvP, no missions; leave home and come back; farther is harder and richer; together you go farther; one fixed world). The discussion happens on the pull request. If you would rather talk first, open an issue with the idea template.
- **Changing an item** (what it covers, its order, its status): edit its file, and say why in the pull request.
- **Building an item:** say so on an issue or open a draft pull request first, so two people do not build the same thing. The pull request that finishes an item also sets it to `done`.
- **Dropping an item:** delete its file, and say why. The pull request keeps the discussion.

Before you push, run `npm run roadmap` (or `npm run check`, which runs it too): it checks the front matter, that every id matches its file name, the statuses, that `depends` points to real items and that dependencies never go round in a circle. It prints the result in order.

One file per item means two proposals rarely touch the same file, so they rarely conflict. There is no list to keep in sync anywhere: the order comes from the files.

## Who decides

The maintainers review roadmap pull requests like code and merge the ones that fit the game; the owner makes the product decisions. A proposal that is not merged is not wasted: its discussion stays on the pull request, and it can come back later.

The [design](../docs/DESIGN.md) says what the game is and why; the roadmap says in which order it gets built. When an item changes a design decision, change `docs/DESIGN.md` in the same pull request.
