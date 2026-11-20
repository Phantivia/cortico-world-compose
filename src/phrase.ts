/**
 * Phrases: a bar or a few, kept in a notebook beside the songs. Coo writes one to try an idea out; a person
 * plays one on the panel's keyboard (a take). Either can be heard at once and used in a song as "@name".
 */
import type { Arrangement } from './arrange.ts';
import { findInstrument } from './instruments.ts';
import { parseMeter } from './sheet.ts';
import { pitchName } from './theory.ts';

type Raw = Record<string, unknown>;

/** A motif's name in a line: what "@name" can spell. */
export const PHRASE_NAME = /^[A-Za-z0-9_]+$/;

/** One played note: seconds from the start of the take, seconds held, MIDI pitch. */
export type TakeNote = [at: number, len: number, pitch: number];

/** What the keyboard recorded. `tempo` is the metronome's when it was on; without it the take has no bars. */
export interface Take { notes: TakeNote[]; tempo: number | null; meter: string }

/** What a phrase's .json file holds: the fields Coo wrote, `{abc}`, or a take with the lines read from it. */
export type StoredPhrase = Raw & { name: string; take?: Take; lines?: string[] };

const TAKE_INSTRUMENT = 'piano';
const TAKE_VELOCITY = 84;
const LEAD_IN = 0.3;
const RING_OUT = 1.5;
/** Slots per quarter note when a take is written as lines: sixteenths. */
const GRID = 4;

/** Checks what the panel sent and puts the notes in order. Returns null for anything that is not a take. */
export function readTake(given: unknown): Take | null {
  if (!given || typeof given !== 'object') return null;
  const raw = given as Raw;
  if (!Array.isArray(raw.notes)) return null;
  const notes: TakeNote[] = [];
  for (const n of raw.notes) {
    if (!Array.isArray(n) || n.length < 3 || !n.slice(0, 3).every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
    const [at, len, pitch] = n as number[];
    if (pitch < 0 || pitch > 127 || len <= 0) return null;
    notes.push([Math.max(0, at), len, Math.round(pitch)]);
  }
  notes.sort((a, b) => a[0] - b[0] || b[2] - a[2]);
  const tempo = typeof raw.tempo === 'number' && raw.tempo >= 30 && raw.tempo <= 300 ? raw.tempo : null;
  const meter = typeof raw.meter === 'string' && parseMeter(raw.meter) ? parseMeter(raw.meter)!.label : '4/4';
  return { notes, tempo, meter };
}

/**
 * A take played to the metronome, written as lines with every note moved to the nearest sixteenth. Notes that
 * overlap without starting and ending together go to a second line, and so on. Null for a take without tempo.
 */
export function takeLines(take: Take): string[] | null {
  if (take.tempo === null || take.notes.length === 0) return null;
  const slotSeconds = 60 / take.tempo / GRID;
  const perBar = Math.round(parseMeter(take.meter)!.beats * GRID);
  interface Cell { from: number; to: number; pitches: number[] }
  const voices: Cell[][] = [];
  for (const [at, len, pitch] of take.notes) {
    const from = Math.round(at / slotSeconds), to = Math.max(from + 1, Math.round((at + len) / slotSeconds));
    let placed = false;
    for (const voice of voices) {
      const last = voice[voice.length - 1];
      if (last.from === from && last.to === to) { if (!last.pitches.includes(pitch)) last.pitches.push(pitch); placed = true; break; }
      if (last.to <= from) { voice.push({ from, to, pitches: [pitch] }); placed = true; break; }
    }
    if (!placed) voices.push([{ from, to, pitches: [pitch] }]);
  }
  const bars = Math.max(1, Math.ceil(Math.max(...voices.map((v) => v[v.length - 1].to)) / perBar));
  return voices.map((voice) => {
    const slots = new Array<string>(bars * perBar).fill('.');
    for (const cell of voice) {
      slots[cell.from] = cell.pitches.sort((a, b) => a - b).map((p) => pitchName(p)).join('+');
      for (let s = cell.from + 1; s < Math.min(cell.to, slots.length); s++) slots[s] = '-';
    }
    const out: string[] = [];
    for (let b = 0; b < bars; b++) {
      let bar = slots.slice(b * perBar, (b + 1) * perBar);
      // a bar whose notes all sit on a coarser grid is written on that grid
      while (bar.length % 2 === 0 && bar.every((slot, i) => i % 2 === 0 || slot === (bar[i - 1] === '.' ? '.' : '-'))) bar = bar.filter((_, i) => i % 2 === 0);
      out.push(bar.join(' '));
    }
    return out.join(' | ');
  });
}

/** The take as it was played: its own timing, nothing moved. */
export function takeArrangement(take: Take): Arrangement {
  const end = Math.max(0, ...take.notes.map(([at, len]) => at + len));
  const barTimes = [LEAD_IN];
  if (take.tempo !== null) {
    const bar = parseMeter(take.meter)!.beats * 60 / take.tempo;
    while (barTimes[barTimes.length - 1] - LEAD_IN < end - 1e-6) barTimes.push(barTimes[barTimes.length - 1] + bar);
  } else {
    barTimes.push(LEAD_IN + end);
  }
  return {
    tracks: [{
      name: TAKE_INSTRUMENT, role: 'lead', instrument: findInstrument(TAKE_INSTRUMENT),
      notes: take.notes.map(([at, len, pitch]) => ({ at: LEAD_IN + at, until: LEAD_IN + at + len, pitch, velocity: TAKE_VELOCITY })),
    }],
    seconds: LEAD_IN + end + RING_OUT, leadIn: LEAD_IN, barTimes,
  };
}

/** The sheet a phrase is read and rendered as: one section, no band unless a groove was asked for. */
export function phraseSheet(stored: StoredPhrase): Raw {
  if (typeof stored.abc === 'string') return { abc: stored.abc };
  if (stored.take) {
    const [melody, ...more] = stored.lines ?? [];
    return {
      title: stored.name, tempo: stored.take.tempo ?? 120, meter: stored.take.meter, lead: TAKE_INSTRUMENT,
      sections: [{ name: stored.name, groove: 'none', melody, parts: Object.fromEntries(more.map((line, i) => [`${TAKE_INSTRUMENT}:${i + 2}`, line])) }],
    };
  }
  return {
    title: stored.name, tempo: stored.tempo, key: stored.key, meter: stored.meter, lead: stored.instrument ?? TAKE_INSTRUMENT,
    sections: [{ name: stored.name, groove: stored.groove ?? 'none', chords: stored.chords, melody: stored.line, parts: stored.parts }],
  };
}

/** The line "@name" stands for in a song, when the phrase has exactly one. */
export function phraseLine(stored: StoredPhrase): string | null {
  if (!PHRASE_NAME.test(stored.name)) return null;
  if (stored.take) return stored.lines?.length === 1 ? stored.lines[0] : null;
  if (typeof stored.line === 'string' && (!stored.parts || Object.keys(stored.parts as object).length === 0)) return stored.line;
  return null;
}

const seconds = (s: number): string => s.toFixed(2);

/** The event a finished take is delivered as: what was played, as data and (when it has bars) as lines. */
export function describeTake(name: string, take: Take, lines: string[] | null): string {
  const end = Math.max(...take.notes.map(([at, len]) => at + len));
  const low = Math.min(...take.notes.map((n) => n[2])), high = Math.max(...take.notes.map((n) => n[2]));
  const out = [
    `[keyboard take "${name}"] Someone played ${take.notes.length} note${take.notes.length === 1 ? '' : 's'} on the keyboard of the Compose page: ${seconds(end)} s, ${pitchName(low)}–${pitchName(high)}, ` +
      (take.tempo === null ? 'in free time, no metronome.' : `to a metronome at ${take.tempo} bpm in ${take.meter}.`),
  ];
  if (lines) {
    out.push(`Written as ${lines.length === 1 ? 'a line' : `${lines.length} lines`}, each note moved to the nearest sixteenth:`);
    out.push(...lines.map((line, i) => `${i === 0 ? TAKE_INSTRUMENT : `${TAKE_INSTRUMENT}:${i + 1}`}: ${line}`));
  }
  out.push(`As played (start in seconds${take.tempo === null ? ' from the first note' : ' from the first bar line'}, seconds held, pitch): ` +
    take.notes.map(([at, len, pitch]) => `${seconds(at)} ${seconds(len)} ${pitchName(pitch)}`).join('; ') + '.');
  out.push(`It is kept as the phrase "${name}" and can be played back by that name` +
    (lines?.length === 1 ? `; in a song, a bar written "@${name}" stands for it.` : '.'));
  return out.join('\n');
}
