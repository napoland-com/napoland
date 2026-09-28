# Contributing to napoland

Thanks for wanting to help! napoland is young and small, and there is room for code, maps, items, ideas, bug reports and play-testing on real phones. This guide covers how to set up, what every change has to pass, how the code is organized, and how pull requests get reviewed, merged and released.

> **License.** The code is [AGPL-3.0-or-later](LICENSE); everything in [`content/`](content) (maps, rooms, items and their texts) is [CC BY-SA 4.0](content/LICENSE). By opening a pull request you agree that your contribution is shared under the same terms. For anything big, open an issue or a roadmap proposal first.

## Ways to help

- **Play** at https://www.napoland.com and report what breaks or feels wrong (use the bug report template).
- **Propose** ideas or changes to the roadmap: see [roadmap/README.md](roadmap/README.md).
- **Build** something that is `next` or `planned` on the roadmap. Say so on an issue or open a draft pull request first, so two people do not build the same thing.
- **Content**: signs, rooms, maps and items are data, and a good way in.

## Set up

You need [Node.js 24](https://nodejs.org) (npm comes with it) and git. Docker is optional: it runs the full stack with PostgreSQL, and a database for the PostgreSQL tests.

```bash
# fork the repository on GitHub, then:
git clone https://github.com/<you>/napoland.git
cd napoland
git remote add upstream https://github.com/napoland-com/napoland.git
npm install
npm run dev          # server on :8080 (in memory), game on http://localhost:5173
```

Open two tabs to see two players, or open `http://<your computer's IP>:5173` on a phone on the same Wi-Fi. `npm run bot -- --count 3 --steps 30` adds test players to a running server.

The full stack, as production runs it: `cp .env.example .env`, set `POSTGRES_PASSWORD`, then `docker compose up -d --build` and open http://localhost:8080.

## The checks

```bash
npm run check
```

runs everything a change has to pass: the type checker, the content validator (every map on its own, how they join up, and the items), the roadmap check and all tests. Run it before you push.

The tests against a real PostgreSQL run only when `DATABASE_URL_TEST` is set. For example, with Docker:

```bash
docker run --rm -d --name napoland-test-db -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:17-alpine
DATABASE_URL_TEST=postgres://postgres:postgres@localhost:5432/postgres npm test
docker stop napoland-test-db
```

CI runs `npm run check` on every pull request with a real PostgreSQL, and then checks that the generated maps are exactly what their generators make (see [Changing content](#changing-content)). A pull request can only be merged when CI passes.

## How the code works, and its rules

Read [AGENTS.md](AGENTS.md) first: the commands, the rules of the codebase, how to play-test and the hard limits, in one page. It is also the guide every AI coding agent reads (the files some agents look for, like `CLAUDE.md`, `GEMINI.md` and `.github/copilot-instructions.md`, point to it), so if you work with one, it already knows the rules. Then [docs/DESIGN.md](docs/DESIGN.md) (what the game is and why, starting with the pillars) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (how it is built).

The rules people trip over most:

- **The server decides everything.** Clients send what they want to do (a step, a turn); the server checks it and tells everyone. Never trust a client message.
- **`packages/shared` is the contract** between client and server. Change it on purpose, bump `PROTOCOL_VERSION` when old clients would break, and update both sides and their tests in the same pull request.
- **Database changes are new migrations** in `apps/server/migrations`, and they only add things, so the release before still runs on them.
- **Every screen shape must work**: phones in portrait and landscape, tablets, desktops. Nothing forces an orientation.
- **Plain words** in the interface and in the docs. Comments explain why, not what.

## Changing content

The world is data, and changing data is better than changing code.

- **Maps** are `content/maps/<id>.json`, one file per map and per room. Stonebrook, the Near Woods, the South Road, the Far Woods, Residents' Lane and every room inside a building are written by generators: `tools/gen-map.ts`, `tools/gen-woods.ts`, `tools/gen-south-road.ts`, `tools/gen-far-woods.ts`, `tools/gen-street.ts` and `tools/gen-interiors.ts`. To change one, change its generator, run `npm run gen` (all six, in the right order), then `npm run validate`, and commit the generator together with the JSON it wrote. Never edit generated JSON by hand: CI runs the generators again and fails if anything in `content/` changes.
- **Versions**: when a map changes, bump its `version` (in its generator) so that players' games reload it. The same goes for `version` in `content/items.json`.
- **Items** are `content/items.json`: what each item is, its stack size, what using it does, and where it grows. It is written by hand; `npm run validate` checks it against the maps.
- **The story** is `content/story.json`: its chapters in order, what reaches each one and what people hint while you are in it ([the design](docs/DESIGN.md#the-story-napo-and-napoland)). It is written by hand; `npm run validate` checks that the people, desks, maps and items it names exist. New chapters go at the end, and a chapter is never removed, renamed or reordered: each player's place in the story is the id of the latest chapter they reached. Bump its `version` when it changes.
- A new map needs exits both ways and a way home; `npm run validate` says what is missing.

## Tests come with changes

- Game rules get unit tests: `packages/shared/test`, and `apps/server/test/world.test.ts` for the server's rules.
- Server behavior gets tests over real WebSockets in `apps/server/test`.
- Client logic that does not need a browser gets tests in `apps/client/test`.
- Tools get tests in `tools/test`.
- Anything you can see (the world, the interface) also gets a play-test: open it at phone size in portrait (for example 390x844) and landscape, and put screenshots in the pull request.

## Commits and pull requests

- **One topic per pull request**, as small as it can be. Open a draft early if you want feedback, or to show others what you are working on.
- **Commit messages** read like the history (`git log`): a first line that says in plain words what changes, under 72 characters and without prefixes such as `feat:` (for example "Buildings you can enter, fireplaces and shelters"), then a blank line and what changed and why. Bullet points are fine.
- **The pull request title** becomes the commit on `main` (pull requests are squashed when merged), so write it the same way. Fill in the template: what and why, the checks you ran, screenshots for anything visible, and the roadmap item, if any.
- If your pull request finishes a roadmap item, set its `status` to `done` in the same pull request.
- Keep changes you did not mean out of the diff: no reformatting of code you did not touch, no stray files.
- Never commit secrets or a `.env` file.

### Working with an AI agent

Most changes here are written with AI coding agents, and that is welcome: this project is built with one. [AGENTS.md](AGENTS.md) is their guide, including the hard limits (never deploy or touch production, never use real credentials, never weaken tests). You are responsible for what you send:

- **Say in the pull request description which parts an AI wrote** (for example "all of it", "the tests", or "none"), and confirm that a person read the whole change and ran it. The pull request template asks for both.
- Read every line before you open the pull request, run `npm run check`, and play anything you can see.
- Keep the agent to one roadmap item or one fix per pull request.

## Reviews and merging

1. When you open a pull request, CI runs. The first time you contribute, a maintainer may have to approve the run before it starts.
2. A maintainer reviews it. Expect questions about tests, screen shapes, and how a change fits the [pillars](docs/DESIGN.md#pillars). One maintainer's approval is needed.
3. The branch has to be up to date with `main` before it merges, so that what CI tested is what goes live (see below).
4. A maintainer merges it, squashed into one commit.
5. `main` is released to www.napoland.com within minutes: CI tests it again, builds it and deploys it, and a release that does not come up healthy rolls back by itself.

If a pull request goes quiet for a long time, a maintainer may finish it (keeping you as a co-author) or close it with thanks.

## Pull requests and conflicts

When several people change a small game at the same time, they sometimes touch the same lines. The repository is shaped so that this happens rarely, CI catches the clashes git cannot see, and a bot tells you when your branch needs updating.

### How conflicts are kept rare

- **Small files.** One file per roadmap item (`roadmap/<id>.md`), per map and per room (`content/maps/<id>.json`), per migration. Two pull requests about different things rarely edit the same file. There is no central list to keep in sync: the roadmap's order comes from its files.
- **Generated content is never merged by hand.** When two branches both changed generated maps, merge the generators (they are code), then take main's JSON and run `npm run gen` again, so the JSON is exactly what the merged generators make. CI checks this on every pull request. `package-lock.json` is generated too: take main's version and run `npm install`.
- **Numbers that have to stay unique.** Git cannot see these clashes, so check them whenever you update your branch:
  - Migrations run in name order, once each. If `main` got a migration with the same number as yours, give yours the next free number. Never change a migration that is already on `main`.
  - `PROTOCOL_VERSION`, a map's `version` and the `version` in `content/items.json` and `content/story.json` make players' games reload when they change. If `main` bumped the same version you bumped, bump it once more, so players get both changes.
- **Short-lived branches.** The longer a branch lives, the more `main` moves under it. Small pull requests merge before they drift.

### When main moves on

A workflow ([.github/workflows/conflicts.yml](.github/workflows/conflicts.yml)) looks at every open pull request whenever `main` changes and whenever a pull request is opened or updated. When yours no longer merges cleanly, it adds the `conflicts` label and leaves one comment with these steps. Once your branch merges cleanly again, the label comes off by itself. (If it conflicts again later, you get the label and one comment again.)

To update your branch, merge `main` into it. That needs no force push and keeps the review comments where they were:

```bash
git fetch upstream
git merge upstream/main
# 1. Fix the conflicts in code by hand, the generators included; then git add those files.
# 2. Generated maps: take main's version and generate them again.
git checkout upstream/main -- content/maps && npm run gen && git add content/maps
# 3. The lock file: take main's version and install again.
git checkout upstream/main -- package-lock.json && npm install && git add package-lock.json
git commit
npm run check
git push
```

(Steps 2 and 3 only if those files conflicted.) Rebasing works too (`git rebase upstream/main`, then `git push --force-with-lease`). It makes a tidier branch, but it rewrites commits that reviewers have already seen, so merging is the default here. Your pull request is squashed when it is merged, so `main` stays tidy either way.

When your branch is only behind `main`, without conflicts, the **Update branch** button on the pull request does the merge for you.

Stuck, or short on time? Say so on the pull request. Keep **Allow edits by maintainers** ticked (it is by default) and a maintainer can update your branch for you.

### What maintainers do

- **`main` is protected.** Changes come in through pull requests. The CI `check` job has to pass, the branch has to be up to date with `main`, and one maintainer has to approve. Nobody force-pushes to `main` or deletes it. The exact settings, as a proposal, are in [docs/MAINTAINING.md](docs/MAINTAINING.md).
- **Every merge to `main` goes to production.** CI tests it and releases it to www.napoland.com a few minutes later. That is why the checks are strict, and why a branch has to be up to date before it merges: two pull requests that each pass on their own can still break when they meet.
- **Updating a contributor's branch.** With "Allow edits by maintainers" on, a maintainer can press **Update branch**, or check the branch out (`gh pr checkout <number>`), merge `main` into it, fix the conflicts, regenerate what is generated, and push. Maintainers merge `main` into contributors' branches rather than rebase them, so nobody's copy is rewritten under them.
- **Later, a merge queue.** If the repository moves to a GitHub organization, a merge queue can take over "up to date before merging": it tests each pull request on top of the ones queued before it and merges them in order, so nobody has to update branches by hand.

## Bugs, security and conduct

- Bugs and ideas: open an issue with one of the templates.
- Security problems: report them privately, as [SECURITY.md](SECURITY.md) explains. Never in a public issue, and never test against www.napoland.com.
- Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).
