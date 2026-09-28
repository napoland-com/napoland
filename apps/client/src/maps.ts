/**
 * Every map of the world ships with the client (content/maps/*.json, bundled by Vite), so walking
 * into the woods needs no download. The server says which map you are on; this finds our copy.
 */
import { TileMap, type MapData, type MapRef } from '@napoland/shared';

export class Maps {
  private readonly data = new Map<string, MapData>();
  private readonly built = new Map<string, TileMap>();

  constructor(list: Iterable<MapData>) {
    for (const d of list) this.data.set(d.id, d);
  }

  /** Our copy of the map the server means; undefined when we have none or another version, so this client is out of date. */
  get(ref: MapRef): TileMap | undefined {
    const d = this.data.get(ref.id);
    if (!d || d.version !== ref.version) return undefined;
    let map = this.built.get(d.id);
    // Built on first use: a big map of the wilds takes a moment, and many visits never leave town.
    if (!map) this.built.set(d.id, (map = new TileMap(d)));
    return map;
  }

  /** A bundled map's data by id, whatever its version: to see where an exit leads (does the room behind a door keep a fire?). */
  find(id: string): MapData | undefined {
    return this.data.get(id);
  }

  /** Every bundled map's data, in the order they came: to list what lies on all of them (the notes people left). */
  all(): MapData[] {
    return [...this.data.values()];
  }

  /** What to show before the server says where you are: a town. */
  home(): TileMap {
    const all = [...this.data.values()];
    const d = all.find(m => m.kind === 'town') ?? all[0];
    if (!d) throw new Error('no maps are bundled with the client');
    return this.get(d)!;
  }
}
