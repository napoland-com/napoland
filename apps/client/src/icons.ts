/**
 * Item icons for the bag: small flat drawings in the look of the interface (flat colors with cream
 * outlines on the dark panel), one per item. Inline SVG, so they need no download and stay sharp at
 * any size. An item without its own drawing gets a sack. And the calls' notes, on the fan over B and
 * over the head of whoever calls.
 */
import type { CallKind, ItemDef, Slot, ToolIcon } from '@napoland/shared';

const CREAM = '#e8dfc8';

const icon = (inner: string) =>
  `<svg viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="${CREAM}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">${inner}</svg>`;

/** A soft light behind things that glow. */
const halo = (cx: number, cy: number, r: number, color: string) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" opacity=".2" stroke="none"/>`;

const ICONS: Record<string, string> = {
  // Two luminous mushrooms, spotted caps.
  glowcap: icon(`${halo(16, 15, 14, '#5fe8d0')}
    <path d="M7.2 20h3.6l.6 6.5H6.6z" fill="#ece5d2"/>
    <path d="M18.6 15h5l.9 11.5h-6.8z" fill="#ece5d2"/>
    <path d="M2.8 20.5c0-4.6 2.8-7.5 6.2-7.5s6.2 2.9 6.2 7.5z" fill="#4fd8c1"/>
    <path d="M12.6 15.6c0-6 3.9-9.6 8.5-9.6s8.5 3.6 8.5 9.6z" fill="#7ff3dd"/>
    <circle cx="18.2" cy="10.4" r="1.2" fill="#e6fffa" stroke="none"/><circle cx="23.4" cy="11.8" r="1" fill="#e6fffa" stroke="none"/><circle cx="7.4" cy="17" r=".9" fill="#e6fffa" stroke="none"/>
    <path d="M3.5 27.2h25"/>`),
  // An amber lump on a cut stump.
  resin: icon(`${halo(16, 15, 13, '#ffae4a')}
    <path d="M6.5 21.5v5.2c0 1.8 4.3 3.1 9.5 3.1s9.5-1.3 9.5-3.1v-5.2" fill="#6b4a31"/>
    <ellipse cx="16" cy="21.5" rx="9.5" ry="3.2" fill="#a67c52"/>
    <path d="M10.6 20.6c-.7-4.7 2.3-11 5.4-11s6.1 6.3 5.4 11c-.4 2-2.8 2.8-5.4 2.8s-5-.8-5.4-2.8z" fill="#f2a53c"/>
    <path d="M13.7 14.4c.6-1.5 1.4-2.4 2.2-2.6" stroke="#ffe3a8" stroke-width="1.3"/>`),
  // A metal sheet bent in the middle, rusty, with rivets.
  scrap: icon(`<path d="M2.8 19.6l10.4-6.1 7.1 4.2-10.4 6.1z" fill="#7d8b92"/>
    <path d="M13.2 13.5l7.1 4.2 9-9.1-7.1-4.2z" fill="#aebbc1"/>
    <path d="M6.6 19.9l3-1.8 2.3 1.4-3 1.8z" fill="#b3643c" stroke="none"/>
    <circle cx="22.4" cy="7.4" r="1" fill="#57636a" stroke="none"/><circle cx="18.3" cy="11.6" r="1" fill="#57636a" stroke="none"/><circle cx="9.3" cy="16.5" r="1" fill="#57636a" stroke="none"/>`),
  // A coil of copper wire with a loose end: cream edges under copper.
  wire: icon(`<g fill="none" stroke-width="4.4"><ellipse cx="14.5" cy="11" rx="9" ry="3.6"/><ellipse cx="14.5" cy="15.5" rx="9" ry="3.6"/><ellipse cx="14.5" cy="20" rx="9" ry="3.6"/><path d="M23.4 20.5c3.4.6 5 3 3.6 6.5"/></g>
    <g fill="none" stroke="#d9773a" stroke-width="2.2"><ellipse cx="14.5" cy="11" rx="9" ry="3.6"/><ellipse cx="14.5" cy="15.5" rx="9" ry="3.6"/><ellipse cx="14.5" cy="20" rx="9" ry="3.6"/><path d="M23.4 20.5c3.4.6 5 3 3.6 6.5"/></g>
    <path d="M9 22.9h3" stroke="#ffcfa4" stroke-width="1.2"/>`),
  // A folded rag with a pale stripe and a frayed edge.
  cloth: icon(`<g transform="rotate(-8 16 17)"><path d="M5 9.5h22v14H5z" fill="#b25a4c"/>
    <path d="M5 12.6h22M5 15h22" stroke="#e9cfa4" stroke-width="1.3"/>
    <path d="M27 17v6.5h-6.5z" fill="#d7806f"/>
    <path d="M7.5 23.5v2.2M10.5 23.5v2.8M13.5 23.5v2M16.5 23.5v2.6"/></g>`),
  // A violet crystal floating over its shadow.
  shard: icon(`${halo(16, 14, 13, '#a77dff')}
    <ellipse cx="16" cy="29.2" rx="4.6" ry="1.2" fill="#000" opacity=".4" stroke="none"/>
    <path d="M16 2.8l-6.2 10.4L16 26z" fill="#9a6cf0"/>
    <path d="M16 2.8l6.2 10.4L16 26z" fill="#c9adff"/>
    <path d="M9.8 13.2l6.2 2.4 6.2-2.4M16 15.6V26" stroke-width="1.1"/>
    <path d="M25.5 4.5v4M23.5 6.5h4" stroke="#f3eaff" stroke-width="1.2"/>`),
  // The same crystal still burning: paler, brighter, with rays of light around it.
  'live-shard': icon(`${halo(16, 14, 15, '#e6d6ff')}
    <path d="M16 1v3M3.5 14h3M25.5 14h3M6.5 5l2 2M25.5 5l-2 2" stroke="#fff4c8" stroke-width="1.4"/>
    <ellipse cx="16" cy="29.2" rx="4.6" ry="1.2" fill="#000" opacity=".4" stroke="none"/>
    <path d="M16 4.8l-6.2 10.4L16 26z" fill="#c9adff"/>
    <path d="M16 4.8l6.2 10.4L16 26z" fill="#f3eaff"/>
    <path d="M9.8 15.2l6.2 2.4 6.2-2.4M16 17.6V26" stroke-width="1.1"/>`),
  // A steel thermos: dark cup, red band, a handle.
  thermos: icon(`<path d="M21.5 12.5h1.6c1 0 1.8.8 1.8 1.8v6.4c0 1-.8 1.8-1.8 1.8h-1.6" fill="none" stroke-width="1.8"/>
    <rect x="10.5" y="9.5" width="11" height="19" rx="2.2" fill="#a7b6be"/>
    <path d="M10.5 17h11v3.4h-11z" fill="#c8453a"/>
    <rect x="9.5" y="4" width="13" height="6" rx="1.6" fill="#4d5963"/>
    <path d="M13.5 12v3.2M13.5 22.4v3.4" stroke="#eef4f6" stroke-width="1.3"/>`),
  // A red road flare with a black cap and a spark at its tip.
  flare: icon(`${halo(24, 8, 8, '#ff6a50')}
    <path d="M6.5 24.5l14-14 3.5 3.5-14 14z" fill="#c8362c"/>
    <path d="M4.2 26.8l2.3-2.3 3.5 3.5-2.3 2.3z" fill="#2c2c30"/>
    <path d="M22.3 8.9l2.2-2.2M24.9 11.5l2.5-.8M20.5 6.5l.8-2.5" stroke="#ffd08a" stroke-width="1.6"/>`),
  // A dark knot with light in its seams: nobody knows what it is yet.
  strange: icon(`${halo(16, 16, 13, '#b39bff')}
    <path d="M16 4.5c6 0 9.5 4.4 9.5 9.2 0 6.7-5.4 13.8-9.5 13.8S6.5 20.4 6.5 13.7c0-4.8 3.5-9.2 9.5-9.2z" fill="#3a3448"/>
    <path d="M11 11.5c2.4 2 7.6 2 10 0M12 19c1.5-3.2 6.5-3.2 8 0M16 7.5v4" stroke="#d9ccff" stroke-width="1.4"/>
    <path d="M13.6 23.5h4.8" stroke="#d9ccff" stroke-width="1.4"/>`),
  // A smooth black pebble with a warm glow inside.
  'warm-pebble': icon(`${halo(16, 18, 12, '#ff9a4a')}
    <path d="M5 19.5c0-5 5-8.5 11.5-8.5S28 14.2 28 19c0 4.6-5 7.5-11.5 7.5S5 24 5 19.5z" fill="#2c2623"/>
    <path d="M11 16.8c2.5-1.8 6.4-2.2 9.6-1" stroke="#ff9a4a" stroke-width="1.6"/>`),
  // A long grey feather, lying across.
  'hollow-feather': icon(`<path d="M5.5 26.5L26 6" stroke-width="1.6"/>
    <path d="M9 23c-1.6-6.5 3.3-13.3 14.8-15-1 8.7-6.9 15-14.8 15z" fill="#a9a6a0"/>
    <path d="M12.5 20.2l6-2.2M14.8 16.8l5.5-2.4M17.6 13.3l4-2" stroke="#6f6c67" stroke-width="1.1"/>`),
  // A glass bead ringed with a faint hum.
  'humming-bead': icon(`${halo(16, 16, 13, '#5ff0e0')}
    <circle cx="16" cy="16" r="6.5" fill="#7ff3e6"/>
    <path d="M13.2 13.6c.9-1.2 2.2-1.8 3.6-1.8" stroke="#effffd" stroke-width="1.4"/>
    <path d="M5.5 11.5c-1.4 3-1.4 6 0 9M26.5 11.5c1.4 3 1.4 6 0 9M8.8 13.4c-.6 1.7-.6 3.5 0 5.2M23.2 13.4c.6 1.7.6 3.5 0 5.2" stroke="#9ff5ec" stroke-width="1.3"/>`),
  // A lump of coal that never went out: black, cracked, and red in the cracks.
  'ember-coal': icon(`${halo(16, 18, 12, '#ff6a3a')}
    <path d="M6 20.5c0-4.8 4.4-8.5 10.2-8.5 5.6 0 9.8 3.4 9.8 7.8 0 4.6-4.4 7.2-10 7.2S6 25 6 20.5z" fill="#2b2322"/>
    <path d="M10.5 18.5l3.2 1.6 2-2.6 3 2.2 2.8-1.4M13.7 20.1l-.6 3.4M18.7 19.7l.8 3.2" stroke="#ff7a3c" stroke-width="1.5"/>`),
  // A pale moth, its wings spread, with a dark spot on each.
  'pale-moth': icon(`${halo(16, 16, 13, '#f2ecd8')}
    <path d="M16 11c-3-5.5-10.5-6.5-11.5-2.5-.8 3.4 2.8 6.4 7.2 6.8-3.6 1.2-5.2 4.6-3 6.8 2.2 2.1 5.9-.6 7.3-4.6 1.4 4 5.1 6.7 7.3 4.6 2.2-2.2.6-5.6-3-6.8 4.4-.4 8-3.4 7.2-6.8C26.5 4.5 19 5.5 16 11z" fill="#e9e3d0"/>
    <path d="M16 10.5v11" stroke-width="1.8"/>
    <path d="M15 9.5c-.8-1.6-2-2.6-3.2-3M17 9.5c.8-1.6 2-2.6 3.2-3" stroke-width="1.1"/>
    <circle cx="10" cy="11" r="1.4" fill="#b9ad90" stroke="none"/><circle cx="22" cy="11" r="1.4" fill="#b9ad90" stroke="none"/>`),
  // NAPO's grey steel lockbox: a lid, a band of NAPO yellow and a padlock that has not been opened since the evacuation.
  lockbox: icon(`<path d="M4.5 13h23v13.5c0 .8-.7 1.5-1.5 1.5H6c-.8 0-1.5-.7-1.5-1.5z" fill="#7d8b92"/>
    <path d="M4 9.8c0-1 .8-1.8 1.8-1.8h20.4c1 0 1.8.8 1.8 1.8V13H4z" fill="#aebbc1"/>
    <path d="M4.5 17.2h23v3.4h-23z" fill="#d6ad2f" stroke="none"/>
    <path d="M14.3 15.6v-1.9a1.7 1.7 0 0 1 3.4 0v1.9" stroke-width="1.4"/>
    <rect x="12.6" y="15.6" width="6.8" height="6.6" rx="1.2" fill="#4d5963"/>
    <circle cx="16" cy="18.4" r=".9" fill="#e8dfc8" stroke="none"/><path d="M16 19.2v1.4" stroke-width="1.1"/>`),
  // The keepsakes people left (notes.ts), each one of a kind, in a soft gold light that says so.
  // A photograph of the town before: a white border, the mill's roof, the street, the Old Stone whole.
  'old-photograph': icon(`${halo(16, 16, 14, '#ffd98a')}
    <g transform="rotate(-6 16 16)"><path d="M5 7.5h22v17H5z" fill="#efe6cf"/>
    <path d="M7.5 10h17v10.5h-17z" fill="#6f6556"/>
    <path d="M7.5 16l4-3.5 4 3h9v5h-17z" fill="#9a8f7c" stroke="none"/>
    <path d="M18.5 20.5v-4.6l1.4-2.2 1.4 2.2v4.6z" fill="#cfc4ad" stroke="none"/>
    <path d="M7.5 20.5h17" stroke="#4d463c" stroke-width="1.2"/></g>`),
  // The ranger's brass compass: a round case on its ring, the needle turned toward the woods.
  'brass-compass': icon(`${halo(16, 17, 13, '#ffd98a')}
    <circle cx="16" cy="18" r="9" fill="#c9a24a"/>
    <circle cx="16" cy="18" r="6.4" fill="#efe6cf"/>
    <path d="M14.4 5.8a1.6 1.6 0 0 1 3.2 0V9h-3.2z" fill="#c9a24a"/>
    <path d="M16 13.2l1.6 4.8H14.4z" fill="#b33a2a" stroke="none"/><path d="M16 22.8l-1.6-4.8h3.2z" fill="#4d463c" stroke="none"/>
    <circle cx="16" cy="18" r=".9" fill="#4d463c" stroke="none"/>`),
  // Walt's tin pole tag, stamped with the last pole of the north line, two nail holes.
  'pole-tag': icon(`${halo(16, 16, 13, '#ffd98a')}
    <path d="M6 9.5h20a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 21V11A1.5 1.5 0 0 1 6 9.5z" fill="#aebbc1"/>
    <circle cx="7.4" cy="16" r="1.1" fill="#2f343c" stroke="none"/><circle cx="24.6" cy="16" r="1.1" fill="#2f343c" stroke="none"/>
    <path d="M10.8 19.4v-6.8l3.4 6.8v-6.8M16.6 16h2.4M21 12.6v6.8" stroke="#4d5963" stroke-width="1.5"/>`),
  // Wren's tin whistle: a long thin pipe, its paint worn off near the mouth, and the holes along it.
  'tin-whistle': icon(`${halo(16, 16, 13, '#ffd98a')}
    <g transform="rotate(-38 16 16)"><path d="M3.5 13.8h25v4.4h-25z" fill="#6d8a5a"/>
    <path d="M3.5 13.8h6v4.4h-6z" fill="#c9cfd2"/>
    <circle cx="13.5" cy="16" r="1" fill="#1c1a18" stroke="none"/><circle cx="17" cy="16" r="1" fill="#1c1a18" stroke="none"/>
    <circle cx="20.5" cy="16" r="1" fill="#1c1a18" stroke="none"/><circle cx="24" cy="16" r="1" fill="#1c1a18" stroke="none"/></g>`),
  // Dan Barlow's NAPO staff badge: a clip, NAPO's yellow band, and a pale square where the photo was.
  'staff-badge': icon(`${halo(16, 17, 13, '#ffd98a')}
    <path d="M13.5 3.5h5v4h-5z" fill="#7d8b92"/>
    <path d="M8 7h16a1.5 1.5 0 0 1 1.5 1.5v18A1.5 1.5 0 0 1 24 28H8a1.5 1.5 0 0 1-1.5-1.5v-18A1.5 1.5 0 0 1 8 7z" fill="#efe6cf"/>
    <path d="M6.5 9.5h19v3.4h-19z" fill="#d6ad2f" stroke="none"/>
    <path d="M10 15.5h6v6.5h-6z" fill="#d8d2c2" stroke="#8a8474" stroke-width="1"/>
    <path d="M18 16.5h4.5M18 19h4.5M10 25h12" stroke="#6a6a78" stroke-width="1.2"/>`),
};

/** Anything else: a small sack tied at the top. */
const SACK = icon(`<path d="M10 14c-4 4.4-4.2 12.4 6 12.8 10.2-.4 10-8.4 6-12.8z" fill="#a58a5f"/>
  <path d="M12 14l-1.8-4.6 3.4 1.6L16 8.4l2.4 2.6 3.4-1.6L20 14z" fill="#bca06f"/>
  <path d="M11 14h10" stroke="#6b5234" stroke-width="2"/>
  <path d="M14 18.7c0-1.4 1-2.3 2.2-2.3s2.2.8 2.2 2c0 1.6-2.2 1.8-2.2 3.4" stroke="#3b2e1f" stroke-width="1.6"/>
  <circle cx="16.2" cy="24" r="1" fill="#3b2e1f" stroke="none"/>`);

export function itemIcon(item: string): string {
  return ICONS[item] ?? SACK;
}

/** Gear by its slot, in its own color: one drawing per slot, so a new piece needs no new art. */
const GEAR: Record<Slot, (c: string) => string> = {
  // A cap: a dome and a brim.
  cap: c => icon(`<path d="M6 19c0-6.4 4.5-10.5 10-10.5S26 12.6 26 19z" fill="${c}"/><path d="M4 19h24.5c0 2.4-2 3.5-4.5 3.5H8.5C6 22.5 4 21.4 4 19z" fill="${c}"/><path d="M16 8.5v-2" />`),
  // A coat, arms out.
  shirt: c => icon(`<path d="M11 5.5l5 3 5-3 7 5-3 5.5-2.5-1.5V27H9.5V14.5L7 16l-3-5.5z" fill="${c}"/><path d="M16 8.5V27" />`),
  // A glove, thumb out.
  gloves: c => icon(`<path d="M10 28V15c0-1.5.6-2.6 1.8-2.6s1.7 1 1.7 2V8.8c0-1.3.8-2.3 2-2.3s2 1 2 2.3V14l.2-4.2c0-1.2.8-2.1 1.9-2.1s1.9.9 1.9 2.1v4.4l2.2-2.4c1-1 2.5-.8 3 .3.4.9.1 1.8-.5 2.5L21 20v8z" fill="${c}"/><path d="M10 24h11" />`),
  // Trousers.
  pants: c => icon(`<path d="M8.5 5h15l1.5 22h-6l-3-14-3 14h-6z" fill="${c}"/><path d="M8.5 9h15" />`),
  // A boot.
  shoes: c => icon(`<path d="M9 5h8v13l9 3.5c1.5.6 2.5 2 2.5 3.5V27H5.5v-3.5L9 21z" fill="${c}"/><path d="M5.5 24h23" />`),
  // A pack with a flap and a pocket.
  bag: c => icon(`<path d="M8 11c0-3.6 3.6-6.5 8-6.5s8 2.9 8 6.5v15.5c0 .8-.7 1.5-1.5 1.5h-13c-.8 0-1.5-.7-1.5-1.5z" fill="${c}"/><path d="M8 13h16v4H8zM11.5 20h9v5h-9z" /><path d="M13 4.8c.8-1.3 2-2 3-2s2.2.7 3 2" />`),
};

/** A paper map, folded in three, with a road and a pond on it: every map a tool charts, and the map button in the bag. */
export const MAP_ICON = icon(`<path d="M4 8l8-2.5 8 2.5 8-2.5v19L20 27l-8-2.5L4 27z" fill="#d8c9a3"/>
  <path d="M12 5.5v19M20 8v19" stroke="#8a7650"/>
  <path d="M6.5 22c3-1 3.5-5 7-6s5 2 8.5-3" stroke="#6b4a31" stroke-dasharray="2 1.6"/>
  <ellipse cx="22.5" cy="20.5" rx="2.6" ry="1.6" fill="#6f98b0" stroke="#3f5f72"/>`);

/** A NAPO field radio: a boxy set with NAPO's yellow band, its speaker, a window glowing green like NAPO's screens, and an aerial. */
export const RADIO_ICON = icon(`<path d="M21 11.5l3.6-8" stroke-width="1.6"/><circle cx="24.9" cy="3.1" r="1.4" fill="${CREAM}" stroke="none"/>
  <rect x="5" y="11" width="22" height="17.5" rx="2.6" fill="#5b6448"/>
  <path d="M6 14.8h20" stroke="#e0b83a" stroke-width="2.2"/>
  <circle cx="11.8" cy="21.9" r="4.4" fill="#343a2c"/>
  <path d="M9.4 20.3h4.8M8.9 21.9h5.8M9.4 23.5h4.8" stroke="#a3aa8c" stroke-width="1"/>
  <rect x="18" y="18.2" width="6.4" height="3.4" rx=".7" fill="#7ff0a8" stroke="none"/>
  <circle cx="21.2" cy="25.2" r="1.7" fill="#c9c2b0"/>`);

/** A pocket notebook with its band and a pencil beside it: the field notes' button in the bag's header. */
export const NOTEBOOK_ICON = icon(`<path d="M6.5 5.5c0-.8.7-1.5 1.5-1.5h12.5c.8 0 1.5.7 1.5 1.5v21c0 .8-.7 1.5-1.5 1.5H8c-.8 0-1.5-.7-1.5-1.5z" fill="#8a6440"/>
  <path d="M9.5 4v24" stroke="#5c4029" stroke-width="1.6"/><path d="M18.5 4v24" stroke="#2e3440" stroke-width="1.8"/>
  <path d="M11.5 9h5v3.5h-5z" fill="#e8dfc8" stroke="none"/>
  <path d="M25 8.5h2.6v15.5L26.3 27 25 24z" fill="#d9a82b"/><path d="M25 11h2.6" stroke="#8a6a1f"/>`);

/**
 * Outfits in the wardrobe (outfits.ts): a small figure in each, in the colors the world draws it in
 * (view/characters.ts, OUTFIT_LOOKS): what it wears on its head over a head, and the clothes below.
 */
const HEAD = '<circle cx="16" cy="8.4" r="3.1" fill="#f2cda8"/>';
/** A jacket to the hips, over trousers; a coat to the knees, over boots. */
const JACKET = 'M12 11l4 2.4 4-2.4 6.5 4.2-2.6 5-2.2-1.2V25H10.3v-6l-2.2 1.2-2.6-5z';
const TROUSERS = 'M10.8 25h10.4l-.5 5.5h-4.1l-.6-3.2-.6 3.2h-4.1z';
const COAT = 'M12 11l4 2.4 4-2.4 6.5 4.2-2.6 5-2.2-1.2v3l1.2 5.8H9.1l1.2-5.8v-3l-2.2 1.2-2.6-5z';
const BOOTS = 'M11 27.8h3.6v2.7H11zM17.4 27.8H21v2.7h-3.6z';
const OUTFIT_ICONS: Record<string, string> = {
  // A grey coverall, belted, with the yellow patch; a cap of the same grey.
  'napo-suit': icon(`<path d="M12 11l4 2.4 4-2.4 6.5 4.2-2.6 5-2.2-1.2v11.5H17l-1-7.5-1 7.5h-4.7V19l-2.2 1.2-2.6-5z" fill="#7b8288"/>
    <path d="M16 13.4v8.1" stroke-width="1.2"/><path d="M10.4 21.6h11.2" stroke="#555b61" stroke-width="1.8"/>
    <path d="M17.6 15h2.6v2.2h-2.6z" fill="#d6ad2f" stroke="none"/>
    ${HEAD}<path d="M12.3 7.8c0-2.7 1.7-4.5 3.7-4.5s3.7 1.8 3.7 4.5z" fill="#555b61"/><path d="M14.7 5.4h2.6v1.5h-2.6z" fill="#d6ad2f" stroke="none"/>`),
  // An orange jacket with two pale bands, and a yellow hard hat with a ridge and a brim.
  'lineman-jacket': icon(`<path d="${TROUSERS}" fill="#3b4a63"/><path d="${JACKET}" fill="#e0712c"/>
    <path d="M10.4 20.6h11.2M10.4 23.2h11.2" stroke="#e2e6e2" stroke-width="1.4"/><path d="M16 13.4V25" stroke="#b3531b" stroke-width="1.2"/>
    ${HEAD}<path d="M11.8 7.5c0-2.9 1.9-4.9 4.2-4.9s4.2 2 4.2 4.9z" fill="#d9a82b"/><path d="M10.2 7.3h11.6v1.4H10.2z" fill="#d9a82b"/><path d="M16 2.8v4.4" stroke="#a88020" stroke-width="1.3"/>`),
  // A dark green cape, flaring to a yellow hem, and its hood up, edged in yellow round the face.
  'rain-cape': icon(`<path d="M12.6 27.5h2.4v3h-2.4zM17 27.5h2.4v3H17z" fill="#46483a"/><path d="M12.5 10.5L6 27.5h20l-6.5-17z" fill="#2f5b3f"/>
    <path d="M6.7 25.8h18.6" stroke="#d6ad2f" stroke-width="1.8"/>
    <path d="M10.9 11.2c0-4.6 2.3-7.9 5.1-7.9s5.1 3.3 5.1 7.9z" fill="#2f5b3f"/><path d="M13.4 10.9V9.7c0-2.2 1.1-3.6 2.6-3.6s2.6 1.4 2.6 3.6v1.2z" fill="#f2cda8" stroke="#d6ad2f" stroke-width="1.2"/>`),
  // A brown coat to the knees, belted, with the brass badge; a campaign hat, wide brim and pinched crown.
  'ranger-coat': icon(`<path d="${BOOTS}" fill="#3a2718"/><path d="${COAT}" fill="#6e4a2e"/>
    <path d="M16 13.4V27.8" stroke="#4b3120" stroke-width="1"/><path d="M10.4 21.9h11.2" stroke="#4b3120" stroke-width="1.6"/>
    <circle cx="19.3" cy="16.3" r="1.35" fill="#d6b24c" stroke="none"/>
    ${HEAD}<path d="M12.7 6.9l1.6-4.3h3.4l1.6 4.3z" fill="#8b6c40"/><path d="M13 6h6" stroke="#4b3120" stroke-width="1"/><path d="M9.3 6.9h13.4v1.4H9.3z" fill="#8b6c40"/>`),
  // A coat of four cloths, the sleeves and the skirt each another, with patches stitched on; a knitted cap and its bobble.
  patchwork: icon(`<path d="${BOOTS}" fill="#4a3322"/><path d="${COAT}" fill="#a8584a"/>
    <path d="M12 11L5.5 15.2l2.6 5 2.2-1.2z" fill="#3e7c77"/><path d="M20 11l6.5 4.2-2.6 5-2.2-1.2z" fill="#c39a3e"/><path d="M10.3 22h11.4l1.2 5.8H9.1z" fill="#4f6b95"/>
    <path d="M11.3 15.4h3.5v3.1h-3.5zM17.2 17.3h3.1v2.6h-3.1z" fill="#c39a3e" stroke="#e6d6ae" stroke-width=".8" stroke-dasharray="1 .8"/>
    ${HEAD}<path d="M12.2 7.6c0-2.8 1.7-4.6 3.8-4.6s3.8 1.8 3.8 4.6z" fill="#c39a3e"/><path d="M11.9 6.6h8.2v1.7h-8.2z" fill="#3e7c77"/><circle cx="16" cy="2.7" r="1.4" fill="#e6d6ae"/>`),
};

/** An outfit's drawing, for the wardrobe's tiles and cards; a sack for one this copy cannot draw. */
export function outfitIcon(id: string): string {
  return OUTFIT_ICONS[id] ?? SACK;
}

/**
 * Jacket patterns in the wardrobe (merits.ts): a jacket in a slate cloth with the pattern on it, in the
 * shade the world draws it in on that cloth (view/characters.ts, PATTERN_LOOKS, shadeOf), or its own colors.
 */
const CLOTH = '#5f7384', SHADE = '#a2aeb8';
/** The jacket filled first, the pattern over it, then its outline over both. */
const jacketWith = (inner: string) => icon(`<path d="${JACKET}" fill="${CLOTH}" stroke="none"/>${inner}<path d="M16 13.4V25" stroke="#46545f" stroke-width="1"/><path d="${JACKET}"/>`);
const PATTERN_ICONS: Record<string, string> = {
  stripes: jacketWith(`<path d="M11.6 13.2V25M14.2 14V25M17.8 14V25M20.4 13.2V25M6.6 14.6l2 3.8M25.4 14.6l-2 3.8" stroke="${SHADE}" stroke-width="1.3"/>`),
  checks: jacketWith(`<path d="M10.3 13.2h2.85v2.95h-2.85zM16 13.4h2.85v2.75H16zM13.15 16.15H16v2.95h-2.85zM18.85 16.15h2.85v2.95h-2.85zM10.3 19.1h2.85v2.95h-2.85zM16 19.1h2.85v2.95H16zM13.15 22.05H16V25h-2.85zM18.85 22.05h2.85V25h-2.85z" fill="${SHADE}" stroke="none"/>`),
  chevron: jacketWith(`<path d="M11 16l5 3 5-3M11 20.2l5 3 5-3" stroke="${SHADE}" stroke-width="1.6"/><path d="M7.4 18.2l1.5 1.1M24.6 18.2l-1.5 1.1" stroke="${SHADE}" stroke-width="1.3"/>`),
  reflective: jacketWith(`<path d="M10.3 20.4h11.4M10.3 23h11.4M7 17.3l1.6 1.9M25 17.3l-1.6 1.9" stroke="#e2e6e2" stroke-width="1.4"/>`),
  'napo-patch': jacketWith(`<path d="M17.4 19h3.4v2.6h-3.4z" fill="#d6ad2f" stroke="none"/><path d="M18 20.3h2.2" stroke="#4a3d12" stroke-width=".8"/><path d="M6.7 15.4l2-1 1.3 2.3-2 1z" fill="#d6ad2f" stroke="none"/>`),
  squares: jacketWith(`<path d="M10.8 19.3h3.8v3.6h-3.8z" fill="#c39a3e" stroke="#e6d6ae" stroke-width=".7" stroke-dasharray="1 .8"/><path d="M17.5 15.3h3.4v3.4h-3.4z" fill="#3e7c77" stroke="#e6d6ae" stroke-width=".7" stroke-dasharray="1 .8"/><path d="M15.2 22.4h2.6V25h-2.6z" fill="#4f6b95" stroke="none"/><path d="M6.7 15.4l2-1 1.3 2.3-2 1z" fill="#a8584a" stroke="none"/>`),
};

/** A pattern's drawing, for the wardrobe's tiles and cards; a sack for one this copy cannot draw. */
export function patternIcon(id: string): string {
  return PATTERN_ICONS[id] ?? SACK;
}

/** No pattern: the jacket as it is. */
export const NO_PATTERN_ICON = jacketWith('');

/**
 * Name tag badges (merits.ts): small, bold shapes, since they sit beside a name on its tag, about as tall
 * as the letters; the wardrobe shows the same drawings larger.
 */
const BADGE_ICONS: Record<string, string> = {
  // A fir on its trunk.
  fir: icon(`<path d="M16 3.5l-6.2 9h3.2l-4.6 7h3.7L8 26h16l-4.1-6.5h3.7l-4.6-7h3.2z" fill="#4f8a55"/><path d="M14.6 26h2.8v3.3h-2.8z" fill="#6b4a31"/>`),
  // A flame, bright at its heart.
  flame: icon(`${halo(16, 18, 12, '#ff9a4a')}<path d="M16 3.5c1.6 4.6 7.2 7.3 7.2 13.6a7.2 7.2 0 0 1-14.4 0c0-3.5 2-5.4 3.4-7.4.4 2.5 1.5 3.7 2.6 4.2C14.6 10.6 15.2 7 16 3.5z" fill="#f08a3a"/>
    <path d="M16 15.6c1 2 3.1 3.1 3.1 5.6a3.1 3.1 0 0 1-6.2 0c0-1.6 1.2-2.9 3.1-5.6z" fill="#ffd27a" stroke="none"/>`),
  // A violet shard.
  shard: icon(`${halo(16, 15, 13, '#a77dff')}<path d="M16 3l-6.4 11L16 28z" fill="#9a6cf0"/><path d="M16 3l6.4 11L16 28z" fill="#c9adff"/><path d="M9.6 14l6.4 2.5 6.4-2.5M16 16.5V28" stroke-width="1.1"/>`),
  // A street lamp with its orange light, the one no wires run to.
  lamp: icon(`${halo(16, 13, 11, '#ffb347')}<path d="M14.9 14.5h2.2v14h-2.2z" fill="#4d5963"/><path d="M10.5 9.5h11l-2.4 4.2h-6.2z" fill="#3a4450"/><path d="M13 13.7h6l-.8 1.6h-4.4z" fill="#ffcf6a" stroke="none"/><path d="M12 28.5h8" stroke-width="1.8"/>`),
  // A pale moth, wings open.
  moth: icon(`<path d="M16 12.5C13.2 7.6 4.5 7.3 4.5 12.8c0 3.9 4.6 5.7 9 4.9-2.8 1.8-4.6 4.8-2.8 7.2 1.9 2 4.1-.9 5.3-4.6 1.2 3.7 3.4 6.6 5.3 4.6 1.8-2.4 0-5.4-2.8-7.2 4.4.8 9-1 9-4.9 0-5.5-8.7-5.2-11.5-.3z" fill="#cdbf9f"/>
    <path d="M16 11.5v10.5M14.6 8.3l1.4 3.2 1.4-3.2" stroke-width="1.3"/><circle cx="9.4" cy="12.4" r="1.4" fill="#8a7a5c" stroke="none"/><circle cx="22.6" cy="12.4" r="1.4" fill="#8a7a5c" stroke="none"/>`),
  // The Old Stone, standing, its crack alight.
  'old-stone': icon(`${halo(16, 16, 13, '#b39bff')}<path d="M10.5 28.5V11.6c0-4.4 2.6-7.6 5.5-7.6s5.5 3.2 5.5 7.6v16.9z" fill="#8a8f96"/><path d="M16.6 7.5l-1.9 5.3 2.2 3.3-1.8 5.6" stroke="#d9ccff" stroke-width="1.5"/><path d="M8 28.5h16" stroke-width="1.8"/>`),
};

/** A badge's drawing, on a name tag and in the wardrobe; none for one this copy cannot draw. */
export function badgeIcon(id: string): string | undefined {
  return BADGE_ICONS[id];
}

/** No badge: an empty name tag. */
export const NO_BADGE_ICON = icon(`<rect x="4.5" y="11" width="23" height="10" rx="5" stroke-width="1.8"/><path d="M10 16h12" stroke-width="1.4" stroke-dasharray="1.6 2"/>`);

/** No outfit: an empty hanger. */
export const NO_OUTFIT_ICON = icon(`<path d="M16 12.6v-1.7c0-1 .6-1.5 1.5-2 .9-.5 1.5-1.1 1.5-2.1 0-1.3-1.2-2.3-2.9-2.3-1.6 0-2.7 1-2.7 2.3" stroke-width="1.8"/>
  <path d="M16 12.6L4.6 21.4c-.8.6-.4 1.9.6 1.9h21.6c1 0 1.4-1.3.6-1.9z" stroke-width="1.8"/>`);

/** The drawing on each tool's button in the bag's header, by the icon its item names (TOOL_ICONS: every one is drawn). */
export const TOOL_DRAWINGS: Readonly<Record<ToolIcon, string>> = { map: MAP_ICON, radio: RADIO_ICON };

/** The drawing for an item: its own, or its slot's in its color for gear, a tool's by its icon (a paper map for one that charts), or a sack. */
export function iconFor(def: ItemDef): string {
  if (ICONS[def.id]) return ICONS[def.id]!;
  if (def.kind === 'tool') return (def.icon && TOOL_DRAWINGS[def.icon]) || (def.chart ? MAP_ICON : SACK);
  if (def.kind === 'gear' && def.slot) return GEAR[def.slot](def.color ?? '#a58a5f');
  return SACK;
}

/** The items that have a drawing of their own. */
export const DRAWN_ITEMS: readonly string[] = Object.keys(ICONS);

const note = (inner: string) => `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${inner}</svg>`;
/** A note's head, tilted as a note's is. */
const head = (cx: number, cy: number) => `<ellipse cx="${cx}" cy="${cy}" rx="3.7" ry="2.75" transform="rotate(-22 ${cx} ${cy})"/>`;

/**
 * Each call drawn as it sounds, so the note you see is the one you learn to hear: one note (here I
 * am), a note held and rising (come here), two quick notes on one pitch (thank you). In the color of
 * whatever draws them: cream on the fan, the caller's jacket over their head.
 */
export const CALL_GLYPHS: Readonly<Record<CallKind, string>> = {
  here: note(`${head(8.2, 17.8)}<path d="M10.9 17.2V3.5h1.8c.4 2.6 2.1 3.9 3.6 5.1 1.6 1.3 2.6 2.7 2.6 4.8 0 1.2-.3 2.2-.8 3 .1-2.6-1.6-4.3-3.6-5.3-.6-.3-1.3-.5-1.8-.6v6.7z"/>`),
  come: note(`${head(6.4, 18.2)}<path d="M9.6 16.5c3.8-1.2 7-4.6 9.1-10.2" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"/><path d="M21.3 2.8l.3 6.6-5.8-3z"/>`),
  thanks: note(`${head(5.9, 18.2)}${head(16.4, 18.2)}<path d="M8.4 17.6V6h1.7v11.6zM18.9 17.6V6h1.7v11.6zM8.4 3.6h12.2V7.2H8.4z"/>`),
};
