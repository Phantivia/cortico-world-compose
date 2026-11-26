/** Instruments a part can name: a General MIDI program and the range the receipt checks notes against. */

export interface Instrument {
  name: string;
  program: number;
  lo: number;
  hi: number;
}

export type InstrumentCategory =
  | 'piano'
  | 'chromatic'
  | 'organ'
  | 'guitar'
  | 'bass'
  | 'strings'
  | 'ensemble'
  | 'brass'
  | 'reed'
  | 'pipe'
  | 'synth lead'
  | 'synth pad'
  | 'synth effects'
  | 'ethnic'
  | 'percussive'
  | 'sound effects'
  | 'drums';

export interface CatalogEntry extends Instrument {
  aliases: string[];
  category: InstrumentCategory;
  /** True for percussion and sound effects: 0–127 means "no musical range to check", not a real compass. */
  anyRange: boolean;
}

interface Row {
  name: string;
  program: number;
  lo: number;
  hi: number;
  aliases: string[];
}

// All 128 General MIDI programs, in program order. Programs 112–127 are percussion and sound effects;
// they get 0–127 because they have no single musical range, and the receipt should not invent one.
const TABLE: Row[] = [
  { name: 'piano', program: 0, lo: 28, hi: 103, aliases: ['grand piano', 'acoustic piano'] },
  { name: 'bright piano', program: 1, lo: 28, hi: 103, aliases: ['bright acoustic piano'] },
  { name: 'electric grand piano', program: 2, lo: 28, hi: 103, aliases: [] },
  { name: 'honky-tonk piano', program: 3, lo: 28, hi: 103, aliases: ['honky tonk'] },
  { name: 'electric piano', program: 4, lo: 36, hi: 96, aliases: ['rhodes', 'ep'] },
  { name: 'electric piano 2', program: 5, lo: 36, hi: 96, aliases: ['fm piano'] },
  { name: 'harpsichord', program: 6, lo: 36, hi: 89, aliases: [] },
  { name: 'clavinet', program: 7, lo: 36, hi: 96, aliases: ['clav'] },
  { name: 'celesta', program: 8, lo: 60, hi: 108, aliases: [] },
  { name: 'glockenspiel', program: 9, lo: 72, hi: 108, aliases: ['bells'] },
  { name: 'music box', program: 10, lo: 60, hi: 96, aliases: [] },
  { name: 'vibraphone', program: 11, lo: 53, hi: 89, aliases: ['vibes'] },
  { name: 'marimba', program: 12, lo: 45, hi: 96, aliases: [] },
  { name: 'xylophone', program: 13, lo: 72, hi: 108, aliases: ['xylo'] },
  { name: 'tubular bells', program: 14, lo: 60, hi: 96, aliases: ['chimes'] },
  { name: 'dulcimer', program: 15, lo: 48, hi: 96, aliases: ['hammered dulcimer'] },
  { name: 'organ', program: 16, lo: 36, hi: 96, aliases: ['hammond'] },
  { name: 'percussive organ', program: 17, lo: 36, hi: 96, aliases: ['percussion organ'] },
  { name: 'rock organ', program: 18, lo: 36, hi: 96, aliases: [] },
  { name: 'church organ', program: 19, lo: 36, hi: 96, aliases: ['pipe organ'] },
  { name: 'reed organ', program: 20, lo: 36, hi: 96, aliases: ['harmonium'] },
  { name: 'accordion', program: 21, lo: 53, hi: 89, aliases: [] },
  { name: 'harmonica', program: 22, lo: 60, hi: 96, aliases: ['mouth organ'] },
  { name: 'tango accordion', program: 23, lo: 53, hi: 89, aliases: ['bandoneon'] },
  { name: 'nylon guitar', program: 24, lo: 40, hi: 84, aliases: ['classical guitar', 'guitar'] },
  { name: 'steel guitar', program: 25, lo: 40, hi: 84, aliases: ['acoustic guitar'] },
  { name: 'jazz guitar', program: 26, lo: 40, hi: 84, aliases: ['electric guitar jazz'] },
  { name: 'clean guitar', program: 27, lo: 40, hi: 86, aliases: ['electric guitar'] },
  { name: 'muted guitar', program: 28, lo: 40, hi: 86, aliases: ['muted electric guitar', 'palm mute'] },
  { name: 'overdrive guitar', program: 29, lo: 40, hi: 86, aliases: ['rock guitar'] },
  { name: 'distortion guitar', program: 30, lo: 40, hi: 86, aliases: ['distorted guitar'] },
  { name: 'guitar harmonics', program: 31, lo: 40, hi: 86, aliases: ['harmonics'] },
  { name: 'acoustic bass', program: 32, lo: 28, hi: 55, aliases: ['upright bass', 'double bass'] },
  { name: 'electric bass', program: 33, lo: 28, hi: 60, aliases: ['bass'] },
  { name: 'pick bass', program: 34, lo: 28, hi: 60, aliases: ['electric bass pick', 'picked bass'] },
  { name: 'fretless bass', program: 35, lo: 28, hi: 60, aliases: [] },
  { name: 'slap bass 1', program: 36, lo: 28, hi: 60, aliases: ['slap bass'] },
  { name: 'slap bass 2', program: 37, lo: 28, hi: 60, aliases: [] },
  { name: 'synth bass', program: 38, lo: 28, hi: 60, aliases: ['synth bass 1'] },
  { name: 'synth bass 2', program: 39, lo: 28, hi: 60, aliases: [] },
  { name: 'violin', program: 40, lo: 55, hi: 100, aliases: [] },
  { name: 'viola', program: 41, lo: 48, hi: 88, aliases: [] },
  { name: 'cello', program: 42, lo: 36, hi: 76, aliases: [] },
  { name: 'contrabass', program: 43, lo: 28, hi: 55, aliases: ['string bass', 'upright string bass'] },
  { name: 'tremolo strings', program: 44, lo: 36, hi: 96, aliases: ['tremolo'] },
  { name: 'pizzicato', program: 45, lo: 36, hi: 96, aliases: ['pizzicato strings'] },
  { name: 'harp', program: 46, lo: 31, hi: 100, aliases: ['orchestral harp'] },
  { name: 'timpani', program: 47, lo: 36, hi: 60, aliases: ['kettledrum'] },
  { name: 'strings', program: 48, lo: 36, hi: 96, aliases: ['string ensemble'] },
  { name: 'string ensemble 2', program: 49, lo: 36, hi: 96, aliases: ['slow strings'] },
  { name: 'synth strings 1', program: 50, lo: 36, hi: 96, aliases: ['synth strings'] },
  { name: 'synth strings 2', program: 51, lo: 36, hi: 96, aliases: [] },
  { name: 'choir', program: 52, lo: 48, hi: 81, aliases: ['voices', 'aahs'] },
  { name: 'voice oohs', program: 53, lo: 48, hi: 81, aliases: ['oohs'] },
  { name: 'synth voice', program: 54, lo: 48, hi: 81, aliases: ['synth choir'] },
  { name: 'orchestra hit', program: 55, lo: 0, hi: 127, aliases: ['hit'] },
  { name: 'trumpet', program: 56, lo: 55, hi: 84, aliases: [] },
  { name: 'trombone', program: 57, lo: 40, hi: 72, aliases: [] },
  { name: 'tuba', program: 58, lo: 28, hi: 60, aliases: [] },
  { name: 'muted trumpet', program: 59, lo: 55, hi: 84, aliases: [] },
  { name: 'french horn', program: 60, lo: 41, hi: 77, aliases: ['horn'] },
  { name: 'brass', program: 61, lo: 40, hi: 84, aliases: ['brass section'] },
  { name: 'synth brass 1', program: 62, lo: 40, hi: 84, aliases: ['synth brass'] },
  { name: 'synth brass 2', program: 63, lo: 40, hi: 84, aliases: [] },
  { name: 'soprano sax', program: 64, lo: 56, hi: 87, aliases: [] },
  { name: 'alto sax', program: 65, lo: 49, hi: 80, aliases: ['sax', 'saxophone'] },
  { name: 'tenor sax', program: 66, lo: 44, hi: 75, aliases: [] },
  { name: 'baritone sax', program: 67, lo: 36, hi: 72, aliases: ['bari sax'] },
  { name: 'oboe', program: 68, lo: 58, hi: 91, aliases: [] },
  { name: 'english horn', program: 69, lo: 52, hi: 81, aliases: ['cor anglais'] },
  { name: 'bassoon', program: 70, lo: 34, hi: 72, aliases: [] },
  { name: 'clarinet', program: 71, lo: 50, hi: 91, aliases: [] },
  { name: 'piccolo', program: 72, lo: 74, hi: 108, aliases: [] },
  { name: 'flute', program: 73, lo: 60, hi: 96, aliases: [] },
  { name: 'recorder', program: 74, lo: 60, hi: 96, aliases: [] },
  { name: 'pan flute', program: 75, lo: 60, hi: 96, aliases: ['pan pipes'] },
  { name: 'blown bottle', program: 76, lo: 60, hi: 96, aliases: [] },
  { name: 'shakuhachi', program: 77, lo: 55, hi: 91, aliases: [] },
  { name: 'whistle', program: 78, lo: 60, hi: 96, aliases: [] },
  { name: 'ocarina', program: 79, lo: 60, hi: 91, aliases: [] },
  { name: 'synth lead', program: 80, lo: 48, hi: 96, aliases: ['square lead', 'lead'] },
  { name: 'saw lead', program: 81, lo: 48, hi: 96, aliases: ['sawtooth lead'] },
  { name: 'calliope lead', program: 82, lo: 48, hi: 96, aliases: ['calliope'] },
  { name: 'chiff lead', program: 83, lo: 48, hi: 96, aliases: ['chiff'] },
  { name: 'charang lead', program: 84, lo: 48, hi: 96, aliases: ['charang'] },
  { name: 'voice lead', program: 85, lo: 48, hi: 96, aliases: ['synth voice lead'] },
  { name: 'fifths lead', program: 86, lo: 48, hi: 96, aliases: ['fifths'] },
  { name: 'bass lead', program: 87, lo: 36, hi: 84, aliases: ['bass + lead', 'bass and lead'] },
  { name: 'new age pad', program: 88, lo: 36, hi: 96, aliases: ['pad 1 (new age)'] },
  { name: 'synth pad', program: 89, lo: 36, hi: 96, aliases: ['warm pad', 'pad'] },
  { name: 'polysynth pad', program: 90, lo: 36, hi: 96, aliases: ['polysynth'] },
  { name: 'choir pad', program: 91, lo: 36, hi: 96, aliases: ['pad 4 (choir)'] },
  { name: 'bowed pad', program: 92, lo: 36, hi: 96, aliases: ['bowed'] },
  { name: 'metallic pad', program: 93, lo: 36, hi: 96, aliases: ['metallic'] },
  { name: 'halo pad', program: 94, lo: 36, hi: 96, aliases: ['halo'] },
  { name: 'sweep pad', program: 95, lo: 36, hi: 96, aliases: ['sweep'] },
  { name: 'rain fx', program: 96, lo: 0, hi: 127, aliases: ['rain', 'fx 1 (rain)'] },
  { name: 'soundtrack fx', program: 97, lo: 0, hi: 127, aliases: ['soundtrack', 'fx 2 (soundtrack)'] },
  { name: 'crystal fx', program: 98, lo: 0, hi: 127, aliases: ['crystal', 'fx 3 (crystal)'] },
  { name: 'atmosphere fx', program: 99, lo: 0, hi: 127, aliases: ['atmosphere', 'fx 4 (atmosphere)'] },
  { name: 'brightness fx', program: 100, lo: 0, hi: 127, aliases: ['brightness', 'fx 5 (brightness)'] },
  { name: 'goblins fx', program: 101, lo: 0, hi: 127, aliases: ['goblins', 'fx 6 (goblins)'] },
  { name: 'echoes fx', program: 102, lo: 0, hi: 127, aliases: ['echoes', 'fx 7 (echoes)'] },
  { name: 'sci-fi fx', program: 103, lo: 0, hi: 127, aliases: ['sci fi', 'scifi', 'fx 8 (sci-fi)'] },
  { name: 'sitar', program: 104, lo: 48, hi: 84, aliases: [] },
  { name: 'banjo', program: 105, lo: 48, hi: 84, aliases: [] },
  { name: 'shamisen', program: 106, lo: 48, hi: 84, aliases: [] },
  { name: 'koto', program: 107, lo: 43, hi: 91, aliases: [] },
  { name: 'kalimba', program: 108, lo: 48, hi: 96, aliases: [] },
  { name: 'bag pipe', program: 109, lo: 55, hi: 84, aliases: ['bagpipe', 'bagpipes'] },
  { name: 'fiddle', program: 110, lo: 55, hi: 100, aliases: [] },
  { name: 'shanai', program: 111, lo: 60, hi: 96, aliases: ['shehnai'] },
  { name: 'tinkle bell', program: 112, lo: 72, hi: 108, aliases: ['tinkle bells'] },
  { name: 'agogo', program: 113, lo: 60, hi: 96, aliases: ['agogo bells'] },
  { name: 'steel drums', program: 114, lo: 52, hi: 89, aliases: ['steel drum'] },
  { name: 'woodblock', program: 115, lo: 36, hi: 84, aliases: ['wood block'] },
  { name: 'taiko drum', program: 116, lo: 36, hi: 60, aliases: ['taiko'] },
  { name: 'melodic tom', program: 117, lo: 36, hi: 60, aliases: ['tom'] },
  { name: 'synth drum', program: 118, lo: 36, hi: 60, aliases: [] },
  { name: 'reverse cymbal', program: 119, lo: 0, hi: 127, aliases: ['rev cymbal'] },
  { name: 'guitar fret noise', program: 120, lo: 0, hi: 127, aliases: ['fret noise'] },
  { name: 'breath noise', program: 121, lo: 0, hi: 127, aliases: ['breath'] },
  { name: 'seashore', program: 122, lo: 0, hi: 127, aliases: ['sea shore', 'waves'] },
  { name: 'bird tweet', program: 123, lo: 0, hi: 127, aliases: ['birds'] },
  { name: 'telephone ring', program: 124, lo: 0, hi: 127, aliases: ['phone ring'] },
  { name: 'helicopter', program: 125, lo: 0, hi: 127, aliases: [] },
  { name: 'applause', program: 126, lo: 0, hi: 127, aliases: ['clapping'] },
  { name: 'gunshot', program: 127, lo: 0, hi: 127, aliases: ['gun shot'] },
];

export const INSTRUMENT_NAMES: string[] = TABLE.map((row) => row.name);

/** The common names kept in the tool descriptions; the full list is read with compose_instruments. */
export const COMMON_INSTRUMENT_NAMES: string[] = [
  'piano', 'electric piano', 'organ', 'nylon guitar', 'electric bass', 'violin',
  'cello', 'strings', 'trumpet', 'alto sax', 'flute', 'synth pad',
];

export const INSTRUMENT_CATEGORIES: InstrumentCategory[] = [
  'piano', 'chromatic', 'organ', 'guitar', 'bass', 'strings', 'ensemble', 'brass', 'reed',
  'pipe', 'synth lead', 'synth pad', 'synth effects', 'ethnic', 'percussive', 'sound effects', 'drums',
];

const CATEGORY_ALIASES: Record<string, InstrumentCategory> = {
  keys: 'piano', keyboard: 'piano', keyboards: 'piano', pianos: 'piano',
  'chromatic percussion': 'chromatic',
  organs: 'organ',
  guitars: 'guitar',
  basses: 'bass',
  string: 'strings',
  ensembles: 'ensemble',
  'synth brass': 'brass',
  reeds: 'reed',
  pipes: 'pipe',
  lead: 'synth lead', leads: 'synth lead', 'synth leads': 'synth lead',
  pad: 'synth pad', pads: 'synth pad', 'synth pads': 'synth pad',
  fx: 'synth effects', effects: 'synth effects', 'synth fx': 'synth effects',
  'synth effect': 'synth effects',
  percussions: 'percussive', percussion: 'percussive',
  sfx: 'sound effects', 'sound effect': 'sound effects', 'sound fx': 'sound effects',
  drum: 'drums', kit: 'drums', 'drum kit': 'drums', percussionkit: 'drums',
};

/** A name as written, without the quotes around it and with `_` and `-` read as spaces: `"synth_pad"` is synth pad. */
export const plainName = (name: string): string => name.trim().replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '').replace(/[_-]+/g, ' ').trim().toLowerCase();

export function categoryOfProgram(program: number): InstrumentCategory {
  if (program <= 7) return 'piano';
  if (program <= 15) return 'chromatic';
  if (program <= 23) return 'organ';
  if (program <= 31) return 'guitar';
  if (program <= 39) return 'bass';
  if (program <= 47) return 'strings';
  if (program <= 55) return 'ensemble';
  if (program <= 63) return 'brass';
  if (program <= 71) return 'reed';
  if (program <= 79) return 'pipe';
  if (program <= 87) return 'synth lead';
  if (program <= 95) return 'synth pad';
  if (program <= 103) return 'synth effects';
  if (program <= 111) return 'ethnic';
  if (program <= 119) return 'percussive';
  return 'sound effects';
}

/** The canonical table rows plus aliases, for the catalog tool. `program` is null only for the drum kit. */
export const INSTRUMENT_CATALOG: CatalogEntry[] = TABLE.map((row) => ({
  name: row.name,
  program: row.program,
  lo: row.lo,
  hi: row.hi,
  aliases: row.aliases,
  category: categoryOfProgram(row.program),
  anyRange: row.lo === 0 && row.hi === 127,
}));

const DRUM_KIT: CatalogEntry = {
  name: 'drums',
  program: -1,
  lo: 27,
  hi: 87,
  aliases: ['drum kit', 'kit', 'percussion'],
  category: 'drums',
  anyRange: false,
};

const BY_NAME = new Map<string, Instrument>();
const SEEN_NAMES = new Set<string>();
for (const row of TABLE) {
  const def = { name: row.name, program: row.program, lo: row.lo, hi: row.hi };
  for (const key of [row.name, ...row.aliases]) {
    const normalized = plainName(key);
    if (SEEN_NAMES.has(normalized)) throw new Error(`duplicate instrument name: ${key}`);
    SEEN_NAMES.add(normalized);
    BY_NAME.set(normalized, def);
  }
}

/** A name from the table, or `gm 105`: any General MIDI program by its number 0–127 (no range is known for those). */
export function findInstrument(name: string): Instrument | null {
  const key = plainName(name);
  const numbered = /^(?:gm|program)\s*#?(\d{1,3})$/.exec(key);
  if (numbered && Number(numbered[1]) <= 127) return { name: `gm ${Number(numbered[1])}`, program: Number(numbered[1]), lo: 0, hi: 127 };
  return BY_NAME.get(key) ?? null;
}

/** The table's instrument on a General MIDI program, or the bare program when the table has none. */
export function instrumentOfProgram(program: number): Instrument {
  const row = TABLE.find((r) => r.program === program);
  return row ? { name: row.name, program: row.program, lo: row.lo, hi: row.hi } : { name: `gm ${program}`, program, lo: 0, hi: 127 };
}

/** `undefined` when the text is not a category name; `drums` is kept apart from the program families. */
export function parseCategory(text: string): InstrumentCategory | null {
  const key = plainName(text);
  if ((INSTRUMENT_CATEGORIES as string[]).includes(key)) return key as InstrumentCategory;
  return CATEGORY_ALIASES[key] ?? null;
}

export interface CatalogFilter {
  category?: string;
  query?: string;
  program?: number;
}

/** All matching entries, in program order, with the drum kit last. No cap: the tool caps what it prints. */
export function catalogEntries(filter: CatalogFilter): CatalogEntry[] {
  const category = filter.category === undefined ? null : parseCategory(filter.category);
  const query = filter.query === undefined ? '' : plainName(filter.query);
  return [...INSTRUMENT_CATALOG, DRUM_KIT].filter((entry) => {
    if (filter.program !== undefined && entry.program !== filter.program) return false;
    if (category !== null && entry.category !== category) return false;
    if (query !== '' && !plainName(entry.name).includes(query) && !entry.aliases.some((alias) => plainName(alias).includes(query))) return false;
    return true;
  });
}

/** Drum letters a `drums` part may use, one or several per slot (`KH` = kick and hi-hat together). A number 27–87 is that General MIDI percussion key. */
export const DRUM_LETTERS: Record<string, number> = {
  K: 36, S: 38, X: 37, H: 42, O: 46, P: 44, R: 51, C: 49, T: 45, L: 41, M: 70, B: 54, W: 76, Y: 39,
};
