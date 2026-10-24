# Working on napoland

@AGENTS.md

## Claude Code

- Before changing behavior, read [docs/DESIGN.md](docs/DESIGN.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The owner makes the product decisions; ask before changing a decision written there.
- The owner is the maintainer, and has their own Claude sessions build, test, play-test, release and maintain the game. In those sessions, on the owner's computer (the one with the `napoland` AWS profile), releasing is pushing to `main` when the owner asks; follow the release and check production as [docs/OPERATIONS.md](docs/OPERATIONS.md) describes. Changes to the AWS stack and deleting anything stay the owner's to run. Every other session keeps all of the hard limits above.
- Play-test in the built-in browser pane, at phone size (for example 390x844) and in landscape. The pane only starts servers from the main checkout's `.claude/launch.json`; in a worktree, run `npm run dev` yourself. If the pane is hidden, pump the game as the play-testing notes above say.

## Who does what

The main session decides, and hands out the work. It writes changes to `packages/shared` and the protocol itself, because those need the whole picture.

| Need | Use |
|---|---|
| Should the game do this, and how? A rule, an item, a region, a HUD change, a story beat | `design-advisor` agent, before building |
| Where is X, what calls Y | `Explore` agent (or `cavecrew-investigator` when installed) |
| A plan for a change that touches several parts | `Plan` agent |
| One or two files, obvious scope | Do it yourself |
| Three or more independent pieces of work | `/octopus <task>`: workers build, a reviewer checks each |
| Bugs in the diff before pushing | `/code-review` |
| Anything a player can see or press | `playtester` agent, before calling it done |

The `.claude/hooks/guard.sh` hook refuses shell commands that touch AWS, `tools/deploy.mjs`, `infra/` or `deploy/`. That is the hard limit above, made mechanical.
