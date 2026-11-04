// Lenient "did the child read it?" check: target words vs what the recogniser heard. Near misses count (a child's
// "mad" for "mat", "see" heard as "sea"), so a real attempt passes; silence, chatter or a different word doesn't.

export function words(s: string): string[] {
  return (s.toLowerCase().replace(/[’‘`]/g, "'").match(/[a-z0-9']+/g) ?? []).map((w) => w.replace(/'/g, '')).filter(Boolean);
}

// words a recogniser writes differently for the same sound
const SAME: string[][] = [
  ['see', 'sea', 'c', 'si', 'she'], ['i', 'eye', 'aye', 'hi', 'ai'], ['a', 'uh', 'ah', 'the', 'an'], ['to', 'two', 'too'],
  ['for', 'four'], ['be', 'bee', 'b'], ['you', 'u', 'yo'], ['are', 'r'], ['oh', 'o'], ['its', 'it', 'is'],
  ['zero', '0'], ['one', 'won', '1'], ['two', '2'], ['three', '3'], ['four', '4'], ['five', '5'], ['six', '6'], ['seven', '7'],
  ['eight', '8', 'ate'], ['nine', '9'], ['ten', '10'],
  ['mom', 'mum', 'mam', 'ma', 'mama', 'mommy'], ['dad', 'dada'], ['can', 'cam', 'kan'], ['and', 'n', 'an'], ['in', 'inn'], ['my', 'mi', 'mai', 'mine'],
  // homophones / spellings a recogniser picks for the Jenga m-words
  ['mail', 'male', 'mayl'], ['meat', 'meet', 'mete'], ['mitt', 'mit', 'mitts'], ['maze', 'maize', 'mays'], ['mix', 'mics', 'mixed'],
  ['met', 'mett'], ['mud', 'mudd'], ['mug', 'mugg'], ['mop', 'mopp'], ['map', 'mapp'], ['mat', 'matt'], ['mad', 'madd'], ['mess', 'mes'],
  ['make', 'made', 'makes'], ['mouse', 'mice', 'mouses'], ['man', 'men'], ['monkey', 'monkeys', 'monkee'], ['mushroom', 'mushrooms'],
  ['mitten', 'mittens', 'mitton'], ['mirror', 'mirrors', 'mira'], ['mailbox', 'mail box', 'mailboxes'], ['moon', 'moons'], ['milk', 'milks'],
];
const alias = new Map<string, Set<number>>();
SAME.forEach((g, i) => g.forEach((w) => { if (!alias.has(w)) alias.set(w, new Set()); alias.get(w)!.add(i); }));
const sameGroup = (a: string, b: string) => { const x = alias.get(a), y = alias.get(b); if (!x || !y) return false; for (const i of x) if (y.has(i)) return true; return false; };

/** rough sound key: c/k/ck, ph/f, doubled letters, a final silent e */
const key = (w: string) => w.replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/c/g, 'k').replace(/q/g, 'k').replace(/x/g, 'ks').replace(/(.)\1+/g, '$1').replace(/(.{2,})e$/, '$1');

function lev(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length]![b.length]!;
}

/** 1 = same word, 0.8 = near miss, 0 = different */
export function wordMatch(t: string, h: string): number {
  if (t === h || sameGroup(t, h)) return 1;
  const kt = key(t), kh = key(h);
  if (kt === kh) return 1;
  if ((t.length >= 3 || kt.length >= 3) && lev(kt, kh) <= 1) return 0.8;
  if (kt.length >= 6 && lev(kt, kh) <= 2) return 0.8;
  return 0;
}

// template words ("I can see ...", "It is a ..."): matching only these doesn't prove the sentence was read
const FUNC = new Set(['i', 'a', 'an', 'the', 'is', 'it', 'its', 'am', 'are', 'can', 'see', 'to', 'my', 'me', 'we', 'you', 'he', 'she',
  'they', 'on', 'in', 'at', 'of', 'and', 'like', 'look', 'this', 'that', 'here', 'there', 'go', 'do', 'no', 'yes', 'so', 'up', 'be',
  'for', 'with', 'not', 'what', 'where', 'who', 'said', 'was', 'has', 'have', 'oh', 'too', 'big', 'little']);

export interface ReadScore { ok: boolean; hit: boolean[]; score: number; target: string[]; heard: string[] }

/** strict: the transcript IS the word (or a homophone / same-sound spelling); "mail box" counts for "mailbox" */
export function exactReading(target: string, heardText: string): boolean {
  const t = words(target).join(''), H = words(heardText);
  const cands = [...H, H.join('')];
  const kt = key(t);
  return cands.some((h) => h && (h === t || sameGroup(t, h) || key(h) === kt));
}

/** One- and two-word targets need one word; sentences need half their words (any order) incl. a content word. */
export function scoreReading(target: string, heardText: string): ReadScore {
  const T = words(target), H = words(heardText);
  const used = new Array<boolean>(H.length).fill(false);
  const hit = T.map((t) => {
    let best = 0, bi = -1;
    H.forEach((h, i) => { if (used[i]) return; const s = wordMatch(t, h); if (s > best) { best = s; bi = i; } });
    if (bi >= 0 && best > 0) { used[bi] = true; return true; }
    return false;
  });
  const k = hit.filter(Boolean).length;
  const content = T.map((t) => !FUNC.has(t));
  const kc = hit.filter((h, i) => h && content[i]).length;
  const ok = T.length <= 2 ? k >= 1 : k / T.length >= 0.5 && (!content.some(Boolean) || kc >= 1);
  return { ok, hit, score: T.length ? k / T.length : 0, target: T, heard: H };
}
