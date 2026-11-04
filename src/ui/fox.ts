// The fox tutor: sprite-sheet clips cut from the concept video (public/fox/fox.json + <clip>.webp), played as
// ping-pong loops on a canvas with a short cross-fade between clips. While the tutor talks it shows a talking clip
// (talk / point / say …); otherwise it idles. Gestures (happy, cheer) play for a while and fall back.
// Lip sync: while a line plays, the mouth follows the voice — a closed / half-open / open mouth cut from the fox's own
// frames (public/fox/mouth.webp, tools/build_fox_mouth.py) is laid over each talking frame at that frame's nose.
export type Pose = 'idle' | 'talk' | 'point' | 'happy' | 'say' | 'cheer';
type Mouth = 'closed' | 'half' | 'open';

interface ClipMeta { file: string; frames: number; cols: number; fps: number; use?: [number, number] }
interface MouthMeta { box: [number, number, number, number]; clips: Record<string, { nose: [number, number][]; patch: Record<Mouth, number>; skip: number[] }> }
interface FoxMeta { frameW: number; frameH: number; anchor?: { x: number; y: number }; headTop?: number; clips: Record<string, ClipMeta>; mouth?: MouthMeta }

const FADE_MS = 160;
// voice loudness (RMS, see audio.voiceLevel) → mouth: about a quarter of the voiced moments closed, the loud half open
const HALF_AT = 0.04, OPEN_AT = 0.125, HOLD_MS = 55;

export class Fox {
  private cv: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private meta: FoxMeta | null = null;
  private sheets = new Map<string, HTMLImageElement>();
  private cur = { pose: 'idle' as Pose, t0: performance.now() };
  private fade: { pose: Pose; frame: number; t0: number } | null = null;
  private talking = false;
  private gestureUntil = 0;
  private gestureTimer = 0;
  talkPose: Pose = 'talk';
  ready = false;
  /** the voice level to lip-sync to (main.ts wires audio.voiceLevel) */
  level: () => number = () => 0;
  private mouthIm: HTMLImageElement | null = null;
  mouth: Mouth = 'closed';
  private mouthAt = 0;

  constructor(private el: HTMLElement) {
    this.cv = el.querySelector('canvas')!;
    this.g = this.cv.getContext('2d')!;
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
    const sheets = Object.entries(m.clips).map(([k, c]) => new Promise<void>((res) => {
      const im = new Image(); im.decoding = 'async';
      im.onload = () => { this.sheets.set(k, im); res(); };
      im.onerror = () => res();
      im.src = base + c.file;
    }));
    if (m.mouth) {
      sheets.push(new Promise<void>((res) => {
        const im = new Image(); im.decoding = 'async';
        im.onload = () => { this.mouthIm = im; res(); };
        im.onerror = () => res();
        im.src = base + 'mouth.webp';
      }));
    }
    await Promise.all(sheets);
    this.cv.width = m.frameW; this.cv.height = m.frameH;
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
  hop() { this.el.classList.remove('hop'); void this.el.offsetWidth; this.el.classList.add('hop'); }

  private has(p: Pose) { return !!this.meta?.clips[p] && this.sheets.has(p); }
  private resolve(p: Pose): Pose { return this.has(p) ? p : this.has('talk') ? 'talk' : (Object.keys(this.meta?.clips ?? {})[0] as Pose) ?? 'idle'; }

  private set(p: Pose) {
    const pose = this.resolve(p);
    if (pose === this.cur.pose) return;
    this.fade = { pose: this.cur.pose, frame: this.frameOf(this.cur.pose, performance.now() - this.cur.t0), t0: performance.now() };
    this.cur = { pose, t0: performance.now() };
  }

  /** ping-pong over the clip's frames — or only over `use` [first, last] when fox.json gives one: frames where the
   *  tail swings up under the chin are left out (in the source video the cream tail tip has the pale background's
   *  colour, the matte guessed there and kept a flat skin-coloured plane between chin and tail) */
  private frameOf(p: Pose, elapsedMs: number) {
    const c = this.meta?.clips[p];
    if (!c) return 0;
    const [a, b] = c.use ?? [0, c.frames - 1];
    const n = b - a + 1;
    if (n <= 1) return a;
    const period = 2 * n - 2;                         // ping-pong: a..b..a+1
    const i = Math.floor((elapsedMs / 1000) * c.fps * (p === 'idle' ? 0.75 : 1)) % period;
    return a + (i < n ? i : period - i);
  }

  private blit(p: Pose, frame: number, alpha: number) {
    const m = this.meta!, c = m.clips[p], im = this.sheets.get(p);
    if (!c || !im) return;
    const sx = (frame % c.cols) * m.frameW, sy = Math.floor(frame / c.cols) * m.frameH;
    this.g.globalAlpha = alpha;
    this.g.drawImage(im, sx, sy, m.frameW, m.frameH, 0, 0, m.frameW, m.frameH);
  }

  private draw() {
    if (!this.ready || !this.meta) return;
    const now = performance.now();
    const pose = this.resolve(this.cur.pose);
    this.g.clearRect(0, 0, this.cv.width, this.cv.height);
    const f = this.frameOf(pose, now - this.cur.t0);
    if (this.fade) {
      const k = (now - this.fade.t0) / FADE_MS;
      if (k >= 1) this.fade = null;
      else { this.blit(this.fade.pose, this.fade.frame, 1); this.blit(pose, f, k); this.g.globalAlpha = 1; return; }
    }
    this.blit(pose, f, 1);
    this.g.globalAlpha = 1;
    this.lipSync(pose, f, now);
  }

  /** while a line plays, lay the mouth that matches the voice over this frame's mouth */
  private lipSync(pose: Pose, f: number, now: number) {
    const mm = this.meta?.mouth, clip = mm?.clips[pose];
    const lv = this.talking ? this.level() : 0;
    const want: Mouth = lv > OPEN_AT ? 'open' : lv > HALF_AT ? 'half' : 'closed';
    if (want !== this.mouth && now - this.mouthAt > HOLD_MS) { this.mouth = want; this.mouthAt = now; }
    if (!this.talking || !mm || !clip || !this.mouthIm || clip.skip.includes(f) || !clip.nose[f]) return;
    const [pw, ph, ox, oy] = mm.box, [nx, ny] = clip.nose[f];
    this.g.drawImage(this.mouthIm, clip.patch[this.mouth] * pw, 0, pw, ph, Math.round(nx + ox), Math.round(ny + oy), pw, ph);
  }
}
