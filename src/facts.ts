/**
 * What can be measured about a song: lengths, levels, ranges, which notes fall outside their chord, which bars
 * repeat. The receipt states these and leaves the judging to the writer.
 */
import { GROOVES } from './grooves.ts';
import { chordAt, type Part, type Song } from './sheet.ts';
import { pitchClassName, pitchName } from './theory.ts';

export interface SectionFacts { name: string; bars: [number, number]; groove: string; energy: number; levelDb?: number }
export interface PartFacts { name: string; lead: boolean; notes: number; lowest: number; highest: number; outOfRange: number; silentBars: number }
export interface Outside { bar: number; beat: number; pitch: number; chord: string; beats: number }
export interface Facts {
  sections: SectionFacts[];
  parts: PartFacts[];
  /** Notes of a beat or longer, or starting on beat 1, whose pitch the chord symbol does not name and that sit a semitone above one it does. */
  outside: Outside[];
  /** Groups of bars (1-based) in which the lead plays exactly the same thing. */
  identicalBars: number[][];
  /** Lead bars that hold a note, and how many of them share their rhythm with another bar. */
  rhythm: { bars: number; distinct: number };
  leadSteps: { steps: number; leaps: number; repeats: number; widest: number };
}

function barKey(part: Part, bar: number, beats: number, withPitch: boolean): string {
  const from = bar * beats, to = from + beats;
  return part.notes.filter((n) => n.start >= from - 1e-9 && n.start < to - 1e-9)
    .map((n) => `${(n.start - from).toFixed(3)}:${n.len.toFixed(3)}${withPitch ? `:${n.pitch}` : ''}`).join(' ');
}

export function measure(song: Song): Facts {
  const beats = song.beatsPerBar;
  const sections = song.sections.map((s) => ({ name: s.name, bars: [s.firstBar + 1, s.firstBar + s.barCount] as [number, number], groove: s.groove, energy: s.energy }));
  const parts = song.parts.filter((p) => !p.drums && p.notes.length > 0).map((p) => {
    const pitches = p.notes.map((n) => n.pitch);
    const played = new Set(p.notes.map((n) => Math.floor(n.start / beats + 1e-9)));
    return {
      name: p.name, lead: p.lead, notes: p.notes.length, lowest: Math.min(...pitches), highest: Math.max(...pitches),
      outOfRange: p.notes.filter((n) => n.pitch < p.instrument!.lo || n.pitch > p.instrument!.hi).length,
      silentBars: song.bars - played.size,
    };
  });

  const outside: Outside[] = [];
  for (const part of song.parts) {
    if (part.drums) continue;
    for (const note of part.notes) {
      const inBar = note.start - Math.floor(note.start / beats + 1e-9) * beats;
      if (note.len < 1 - 1e-9 && inBar > 1e-9) continue;
      const chord = chordAt(song, note.start);
      if (!chord) continue;
      const pc = ((note.pitch % 12) + 12) % 12;
      if (chord.pcs.includes(pc) || !chord.pcs.includes((pc + 11) % 12)) continue;
      outside.push({ bar: Math.floor(note.start / beats + 1e-9) + 1, beat: inBar + 1, pitch: note.pitch, chord: chord.symbol, beats: note.len });
    }
  }

  const lead = song.parts.find((p) => p.lead && !p.drums) ?? song.parts.find((p) => !p.drums);
  const identicalBars: number[][] = [];
  const rhythm = { bars: 0, distinct: 0 };
  const leadSteps = { steps: 0, leaps: 0, repeats: 0, widest: 0 };
  if (lead) {
    const full = new Map<string, number[]>(), shapes = new Set<string>();
    for (let b = 0; b < song.bars; b++) {
      const key = barKey(lead, b, beats, true);
      if (key === '') continue;
      rhythm.bars++;
      shapes.add(barKey(lead, b, beats, false));
      full.set(key, [...(full.get(key) ?? []), b + 1]);
    }
    rhythm.distinct = shapes.size;
    for (const group of full.values()) if (group.length > 1) identicalBars.push(group);
    for (let i = 1; i < lead.notes.length; i++) {
      const d = Math.abs(lead.notes[i].pitch - lead.notes[i - 1].pitch);
      if (d === 0) leadSteps.repeats++; else if (d <= 2) leadSteps.steps++; else leadSteps.leaps++;
      leadSteps.widest = Math.max(leadSteps.widest, d);
    }
  }
  return { sections, parts, outside, identicalBars, rhythm, leadSteps };
}

const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

/** The measured facts as receipt lines. */
export function describeFacts(song: Song, facts: Facts, seconds: number): string[] {
  const flats = song.key?.flats ?? false;
  const lines: string[] = [];
  lines.push(`${clock(seconds)} long, ${song.bars} bars at ${song.tempo} bpm${song.key ? `, ${song.key.label}` : ''}.`);
  lines.push('Sections: ' + facts.sections.map((s) => {
    const band = GROOVES[s.groove] ? `${s.groove}, energy ${s.energy}` : 'no band';
    return `${s.name} bars ${s.bars[0]}-${s.bars[1]} (${band}${s.levelDb === undefined ? '' : `, ${s.levelDb.toFixed(1)} dB`})`;
  }).join('; ') + '.');
  for (const p of facts.parts) {
    const range = `${pitchName(p.lowest, flats)}–${pitchName(p.highest, flats)}`;
    lines.push(`${p.name}${p.lead ? ' (lead)' : ''}: ${p.notes} notes, ${range}, silent in ${p.silentBars} of ${song.bars} bars${p.outOfRange > 0 ? `, ${p.outOfRange} notes outside the instrument's range` : ''}.`);
  }
  if (facts.rhythm.bars > 0) {
    const s = facts.leadSteps;
    lines.push(`Lead: ${facts.rhythm.distinct} different bar rhythms over ${facts.rhythm.bars} bars with notes; ${s.steps} steps, ${s.leaps} leaps (widest ${s.widest} semitones), ${s.repeats} repeated notes.`);
  }
  if (facts.identicalBars.length > 0) {
    lines.push('Lead bars that are note-for-note the same: ' + facts.identicalBars.slice(0, 8).map((g) => g.join('=')).join(', ') + (facts.identicalBars.length > 8 ? ', …' : '') + '.');
  }
  if (facts.outside.length > 0) {
    const shown = facts.outside.slice(0, 10).map((o) => `bar ${o.bar} beat ${Number(o.beat.toFixed(2))} ${pitchName(o.pitch, flats)} over ${o.chord}`);
    lines.push(`Long or downbeat notes a semitone above a chord tone and not named by the chord (${facts.outside.length}): ${shown.join('; ')}${facts.outside.length > 10 ? '; …' : ''}.`);
  }
  for (const note of song.notes) lines.push(`Note: ${note}.`);
  return lines;
}

export { pitchClassName };
