/**
 * Measures every finished run under bench/runs and prints one table row per run. What it counts is what a
 * program can count: whether a song came out, how many tries it took, its form and levels, how the lead moves,
 * and which of the optional freedoms the song used. Whether it is pleasant to hear is not in the table.
 *
 *   tsx bench/score.ts [runs dir]     -> table on stdout, <runs dir>/scores.json and scores.tsv
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { arrange } from '../src/arrange.ts';
import { measure } from '../src/facts.ts';
import { GROOVES } from '../src/grooves.ts';
import { findInstrument } from '../src/instruments.ts';
import type { Song } from '../src/sheet.ts';
import { levelDb, render, SoundFont } from '../src/synth.ts';
import { readStored } from '../src/world.ts';
import { soundfontFile } from './local.ts';

const RUNS = process.argv[2] ?? fileURLToPath(new URL('./runs/', import.meta.url));
const bank = new SoundFont().load(soundfontFile());

interface Row { [key: string]: string | number | boolean }
const rows: Row[] = [];

for (const name of readdirSync(RUNS).sort()) {
  const run = join(RUNS, name);
  if (!existsSync(join(run, 'result.json'))) continue;
  const result = JSON.parse(readFileSync(join(run, 'result.json'), 'utf8'));
  const usage = result.usage?.successful;
  const row: Row = {
    run: name, endpoint: result.endpoint ?? 'deepseek', variant: result.variant, task: result.task, ended: result.ended, sec: result.seconds,
    calls: usage?.calls ?? 0, outTok: usage?.completionTokens ?? 0, thinkTok: usage?.reasoningTokens ?? 0, usd: Number((usage?.cost ?? 0).toFixed(4)),
  };
  let renders = 0, failed = 0, revises = 0;
  const runsDir = join(run, 'home', 'companion', 'data', 'runs');
  for (const id of existsSync(runsDir) ? readdirSync(runsDir) : []) {
    const file = join(runsDir, id, 'toolcalls.jsonl');
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
      const call = JSON.parse(line);
      if (call.tool !== 'compose_render' && call.tool !== 'compose_revise') continue;
      if (call.tool === 'compose_render') renders++; else revises++;
      if (/^\[not (rendered|found)\]/.test(String(call.receipt))) failed++;
    }
  }
  Object.assign(row, { renders, revises, failed });
  const out = join(run, 'out');
  const wavs = existsSync(out) ? readdirSync(out).filter((f) => f.endsWith('.wav')).map((f) => ({ f, t: statSync(join(out, f)).mtimeMs })).sort((a, b) => b.t - a.t) : [];
  row.songs = wavs.length;
  if (wavs.length > 0) {
    // the song rendered last is the one the bot left as its answer
    const stored = JSON.parse(readFileSync(join(out, wavs[0].f.replace(/\.wav$/, '.json')), 'utf8'));
    let song: Song | null = null;
    try { song = readStored(stored); } catch { /* a draft written after the last good render */ }
    if (song) {
      const arrangement = arrange(song);
      const audio = await render(arrangement, bank);
      const facts = measure(song);
      const levels = facts.sections.map((s) => levelDb(audio, arrangement.barTimes[s.bars[0] - 1], arrangement.barTimes[s.bars[1]]));
      // without sections, level over each quarter of the song stands in for them
      const end = arrangement.barTimes[song.bars], start = arrangement.leadIn;
      const quarters = [0, 1, 2, 3].map((q) => levelDb(audio, start + (q * (end - start)) / 4, start + ((q + 1) * (end - start)) / 4));
      const spread = (v: number[]) => Number((Math.max(...v) - Math.min(...v)).toFixed(1));
      const repeated = facts.identicalBars.reduce((n, g) => n + g.length, 0);
      const distinct = [...new Map(song.sections.map((s) => [s.name, s])).values()];
      // a section's band counts as changed when a role of its groove is off or on another instrument
      const changed = distinct.filter((s) => {
        const g = GROOVES[s.groove];
        return g && (s.band.chords?.name !== findInstrument(g.comp)!.name || s.band.bass?.name !== findInstrument(g.bass)!.name || !s.band.drums || !s.band.fills);
      }).length;
      const written = song.parts.filter((p) => !p.drums && p.notes.length > 0);
      // a written line counts as a bass line when it is on a bass instrument or half its notes sit at D3 or below
      const low = written.filter((p) => !p.lead && (/bass/.test(p.name) || [...p.notes].sort((a, b) => a.pitch - b.pitch)[Math.floor(p.notes.length / 2)].pitch <= 50)).length;
      Object.assign(row, {
        seconds: Math.round(end - start), bars: song.bars, sections: distinct.length,
        grooves: new Set(song.sections.map((s) => s.groove)).size,
        energies: new Set(song.sections.map((s) => s.energy)).size,
        meters: [...new Set(song.sections.map((s) => s.meter))].join(' '),
        levelSpread: song.sections.length > 1 ? spread(levels) : spread(quarters),
        lines: written.length,
        hasBass: arrangement.tracks.some((t) => t.role === 'bass') || low > 0,
        hasDrums: arrangement.tracks.some((t) => t.role === 'drums'),
        leadNotes: facts.parts.find((p) => p.lead)?.notes ?? 0,
        rhythms: `${facts.rhythm.distinct}/${facts.rhythm.bars}`,
        sameBars: facts.rhythm.bars > 0 ? Number((repeated / facts.rhythm.bars).toFixed(2)) : 0,
        leapShare: Number((facts.leadSteps.leaps / Math.max(1, facts.leadSteps.leaps + facts.leadSteps.steps)).toFixed(2)),
        clashes: facts.outside.length,
        outOfRange: facts.parts.reduce((n, p) => n + p.outOfRange, 0),
        motifs: Object.keys(stored.motifs ?? {}).length,
        stops: song.sections.filter((s) => s.stops.size > 0).length,
        // freedoms taken
        noBand: distinct.filter((s) => !GROOVES[s.groove]).length,
        bandChanged: changed,
        lowLines: low,
        drumNotes: song.parts.filter((p) => p.drums).reduce((n, p) => n + p.notes.length, 0),
        uses: Object.entries(song.uses).map(([k, v]) => `${k}:${v}`).join(' '),
      });
    }
  }
  rows.push(row);
}

const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
const table = [columns.join('\t'), ...rows.map((r) => columns.map((c) => String(r[c] ?? '')).join('\t'))].join('\n');
console.log(table);
writeFileSync(join(RUNS, 'scores.json'), JSON.stringify(rows, null, 2) + '\n');
writeFileSync(join(RUNS, 'scores.tsv'), table + '\n');
