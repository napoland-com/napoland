/**
 * Coming back while the saves of the last visit are still on their way (a quick reconnect while the
 * database is busy: saves of one player are chained in net.ts, and a hello's read is not): the player
 * comes back as they left, never as the older row storage still holds. Otherwise what fell into their
 * pile on the way out would be both in the pile and back in the bag. Real WebSockets; a storage whose
 * saves wait while the test holds them, as behind a saturated pool, and whose reads never do.
 */
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@napoland/shared';
import { devAuth } from '../src/auth';
import { setLogLevel } from '../src/log';
import { startServer, type RunningServer } from '../src/server';
import { MemoryStorage, type PlayerRecord } from '../src/storage';
import { itemsData } from './fixtures';
import { Client, loginTo, savedPlayer, serverDefaults, waitFor } from './helpers';

class HeldSaves extends MemoryStorage {
  private gate: Promise<void> | undefined;
  private open = () => {};
  hold(): void {
    this.gate = new Promise(resolve => { this.open = () => { this.gate = undefined; resolve(); }; });
  }
  release(): void {
    this.open();
  }
  override async save(rec: PlayerRecord): Promise<void> {
    if (this.gate) await this.gate;
    return super.save(rec);
  }
}

const moss = (rec: PlayerRecord | undefined) => (rec?.bag ?? []).reduce((n, s) => n + (s.item === 'moss' ? s.count : 0), 0);

/** Out of energy in the woods while the test holds the saves: the bag falls where they stand, they wake at home, and they leave. */
async function collapseAndLeave(server: RunningServer, storage: HeldSaves, c: Client, id: string, later: () => void) {
  storage.hold();
  later();
  await c.next('zone', m => m.reason === 'collapse');
  expect(server.world.dropViews('woods')).toHaveLength(1);
  c.ws.close();
  await waitFor(() => !server.world.has(id), 'the player to leave');
}

describe('coming back while the last saves wait', () => {
  it('comes back as they left: what fell into the pile is not back in the bag too', async () => {
    setLogLevel('silent');
    let now = 1_000_000;
    const storage = new HeldSaves();
    const server = await startServer({ ...serverDefaults(), storage, items: itemsData(), weather: 'overcast', clock: () => now });
    try {
      const p = await savedPlayer(storage, { map: 'woods', x: 3, y: 5, bag: [{ item: 'moss', count: 2 }] });
      const a = await loginTo(server.port, p.token);
      await collapseAndLeave(server, storage, a.c, p.id, () => { now += 10 * 60_000; });

      const b = await loginTo(server.port, p.token);
      expect(b.welcome.bag).toEqual([]);
      expect(b.welcome.map.id).not.toBe('woods');
      storage.release();
      b.c.ws.close();
      await waitFor(() => !server.world.has(p.id) && storage.get(p.id)!.map !== 'woods', 'the saves to land');
      // The moss is where it fell, and nowhere else.
      expect(moss(storage.get(p.id))).toBe(0);
      expect(server.world.dropViews('woods')).toHaveLength(1);
    } finally {
      storage.release();
      await server.stop();
    }
  });

  it('claims a guest as it left, when its account signs in while those saves wait', async () => {
    setLogLevel('silent');
    let now = 1_000_000;
    const storage = new HeldSaves();
    const server = await startServer({ ...serverDefaults(), storage, items: itemsData(), weather: 'overcast', clock: () => now, auth: devAuth() });
    const clients: Client[] = [];
    try {
      const g = await savedPlayer(storage, { map: 'woods', x: 3, y: 5, bag: [{ item: 'moss', count: 2 }] });
      const guest = await Client.open(server.port);
      clients.push(guest);
      guest.send({ t: 'hello', v: PROTOCOL_VERSION, token: g.token });
      expect(await guest.next('welcome')).toMatchObject({ you: g.id, guest: true });
      await collapseAndLeave(server, storage, guest, g.id, () => { now += 10 * 60_000; });

      const signedIn = await Client.open(server.port);
      clients.push(signedIn);
      signedIn.send({ t: 'hello', v: PROTOCOL_VERSION, auth: 'keeper@example.test', token: g.token });
      const kept = await signedIn.next('welcome');
      expect(kept).toMatchObject({ you: g.id, claimed: true, guest: false, bag: [] });
      expect(kept.map.id).not.toBe('woods');
      expect(server.world.get(g.id)!.authSub).toBe('dev:keeper@example.test');
    } finally {
      storage.release();
      for (const c of clients) c.ws.terminate();
      await server.stop();
    }
  });
});
