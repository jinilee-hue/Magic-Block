// The title's corner controls (user: "첫화면에도 나가기 버튼과 소리제어하는 볼륨 조절바와 버튼"): a speaker button that
// opens a vertical volume slider (top = loud, bottom = silent; the speaker shows an X at 0; it closes 3.5 s after the
// last touch or on a tap elsewhere), and the exit button (back to the page that opened the game).
import { setVolume, settings, sfx, unlock } from '../core/audio';
import { stopSpeech } from '../core/speech';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;

export function cornerControls() {
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

  $('#btnExit').addEventListener('click', () => {
    sfx('tap'); stopSpeech();
    // leave the game: back to the page that opened it; a tab of its own closes, or else starts over
    if (history.length > 1) { history.back(); setTimeout(() => location.reload(), 700); }
    else { window.close(); setTimeout(() => location.reload(), 300); }
  });
}
