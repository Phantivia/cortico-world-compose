/**
 * Turns a `Song` into timed events: the written parts, plus whatever of the groove's band each section keeps
 * (chords voiced from the symbols, a bass line from the roots, drum layers, a fill into the next section, a
 * single hit in a stop bar). Times leave here in seconds, with a few milliseconds of seeded jitter.
 */
import { GROOVES, type Groove } from './grooves.ts';
import type { Instrument } from './instruments.ts';
import { locate, type ChordSpan, type Song } from './sheet.ts';
import { voiceChord, type Chord } from './theory.ts';

export type Role = 'lead' | 'part' | 'comp' | 'bass' | 'drums';
export interface TimedNote { at: number; until: number; pitch: number; velocity: number }
export interface Track { name: string; role: Role; instrument: Instrument | null; notes: TimedNote[] }
/** `barTimes` holds the second at which each bar starts, and after the last one the second at which the song ends. */
export interface Arrangement { tracks: Track[]; seconds: number; leadIn: number; barTimes: number[] }

const LEAD_IN = 0.3;
const TAIL = 2.5;

function rng(seed: string): () => number {
  let a = 2166136261;
  for (const c of seed) a = Math.imul(a ^ c.charCodeAt(0), 16777619);
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const level = (c: string): number => (c === 'X' ? 1.15 : c === 'o' ? 0.6 : 0.88);

/** Moves a beat position, counted from its section's start, onto the groove's swung grid. */
function swung(beat: number, groove: Groove | undefined): number {
  if (!groove?.swing || !groove.swingUnit) return beat;
  const unit = groove.swingUnit, s = groove.swing;
  const base = Math.floor(beat / unit + 1e-9) * unit;
  const x = (beat - base) / unit;
  return base + unit * (x < 0.5 ? x * (s / 0.5) : s + (x - 0.5) * ((1 - s) / 0.5));
}

function chordIn(spans: ChordSpan[], beat: number): Chord | null {
  let found: Chord | null = null;
  for (const span of spans) if (span.at <= beat + 1e-9) found = span.chord;
  return found;
}

const bassRoot = (pc: number): number => 28 + ((pc - 4 + 12) % 12);

interface Beats { at: number; len: number; pitch: number; velocity: number; spread?: number }

/**
 * Seconds from the song's first bar to a beat. Each section runs at its own tempo. The beat is first moved onto
 * the swung grid of the section that `from` lies in, so a note's end is swung like its start even when it rings
 * into the next section.
 */
export function clock(song: Song): (beat: number, from?: number) => number {
  const starts: number[] = [];
  let t = 0;
  for (const s of song.sections) { starts.push(t); t += s.barCount * s.beats * 60 / s.tempo; }
  const indexAt = (beat: number): number => {
    let i = song.sections.length - 1;
    while (i > 0 && beat < song.sections[i].firstBeat - 1e-9) i--;
    return i;
  };
  return (beat, from = beat) => {
    const home = song.sections[indexAt(from)];
    const moved = home.firstBeat + swung(beat - home.firstBeat, GROOVES[home.groove]);
    const i = indexAt(moved), s = song.sections[i];
    return starts[i] + (moved - s.firstBeat) * 60 / s.tempo;
  };
}

export function arrange(song: Song): Arrangement {
  const random = rng(`${song.title}:${song.tempo}:${song.bars}`);
  const band = new Map<string, { role: Role; instrument: Instrument | null; notes: Beats[] }>();
  const push = (name: string, role: Role, instrument: Instrument | null, note: Beats) => {
    let track = band.get(name);
    if (!track) band.set(name, (track = { role, instrument, notes: [] }));
    track.notes.push(note);
  };
  song.sections.forEach((section, index) => {
    const groove = GROOVES[section.groove];
    if (!groove) return;
    const beats = section.beats;
    const tier = section.energy <= 2 ? 'lo' : section.energy >= 4 ? 'hi' : 'mid';
    const touch = (0.6 + 0.09 * section.energy) * (groove.touch ?? 1);
    const comp = section.band.chords, bass = section.band.bass;
    const slot = groove.grid === 1 ? beats : beats / groove.grid;
    const next = song.sections[index + 1];
    const drumsOn = section.band.drums && groove.drums.some((layer) => section.energy >= layer.min);
    let around = 62;
    for (let b = 0; b < section.barCount; b++) {
      const spans = section.chords[b];
      const barStart = section.firstBeat + b * beats;
      const nextSpans = section.chords[b + 1] ?? next?.chords[0];
      const nextRoot = nextSpans?.[0]?.chord ?? chordIn(spans, beats);
      if (section.stops.has(b)) {
        const chord = chordIn(spans, 0);
        if (chord) {
          const voicing = voiceChord(chord, around);
          if (comp) voicing.forEach((pitch) => push(`comp:${comp.name}`, 'comp', comp, { at: barStart, len: 0.45, pitch, velocity: 92 * touch }));
          if (bass) push(`bass:${bass.name}`, 'bass', bass, { at: barStart, len: 0.45, pitch: bassRoot(chord.bass), velocity: 100 * touch });
        }
        if (drumsOn) for (const pitch of [36, 38, 46]) push('drums', 'drums', null, { at: barStart, len: 0.2, pitch, velocity: 100 * touch });
        continue;
      }
      const pick = (patterns: string[]) => patterns[b % patterns.length];
      // comp
      const cp = comp ? pick(groove.compPatterns[tier]) : '';
      for (let i = 0; i < cp.length; i++) {
        const c = cp[i];
        if (c === '.' || c === '-' || !comp) continue;
        const chord = chordIn(spans, i * slot);
        if (!chord) continue;
        let holds = 0;
        while (cp[i + 1 + holds] === '-') holds++;
        const voicing = voiceChord(chord, around);
        around = Math.min(66, Math.max(58, Math.round(voicing.reduce((a, n) => a + n, 0) / voicing.length)));
        const ringing = holds === 0 && (cp[i + 1] === '.' || cp[i + 1] === undefined);
        const len = holds > 0 ? (1 + holds) * slot * 0.96 : ringing ? Math.min(slot * 1.6, 1) : slot * 0.9;
        if (/[1-4]/.test(c)) {
          push(`comp:${comp.name}`, 'comp', comp, { at: barStart + i * slot, len: Math.max(len, slot * 2), pitch: voicing[(Number(c) - 1) % voicing.length], velocity: 74 * touch });
        } else {
          voicing.forEach((pitch, k) => push(`comp:${comp.name}`, 'comp', comp, { at: barStart + i * slot, len, pitch, velocity: (72 + 3 * k) * touch * level(c), spread: k }));
        }
      }
      // bass
      const bp = bass ? pick(groove.bassPatterns[tier === 'lo' ? 'lo' : 'mid']) : '';
      for (let i = 0; i < bp.length; i++) {
        const c = bp[i];
        if (c === '.' || c === '-' || !bass) continue;
        const chord = chordIn(spans, i * slot);
        if (!chord) continue;
        let holds = 0;
        while (bp[i + 1 + holds] === '-') holds++;
        const root = bassRoot(chord.bass);
        const pitch = c === '5' ? (root + chord.fifth <= 48 ? root + chord.fifth : root + chord.fifth - 12)
          : c === '8' ? root + 12
          : c === '3' ? root + (chord.third ?? 5)
          : c === 'a' ? (nextRoot ? bassRoot(nextRoot.bass) - 1 : root)
          : root;
        push(`bass:${bass.name}`, 'bass', bass, { at: barStart + i * slot, len: (1 + holds) * slot * 0.92, pitch: Math.max(28, pitch), velocity: (c === 'R' ? 96 : 84) * touch });
      }
      // drums
      const lastBar = b === section.barCount - 1 && next !== undefined && drumsOn && section.band.fills && section.energy >= 2;
      const fillFrom = beats - (beats === 3 ? 1 : 2);
      for (const layer of drumsOn ? groove.drums : []) {
        if (section.energy < layer.min) continue;
        const dp = b % 2 === 1 && layer.b ? layer.b : layer.a;
        for (let i = 0; i < dp.length; i++) {
          if (dp[i] === '.') continue;
          if (lastBar && (layer.note === 38 || layer.note === 37) && i * slot >= fillFrom) continue;
          push('drums', 'drums', null, { at: barStart + i * slot, len: 0.2, pitch: layer.note, velocity: 96 * touch * level(dp[i]) });
        }
      }
      if (lastBar) {
        const toms = section.energy >= 4 ? [50, 48, 45, 43] : [38, 38, 38, 38];
        const count = beats === 3 ? 2 : 4;
        for (let k = 0; k < count; k++) push('drums', 'drums', null, { at: barStart + fillFrom + k * 0.5, len: 0.2, pitch: toms[k + (4 - count)], velocity: (58 + 12 * k) * touch });
      }
      if (b === 0 && drumsOn && section.band.fills && section.energy >= 4) push('drums', 'drums', null, { at: barStart, len: 1, pitch: 49, velocity: 88 * touch });
    }
  });

  for (const part of song.parts) {
    const name = part.drums ? 'drums' : part.name;
    for (const note of part.notes) {
      const at = locate(song, note.start);
      const onOne = (at?.inBar ?? 1) < 1e-6;
      const base = part.drums ? 92 : part.lead ? 94 : 80;
      push(name, part.drums ? 'drums' : part.lead ? 'lead' : 'part', part.instrument, {
        at: note.start,
        len: part.drums ? 0.2 : note.len * (note.len <= 0.5 ? 0.86 : 0.96),
        pitch: note.pitch,
        // a dynamic mark is taken as written; otherwise the section's energy sets the level
        velocity: note.velocity ?? base * (0.74 + 0.065 * (at?.section.energy ?? 3)) + (onOne ? 5 : 0),
      });
    }
  }

  const jitter: Record<Role, number> = { lead: 0.008, part: 0.008, comp: 0.007, bass: 0.005, drums: 0.004 };
  const seconds = clock(song);
  const tracks: Track[] = [];
  let end = 0;
  for (const [name, track] of band) {
    const strum = track.role === 'comp' && /guitar/.test(track.instrument?.name ?? '') ? 0.007 : 0.002;
    const notes = track.notes.map((n) => {
      const shift = (random() - 0.5) * 2 * jitter[track.role] + (n.spread ?? 0) * strum;
      const at = Math.max(0, LEAD_IN + seconds(n.at) + shift);
      const until = Math.max(at + 0.04, LEAD_IN + seconds(n.at + n.len, n.at));
      end = Math.max(end, until);
      return { at, until, pitch: n.pitch, velocity: Math.round(Math.min(127, Math.max(1, n.velocity + (random() - 0.5) * 10))) };
    });
    tracks.push({ name, role: track.role, instrument: track.instrument, notes });
  }
  const barTimes: number[] = [];
  let t = LEAD_IN;
  for (const s of song.sections) for (let b = 0; b < s.barCount; b++) { barTimes.push(t); t += s.beats * 60 / s.tempo; }
  barTimes.push(t);
  return { tracks, seconds: Math.max(end, t) + TAIL, leadIn: LEAD_IN, barTimes };
}
