// The title's and the game's corner controls (user: "첫화면에도 나가기 버튼과 소리제어하는 볼륨 조절바와 버튼", then
// "나가기 버튼과 사운드제어 버튼은 인트로와 공통으로 쓰고 설정버튼과 홈버튼은 삭제해줘"): a speaker button that opens a
// vertical volume slider (top = loud, bottom = silent; a red slash on the speaker at 0; it closes 3.5 s after the last
// touch or on a tap elsewhere), and the exit button. On the title, exit leaves the game (back to the page that opened
// it); in a game (or on the result book) it goes back to the title — on a second tap, so a stray tap never ends a game.
import { setVolume, settings, sfx, unlock } from '../core/audio';
import { stopSpeech } from '../core/speech';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;

export function cornerControls(o: { leave: () => void }) {
  const btn = $<HTMLButtonElement>('#btnSound'), panel = $('#volPanel'), track = panel.querySelector('.vol-track') as HTMLElement;
  let closeT = 0;
  const paint = () => {
    const v = settings.volume;
    panel.style.setProperty('--v', v.toFixed(3));
    panel.setAttribute('aria-valuenow', String(Math.round(v * 100)));
    btn.classList.toggle('muted', v === 0);
  };
  const later = () => { clearTimeout(closeT); closeT = window.setTimeout(() => open(false), 3500); };
  const open = (on: boolean) => {
    panel.hidden = !on; btn.setAttribute('aria-expanded', String(on));
    if (on) later(); else clearTimeout(closeT);
  };
  btn.addEventListener('click', (e) => { e.stopPropagation(); unlock(); sfx('tap'); open(panel.hidden); });

  const fromY = (y: number) => { const r = track.getBoundingClientRect(); return 1 - (y - r.top) / r.height; };
  let drag: number | null = null;
  panel.addEventListener('pointerdown', (e) => {
    drag = e.pointerId;
    try { panel.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    unlock(); setVolume(fromY(e.clientY)); paint(); later(); e.preventDefault();
  });
  panel.addEventListener('pointermove', (e) => { if (drag !== e.pointerId) return; setVolume(fromY(e.clientY)); paint(); later(); });
  const end = (e: PointerEvent) => { if (drag === e.pointerId) { drag = null; sfx('tap'); } };
  panel.addEventListener('pointerup', end);
  panel.addEventListener('pointercancel', end);
  panel.addEventListener('keydown', (e) => {
    const step = { ArrowUp: .1, ArrowRight: .1, ArrowDown: -.1, ArrowLeft: -.1 }[e.key] ?? 0;
    if (e.key === 'Escape') { open(false); btn.focus(); return; }
    if (!step) return;
    setVolume(Math.round((settings.volume + step) * 10) / 10); paint(); later(); e.preventDefault();
  });
  document.addEventListener('pointerdown', (e) => { if (!panel.hidden && !(e.target as Element).closest('#vol')) open(false); });
  paint();

  const app = $('#app'), exit = $('#btnExit');
  let armed = 0;
  exit.addEventListener('click', () => {
    sfx('tap');
    const s = app.dataset.screen;
    if (s === 'game' || s === 'result') {
      // in a game: the first tap arms it (red, wiggling), a second one within 2.6 s goes back to the title
      if (performance.now() < armed) { armed = 0; exit.classList.remove('armed'); o.leave(); return; }
      armed = performance.now() + 2600;
      exit.classList.remove('armed'); void exit.offsetWidth; exit.classList.add('armed');
      setTimeout(() => { if (performance.now() >= armed) exit.classList.remove('armed'); }, 2700);
      return;
    }
    stopSpeech();
    // leave the game: back to the page that opened it; a tab of its own closes, or else starts over
    if (history.length > 1) { history.back(); setTimeout(() => location.reload(), 700); }
    else { window.close(); setTimeout(() => location.reload(), 300); }
  });

  // the game's HUD keeps clear of the bar (it gets wider when EN | 한 shows in the game): CSS --sys-w
  const bar = $('.sysbar');
  const fit = () => app.style.setProperty('--sys-w', `${bar.offsetWidth}px`);
  new ResizeObserver(fit).observe(bar);
  fit();
}
