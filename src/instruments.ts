/** Instruments a part can name: a General MIDI program and the range the receipt checks notes against. */

export interface Instrument {
  name: string;
  program: number;
  lo: number;
  hi: number;
}

const TABLE: Array<[string, number, number, number, string[]]> = [
  ['piano', 0, 28, 103, ['grand piano', 'acoustic piano']],
  ['electric piano', 4, 36, 96, ['rhodes', 'ep']],
  ['harpsichord', 6, 36, 89, []],
  ['celesta', 8, 60, 108, []],
  ['glockenspiel', 9, 72, 108, ['bells']],
  ['music box', 10, 60, 96, []],
  ['vibraphone', 11, 53, 89, ['vibes']],
  ['marimba', 12, 45, 96, []],
  ['organ', 16, 36, 96, ['hammond']],
  ['accordion', 21, 53, 89, []],
  ['harmonica', 22, 60, 96, []],
  ['nylon guitar', 24, 40, 84, ['classical guitar', 'guitar']],
  ['steel guitar', 25, 40, 84, ['acoustic guitar']],
  ['jazz guitar', 26, 40, 84, []],
  ['clean guitar', 27, 40, 86, ['electric guitar']],
  ['overdrive guitar', 29, 40, 86, ['distortion guitar', 'rock guitar']],
  ['acoustic bass', 32, 28, 55, ['upright bass', 'double bass']],
  ['electric bass', 33, 28, 60, ['bass']],
  ['fretless bass', 35, 28, 60, []],
  ['synth bass', 38, 28, 60, []],
  ['violin', 40, 55, 100, []],
  ['viola', 41, 48, 88, []],
  ['cello', 42, 36, 76, []],
  ['pizzicato', 45, 36, 96, ['pizzicato strings']],
  ['harp', 46, 31, 100, []],
  ['strings', 48, 36, 96, ['string ensemble']],
  ['choir', 52, 48, 81, ['voices', 'aahs']],
  ['trumpet', 56, 55, 84, []],
  ['trombone', 57, 40, 72, []],
  ['french horn', 60, 41, 77, ['horn']],
  ['muted trumpet', 59, 55, 84, []],
  ['brass', 61, 40, 84, ['brass section']],
  ['soprano sax', 64, 56, 87, []],
  ['alto sax', 65, 49, 80, ['sax', 'saxophone']],
  ['tenor sax', 66, 44, 75, []],
  ['oboe', 68, 58, 91, []],
  ['clarinet', 71, 50, 91, []],
  ['piccolo', 72, 74, 108, []],
  ['flute', 73, 60, 96, []],
  ['recorder', 74, 60, 96, []],
  ['pan flute', 75, 60, 96, []],
  ['whistle', 78, 60, 96, []],
  ['ocarina', 79, 60, 91, []],
  ['synth lead', 80, 48, 96, ['square lead', 'lead']],
  ['saw lead', 81, 48, 96, []],
  ['synth pad', 89, 36, 96, ['warm pad', 'pad']],
  ['kalimba', 108, 48, 96, []],
  ['koto', 107, 43, 91, []],
  ['shakuhachi', 77, 55, 91, []],
  ['steel drums', 114, 52, 89, []],
];

export const INSTRUMENT_NAMES: string[] = TABLE.map((row) => row[0]);

const BY_NAME = new Map<string, Instrument>();
for (const [name, program, lo, hi, aliases] of TABLE) {
  const def = { name, program, lo, hi };
  for (const key of [name, ...aliases]) BY_NAME.set(key, def);
}

/** A name as written, without the quotes around it and with `_` and `-` read as spaces: `"synth_pad"` is synth pad. */
export const plainName = (name: string): string => name.trim().replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '').replace(/[_-]+/g, ' ').trim().toLowerCase();

/** A name from the table, or `gm 105`: any General MIDI program by its number 0–127 (no range is known for those). */
export function findInstrument(name: string): Instrument | null {
  const key = plainName(name);
  const numbered = /^(?:gm|program)\s*#?(\d{1,3})$/.exec(key);
  if (numbered && Number(numbered[1]) <= 127) return { name: `gm ${Number(numbered[1])}`, program: Number(numbered[1]), lo: 0, hi: 127 };
  return BY_NAME.get(key) ?? null;
}

/** The table's instrument on a General MIDI program, or the bare program when the table has none. */
export function instrumentOfProgram(program: number): Instrument {
  const row = TABLE.find((r) => r[1] === program);
  return row ? BY_NAME.get(row[0])! : { name: `gm ${program}`, program, lo: 0, hi: 127 };
}

/** Drum letters a `drums` part may use, one or several per slot (`KH` = kick and hi-hat together). A number 27–87 is that General MIDI percussion key. */
export const DRUM_LETTERS: Record<string, number> = {
  K: 36, S: 38, X: 37, H: 42, O: 46, P: 44, R: 51, C: 49, T: 45, L: 41, M: 70, B: 54, W: 76, Y: 39,
};
