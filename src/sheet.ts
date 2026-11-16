/**
 * Reads the lead sheet a tool call carries into a `Song`: sections of bars with chord spans, and one note list
 * per part. Every problem found is collected, so one receipt lists them all.
 *
 * A line is bars separated by `|`. A bar is slots separated by spaces, all the same length: 4 slots are
 * quarter notes, 8 are eighths. A slot is a pitch (`F#5`), `-` (hold the previous note) or `.` (rest).
 */
import { DRUM_LETTERS, findInstrument, INSTRUMENT_NAMES, type Instrument } from './instruments.ts';
import { GROOVES, GROOVE_NAMES } from './grooves.ts';
import { diatonicShift, parseChord, parseKey, parsePitch, pitchName, type Chord, type Key } from './theory.ts';

export interface ChordSpan { chord: Chord | null; at: number; len: number }
export interface Note { start: number; len: number; pitch: number; velocity?: number }
export interface Part { name: string; instrument: Instrument | null; drums: boolean; lead: boolean; notes: Note[] }
export interface Section {
  name: string;
  groove: string;
  energy: number;
  firstBar: number;
  barCount: number;
  /** One entry per bar; empty when the section names no chords. */
  chords: ChordSpan[][];
  /** Bars (0-based, within the section) where the band plays one hit on beat 1 and then rests. */
  stops: Set<number>;
}
export interface Song {
  title: string;
  tempo: number;
  key: Key | null;
  beatsPerBar: number;
  sections: Section[];
  parts: Part[];
  bars: number;
  /** Things read leniently that the writer may not have meant. */
  notes: string[];
}

export class SheetError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join('\n'));
  }
}

const SLOTS: Record<number, number[]> = { 4: [1, 2, 4, 8, 16, 32, 3, 6, 12, 24], 3: [1, 3, 6, 12, 24, 9, 18] };

function splitBars(text: string): string[] {
  const bars = text.split('|').map((b) => b.trim());
  while (bars.length > 0 && bars[0] === '') bars.shift();
  while (bars.length > 0 && bars[bars.length - 1] === '') bars.pop();
  return bars;
}

/** Replaces `@name`, `@name+2`, `@name-1` bars by the motif's bars, moved by that many scale steps of the key. */
function expandMotifs(text: string, motifs: Record<string, string>, key: Key | null, where: string, problems: string[]): string[] {
  const out: string[] = [];
  for (const bar of splitBars(text)) {
    const m = /^@([A-Za-z0-9_]+)\s*([+-]\d+)?$/.exec(bar);
    if (!m) { out.push(bar); continue; }
    const source = motifs[m[1]];
    if (source === undefined) { problems.push(`${where}: motif "${m[1]}" is not defined in motifs`); out.push('.'); continue; }
    const steps = Number(m[2] ?? 0);
    if (steps !== 0 && key === null) { problems.push(`${where}: "@${m[1]}${m[2]}" moves a motif by scale steps and needs the song's key`); out.push('.'); continue; }
    for (const motifBar of splitBars(source)) {
      out.push(steps === 0 ? motifBar : motifBar.split(/\s+/).map((tok) => {
        const p = parsePitch(tok);
        return p === null ? tok : pitchName(diatonicShift(p, steps, key!), key!.flats);
      }).join(' '));
    }
  }
  return out;
}

function readChords(bars: string[], beats: number, where: string, problems: string[]): ChordSpan[][] {
  const out: ChordSpan[][] = [];
  let last: Chord | null = null;
  bars.forEach((bar, i) => {
    if (bar === '%' && out.length > 0) { out.push(out[out.length - 1].map((s) => ({ ...s }))); return; }
    const tokens = bar.split(/\s+/).filter(Boolean);
    if (tokens.length === 0 || tokens.length > beats * 2) {
      problems.push(`${where}, chords bar ${i + 1}: "${bar}" must hold 1 to ${beats * 2} chords`);
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

/** Reads one part's bars of one section into notes starting at `startBeat`. Returns the number of bars read. */
function readLine(bars: string[], beats: number, startBeat: number, drums: boolean, into: Note[], where: string, problems: string[]): void {
  let open: Note | null = null;
  let previous: string | null = null;
  bars.forEach((raw, i) => {
    const bar = raw === '%' && previous !== null ? previous : raw;
    previous = bar;
    const tokens = bar.split(/\s+/).filter(Boolean);
    if (!SLOTS[beats].includes(tokens.length)) {
      problems.push(`${where}, bar ${i + 1}: ${tokens.length} slots ("${bar}"); a bar needs ${beats === 4 ? '4, 8 or 16 (3, 6, 12 for triplets)' : '3, 6 or 12'} slots of equal length`);
      open = null;
      return;
    }
    const slot = beats / tokens.length;
    tokens.forEach((tok, k) => {
      const at = startBeat + i * beats + k * slot;
      if (tok === '-') {
        if (open !== null && Math.abs(open.start + open.len - at) < 1e-6) open.len += slot;
        return;
      }
      if (tok === '.' || tok === 'r' || tok === '_') { open = null; return; }
      if (drums) {
        open = null;
        for (const letter of tok.toUpperCase()) {
          const pitch = DRUM_LETTERS[letter];
          if (pitch === undefined) problems.push(`${where}, bar ${i + 1}: drum letter "${letter}" is not one of ${Object.keys(DRUM_LETTERS).join(' ')}`);
          else into.push({ start: at, len: slot, pitch });
        }
        return;
      }
      const pitch = parsePitch(tok);
      if (pitch === null) {
        problems.push(`${where}, bar ${i + 1}: "${tok}" is not a pitch like F#5, a hold "-" or a rest "."`);
        open = null;
        return;
      }
      open = { start: at, len: slot, pitch };
      into.push(open);
    });
  });
}

type Raw = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v : undefined);

export function readSong(args: Raw): Song {
  const problems: string[] = [];
  const notes: string[] = [];
  const title = str(args.title) ?? 'Untitled';
  const tempo = Number(args.tempo ?? 100);
  if (!(tempo >= 30 && tempo <= 300)) problems.push(`tempo ${String(args.tempo)} must be between 30 and 300 beats per minute`);
  const meter = str(args.meter) ?? '4/4';
  const beats = meter === '3/4' ? 3 : 4;
  if (meter !== '4/4' && meter !== '3/4') problems.push(`meter "${meter}" is not supported; use 4/4 or 3/4`);
  let key: Key | null = null;
  if (str(args.key)) { try { key = parseKey(str(args.key)!); } catch (e) { problems.push((e as Error).message); } }
  const motifs: Record<string, string> = {};
  if (args.motifs && typeof args.motifs === 'object') for (const [k, v] of Object.entries(args.motifs as Raw)) if (typeof v === 'string') motifs[k] = v;
  const leadName = str(args.lead) ?? 'piano';

  const parts = new Map<string, Part>();
  const partFor = (name: string, lead: boolean, where: string): Part | null => {
    const key2 = name.trim().toLowerCase();
    const existing = parts.get(key2);
    if (existing) { existing.lead ||= lead; return existing; }
    const drums = key2 === 'drums' || key2 === 'percussion';
    const instrument = drums ? null : findInstrument(key2);
    if (!drums && instrument === null) {
      problems.push(`${where}: instrument "${name}" is not known; use one of: ${INSTRUMENT_NAMES.join(', ')}, drums`);
      return null;
    }
    const part: Part = { name: instrument?.name ?? 'drums', instrument, drums, lead, notes: [] };
    parts.set(key2, part);
    return part;
  };

  const rawSections = Array.isArray(args.sections) ? (args.sections as Raw[]) : [];
  if (rawSections.length === 0) problems.push('sections is empty; a song needs at least one section');
  const byName = new Map<string, Raw>();
  const sections: Section[] = [];
  let bar = 0;
  const written: string[] = [];
  rawSections.forEach((given, index) => {
    let raw = given;
    const name = str(raw.name) ?? `section ${index + 1}`;
    const like = str(raw.like);
    if (like !== undefined) {
      const base = byName.get(like);
      if (base === undefined) problems.push(`section ${name}: like "${like}" names no earlier section`);
      else raw = { ...base, ...Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined && v !== null)), parts: { ...((base.parts as Raw) ?? {}), ...((raw.parts as Raw) ?? {}) } };
    }
    byName.set(name, raw);
    written.push(name);
  });
  const form = Array.isArray(args.form) && args.form.length > 0 ? (args.form as unknown[]).map(String) : written;
  for (const name of form) {
    const raw = byName.get(name);
    if (raw === undefined) { problems.push(`form names "${name}", which is not one of the sections: ${written.join(', ')}`); continue; }
    const groove = (str(raw.groove) ?? 'none').toLowerCase();
    if (!GROOVE_NAMES.includes(groove)) problems.push(`section ${name}: groove "${groove}" is not known; use one of: ${GROOVE_NAMES.join(', ')}`);
    else if (GROOVES[groove] && GROOVES[groove].beats !== 0 && GROOVES[groove].beats !== beats) problems.push(`section ${name}: groove "${groove}" is in ${GROOVES[groove].beats}/4 and the song's meter is ${meter}`);
    const energy = Math.round(Number(raw.energy ?? 3));
    if (!(energy >= 1 && energy <= 5)) problems.push(`section ${name}: energy ${String(raw.energy)} must be 1 to 5`);
    const chords = str(raw.chords) ? readChords(splitBars(str(raw.chords)!), beats, `section ${name}`, problems) : [];
    const lines: Array<[Part, string[], string]> = [];
    const addLine = (instrument: string, text: string, lead: boolean) => {
      const where = `section ${name}, ${instrument}`;
      const part = partFor(instrument, lead, where);
      if (part) lines.push([part, expandMotifs(text, motifs, key, where, problems), where]);
    };
    if (str(raw.melody)) addLine(leadName, str(raw.melody)!, true);
    if (raw.parts && typeof raw.parts === 'object') for (const [instrument, text] of Object.entries(raw.parts as Raw)) if (str(text)) addLine(instrument, str(text)!, false);
    const longest = Math.max(0, ...lines.map(([, bars]) => bars.length));
    const barCount = chords.length > 0 ? chords.length : longest;
    if (barCount === 0) { problems.push(`section ${name}: no chords and no notes, so it has no length`); continue; }
    for (const [part, bars, where] of lines) {
      if (chords.length > 0 && bars.length > barCount) problems.push(`${where}: ${bars.length} bars, but the section's chords have ${barCount}`);
      else if (bars.length < barCount) notes.push(`${where}: ${bars.length} bars written, the section has ${barCount}; the rest is silence`);
      readLine(bars.slice(0, barCount), beats, bar * beats, part.drums, part.notes, where, problems);
    }
    const stops = new Set<number>();
    for (const n of Array.isArray(raw.stops) ? raw.stops : []) {
      const k = Number(n);
      if (Number.isInteger(k) && k >= 1 && k <= barCount) stops.add(k - 1);
      else problems.push(`section ${name}: stops entry ${String(n)} is not a bar number from 1 to ${barCount}`);
    }
    if (groove !== 'none' && chords.length === 0) problems.push(`section ${name}: groove "${groove}" needs chords to play`);
    sections.push({ name, groove, energy: Math.min(5, Math.max(1, energy || 3)), firstBar: bar, barCount, chords, stops });
    bar += barCount;
  }
  if (bar > 400) problems.push(`the song has ${bar} bars; the limit is 400`);
  if (problems.length > 0) throw new SheetError(problems);
  return { title, tempo, key, beatsPerBar: beats, sections, parts: [...parts.values()], bars: bar, notes };
}

/** The chord sounding at a beat counted from the song's start, or null. */
export function chordAt(song: Song, beat: number): Chord | null {
  const barIndex = Math.floor(beat / song.beatsPerBar + 1e-9);
  const section = song.sections.find((s) => barIndex >= s.firstBar && barIndex < s.firstBar + s.barCount);
  const spans = section?.chords[barIndex - section.firstBar];
  if (!spans) return null;
  const inBar = beat - barIndex * song.beatsPerBar;
  let found: Chord | null = null;
  for (const span of spans) if (span.at <= inBar + 1e-9) found = span.chord;
  return found;
}
