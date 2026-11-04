// The fox tutor: sprite-sheet clips cut from the concept video (public/fox/fox.json + <clip>.webp), played as
// ping-pong loops on a canvas with a short cross-fade between clips. While the tutor talks it shows a talking clip
// (talk / point / say …); otherwise it idles. Gestures (happy, cheer) play for a while and fall back.
export type Pose = 'idle' | 'talk' | 'point' | 'happy' | 'say' | 'cheer';

interface ClipMeta { file: string; frames: number; cols: number; fps: number }
interface FoxMeta { frameW: number; frameH: number; anchor?: { x: number; y: number }; headTop?: number; clips: Record<string, ClipMeta> }

const FADE_MS = 160;

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
    await Promise.all(Object.entries(m.clips).map(([k, c]) => new Promise<void>((res) => {
      const im = new Image(); im.decoding = 'async';
      im.onload = () => { this.sheets.set(k, im); res(); };
      im.onerror = () => res();
      im.src = base + c.file;
    })));
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

  private frameOf(p: Pose, elapsedMs: number) {
    const c = this.meta?.clips[p];
    if (!c) return 0;
    const n = c.frames;
    if (n <= 1) return 0;
    const period = 2 * n - 2;                         // ping-pong: 0..n-1..1
    const i = Math.floor((elapsedMs / 1000) * c.fps * (p === 'idle' ? 0.75 : 1)) % period;
    return i < n ? i : period - i;
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
  }
}
