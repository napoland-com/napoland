/**
 * Item icons for the bag: small flat drawings in the look of the interface (flat colors with cream
 * outlines on the dark panel), one per item. Inline SVG, so they need no download and stay sharp at
 * any size. An item without its own drawing gets a sack. And the calls' notes, on the fan over B and
 * over the head of whoever calls.
 */
import type { CallKind, Comfort, ItemDef, Slot, ToolIcon } from '@napoland/shared';

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
  // What cooks at a fire (meals.ts). A sprig of huckleberries: dark-blue berries, each with its pale crown, and two leaves.
  huckleberries: icon(`<path d="M6 7.5c3.5 2 6 5.5 7.2 10.5M13.2 18c2-3.4 5.2-5.6 9.3-6.4" stroke-width="1.4"/>
    <path d="M6.2 7.6c-2.8.6-3.6 3.6-2.3 5.7 2.5-.3 3.6-2.9 2.3-5.7z" fill="#5d9c4c"/><path d="M22.5 11.6c1.5 2.6.2 5.4-2.3 5.9-1-2.3.1-5.1 2.3-5.9z" fill="#5d9c4c"/>
    <circle cx="11" cy="21.5" r="3.6" fill="#3b4a9c"/><circle cx="17.8" cy="21" r="3.3" fill="#4a5bb4"/><circle cx="14.5" cy="26" r="3.2" fill="#34438c"/>
    <path d="M10 20.3l1 .6 1-.6M16.9 19.9l.9.6.9-.6M13.6 24.9l.9.6.9-.6" stroke="#c9d2f5" stroke-width="1"/>`),
  // Two fiddleheads: young fern fronds, each tightly curled at the top of its stem.
  fiddleheads: icon(`<path d="M11 28c-.5-6 .2-11 1.8-14.2" stroke-width="3.6"/><path d="M11 28c-.5-6 .2-11 1.8-14.2" stroke="#6bab4f" stroke-width="2"/>
    <path d="M21.5 28c.4-5 0-8.6-1.2-11.5" stroke-width="3.6"/><path d="M21.5 28c.4-5 0-8.6-1.2-11.5" stroke="#6bab4f" stroke-width="2"/>
    <circle cx="10.2" cy="10" r="5.2" fill="#7fc15a"/><path d="M10.2 10c0-1.4 1.6-1.7 2.3-.7.9 1.4-.5 3.3-2.3 3.2-2.4-.1-3.5-2.8-2.4-4.7 1.3-2.3 4.8-2.5 6.3-.3" stroke="#3f7a2f" stroke-width="1.2"/>
    <circle cx="21.6" cy="13.2" r="4.4" fill="#8fd068"/><path d="M21.6 13.2c0-1.2 1.4-1.4 1.9-.6.7 1.2-.4 2.8-1.9 2.7-2-.1-2.9-2.3-2-3.9 1.1-1.9 4-2.1 5.3-.3" stroke="#3f7a2f" stroke-width="1.1"/>`),
  // The end of a fir branch: a woody stem and its soft new needles, bright green.
  'fir-tips': icon(`<path d="M5 27L25.5 6.5" stroke-width="2.4"/><path d="M5 27L25.5 6.5" stroke="#7a5a3a" stroke-width="1.1"/>
    <path d="M9 23l-3.6-2.2M9 23l1.6 3.8M13 19l-4.2-2.4M13 19l1.8 4.4M17 15l-4.4-2.6M17 15l2 4.6M21 11l-4.2-2.6M21 11l2.2 4.2M24.2 7.8l-3.2-2.2M24.2 7.8l2 3.4" stroke="#8ee06a" stroke-width="2.4"/>
    <path d="M25.5 6.5l1.8-2" stroke="#c9f5a8" stroke-width="2"/>`),
  // Two chanterelles: golden funnels, their gills running down the stem.
  chanterelles: icon(`${halo(16, 18, 12, '#ffb84a')}
    <path d="M6 12.5c0-1.5 2.4-2.6 6-2.6s6 1.1 6 2.6c0 1.4-2.2 1.7-3.1 3.2l-1 9.3h-3.8l-1-9.3C8.2 14.2 6 13.9 6 12.5z" fill="#f0a93c"/>
    <path d="M9.5 13.8l2 8M12 14.2v9M14.5 13.8l-2 8" stroke="#b86f1c" stroke-width="1"/>
    <path d="M17 17.5c0-1.2 2-2.1 4.8-2.1s4.8.9 4.8 2.1c0 1.1-1.7 1.4-2.4 2.6l-.8 7.4h-3.1l-.8-7.4c-.7-1.2-2.5-1.5-2.5-2.6z" fill="#f7bf57"/>
    <path d="M3.5 28h25"/>`),
  // A tin cup of fir-tip tea: green, steaming, a sprig on its rim.
  'fir-tip-tea': icon(`<path d="M11 8.5c-1-1.6 1-2.8 0-4.5M16 8c-1-1.6 1-2.8 0-4.5M21 8.5c-1-1.6 1-2.8 0-4.5" stroke-width="1.3"/>
    <path d="M23 15h2.2c1.5 0 2.6 1.2 2.6 2.7s-1.1 2.8-2.6 2.8H23" stroke-width="1.8"/>
    <path d="M6.5 11.5h17v13c0 2-1.6 3.5-3.5 3.5H10c-1.9 0-3.5-1.5-3.5-3.5z" fill="#a7b6be"/>
    <ellipse cx="15" cy="11.5" rx="8.5" ry="2.2" fill="#6fae52"/>
    <path d="M9 11.2l3.2-3.4M10.6 9.2l-2 .2M11.8 8.4l.1-2" stroke="#8ee06a" stroke-width="1.5"/>`),
  // A tin of chanterelle stew over the coals: golden pieces, green bits, and the steam off it.
  'chanterelle-stew': icon(`<path d="M12 9c-1-1.6 1-2.8 0-4.5M17 8.5c-1-1.6 1-2.8 0-4.5" stroke-width="1.3"/>
    <path d="M4.5 13h23M5.5 13v8.5c0 3.6 4.7 6.5 10.5 6.5s10.5-2.9 10.5-6.5V13" fill="#6d7c85"/>
    <ellipse cx="16" cy="13" rx="10.5" ry="3" fill="#c99a4a"/>
    <path d="M10 12.5l2-.8M15 13.8l2.2-.6M19.5 12.2l2 .8" stroke="#f7c35a" stroke-width="2"/><path d="M12.5 14l1.4-.4M18 12l1.2.4" stroke="#6bab4f" stroke-width="1.6"/>`),
  // Berry pemmican: two dense dark cakes, flecked with berries, on a scrap of wax paper.
  'berry-pemmican': icon(`<path d="M3.5 22.5l10-6.5 15 5-10.5 7z" fill="#e9dfc4"/>
    <path d="M6.5 18.5l7.5-4.6 8 3v5.4l-7.5 4.6-8-3z" fill="#5a3b33"/><path d="M6.5 18.5l7.5-4.6 8 3-7.5 4.7z" fill="#7a5044"/>
    <path d="M12.5 12.5l6.8-4.2 7.2 2.7v4.8l-6.8 4.2-7.2-2.7z" fill="#5a3b33"/><path d="M12.5 12.5l6.8-4.2 7.2 2.7-6.8 4.3z" fill="#7a5044"/>
    <circle cx="11" cy="18.4" r="1" fill="#6f7fd6" stroke="none"/><circle cx="15.6" cy="17.4" r="1" fill="#6f7fd6" stroke="none"/><circle cx="18.6" cy="11.4" r="1" fill="#6f7fd6" stroke="none"/><circle cx="21.8" cy="12.6" r="1" fill="#6f7fd6" stroke="none"/>`),
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
  // A NAPO hand warmer: a flat orange packet, hot, with the warmth rising off it.
  'hand-warmer': icon(`${halo(16, 18, 13, '#ff8a3a')}
    <rect x="6.5" y="12" width="19" height="14" rx="3" fill="#e0683a"/>
    <path d="M6.5 16.5h19" stroke="#ffcf8a" stroke-width="1.3"/>
    <path d="M11 21h10" stroke="#ffd9b0" stroke-width="1.2"/>
    <path d="M11.5 9.5c-1.2-1.4 1.2-2.6 0-4.2M16 9.5c-1.2-1.4 1.2-2.6 0-4.2M20.5 9.5c-1.2-1.4 1.2-2.6 0-4.2" stroke="#ffd08a" stroke-width="1.4"/>`),
  // A foil strip of NAPO's rad tablets over a band of NAPO yellow: one pressed out, two still in.
  'rad-tablet': icon(`<rect x="4.5" y="9" width="23" height="14" rx="2" fill="#aebbc1"/>
    <rect x="5.2" y="19.6" width="21.6" height="2.8" fill="#d6ad2f" stroke="none"/>
    <circle cx="10" cy="14.2" r="3" fill="#f4f1e8"/>
    <circle cx="16" cy="14.2" r="3" fill="#7d8b92"/>
    <circle cx="22" cy="14.2" r="3" fill="#f4f1e8"/>
    <path d="M9 13.6h2M21 13.6h2" stroke="#b7b2a6" stroke-width="1"/>`),
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
  // Curled strips of red cedar bark, one across the others.
  'cedar-bark': icon(`<path d="M5 22.5c3.5-1.6 13-6.8 19.5-12.3 1.3-1.1 3 .4 2 1.7-4.6 6-14.6 12.1-19.8 13.6-1.8.5-3.4-2.1-1.7-3z" fill="#9c5436"/>
    <path d="M6.5 16c4.4.7 14 1.3 20.5 4.4 1.5.7.9 2.8-.7 2.5-6.9-1.3-15.8-1.7-20.3-3.7-1.6-.7-1.3-3.4.5-3.2z" fill="#b8683f"/>
    <path d="M9.5 17.3c4.2.5 10.4 1 15.5 2.9M8.8 22.4c4.6-2.3 10-5.5 15.4-10" stroke="#e9b98a" stroke-width="1.1"/>`),
  // An old dry cell stamped NAPO: dark steel, a band of NAPO yellow, a spring terminal on top.
  battery: icon(`<rect x="10" y="7.5" width="12" height="21" rx="1.8" fill="#4d5963"/>
    <path d="M10 15h12v5H10z" fill="#d6ad2f" stroke="none"/>
    <path d="M13.5 5.2h5v2.3h-5z" fill="#aebbc1"/>
    <path d="M13 11h6M16 22.5v3.4M14.3 24.2h3.4" stroke="#e8dfc8" stroke-width="1.3"/>`),
  // A drop of amber with a seed caught inside it.
  'resin-tear': icon(`${halo(16, 17, 12, '#ffb347')}
    <path d="M16 4.5c-2.8 5.2-8 9.6-8 15 0 4.6 3.6 8 8 8s8-3.4 8-8c0-5.4-5.2-9.8-8-15z" fill="#f2a53c"/>
    <path d="M14.5 17.2c1.4-1.8 3.8-1.6 4.4.4.6 2.2-1.4 4.4-3.4 3.8-1.8-.6-2.2-2.6-1-4.2z" fill="#6b4020"/>
    <path d="M12.4 14.2c.6-1.4 1.4-2.6 2.2-3.4" stroke="#ffe3a8" stroke-width="1.3"/>`),
  // A lump of green glass from the scar, bubbled, with a bright edge where it broke.
  'fused-glass': icon(`${halo(16, 17, 12, '#8fe0b4')}
    <path d="M5.5 19.5l4.5-8 7.5-3 8 4.5 1.5 7.5-6 5.5-9.5-.5z" fill="#4f9a78"/>
    <path d="M10 11.5l5 5.5 10.5-4.5M15 17l1.5 9" stroke="#2c5c47" stroke-width="1.2"/>
    <circle cx="11" cy="20" r="1.3" fill="#bff0d6" stroke="none"/><circle cx="20.5" cy="19" r="1" fill="#bff0d6" stroke="none"/>
    <path d="M11.5 12.5l4-1.6" stroke="#dcfff0" stroke-width="1.3"/>`),
  // NAPO's grey steel lockbox: a lid, a band of NAPO yellow and a padlock that has not been opened since the evacuation.
  lockbox: icon(`<path d="M4.5 13h23v13.5c0 .8-.7 1.5-1.5 1.5H6c-.8 0-1.5-.7-1.5-1.5z" fill="#7d8b92"/>
    <path d="M4 9.8c0-1 .8-1.8 1.8-1.8h20.4c1 0 1.8.8 1.8 1.8V13H4z" fill="#aebbc1"/>
    <path d="M4.5 17.2h23v3.4h-23z" fill="#d6ad2f" stroke="none"/>
    <path d="M14.3 15.6v-1.9a1.7 1.7 0 0 1 3.4 0v1.9" stroke-width="1.4"/>
    <rect x="12.6" y="15.6" width="6.8" height="6.6" rx="1.2" fill="#4d5963"/>
    <circle cx="16" cy="18.4" r=".9" fill="#e8dfc8" stroke="none"/><path d="M16 19.2v1.4" stroke-width="1.1"/>`),
  // Someone else's things, tied up in a cloth to carry to the lodge: its corners knotted on top, and a paper tag with their name.
  bundle: icon(`<path d="M5.5 16.5c0-3 2.2-4.5 5-4.5h11c2.8 0 5 1.5 5 4.5v6.8c0 2.9-2.3 4.7-5.2 4.7H10.7c-2.9 0-5.2-1.8-5.2-4.7z" fill="#9a5b43"/>
    <path d="M12.2 12.4c-1.6-1.8-2.6-4.3-1.6-6 .9 1.6 3 2.7 5.4 3.3 2.4-.6 4.5-1.7 5.4-3.3 1 1.7 0 4.2-1.6 6" fill="#b86f52"/>
    <circle cx="16" cy="11.4" r="1.9" fill="#7a432f"/>
    <path d="M6.2 19.6c3.1 1 6.4 1.5 9.8 1.5s6.7-.5 9.8-1.5" stroke="#6b3a28" stroke-width="1.2"/>
    <path d="M20.4 20.8l2.6 3.2" stroke-width="1.1"/>
    <rect x="21.4" y="23.2" width="6" height="4.2" rx=".8" fill="#e8dfc8" stroke="#6b5234" stroke-width="1" transform="rotate(12 24.4 25.3)"/>
    <path d="M23 25.1h3" stroke="#6b5234" stroke-width=".9" transform="rotate(12 24.4 25.3)"/>`),
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

/** Furniture for the cabin (comfort.ts), by the place it goes into: one drawing per place, whatever the piece is called. */
const FURNITURE: Record<Comfort, string> = {
  // An iron stove on its legs, its grate glowing, a pipe up and a kettle on top.
  stove: icon(`${halo(16, 20, 10, '#ff8a3a')}
    <path d="M19.5 3h3.2v8.4h-3.2z" fill="#3d4448"/>
    <rect x="6.5" y="11" width="19" height="15" rx="1.6" fill="#2f3438"/>
    <rect x="10" y="16" width="12" height="6" rx="1" fill="#ff8a3a"/><path d="M10 19h12" stroke="#ffd08a" stroke-width="1"/>
    <path d="M8.5 26v2.6M23.5 26v2.6"/>
    <path d="M8.6 11c0-2.3 1.7-3.8 3.9-3.8s3.9 1.5 3.9 3.8z" fill="#7d8b92"/><path d="M16.2 8.8l2.2-1.5"/>`),
  // A made bed: its frame, a mattress, a red blanket and a pillow.
  bed: icon(`<path d="M3.5 12v15.5M28.5 17v10.5" stroke-width="1.8"/>
    <rect x="3.5" y="19.5" width="25" height="4.6" fill="#5a3d2a"/>
    <rect x="4.6" y="15.6" width="22.8" height="4.2" rx="1" fill="#d6cdb9"/>
    <path d="M12.4 15.6h15v4.2h-15z" fill="#7a3b35"/>
    <rect x="5.4" y="12.6" width="6.2" height="3.6" rx="1.6" fill="#ece5d4"/>`),
  // A braided rag rug, ring on ring.
  rug: icon(`<ellipse cx="16" cy="17" rx="13" ry="8" fill="#6b2f2a"/>
    <ellipse cx="16" cy="17" rx="9.6" ry="5.6" fill="#b08a58" stroke="none"/>
    <ellipse cx="16" cy="17" rx="6.2" ry="3.5" fill="#3d4e5c" stroke="none"/>
    <ellipse cx="16" cy="17" rx="2.6" ry="1.4" fill="#c2a36a" stroke="none"/>`),
  // An oil lamp lit: a brass foot, a glass chimney and its flame.
  lamp: icon(`${halo(16, 14, 11, '#ffcf6a')}
    <path d="M10.5 27h11l-1.8-4.6h-7.4z" fill="#b8943e"/>
    <path d="M12.8 22.4c-1.9-1.5-2.7-3.5-2.7-5.7 0-3.5 2.5-6.2 5.9-6.2s5.9 2.7 5.9 6.2c0 2.2-.8 4.2-2.7 5.7z" fill="#f7e6b0"/>
    <path d="M16 13.2c1.3 1.4 1.8 2.8 1.8 3.9 0 1.2-.8 2.1-1.8 2.1s-1.8-.9-1.8-2.1c0-1.1.5-2.5 1.8-3.9z" fill="#ffb347" stroke="none"/>
    <path d="M13.6 5.5h4.8v5h-4.8z" fill="#b8943e"/>`),
  // A drying rack, its rails hung with a shirt and a sock.
  rack: icon(`<g stroke-width="3.6"><path d="M6.5 28L11.5 5.5M25.5 28l-5-22.5M8.8 18.5h14.4M10.4 11.5h11.2"/></g>
    <g stroke="#8a6a44" stroke-width="1.8"><path d="M6.5 28L11.5 5.5M25.5 28l-5-22.5M8.8 18.5h14.4M10.4 11.5h11.2"/></g>
    <path d="M11.8 11.5l3.4 1.4 3.4-1.4 2.4 2.8-1.4 1.2v4.2h-8.8v-4.2l-1.4-1.2z" fill="#3d6a8a"/>
    <path d="M20.2 18.5v5.2l2.6 1 .8-1.6-1.4-.8v-3.8z" fill="#c9c2b0"/>`),
  // A shelf of odd treasures: a warm pebble, a glass bead and a feather up top, a shard-lined cap and a shard below.
  shelf: icon(`<rect x="3.5" y="10" width="25" height="2.6" fill="#5a3d2a"/><rect x="3.5" y="20.4" width="25" height="2.6" fill="#5a3d2a"/>
    <path d="M6 12.6v15M26 12.6v15"/>
    <ellipse cx="9.2" cy="8.2" rx="3.2" ry="1.8" fill="#2c2623"/><circle cx="15.6" cy="7.4" r="2.3" fill="#7ff3e6"/>
    <path d="M19.5 9.6c.6-3.2 3.2-5.6 7.2-5.9-.6 3.5-3.1 5.9-7.2 5.9z" fill="#a9a6a0"/>
    <path d="M8.2 20.4c0-3.1 2.1-5.2 4.8-5.2s4.8 2.1 4.8 5.2z" fill="#9a6cf0"/><path d="M21.6 20.4l1.8-5.6 1.8 5.6z" fill="#c9adff"/>`),
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
  // From the shop (content/shop.json). A yellow oilskin to the knees with two toggles, black boots, and a sou'wester.
  'lighthouse-oilskin': icon(`<path d="${BOOTS}" fill="#1f2326"/><path d="${COAT}" fill="#e5b53a"/>
    <path d="M16 13.4V27.8" stroke="#b8892a" stroke-width="1.2"/><path d="M14.7 17.4h2.6M14.7 21.4h2.6" stroke="#6b4a24" stroke-width="1.3"/>
    ${HEAD}<path d="M12.2 7.4c0-2.9 1.7-4.8 3.8-4.8s3.8 1.9 3.8 4.8z" fill="#e5b53a"/><path d="M9.4 7.2h13.2l-1.4 2.3H10.8z" fill="#e5b53a"/>`),
  // A long navy parka with low pockets, its hood up and lined in fur round the face, and red mittens.
  'winter-parka': icon(`<path d="${TROUSERS}" fill="#3a3a40"/><path d="M12 11l4 2.4 4-2.4 6.5 4.2-2.6 5-2.2-1.2v3l.6 4.2H10.7l.6-4.2v-3l-2.2 1.2-2.6-5z" fill="#2c4a63"/>
    <path d="M16 13.4v11.8" stroke="#1f3547" stroke-width="1.1"/><path d="M11.4 21.6h3M16.6 21.6h3" stroke="#1f3547" stroke-width="1.3"/>
    <circle cx="6.6" cy="18.8" r="1.6" fill="#a33b3b"/><circle cx="25.4" cy="18.8" r="1.6" fill="#a33b3b"/>
    <path d="M10.6 11.4c0-4.9 2.4-8.2 5.4-8.2s5.4 3.3 5.4 8.2z" fill="#2c4a63"/><path d="M12.3 11.1V9.8c0-2.8 1.6-4.6 3.7-4.6s3.7 1.8 3.7 4.6v1.3z" fill="#e6d9c2" stroke="none"/>
    <path d="M13.6 11.1v-.9c0-1.9 1-3.1 2.4-3.1s2.4 1.2 2.4 3.1v.9z" fill="#f2cda8" stroke="none"/>`),
  // NAPO's navy dress uniform: yellow buttons and hem, boards on the shoulders, white gloves, a peaked cap.
  'napo-dress-uniform': icon(`<path d="${TROUSERS}" fill="#1f2738"/><path d="${JACKET}" fill="#26324a"/>
    <path d="M10.4 24.1h11.2" stroke="#d6ad2f" stroke-width="1.3"/><path d="M12.6 12.3l-2.4 1.5M19.4 12.3l2.4 1.5" stroke="#d6ad2f" stroke-width="1.7"/>
    <path d="M14.2 16.2h.1M17.8 16.2h.1M14.2 20h.1M17.8 20h.1" stroke="#d6ad2f" stroke-width="1.6"/>
    <circle cx="6.8" cy="18.6" r="1.4" fill="#ecebe6"/><circle cx="25.2" cy="18.6" r="1.4" fill="#ecebe6"/>
    ${HEAD}<path d="M11.4 7c0-2.5 2-4.4 4.6-4.4s4.6 1.9 4.6 4.4z" fill="#26324a"/><path d="M11.4 5.9h9.2v1.3h-9.2z" fill="#d6ad2f" stroke="none"/><path d="M12.4 7.2h7.2l-.9 1.7h-5.4z" fill="#15181e"/>`),
  // A cranberry sweater with a cream band of zigzags, green at the hem, jeans, and cream earmuffs on a band.
  'festival-sweater': icon(`<path d="${TROUSERS}" fill="#3d4658"/><path d="${JACKET}" fill="#b33a4a"/>
    <path d="M10.4 17.4h11.2v3H10.4z" fill="#e6d6ae" stroke="none"/><path d="M10.8 19.8l1.3-1.6 1.3 1.6 1.3-1.6 1.3 1.6 1.3-1.6 1.3 1.6 1.3-1.6 1.3 1.6" stroke="#b33a4a" stroke-width="1"/>
    <path d="M10.4 24.2h11.2" stroke="#2f6b4a" stroke-width="1.7"/>
    ${HEAD}<path d="M12.6 7.8C12.6 3.4 19.4 3.4 19.4 7.8" stroke="#7a2a36" stroke-width="1.4"/><circle cx="12.4" cy="8.6" r="1.8" fill="#e6d6ae"/><circle cx="19.6" cy="8.6" r="1.8" fill="#e6d6ae"/>`),
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
  // From the shop. Diamonds in two shades of the cloth, and one on each sleeve.
  argyle: jacketWith(`<path d="M13.1 14l1.6 2.3-1.6 2.3-1.6-2.3zM18.9 14l1.6 2.3-1.6 2.3-1.6-2.3zM16 18.8l1.6 2.3-1.6 2.3-1.6-2.3z" fill="${SHADE}" stroke="none"/>
    <path d="M16 14l1.6 2.3-1.6 2.3-1.6-2.3zM13.1 18.8l1.6 2.3-1.6 2.3-1.6-2.3zM18.9 18.8l1.6 2.3-1.6 2.3-1.6-2.3z" fill="#8497a6" stroke="none"/>
    <path d="M7.3 16.2l1.2 1.3-1.2 1.3-1.2-1.3zM24.7 16.2l1.2 1.3-1.2 1.3-1.2-1.3z" fill="${SHADE}" stroke="none"/>`),
  // A green band and a violet one round the body, and green at the sleeves: the sky every third night.
  'aurora-bands': jacketWith(`<path d="M10.3 20.2h11.4" stroke="#5fd49a" stroke-width="1.7"/><path d="M10.3 22.9h11.4" stroke="#9b7be0" stroke-width="1.7"/><path d="M7 17.3l1.6 1.9M25 17.3l-1.6 1.9" stroke="#5fd49a" stroke-width="1.4"/>`),
  // A yellow bolt down the front, and a small one on the sleeve.
  lightning: jacketWith(`<path d="M18.4 13.4l-4 5.2h2.7l-2.8 6 5.3-7h-2.9l2.4-4.2z" fill="#f2c94c" stroke="none"/><path d="M24.6 15.2l-1.2 1.9h1.3l-.9 1.8" stroke="#f2c94c" stroke-width="1.1"/>`),
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
  // From the shop. A red heart.
  heart: icon(`${halo(16, 16, 12, '#ff6b7a')}<path d="M16 26.5C9.5 21.8 5.5 18.2 5.5 13.4c0-3.3 2.4-5.9 5.4-5.9 2.2 0 3.9 1.2 5.1 3.1 1.2-1.9 2.9-3.1 5.1-3.1 3 0 5.4 2.6 5.4 5.9 0 4.8-4 8.4-10.5 13.1z" fill="#d64556"/><path d="M9.6 12.4c.4-1.4 1.4-2.2 2.6-2.3" stroke="#ffc2c9" stroke-width="1.3"/>`),
  // The NAPO Tower: a red and white mast, its dish turned to the woods, its red light.
  tower: icon(`${halo(16, 5.4, 5, '#ff4a3a')}<path d="M14.2 28.5L15.2 7h1.6l1 21.5z" fill="#e8e4dc"/><path d="M14.55 21h2.9l.2 4h-3.3zM14.9 13.4h2.2l.15 3.6h-2.5z" fill="#d23c30" stroke="none"/>
    <path d="M17.2 10.2c3.2-.6 5.4 1 5.8 3.6-2.8.8-5 .1-5.8-3.6z" fill="#b8bec4"/><circle cx="16" cy="5.4" r="1.5" fill="#ff4a3a" stroke="none"/><path d="M11 28.5h10" stroke-width="1.8"/>`),
  // A snowflake, pale blue.
  snowflake: icon(`${halo(16, 16, 12, '#a8d8ff')}<g stroke="#cfeaff" stroke-width="1.8"><path d="M16 4v24M5.6 10l20.8 12M5.6 22l20.8-12"/>
    <path d="M13.4 5.8L16 8.2l2.6-2.4M13.4 26.2L16 23.8l2.6 2.4M5.9 13.6l3.4-.9-.8-3.5M26.1 18.4l-3.4.9.8 3.5M5.9 18.4l3.4.9-.8 3.5M26.1 13.6l-3.4-.9.8-3.5"/></g>`),
};

/** A badge's drawing, on a name tag and in the wardrobe; none for one this copy cannot draw. */
export function badgeIcon(id: string): string | undefined {
  return BADGE_ICONS[id];
}

/** A cloud, grey: the sky over a region, with or without what falls from it. */
const CLOUD = '<path d="M9.2 21h13.6a5 5 0 0 0 .7-9.95A7 7 0 0 0 10.4 12a4.5 4.5 0 0 0-1.2 9z" fill="#8a96a8"/>';

/**
 * The notice board's drawings (board.ts): the sky, the clocks of each region, what stands out there and
 * the town's news, in the look of the rest (flat colors, cream outlines), some of them the badges'.
 */
export const BOARD_ICONS = {
  sun: icon(`${halo(16, 16, 13, '#ffd36a')}<circle cx="16" cy="16" r="5.5" fill="#ffcf5a"/>
    <path d="M16 4.5v3.2M16 24.3v3.2M4.5 16h3.2M24.3 16h3.2M7.9 7.9l2.2 2.2M21.9 21.9l2.2 2.2M7.9 24.1l2.2-2.2M21.9 10.1l2.2-2.2" stroke-width="1.8"/>`),
  moon: icon(`${halo(16, 16, 13, '#b9c6ff')}<path d="M19.5 5a11 11 0 1 0 8 16.5A9 9 0 0 1 19.5 5z" fill="#e3e6f5"/>`),
  aurora: icon(`${halo(16, 14, 13, '#7ff0a8')}<path d="M4 19c4-8 8-10 12-6s8 2 12-6" stroke="#7ff0a8" stroke-width="2.4"/><path d="M4 24c4-6 8-8 12-4s8 2 12-4" stroke="#6ad0ff" stroke-width="1.6"/>
    <circle cx="9" cy="8" r="1" fill="${CREAM}" stroke="none"/><circle cx="24" cy="21" r="1" fill="${CREAM}" stroke="none"/>`),
  cloud: icon(CLOUD),
  rain: icon(`${CLOUD}<path d="M11.5 24l-1.2 3.2M16.5 24l-1.2 3.2M21.5 24l-1.2 3.2" stroke="#8cc8ff" stroke-width="1.8"/>`),
  snow: BADGE_ICONS.snowflake!,
  // A surge: a violet wave rolling in.
  surge: icon(`${halo(16, 16, 13, '#a77dff')}<path d="M3 18c3-6.5 6-6.5 9 0s6 6.5 9 0 5-6.5 8 0" stroke="#c9adff" stroke-width="2.4"/><path d="M6 24c2.5-3 5-3 7.5 0s5 3 7.5 0" stroke="#8a6cd0" stroke-width="1.6"/>`),
  storm: icon(`<path d="M9.2 17h13.6a5 5 0 0 0 .7-9.95A7 7 0 0 0 10.4 8a4.5 4.5 0 0 0-1.2 9z" fill="#5d6778"/><path d="M17.4 15.5l-3.9 6.3h3.1l-2.2 6 5.9-8h-3.1l2.2-4.3z" fill="#ffcf5a" stroke="none"/>`),
  flame: BADGE_ICONS.flame!,
  // The fire lookout: a timber tower, its lamp alight under the roof.
  lookout: icon(`${halo(16, 11, 7, '#ffcf6a')}<path d="M11.2 28.5l2.4-15h4.8l2.4 15" stroke-width="1.6"/><path d="M12.3 23h7.4M12.9 18.5h6.2" stroke-width="1.3"/>
    <path d="M10.5 13.5h11V10h-11z" fill="#8a6440"/><path d="M9 10l7-4.5 7 4.5z" fill="#6b4a31"/><circle cx="16" cy="11.8" r="1.2" fill="#ffcf6a" stroke="none"/>`),
  // A footbridge: its planks between two rails, the creek under it.
  footbridge: icon(`<path d="M6.5 12.5v8M10.5 12.5v8M14.5 12.5v8M18.5 12.5v8M22.5 12.5v8M26.5 12.5v8" stroke="#a9825a" stroke-width="2.6"/><path d="M3.5 12.5h25M3.5 20.5h25" stroke-width="1.6"/>
    <path d="M3 26c2.5-1.4 4.5-1.4 7 0s4.5 1.4 7 0 4.5-1.4 7 0 3.5 1 5 0" stroke="#5aa0d8" stroke-width="1.5"/>`),
  light: BADGE_ICONS.lamp!,
  // The slab in the ring of stones, glowing.
  slab: icon(`${halo(16, 18, 12, '#b39bff')}<path d="M4.5 21l4-6h15l4 6-4 3.5h-15z" fill="#8a8f96"/><path d="M11 18.8h10" stroke="#d9ccff" stroke-width="1.5"/>`),
  stone: BADGE_ICONS['old-stone']!,
  // Someone back in town.
  person: icon(`<circle cx="16" cy="10.5" r="4.6" fill="#d9cfb8"/><path d="M7.5 27.5c0-5.2 3.8-8.7 8.5-8.7s8.5 3.5 8.5 8.7z" fill="#8a7a5c"/>`),
  // Someone down: collapsed out there.
  down: icon(`<path d="M4.5 23h23" stroke-width="1.4"/><circle cx="8.5" cy="18.3" r="2.9" fill="#d9cfb8"/><path d="M12.2 20h11.6a2.1 2.1 0 0 0 0-4.2H12.2z" fill="#8a7a5c"/>`),
  // The first to find a secret.
  star: icon(`<path d="M16 4.5l3.3 7 7.7.9-5.7 5.2 1.5 7.6-6.8-3.8-6.8 3.8 1.5-7.6-5.7-5.2 7.7-.9z" fill="#ffcf5a"/>`),
  // The town's ledger at the lodge.
  ledger: icon(`<path d="M7 6h15a3 3 0 0 1 3 3v17.5H10a3 3 0 0 1-3-3z" fill="#8a6440"/><path d="M10 26.5a3 3 0 0 1-3-3 3 3 0 0 1 3-3h15" stroke-width="1.5"/><path d="M11 10.5h9M11 14h6.5" stroke-width="1.3"/>`),
  // A day's parcel from the town's stores, tied with twine.
  parcel: icon(`<path d="M5.5 12.5h21v14h-21z" fill="#a9825a"/><path d="M4.5 8.5h23v4h-23z" fill="#c69a64"/><path d="M16 8.5v18" stroke-width="2"/><path d="M16 8.5c-2.5-3.5-6-3.5-6-1.5s3.5 1.5 6 1.5c2.5 0 6 .5 6-1.5s-3.5-2-6 1.5z" stroke-width="1.4"/>`),
  // The season: a leaf.
  season: icon(`<path d="M6.5 25.5C6.5 13.5 13.5 7 26 6c-1 12.5-7.5 19.5-19.5 19.5z" fill="#6bab4f"/><path d="M6.5 25.5L19 13" stroke-width="1.5"/>`),
  // What the woods are like today or this week: a notice pinned up.
  notice: icon(`<path d="M7 7.5h18v19H7z" fill="#e8dfc8"/><path d="M11 13h10M11 17h10M11 21h6" stroke="#6b5a40" stroke-width="1.5"/><circle cx="16" cy="7.5" r="1.8" fill="#d23c30" stroke="none"/>`),
  check: icon(`<path d="M7.5 16.5l5.2 5.2L24.5 9.5" stroke="#8fd98a" stroke-width="3"/>`),
  chevron: icon(`<path d="M10 13l6 6 6-6" stroke-width="2.2"/>`),
} as const;
export type BoardIcon = keyof typeof BOARD_ICONS;

/** No badge: an empty name tag. */
export const NO_BADGE_ICON = icon(`<rect x="4.5" y="11" width="23" height="10" rx="5" stroke-width="1.8"/><path d="M10 16h12" stroke-width="1.4" stroke-dasharray="1.6 2"/>`);

/** No outfit: an empty hanger. */
export const NO_OUTFIT_ICON = icon(`<path d="M16 12.6v-1.7c0-1 .6-1.5 1.5-2 .9-.5 1.5-1.1 1.5-2.1 0-1.3-1.2-2.3-2.9-2.3-1.6 0-2.7 1-2.7 2.3" stroke-width="1.8"/>
  <path d="M16 12.6L4.6 21.4c-.8.6-.4 1.9.6 1.9h21.6c1 0 1.4-1.3.6-1.9z" stroke-width="1.8"/>`);

/** Bolt cutters: two long steel handles with red grips, crossing at the bolt, and short jaws edged with a sliver of shard. */
export const CUTTERS_ICON = icon(`<path d="M13 14.6l12.6 12.8M14.6 13l12.8 12.6" stroke-width="4.4"/>
  <path d="M13 14.6l12.6 12.8M14.6 13l12.8 12.6" stroke="#6d7780" stroke-width="2.3"/>
  <path d="M20.6 22.4l5 5M22.4 20.6l5 5" stroke="#c0452f" stroke-width="2.6"/>
  <path d="M14.8 13.2L4.6 4.4c3.2.3 6.9 2.2 9.8 5.2 1.5 1.6 1.7 2.8.4 3.6z" fill="#aebbc1"/>
  <path d="M13.2 14.8L4.4 4.6c.3 3.2 2.2 6.9 5.2 9.8 1.6 1.5 2.8 1.7 3.6.4z" fill="#aebbc1"/>
  <path d="M5.4 5.4l5.2 4.6" stroke="#b89cff" stroke-width="1.2"/>
  <circle cx="14" cy="14" r="1.8" fill="#57636a"/>`);

/** Chest waders: a rubber bib on its braces, the legs down into boots, a copper seam at the waist. */
export const WADERS_ICON = icon(`<path d="M10.6 9L9.2 3.6M21.4 9l1.4-5.4" stroke-width="1.6"/>
  <path d="M9.5 8.6h13v7.8l1.5 9.6h-5.3l-2.7-8.4-2.7 8.4H7.9l1.6-9.6z" fill="#5f6d43"/>
  <path d="M9.5 13.2h13" stroke="#d9773a" stroke-width="1.1" stroke-dasharray="1.4 1"/>
  <path d="M7.7 26h5.5v2.7H6.3c0-1.5.6-2.7 1.4-2.7zM18.8 26h5.5c.8 0 1.4 1.2 1.4 2.7h-6.9z" fill="#3a2f24"/>`);

/** A lantern: a scrap cage on a wire bail, green fused glass inside, and its warm light. */
export const LANTERN_ICON = icon(`${halo(16, 18, 11, '#ffc56b')}
  <path d="M11.4 9.6C11.4 5.2 20.6 5.2 20.6 9.6" stroke-width="1.6"/>
  <path d="M10.6 10.2h10.8l-1.2 2.2h-8.4z" fill="#6d7780"/>
  <path d="M12 12.4h8v11.2h-8z" fill="#7fd08a" opacity=".85"/>
  <path d="M14.6 21.4c-1.6-2.4.6-4.2 1.4-6 .8 1.8 3 3.6 1.4 6z" fill="#ffd98a" stroke="none"/>
  <path d="M12 12.4v11.2M20 12.4v11.2M16 12.4v2" stroke="#6d7780" stroke-width="1.3"/>
  <path d="M10.4 23.6h11.2v2.6H10.4z" fill="#57636a"/>`);

/** The drawing on each tool's button in the bag's header, by the icon its item names (TOOL_ICONS: every one is drawn). */
export const TOOL_DRAWINGS: Readonly<Record<ToolIcon, string>> = { map: MAP_ICON, radio: RADIO_ICON, cutters: CUTTERS_ICON, waders: WADERS_ICON, lantern: LANTERN_ICON };

/**
 * The drawing for an item: its own, or its slot's in its color for gear, a tool's by its icon (a paper map
 * for one that charts), furniture's by the place it goes into, or a sack.
 */
export function iconFor(def: ItemDef): string {
  if (ICONS[def.id]) return ICONS[def.id]!;
  if (def.kind === 'tool') return (def.icon && TOOL_DRAWINGS[def.icon]) || (def.chart ? MAP_ICON : SACK);
  if (def.kind === 'gear' && def.slot) return GEAR[def.slot](def.color ?? '#a58a5f');
  if (def.kind === 'furniture' && def.furnishes && FURNITURE[def.furnishes]) return FURNITURE[def.furnishes];
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
