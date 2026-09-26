# napoland

A mobile-first online exploration game. You live in a cabin in Stonebrook, at the edge of a dark Pacific Northwest forest. Go out, gather what glows, and get back before your energy runs out. The farther you go, the harder it gets and the better the finds, and to go really far you need other people. No fights, no PvP, no missions.

It runs in the browser on phones and desktops, with a joystick and Game Boy style A and B buttons, and a low-poly world in the style of Pokemon FireRed, in the mood of Pacific Drive. There is no map: you learn the world by walking it. See [docs/DESIGN.md](docs/DESIGN.md).

## Play it locally

```bash
npm install
npm run dev
```

Open http://localhost:5173. On a phone on the same Wi-Fi, open `http://<this PC's IP>:5173`. Open two tabs to see two players.

With Docker (the real setup, with a Postgres database that keeps players):

```bash
docker compose up -d --build
```

Then open http://localhost:8080. Settings are in `.env` (copy `.env.example`).

## Develop

`npm run check` runs the type checker, validates the map and runs all tests. [CLAUDE.md](CLAUDE.md) has the commands and the rules of the codebase; [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains how it is built.

## Status

Milestone 0: several players walk around the town together in real time. The server owns movement, the client predicts your own steps, the look and controls come from the approved preview. Energy, gathering, creatures, cabins and regions come next.
