/**
 * What the game says about the parcels (packages/shared parcels.ts): the banner when one arrives, and
 * the card at the top of the stash the first time the chest opens after. The notice board's calendar
 * is the server's. Plain words and no drawing, so it is tested.
 */
import { WEEKDAYS, amount, outfitOf, type BagSlot, type ParcelView } from '@napoland/shared';
import { listWords } from './details';
import type { Items } from './items';
import { outfitWords } from './wardrobe';

/** "a thermos, 2 scrap": what came, the way the calendar on the notice board lists it. */
export function parcelList(slots: readonly BagSlot[], items: Items): string {
  return slots.map(s => amount(items.get(s.item), s.count)).join(', ');
}

/**
 * The banner when a parcel arrives: that it waits in the chest, and what is in it. The welcome parcel
 * comes with the first sign-in, which opens the wardrobe: it also names the outfits signing in gave
 * (`outfits`, by id), so the NAPO work suit is not missed.
 */
export function parcelBanner(p: ParcelView, items: Items, outfits: readonly string[] = []): { title: string; sub: string } {
  const title = 'A parcel waits in your chest', list = parcelList(p.items, items);
  if (p.weekday === null) {
    const worn = listWords(outfits.flatMap(id => {
      const o = outfitOf(id);
      return o ? [`a ${outfitWords(o.name)}`] : [];
    }));
    return { title, sub: `A welcome from the residents:\n${list}${worn ? `\nand ${worn} in your wardrobe` : ''}` };
  }
  const all = p.allWeek?.length ? `\nand ${parcelList(p.allWeek, items)}, for coming back every day this week` : '';
  return { title, sub: `${WEEKDAYS[p.weekday]}: ${list}${all}` };
}

/** The card at the top of the stash, once: "Tuesday's parcel: a thermos, 2 scrap". */
export function parcelNote(p: ParcelView, items: Items): string {
  const list = parcelList(p.items, items);
  if (p.weekday === null) return `Your welcome parcel: ${list}`;
  const all = p.allWeek?.length ? `, and ${parcelList(p.allWeek, items)} for coming back every day this week` : '';
  return `${WEEKDAYS[p.weekday]}'s parcel: ${list}${all}`;
}
