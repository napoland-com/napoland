/**
 * The places everyone mends together (roadmap/trail-works.md; the rules both sides run are
 * packages/shared/src/works.ts): one state for the whole server, whatever copy of a map anyone is in,
 * saved in world_state whenever it changes. The World asks which stand (their ids go in every player's
 * pass, so a footbridge is walked and a street light shines only then) and tells it what was given and
 * when a day passed.
 */
import { WORKS_GIVERS, worksGive, worksWear, type WorksDef, type WorksView } from '@napoland/shared';
import type { WorksRecord, WorksRecords } from './storage';

export class Works {
  readonly defs: ReadonlyMap<string, WorksDef>;
  /** The ids of the places that stand now. */
  readonly standing = new Set<string>();
  private readonly recs = new Map<string, WorksRecord>();

  /** `saved`: as storage kept them; a place it has nothing on (new, or never given anything) starts broken. */
  constructor(defs: readonly WorksDef[], saved: WorksRecords = {}) {
    this.defs = new Map(defs.map(d => [d.id, d]));
    for (const d of defs) {
      const r = saved[d.id];
      this.recs.set(d.id, r ? { ...r, givers: r.givers.map(g => ({ ...g })) } : { standing: false, held: 0, day: 0, givers: [] });
      if (r?.standing) this.standing.add(d.id);
    }
  }

  view(id: string): WorksView {
    const r = this.recs.get(id)!;
    return { id, standing: r.standing, held: r.held, ...(r.givers[0] ? { top: r.givers[0].name } : {}) };
  }

  views(): WorksView[] {
    return [...this.recs.keys()].map(id => this.view(id));
  }

  /**
   * Takes up to `count` from `who`, as much as it has room for (works.ts): how many it took, and whether
   * that made it stand (`today`: the UTC day, from which its wear is counted). Each giver's total is kept
   * under their name as it is now: the plaque names whoever gave the most, all told. A guest's gift
   * (`who` null) counts, but a guest's name goes on no plaque.
   */
  give(id: string, who: { id: string; name: string } | null, count: number, today: number): { took: number; built: boolean } {
    const def = this.defs.get(id)!, r = this.recs.get(id)!;
    const g = worksGive(def, r, count);
    if (!g.took) return { took: 0, built: false };
    r.standing = g.standing;
    r.held = g.held;
    if (g.built) {
      r.day = today;
      this.standing.add(id);
    }
    if (!who) return { took: g.took, built: g.built };
    const giver = r.givers.find(x => x.id === who.id);
    if (giver) {
      giver.count += g.took;
      giver.name = who.name;
    } else r.givers.push({ id: who.id, name: who.name, count: g.took });
    // Most first; a tie stays with whoever got there first.
    r.givers.sort((a, b) => b.count - a.count);
    r.givers.length = Math.min(r.givers.length, WORKS_GIVERS);
    return { took: g.took, built: g.built };
  }

  /**
   * The midnights (UTC) up to day `today`: a place that stands pays its wear for each one since the day it
   * last did, and breaks when what was put by runs short (after a restart, every day the server was down
   * counts). The ids of the places that changed, and of those that broke.
   */
  wear(today: number): { changed: string[]; broke: string[] } {
    const changed: string[] = [], broke: string[] = [];
    for (const [id, r] of this.recs) {
      if (!r.standing || r.day >= today) continue;
      const def = this.defs.get(id)!;
      while (r.standing && r.day < today) {
        const w = worksWear(def, r);
        r.standing = w.standing;
        r.held = w.held;
        r.day++;
        if (w.broke) {
          broke.push(id);
          this.standing.delete(id);
        }
      }
      changed.push(id);
    }
    return { changed, broke };
  }

  /** Every place as storage keeps it. */
  records(): WorksRecords {
    return Object.fromEntries([...this.recs].map(([id, r]) => [id, { ...r, givers: r.givers.map(g => ({ ...g })) }]));
  }
}
