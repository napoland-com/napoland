/**
 * How the trip went (the server's `trip`), in words: the card the text box shows when you come home, or
 * wake up there after a collapse (game.ts). The server sends numbers and ids; every word is made here.
 */
import { landmarkOf, the, type TileMap, type TripView } from '@napoland/shared';

// Where you fell is said by the one rule for every line that says where out there (shared landmarks.ts):
// someone down in local chat, and an arrow or a rescue in a letter home, say it the same way.
export { landmarkOf, the };

/** "a storm", "2 flashes". */
const count = (n: number, one: string, many: string) => (n === 1 ? `a ${one}` : `${n} ${many}`);
/** "a, b and c". */
const list = (words: string[]) => (words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`);

/**
 * The card for a trip: its title (the text box's name tag) and its lines. `mapOf` finds our copy of a map
 * by id; a map's name comes from it too.
 */
export function tripCard(t: TripView, mapOf: (id: string) => TileMap | undefined): { title: string; lines: string[] } {
  const dataOf = (id: string) => mapOf(id)?.data;
  const minutes = `${t.minutes} minute${t.minutes === 1 ? '' : 's'}`;
  const title = t.fell ? `Out ${minutes}` : `Home after ${minutes}`;
  const where = t.deepest && dataOf(t.deepest.map)?.name;
  const lines = [
    `${t.steps} steps · ${where ? `as deep as ${the(where)}, ${t.deepest!.steps} steps out` : 'never past the edge'}`,
  ];
  const fellOn = t.fell && mapOf(t.fell.map);
  if (t.fell) lines.push(`You fell ${fellOn ? landmarkOf(fellOn, t.fell.x, t.fell.y, dataOf) : 'out there'}`);
  else lines.push(`Lowest energy: ${t.lowest} · Bag worth ${t.xp} XP`);
  const { storms, flashes, surges } = t.caught;
  const caught = [
    ...(storms ? [count(storms, 'storm', 'storms')] : []),
    ...(flashes ? [count(flashes, 'flash', 'flashes')] : []),
    ...(surges ? [count(surges, 'surge', 'surges')] : []),
  ];
  lines.push(caught.length ? `Caught in ${list(caught)}` : 'Nothing caught you out there');
  const trip = t.best.flatMap(b => (b === 'deepest' ? ['farthest'] : b === 'longest' ? ['longest'] : []));
  if (trip.length) lines.push(`Your ${list(trip)} trip yet`);
  if (t.best.includes('xp')) lines.push('The most XP you ever brought home');
  return { title, lines };
}
