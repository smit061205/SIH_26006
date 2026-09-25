import { Canvas, createPortal, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { ViewComposer } from "./post";
import { type Footprint, type Quality, type StageState, StageContext, TIER, autoStartTier, stepTier, useQualitySetting } from "./quality";
import { type SlotEntry, type SlotOptions, useSlots } from "./slots";

/**
 * One WebGL canvas for every 3D view on the page.
 *
 * Each view ("slot") is a DOM box. Its scene lives in an R3F portal with its
 * own camera, controls and post-processing, and renders into its own
 * off-screen image. A fixed, transparent canvas over the page (below the
 * sticky header and overlays, and letting pointer events through) then
 * copies each visible view's latest image into its box.
 *
 * Nothing renders unless it needs to (the frame governor):
 * - a view that is moving (drag, zoom, camera ease, draft change) draws at the
 *   display's rate;
 * - an animated view (waves, clouds, ship motion) otherwise draws at 30 fps
 *   (24 on low quality);
 * - a still view draws once and is then only copied;
 * - views off screen, and every view while the tab is hidden, don't draw;
 * - scrolling only re-copies images, in the same frame the page moves.
 */

interface Runtime {
  el: HTMLElement;
  opts: SlotOptions;
  rect: DOMRect | null;
  visible: boolean;
  /** When this view last rendered (ms), and until when it counts as moving. */
  last: number;
  busyUntil: number;
  /** Something changed that a still view must redraw for. */
  dirty: boolean;
  renders: number;
  ready: boolean;
  render: ((delta: number, busy: boolean) => THREE.Texture | null) | null;
  image: THREE.Texture | null;
  transparent: boolean;
  /** The view's scene (for inspection in development). */
  scene?: THREE.Scene;
}

const runtimes = new Map<string, Runtime>();

/** Rolling counters for the developer tools' performance readout. */
export interface CanvasStats {
  /** Canvas frames (composites) and view renders in the last second. */
  frames: number;
  renders: number;
  /** Draw calls and triangles in the last frame that rendered a view. */
  calls: number;
  triangles: number;
  /** CPU time of the last composite, ms. */
  cpuMs: number;
  quality: Quality | null;
}
export const canvasStats: CanvasStats = { frames: 0, renders: 0, calls: 0, triangles: 0, cpuMs: 0, quality: null };
const counter = { frames: 0, renders: 0, since: 0 };
/** A view went away (page change, unmount): the canvas must redraw once to clear its old image. */
const pending = { clear: false };

function removeRuntime(id: string) {
  runtimes.delete(id);
  pending.clear = true;
}
// For inspecting the governor from the browser console in development.
if (import.meta.env.DEV) (window as unknown as { __fwViews: Map<string, Runtime> }).__fwViews = runtimes;

// The runtimes and three.js objects are mutable by design; the writes live outside the components.
function patch<T extends object>(target: T, values: Partial<T>) {
  Object.assign(target, values);
}
function addTo<T>(set: Set<T>, v: T) {
  set.add(v);
}
function removeFrom<T>(set: Set<T>, v: T) {
  set.delete(v);
}

/** Development only: keep drawing in a hidden tab (automated screenshots of a background pane). */
function devRenderHidden() {
  return import.meta.env.DEV && !!(window as unknown as { __fwRenderHidden?: boolean }).__fwRenderHidden;
}

function isBusy(rt: Runtime, now: number) {
  return now < rt.busyUntil;
}

function isDue(rt: Runtime, now: number, idleFps: number) {
  if (!rt.render) return false;
  if (rt.dirty || rt.renders < 3) return true;
  if (isBusy(rt, now)) return now - rt.last >= 14;
  return rt.opts.animated && now - rt.last >= 1000 / idleFps - 3;
}

/** The bottom edge of the sticky header: views are clipped there so they slide under it. */
function clipTop() {
  const header = document.querySelector("[data-sticky-header]");
  return header ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
}

const BLIT_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const BLIT_FRAG = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(map, vUv);
  #include <colorspace_fragment>
}`;

/** Copies each visible view's image into its box, after rendering the views that are due. */
function Compositor({ quality }: { quality: Quality }) {
  const { scene, camera, material, opaque, transparent } = useMemo(() => {
    const opaqueMat = new THREE.ShaderMaterial({ vertexShader: BLIT_VERT, fragmentShader: BLIT_FRAG, uniforms: { map: { value: null } }, depthTest: false, depthWrite: false });
    const transparentMat = new THREE.ShaderMaterial({ vertexShader: BLIT_VERT, fragmentShader: BLIT_FRAG, uniforms: { map: { value: null } }, depthTest: false, depthWrite: false, transparent: true });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), opaqueMat);
    quad.frustumCulled = false;
    const s = new THREE.Scene();
    s.add(quad);
    return { scene: s, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), material: quad, opaque: opaqueMat, transparent: transparentMat };
  }, []);
  const clock = useRef({ last: 0 });
  useFrame(({ gl }) => composite(gl, clock.current, TIER[quality].idleFps, { scene, camera, quad: material, opaque, transparent }), 1);
  return null;
}

/** Renders the views that are due into their images, then copies every visible view's image into its box. */
function composite(
  gl: THREE.WebGLRenderer,
  clock: { last: number },
  idleFps: number,
  blit: { scene: THREE.Scene; camera: THREE.Camera; quad: THREE.Mesh; opaque: THREE.ShaderMaterial; transparent: THREE.ShaderMaterial }
) {
  const now = performance.now();
  const delta = clock.last ? Math.min(0.1, (now - clock.last) / 1000) : 1 / 60;
  clock.last = now;
  gl.info.autoReset = false;
  gl.info.reset();
  let rendered = 0;
  for (const rt of runtimes.values()) {
    if (!rt.visible || !isDue(rt, now, idleFps)) continue;
    rendered += 1;
    const busy = isBusy(rt, now);
    rt.image = rt.render!(delta, busy) ?? rt.image;
    rt.last = now;
    rt.dirty = false;
    rt.renders += 1;
    if (rt.renders === 3 && !rt.ready) {
      rt.ready = true;
      rt.opts.onReady?.();
    }
  }
  const width = gl.domElement.clientWidth;
  const height = gl.domElement.clientHeight;
  gl.setRenderTarget(null);
  gl.setScissorTest(false);
  gl.setViewport(0, 0, width, height);
  gl.setClearColor(0x000000, 0);
  gl.clear(true, true, false);
  const top = clipTop();
  for (const rt of runtimes.values()) {
    const r = rt.rect;
    if (!rt.visible || !rt.image || !rt.ready || !r) continue;
    const y = height - r.bottom;
    const visibleTop = Math.max(r.top, top);
    const scissorHeight = Math.min(r.bottom, height) - visibleTop;
    if (scissorHeight <= 0) continue;
    gl.setViewport(r.left, y, r.width, r.height);
    gl.setScissor(r.left, Math.max(0, y), r.width, scissorHeight);
    gl.setScissorTest(true);
    const mat = rt.transparent ? blit.transparent : blit.opaque;
    mat.uniforms.map.value = rt.image;
    blit.quad.material = mat;
    gl.render(blit.scene, blit.camera);
  }
  gl.setScissorTest(false);
  countFrame(gl, now, rendered);
}

function countFrame(gl: THREE.WebGLRenderer, start: number, rendered: number) {
  counter.frames += 1;
  counter.renders += rendered;
  if (rendered) {
    canvasStats.calls = gl.info.render.calls;
    canvasStats.triangles = gl.info.render.triangles;
  }
  canvasStats.cpuMs = performance.now() - start;
  if (start - counter.since >= 1000) {
    canvasStats.frames = counter.frames;
    canvasStats.renders = counter.renders;
    counter.frames = 0;
    counter.renders = 0;
    counter.since = start;
  }
}

/**
 * Drives the canvas: each display frame, reads where the views are, decides
 * whether anything needs drawing, and renders in that same frame. It also
 * watches for dropped frames to pick the quality in "auto".
 */
function Driver({ onQuality, idleFps }: { onQuality: (step: 1 | -1) => void; idleFps: number }) {

  const advance = useThree((s) => s.advance);
  const quality = useRef<(step: 1 | -1) => void>(onQuality);
  const fps = useRef(idleFps);
  useEffect(() => {
    quality.current = onQuality;
    fps.current = idleFps;
  });
  useEffect(() => {
    let raf = 0;
    let prev = performance.now();
    let slow = 0;
    let smooth = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = now - prev;
      prev = now;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let need = false;
      let animating = false;
      for (const rt of runtimes.values()) {
        const r = rt.el.getBoundingClientRect();
        const visible = (!document.hidden || devRenderHidden()) && r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
        const moved = !rt.rect || r.top !== rt.rect.top || r.left !== rt.rect.left || r.width !== rt.rect.width || r.height !== rt.rect.height;
        rt.rect = r;
        if (visible !== rt.visible) {
          rt.visible = visible;
          need = true;
        }
        if (!visible) continue;
        if (moved) need = true;
        if (rt.opts.animated || isBusy(rt, now)) animating = true;
        if (isDue(rt, now, fps.current)) need = true;
      }
      if (pending.clear) {
        pending.clear = false;
        need = true;
      }
      if (need) advance(now / 1000);
      // Quality: sustained frames over ~24 ms while animating means the device is struggling.
      if (animating && dt < 250) {
        if (dt > 24) {
          slow += 1;
          smooth = 0;
        } else {
          smooth += 1;
          slow = Math.max(0, slow - 0.25);
        }
        if (slow > 45) {
          slow = 0;
          quality.current(-1);
        } else if (smooth > 60 * 8) {
          smooth = 0;
          quality.current(1);
        }
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [advance]);
  return null;
}

/** One view: its own scene and camera in a portal, its render function, and its stage context. */
function Slot({ entry, quality }: { entry: SlotEntry; quality: Quality }) {
  const [scene] = useState(() => new THREE.Scene());
  const [camera] = useState(() => {
    const c = new THREE.PerspectiveCamera(30, 1, 0.5, 20000);
    c.position.set(-150, 70, 260);
    return c;
  });
  const [size, setSize] = useState(() => {
    const r = entry.el.getBoundingClientRect();
    return { width: Math.max(1, r.width), height: Math.max(1, r.height), top: 0, left: 0 };
  });
  useEffect(() => {
    const el = entry.el;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize((s) => (Math.abs(s.width - r.width) < 0.5 && Math.abs(s.height - r.height) < 0.5 ? s : { width: Math.max(1, r.width), height: Math.max(1, r.height), top: 0, left: 0 }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [entry.el]);
  // Pointer events reach the 3D objects of the view under the pointer only.
  const compute = useCallback(
    (event: { clientX: number; clientY: number; target: EventTarget | null }, state: { pointer: THREE.Vector2; raycaster: THREE.Raycaster; camera: THREE.Camera }) => {
      const r = entry.el.getBoundingClientRect();
      const inside = event.target instanceof Node && entry.el.contains(event.target);
      if (!inside) state.pointer.set(2, 2);
      else state.pointer.set(((event.clientX - r.left) / r.width) * 2 - 1, -((event.clientY - r.top) / r.height) * 2 + 1);
      state.raycaster.setFromCamera(state.pointer, state.camera);
    },
    [entry.el]
  );
  return createPortal(<SlotInner entry={entry} quality={quality} scene={scene} camera={camera} />, scene, {
    camera,
    size,
    events: { compute: compute as never, priority: 1 },
  });
}

function SlotInner({ entry, quality, scene, camera }: { entry: SlotEntry; quality: Quality; scene: THREE.Scene; camera: THREE.PerspectiveCamera }) {
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const rt = useMemo<Runtime>(() => {
    const existing = runtimes.get(entry.id);
    if (existing) return existing;
    const created: Runtime = { el: entry.el, opts: entry.opts, rect: null, visible: false, last: 0, busyUntil: 0, dirty: true, renders: 0, ready: false, render: null, image: null, transparent: !entry.opts.post };
    runtimes.set(entry.id, created);
    return created;
  }, [entry.id, entry.el, entry.opts]);
  // Every change to the view's content (new props, loaded textures) redraws it.
  useEffect(() => patch(rt, { el: entry.el, opts: entry.opts, dirty: true }));
  useEffect(() => () => removeRuntime(entry.id), [entry.id]);

  const [night, setNight] = useState(0);
  const exposure = useRef(1);
  const footprints = useMemo(() => new Map<number, Footprint>(), []);
  const preRenders = useMemo(() => new Set<(busy: boolean) => void>(), []);
  // Stable functions, so effects that depend on them don't re-run when quality or light changes.
  const kick = useCallback(
    (ms = 250) => {
      patch(rt, { busyUntil: Math.max(rt.busyUntil, performance.now() + ms) });
    },
    [rt]
  );
  const setExposure = useCallback(
    (v: number) => {
      exposure.current = v;
      patch(rt, { dirty: true });
    },
    [rt]
  );
  const onPreRender = useCallback(
    (fn: (busy: boolean) => void) => {
      addTo(preRenders, fn);
      return () => removeFrom(preRenders, fn);
    },
    [preRenders]
  );
  const stage = useMemo<StageState>(
    () => ({ quality, night, setNight, footprints, kick, setExposure, onPreRender, el: entry.el }),
    [quality, night, footprints, kick, setExposure, onPreRender, entry.el]
  );

  // The view's pipeline: post-processing into its own buffers, or a plain
  // (antialiased, transparent) render target for the globe.
  const pipeline = useMemo(() => {
    if (entry.opts.post) return { composer: new ViewComposer(gl, scene, camera, quality), target: null };
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    return { composer: null, target };
  }, [gl, scene, camera, quality, entry.opts.post]);
  useEffect(
    () => () => {
      pipeline.composer?.dispose();
      pipeline.target?.dispose();
    },
    [pipeline]
  );

  useLayoutEffect(() => {
    const render = (delta: number, busy: boolean) => {
      const pr = gl.getPixelRatio();
      // The box as measured this frame, so a resize never draws one frame's image into another's box.
      const bw = Math.max(1, rt.rect?.width || size.width);
      const bh = Math.max(1, rt.rect?.height || size.height);
      const w = Math.max(1, Math.round(bw * pr));
      const h = Math.max(1, Math.round(bh * pr));
      const aspect = bw / bh;
      if (Math.abs(camera.aspect - aspect) > 1e-4) {
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
      }
      preRenders.forEach((fn) => fn(busy));
      gl.toneMappingExposure = exposure.current;
      if (pipeline.composer) {
        pipeline.composer.setSize(w, h);
        pipeline.composer.setUnderwater(camera.position.y < -0.5);
        return pipeline.composer.render(delta);
      }
      const target = pipeline.target!;
      if (target.width !== w || target.height !== h) target.setSize(w, h);
      gl.setRenderTarget(target);
      gl.setClearColor(0x000000, 0);
      gl.clear();
      gl.render(scene, camera);
      gl.setRenderTarget(null);
      return target.texture;
    };
    patch(rt, { render, dirty: true, transparent: !entry.opts.post, scene });
    return () => patch(rt, { render: null });
  }, [rt, gl, scene, camera, size.width, size.height, pipeline, preRenders, entry.opts.post]);

  return (
    <StageContext.Provider value={stage}>
      <Suspense fallback={null}>{entry.children}</Suspense>
    </StageContext.Provider>
  );
}

export default function SharedCanvas() {
  const slots = useSlots();

  const setting = useQualitySetting();
  const [auto, setAuto] = useState<Quality>(() => autoStartTier());
  const ceiling: Quality = "high";
  const quality: Quality = setting === "auto" ? auto : setting;
  useEffect(() => patch(canvasStats, { quality }), [quality]);
  const onQuality = useCallback(
    (step: 1 | -1) => {
      if (setting === "auto") setAuto((q) => stepTier(q, step, ceiling));
    },
    [setting, ceiling]
  );
  const dpr = Math.min(TIER[quality].dpr, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);
  const [root] = useState(() => document.getElementById("root") ?? undefined);
  return (
    <Canvas
      className="print:hidden"
      style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", pointerEvents: "none", zIndex: 20 }}
      eventSource={root}
      eventPrefix="client"
      frameloop="never"
      dpr={dpr}
      shadows="soft"
      gl={{ alpha: true, antialias: false, powerPreference: "high-performance", stencil: false, premultipliedAlpha: true }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.NoToneMapping;
      }}
    >
      <Driver onQuality={onQuality} idleFps={TIER[quality].idleFps} />
      <Compositor quality={quality} />
      {slots.map((s) => (
        <Slot key={s.id} entry={s} quality={quality} />
      ))}
    </Canvas>
  );
}
