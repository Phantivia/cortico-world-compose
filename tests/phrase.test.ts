import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolCallContext, ToolOutcome, WorldHost } from 'cortico/core/types.ts';
import { fakeWorldContext } from 'cortico/extensions/dry-mount.ts';
import { COMPOSE } from '../src/definition.ts';
import { describeTake, phraseSheet, readTake, takeLines } from '../src/phrase.ts';
import { readSong } from '../src/sheet.ts';

let scratchDir: string;
beforeEach(() => { scratchDir = mkdtempSync(join(tmpdir(), 'compose-phrase-')); });
afterEach(() => rmSync(scratchDir, { recursive: true, force: true }));

const world = () => {
  const ctx = fakeWorldContext(COMPOSE, { scratchDir });
  ctx.persist({ outputDir: scratchDir, canPlay: false });
  return COMPOSE.create(ctx);
};

describe('a take from the keyboard', () => {
  // 120 bpm: a sixteenth is 0.125 s, a bar of 4/4 is 2 s
  const played = { tempo: 120, meter: '4/4', notes: [[0.02, 0.47, 60], [0.49, 0.5, 64], [1.01, 0.95, 67], [2.0, 2.0, 60], [2.0, 2.0, 64], [2.26, 0.2, 72], [3.13, 0.1, 74]] };

  it('is written on the sixteenth grid, coarser where a bar allows, with overlapping notes on a second line', () => {
    const lines = takeLines(readTake(played)!)!;
    expect(lines).toEqual([
      'C4 E4 G4 - | C4+E4',
      '. | . . C5 - . . . . . D5 . . . . . .',
    ]);
    // the lines read back as the notes that were played
    const song = readSong(phraseSheet({ name: 'take1', take: readTake(played)!, lines }));
    expect(song.parts.flatMap((p) => p.notes.map((n) => [n.start, n.len, n.pitch])).sort((a, b) => a[0] - b[0] || a[2] - b[2]))
      .toEqual([[0, 1, 60], [1, 1, 64], [2, 2, 67], [4, 4, 60], [4, 4, 64], [4.5, 0.5, 72], [6.25, 0.25, 74]]);
  });

  it('without a metronome has no lines: the event gives the notes as played and promises no "@name"', () => {
    const take = readTake({ ...played, tempo: null })!;
    expect(takeLines(take)).toBeNull();
    const text = describeTake('take1', take, null);
    expect(text).toContain('in free time');
    expect(text).toContain('0.02 0.47 C4');
    expect(text).not.toContain('@take1');
  });

  it('arriving through the panel is kept in the notebook and delivered as one event', async () => {
    const w = world();
    const pushed: Array<{ type: string; text: string; origin?: string }> = [];
    await w.start({ pushEvent: async (e: { type: string; text: string }) => { pushed.push(e); return e; } } as unknown as WorldHost);
    const invoke = w.webUi!('en').invoke!;
    const answer = await invoke('keyboard', 'take', [played]) as { name: string; delivered: boolean };
    expect(answer).toMatchObject({ name: 'take1', delivered: true });
    expect(pushed.map((e) => [e.type, e.origin])).toEqual([['compose.take', 'internal']]);
    expect(pushed[0].text).toContain('piano: C4 E4 G4 - | C4+E4');
    const list = await invoke('keyboard', 'phrases', []) as { phrases: Array<{ name: string; played: boolean }> };
    expect(list.phrases.map((p) => [p.name, p.played])).toEqual([['take1', true]]);
    await expect(invoke('keyboard', 'take', [{ notes: [] }])).rejects.toThrow('no notes');
  });
});

describe('a phrase in a song', () => {
  const call = (w: ReturnType<typeof world>, name: string, args: Record<string, unknown>) =>
    w.tools().find((t) => t.name === name)!.handler(args, {} as ToolCallContext) as Promise<ToolOutcome>;
  const song = { title: 'S', tempo: 100, key: 'C major', lead: 'flute', sections: [{ name: 'A', groove: 'none', melody: '@hook | @hook+1' }] };

  it('"@name" stands for a phrase of the notebook', async () => {
    const w = world();
    // without the phrase the bar is an unknown motif
    expect((await call(w, 'compose_render', song)).text).toContain('hook');
    expect((await call(w, 'compose_render', song)).text).toMatch(/\d problems?:/);
    mkdirSync(join(scratchDir, 'phrases'), { recursive: true });
    // a phrase that itself names a phrase
    writeFileSync(join(scratchDir, 'phrases', 'seed.json'), JSON.stringify({ name: 'seed', tempo: 100, line: 'C5 D5 E5 -' }));
    writeFileSync(join(scratchDir, 'phrases', 'hook.json'), JSON.stringify({ name: 'hook', tempo: 100, line: '@seed' }));
    // rendered where a SoundFont is present, read without problems where it is not
    expect((await call(w, 'compose_render', song)).text).not.toMatch(/\d problems?:/);
  });

  it('a phrase with a name "@" cannot spell is refused before anything is written', async () => {
    const out = await call(world(), 'compose_phrase', { name: 'my hook', tempo: 100, line: 'C5 D5 E5 -' });
    expect(out.failed).toBe(true);
    expect(out.text).toContain('letters, digits and underscores');
  });

  it('a phrase that does not read comes back as its problems', async () => {
    const out = await call(world(), 'compose_phrase', { name: 'hook', tempo: 100, line: 'C5 D5 E5 F5 G5' });
    expect(out.failed).toBe(true);
    expect(out.text).toContain('5 slots');
  });
});
