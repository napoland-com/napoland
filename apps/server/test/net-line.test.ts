/**
 * The dead line over real WebSockets (packages/shared/src/line.ts): a solve is heard by everyone, and a
 * player who joins while the lamp is out is told after the welcome (the client resets on it).
 */
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, SOLUTION } from '@napoland/shared';
import { Client, setup } from './helpers';

describe('the lamp with no wires, on the wire', () => {
  // The fixture woods' street light at 1,4 stands in for it; a fixed aurora night, so the order counts.
  const { enter, ctx } = setup({ weather: 'aurora', lamp: { map: 'woods', x: 1, y: 4 }, rng: () => 0 });

  it('goes out for a second socket, and is told to a late joiner after the welcome', async () => {
    const a = await enter({ map: 'woods', x: 2, y: 4 });
    const b = await enter({ map: 'town', x: 1, y: 2 });
    for (const d of SOLUTION) a.c.send({ t: 'face', dir: d });
    expect(await b.c.next('lampOut')).toEqual({ t: 'lampOut', out: true });

    const late = await Client.open(ctx.server.port);
    late.send({ t: 'hello', v: PROTOCOL_VERSION, name: 'Late One' });
    await late.next('lampOut');
    // next() takes only the lampOut out: the welcome is still there only if it came first.
    expect(late.inbox.map(m => m.t)).toContain('welcome');
    late.ws.terminate();
  });
});
