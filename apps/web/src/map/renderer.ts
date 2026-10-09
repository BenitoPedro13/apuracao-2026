import { select, type Selection } from "d3-selection";
import "d3-transition"; // adds selection.transition(), used for animated zooms
import { zoom, zoomIdentity, type D3ZoomEvent, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import { WIDTH, type Geometry } from "./geometry";
import { HATCHED, mixHex, parsePartyToken, STEP_MIX, type FillToken, type MapStyle } from "./style";

// The map's canvas (TASK-map.md §2.2): framework-free and imperative, owned by one React
// leaf through an effect. Two stacked canvases: the base (fills and borders, redrawn on a
// new frame or a pan/zoom) and the overlay (hover and selection outlines, redrawn alone).

export const MAX_ZOOM = 12;
const PAD = 8; // CSS px around the country at the initial fit
const ZOOM_MS = 350;
const HINT_MS = 1500;

export interface Fit {
  /** CSS px per map unit at zoom 1, and the offset that centres the country. */
  s: number;
  ox: number;
  oy: number;
  width: number;
  height: number;
}

export interface MapEvents {
  onHover(i: number | null, clientX: number, clientY: number): void;
  /** A click or tap on a municipality; `touch` when it wasn't a mouse. */
  onPick(i: number, touch: boolean): void;
  onTransform(t: ZoomTransform, fit: Fit): void;
  /** A gesture the map ignored on purpose, so the page could scroll: show how to zoom. */
  onHint(kind: "wheel" | "touch"): void;
}

interface Theme {
  fill: Map<FillToken, string>;
  /** `--party-<key>` and `--panel`, for the per-UF maps' party steps. */
  party(key: string): string;
  panel: string;
  hatch: string;
  lineMunicipal: string;
  lineUf: string;
  outline: string;
  hover: string;
  selected: string;
}

export class MapRenderer {
  private readonly base: CanvasRenderingContext2D;
  private readonly over: CanvasRenderingContext2D;
  private readonly hit = new OffscreenCanvas(1, 1).getContext("2d")!;
  private readonly paths: Path2D[];
  private readonly meshes: { municipal: Path2D; uf: Path2D; outline: Path2D };
  private readonly grid: Uint32Array[];
  private readonly gridN = 64;
  private readonly zoomer: ZoomBehavior<HTMLCanvasElement, unknown>;
  private readonly sel: Selection<HTMLCanvasElement, unknown, null, undefined>;
  private bucketPaths: [FillToken, Path2D][] = [];
  private failedPath: Path2D | null = null;
  private splits: { uf: string; token: FillToken }[] = [];
  private readonly ufPaths = new Map<string, { path: Path2D; bbox: [number, number, number, number] }>();
  private theme: Theme | null = null;
  private fit: Fit = { s: 1, ox: 0, oy: 0, width: 0, height: 0 };
  private t: ZoomTransform = zoomIdentity;
  private dpr = 1;
  private hover: number | null = null;
  private selectedUf: string | null = null;
  private frameRequested = false;
  private hintAt = 0;
  private drawn = false;
  private styleKey = "";
  /** A zoom asked for before the first resize: applied once the box has a size. */
  private pendingUf: string | null = null;

  constructor(
    private readonly baseCanvas: HTMLCanvasElement,
    private readonly overCanvas: HTMLCanvasElement,
    private readonly geo: Geometry,
    private readonly events: MapEvents,
    private reducedMotion: boolean,
  ) {
    this.base = baseCanvas.getContext("2d", { alpha: true })!;
    this.over = overCanvas.getContext("2d")!;
    this.paths = geo.rings.map((rings) => {
      const p = new Path2D();
      for (const r of rings) addRing(p, r, true);
      return p;
    });
    const lines = (ls: Float32Array[]) => {
      const p = new Path2D();
      for (const l of ls) addRing(p, l, false);
      return p;
    };
    this.meshes = { municipal: lines(geo.meshes.municipal), uf: lines(geo.meshes.uf), outline: lines(geo.meshes.outline) };
    this.grid = buildGrid(geo, this.gridN);

    this.sel = select(baseCanvas);
    this.zoomer = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([1, MAX_ZOOM])
      .filter((event: Event) => this.accepts(event))
      .on("zoom", (e: D3ZoomEvent<HTMLCanvasElement, unknown>) => {
        this.t = e.transform;
        this.updateTouchAction();
        this.events.onTransform(this.t, this.fit);
        this.requestDraw();
      });
    this.sel.call(this.zoomer).on("dblclick.zoom", null);
    this.sel.on("dblclick.map", (e: MouseEvent) => this.zoomAt(2, e));
    this.updateTouchAction();

    baseCanvas.addEventListener("pointermove", this.onPointerMove);
    baseCanvas.addEventListener("pointerleave", this.onPointerLeave);
    baseCanvas.addEventListener("click", this.onClick);
  }

  destroy() {
    this.sel.on(".zoom", null).on(".map", null);
    this.baseCanvas.removeEventListener("pointermove", this.onPointerMove);
    this.baseCanvas.removeEventListener("pointerleave", this.onPointerLeave);
    this.baseCanvas.removeEventListener("click", this.onClick);
  }

  /** Reads the palette from the canvas's computed CSS variables (call on theme change). */
  setTheme() {
    const cs = getComputedStyle(this.baseCanvas);
    const v = (name: string) => cs.getPropertyValue(`--map-${name}`).trim() || "#888";
    const fill = new Map<FillToken, string>();
    for (const p of ["pt", "pl", "other"] as const) for (const s of [1, 2, 3, 4] as const) fill.set(`${p}-${s}`, v(`${p}-${s}`));
    for (const s of [1, 2, 3, 4, 5] as const) fill.set(`counted-${s}`, v(`counted-${s}`));
    for (const t of ["tie", "empty", "waiting"] as const) fill.set(t, v(t));
    // Named in full so the CSS build keeps the property (it drops names it never sees).
    fill.set("none", cs.getPropertyValue("--map-none").trim() || "#888");
    const party = new Map<string, string>();
    this.theme = {
      fill,
      party: (key) => {
        let c = party.get(key);
        if (!c) {
          c = cs.getPropertyValue(`--party-${key}`).trim() || cs.getPropertyValue("--party-other").trim() || "#888888";
          party.set(key, c);
        }
        return c;
      },
      panel: cs.getPropertyValue("--panel").trim() || "#ffffff",
      hatch: v("hatch"),
      lineMunicipal: v("line-municipal"),
      lineUf: v("line-uf"),
      outline: v("outline"),
      hover: v("hover"),
      selected: v("selected"),
    };
    this.requestDraw();
  }

  /** A new frame or mode: one combined path per colour. A repeated `key` is a no-op. */
  setStyle(style: MapStyle, key: string) {
    if (key === this.styleKey) return;
    this.styleKey = key;
    performance.mark("map:style-start");
    this.bucketPaths = [...style.buckets].map(([token, members]) => {
      const p = new Path2D();
      for (const i of members) p.addPath(this.paths[i]!);
      return [token, p] as [FillToken, Path2D];
    });
    this.failedPath = style.failed.length ? new Path2D() : null;
    for (const i of style.failed) this.failedPath!.addPath(this.paths[i]!);
    this.splits = style.splits ?? [];
    this.draw();
    performance.measure(this.drawn ? "map:recolour" : "map:first-draw", "map:style-start");
    this.drawn = true;
  }

  private outline = true;

  /** Whether the selected UF gets its outline (not when its municipalities are drawn). */
  setOutline(on: boolean) {
    if (on === this.outline) return;
    this.outline = on;
    this.drawOverlay();
  }

  setSelectedUf(uf: string | null) {
    this.selectedUf = uf;
    this.drawOverlay();
  }

  setReducedMotion(reduced: boolean) {
    this.reducedMotion = reduced;
  }

  /**
   * Fit the country into the canvas's CSS box (call from a ResizeObserver), leaving
   * `gutter` CSS px on the right for the small states' call-outs.
   */
  resize(width: number, height: number, gutter = 0) {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of [this.baseCanvas, this.overCanvas]) {
      c.width = Math.round(width * this.dpr);
      c.height = Math.round(height * this.dpr);
    }
    const s = Math.max(0.01, Math.min((width - gutter - 2 * PAD) / WIDTH, (height - 2 * PAD) / this.geo.height));
    this.fit = { s, ox: (width - gutter - WIDTH * s) / 2, oy: (height - this.geo.height * s) / 2, width, height };
    this.zoomer.extent([[0, 0], [width, height]]).translateExtent([[0, 0], [width, height]]);
    this.events.onTransform(this.t, this.fit);
    this.draw();
    if (this.pendingUf && width > 0) {
      const uf = this.pendingUf;
      this.pendingUf = null;
      this.zoomToUf(uf);
    }
  }

  zoomBy(factor: number) {
    this.transition().call(this.zoomer.scaleBy, factor);
  }

  panBy(dx: number, dy: number) {
    this.transition().call(this.zoomer.translateBy, dx / this.t.k, dy / this.t.k);
  }

  reset() {
    this.transition().call(this.zoomer.transform, zoomIdentity);
  }

  /** Zoom so a UF fills ~85% of the box. */
  zoomToUf(uf: string) {
    if (this.fit.width <= 0 || this.fit.height <= 0) {
      this.pendingUf = uf;
      return;
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    this.geo.ufs.forEach((u, i) => {
      if (u !== uf) return;
      const b = this.geo.bbox;
      x0 = Math.min(x0, b[i * 4]!);
      y0 = Math.min(y0, b[i * 4 + 1]!);
      x1 = Math.max(x1, b[i * 4 + 2]!);
      y1 = Math.max(y1, b[i * 4 + 3]!);
    });
    if (!Number.isFinite(x0)) return;
    const { s, ox, oy, width, height } = this.fit;
    const [cx0, cy0, cx1, cy1] = [ox + x0 * s, oy + y0 * s, ox + x1 * s, oy + y1 * s];
    const k = Math.max(1, Math.min(MAX_ZOOM, 0.85 / Math.max((cx1 - cx0) / width, (cy1 - cy0) / height)));
    const t = zoomIdentity.translate(width / 2, height / 2).scale(k).translate(-(cx0 + cx1) / 2, -(cy0 + cy1) / 2);
    this.transition().call(this.zoomer.transform, t);
  }

  get transform() {
    return this.t;
  }

  // --- drawing -----------------------------------------------------------------------

  private requestDraw() {
    if (this.frameRequested) return;
    this.frameRequested = true;
    requestAnimationFrame(() => {
      this.frameRequested = false;
      performance.mark("map:frame-start");
      this.draw();
      performance.measure("map:frame", "map:frame-start");
    });
  }

  private applyTransform(ctx: CanvasRenderingContext2D) {
    const { s, ox, oy } = this.fit;
    const k = this.t.k * s * this.dpr;
    ctx.setTransform(k, 0, 0, k, this.dpr * (this.t.x + this.t.k * ox), this.dpr * (this.t.y + this.t.k * oy));
    return k;
  }

  private draw() {
    const ctx = this.base;
    const theme = this.theme;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.baseCanvas.width, this.baseCanvas.height);
    if (!theme) return;
    const k = this.applyTransform(ctx);
    const px = this.dpr / k; // one CSS px in map units

    const hatch = this.hatchPattern(ctx, theme.hatch);
    for (const [token, path] of this.bucketPaths) {
      ctx.fillStyle = this.colour(theme, token);
      ctx.fill(path);
      if (HATCHED.has(token) && hatch) {
        ctx.fillStyle = hatch;
        ctx.fill(path);
      }
    }
    // A UF in two colours: the second over the lower-right half of its box, clipped to it.
    for (const { uf, token } of this.splits) {
      const u = this.ufPath(uf);
      if (!u) continue;
      const [x0, y0, x1, y1] = u.bbox;
      ctx.save();
      ctx.clip(u.path);
      ctx.beginPath();
      ctx.moveTo(x1, y0);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x0, y1);
      ctx.closePath();
      ctx.fillStyle = this.colour(theme, token);
      ctx.fill();
      ctx.restore();
    }
    if (this.failedPath && hatch) {
      ctx.fillStyle = hatch;
      ctx.fill(this.failedPath);
    }

    ctx.lineJoin = "round";
    // Municipal borders fade in as you zoom: at the national fit they're a texture.
    ctx.globalAlpha = Math.min(1, 0.45 + 0.15 * this.t.k);
    ctx.strokeStyle = theme.lineMunicipal;
    ctx.lineWidth = 0.5 * px;
    ctx.stroke(this.meshes.municipal);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = theme.lineUf;
    ctx.lineWidth = 1.1 * px;
    ctx.stroke(this.meshes.uf);
    ctx.strokeStyle = theme.outline;
    ctx.lineWidth = 1 * px;
    ctx.stroke(this.meshes.outline);
    this.drawOverlay();
  }

  private colour(theme: Theme, token: FillToken): string {
    const known = theme.fill.get(token);
    if (known) return known;
    const p = parsePartyToken(token);
    if (!p) return "#888";
    // The stylesheet is minified ("#fff"): let the canvas normalize both to #rrggbb first.
    const c = mixHex(this.hex(theme.party(p.key)), this.hex(theme.panel), STEP_MIX[p.step]);
    theme.fill.set(token, c);
    return c;
  }

  private hex(colour: string): string {
    this.hit.fillStyle = "#000000";
    this.hit.fillStyle = colour;
    return String(this.hit.fillStyle);
  }

  /** A UF's outline as one path, and its box, built on first use. */
  private ufPath(uf: string) {
    let u = this.ufPaths.get(uf);
    if (!u) {
      const path = new Path2D();
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const b = this.geo.bbox;
      this.geo.ufs.forEach((v, i) => {
        if (v !== uf) return;
        path.addPath(this.paths[i]!);
        x0 = Math.min(x0, b[i * 4]!);
        y0 = Math.min(y0, b[i * 4 + 1]!);
        x1 = Math.max(x1, b[i * 4 + 2]!);
        y1 = Math.max(y1, b[i * 4 + 3]!);
      });
      if (!Number.isFinite(x0)) return null;
      u = { path, bbox: [x0, y0, x1, y1] };
      this.ufPaths.set(uf, u);
    }
    return u;
  }

  private drawOverlay() {
    const ctx = this.over;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.overCanvas.width, this.overCanvas.height);
    if (!this.theme) return;
    const k = this.applyTransform(ctx);
    const px = this.dpr / k;
    ctx.lineJoin = "round";
    if (this.selectedUf && this.outline) {
      ctx.strokeStyle = this.theme.selected;
      ctx.lineWidth = 2 * px;
      this.geo.ufs.forEach((u, i) => {
        if (u === this.selectedUf) ctx.stroke(this.paths[i]!);
      });
    }
    if (this.hover !== null) {
      ctx.strokeStyle = this.theme.hover;
      ctx.lineWidth = 2.5 * px;
      ctx.stroke(this.paths[this.hover]!);
    }
  }

  private hatchCache: { color: string; pattern: CanvasPattern } | null = null;

  /** Diagonal hatch in device pixels, whatever the zoom. */
  private hatchPattern(ctx: CanvasRenderingContext2D, color: string): CanvasPattern | null {
    if (this.hatchCache?.color !== color) {
      const n = 6;
      const tile = new OffscreenCanvas(n, n);
      const t = tile.getContext("2d")!;
      t.strokeStyle = color;
      t.lineWidth = 1.25;
      t.beginPath();
      t.moveTo(-1, n + 1);
      t.lineTo(n + 1, -1);
      t.moveTo(-1, 1);
      t.lineTo(1, -1);
      t.moveTo(n - 1, n + 1);
      t.lineTo(n + 1, n - 1);
      t.stroke();
      const pattern = ctx.createPattern(tile, "repeat");
      if (!pattern) return null;
      this.hatchCache = { color, pattern };
    }
    // Undo the map transform so one tile pixel is one device pixel at any zoom.
    this.hatchCache.pattern.setTransform(ctx.getTransform().inverse());
    return this.hatchCache.pattern;
  }

  // --- input ---------------------------------------------------------------------------

  /** Which gestures the map takes (TASK-map.md §2.4): never the page's own scrolling. */
  private accepts(event: Event): boolean {
    if (event.type === "wheel") {
      const w = event as WheelEvent;
      if (w.ctrlKey || w.metaKey) return true;
      this.hint("wheel");
      return false;
    }
    if (event.type.startsWith("touch")) {
      // At the initial fit one finger scrolls the page and a tap picks; once zoomed in,
      // drag and pinch move the map ("Brasil" resets).
      if (this.t.k > 1.001) return true;
      if ((event as TouchEvent).touches.length > 1) this.hint("touch");
      return false;
    }
    const m = event as MouseEvent;
    return !m.button && !m.ctrlKey;
  }

  private updateTouchAction() {
    this.baseCanvas.style.touchAction = this.t.k > 1.001 ? "none" : "pan-x pan-y";
  }

  private hint(kind: "wheel" | "touch") {
    const now = performance.now();
    if (now - this.hintAt < HINT_MS / 3) return;
    this.hintAt = now;
    this.events.onHint(kind);
  }

  private transition() {
    return this.sel.transition().duration(this.reducedMotion ? 0 : ZOOM_MS);
  }

  private zoomAt(factor: number, e: MouseEvent) {
    const rect = this.baseCanvas.getBoundingClientRect();
    this.transition().call(this.zoomer.scaleBy, factor, [e.clientX - rect.left, e.clientY - rect.top]);
  }

  /** The municipality under a client point, or null. */
  pick(clientX: number, clientY: number): number | null {
    const rect = this.baseCanvas.getBoundingClientRect();
    const { s, ox, oy } = this.fit;
    const [cx, cy] = this.t.invert([clientX - rect.left, clientY - rect.top]);
    const mx = (cx - ox) / s;
    const my = (cy - oy) / s;
    const gx = Math.floor((mx / WIDTH) * this.gridN);
    const gy = Math.floor((my / this.geo.height) * this.gridN);
    if (gx < 0 || gy < 0 || gx >= this.gridN || gy >= this.gridN) return null;
    for (const i of this.grid[gy * this.gridN + gx]!) {
      const b = this.geo.bbox;
      if (mx < b[i * 4]! || mx > b[i * 4 + 2]! || my < b[i * 4 + 1]! || my > b[i * 4 + 3]!) continue;
      if (this.hit.isPointInPath(this.paths[i]!, mx, my, "evenodd")) return i;
    }
    return null;
  }

  private onPointerMove = (e: PointerEvent) => {
    if (e.pointerType !== "mouse" || e.buttons) return;
    const i = this.pick(e.clientX, e.clientY);
    if (i !== this.hover) {
      this.hover = i;
      this.drawOverlay();
    }
    this.events.onHover(i, e.clientX, e.clientY);
  };

  private onPointerLeave = () => {
    if (this.hover === null) return;
    this.hover = null;
    this.drawOverlay();
    this.events.onHover(null, 0, 0);
  };

  private onClick = (e: MouseEvent) => {
    const i = this.pick(e.clientX, e.clientY);
    if (i === null) return;
    this.hover = i;
    this.drawOverlay();
    this.events.onHover(i, e.clientX, e.clientY);
    this.events.onPick(i, (e as PointerEvent).pointerType !== "mouse");
  };
}

function addRing(p: Path2D, r: Float32Array, close: boolean) {
  if (r.length < 4) return;
  p.moveTo(r[0]!, r[1]!);
  for (let j = 2; j < r.length; j += 2) p.lineTo(r[j]!, r[j + 1]!);
  if (close) p.closePath();
}

/** For each of n × n cells over the map, the municipalities whose bbox touches it. */
function buildGrid(geo: Geometry, n: number): Uint32Array[] {
  const cells: number[][] = Array.from({ length: n * n }, () => []);
  const cx = (x: number) => Math.max(0, Math.min(n - 1, Math.floor((x / WIDTH) * n)));
  const cy = (y: number) => Math.max(0, Math.min(n - 1, Math.floor((y / geo.height) * n)));
  for (let i = 0; i < geo.count; i++) {
    const b = geo.bbox;
    for (let y = cy(b[i * 4 + 1]!); y <= cy(b[i * 4 + 3]!); y++)
      for (let x = cx(b[i * 4]!); x <= cx(b[i * 4 + 2]!); x++) cells[y * n + x]!.push(i);
  }
  return cells.map((c) => Uint32Array.from(c));
}
