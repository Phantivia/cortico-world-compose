/** Pitch names, keys and chord symbols. Pitches are MIDI numbers (C4 = 60), pitch classes 0–11. */

const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** `F#5`, `Bb3`, `C4`; null when the token is not a pitch. */
export function parsePitch(token: string): number | null {
  const m = /^([A-Ga-g])([#b]{0,2})(-?\d)$/.exec(token);
  if (!m) return null;
  let pc = LETTER[m[1].toUpperCase()];
  for (const c of m[2]) pc += c === '#' ? 1 : -1;
  return pc + 12 * (Number(m[3]) + 1);
}

function parsePitchClass(text: string): number | null {
  const m = /^([A-G])([#b]?)$/.exec(text);
  if (!m) return null;
  return (LETTER[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
}

export function pitchName(midi: number, flats = false): string {
  return `${(flats ? FLAT_NAMES : SHARP_NAMES)[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

export function pitchClassName(pc: number, flats = false): string {
  return (flats ? FLAT_NAMES : SHARP_NAMES)[((pc % 12) + 12) % 12];
}

export interface Key {
  tonic: number;
  /** Pitch classes of the seven scale degrees, ascending from the tonic. */
  scale: number[];
  flats: boolean;
  label: string;
}

const MODES: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
};

/** `D major`, `B minor`, `F# dorian`, also `Dm` and `D`. */
export function parseKey(text: string): Key {
  const m = /^\s*([A-G][#b]?)\s*(m|min|minor|maj|major|dorian|mixolydian|lydian|phrygian)?\s*$/i.exec(text);
  const tonic = m ? parsePitchClass(m[1][0].toUpperCase() + m[1].slice(1)) : null;
  if (!m || tonic === null) throw new Error(`key "${text}" is not readable; write it like "D major" or "B minor"`);
  const word = (m[2] ?? 'major').toLowerCase();
  const mode = word === 'm' || word === 'min' ? 'minor' : word === 'maj' ? 'major' : word;
  const flats = m[1].includes('b') || (mode !== 'major' && [0, 2, 5, 7, 10].includes(tonic)) || (mode === 'major' && tonic === 5);
  return { tonic, scale: MODES[mode].map((s) => (tonic + s) % 12), flats, label: `${m[1][0].toUpperCase()}${m[1].slice(1)} ${mode}` };
}

/** Moves a pitch by scale steps of the key; a note outside the scale keeps its distance above the degree below it. */
export function diatonicShift(pitch: number, steps: number, key: Key): number {
  const rel = (((pitch - key.tonic) % 12) + 12) % 12;
  const offsets = key.scale.map((pc) => (((pc - key.tonic) % 12) + 12) % 12);
  let degree = 0;
  for (let i = 0; i < 7; i++) if (offsets[i] <= rel) degree = i;
  const extra = rel - offsets[degree];
  const base = pitch - rel;
  const target = degree + steps;
  const octave = Math.floor(target / 7);
  return base + 12 * octave + offsets[((target % 7) + 7) % 7] + extra;
}

export interface Chord {
  symbol: string;
  root: number;
  bass: number;
  /** Semitones above the root: third (absent in sus chords), fifth, seventh or sixth, then extensions. */
  third: number | null;
  fifth: number;
  seventh: number | null;
  extensions: number[];
  /** Every pitch class the symbol names. */
  pcs: number[];
}

const QUALITY_TOKEN = /^(sus4|sus2|sus|add9|add11|add13|add2|add4|6\/9|69|maj|M(?=7|9|11|13)|13|11|9|7|6|5|b5|#5|\+5|-5|b9|#9|#11|#4|b13|alt|[()\s,])/;

/** Reads a chord symbol: `Dmaj9`, `F#m7b5`, `A13`, `Bb7#11`, `Csus4`, `G/B`, `Edim7`, `C6/9`, `AmMaj7`. */
export function parseChord(symbol: string): Chord {
  const head = /^([A-G][#b]?)(.*)$/.exec(symbol.trim());
  const root = head ? parsePitchClass(head[1]) : null;
  if (!head || root === null) throw new Error(`chord "${symbol}" must start with a note name A–G`);
  let rest = head[2];
  let bass = root;
  const slash = /\/([A-G][#b]?)$/.exec(rest);
  if (slash) {
    bass = parsePitchClass(slash[1])!;
    rest = rest.slice(0, slash.index);
  }
  let third: number | null = 4;
  let fifth = 7;
  let seventh: number | null = null;
  let major7 = false;
  let diminished = false;
  const ext = new Set<number>();
  const lead = /^(maj|Maj|MAJ|M(?![a-z])|Δ|min|m(?!aj)|-|dim|°|o(?=7|$)|aug|\+|ø)/.exec(rest);
  if (lead) {
    const q = lead[1];
    if (/^(maj|Maj|MAJ|M|Δ)$/.test(q)) major7 = true;
    else if (q === 'min' || q === 'm' || q === '-') third = 3;
    else if (q === 'dim' || q === '°' || q === 'o') { third = 3; fifth = 6; diminished = true; }
    else if (q === 'aug' || q === '+') fifth = 8;
    else if (q === 'ø') { third = 3; fifth = 6; seventh = 10; }
    rest = rest.slice(q.length);
  }
  const seventhOf = () => (major7 ? 11 : diminished ? 9 : 10);
  while (rest.length > 0) {
    const m = QUALITY_TOKEN.exec(rest);
    if (!m) throw new Error(`chord "${symbol}": could not read "${rest}"`);
    const t = m[1];
    rest = rest.slice(t.length);
    if (t === '7') seventh = seventhOf();
    else if (t === '9') { seventh ??= seventhOf(); ext.add(2); }
    else if (t === '11') { seventh ??= seventhOf(); ext.add(2); ext.add(5); if (third === 4) third = null; }
    else if (t === '13') { seventh ??= seventhOf(); ext.add(2); ext.add(9); }
    else if (t === '6') ext.add(9);
    else if (t === '6/9' || t === '69') { ext.add(9); ext.add(2); }
    else if (t === 'maj' || t === 'M') major7 = true;
    else if (t === 'sus4' || t === 'sus') { third = null; ext.add(5); }
    else if (t === 'sus2') { third = null; ext.add(2); }
    else if (t === 'add9' || t === 'add2') ext.add(2);
    else if (t === 'add11' || t === 'add4') ext.add(5);
    else if (t === 'add13') ext.add(9);
    else if (t === 'b5' || t === '-5') fifth = 6;
    else if (t === '#5' || t === '+5') fifth = 8;
    else if (t === 'b9') ext.add(1);
    else if (t === '#9') ext.add(3);
    else if (t === '#11' || t === '#4') ext.add(6);
    else if (t === 'b13') ext.add(8);
    else if (t === 'alt') { ext.add(1); ext.add(3); ext.add(8); }
  }
  if (major7 && seventh !== null) seventh = 11;
  if (major7 && seventh === null && ext.size > 0 && (ext.has(2) || ext.has(9))) seventh = head[2].includes('6') ? null : 11;
  const extensions = [...ext].filter((e) => e !== third && e !== fifth);
  const intervals = [0, ...(third === null ? [] : [third]), fifth, ...(seventh === null ? [] : [seventh]), ...extensions];
  return { symbol: symbol.trim(), root, bass, third, fifth, seventh, extensions, pcs: [...new Set(intervals.map((i) => (root + i) % 12))] };
}

/** Three or four notes for a comping hand: third and seventh first, then colour, placed nearest `around`. */
export function voiceChord(chord: Chord, around: number): number[] {
  const wanted: number[] = [];
  if (chord.third !== null) wanted.push(chord.third);
  if (chord.seventh !== null) wanted.push(chord.seventh);
  for (const e of chord.extensions) if (wanted.length < 4) wanted.push(e);
  if (wanted.length < 4) wanted.push(chord.fifth);
  if (wanted.length < 3) wanted.push(0);
  const notes = [...new Set(wanted.map((i) => (chord.root + i) % 12))].map((pc) => {
    let n = around - (((around - pc) % 12) + 12) % 12;
    if (around - n > 6) n += 12;
    return Math.min(74, Math.max(50, n));
  });
  return [...new Set(notes)].sort((a, b) => a - b);
}

/** The pitch of class `pc` nearest `around`, kept inside [lo, hi]. */
export function nearest(pc: number, around: number, lo: number, hi: number): number {
  let n = around - (((around - pc) % 12) + 12) % 12;
  if (around - n > 6) n += 12;
  while (n < lo) n += 12;
  while (n > hi) n -= 12;
  return n;
}
