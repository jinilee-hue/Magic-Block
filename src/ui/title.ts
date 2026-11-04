// Title screen, after the user's mockup: the logo centred on top, a shorter tower on the painted table, the START art
// lying on the table's front edge, the fox waving on the right. Now and then an m-block slides half out of the tower
// with golden sparkles. The view sways gently around a front view (long faces of every other layer readable).
import * as THREE from 'three';
import { Stage } from '../game/stage';
import type { Tower } from '../game/tower';
import type { Confetti } from './confetti';
import type { Fox } from './fox';

const DEG = Math.PI / 180;
const LOGO_ASPECT = 846 / 1200;     // src/assets/logo.webp

export class Title {
  private nextTease = 0;
  private nextWave = 0;
  private t = 0;            // stage clock (s): animations run on it, so the timing holds on slow machines too

  constructor(private app: HTMLElement, private stage: Stage, private tower: Tower, private fox: Fox, private confetti: Confetti) {
    stage.tick((_dt, t) => this.tick(t));
    window.addEventListener('resize', () => this.fit());
  }

  private get on() { const s = this.app.dataset.screen; return s === 'title' || s === 'intro'; }

  /** a title tower was just built: size it under the logo and let it stack itself up */
  enter() {
    this.fit();
    void this.tower.dropIn();
    this.nextTease = this.t + 1.2; this.nextWave = this.t + 1.5;
  }

  /** shrink the title tower (from its foot) until its top clears the logo */
  fit() {
    if (!this.on) return;
    const logo = this.app.querySelector('.logo') as HTMLElement;
    const limit = logo.offsetTop + logo.offsetWidth * LOGO_ASPECT + this.app.clientHeight * 0.012;
    this.pose(0);
    const foot = this.stage.tableAt.y, h = this.tower.topH();
    const top = (s: number) => this.stage.project(new THREE.Vector3(0, h * s, 0)).y;
    let s = 1;
    for (let i = 0; i < 2; i++) { const t = top(s); if (t >= limit) break; s *= (foot - limit) / Math.max(1, foot - t); }
    this.tower.baseScale = Math.max(0.5, Math.min(1, s));
  }

  private pose(t: number) {
    const r = this.stage.rig;
    this.stage.stopTurn();
    r.az = (12 + 9 * Math.sin(t * 0.45)) * DEG; r.el = Stage.EL0 * DEG; r.zoom = 1;
    this.stage.place();
  }

  private tick(t: number) {
    this.t = t;
    if (!this.on) return;
    this.pose(t);
    // the tease waits for the stack-up to finish, then comes back every few seconds
    if (t > this.nextTease && !this.tower.busy) { this.nextTease = t + 4.6; void this.tower.tease((x, y) => this.confetti.sparkle(x, y, 2)); }
    if (t > this.nextWave) { this.nextWave = t + 6.5; this.fox.gesture(Math.random() < 0.5 ? 'happy' : 'cheer', 1700); }
  }
}
