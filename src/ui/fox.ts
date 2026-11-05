// The fox tutor (user's character sheet jenga_tutor.png → tools/build_tutor.py: four poses cut out, upscaled 4x,
// placed on one frame: public/fox/<pose>.webp + fox.json). Game poses map onto them (fox.json `map`): idle / talk /
// point → teach (star wand), say → read (glasses), happy → jump, cheer → great; a short cross-fade between poses.
//
// Motion (user: "캐릭터 기존에 있던거처럼 자연스러운 모션을 줘. 위아래 점프하는거 말고"): each still pose is drawn
// through a mesh (WebGL) that a few soft "bones" bend, like a 2D puppet: the ears flick, the tail wags, the head tilts
// and nods (more while talking, with the mouth), the arms move a little (a gentle wave in the happy poses), the body
// breathes and sways from the feet. Nothing hops. Arms, ears and tail move by PAINTED weights (tools/build_tutor_rig.py
// cuts each part out of the picture): the cheek next to a moving hand stays put (user: "인트로에 손움직일때 볼까지 따라
// 움직이면서 늘어나는 오류가 있어"), the bag doesn't wag with the tail and the whole ear turns about its root (user:
// "가방같은게 같이 찌그러졌다가 펴졌다가 꼬리랑 같이 움직이고 왼쪽 귀 끝은 고정인지 넓이만 넓어졌다줄었다"); the tail bends
// like a whip (its tip half follows a beat later). Blinks are drawn eyelids (fox.json rig.lids) — squashing the
// picture smeared the iris.
//
// Lip sync (user: "tts와 튜터 말하는 입모양이 안맞는데"): the mouth is DRAWN. Every voice clip has its mouth shapes
// in time (src/data/mouth.json, Rhubarb Lip Sync on the clip + its words: tools/build_mouth_cues.py); while a clip
// plays, the shape at the clip's current time (audio.voiceNow) is drawn over the pose's painted-out muzzle
// (public/fox/muzzle.webp). Mouth and eyelids are drawn into a small overlay that goes through the same mesh, so they
// move with the head.
import mouthCues from '../data/mouth.json';
import { audioCtx, voiceNow } from '../core/audio';

export type Pose = 'idle' | 'talk' | 'point' | 'happy' | 'say' | 'cheer';
/** Rhubarb shapes: A closed (m b p) · B a little open, teeth (most consonants) · C open (e, a) · D wide (ah) ·
 *  E rounded (o, er) · F puckered (oo, w) · G f/v (teeth on the lip) · H l (tongue up) · X rest */
export type Shape = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'X';
type Pt = [number, number];
type RGB = [number, number, number];

/** an eye's outline (frame px, degrees) and the colours around it: the eyelids of a blink are drawn over it */
interface Lid { x: number; y: number; rx: number; ry: number; rot: number; top: RGB; low: RGB; lash: RGB }
interface Rig {
  head: [number, number, number]; neck: Pt; earL: [Pt, Pt]; earR: [Pt, Pt]; tail: [Pt, Pt]; armL?: [Pt, Pt]; armR?: [Pt, Pt];
  eyeR: number; lids?: Lid[];
  /** painted weights (R left arm, G right arm, B tail) at `wscale` of the pose image */
  wmap?: string; wscale?: number;
  /** painted ear weights (R left ear, G right ear), same scale */
  emap?: string;
  /** where a raised arm lies against the tail (t along root → tip): the tail moves only beyond it */
  tailFree?: number;
}
interface PoseMeta {
  file: string; x: number; y: number; w: number; h: number; rest: 'art' | Shape; rig: Rig; eyes: [Pt, Pt];
  mouth: { x: number; y: number; w: number; rot: number; turn: number };
  muzzle: { sx: number; sy: number; sw: number; sh: number; x: number; y: number };
}
interface FoxMeta { frameW: number; frameH: number; anchor: { x: number; y: number }; map: Record<Pose, string>; poses: Record<string, PoseMeta> }

const CUES = mouthCues as unknown as Record<string, [number, string][]>;
const FADE_MS = 180;
// no cues for a clip: voice loudness (audio.voiceLevel RMS) → a shape
const HALF_AT = 0.04, OPEN_AT = 0.125;
const TAU = Math.PI * 2;

/** a mouth: width (× the pose's mouth width), opening (× width), roundness 0-1, tongue 0-1 (and raised), upper teeth */
interface MouthP { k: number; open: number; round: number; tongue: number; up: number; teeth: number }
const SHAPES: Record<Shape, MouthP> = {
  X: { k: 0.72, open: 0, round: 0, tongue: 0, up: 0, teeth: 0 },
  A: { k: 0.6, open: 0, round: 0, tongue: 0, up: 0, teeth: 0 },
  B: { k: 0.78, open: 0.2, round: 0.1, tongue: 0, up: 0, teeth: 1 },
  C: { k: 0.86, open: 0.42, round: 0.2, tongue: 0.8, up: 0, teeth: 0.4 },
  D: { k: 1, open: 0.64, round: 0.15, tongue: 1, up: 0, teeth: 0.5 },
  E: { k: 0.68, open: 0.46, round: 0.7, tongue: 0.6, up: 0, teeth: 0 },
  F: { k: 0.44, open: 0.36, round: 1, tongue: 0.3, up: 0, teeth: 0 },
  G: { k: 0.76, open: 0.16, round: 0, tongue: 0, up: 0, teeth: 1 },
  H: { k: 0.82, open: 0.4, round: 0.25, tongue: 0.9, up: 1, teeth: 0.3 },
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ── mesh renderer ───────────────────────────────────────────────────────────────────────────────────────────────────
const MAX_BONES = 8;
// bones: B.x = 0 radial (the head), 1 along a limb (fallback), 2 / 3 painted weights (arms + tail: aW, ears: aE; channel B.y)
const VS = `
precision highp float;
attribute vec2 aPos; attribute vec2 aUV; attribute vec3 aW; attribute vec2 aE;
uniform vec2 uFrame;
uniform vec4 uA[${MAX_BONES}]; uniform vec4 uB[${MAX_BONES}]; uniform vec4 uC[${MAX_BONES}];
uniform int uN;
uniform vec4 uG;   // anchor x, anchor y, height, -
uniform vec4 uG2;  // sway (x shift at the top, x height), breath (stretch), lean (rad), -
varying vec2 vUV;
vec2 rot(vec2 q, float a) { float c = cos(a), s = sin(a); return vec2(c * q.x - s * q.y, s * q.x + c * q.y); }
void main() {
  vec2 p = aPos;
  for (int i = 0; i < ${MAX_BONES}; i++) {
    if (i >= uN) break;
    vec4 A = uA[i], B = uB[i], C = uC[i];
    float w;
    if (B.x < 0.5) {
      // radial: pivot A.xy, centre A.zw, full weight inside B.y, none past B.z; points above count as nearer by B.w
      vec2 v = aPos - A.zw;
      if (v.y < 0.0) v.y *= B.w;
      w = 1.0 - smoothstep(B.y, B.z, length(v));
    } else if (B.x < 1.5) {
      // along a limb: base A.xy -> tip A.zw, weight ramps from t = B.y to B.z, within B.w of the line
      vec2 d = A.zw - A.xy; float L = length(d);
      vec2 r = aPos - A.xy;
      float t = dot(r, d) / (L * L);
      float lat = abs(r.x * d.y - r.y * d.x) / L;
      w = smoothstep(B.y, B.z, t) * (1.0 - smoothstep(B.w * 0.7, B.w * 1.35, lat)) * (1.0 - smoothstep(1.2, 1.6, t));
    } else {
      // painted: the part's own weight (tools/build_tutor_rig.py), times a ramp along pivot A.xy → A.zw from t = B.z to B.w
      float m = B.x < 2.5 ? (B.y < 0.5 ? aW.x : (B.y < 1.5 ? aW.y : aW.z)) : (B.y < 0.5 ? aE.x : aE.y);
      vec2 d = A.zw - A.xy;
      w = m * smoothstep(B.z, B.w, dot(aPos - A.xy, d) / max(1.0, dot(d, d)));
    }
    if (w <= 0.0) continue;
    vec2 q = p - A.xy;
    q.y *= mix(1.0, C.y, w);
    p = A.xy + rot(q, C.x * w);
  }
  float h = clamp((uG.y - aPos.y) / uG.z, 0.0, 1.3);
  p.y = uG.y + (p.y - uG.y) * (1.0 + uG2.y * smoothstep(0.0, 0.6, h));
  p.x += uG2.x * uG.z * pow(h, 1.6);
  p = uG.xy + rot(p - uG.xy, uG2.z);
  vUV = aUV;
  gl_Position = vec4(p.x / uFrame.x * 2.0 - 1.0, 1.0 - p.y / uFrame.y * 2.0, 0.0, 1.0);
}`;
const FS = `
precision mediump float;
varying vec2 vUV; uniform sampler2D uTex; uniform float uAlpha;
void main() { gl_FragColor = texture2D(uTex, vUV) * uAlpha; }`;

interface Grid { buf: WebGLBuffer; idx: WebGLBuffer; n: number }
interface Bones { A: Float32Array; B: Float32Array; C: Float32Array; n: number; g: Float32Array; g2: Float32Array }
/** painted weights at a frame point */
type Weigh = (x: number, y: number) => RGB;

class Mesh {
  private prog: WebGLProgram;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private aPos: number; private aUV: number; private aW: number; private aE: number;
  constructor(private gl: WebGLRenderingContext, private W: number, private H: number) {
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('fox shader: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('fox program: ' + gl.getProgramInfoLog(p));
    this.prog = p;
    for (const n of ['uFrame', 'uA', 'uB', 'uC', 'uN', 'uG', 'uG2', 'uTex', 'uAlpha']) this.u[n] = gl.getUniformLocation(p, n);
    this.aPos = gl.getAttribLocation(p, 'aPos'); this.aUV = gl.getAttribLocation(p, 'aUV'); this.aW = gl.getAttribLocation(p, 'aW'); this.aE = gl.getAttribLocation(p, 'aE');
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  }
  texture(src: TexImageSource) {
    const gl = this.gl, t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    return t;
  }
  update(t: WebGLTexture, src: TexImageSource) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  }
  /** a nx × ny grid over the frame rect (x, y, w, h), texture spanning it, painted weights per vertex */
  grid(x: number, y: number, w: number, h: number, nx: number, ny: number, weigh?: Weigh, weighE?: Weigh): Grid {
    const gl = this.gl, v: number[] = [], ix: number[] = [];
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
      const px = x + (w * i) / nx, py = y + (h * j) / ny, ww = weigh ? weigh(px, py) : [0, 0, 0], we = weighE ? weighE(px, py) : [0, 0, 0];
      v.push(px, py, i / nx, j / ny, ww[0], ww[1], ww[2], we[0], we[1]);
    }
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      ix.push(a, b, c, b, d, c);
    }
    const buf = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
    const idx = gl.createBuffer()!; gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(ix), gl.STATIC_DRAW);
    return { buf, idx, n: ix.length };
  }
  clear() { const gl = this.gl; gl.viewport(0, 0, this.W, this.H); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
  draw(tex: WebGLTexture, g: Grid, b: Bones, alpha: number) {
    const gl = this.gl;
    gl.useProgram(this.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, g.buf);
    gl.enableVertexAttribArray(this.aPos); gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 36, 0);
    gl.enableVertexAttribArray(this.aUV); gl.vertexAttribPointer(this.aUV, 2, gl.FLOAT, false, 36, 8);
    gl.enableVertexAttribArray(this.aW); gl.vertexAttribPointer(this.aW, 3, gl.FLOAT, false, 36, 16);
    gl.enableVertexAttribArray(this.aE); gl.vertexAttribPointer(this.aE, 2, gl.FLOAT, false, 36, 28);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.idx);
    gl.uniform2f(this.u.uFrame, this.W, this.H);
    gl.uniform4fv(this.u.uA, b.A); gl.uniform4fv(this.u.uB, b.B); gl.uniform4fv(this.u.uC, b.C);
    gl.uniform1i(this.u.uN, b.n);
    gl.uniform4fv(this.u.uG, b.g); gl.uniform4fv(this.u.uG2, b.g2);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(this.u.uTex, 0);
    gl.uniform1f(this.u.uAlpha, alpha);
    gl.drawElements(gl.TRIANGLES, g.n, gl.UNSIGNED_SHORT, 0);
  }
}

/** the painted weight map of a pose → a sampler at frame points (bilinear) */
function sampler(im: HTMLImageElement, P: PoseMeta): Weigh {
  const k = P.rig.wscale ?? 0.5, W = im.naturalWidth, H = im.naturalHeight;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(im, 0, 0);
  const d = g.getImageData(0, 0, W, H).data;
  return (fx, fy) => {
    const x = (fx - P.x) * k, y = (fy - P.y) * k;
    if (x < 0 || y < 0 || x > W - 1 || y > H - 1) return [0, 0, 0];
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1), ax = x - x0, ay = y - y0;
    const at = (xx: number, yy: number, c: number) => d[(yy * W + xx) * 4 + c];
    const out: RGB = [0, 0, 0];
    for (let c = 0; c < 3; c++) out[c] = ((at(x0, y0, c) * (1 - ax) + at(x1, y0, c) * ax) * (1 - ay) + (at(x0, y1, c) * (1 - ax) + at(x1, y1, c) * ax) * ay) / 255;
    return out;
  };
}

/** one pose ready to draw: its texture + mesh, and the overlay (muzzle patch + drawn mouth + eyelids) with its own mesh */
interface Sheet {
  P: PoseMeta; im: HTMLImageElement; tex?: WebGLTexture; grid?: Grid; hasW: boolean; hasE: boolean;
  ov: HTMLCanvasElement; ovR: [number, number, number, number]; ovTex?: WebGLTexture; ovGrid?: Grid; sig: string; dirty: boolean;
}

export class Fox {
  private cv: HTMLCanvasElement;
  private gl: WebGLRenderingContext | null = null;
  private mesh: Mesh | null = null;
  private g2: CanvasRenderingContext2D | null = null;
  private meta: FoxMeta | null = null;
  private sheets = new Map<string, Sheet>();
  private muzzle: HTMLImageElement | null = null;
  private cur = { pose: 'idle' as Pose, t0: performance.now() };
  private fade: { pose: Pose; t0: number; m: MouthP } | null = null;
  private talking = false;
  private gestureUntil = 0;
  private gestureTimer = 0;
  talkPose: Pose = 'talk';
  ready = false;
  /** the voice level, for clips without mouth cues (main.ts wires audio.voiceLevel) */
  level: () => number = () => 0;
  /** the mouth shape being drawn (tests) */
  mouth: Shape = 'X';
  /** where the shape came from this frame: 'cue' (Rhubarb), 'level' (loudness), 'rest' (tests) */
  mouthSrc: 'cue' | 'level' | 'rest' = 'rest';
  /** test hooks: freeze the motion clock at this time (s); force the eyes shut (0-1), an ear flick (0-1), a mouth */
  freezeAt: number | null = null;
  testShut: number | null = null;
  testFlick: number | null = null;
  testShape: Shape | null = null;
  /** test hook: scale every motion angle (×3 shows plainly which parts move) */
  testAmp = 1;
  private m: MouthP = { ...SHAPES.X };
  private lastT = performance.now();
  // little life: blinks (drawn eyelids) and ear flicks at random moments
  private shut = 0;
  private blinkAt = -1e9; private nextBlink = performance.now() + 1800;
  private flickAt = -1e9; private flickEar = 0; private nextFlick = performance.now() + 3500;

  constructor(private el: HTMLElement) {
    this.cv = el.querySelector('canvas')!;
    try { this.gl = this.cv.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true }) as WebGLRenderingContext | null; } catch { this.gl = null; }
    if (!this.gl) this.g2 = this.cv.getContext('2d');
    const loop = () => { this.draw(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  async load(base = new URL('./fox/', location.href).href) {
    try {
      const r = await fetch(base + 'fox.json', { cache: 'no-cache' });
      if (!r.ok) return false;
      this.meta = await r.json() as FoxMeta;
    } catch { return false; }
    const m = this.meta!;
    const img = (src: string) => new Promise<HTMLImageElement | null>((res) => {
      const im = new Image(); im.decoding = 'async';
      im.onload = () => res(im); im.onerror = () => res(null);
      im.src = base + src;
    });
    const ims: Record<string, HTMLImageElement | null> = {}, wms: Record<string, HTMLImageElement | null> = {}, ems: Record<string, HTMLImageElement | null> = {};
    await Promise.all([
      ...Object.entries(m.poses).map(async ([k, p]) => { ims[k] = await img(p.file); }),
      ...Object.entries(m.poses).map(async ([k, p]) => { wms[k] = p.rig.wmap ? await img(p.rig.wmap) : null; }),
      ...Object.entries(m.poses).map(async ([k, p]) => { ems[k] = p.rig.emap ? await img(p.rig.emap) : null; }),
      img('muzzle.webp').then((im) => { this.muzzle = im; }),
    ]);
    this.cv.width = m.frameW; this.cv.height = m.frameH;
    if (this.gl) {
      try { this.mesh = new Mesh(this.gl, m.frameW, m.frameH); } catch (e) { console.warn(e); this.mesh = null; }
    }
    for (const [k, P] of Object.entries(m.poses)) {
      const im = ims[k];
      if (!im) continue;
      // overlay rect: the muzzle patch, every mouth the pose can draw, and the eyes (blinks)
      const z = P.muzzle, M = P.mouth;
      let x0 = Math.min(z.x, M.x - M.w * 0.75), y0 = Math.min(z.y, M.y - M.w * 0.3);
      let x1 = Math.max(z.x + z.sw, M.x + M.w * 0.75), y1 = Math.max(z.y + z.sh, M.y + M.w * 1.0);
      for (const L of P.rig.lids ?? []) {
        const r = Math.max(L.rx, L.ry) * 1.25;
        x0 = Math.min(x0, L.x - r); y0 = Math.min(y0, L.y - r); x1 = Math.max(x1, L.x + r); y1 = Math.max(y1, L.y + r);
      }
      x0 = Math.floor(x0) - 4; y0 = Math.floor(y0) - 4; x1 = Math.ceil(x1) + 4; y1 = Math.ceil(y1) + 4;
      const ov = document.createElement('canvas'); ov.width = x1 - x0; ov.height = y1 - y0;
      const wm = wms[k], weigh = wm ? sampler(wm, P) : undefined, em = ems[k], weighE = em ? sampler(em, P) : undefined;
      const s: Sheet = { P, im, ov, ovR: [x0, y0, x1 - x0, y1 - y0], hasW: !!weigh, hasE: !!weighE, sig: '', dirty: true };
      if (this.mesh) {
        s.tex = this.mesh.texture(im);
        s.grid = this.mesh.grid(P.x, P.y, P.w, P.h, 56, 64, weigh, weighE);
        s.ovTex = this.mesh.texture(ov);
        s.ovGrid = this.mesh.grid(x0, y0, x1 - x0, y1 - y0, Math.ceil((x1 - x0) / 24), Math.ceil((y1 - y0) / 24), weigh, weighE);
      }
      this.sheets.set(k, s);
    }
    this.ready = this.sheets.size > 0;
    this.el.classList.toggle('ready', this.ready);
    return this.ready;
  }

  /** the pose used while the next/current line is spoken */
  speakAs(p: Pose) { this.talkPose = p; if (this.talking && performance.now() > this.gestureUntil) this.set(p); }
  onTalk(on: boolean) {
    this.talking = on;
    if (performance.now() < this.gestureUntil) return;
    this.set(on ? this.talkPose : 'idle');
  }
  /** play a pose for `ms`, then go back to talking/idle */
  gesture(p: Pose, ms: number) {
    this.set(p);
    this.gestureUntil = performance.now() + ms;
    clearTimeout(this.gestureTimer);
    this.gestureTimer = window.setTimeout(() => { this.gestureUntil = 0; this.set(this.talking ? this.talkPose : 'idle'); }, ms);
  }
  /** a happy bounce in place (CSS squash and stretch — no jump) */
  hop() { this.el.classList.remove('hop'); void this.el.offsetWidth; this.el.classList.add('hop'); }

  private sheetOf(p: Pose) { return this.meta?.map[p] ?? 'teach'; }

  private set(p: Pose) {
    if (this.sheetOf(p) === this.sheetOf(this.cur.pose)) { this.cur.pose = p; return; }
    this.fade = { pose: this.cur.pose, t0: performance.now(), m: { ...this.m } };
    this.cur = { pose: p, t0: performance.now() };
  }

  /** the shape the voice wants now: the clip's Rhubarb cue at its current time, else its loudness */
  private wanted(): Shape {
    if (this.testShape) { this.mouthSrc = 'cue'; return this.testShape; }
    if (!this.talking) { this.mouthSrc = 'rest'; return 'X'; }
    const on = voiceNow();
    const cues = on ? CUES[on.key] : undefined;
    if (on && cues && cues.length) {
      // what we hear lags the audio clock by the output latency
      const lat = (audioCtx() as (AudioContext & { outputLatency?: number }) | null)?.outputLatency ?? 0;
      const t = on.t - lat;
      let lo = 0, hi = cues.length - 1, i = -1;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (cues[mid][0] <= t) { i = mid; lo = mid + 1; } else hi = mid - 1; }
      this.mouthSrc = 'cue';
      return (i < 0 ? 'X' : cues[i][1]) as Shape;
    }
    this.mouthSrc = on ? 'level' : 'rest';
    if (!on) return 'X';
    const lv = this.level();
    return lv > OPEN_AT ? 'C' : lv > HALF_AT ? 'B' : 'A';
  }

  private draw() {
    if (!this.ready || !this.meta) return;
    const now = performance.now(), dt = Math.min(100, now - this.lastT);
    this.lastT = now;
    this.mouth = this.wanted();
    const target = SHAPES[this.mouth], e = 1 - Math.exp(-dt / 45);
    for (const k of Object.keys(target) as (keyof MouthP)[]) this.m[k] = lerp(this.m[k], target[k], e);
    // random life: blinks (sometimes double) and ear flicks
    if (now > this.nextBlink) { this.blinkAt = now; this.nextBlink = now + (Math.random() < 0.2 ? 280 : 2200 + Math.random() * 3200); }
    if (now > this.nextFlick) { this.flickAt = now; this.flickEar = Math.random() < 0.5 ? 0 : 1; this.nextFlick = now + 2600 + Math.random() * 4200; }
    // a blink: the lids close in 70 ms, stay 40, open in 100
    const bt = now - this.blinkAt;
    this.shut = this.testShut ?? (this.freezeAt !== null ? 0 : bt < 70 ? bt / 70 : bt < 110 ? 1 : bt < 210 ? 1 - (bt - 110) / 100 : 0);
    if (this.mesh) this.mesh.clear(); else this.g2?.clearRect(0, 0, this.cv.width, this.cv.height);
    if (this.fade) {
      const k = (now - this.fade.t0) / FADE_MS;
      if (k >= 1) this.fade = null;
      else { this.pose(this.fade.pose, now, 1, this.fade.m); this.pose(this.cur.pose, now, k, this.m); return; }
    }
    this.pose(this.cur.pose, now, 1, this.m);
  }

  /** this moment's bones for a pose: ear flicks, tail wag, arms, head tilt/nod, breathing + sway */
  private bones(name: string, s: Sheet, now: number, m: MouthP): Bones {
    const P = s.P, t = (this.freezeAt ?? now / 1000), R = P.rig, talk = this.talking ? 1 : 0;
    const happy = name === 'jump' || name === 'great' ? 1 : 0;
    const A = new Float32Array(MAX_BONES * 4), B = new Float32Array(MAX_BONES * 4), C = new Float32Array(MAX_BONES * 4);
    let n = 0;
    const put = (a: number[], b: number[], c: number[]) => { A.set(a, n * 4); B.set(b, n * 4); C.set([c[0] * this.testAmp, c[1], c[2], c[3]], n * 4); n++; };
    const limb = (l: [Pt, Pt], t0: number, t1: number, wide: number, ang: number) => {
      const L = Math.hypot(l[1][0] - l[0][0], l[1][1] - l[0][1]);
      put([l[0][0], l[0][1], l[1][0], l[1][1]], [1, t0, t1, L * wide], [ang, 1, 0, 0]);
    };
    // a painted part (map 2 = arms / tail, 3 = ears; channel ch) turning about `pivot`; t0..t1 = only from there along pivot → tip
    const painted = (map: number, ch: number, pivot: Pt, tip: Pt, ang: number, t0 = -10, t1 = -9) =>
      put([pivot[0], pivot[1], tip[0], tip[1]], [map, ch, t0, t1], [ang, 1, 0, 0]);
    // ears: a slow twitch, a quick flick now and then (outward), waggling when happy
    const ft = this.freezeAt !== null ? 1e9 : now - this.flickAt;
    const flick = this.testFlick !== null ? this.testFlick * 0.17 : ft < 300 ? Math.sin((Math.PI * ft) / 300) * 0.17 : 0;
    const earBase = 0.025 * Math.sin((t * TAU) / 2.9) + happy * 0.05 * Math.sin((t * TAU) / 0.8);
    const earLa = -(earBase + (this.flickEar === 0 ? flick : 0)), earRa = earBase + (this.flickEar === 1 ? flick : 0);
    // the whole ear turns about its root: its own painted part (the old capsule missed the tip)
    if (s.hasE) { painted(3, 0, R.earL[0], R.earL[1], earLa); painted(3, 1, R.earR[0], R.earR[1], earRa); }
    else { limb(R.earL, -0.05, 0.7, 0.45, earLa); limb(R.earR, -0.05, 0.7, 0.45, earRa); }
    // tail: a soft wag that runs down it — the tip half follows the base a beat later, like a whip, not a stiff plate —
    // lazy at rest, livelier talking, quicker when happy (its own painted part: the bag stays put)
    const tailAmp = happy ? 0.09 : talk ? 0.06 : 0.045, tailPer = happy ? 0.85 : talk ? 1.4 : 2.2, ph = (t * TAU) / tailPer;
    if (s.hasW) {
      // where a raised arm lies against the tail (jump, great) the tail moves only beyond it — both moving there pulled
      // the picture between them apart (user: "환호할때 튜터의 팔 이상해 꼬리랑 겹쳐지면서 찌글어들었다 펴졌다해")
      const f = R.tailFree ?? 0, [b0, b1] = R.tail;
      const at = (u: number): Pt => [b0[0] + (b1[0] - b0[0]) * u, b0[1] + (b1[1] - b0[1]) * u];
      const root = at(f), mid = at(f + (1 - f) / 2);
      painted(2, 2, mid, b1, tailAmp * 1.3 * Math.sin(ph - 1.1), -0.15, 0.7);      // the tip half first (child before parent)
      if (f > 0) painted(2, 2, root, b1, tailAmp * Math.sin(ph), -0.04, 0.3);
      else painted(2, 2, root, b1, tailAmp * Math.sin(ph));
    } else limb(R.tail, 0.12, 0.8, 0.42, tailAmp * Math.sin(ph));
    // arms (painted parts only, from the shoulder): a slow small sway; more while talking; a gentle wave when happy
    if (s.hasW) {
      const amp = happy ? 0.055 : talk ? 0.04 : 0.022, per = happy ? 0.95 : talk ? 1.6 : 3.4;
      if (R.armL) painted(2, 0, R.armL[0], R.armL[1], amp * Math.sin((t * TAU) / per));
      if (R.armR) painted(2, 1, R.armR[0], R.armR[1], -amp * Math.sin((t * TAU) / per + (name === 'great' ? 0 : 0.9)));
    }
    // head: a slow tilt; nods with the words while talking; bobs when happy (the ears follow: weight reaches up)
    const head = 0.028 * Math.sin((t * TAU) / 5.3 + 0.7) + talk * (0.022 * Math.sin((t * TAU) / 1.25) + 0.05 * (m.open - 0.2))
      + happy * 0.04 * Math.sin((t * TAU) / 1.05 + 0.4);
    const [hx, hy, hr] = R.head;
    put([R.neck[0], R.neck[1], hx, hy], [0, hr * 0.85, hr * 1.3, 0.55], [head, 1, 0, 0]);
    // whole body from the feet: breathing, a gentle sway (more when talking or happy), no hopping
    const meta = this.meta!;
    const sway = 0.008 * Math.sin((t * TAU) / 4.7) + talk * 0.006 * Math.sin((t * TAU) / 1.9) + happy * 0.012 * Math.sin((t * TAU) / 1.05);
    const breath = 0.007 * Math.sin((t * TAU) / 3.2);
    const H = meta.poses.teach?.h ?? P.h;
    return { A, B, C, n, g: new Float32Array([meta.anchor.x, meta.anchor.y, H, 0]), g2: new Float32Array([sway * this.testAmp, breath * this.testAmp, 0, 0]) };
  }

  /** one pose: its picture through the mesh, then its overlay — the mouth (drawn when talking, or at rest for poses
   *  drawn mid-word) and the eyelids while it blinks */
  private pose(p: Pose, now: number, alpha: number, m: MouthP) {
    const name = this.sheetOf(p), s = this.sheets.get(name);
    if (!s) return;
    const P = s.P;
    const speaking = this.talking || this.testShape !== null;
    const drawn = (speaking || P.rest !== 'art') && !!this.muzzle;
    const lids = P.rig.lids?.length && this.shut > 0.02 ? P.rig.lids : null;
    const over = drawn || !!lids;
    if (over) {
      const mp = speaking ? m : SHAPES[(P.rest === 'art' ? 'X' : P.rest) as Shape];
      const sig = `${drawn ? (Object.values(mp) as number[]).map((v) => v.toFixed(3)).join(',') : '-'}|${lids ? this.shut.toFixed(2) : '-'}`;
      if (sig !== s.sig) {
        s.sig = sig; s.dirty = true;
        const o = s.ov.getContext('2d')!;
        o.setTransform(1, 0, 0, 1, 0, 0);
        o.clearRect(0, 0, s.ov.width, s.ov.height);
        o.translate(-s.ovR[0], -s.ovR[1]);
        if (drawn) {
          const z = P.muzzle;
          o.drawImage(this.muzzle!, z.sx, z.sy, z.sw, z.sh, z.x, z.y, z.sw, z.sh);
          drawMouth(o, P.mouth, mp);
        }
        if (lids) for (const L of lids) drawLid(o, L, this.shut);
      }
    }
    if (this.mesh && s.tex && s.grid) {
      const b = this.bones(name, s, now, m);
      this.mesh.draw(s.tex, s.grid, b, alpha);
      if (over && s.ovTex && s.ovGrid) {
        if (s.dirty) { this.mesh.update(s.ovTex, s.ov); s.dirty = false; }
        this.mesh.draw(s.ovTex, s.ovGrid, b, alpha);
      }
      return;
    }
    // no WebGL: the still picture
    const g = this.g2;
    if (!g) return;
    g.globalAlpha = alpha;
    g.drawImage(s.im, P.x, P.y);
    if (over) g.drawImage(s.ov, s.ovR[0], s.ovR[1]);
    g.globalAlpha = 1;
  }
}

/** a blink's eyelids over one eye (its outline, a bit bigger): the upper lid comes down in the fur colour above the eye,
 *  the lower one rises at the end in the colour below it; shut they meet in a soft downward curve with the lashes on it */
function drawLid(g: CanvasRenderingContext2D, L: Lid, shut: number) {
  const rx = L.rx * 1.14, ry = L.ry * 1.14, meet = ry * 0.2, bow = ry * 0.26;
  const upY = -ry - bow + (ry + bow + meet) * shut;                 // the upper lid's edge (its middle is `bow` lower)
  const lowY = ry - (ry - meet) * Math.max(0, (shut - 0.4) / 0.6);
  const rgb = (c: RGB, k = 1) => `rgb(${Math.round(c[0] * k)}, ${Math.round(c[1] * k)}, ${Math.round(c[2] * k)})`;
  const edge = (y: number) => { g.lineTo(rx + 2, y); g.quadraticCurveTo(0, y + bow * 2, -rx - 2, y); };
  g.save();
  g.translate(L.x, L.y); g.rotate((L.rot * Math.PI) / 180);
  g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, TAU); g.clip();
  const gu = g.createLinearGradient(0, -ry, 0, upY + bow);
  gu.addColorStop(0, rgb(L.top)); gu.addColorStop(1, rgb(L.top, 0.9));
  g.fillStyle = gu;
  g.beginPath(); g.moveTo(-rx - 2, -ry - 2); g.lineTo(rx + 2, -ry - 2); edge(upY); g.closePath(); g.fill();
  if (lowY < ry) {
    g.fillStyle = rgb(L.low);
    g.beginPath(); g.moveTo(-rx - 2, ry + 2); g.lineTo(rx + 2, ry + 2); edge(lowY); g.closePath(); g.fill();
  }
  g.strokeStyle = rgb(L.lash); g.lineWidth = Math.max(2, ry * 0.1); g.lineCap = 'round';
  g.beginPath(); g.moveTo(-rx, upY); g.quadraticCurveTo(0, upY + bow * 2, rx, upY); g.stroke();
  g.restore();
}

/** a cartoon mouth in the art's colours: maroon inside, pink tongue, a dark lip line; closed = a smile line */
function drawMouth(g: CanvasRenderingContext2D, M: PoseMeta['mouth'], m: MouthP) {
  const w = M.w, hw = (w * m.k) / 2, h = w * m.open;
  const L = hw * (1 + M.turn * 0.35), R = hw * (1 - M.turn * 0.35);      // far side shorter on a turned head
  g.save();
  g.translate(M.x, M.y + w * 0.06); g.rotate((M.rot * Math.PI) / 180);
  g.lineCap = 'round'; g.lineJoin = 'round';
  if (h < w * 0.05) {
    // closed: a soft smile line (rest), lips pressed flatter (A)
    const curve = w * (m.k > 0.66 ? 0.12 : 0.07);
    g.strokeStyle = 'rgba(74, 36, 30, 0.92)';
    g.lineWidth = w * 0.055;
    g.beginPath(); g.moveTo(-L, 0); g.quadraticCurveTo((R - L) / 2, curve * 2, R, 0); g.stroke();
    g.restore();
    return;
  }
  const top = -h * 0.12 * m.round;                                      // rounded mouths arch up a little
  const path = () => {
    g.beginPath();
    g.moveTo(-L, 0);
    g.bezierCurveTo(-L * 0.7, top * 2.2 - h * 0.08 * m.round, R * 0.7, top * 2.2 - h * 0.08 * m.round, R, 0);
    g.bezierCurveTo(R * (0.95 - 0.1 * m.round), h * (0.9 + 0.25 * m.round), -L * (0.95 - 0.1 * m.round), h * (0.9 + 0.25 * m.round), -L, 0);
    g.closePath();
  };
  path();
  const grad = g.createLinearGradient(0, top, 0, h);
  grad.addColorStop(0, '#4b0d1a'); grad.addColorStop(1, '#8d2335');
  g.fillStyle = grad; g.fill();
  g.save(); path(); g.clip();
  if (m.tongue > 0.05) {
    const ty = lerp(h * 0.86, h * 0.45, m.up);
    g.fillStyle = '#f27f93';
    g.beginPath(); g.ellipse((R - L) * 0.1, ty, Math.max(L, R) * 0.62, h * 0.42 * m.tongue + h * 0.08, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255, 200, 210, 0.45)';
    g.beginPath(); g.ellipse((R - L) * 0.1 - hw * 0.12, ty - h * 0.12, hw * 0.22, h * 0.08, 0, 0, Math.PI * 2); g.fill();
  }
  if (m.teeth > 0.05) {
    g.fillStyle = `rgba(255, 252, 246, ${Math.min(1, m.teeth)})`;
    g.fillRect(-L, top - h, L + R, h * 1.0 + Math.min(h * 0.32, w * 0.07));
  }
  g.restore();
  path();
  g.strokeStyle = 'rgba(60, 22, 18, 0.9)';
  g.lineWidth = w * 0.04;
  g.stroke();
  g.restore();
}
