/**
 * Who makes napoland and where its code, privacy policy and legal notice are: the About panel in
 * the menu, and the small print under every sign-in card. The code is under the AGPL, which asks
 * that everyone who plays the game over the network is offered its source (section 13), so the
 * link to it is the biggest thing in the About panel and is on every sign-in card too.
 */

/** Where the game's code is: the AGPL's offer of the source to everyone who plays. */
export const SOURCE_URL = 'https://github.com/napoland-com/napoland';
/** Served by the game itself (apps/client/public/privacy.html). */
export const PRIVACY_URL = '/privacy.html';
export const LEGAL_URL = 'https://www.neuramare.com/policies/legal-notice';
export const PUBLISHER = 'Angelo Lamonaca (Neuramare)';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * A link that opens in a new tab, so the game keeps running behind it; noopener, so the page it
 * opens cannot reach back into the game. `inner` is HTML (an icon, then the words).
 */
function link(href: string, inner: string, className = ''): string {
  return `<a${className && ` class="${esc(className)}"`} href="${esc(href)}" target="_blank" rel="noopener">${inner}</a>`;
}

const CODE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 6-6 6 6 6M16 6l6 6-6 6"/></svg>';

/** The small print under every sign-in card. (Who publishes the game is said in the About panel.) */
export function signInFooter(): string {
  const dot = '<span aria-hidden="true">·</span>';
  return `<footer class="legal">
      <nav aria-label="About napoland">${link(PRIVACY_URL, 'Privacy')}${dot}${link(LEGAL_URL, 'Legal notice')}${dot}${link(SOURCE_URL, 'Source code')}</nav>
      <p>Built by the community. Open source project.</p>
    </footer>`;
}

/**
 * The About panel under its title. The running version goes in `[data-el="version"]` once the
 * server has said it (see versionView); until then that line stays hidden.
 */
export function aboutBody(): string {
  // Each license stays on one line: a narrow screen breaks the line between the two.
  return `<div class="about-body">
      <p>napoland is open source and made by its community.</p>
      <p>Published by ${esc(PUBLISHER)}.</p>
      ${link(SOURCE_URL, `${CODE_ICON}<span>Source code</span>`, 'source')}
      <nav class="more" aria-label="More about napoland">${link(PRIVACY_URL, 'Privacy')}${link(LEGAL_URL, 'Legal notice')}</nav>
      <p class="fine"><span>Code: AGPL-3.0-or-later</span> · <span>World and items: CC BY-SA 4.0</span></p>
      <p class="fine">© 2026 ${esc(PUBLISHER)} and the napoland contributors</p>
      <p class="fine" data-el="version" hidden></p>
    </div>`;
}

/** A release is named after its commit (tools/deploy.mjs); a build from a changed checkout adds "-dirty-...". */
const COMMIT_RE = /^[0-9a-f]{7,40}$/;

/**
 * How the About panel shows the version the server runs (/health: a release's commit, or "dev"):
 * a release links to exactly its code, anything else is only shown.
 */
export function versionView(version: string): { text: string; href: string | null } {
  return { text: `Version ${version}`, href: COMMIT_RE.test(version) ? `${SOURCE_URL}/tree/${version}` : null };
}

/** The version the server runs, from /health; null when it cannot tell (the About panel then shows none). Never throws. */
export async function loadVersion(get: (path: string) => Promise<Response> = path => fetch(path, { cache: 'no-store' })): Promise<string | null> {
  try {
    const res = await get('/health');
    if (!res.ok) return null;
    const { version } = (await res.json()) as { version?: unknown };
    if (typeof version !== 'string') return null;
    const v = version.trim();
    return v && v.length <= 64 ? v : null;
  } catch {
    return null;
  }
}
