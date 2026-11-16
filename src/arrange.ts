/**
 * Turns a `Song` into timed events: the written parts, plus the band each section's groove asks for (chords
 * voiced from the symbols, a bass line from the roots, drum layers, a fill into the next section, a single hit
 * in a stop bar). Times leave here in seconds, with a few milliseconds of seeded jitter.
 */
import { GROOVES, type Groove } from './grooves.ts';
import { findInstrument, type Instrument } from './instruments.ts';
import type { ChordSpan, Song } from './sheet.ts';
import { voiceChord, type Chord } from './theory.ts';

export type Role = 'lead' | 'part' | 'comp' | 'bass' | 'drums';
export interface TimedNote { at: number; until: number; pitch: number; velocity: number }
export interface Track { name: string; role: Role; instrument: Instrument | null; notes: TimedNote[] }
export interface Arrangement { tracks: Track[]; seconds: number; secondsPerBeat: number; leadIn: number }

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

/** Moves a beat position onto the groove's swung grid. */
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

export function arrange(song: Song): Arrangement {
  const random = rng(`${song.title}:${song.tempo}:${song.bars}`);
  const spb = 60 / song.tempo;
  const beats = song.beatsPerBar;
  const band = new Map<string, { role: Role; instrument: Instrument | null; notes: Beats[] }>();
  const push = (name: string, role: Role, instrument: Instrument | null, note: Beats) => {
    let track = band.get(name);
    if (!track) band.set(name, (track = { role, instrument, notes: [] }));
    track.notes.push(note);
  };
  const grooveOfBeat = (beat: number): Groove | undefined => {
    const bar = Math.floor(beat / beats + 1e-9);
    const section = song.sections.find((s) => bar >= s.firstBar && bar < s.firstBar + s.barCount);
    return section ? GROOVES[section.groove] : undefined;
  };
  const energyOfBeat = (beat: number): number => {
    const bar = Math.floor(beat / beats + 1e-9);
    return song.sections.find((s) => bar >= s.firstBar && bar < s.firstBar + s.barCount)?.energy ?? 3;
  };

  song.sections.forEach((section, index) => {
    const groove = GROOVES[section.groove];
    if (!groove) return;
    const tier = section.energy <= 2 ? 'lo' : section.energy >= 4 ? 'hi' : 'mid';
    const touch = (0.6 + 0.09 * section.energy) * (groove.touch ?? 1);
    const comp = findInstrument(groove.comp)!, bass = findInstrument(groove.bass)!;
    const slot = groove.grid === 1 ? beats : beats / groove.grid;
    const next = song.sections[index + 1];
    const drumsOn = groove.drums.some((layer) => section.energy >= layer.min);
    let around = 62;
    for (let b = 0; b < section.barCount; b++) {
      const spans = section.chords[b];
      const barStart = (section.firstBar + b) * beats;
      const nextSpans = section.chords[b + 1] ?? next?.chords[0];
      const nextRoot = nextSpans?.[0]?.chord ?? chordIn(spans, beats);
      if (section.stops.has(b)) {
        const chord = chordIn(spans, 0);
        if (chord) {
          const voicing = voiceChord(chord, around);
          voicing.forEach((pitch) => push(`comp:${comp.name}`, 'comp', comp, { at: barStart, len: 0.45, pitch, velocity: 92 * touch }));
          push(`bass:${bass.name}`, 'bass', bass, { at: barStart, len: 0.45, pitch: bassRoot(chord.bass), velocity: 100 * touch });
        }
        if (drumsOn) for (const pitch of [36, 38, 46]) push('drums', 'drums', null, { at: barStart, len: 0.2, pitch, velocity: 100 * touch });
        continue;
      }
      const pick = (patterns: string[]) => patterns[b % patterns.length];
      // comp
      const cp = pick(groove.compPatterns[tier]);
      for (let i = 0; i < cp.length; i++) {
        const c = cp[i];
        if (c === '.' || c === '-') continue;
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
      const bp = pick(groove.bassPatterns[tier === 'lo' ? 'lo' : 'mid']);
      for (let i = 0; i < bp.length; i++) {
        const c = bp[i];
        if (c === '.' || c === '-') continue;
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
      const lastBar = b === section.barCount - 1 && next !== undefined && drumsOn && section.energy >= 2;
      const fillFrom = beats - (beats === 3 ? 1 : 2);
      for (const layer of groove.drums) {
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
      if (b === 0 && drumsOn && section.energy >= 4) push('drums', 'drums', null, { at: barStart, len: 1, pitch: 49, velocity: 88 * touch });
    }
  });

  for (const part of song.parts) {
    const name = part.drums ? 'drums' : part.name;
    for (const note of part.notes) {
      const energy = energyOfBeat(note.start);
      const onOne = Math.abs(note.start / beats - Math.round(note.start / beats)) < 1e-6;
      const base = part.drums ? 92 : part.lead ? 94 : 80;
      push(name, part.drums ? 'drums' : part.lead ? 'lead' : 'part', part.instrument, {
        at: note.start,
        len: part.drums ? 0.2 : note.len * (note.len <= 0.5 ? 0.86 : 0.96),
        pitch: note.pitch,
        velocity: base * (0.74 + 0.065 * energy) + (onOne ? 5 : 0),
      });
    }
  }

  const jitter: Record<Role, number> = { lead: 0.008, part: 0.008, comp: 0.007, bass: 0.005, drums: 0.004 };
  const tracks: Track[] = [];
  let end = 0;
  for (const [name, track] of band) {
    const strum = track.role === 'comp' && /guitar/.test(track.instrument?.name ?? '') ? 0.007 : 0.002;
    const notes = track.notes.map((n) => {
      const groove = grooveOfBeat(n.at);
      const shift = (random() - 0.5) * 2 * jitter[track.role] + (n.spread ?? 0) * strum;
      const at = Math.max(0, LEAD_IN + swung(n.at, groove) * spb + shift);
      const until = Math.max(at + 0.04, LEAD_IN + swung(n.at + n.len, groove) * spb);
      end = Math.max(end, until);
      return { at, until, pitch: n.pitch, velocity: Math.round(Math.min(127, Math.max(1, n.velocity + (random() - 0.5) * 10))) };
    });
    tracks.push({ name, role: track.role, instrument: track.instrument, notes });
  }
  return { tracks, seconds: Math.max(end, LEAD_IN + song.bars * beats * spb) + TAIL, secondsPerBeat: spb, leadIn: LEAD_IN };
}
