/** What the WebUI panel draws for one song: the written notes on a time axis, the sections, and the measured facts. */
import { describeFacts, measure } from './facts.ts';
import type { Song } from './sheet.ts';

export interface SongView {
  title: string;
  tempo: number;
  key: string | null;
  beatsPerBar: number;
  bars: number;
  /** Seconds of silence before bar 1 in the rendered audio. */
  leadIn: number;
  sections: Array<{ name: string; firstBar: number; barCount: number; groove: string; energy: number; levelDb: number | null }>;
  /** One string per bar. */
  chords: string[];
  /** Notes as [start beat, length in beats, pitch]. */
  parts: Array<{ name: string; lead: boolean; drums: boolean; notes: Array<[number, number, number]> }>;
  /** Start beat and pitch of each note the receipt lists as outside its chord. */
  outside: Array<[number, number]>;
  facts: string[];
}

/** Seconds before bar 1; `arrange` starts every song after the same pause. */
export const LEAD_IN_SECONDS = 0.3;

export function songView(song: Song, levels: Array<number | null>): SongView {
  const facts = measure(song);
  facts.sections.forEach((s, i) => { if (typeof levels[i] === 'number') s.levelDb = levels[i] as number; });
  const chords: string[] = [];
  for (const section of song.sections) {
    for (let b = 0; b < section.barCount; b++) chords.push((section.chords[b] ?? []).map((span) => span.chord?.symbol ?? 'N.C.').filter((c, i, all) => i === 0 || c !== all[i - 1]).join(' '));
  }
  const seconds = LEAD_IN_SECONDS + song.bars * song.beatsPerBar * 60 / song.tempo;
  return {
    title: song.title, tempo: song.tempo, key: song.key?.label ?? null, beatsPerBar: song.beatsPerBar, bars: song.bars, leadIn: LEAD_IN_SECONDS,
    sections: song.sections.map((s, i) => ({ name: s.name, firstBar: s.firstBar, barCount: s.barCount, groove: s.groove, energy: s.energy, levelDb: levels[i] ?? null })),
    chords,
    parts: song.parts.map((p) => ({ name: p.name, lead: p.lead, drums: p.drums, notes: p.notes.map((n) => [n.start, n.len, n.pitch] as [number, number, number]) })),
    outside: facts.outside.map((o) => [(o.bar - 1) * song.beatsPerBar + o.beat - 1, o.pitch] as [number, number]),
    facts: describeFacts(song, facts, seconds),
  };
}
