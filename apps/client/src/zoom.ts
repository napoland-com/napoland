/**
 * Keeps the game from zooming on phones. iPhone Safari ignores user-scalable=no (so that people can
 * always zoom a web page), and two thumbs on the screen, one on the stick and one on A or B, look like
 * a pinch to it: the page zooms in, and since the game area stops touch gestures, it cannot be
 * pinched back out. So pinches are cancelled before they zoom (Safari's gesture events, and touch
 * moves that change the distance between the fingers), and a page that got zoomed anyway is set back.
 */

type Target = Pick<EventTarget, 'addEventListener'>;

export interface ZoomGuard {
  doc: Target;
  /** window.visualViewport: its `scale` says how far the page is zoomed in. */
  viewport?: (Target & { readonly scale: number }) | null;
  /** The page's <meta name="viewport">. */
  meta?: { content: string } | null;
  /** Runs `fn` once the browser has applied a viewport change: two animation frames, or a stand-in in tests. */
  later?: (fn: () => void) => void;
}

/** Zoom a page may drift to without being set back (Safari reports 1.0000001 and the like). */
const SLACK = 0.01;

export function guardZoom(o: ZoomGuard): void {
  const stop = (e: Event) => { if (e.cancelable) e.preventDefault(); };
  // Safari's own pinch events (iPhone, iPad and Mac).
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) o.doc.addEventListener(type, stop, { passive: false });
  // Safari also says in a touch move how far the fingers spread or closed (`scale`, not standard):
  // anything but 1 is a pinch. The stick is unaffected: it follows pointer events, not the page's gestures.
  o.doc.addEventListener('touchmove', e => {
    const scale = (e as Event & { scale?: number }).scale;
    if (scale !== undefined && scale !== 1) stop(e);
  }, { passive: false });

  const { viewport, meta } = o;
  if (!viewport || !meta) return;
  const later = o.later ?? (fn => requestAnimationFrame(() => requestAnimationFrame(fn)));
  let resetting = false;
  // Zoomed anyway: Safari goes back to 1 when the page asks for maximum-scale=1, even for a moment.
  viewport.addEventListener('resize', () => {
    if (resetting || viewport.scale <= 1 + SLACK) return;
    resetting = true;
    const base = meta.content;
    meta.content = `${base}, maximum-scale=1`;
    later(() => {
      meta.content = base;
      resetting = false;
    });
  });
}
