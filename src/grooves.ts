/**
 * Accompaniment patterns. A groove gives the band's part for two alternating bars on a fixed grid, in three
 * densities chosen by the section's energy (1–2 low, 3 mid, 4–5 high); a drum layer joins at its `min` energy.
 *
 * Comp: `x` chord, `X` accented, `o` soft, `1`–`4` one note of the chord (low to high), `-` hold, `.` rest.
 * Bass: `R` root, `5` fifth, `8` root an octave up, `3` third, `a` a semitone under the next bar's root.
 * Drums: `X` loud, `x` normal, `o` soft.
 */

export interface DrumLayer { note: number; a: string; b?: string; min: number }
export interface Groove {
  summary: string;
  /** Slots per bar; 1 means one bar-long slot, valid in any meter. */
  grid: number;
  beats: 3 | 4 | 0;
  /** Where the off-beat falls inside each `swingUnit` beats, 0.5 = straight. */
  swing?: number;
  swingUnit?: number;
  comp: string;
  bass: string;
  compPatterns: { lo: string[]; mid: string[]; hi: string[] };
  bassPatterns: { lo: string[]; mid: string[] };
  drums: DrumLayer[];
  /** Scales every velocity of the band. */
  touch?: number;
}

const KICK = 36, RIM = 37, SNARE = 38, CLAP = 39, HAT = 42, PEDAL = 44, OPEN = 46, RIDE = 51, TAMB = 54, MARACA = 70;

export const GROOVES: Record<string, Groove> = {
  pop: {
    summary: 'straight eighths: piano chords, electric bass, backbeat',
    grid: 8, beats: 4, comp: 'piano', bass: 'electric bass',
    compPatterns: { lo: ['x-------'], mid: ['x.x.x.x.', 'x.x.x.xo'], hi: ['x.xxx.xx', 'x.xxx.xx'] },
    bassPatterns: { lo: ['R-------'], mid: ['R--RR-5-', 'R--RR-a-'] },
    drums: [
      { note: HAT, a: 'xoxoxoxo', min: 2 }, { note: KICK, a: 'X...X...', b: 'X..xX...', min: 2 },
      { note: SNARE, a: '..X...X.', min: 3 }, { note: OPEN, a: '........', b: '.......o', min: 4 }, { note: TAMB, a: 'oooooooo', min: 5 },
    ],
  },
  rock: {
    summary: 'driving eighths: overdriven guitar, electric bass, loud backbeat',
    grid: 8, beats: 4, comp: 'overdrive guitar', bass: 'electric bass',
    compPatterns: { lo: ['x-------'], mid: ['X.x.X.x.'], hi: ['XxXxXxXx'] },
    bassPatterns: { lo: ['R-------'], mid: ['RRRRRRRR', 'RRRRRR5a'] },
    drums: [
      { note: HAT, a: 'XxXxXxXx', min: 2 }, { note: KICK, a: 'X..xX...', b: 'X..xX.x.', min: 2 },
      { note: SNARE, a: '..X...X.', min: 2 }, { note: OPEN, a: '........', b: '.......x', min: 4 },
    ],
  },
  ballad: {
    summary: 'slow and open: piano broken chords, soft bass, cross-stick',
    grid: 8, beats: 4, comp: 'piano', bass: 'acoustic bass',
    compPatterns: { lo: ['x-------'], mid: ['1-2-3-4-', '1-2-3-2-'], hi: ['12343234'] },
    bassPatterns: { lo: ['R-------'], mid: ['R-----5-', 'R-----a-'] },
    drums: [
      { note: RIM, a: '....x...', min: 3 }, { note: KICK, a: 'X.......', b: 'X....x..', min: 3 }, { note: HAT, a: 'o.o.o.o.', min: 4 },
    ],
  },
  bossa: {
    summary: 'bossa nova: nylon guitar comping, acoustic bass, rim-click clave',
    grid: 8, beats: 4, comp: 'nylon guitar', bass: 'acoustic bass',
    compPatterns: { lo: ['x-...x-.', '..x-....'], mid: ['x..x..x.', '..x..x..'], hi: ['x..x..x.', '.x..x..x'] },
    bassPatterns: { lo: ['R---5---'], mid: ['R--55--R', 'R--55--a'] },
    drums: [
      { note: HAT, a: 'XoxoXoxo', min: 2 }, { note: RIM, a: 'x..x..x.', b: '..x.x...', min: 3 },
      { note: KICK, a: 'x..ox..o', min: 3 }, { note: MARACA, a: 'oooooooo', min: 5 },
    ],
  },
  samba: {
    summary: 'fast samba in sixteenths: nylon guitar, busy percussion',
    grid: 16, beats: 4, comp: 'nylon guitar', bass: 'acoustic bass',
    compPatterns: { lo: ['x-----..x-----..'], mid: ['x..x..x...x.x...', '..x..x..x..x..x.'], hi: ['x..x..x...x.x...', '..x..x..x..x..x.'] },
    bassPatterns: { lo: ['R-------5-------'], mid: ['R--.5-..R--.5-..', 'R--.5-..R--.5-a.'] },
    drums: [
      { note: HAT, a: 'XoxoXoxoXoxoXoxo', min: 2 }, { note: KICK, a: 'X..xX..xX..xX..x', min: 3 },
      { note: RIM, a: 'x..x..x...x.x...', b: '..x.x...x..x..x.', min: 3 }, { note: TAMB, a: 'x.xxx.xxx.xxx.xx', min: 4 },
    ],
  },
  swing: {
    summary: 'jazz swing: walking bass, ride cymbal, piano stabs; eighths are swung',
    grid: 8, beats: 4, swing: 0.66, swingUnit: 1, comp: 'piano', bass: 'acoustic bass',
    compPatterns: { lo: ['x-------'], mid: ['x..x....', '...x..x.'], hi: ['x..x...x', '..x..x..'] },
    bassPatterns: { lo: ['R---5---'], mid: ['R.3.5.a.', 'R.5.3.a.'] },
    drums: [
      { note: RIDE, a: 'X.XxX.Xx', min: 2 }, { note: PEDAL, a: '..x...x.', min: 2 },
      { note: KICK, a: 'o...o...', min: 4 }, { note: SNARE, a: '...o....', b: '.......o', min: 4 },
    ],
  },
  waltz: {
    summary: 'three-four: bass on one, chords on two and three',
    grid: 6, beats: 3, comp: 'piano', bass: 'acoustic bass',
    compPatterns: { lo: ['x-----'], mid: ['..x.x.'], hi: ['..x.x.', '..xxx.'] },
    bassPatterns: { lo: ['R-----'], mid: ['R-....', '5-....'] },
    drums: [{ note: HAT, a: '..o.o.', min: 3 }, { note: KICK, a: 'x.....', min: 3 }],
  },
  funk: {
    summary: 'sixteenth-note funk: clean guitar chops, syncopated electric bass',
    grid: 16, beats: 4, comp: 'clean guitar', bass: 'electric bass',
    compPatterns: { lo: ['x---....x---....'], mid: ['..x.x..x.x..x.x.', '..x.x..x.x.x..x.'], hi: ['..x.x..x.x..x.x.', '..x.x..x.x.x..x.'] },
    bassPatterns: { lo: ['R-------R---5---'], mid: ['R..R.8.R..R.5.a.', 'R..R.8.R.3.5.a..'] },
    drums: [
      { note: HAT, a: 'xoxoxoxoxoxoxoxo', min: 2 }, { note: KICK, a: 'X..x..X...x.X...', min: 2 },
      { note: SNARE, a: '....X..o.o..X..o', min: 3 }, { note: OPEN, a: '................', b: '..............x.', min: 4 },
    ],
  },
  lofi: {
    summary: 'laid-back hip-hop beat: electric piano chords, soft kick and snare, lazy sixteenths',
    grid: 16, beats: 4, swing: 0.57, swingUnit: 0.5, comp: 'electric piano', bass: 'electric bass', touch: 0.85,
    compPatterns: { lo: ['x---------------'], mid: ['x---------------', 'x-------x-------'], hi: ['x-----x---------', 'x-------x---x---'] },
    bassPatterns: { lo: ['R---------------'], mid: ['R-----..R---5-..', 'R-----..R--.a-..'] },
    drums: [
      { note: KICK, a: 'X.....x...X.....', b: 'X.....x..xX.....', min: 2 }, { note: RIM, a: '....X.......X...', min: 2 },
      { note: HAT, a: 'o.o.o.o.o.o.o.o.', min: 3 }, { note: OPEN, a: '................', b: '..............o.', min: 5 },
    ],
  },
  dance: {
    summary: 'four-on-the-floor: kick on every beat, off-beat bass and hats, synth chords',
    grid: 16, beats: 4, comp: 'synth pad', bass: 'synth bass',
    compPatterns: { lo: ['x---------------'], mid: ['x..x..x.x..x..x.'], hi: ['x.xx.xx.x.xx.xx.'] },
    bassPatterns: { lo: ['R-------R-------'], mid: ['..R...R...R...R.', '..R...R...R...a.'] },
    drums: [
      { note: KICK, a: 'X...X...X...X...', min: 2 }, { note: OPEN, a: '..x...x...x...x.', min: 3 },
      { note: CLAP, a: '....X.......X...', min: 3 }, { note: HAT, a: 'o.o.o.o.o.o.o.o.', min: 4 },
    ],
  },
  ambient: {
    summary: 'no beat: one sustained string chord and a bass note per bar',
    grid: 1, beats: 0, comp: 'strings', bass: 'cello', touch: 0.8,
    compPatterns: { lo: ['x'], mid: ['x'], hi: ['x'] },
    bassPatterns: { lo: ['R'], mid: ['R'] },
    drums: [],
  },
};

export const GROOVE_NAMES: string[] = [...Object.keys(GROOVES), 'none'];
