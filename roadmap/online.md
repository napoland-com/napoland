---
id: online
title: Online at www.napoland.com
status: done
order: 20
area: tech
---

napoland is live at https://www.napoland.com: one server with HTTPS, players saved in PostgreSQL with nightly backups. Every change merged into `main` is tested and released on its own, and a release that does not come up healthy rolls back by itself. Limits per connection and per address keep any one client from wearing the server down.

Why: a game about playing together has to be where people can play it, and releasing each finished step means it can be played and tuned right away.

More: [docs/OPERATIONS.md](../docs/OPERATIONS.md).
