// Game flow: two players take turns. Pick a block whose word starts with m → it slides out, floats up big, the fox
// says it, and the player must read it aloud (on-device speech recognition) before the turn passes. A block that
// doesn't start with m won't come out: it sticks, the fox says its first sound, and the turn goes to the friend.
// When every m-block is out the tower falls ("와르르") and the player with more blocks wins.
// Three wrong blocks in a game (✕ marks on the player's card) and the tower falls on that player: the friend wins
// (user: "플레이어가 3번 잘못 눌렀을경우는 탑이 무너지게 해줘" — counted per player over the whole game, Jenga rule).
import { holdMusic, preload, sfx } from '../core/audio';
import { micBlocked, micSupported, openMic, prepareForStt, type Mic } from '../core/mic';
import { scoreReading } from '../core/readCheck';
import { isTalking, say, stopSpeech, wait } from '../core/speech';
import { check, sttState, sttWhenReady } from '../core/stt';
import type { Confetti } from '../ui/confetti';
import type { Fox } from '../ui/fox';
import type { Got, Hud } from '../ui/hud';
import cardList from '../data/cards.json';
import { rng, shuffle } from './anim';
import { Cheer } from './cheer';
import { collapse } from './collapse';
import type { Stage } from './stage';
import { LAYERS, M_PER_GAME, TITLE_LAYERS, type Block, type Tower, type WordInfo } from './tower';

type Heard = string | null | 'nomic';
type HearResult = 'ok' | 'miss' | 'silence' | 'nomic' | 'again';
const GREAT = ['t:great1', 't:great2', 't:great3'];
const IDLE_HINT_MS = 16000;
/** no touch for this long in a turn: the arrows around the tower (they show it can be turned) */
const SPIN_HINT_MS = 7000;
/** real readings the recogniser didn't take before the fox says "Good try!" and the block is yours anyway */
const MAX_MISSES = 3;
/** wrong blocks (not m) a player may pick in one game: the last one brings the tower down */
const MAX_STRIKES = 3;
/** the m-words still to come on this device: each game takes the next M_PER_GAME of the 20 Unit 1 m-words */
const DECK_KEY = 'pj.mdeck.v1';
/** m-words that have a picture card (public/cards/<word>.webp, from tools/import_cards.py) */
const CARDS = new Set(cardList as string[]);
const cardUrl = (w: string) => CARDS.has(w) ? new URL(`./cards/${w}.webp`, location.href).href : null;

/** did the child say the target word? lenient: near misses and split compounds ("mail box") count (test hook only) */
export function heardOk(target: string, text: string) {
  return scoreReading(target, text).ok || scoreReading(target, text.replace(/\s+/g, '')).ok;
}

/** dev server only: what the recogniser made of each try → .qa/heard.jsonl (text and scores, never audio) */
function devlog(o: Record<string, unknown>) {
  if (import.meta.env.DEV) void fetch('/__pjlog', { method: 'POST', body: JSON.stringify({ t: new Date().toISOString(), ...o }) }).catch(() => undefined);
}

export class Game {
  players: { got: Got[]; strikes: number }[] = [{ got: [], strikes: 0 }, { got: [], strikes: 0 }];
  turn = 0;
  state: 'off' | 'intro' | 'choose' | 'busy' | 'end' = 'off';
  firstGame = true;
  /** the players' animals, picked on the title (ui/picker.ts) */
  animals: [string, string] = ['bunny', 'kitty'];
  /** test hooks: ?fake=1 replaces the microphone with this queue (string = what was heard, null = silence) */
  test = { fake: false, heard: [] as Heard[], log: [] as string[] };
  /** test hook (?m=map,mug): these m-words are in the next tower whatever the deck says */
  forceM: string[] = [];
  lastHeard: string | null = null;
  private session = 0;
  private idleAt = 0;
  private listening = false;
  private voiceOn = false;
  private listenAbort = false;
  private stopNow = false;
  private wantReplay = false;
  private thumbResolve: (() => void) | null = null;
  private greatIdx = 0;
  private mic: Mic | null = null;
  private cheer: Cheer;

  constructor(private stage: Stage, private tower: Tower, private hud: Hud, private fox: Fox, private confetti: Confetti,
    private words: WordInfo[], private seed?: number) {
    stage.onTap = (e) => { this.idleAt = performance.now(); if (this.state === 'choose') { const b = tower.pick(e.ndc); if (b) void this.choose(b); } };
    stage.onHover = (e) => tower.hover(this.state === 'choose' && e ? tower.pick(e.ndc) : null);
    stage.onUserTurn = () => { hud.swipe(false); this.idleAt = performance.now(); };
    // no left / right buttons (user: "좌우 버튼 필요없고 … 원위치 버튼만 하나"): turning is a drag, this button goes back
    hud.onResetView = () => { stage.resetView(); hud.swipe(false); this.idleAt = performance.now(); };
    // the mic is already listening: a tap before talking does nothing, a tap after talking says "I'm done"
    hud.onMic = () => { if (this.listening) { if (this.voiceOn) this.stopNow = true; } else if (isTalking()) stopSpeech(); };
    hud.onListen = () => { this.wantReplay = true; if (this.listening) this.listenAbort = true; else stopSpeech(); };
    hud.onThumb = () => this.thumbResolve?.();
    hud.onWord = (w) => { void say([`w:${w}`]); };
    stage.tick(() => this.idleCheck());
    this.cheer = new Cheer(stage);
  }

  private alive(s: number) { return s === this.session; }
  private log(m: string) { this.test.log.push(`${(performance.now() / 1000).toFixed(1)} ${m}`); }

  /** stop whatever is going on (Home, Play again) */
  abort() {
    this.session++;
    stopSpeech();
    this.listenAbort = true;
    this.thumbResolve?.();
    this.closeMic();
    holdMusic(false);
    this.hud.showRead(false);
    this.hud.hideCard();
    this.cheer.clear();
    this.stage.focus(false);
    this.hud.busy(false);
    this.hud.swipe(false);
    this.stage.controls = true;
    this.state = 'off';
  }

  private closeMic() { this.mic?.close(); this.mic = null; }

  /** The words for one tower: M_PER_GAME m-words, the next ones from the deck (take = the game starts and uses them
   *  up; otherwise a preview, e.g. the title tower), and the rest of the LAYERS × 3 blocks from the other words —
   *  always with the trap words that have an m inside (jam, lemon). */
  pickWords(r: () => number, take: boolean): WordInfo[] {
    const ms = this.words.filter((w) => w.m), byW = new Map(ms.map((w) => [w.w, w]));
    let deck: string[] = [];
    try { deck = (JSON.parse(localStorage.getItem(DECK_KEY) ?? '[]') as string[]).filter((w) => byW.has(w)); } catch { deck = []; }
    const pick = this.forceM.filter((w, i, a) => byW.has(w) && a.indexOf(w) === i).slice(0, M_PER_GAME);
    const rest = deck.filter((w) => !pick.includes(w));
    while (pick.length < M_PER_GAME) {
      if (!rest.length) {
        // a fresh round of all the m-words (keep it for the next game too)
        const fresh = shuffle(ms.map((w) => w.w), r).filter((w) => !pick.includes(w));
        rest.push(...fresh); deck.push(...fresh);
      }
      pick.push(rest.shift()!);
    }
    const left = deck.filter((w) => !pick.includes(w));
    try { localStorage.setItem(DECK_KEY, JSON.stringify(take ? left : [...pick.filter((w) => !this.forceM.includes(w)), ...left])); } catch { /* private mode */ }
    const others = this.words.filter((w) => !w.m);
    const trap = others.filter((w) => w.w.includes('m'));
    const fill = shuffle(others.filter((w) => !trap.includes(w)), r).slice(0, LAYERS * 3 - M_PER_GAME - trap.length);
    return [...pick.map((w) => byW.get(w)!), ...trap, ...fill];
  }

  buildTower(take = false) {
    const r = rng(this.seed ?? ((Math.random() * 1e9) | 0));
    const words = this.pickWords(r, take);
    if (!take) {
      // the title tower = the next game's words (plus a few more: the title tower is taller), set out for show: an
      // m-word on the front face of every long layer (slot 2 faces the title camera), the other m-words in the cross
      // layers
      const extra = shuffle(this.words.filter((w) => !w.m && !words.includes(w)), r).slice(0, Math.max(0, TITLE_LAYERS * 3 - words.length));
      const all = [...words, ...extra];
      const nM = all.filter((w) => w.m).length, front = Math.ceil(TITLE_LAYERS / 2);
      const plan: number[][] = Array.from({ length: TITLE_LAYERS }, (_, l) => (l % 2 === 0 ? [2] : []));
      const cross = shuffle(Array.from({ length: TITLE_LAYERS - front }, (_, i) => i * 2 + 1), r);
      let left = nM - front;
      for (const l of cross) if (left > 0) { plan[l] = [Math.floor(r() * 3)]; left--; }
      for (const l of cross) if (left > 0) { plan[l] = [0, 2]; left--; }
      this.tower.build(all, r, TITLE_LAYERS, nM >= front && left === 0 && all.length === TITLE_LAYERS * 3 ? plan : undefined);
      // and a few blocks lying about on the table: words that are not in the tower (two m-words, two others)
      const inTower = new Set(all.map((w) => w.w));
      const rest = shuffle(this.words.filter((w) => !inTower.has(w.w)), r);
      const ms = rest.filter((w) => w.m), os = rest.filter((w) => !w.m);
      this.tower.scatter([ms[0], os[0], ms[1], os[1]].filter(Boolean), r);
      return;
    }
    this.tower.build(words, r);
    // the picture cards of this tower's m-words, ready before anyone pulls a block
    for (const w of words) { const u = w.m && cardUrl(w.w); if (u) new Image().src = u; }
  }

  async start() {
    this.abort();
    const s = this.session;
    this.players = [{ got: [], strikes: 0 }, { got: [], strikes: 0 }]; this.turn = 0; this.greatIdx = 0;
    this.hud.reset(); this.hud.setAnimals(this.animals); this.hud.setTurn(0, false); this.hud.screen('game');
    this.buildTower(true);
    void this.tower.dropIn(() => sfx('tick'));
    this.stage.home();
    this.state = 'intro'; this.hud.busy(true);
    this.log('start');
    void preload(['t:welcome', 't:howto1', 't:rule', 's:m', 't:howto2', 't:howto3', 't:howto4', 't:rotate', 't:turn1', 't:turn2', 't:perfect', 't:sayit', ...GREAT, 't:again', 't:louder', 't:uhoh', 't:startswith', 't:strike2', 't:strike3']);
    // the first game gets the whole how-to (user: "게임소개 tts"), later games just the reminder
    const first = this.firstGame;
    this.fox.speakAs('talk'); this.fox.hop();
    await say(first ? ['t:welcome', 0.35, 't:howto1'] : ['t:welcome']);
    if (!this.alive(s)) return;
    this.fox.speakAs('point');
    await say(['t:rule', 0.3, 's:m', 0.2, 's:m']);
    if (!this.alive(s)) return;
    if (first) {
      this.fox.speakAs('talk');
      await say(['t:howto2', 0.35, 't:howto3', 0.35, 't:howto4']);
      if (!this.alive(s)) return;
    }
    if (this.firstGame) {
      this.firstGame = false;
      this.stage.turnBy(-40);
      await say(['t:rotate']);
      if (!this.alive(s)) return;
      this.stage.turnBy(40);
    }
    await this.beginTurn(s);
  }

  private async beginTurn(s: number) {
    this.hud.setTurn(this.turn);
    this.hud.foxTurn(this.turn);
    this.hud.busy(false);
    this.stage.controls = true;
    sfx('turn');
    this.state = 'choose';
    this.idleAt = performance.now();
    this.log(`turn ${this.turn + 1}`);
    this.fox.speakAs('point');
    await say([this.turn ? 't:turn2' : 't:turn1']);
    if (this.alive(s)) this.idleAt = performance.now();
  }

  async choose(b: Block) {
    const s = this.session;
    this.state = 'busy';
    this.hud.busy(true); this.hud.swipe(false);
    this.stage.controls = false;
    this.tower.hover(null);
    stopSpeech();
    this.log(`pick ${b.word.w} (${b.word.m ? 'm' : b.word.first})`);
    if (b.word.m) await this.right(b, s); else await this.wrong(b, s);
  }

  private async right(b: Block, s: number) {
    const w = `w:${b.word.w}`;
    void preload([w]);
    sfx('slide');
    this.fox.speakAs('happy'); this.fox.gesture('happy', 1600);
    // "Perfect! Pull it out!" plays to its end: the read prompt waits for it instead of cutting it mid-word (a block
    // without a picture card, the Korean line: it was still talking when the prompt came)
    const perfect = say(['t:perfect']);
    // golden stars twinkle off its end while it slides out, as on the title (user: "인트로화면처럼 젠가 블럭 뺐을때는 별 파티클")
    await this.tower.pullOut(b, (x, y) => this.confetti.sparkle(x, y, 2, true));
    if (!this.alive(s)) return;
    sfx('whoosh');
    const pic = cardUrl(b.word.w);
    this.stage.focus(true);
    await this.tower.present(b, 0.47);
    if (!this.alive(s)) return;
    // it lands in the middle: Word Mashup's result-card pop — candy streaks, spinning stars, candy dots — then a golden
    // glow and turning rays behind it and its card, and a candy rain (user: "맞는 블럭 젠가를 뺐을때는 wordmashup에
    // 정답카드 나올때처럼 파티클 넣어줘")
    {
      const box = this.tower.presentedBox(b);
      sfx('burst');
      this.cheer.pop(box.cx, (box.y0 + box.y1) / 2, pic ? this.hud.cardSize().w : Math.min(box.x1 - box.x0, this.hud.cardSize().w));
    }
    if (pic) {
      // the block spins round and turns into its picture card (user: "블럭이 돌면서 이미지 카드가 나오면")
      const box = this.tower.presentedBox(b);
      const ready = this.hud.prepCard(pic, b.word.w, b.color, { x: box.cx, y: (box.y0 + box.y1) / 2 });
      sfx('whoosh');
      await this.tower.turnAway(b);
      await ready;
      if (!this.alive(s)) return;
      await this.hud.cardIn();
      if (!this.alive(s)) return;
    }
    await perfect;
    if (!this.alive(s)) return;
    this.hud.showRead(true); this.hud.micState('idle');
    const read = await this.readLoop(b, s);
    if (!read || !this.alive(s)) return;
    // read it — the card turns back into the block, and the block flies onto the player's pile (user: "발음하면 이제
    // 다시 이미지 카드가 돌아서 블럭이 플레이어한테 가서 쌓이면")
    this.hud.micState('done');
    sfx('success');
    const c = this.stage.project(b.mesh.position);
    this.confetti.burst(c.x, c.y, read === 'read' ? 170 : 90);
    this.fox.speakAs('cheer'); this.fox.gesture('cheer', 2600); this.fox.hop();
    const talk = say([read === 'read' ? GREAT[this.greatIdx++ % GREAT.length]! : 't:goodtry']);
    await wait(pic ? 450 : 700);
    if (!this.alive(s)) return;
    this.cheer.stop();                     // the glow and the rays go with the card
    if (pic) {
      await this.hud.cardOut();
      if (!this.alive(s)) return;
      await this.tower.turnBack(b);
      if (!this.alive(s)) return;
      await wait(150);
    }
    const me = this.players[this.turn];
    me.got.push({ word: b.word, color: b.color });
    const tgt = this.hud.chipSlot(this.turn, me.got);
    sfx('whoosh');
    this.stage.focus(false);
    await this.tower.flyTo(b, tgt.x, tgt.y);
    if (!this.alive(s)) return;
    sfx('pop');
    this.hud.land(this.turn, me.got.length);
    this.hud.showRead(false);
    this.log(`got ${b.word.w} → P${this.turn + 1} = ${me.got.length}`);
    await talk;
    if (!this.alive(s)) return;
    if (this.tower.mLeft() === 0) { await this.finish(s); return; }
    this.turn = 1 - this.turn;
    await this.beginTurn(s);
  }

  /** Model the word, then listen until the child reads it. The turn passes only after a reading: one the recogniser
   *  took ('read'), or MAX_MISSES real tries it didn't take ('tried' — it must never trap a child). Silence never passes.
   *  The microphone opens once for the whole turn and the music stays off meanwhile. */
  private async readLoop(b: Block, s: number): Promise<'read' | 'tried' | null> {
    const w = `w:${b.word.w}`;
    holdMusic(true);
    try {
      this.fox.speakAs('say');
      await say(['t:sayit', 0.15, w]);
      let misses = 0, tries = 0;
      while (this.alive(s)) {
        const r = await this.hear(b.word, s);
        this.log(`hear ${b.word.w}: ${r}${this.lastHeard != null ? ` "${this.lastHeard}"` : ''}`);
        if (!this.alive(s)) return null;
        if (r === 'ok') return 'read';
        if (r === 'again') { this.fox.speakAs('say'); await say([w]); continue; }
        if (r === 'nomic') {
          // no microphone on this device: the child reads aloud and taps the thumb (a friend / teacher can check)
          this.closeMic();
          this.hud.noMic(true);
          this.fox.speakAs('say');
          await say(['t:nomic', 0.15, w]);
          if (!this.alive(s)) return null;
          await new Promise<void>((res) => { this.thumbResolve = res; });
          this.thumbResolve = null;
          this.hud.noMic(false);
          return this.alive(s) ? 'read' : null;
        }
        this.hud.micState('miss');
        if (r === 'miss' && ++misses >= MAX_MISSES) return 'tried';
        this.fox.speakAs('talk');
        await say(r === 'silence' ? ['t:louder', 0.15, w] : ['t:again', 0.15, w]);
        if (++tries >= 2) this.hud.pulseListen(true);
      }
      return null;
    } finally {
      this.closeMic();
      holdMusic(false);
    }
  }

  private async hear(word: WordInfo, s: number): Promise<HearResult> {
    const target = word.w;
    this.listenAbort = false; this.stopNow = false; this.voiceOn = false; this.lastHeard = null;
    if (this.wantReplay) { this.wantReplay = false; return 'again'; }
    if (this.test.fake) {
      this.listening = true; this.hud.micState('listening');
      const next = this.test.heard.length ? this.test.heard.shift()! : target;
      for (let i = 0; i < 12 && !this.listenAbort; i++) { this.hud.micLevel(0.3 + 0.5 * Math.abs(Math.sin(i))); await wait(70); }
      this.listening = false; this.hud.micLevel(0);
      if (this.wantReplay) { this.wantReplay = false; this.hud.micState('idle'); return 'again'; }
      if (next === 'nomic') return 'nomic';
      if (next === null) { this.hud.micState('idle'); return 'silence'; }
      this.lastHeard = next;
      this.hud.micState('thinking'); await wait(300);
      return heardOk(target, next) ? 'ok' : 'miss';
    }
    if (!micSupported() || micBlocked()) return 'nomic';
    if (!this.mic) {
      // first try of this turn: open the microphone (the browser asks for permission the very first time)
      const t0 = performance.now();
      const m = await openMic(() => this.listenAbort || !this.alive(s) || performance.now() - t0 > 15000);
      if (!this.alive(s)) { if (m.kind === 'ok') m.mic.close(); return 'silence'; }
      if (m.kind === 'aborted') {
        if (this.wantReplay) { this.wantReplay = false; return 'again'; }
        devlog({ target, result: 'nomic', why: 'no answer to the permission prompt' });
        return 'nomic';
      }
      if (m.kind !== 'ok') { devlog({ target, result: 'nomic', why: m.kind === 'error' ? m.error : m.kind }); return 'nomic'; }
      this.mic = m.mic;
    }
    this.listening = true;
    const r = await this.mic.listen({
      startTimeoutMs: 8000, maxMs: 4500, endSilenceMs: 800, guardMs: 300,
      // the cue plays the moment the microphone is really live; the first 300 ms (the cue itself) aren't judged
      onState: (st) => { if (st === 'waiting') { this.hud.micState('listening'); sfx('listen'); } else this.voiceOn = true; },
      onLevel: (v) => this.hud.micLevel(v),
      aborted: () => this.listenAbort || !this.alive(s),
      stopNow: () => this.stopNow,
    });
    this.listening = false; this.voiceOn = false;
    this.hud.micLevel(0);
    if (r.kind === 'denied' || r.kind === 'error') {
      this.closeMic(); this.hud.micState('idle');
      devlog({ target, result: 'nomic', why: r.kind === 'error' ? r.error : r.kind });
      return 'nomic';
    }
    if (r.kind === 'aborted') { this.hud.micState('idle'); if (this.wantReplay) { this.wantReplay = false; return 'again'; } return 'silence'; }
    if (r.kind === 'silence') { this.hud.micState('idle'); devlog({ target, result: 'silence', lv: r.lv }); return 'silence'; }
    this.hud.micState('thinking');
    if (sttState() === 'loading') await sttWhenReady(8000);
    if (sttState() !== 'ready') { devlog({ target, result: 'ok', why: `recogniser ${sttState()}` }); return 'ok'; } // a clear voice was heard
    const out = await check(await prepareForStt(r.pcm, r.sr), target, word.alts ?? [], word.rivals ?? []);
    if (!out) { devlog({ target, result: 'ok', why: 'check failed' }); return 'ok'; }
    this.lastHeard = out.text;
    devlog({ target, result: out.ok ? 'ok' : 'miss', text: out.text, exact: out.exact, sT: out.sT, gap: out.gap, rgap: out.rgap, rival: out.rival, pNo: out.pNo, ms: out.ms, voicedMs: r.voicedMs, lv: r.lv });
    return out.ok ? 'ok' : 'miss';
  }

  private async wrong(b: Block, s: number) {
    sfx('knock');
    this.fox.speakAs('talk');
    const anim = this.tower.stuck(b);
    const box = this.tower.layerScreenBox(b.layer);
    this.hud.letterPop(box.x0, box.y, b.word.w, b.color);
    // one more ✕ on this player's card
    const p = this.turn, me = this.players[p];
    me.strikes++;
    this.log(`strike ${me.strikes} P${p + 1}`);
    setTimeout(() => { if (this.alive(s)) { sfx('wrong'); this.hud.setStrikes(p, me.strikes, true); } }, 350);
    await wait(200);
    await say(['t:uhoh', 0.2, `w:${b.word.w}`, 0.35, 't:startswith', 0.12, `s:${b.word.first}`, 0.3, `s:${b.word.first}`]);
    await anim;
    if (!this.alive(s)) return;
    if (me.strikes >= MAX_STRIKES) { await this.topple(s); return; }
    if (me.strikes === MAX_STRIKES - 1) {
      // one more and the tower falls: say so, while the two ✕ marks are up
      this.fox.speakAs('point');
      await say(['t:strike2']);
      if (!this.alive(s)) return;
    }
    this.turn = 1 - this.turn;
    await this.beginTurn(s);
  }

  /** the third wrong block: the tower falls on this player and the friend wins (Jenga rule — user's choice) */
  private async topple(s: number) {
    this.state = 'end';
    this.hud.busy(true);
    this.stage.controls = false;
    const loser = this.turn;
    this.log(`3 strikes → P${loser + 1} topples the tower`);
    this.fox.speakAs('talk');
    await say(['t:strike3']);
    if (!this.alive(s)) return;
    sfx('collapse');
    // the whole tower tips over: the ending's shove (push) left a nearly full tower standing
    await collapse(this.stage, this.tower, 3.4, 'tip');
    if (!this.alive(s)) return;
    await this.result(s, 1 - loser);
  }

  private async finish(s: number) {
    this.state = 'end';
    this.hud.busy(true);
    this.stage.controls = false;
    this.log('all m out');
    this.fox.speakAs('cheer'); this.fox.gesture('cheer', 2400);
    await say(['t:allout']);
    if (!this.alive(s)) return;
    this.fox.speakAs('point');
    await say(['t:watch']);
    if (!this.alive(s)) return;
    sfx('collapse');
    await collapse(this.stage, this.tower, 3.4);
    if (!this.alive(s)) return;
    const a = this.players[0].got.length, b = this.players[1].got.length;
    await this.result(s, a > b ? 0 : b > a ? 1 : -1);
  }

  /** the result book after the tower is down (winner -1 = a tie) */
  private async result(s: number, winner: number) {
    this.confetti.cannons(170);
    this.log(`result ${this.players[0].got.length}:${this.players[1].got.length} winner ${winner < 0 ? 'tie' : `P${winner + 1}`}`);
    this.hud.showResult(this.players, winner);
    this.hud.screen('result');
    if (winner >= 0) {
      const ava = document.querySelector('.page.winner .ava');
      window.setTimeout(() => {
        if (!this.alive(s) || !ava) return;
        const r = ava.getBoundingClientRect();
        const x = r.x + r.width / 2, y = r.y + r.height * 0.15;
        this.confetti.burst(x, y, 80);
        this.confetti.sparkle(x, y - 8, 18, true);
      }, 720);
    }
    this.fox.speakAs('cheer'); this.fox.gesture('cheer', 3200); this.fox.hop();
    if (!this.alive(s)) return;
    await say([winner === 0 ? 't:win1' : winner === 1 ? 't:win2' : 't:tie']);
  }

  /** nobody has picked for a while: the fox points and one m-block glows */
  private idleCheck() {
    if (this.state !== 'choose' || isTalking()) return;
    const now = performance.now();
    // nobody has touched anything for a while: the arrows around the tower show it turns (user: "좌우 돌리라는 화살표만
    // 반응없을때 나오면") — they go at the next drag, tap or reset
    if (now - this.idleAt > SPIN_HINT_MS && !this.hud.swipeOn) this.hud.swipe(true);
    if (now - this.idleAt < IDLE_HINT_MS) return;
    this.idleAt = now;
    const ms = this.tower.inTower().filter((b) => b.word.m && this.tower.visible(b));
    if (!ms.length) { this.stage.turnBy(-90); return; }
    const { w, h } = this.stage.size;
    ms.sort((a, b) => { const pa = this.stage.project(a.mesh.getWorldPosition(a.mesh.position.clone())), pb = this.stage.project(b.mesh.getWorldPosition(b.mesh.position.clone())); return Math.hypot(pa.x - w / 2, pa.y - h / 2) - Math.hypot(pb.x - w / 2, pb.y - h / 2); });
    this.fox.speakAs('point');
    void say(['t:look', 0.2, 's:m']);
    void this.tower.hint(ms[0]);
  }

  /** back to the title (Home) */
  toTitle() {
    this.abort();
    this.hud.reset();
    this.hud.screen('title');
    this.buildTower(false);
    this.onTitle();
  }
  /** the title screen takes over the new (shorter) tower: size, stack-up, sway (ui/title.ts) */
  onTitle: () => void = () => {};

  /** tests: hand out all but `leave` m-blocks (alternating players) so the ending can be checked quickly */
  debugFastForward(leave = 1) {
    const ms = this.tower.inTower().filter((b) => b.word.m);
    ms.slice(0, Math.max(0, ms.length - leave)).forEach((b, i) => {
      b.state = 'gone'; b.mesh.visible = false;
      const p = this.players[i % 2]; p.got.push({ word: b.word, color: b.color });
    });
    this.players.forEach((p, i) => this.hud.addWord(i, p.got, p.got.length));
  }
}
