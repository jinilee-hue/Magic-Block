// Confetti on a full-screen 2D canvas (crisp, cheap, above everything) — bursts like the concept video — and the
// little golden sparkles of the title screen.
const COLORS = ['#ff6fa3', '#ffd34d', '#5fd6a3', '#59b7f0', '#a98bff', '#ff9a5c', '#ffffff', '#7be0ff'];
const SPARK = ['#ffe27a', '#fff6c8', '#ffffff', '#ffd1e6', '#ffc94a'];

interface Bit { x: number; y: number; vx: number; vy: number; r: number; vr: number; w: number; h: number; c: string; flip: number; vf: number; life: number; life0: number; shape: 0 | 1 | 2 | 3 }

export class Confetti {
  private g: CanvasRenderingContext2D;
  private bits: Bit[] = [];
  private raf = 0;
  private last = 0;
  constructor(private cv: HTMLCanvasElement) {
    this.g = cv.getContext('2d')!;
    const fit = () => { const d = Math.min(2, window.devicePixelRatio || 1); cv.width = cv.clientWidth * d; cv.height = cv.clientHeight * d; this.g.setTransform(d, 0, 0, d, 0, 0); };
    window.addEventListener('resize', fit); fit();
  }
  private add(x: number, y: number, a: number, v: number) {
    const s = Math.min(this.cv.clientWidth, this.cv.clientHeight) / 720;
    const life = 2.4 + Math.random() * 1.4;
    this.bits.push({ x, y, vx: Math.cos(a) * v * s, vy: Math.sin(a) * v * s, r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 14,
      w: (7 + Math.random() * 7) * s, h: (11 + Math.random() * 9) * s, c: COLORS[(Math.random() * COLORS.length) | 0],
      flip: Math.random() * 6.28, vf: 4 + Math.random() * 8, life, life0: life, shape: (Math.random() < 0.6 ? 0 : Math.random() < 0.5 ? 1 : 2) as 0 | 1 | 2 });
  }
  /** a pop from a point (CSS px) */
  burst(x: number, y: number, n = 150) {
    for (let i = 0; i < n; i++) this.add(x, y, -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.5, 380 + Math.random() * 700);
    this.run();
  }
  /** confetti falling over the whole screen */
  rain(n = 220) {
    const w = this.cv.clientWidth;
    for (let i = 0; i < n; i++) { this.add(Math.random() * w, -20 - Math.random() * 300, Math.PI / 2 + (Math.random() - 0.5) * 0.6, 80 + Math.random() * 160); this.bits[this.bits.length - 1].life = 4 + Math.random() * 2; }
    this.run();
  }
  /** two cannons from the bottom corners */
  cannons(n = 120) {
    const w = this.cv.clientWidth, h = this.cv.clientHeight;
    for (let i = 0; i < n; i++) {
      this.add(0, h, -Math.PI / 3 + (Math.random() - 0.5) * 0.5, 700 + Math.random() * 600);
      this.add(w, h, -Math.PI + Math.PI / 3 + (Math.random() - 0.5) * 0.5, 700 + Math.random() * 600);
    }
    this.run();
  }
  /** twinkling 4-point stars and golden glitter drifting up from a point (CSS px) — the title's sliding block */
  sparkle(x: number, y: number, n = 2) {
    const s = Math.min(this.cv.clientWidth, this.cv.clientHeight) / 720;
    for (let i = 0; i < n; i++) {
      const star = Math.random() < 0.45, life = (star ? 0.7 : 0.9) + Math.random() * 0.7;
      this.bits.push({ x: x + (Math.random() - 0.3) * 16 * s, y: y + (Math.random() - 0.5) * 16 * s, vx: (14 + Math.random() * 60) * s, vy: (-24 - Math.random() * 60) * s,
        r: Math.random() * 0.8, vr: (Math.random() - 0.5) * 2, w: (star ? 7 + Math.random() * 9 : 1.6 + Math.random() * 2.2) * s, h: star ? 0 : 1, c: SPARK[(Math.random() * SPARK.length) | 0],
        flip: Math.random() * 6.28, vf: 9 + Math.random() * 7, life, life0: life, shape: 3 });
    }
    this.run();
  }
  private run() {
    if (this.raf) return;
    this.last = performance.now();
    const step = () => {
      const now = performance.now(); const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
      const g = this.g, W = this.cv.clientWidth, Hh = this.cv.clientHeight;
      g.clearRect(0, 0, W, Hh);
      const s = Math.min(W, Hh) / 720;
      this.bits = this.bits.filter((b) => (b.life -= dt) > 0 && b.y < Hh + 60);
      for (const b of this.bits) {
        if (b.shape === 3) {
          // sparkle: floats, slows down, twinkles and fades
          b.vx *= Math.pow(0.3, dt); b.vy *= Math.pow(0.5, dt);
          b.x += b.vx * dt; b.y += b.vy * dt; b.r += b.vr * dt; b.flip += b.vf * dt;
          const k = b.life / b.life0, tw = 0.65 + 0.35 * Math.sin(b.flip), R = b.w * tw * (0.6 + 0.4 * Math.sin(Math.PI * k));
          g.save(); g.translate(b.x, b.y); g.rotate(b.r);
          g.globalAlpha = Math.min(1, k * 2.2); g.fillStyle = b.c;
          g.shadowColor = 'rgba(255, 214, 90, 0.85)'; g.shadowBlur = 7 * s;
          g.beginPath();
          if (b.h) g.arc(0, 0, R, 0, 6.283);      // glitter dot
          else for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4, rr = i % 2 ? R * 0.28 : R; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
          g.closePath(); g.fill(); g.restore();
          continue;
        }
        b.vy += 900 * s * dt; b.vx *= Math.pow(0.35, dt); b.vy *= Math.pow(0.55, dt);
        b.vy = Math.min(b.vy, 260 * s);
        b.x += b.vx * dt + Math.sin(b.flip) * 18 * s * dt; b.y += b.vy * dt; b.r += b.vr * dt; b.flip += b.vf * dt;
        g.save(); g.translate(b.x, b.y); g.rotate(b.r); g.scale(1, Math.cos(b.flip));
        g.globalAlpha = Math.min(1, b.life * 2); g.fillStyle = b.c;
        if (b.shape === 0) g.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
        else if (b.shape === 1) { g.beginPath(); g.arc(0, 0, b.w * 0.55, 0, 6.283); g.fill(); }
        else { g.beginPath(); g.moveTo(0, -b.h * 0.6); g.lineTo(b.w * 0.6, b.h * 0.45); g.lineTo(-b.w * 0.6, b.h * 0.45); g.closePath(); g.fill(); }
        g.restore();
      }
      if (this.bits.length) this.raf = requestAnimationFrame(step); else { this.raf = 0; g.clearRect(0, 0, W, Hh); }
    };
    this.raf = requestAnimationFrame(step);
  }
}
