import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolCallContext, ToolOutcome } from 'cortico/core/types.ts';
import { dryMountWorld, fakeWorldContext } from 'cortico/extensions/dry-mount.ts';
import { COMPOSE } from '../src/definition.ts';
import { arrange } from '../src/arrange.ts';
import { measure } from '../src/facts.ts';
import { readSong, SheetError } from '../src/sheet.ts';
import { parseChord, parseKey, diatonicShift, parsePitch } from '../src/theory.ts';

let scratchDir: string;
beforeEach(() => { scratchDir = mkdtempSync(join(tmpdir(), 'compose-world-')); });
afterEach(() => rmSync(scratchDir, { recursive: true, force: true }));

const sheet = (over: Record<string, unknown> = {}) => ({
  title: 'T', tempo: 120, key: 'D major', lead: 'flute',
  sections: [{ name: 'A', groove: 'bossa', energy: 3, chords: 'Dmaj9 | Em9 A13', melody: '. F#5 A5 D6 - - E6 - | - . . C#6 B5 - . .' }],
  ...over,
});

describe('Compose World', () => {
  it('dry mount reports no failure', async () => {
    const report = await dryMountWorld(COMPOSE, { scratchDir });
    expect(report.failures).toEqual([]);
  });

  it('a sheet with problems is not rendered and the receipt lists every problem', async () => {
    const world = COMPOSE.create(fakeWorldContext(COMPOSE, { scratchDir }));
    const tool = world.tools().find((t) => t.name === 'compose_render')!;
    const out = await tool.handler(sheet({ sections: [{ name: 'A', groove: 'bosa', chords: 'Dmaj9 | Xq7', melody: 'F#5 A5 D6 E6 F#6 | H9 - - -' }] }), {} as ToolCallContext) as ToolOutcome;
    expect(out.failed).toBe(true);
    for (const piece of ['groove "bosa"', 'Xq7', '5 slots', '"H9"']) expect(out.text).toContain(piece);
  });
});

describe('playback and panel', () => {
  // rendering needs a SoundFont; these tests place a finished song's files instead
  const withSong = () => {
    const ctx = fakeWorldContext(COMPOSE, { scratchDir });
    ctx.persist({ outputDir: scratchDir, canPlay: false });
    writeFileSync(join(scratchDir, 'T.json'), JSON.stringify(sheet()));
    writeFileSync(join(scratchDir, 'T.wav'), Buffer.alloc(44));
    return COMPOSE.create(ctx);
  };
  const call = (world: ReturnType<typeof withSong>, name: string, args: Record<string, unknown>) =>
    world.tools().find((t) => t.name === name)!.handler(args, {} as ToolCallContext) as Promise<ToolOutcome>;

  it('with playback off, play and open report the file and start nothing', async () => {
    const world = withSong();
    for (const tool of ['compose_play', 'compose_open']) {
      const out = await call(world, tool, { title: 'T' });
      expect(out.text).toContain('[not played]');
      expect(out.text).toContain(join(scratchDir, 'T.wav'));
    }
    expect((await call(world, 'compose_stop', {})).text).toBe('Nothing was playing.');
  });

  it('the panel lists the song and returns its notes, sections and chords', async () => {
    const world = withSong();
    const invoke = world.webUi!('en').invoke!;
    const list = await invoke('songs', 'list', []) as { songs: Array<{ title: string; rendered: boolean }> };
    expect(list.songs.map((x) => [x.title, x.rendered])).toEqual([['T', true]]);
    const { view } = await invoke('songs', 'song', ['T']) as { view: { bars: number; chords: string[]; parts: Array<{ lead: boolean; notes: unknown[] }>; sections: Array<{ groove: string }> } };
    expect([view.bars, view.chords, view.sections[0].groove, view.parts.find((x) => x.lead)!.notes.length]).toEqual([2, ['Dmaj9', 'Em9 A13'], 'bossa', 6]);
  });

  it('a draft that does not read comes back as its problems', async () => {
    const world = withSong();
    writeFileSync(join(scratchDir, 'D.json'), JSON.stringify(sheet({ title: 'D', sections: [{ name: 'A', melody: 'C5 D5 E5 F5 G5' }] })));
    const out = await world.webUi!('en').invoke!('songs', 'song', ['D']) as { problems: string[] };
    expect(out.problems.join(' ')).toContain('5 slots');
  });
});

describe('sheet', () => {
  it('a hold at the start of a bar continues the note across the bar line', () => {
    const song = readSong(sheet());
    const lead = song.parts.find((p) => p.lead)!;
    expect(lead.notes.map((n) => [n.start, n.len])).toEqual([[0.5, 0.5], [1, 0.5], [1.5, 1.5], [3, 1.5], [5.5, 0.5], [6, 1]]);
  });

  it('a motif moved by scale steps stays in the key', () => {
    const song = readSong(sheet({ motifs: { m: 'D5 E5 F#5 G5' }, sections: [{ name: 'A', melody: '@m | @m+1 | @m-1' }] }));
    expect(song.parts[0].notes.map((n) => n.pitch)).toEqual(['D5', 'E5', 'F#5', 'G5', 'E5', 'F#5', 'G5', 'A5', 'C#5', 'D5', 'E5', 'F#5'].map((p) => parsePitch(p)));
  });

  it('like copies a section and keeps the fields given anew', () => {
    const song = readSong(sheet({ sections: [...(sheet().sections as object[]), { name: 'B', like: 'A', energy: 5 }] }));
    expect(song.sections.map((s) => [s.groove, s.energy, s.barCount])).toEqual([['bossa', 3, 2], ['bossa', 5, 2]]);
    expect(song.parts.find((p) => p.lead)!.notes).toHaveLength(12);
  });

  it('a groove in the wrong meter is a problem', () => {
    expect(() => readSong(sheet({ meter: '3/4', sections: [{ name: 'A', groove: 'bossa', chords: 'C' }] }))).toThrow(SheetError);
  });
});

describe('theory', () => {
  it('chord symbols name the expected pitch classes', () => {
    const pcs = (s: string) => [...parseChord(s).pcs].sort((a, b) => a - b);
    expect(pcs('Dmaj9')).toEqual([1, 2, 4, 6, 9]);
    expect(pcs('B7b9')).toEqual([0, 3, 6, 9, 11]);
    expect(pcs('F#m7b5')).toEqual([0, 4, 6, 9]);
    expect(pcs('Csus4')).toEqual([0, 5, 7]);
    expect(pcs('C6/9')).toEqual([0, 2, 4, 7, 9]);
    expect(parseChord('G/B').bass).toBe(11);
    expect(() => parseChord('Cxyz')).toThrow();
  });

  it('diatonic shift keeps a chromatic note its distance above the degree', () => {
    const key = parseKey('C major');
    expect(diatonicShift(parsePitch('F#4')!, 1, key)).toBe(parsePitch('G#4'));
    expect(diatonicShift(parsePitch('B4')!, 1, key)).toBe(parsePitch('C5'));
  });
});

describe('band', () => {
  it('a stop bar holds one hit per band track and nothing after beat 1', () => {
    const song = readSong(sheet({ sections: [{ name: 'A', groove: 'pop', energy: 4, chords: 'C | F | G | C', stops: [3] }, { name: 'B', groove: 'pop', energy: 4, chords: 'C' }] }));
    const a = arrange(song);
    const inBar3 = (at: number) => at >= a.barTimes[2] - 0.02 && at < a.barTimes[3] - 0.02;
    for (const track of a.tracks) for (const n of track.notes.filter((x) => inBar3(x.at))) expect(n.at).toBeLessThan(a.barTimes[2] + 0.05);
  });

  it('a long note a semitone above a chord tone is reported, a chord tone is not', () => {
    const song = readSong(sheet({ sections: [{ name: 'A', groove: 'pop', chords: 'Cmaj7 | Cmaj7', melody: 'F5 - - - | E5 - - -' }] }));
    expect(measure(song).outside.map((o) => o.bar)).toEqual([1]);
  });
});
