/**
 * A house you build up (roadmap/home-lots.md, DESIGN.md: World structure). Every player's house stands in
 * a garden of its own (the map with the house that has a `plate`) and starts as a garage; the workbench at
 * home builds it up a level at a time, from what the stash holds: a cabin, then a house. Each level changes
 * how it looks, outside and in, and some things inside work only from a level on (a map object's `house`:
 * the kitchen, the map table), with boxes standing in their places until then. The levels are data
 * (`house` in content/items.json); the rules are here so the server, which decides, and the client, which
 * draws the house and asks first, agree.
 */
import type { BagSlot } from './items';
import type { MapObject } from './map';

/** One level of the house: what it is called, what building up to it takes from the stash (none for the first), and what it gives. */
export interface HouseLevel {
  /** "Garage", "Cabin", "House". */
  name: string;
  needs?: BagSlot[];
  /** What it is like at this level, for the workbench's card: what building up to it gives. */
  text: string;
}

/** The level every house starts at. */
export const FIRST_HOUSE = 1;

/** The house in a garden of one's own stands on this many tiles across and down at every level, so the garden around it never moves. */
export const HOME_W = 5;
export const HOME_H = 3;

/** A saved level as the game keeps it: a whole number from the first to the highest the data knows; anything else is the first. */
export function cleanHouse(saved: unknown, levels: readonly HouseLevel[]): number {
  const top = Math.max(FIRST_HOUSE, levels.length);
  return typeof saved === 'number' && Number.isInteger(saved) && saved >= FIRST_HOUSE && saved <= top ? saved : FIRST_HOUSE;
}

/** The level a house at `level` is built up to next, and what that takes; undefined at the top. */
export function nextHouse(level: number, levels: readonly HouseLevel[]): { level: number; name: string; text: string; needs: BagSlot[] } | undefined {
  const next = levels[level];
  return next && { level: level + 1, name: next.name, text: next.text, needs: next.needs ?? [] };
}

/** What a house at `level` is called ("Garage"): the data's name, or the first level's for one it does not know. */
export function houseName(level: number, levels: readonly HouseLevel[]): string {
  return levels[level - 1]?.name ?? levels[0]?.name ?? 'House';
}

/** The things in a home that may wait for a level of the house (`house` on the object): the kitchen and the map table. */
export const BUILT_LATER = new Set<MapObject['kind']>(['kitchen', 'board']);

/** The level of the house this object in a home works from (the kitchen, the map table): the first for anything that always works. */
export function builtFrom(o: MapObject): number {
  return 'house' in o && typeof o.house === 'number' ? o.house : FIRST_HOUSE;
}

/** Does this object stand in a house at `level`, or do boxes still stand in its place? */
export function builtIn(o: MapObject, level: number): boolean {
  return builtFrom(o) <= level;
}
