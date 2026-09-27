/**
 * Item icons for the bag: small flat drawings in the look of the interface (flat colors with cream
 * outlines on the dark panel), one per item. Inline SVG, so they need no download and stay sharp at
 * any size. An item without its own drawing gets a sack.
 */
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
  // A steel thermos: dark cup, red band, a handle.
  thermos: icon(`<path d="M21.5 12.5h1.6c1 0 1.8.8 1.8 1.8v6.4c0 1-.8 1.8-1.8 1.8h-1.6" fill="none" stroke-width="1.8"/>
    <rect x="10.5" y="9.5" width="11" height="19" rx="2.2" fill="#a7b6be"/>
    <path d="M10.5 17h11v3.4h-11z" fill="#c8453a"/>
    <rect x="9.5" y="4" width="13" height="6" rx="1.6" fill="#4d5963"/>
    <path d="M13.5 12v3.2M13.5 22.4v3.4" stroke="#eef4f6" stroke-width="1.3"/>`),
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

/** The items that have a drawing of their own. */
export const DRAWN_ITEMS: readonly string[] = Object.keys(ICONS);
