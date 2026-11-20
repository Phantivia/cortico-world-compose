/**
 * Reads the lead sheet a tool call carries into a `Song`: sections of bars with chord spans, and one note list
 * per part. Every problem found is collected, so one receipt lists them all.
 *
 * A line is bars separated by `|`. A bar is slots separated by spaces, all the same length: 4 slots are
 * quarter notes, 8 are eighths. A slot is a pitch (`F#5`), several pitches sounding together (`C4+E4+G4`),
 * `-` (hold the previous slot's notes), `.` (rest), or `[..]`, a group of slots that share this one.
 * `(mf)` and the other dynamic marks take no slot; they set the loudness of what follows in the line.
 *
 * Positions and lengths are in quarter-note beats. Sections may differ in meter, tempo and key.
 */
import { DRUM_LETTERS, findInstrument, INSTRUMENT_NAMES, plainName, type Instrument } from './instruments.ts';
import { GROOVES, GROOVE_NAMES } from './grooves.ts';
import { diatonicShift, parseChord, parseKey, parsePitch, pitchName, type Chord, type Key } from './theory.ts';

export interface ChordSpan { chord: Chord | null; at: number; len: number }
/** `velocity` is set only where a dynamic mark governs the note; without it the section's energy decides. */
export interface Note { start: number; len: number; pitch: number; velocity?: number }
export interface Part { name: string; instrument: Instrument | null; drums: boolean; lead: boolean; notes: Note[] }
/** Which roles of the groove's band play in a section, and on what. Everything is off when the groove is none. */
export interface Band { chords: Instrument | null; bass: Instrument | null; drums: boolean; fills: boolean }
export interface Section {
  name: string;
  groove: string;
  energy: number;
  firstBar: number;
  barCount: number;
  /** Beat at which the section starts, and the length of one of its bars. */
  firstBeat: number;
  beats: number;
  meter: string;
  tempo: number;
  key: Key | null;
  band: Band;
  /** One entry per bar; empty when the section names no chords. */
  chords: ChordSpan[][];
  /** Bars (0-based, within the section) where the band plays one hit on beat 1 and then rests. */
  stops: Set<number>;
}
export interface Song {
  title: string;
  tempo: number;
  key: Key | null;
  sections: Section[];
  parts: Part[];
  bars: number;
  beats: number;
  /** Things read leniently that the writer may not have meant. */
  notes: string[];
  /** How many times the sheet used each optional notation: band changes, dynamic marks, stacked pitches, groups, … */
  uses: Record<string, number>;
}

export class SheetError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join('\n'));
  }
}

export interface Meter { label: string; beats: number; slots: number[] }

const PLAIN = [4, 2, 1, 0.5, 0.25, 0.125], TRIPLET = [4 / 3, 2 / 3, 1 / 3, 1 / 6], DOTTED = [3, 1.5, 0.75];

/**
 * `4/4`, `3/4`, `6/8`, `5/4`, `7/8`, … with the slot counts a bar of it may be written in: those whose slot is a
 * plain or triplet note value, a dotted one in compound meters, and 1 for the whole bar.
 */
export function parseMeter(text: string): Meter | null {
  const m = /^\s*(\d{1,2})\s*\/\s*(2|4|8|16)\s*$/.exec(text);
  if (!m) return null;
  const n = Number(m[1]), d = Number(m[2]), beats = (n * 4) / d;
  if (n < 1 || beats < 1 || beats > 8) return null;
  const lengths = [...PLAIN, ...TRIPLET, ...(d === 8 && n % 3 === 0 && n > 3 ? DOTTED : [])];
  const counts = lengths.map((l) => beats / l).filter((c) => Math.abs(c - Math.round(c)) < 1e-9 && c <= 48).map(Math.round);
  return { label: `${n}/${d}`, beats, slots: [...new Set([1, ...counts])].sort((a, b) => a - b) };
}

/** Velocities of the dynamic marks. */
export const DYNAMICS: Record<string, number> = { ppp: 30, pp: 42, p: 56, mp: 70, mf: 84, f: 98, ff: 112, fff: 124 };
const RAMPS: Record<string, 1 | -1> = { '<': 1, cresc: 1, 'cresc.': 1, crescendo: 1, '>': -1, dim: -1, 'dim.': -1, decresc: -1, diminuendo: -1 };

function splitBars(text: string): string[] {
  const bars = text.split('|').map((b) => b.trim());
  while (bars.length > 0 && bars[0] === '') bars.shift();
  while (bars.length > 0 && bars[bars.length - 1] === '') bars.pop();
  return bars;
}

/** A bar that stands for a motif: `@name`, `@name+2`, with dynamic marks allowed in front (`(mf) @name`). */
const MOTIF_BAR = /^((?:(?:\([^()\s]*\)|![^!\s]+!)\s*)*)@([A-Za-z0-9_]+)\s*([+-]\d+)?$/;

/** How many bars a line holds once its motifs are written out. */
export function barsIn(text: string, motifs: Record<string, string>): number {
  return splitBars(text).reduce((n, bar) => {
    const m = MOTIF_BAR.exec(bar);
    return n + (m && motifs[m[2]] !== undefined ? Math.max(1, splitBars(motifs[m[2]]).length) : 1);
  }, 0);
}

const PITCH_IN_TEXT = /(?<![A-Za-z0-9#])[A-Ga-g][#b]{0,2}-?\d(?!\d)/g;

/** Replaces `@name`, `@name+2`, `@name-1` bars by the motif's bars, moved by that many scale steps of the key. */
function expandMotifs(text: string, motifs: Record<string, string>, key: Key | null, where: string, problems: string[]): string[] {
  const out: string[] = [];
  for (const bar of splitBars(text)) {
    const m = MOTIF_BAR.exec(bar);
    if (!m) { out.push(bar); continue; }
    const source = motifs[m[2]];
    if (source === undefined) { problems.push(`${where}: motif "${m[2]}" is not defined in motifs`); out.push('.'); continue; }
    const steps = Number(m[3] ?? 0);
    if (steps !== 0 && key === null) { problems.push(`${where}: "@${m[2]}${m[3]}" moves a motif by scale steps and needs the song's key`); out.push('.'); continue; }
    splitBars(source).forEach((motifBar, k) => {
      const moved = steps === 0 ? motifBar : motifBar.replace(PITCH_IN_TEXT, (tok) => pitchName(diatonicShift(parsePitch(tok)!, steps, key!), key!.flats));
      out.push(k === 0 ? `${m[1]}${moved}` : moved);
    });
  }
  return out;
}

function readChords(bars: string[], beats: number, where: string, problems: string[]): ChordSpan[][] {
  const out: ChordSpan[][] = [];
  const most = Math.max(1, Math.round(beats * 2));
  let last: Chord | null = null;
  bars.forEach((bar, i) => {
    if (bar === '%' && out.length > 0) { out.push(out[out.length - 1].map((s) => ({ ...s }))); return; }
    const tokens = bar.split(/\s+/).filter(Boolean);
    if (tokens.length === 0 || tokens.length > most) {
      problems.push(`${where}, chords bar ${i + 1}: "${bar}" must hold 1 to ${most} chords`);
      out.push([{ chord: last, at: 0, len: beats }]);
      return;
    }
    const slot = beats / tokens.length;
    const spans: ChordSpan[] = [];
    tokens.forEach((tok, k) => {
      if (tok === '-' || tok === '%') {
        if (spans.length > 0) spans[spans.length - 1].len += slot;
        else spans.push({ chord: last, at: 0, len: slot });
        return;
      }
      if (/^(N\.?C\.?|\.)$/i.test(tok)) { last = null; spans.push({ chord: null, at: k * slot, len: slot }); return; }
      try { last = parseChord(tok); } catch (e) { problems.push(`${where}, chords bar ${i + 1}: ${(e as Error).message}`); }
      spans.push({ chord: last, at: k * slot, len: slot });
    });
    out.push(spans);
  });
  return out;
}

type Item = string | Item[];

/** A bar's items in order: slot tokens, marks such as `(mf)`, and `[..]` groups as nested lists. Null when brackets do not pair. */
function itemsOf(bar: string): Item[] | null {
  const stack: Item[][] = [[]];
  for (const tok of bar.match(/\[|\]|\([^()\s]*\)|![^!\s]+!|[^\s[\]]+/g) ?? []) {
    if (tok === '[') { const group: Item[] = []; stack[stack.length - 1].push(group); stack.push(group); }
    else if (tok === ']') { if (stack.length === 1) return null; stack.pop(); }
    else stack[stack.length - 1].push(tok);
  }
  return stack.length === 1 ? stack[0] : null;
}

const markOf = (tok: string): string | null => {
  const m = /^\(([^()]*)\)$/.exec(tok) ?? /^!([^!]+)!$/.exec(tok);
  return m ? m[1].toLowerCase() : null;
};
const isMark = (item: Item): boolean => typeof item === 'string' && markOf(item) !== null;

/** Reads one part's bars of one section into notes starting at `startBeat`. */
function readLine(bars: string[], meter: Meter, startBeat: number, drums: boolean, into: Note[], where: string, problems: string[], uses: Record<string, number>): void {
  const count = (name: string) => { uses[name] = (uses[name] ?? 0) + 1; };
  let open: Note[] = [];
  let previous: string | null = null;
  let velocity: number | undefined;
  /** A hairpin waiting for the mark it ramps to: the first note it covers, where it began and from which velocity. */
  let ramp: { from: number; at: number; start: number; direction: 1 | -1 } | null = null;
  const endRamp = (target: number, at: number) => {
    if (!ramp) return;
    const span = Math.max(1e-9, at - ramp.at);
    for (let i = ramp.from; i < into.length; i++) into[i].velocity = Math.round(ramp.start + (target - ramp.start) * Math.min(1, Math.max(0, (into[i].start - ramp.at) / span)));
    ramp = null;
  };

  const slot = (tok: string, at: number, len: number, bar: number) => {
    if (tok === '-') {
      if (open.length > 0 && Math.abs(open[0].start + open[0].len - at) < 1e-6) for (const note of open) note.len += len;
      return;
    }
    if (tok === '.' || tok === 'r' || tok === '_' || tok === 'z' || tok === '~') { open = []; return; }
    const sounding: Note[] = [];
    const pieces = tok.split(/[+,]/).filter(Boolean);
    for (const piece of pieces) {
      if (drums) {
        if (/^\d+$/.test(piece)) {
          const key = Number(piece);
          if (key >= 27 && key <= 87) { sounding.push({ start: at, len, pitch: key }); count('drumNumbers'); }
          else problems.push(`${where}, bar ${bar}: "${piece}" is not a General MIDI percussion key (27 to 87)`);
          continue;
        }
        for (const letter of piece.toUpperCase()) {
          const pitch = DRUM_LETTERS[letter];
          if (pitch === undefined) problems.push(`${where}, bar ${bar}: drum letter "${letter}" is not one of ${Object.keys(DRUM_LETTERS).join(' ')}`);
          else sounding.push({ start: at, len, pitch });
        }
        continue;
      }
      const pitch = parsePitch(piece);
      if (pitch === null && piece.startsWith('@')) problems.push(`${where}, bar ${bar}: "${piece}" shares its bar with other slots; a motif stands for whole bars, so "@name" is written alone between bar lines`);
      else if (pitch === null) problems.push(`${where}, bar ${bar}: "${piece}" is not a pitch like F#5, a hold "-" or a rest "."`);
      else sounding.push({ start: at, len, pitch });
    }
    if (!drums && sounding.length > 1) count('stacks');
    for (const note of sounding) { if (velocity !== undefined) note.velocity = velocity; into.push(note); }
    open = drums ? [] : sounding;
  };

  const walk = (items: Item[], at: number, len: number, bar: number) => {
    const slots = items.filter((item) => !isMark(item)).length;
    const each = len / Math.max(1, slots);
    let k = 0;
    for (const item of items) {
      const here = at + k * each;
      if (Array.isArray(item)) { count('groups'); walk(item, here, each, bar); k++; continue; }
      const mark = markOf(item);
      if (mark === null) { slot(item, here, each, bar); k++; continue; }
      if (DYNAMICS[mark] !== undefined) { endRamp(DYNAMICS[mark], here); velocity = DYNAMICS[mark]; count('marks'); }
      else if (RAMPS[mark] !== undefined) { endRamp(velocity ?? DYNAMICS.mf, here); ramp = { from: into.length, at: here, start: velocity ?? DYNAMICS.mf, direction: RAMPS[mark] }; count('marks'); }
      else problems.push(`${where}, bar ${bar}: "${item}" is not a dynamic mark; those are ${Object.keys(DYNAMICS).map((d) => `(${d})`).join(' ')}, and (<) or (>) to ramp to the next one`);
    }
  };

  bars.forEach((raw, i) => {
    const bar = raw === '%' && previous !== null ? previous : raw;
    previous = bar;
    const items = itemsOf(bar);
    const slots = items?.filter((item) => !isMark(item)).length ?? 0;
    if (items === null) {
      problems.push(`${where}, bar ${i + 1}: the brackets in "${bar}" do not pair up`);
      open = [];
      return;
    }
    if (!meter.slots.includes(slots)) {
      const allowed = `${meter.slots.slice(0, -1).join(', ')} or ${meter.slots[meter.slots.length - 1]}`;
      problems.push(`${where}, bar ${i + 1}: ${slots} slots ("${bar}"); a ${meter.label} bar is written in ${allowed} slots of equal length`);
      open = [];
      return;
    }
    walk(items, startBeat + i * meter.beats, meter.beats, i + 1);
  });
  // a hairpin with no mark after it moves two marks' worth by the end of the line
  if (ramp) endRamp(Math.min(127, Math.max(20, (ramp as { start: number; direction: number }).start + 28 * (ramp as { direction: number }).direction)), startBeat + bars.length * meter.beats);
}

type Raw = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v : undefined);
const OFF = new Set(['off', 'no', 'none', 'false', '0', 'mute', 'silent']), ON = new Set(['on', 'yes', 'true', '1']);
const BAND_ROLES = ['chords', 'bass', 'drums', 'fills'];

export function readBand(given: unknown, groove: string, where: string, problems: string[], notes: string[], uses: Record<string, number>): Band {
  const g = GROOVES[groove];
  const band: Band = g ? { chords: findInstrument(g.comp), bass: findInstrument(g.bass), drums: true, fills: true } : { chords: null, bass: null, drums: false, fills: false };
  if (!given || typeof given !== 'object') return band;
  for (const [name, value] of Object.entries(given as Raw)) {
    if (value === undefined || value === null || value === '') continue;
    const role = plainName(name) === 'comp' ? 'chords' : plainName(name);
    const v = plainName(String(value));
    if (!BAND_ROLES.includes(role)) { problems.push(`${where}: band names "${name}"; its roles are ${BAND_ROLES.join(', ')}`); continue; }
    if (ON.has(v)) continue;
    if (!g) { if (!OFF.has(v)) notes.push(`${where}: band.${role} is set, but the groove is none, so no band plays`); continue; }
    uses.band = (uses.band ?? 0) + 1;
    if (role === 'drums' || role === 'fills') {
      if (OFF.has(v)) band[role] = false;
      else problems.push(`${where}: band.${role} is "${String(value)}"; it takes "off"`);
    } else if (OFF.has(v)) {
      band[role as 'chords' | 'bass'] = null;
    } else {
      const instrument = findInstrument(v);
      if (instrument === null) problems.push(`${where}: band.${role} "${String(value)}" is neither "off" nor a known instrument`);
      else band[role as 'chords' | 'bass'] = instrument;
    }
  }
  return band;
}

export function readSong(args: Raw): Song {
  const problems: string[] = [];
  const notes: string[] = [];
  const uses: Record<string, number> = {};
  const title = str(args.title) ?? 'Untitled';
  const tempo = Number(args.tempo ?? 100);
  if (!(tempo >= 30 && tempo <= 300)) problems.push(`tempo ${String(args.tempo)} must be between 30 and 300 beats per minute`);
  const FOUR = parseMeter('4/4')!;
  const meterOf = (text: string, where: string): Meter => {
    const meter = parseMeter(text);
    if (meter === null) problems.push(`${where}meter "${text}" is not readable; write it like 4/4, 3/4, 6/8, 5/4 or 7/8 (a bar of 1 to 8 quarter notes)`);
    return meter ?? FOUR;
  };
  const songMeter = meterOf(str(args.meter) ?? '4/4', '');
  const keyOf = (text: string): Key | null => { try { return parseKey(text); } catch (e) { problems.push((e as Error).message); return null; } };
  const key = str(args.key) ? keyOf(str(args.key)!) : null;
  const motifs: Record<string, string> = {};
  if (args.motifs && typeof args.motifs === 'object') for (const [k, v] of Object.entries(args.motifs as Raw)) if (typeof v === 'string') motifs[k] = v;
  const leadName = str(args.lead) ?? 'piano';

  const parts = new Map<string, Part>();
  const partFor = (written: string, lead: boolean, where: string): Part | null => {
    const name = written.trim().replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '');
    const colon = name.indexOf(':');
    const base = (colon < 0 ? name : name.slice(0, colon)).trim().toLowerCase();
    const label = colon < 0 ? '' : name.slice(colon + 1).trim().toLowerCase();
    const drums = base === 'drums' || base === 'percussion';
    const instrument = drums ? null : findInstrument(base);
    if (!drums && instrument === null) {
      problems.push(`${where}: instrument "${name}" is not known; use one of: ${INSTRUMENT_NAMES.join(', ')}, drums, or "gm" and a General MIDI program number`);
      return null;
    }
    const partName = `${instrument?.name ?? 'drums'}${label ? `:${label}` : ''}`;
    const existing = parts.get(partName);
    if (existing) { existing.lead ||= lead; return existing; }
    if (label) uses.labels = (uses.labels ?? 0) + 1;
    if (instrument && /^gm \d+$/.test(instrument.name)) uses.gm = (uses.gm ?? 0) + 1;
    const part: Part = { name: partName, instrument, drums, lead, notes: [] };
    parts.set(partName, part);
    return part;
  };

  const rawSections = Array.isArray(args.sections) ? (args.sections as Raw[]) : [];
  if (rawSections.length === 0) problems.push('sections is empty; a song needs at least one section');
  const byName = new Map<string, Raw>();
  const sections: Section[] = [];
  let bar = 0, beat = 0;
  const written: string[] = [];
  rawSections.forEach((given, index) => {
    let raw = given;
    const name = str(raw.name) ?? `section ${index + 1}`;
    const like = str(raw.like);
    if (like !== undefined) {
      const base = byName.get(like);
      if (base === undefined) problems.push(`section ${name}: like "${like}" names no earlier section`);
      else {
        raw = { ...base, ...Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined && v !== null)), parts: { ...((base.parts as Raw) ?? {}), ...((raw.parts as Raw) ?? {}) } };
        if (base.band || given.band) raw.band = { ...((base.band as Raw) ?? {}), ...((given.band as Raw) ?? {}) };
      }
    }
    byName.set(name, raw);
    written.push(name);
  });
  const form = Array.isArray(args.form) && args.form.length > 0 ? (args.form as unknown[]).map(String) : written;
  for (const name of form) {
    const raw = byName.get(name);
    if (raw === undefined) { problems.push(`form names "${name}", which is not one of the sections: ${written.join(', ')}`); continue; }
    const meter = str(raw.meter) ? meterOf(str(raw.meter)!, `section ${name}: `) : songMeter;
    if (str(raw.meter) && meter.label !== songMeter.label) uses.meters = (uses.meters ?? 0) + 1;
    let sectionTempo = tempo;
    if (raw.tempo !== undefined && raw.tempo !== null && raw.tempo !== '') {
      sectionTempo = Number(raw.tempo);
      if (!(sectionTempo >= 30 && sectionTempo <= 300)) { problems.push(`section ${name}: tempo ${String(raw.tempo)} must be between 30 and 300 beats per minute`); sectionTempo = tempo; }
      else if (sectionTempo !== tempo) uses.tempos = (uses.tempos ?? 0) + 1;
    }
    const sectionKey = str(raw.key) ? keyOf(str(raw.key)!) : key;
    if (str(raw.key) && sectionKey && sectionKey.label !== key?.label) uses.keys = (uses.keys ?? 0) + 1;
    const groove = (str(raw.groove) ?? 'none').toLowerCase();
    if (!GROOVE_NAMES.includes(groove)) problems.push(`section ${name}: groove "${groove}" is not known; use one of: ${GROOVE_NAMES.join(', ')}`);
    else if (GROOVES[groove] && GROOVES[groove].beats !== 0 && `${GROOVES[groove].beats}/4` !== meter.label) {
      problems.push(`section ${name}: groove "${groove}" is in ${GROOVES[groove].beats}/4 and the meter here is ${meter.label}; in other meters the grooves are ambient and none, and the band's lines are yours to write`);
    }
    const energy = Math.round(Number(raw.energy ?? 3));
    if (!(energy >= 1 && energy <= 5)) problems.push(`section ${name}: energy ${String(raw.energy)} must be 1 to 5`);
    const band = readBand(raw.band, groove, `section ${name}`, problems, notes, uses);
    const chords = str(raw.chords) ? readChords(splitBars(str(raw.chords)!), meter.beats, `section ${name}`, problems) : [];
    const lines: Array<[Part, string[], string, string]> = [];
    const addLine = (instrument: string, text: string, lead: boolean) => {
      const where = `section ${name}, ${instrument}`;
      const part = partFor(instrument, lead, where);
      if (part) lines.push([part, expandMotifs(text, motifs, sectionKey, where, problems), where, text]);
    };
    if (str(raw.melody)) addLine(leadName, str(raw.melody)!, true);
    // beside a melody, a line under the lead instrument's own name is a second line of it (a pianist's other hand), not more melody
    const beside = (instrument: string): string =>
      str(raw.melody) && !instrument.includes(':') && findInstrument(instrument) !== null && findInstrument(instrument)?.name === findInstrument(leadName)?.name ? `${instrument}:2` : instrument;
    if (raw.parts && typeof raw.parts === 'object') for (const [instrument, text] of Object.entries(raw.parts as Raw)) if (str(text)) addLine(beside(instrument), str(text)!, false);
    const longest = Math.max(0, ...lines.map(([, bars]) => bars.length));
    const barCount = chords.length > 0 ? chords.length : longest;
    if (barCount === 0) { problems.push(`section ${name}: no chords and no notes, so it has no length`); continue; }
    for (const [part, bars, where, text] of lines) {
      if (chords.length > 0 && bars.length > barCount) problems.push(`${where}: ${bars.length} bars${bars.length > splitBars(text).length ? ' once its motifs are written out (a motif bar stands for all the bars of the motif)' : ''}, but the section's chords have ${barCount}`);
      else if (bars.length < barCount) notes.push(`${where}: ${bars.length} bars written, the section has ${barCount}; the rest is silence`);
      readLine(bars.slice(0, barCount), meter, beat, part.drums, part.notes, where, problems, uses);
    }
    const stops = new Set<number>();
    for (const n of Array.isArray(raw.stops) ? raw.stops : []) {
      const k = Number(n);
      if (Number.isInteger(k) && k >= 1 && k <= barCount) stops.add(k - 1);
      else problems.push(`section ${name}: stops entry ${String(n)} is not a bar number from 1 to ${barCount}`);
    }
    if (groove !== 'none' && chords.length === 0) problems.push(`section ${name}: groove "${groove}" needs chords to play`);
    sections.push({
      name, groove, energy: Math.min(5, Math.max(1, energy || 3)), firstBar: bar, barCount, firstBeat: beat, beats: meter.beats,
      meter: meter.label, tempo: sectionTempo, key: sectionKey, band, chords, stops,
    });
    bar += barCount;
    beat += barCount * meter.beats;
  }
  if (bar > 400) problems.push(`the song has ${bar} bars; the limit is 400`);
  if (problems.length > 0) throw new SheetError(problems);
  return { title, tempo, key, sections, parts: [...parts.values()], bars: bar, beats: beat, notes, uses };
}

/** The section, bar (0-based, in the song) and position within that bar of a beat counted from the song's start. */
export function locate(song: Song, beat: number): { section: Section; bar: number; inBar: number } | null {
  for (let i = song.sections.length - 1; i >= 0; i--) {
    const s = song.sections[i];
    if (beat < s.firstBeat - 1e-9) continue;
    const index = Math.min(s.barCount - 1, Math.floor((beat - s.firstBeat) / s.beats + 1e-9));
    return { section: s, bar: s.firstBar + index, inBar: beat - s.firstBeat - index * s.beats };
  }
  return null;
}

/** The beat at which each bar starts, and after the last one the beat at which the song ends. */
export function barStarts(song: Song): number[] {
  const out: number[] = [];
  for (const s of song.sections) for (let b = 0; b < s.barCount; b++) out.push(s.firstBeat + b * s.beats);
  out.push(song.beats);
  return out;
}

/** The chord sounding at a beat counted from the song's start, or null. */
export function chordAt(song: Song, beat: number): Chord | null {
  const at = locate(song, beat);
  const spans = at?.section.chords[at.bar - at.section.firstBar];
  if (!at || !spans) return null;
  let found: Chord | null = null;
  for (const span of spans) if (span.at <= at.inBar + 1e-9) found = span.chord;
  return found;
}
