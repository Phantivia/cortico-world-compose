/**
 * Measures every finished run under bench/runs and prints one table row per run. What it counts is what a
 * program can count: whether a song came out, how many tries it took, its form and levels, how the lead moves.
 * Whether it is pleasant to hear is not in the table.
 *
 *   tsx bench/score.ts            -> table on stdout, bench/runs/scores.json
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { arrange } from '../src/arrange.ts';
import { measure } from '../src/facts.ts';
import { readSong, type Song } from '../src/sheet.ts';
import { levelDb, render, SoundFont } from '../src/synth.ts';
import { soundfontFile } from './local.ts';

const RUNS = fileURLToPath(new URL('./runs/', import.meta.url));
const SOUNDFONT = soundfontFile();
const bank = new SoundFont().load(SOUNDFONT);
const BASS = new Set(['acoustic bass', 'electric bass', 'fretless bass', 'synth bass']);

interface Row { [key: string]: string | number | boolean }
const rows: Row[] = [];

for (const name of readdirSync(RUNS).sort()) {
  const run = join(RUNS, name);
  if (!existsSync(join(run, 'result.json'))) continue;
  const result = JSON.parse(readFileSync(join(run, 'result.json'), 'utf8'));
  const usage = result.usage?.successful;
  const row: Row = { run: name, ended: result.ended, sec: result.seconds, calls: usage?.calls ?? 0, outTok: usage?.completionTokens ?? 0, usd: Number((usage?.cost ?? 0).toFixed(4)) };
  let renders = 0, failed = 0;
  const runsDir = join(run, 'home', 'companion', 'data', 'runs');
  for (const id of existsSync(runsDir) ? readdirSync(runsDir) : []) {
    const file = join(runsDir, id, 'toolcalls.jsonl');
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
      const call = JSON.parse(line);
      if (call.tool !== 'compose_render') continue;
      renders++;
      if (String(call.receipt).startsWith('[not rendered]')) failed++;
    }
  }
  row.renders = renders;
  row.failed = failed;
  const out = join(run, 'out');
  const sheets = existsSync(out) ? readdirSync(out).filter((f) => f.endsWith('.json') && !/\.v\d+\.json$/.test(f)) : [];
  row.songs = sheets.length;
  if (sheets.length > 0) {
    // the song rendered last is the one the bot left as its answer
    const latest = sheets.map((f) => ({ f, t: readFileSync(join(out, f), 'utf8') })).sort((a, b) => b.t.length - a.t.length)[0];
    const args = JSON.parse(latest.t);
    const sheet = args.tracks ? { title: args.title, tempo: args.tempo, meter: args.meter, sections: [{ name: 'song', groove: 'none', parts: args.tracks }] } : args;
    let song: Song | null = null;
    try { song = readSong(sheet); } catch { /* the stored sheet always rendered once */ }
    if (song) {
      const arrangement = arrange(song);
      const audio = await render(arrangement, bank);
      const facts = measure(song);
      const barSeconds = arrangement.secondsPerBeat * song.beatsPerBar;
      const levels = facts.sections.map((s) => levelDb(audio, arrangement.leadIn + (s.bars[0] - 1) * barSeconds, arrangement.leadIn + s.bars[1] * barSeconds));
      // without sections, level over each quarter of the song stands in for them
      const quarters = [0, 1, 2, 3].map((q) => levelDb(audio, arrangement.leadIn + (q * song!.bars / 4) * barSeconds, arrangement.leadIn + ((q + 1) * song!.bars / 4) * barSeconds));
      const spread = (v: number[]) => Number((Math.max(...v) - Math.min(...v)).toFixed(1));
      const leadNotes = facts.parts.find((p) => p.lead)?.notes ?? Math.max(0, ...facts.parts.map((p) => p.notes));
      const repeated = facts.identicalBars.reduce((n, g) => n + g.length, 0);
      Object.assign(row, {
        seconds: Math.round(audio.seconds - 2.5), bars: song.bars, sections: song.sections.length,
        grooves: new Set(song.sections.map((s) => s.groove)).size,
        energies: new Set(song.sections.map((s) => s.energy)).size,
        levelSpread: song.sections.length > 1 ? spread(levels) : spread(quarters),
        instruments: song.parts.filter((p) => !p.drums).length,
        hasBass: arrangement.tracks.some((t) => t.role === 'bass' || BASS.has(t.instrument?.name ?? '')),
        hasDrums: arrangement.tracks.some((t) => t.role === 'drums'),
        leadNotes,
        rhythms: `${facts.rhythm.distinct}/${facts.rhythm.bars}`,
        sameBars: facts.rhythm.bars > 0 ? Number((repeated / facts.rhythm.bars).toFixed(2)) : 0,
        leapShare: Number((facts.leadSteps.leaps / Math.max(1, facts.leadSteps.leaps + facts.leadSteps.steps)).toFixed(2)),
        clashes: facts.outside.length,
        motifs: Object.keys(args.motifs ?? {}).length,
        likes: (args.sections ?? []).filter((s: { like?: string }) => s.like).length,
        stops: (args.sections ?? []).filter((s: { stops?: number[] }) => (s.stops ?? []).length > 0).length,
      });
    }
  }
  rows.push(row);
}

const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
console.log(columns.join('\t'));
for (const r of rows) console.log(columns.map((c) => String(r[c] ?? '')).join('\t'));
writeFileSync(join(RUNS, 'scores.json'), JSON.stringify(rows, null, 2) + '\n');
