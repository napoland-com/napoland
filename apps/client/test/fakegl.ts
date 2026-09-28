/**
 * A WebGL2 context that draws nothing and counts what it is asked to make, so three.js's real renderer,
 * its program cache and the real WorldView run in a test without a page. Also just enough of
 * `document` and `window` for the canvases the view draws its soft textures on.
 */
import * as THREE from 'three';

export interface GlCounts {
  /** Programs linked, and deleted, since the context was made. */
  programs: number;
  deletedPrograms: number;
}

export function fakeGL(): { gl: WebGL2RenderingContext; counts: GlCounts; canvas: HTMLCanvasElement } {
  const counts: GlCounts = { programs: 0, deletedPrograms: 0 };
  const consts = new Map<string, number>();
  let next = 0x1000;
  const k = (name: string) => {
    if (!consts.has(name)) consts.set(name, next++);
    return consts.get(name)!;
  };
  const canvas = { width: 300, height: 150, style: {}, addEventListener() {}, removeEventListener() {}, getContext: () => gl } as unknown as HTMLCanvasElement;
  const t: Record<string, unknown> = {
    canvas,
    drawingBufferWidth: 300,
    drawingBufferHeight: 150,
    getParameter(p: number) {
      if (p === k('VERSION')) return 'WebGL 2.0 (fake)';
      if (p === k('SHADING_LANGUAGE_VERSION')) return 'WebGL GLSL ES 3.00 (fake)';
      if (p === k('SCISSOR_BOX') || p === k('VIEWPORT')) return new Int32Array([0, 0, 300, 150]);
      if (p === k('MAX_SAMPLES')) return 4;
      return 16;
    },
    getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
    getExtension: () => ({}),
    getSupportedExtensions: () => [],
    getContextAttributes: () => ({ alpha: true, antialias: false, depth: true, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false }),
    isContextLost: () => false,
    createProgram: () => { counts.programs++; return {}; },
    deleteProgram: () => { counts.deletedPrograms++; },
    createShader: () => ({}),
    getProgramParameter: (_p: unknown, pname: number) => (pname === k('LINK_STATUS') ? true : 0),
    getShaderParameter: () => true,
    getProgramInfoLog: () => '',
    getShaderInfoLog: () => '',
    getShaderSource: () => '',
    getUniformLocation: () => ({}),
    getAttribLocation: () => 0,
    getUniformBlockIndex: () => 0,
    createTexture: () => ({}),
    createBuffer: () => ({}),
    createFramebuffer: () => ({}),
    createRenderbuffer: () => ({}),
    createVertexArray: () => ({}),
    checkFramebufferStatus: () => k('FRAMEBUFFER_COMPLETE'),
    getError: () => 0,
  };
  // Every other call does nothing; every constant is a number of its own.
  const gl = new Proxy(t, {
    get(target, prop) {
      if (prop in target) return target[prop as string];
      if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return k(prop);
      return () => undefined;
    },
  }) as unknown as WebGL2RenderingContext;
  return { gl, counts, canvas };
}

/** A real three.js renderer over the counting context. */
export function fakeRenderer(): { renderer: THREE.WebGLRenderer; counts: GlCounts } {
  const { gl, counts, canvas } = fakeGL();
  const renderer = new THREE.WebGLRenderer({ canvas, context: gl });
  return { renderer, counts };
}

/** Enough of `document` and `window` for the view's canvas textures and its resize. */
export function fakePage(): void {
  const ctx2d = new Proxy({}, {
    get: (_t, prop) => (prop === 'createRadialGradient' || prop === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => undefined),
    set: () => true,
  });
  const g = globalThis as Record<string, unknown>;
  g.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d, style: {} }) };
  g.window ??= { devicePixelRatio: 2 };
}
