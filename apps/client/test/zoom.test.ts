/**
 * zoom.ts: pinches are cancelled, and a zoomed page is set back. Plain EventTargets stand in for the
 * page, its visual viewport and its viewport meta tag.
 */
import { describe, expect, it } from 'vitest';
import { guardZoom } from '../src/zoom';

class FakeViewport extends EventTarget {
  scale = 1;
}

function setup() {
  const doc = new EventTarget();
  const viewport = new FakeViewport();
  const meta = { content: 'width=device-width, initial-scale=1, user-scalable=no' };
  const pending: Array<() => void> = [];
  guardZoom({ doc, viewport, meta, later: fn => pending.push(fn) });
  return { doc, viewport, meta, pending };
}

/** Dispatches a cancelable event, with Safari's `scale` if given; true when something cancelled it. */
function cancelled(target: EventTarget, type: string, scale?: number): boolean {
  const e = new Event(type, { cancelable: true });
  if (scale !== undefined) Object.defineProperty(e, 'scale', { value: scale });
  target.dispatchEvent(e);
  return e.defaultPrevented;
}

describe('guardZoom', () => {
  it("cancels Safari's pinch gestures", () => {
    const { doc } = setup();
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) expect(cancelled(doc, type), type).toBe(true);
  });

  it('cancels touch moves that pinch, and leaves the others alone', () => {
    const { doc } = setup();
    expect(cancelled(doc, 'touchmove', 1.3)).toBe(true);
    expect(cancelled(doc, 'touchmove', 0.8)).toBe(true);
    // One finger on the stick, or a browser that does not say: nothing to stop.
    expect(cancelled(doc, 'touchmove', 1)).toBe(false);
    expect(cancelled(doc, 'touchmove')).toBe(false);
  });

  it('sets a zoomed page back, once, and restores the viewport tag', () => {
    const { viewport, meta, pending } = setup();
    const base = meta.content;
    viewport.dispatchEvent(new Event('resize')); // the keyboard, say: not zoomed
    expect(meta.content).toBe(base);

    viewport.scale = 2.4;
    viewport.dispatchEvent(new Event('resize'));
    expect(meta.content).toBe(`${base}, maximum-scale=1`);
    viewport.dispatchEvent(new Event('resize')); // still settling: no second reset on top
    expect(pending).toHaveLength(1);

    viewport.scale = 1;
    pending.shift()!();
    expect(meta.content).toBe(base);
    viewport.scale = 1.5;
    viewport.dispatchEvent(new Event('resize'));
    expect(pending).toHaveLength(1);
  });

  it('ignores a scale that is 1 give or take a rounding error', () => {
    const { viewport, meta } = setup();
    const base = meta.content;
    viewport.scale = 1.004;
    viewport.dispatchEvent(new Event('resize'));
    expect(meta.content).toBe(base);
  });
});
