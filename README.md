# napoland

**Leave home, gather what glows, and get back before your energy runs out.**

napoland is an online exploration game made for phones (desktops work too), played in the browser at **https://www.napoland.com**. You live in Stonebrook, a small town at the edge of a dark Pacific Northwest forest. Out there, under the firs and the rain, mushrooms glow, abandoned cars rust by the old road and a few cabins keep a fire burning. The farther you walk, the better the finds and the faster your energy drains, so every trip is a choice: one more find, or turn back now. There are no fights, no PvP and no missions. Other players are only ever help, and to go really far you will need them.

It plays like a low-poly Pokemon FireRed in the mood of Pacific Drive: tile by tile, a joystick and two buttons, fog, rain and orange street lights. Nothing on screen ever shows where you are: you learn the world by walking it.

napoland is **open source and made by its community**. It is published by **Angelo Lamonaca (Neuramare)**; legal notice: https://www.neuramare.com.

<!-- Screenshot placeholder: add a phone screenshot (for example docs/images/stonebrook.png, taken at 390x844) and show it here. -->
> **Screenshot coming soon.** Until then, the quickest look is https://www.napoland.com.

## The story

**N.A.P.O., the National Anomalous Phenomena Observatory**, was set up to study strange environmental phenomena, and it came to Stonebrook for the hum of the Old Stone. It built a research station down the south road, a tower to listen with, a bunker and a checkpoint. Then NAPO answered the hum, and something went wrong: the woods lit up, the first surge rolled toward town and the Old Stone cracked. The land around it became unstable, dangerous, and in the end abandoned or quarantined. People started calling the whole affected region **Napoland**.

That is where the game takes place, and you are one of the Napoland residents who stayed or came back. Down the south road, what NAPO left behind still stands: the research station and its laboratory, the NAPO Tower, the bunker and the checkpoint on the quarantine line, with NAPO's logs and warning signs to read and a few people who remember. No mission will tell you the story; the world does, and the people in it. More in the [design](docs/DESIGN.md#the-story-napo-and-napoland).

## Run it on your computer

You need [Node.js 24](https://nodejs.org) (npm comes with it) and git. Docker is optional.

```bash
git clone https://github.com/napoland-com/napoland.git
cd napoland
npm install
npm run dev
```

Open http://localhost:5173. The game server runs on port 8080 and keeps everything in memory, and the page reloads as you edit. Open a second tab to see two players. On a phone on the same Wi-Fi, open `http://<your computer's IP>:5173`.

With Docker you get the setup production uses, with a PostgreSQL database that keeps players between restarts:

```bash
cp .env.example .env     # then set POSTGRES_PASSWORD to a long random string
docker compose up -d --build
```

Then open http://localhost:8080.

## What is in here

| Path | What |
|---|---|
| `packages/shared` | The rules both sides run: maps, movement, energy, items, and the protocol between client and server |
| `apps/server` | The game server (Node, WebSockets, PostgreSQL). It decides everything; clients only send what they want to do. |
| `apps/client` | The web client: a three.js world and an HTML interface that works on any screen shape |
| `content` | The world as data: maps (`content/maps`) and items (`content/items.json`) |
| `tools` | Map generators, validators, test bots, the dev runner and the release script |
| `roadmap` | What is done and what comes next, one file per item |
| `docs` | [Design](docs/DESIGN.md) (what the game is and why), [architecture](docs/ARCHITECTURE.md) (how it is built), [operations](docs/OPERATIONS.md) (production) |
| `deploy`, `infra` | What runs in production, and the AWS stack it runs on |

## Contributing

Pull requests are welcome: code, maps, items, ideas, bug reports, and play-testing on real phones. Start with [CONTRIBUTING.md](CONTRIBUTING.md): how to set up, the checks every change passes (`npm run check`), the rules of the codebase, and how pull requests are reviewed and merged. Working with an AI coding agent? [AGENTS.md](AGENTS.md) is its guide: the commands, the rules and the hard limits in one page.

Please follow the [code of conduct](CODE_OF_CONDUCT.md). Found a security problem? Report it privately, as [SECURITY.md](SECURITY.md) explains, never in a public issue.

## Roadmap

The roadmap is the [roadmap/](roadmap/) folder: one file per item, each with its status (done, now, next, planned, idea). `npm run roadmap` prints it in order. To propose something or change the order, open a pull request; [roadmap/README.md](roadmap/README.md) explains how.

## Production

www.napoland.com is published by Angelo Lamonaca (Neuramare) and runs on one server in the publisher's AWS account. Every change merged into `main` is tested again and released there automatically, and a release that does not come up healthy rolls back by itself. Contributors never need AWS access or any secret: everything runs on your own computer, and CI tests pull requests without secrets.

What the game keeps about its players, and why, is in the [privacy policy](apps/client/public/privacy.html) (live at https://www.napoland.com/privacy.html).

## License

- **Code:** [GNU Affero General Public License v3.0 or later](LICENSE) (AGPL-3.0-or-later). You may use, study, change and share it; if you run a changed version as an online service, you must offer its source to its players too.
- **Content** (everything in [`content/`](content): maps, rooms, items and their texts): [Creative Commons Attribution-ShareAlike 4.0](content/LICENSE) (CC BY-SA 4.0).
- **Fonts:** Fredoka and Nunito, which come bundled with the game, are under the [SIL Open Font License 1.1](https://openfontlicense.org) (OFL-1.1).
- By contributing you agree that your contribution is shared under the same terms.

Copyright © 2026 Angelo Lamonaca (Neuramare) and the napoland contributors. Published by Angelo Lamonaca (Neuramare); legal notice: https://www.neuramare.com.
