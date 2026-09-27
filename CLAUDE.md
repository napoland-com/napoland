# Working on napoland

@AGENTS.md

## Claude Code

- Before changing behavior, read [docs/DESIGN.md](docs/DESIGN.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The owner makes the product decisions; ask before changing a decision written there.
- The owner is the maintainer, and has their own Claude sessions build, test, play-test, release and maintain the game. In those sessions, on the owner's computer (the one with the `napoland` AWS profile), releasing is pushing to `main` when the owner asks; follow the release and check production as [docs/OPERATIONS.md](docs/OPERATIONS.md) describes. Changes to the AWS stack and deleting anything stay the owner's to run. Every other session keeps all of the hard limits above.
- Play-test in the built-in browser pane, at phone size (for example 390x844) and in landscape. The pane only starts servers from the main checkout's `.claude/launch.json`; in a worktree, run `npm run dev` yourself. If the pane is hidden, pump the game as the play-testing notes above say.
