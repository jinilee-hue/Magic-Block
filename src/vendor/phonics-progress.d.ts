// Types for phonics-progress.js (the kit's copy next to it; `import './phonics-progress.js'` sets window.PhonicsProgress).
export {};
declare global {
  interface PhonicsProgressRecord {
    plays: number; firstAt: string | null; lastAt: string | null; level: number | null; maxLevel: number | null;
    best: Record<string, number>; history: Record<string, unknown>[];
  }
  interface PhonicsProgressAPI {
    KEY: string;
    get(id: string): PhonicsProgressRecord;
    all(): Record<string, PhonicsProgressRecord>;
    played(id: string, result?: Record<string, number | boolean | string>, opts?: { higher?: string[]; lower?: string[] }): PhonicsProgressRecord;
    setLevel(id: string, level: number): PhonicsProgressRecord;
    reset(id?: string): void;
  }
  interface Window { PhonicsProgress: PhonicsProgressAPI }
}
