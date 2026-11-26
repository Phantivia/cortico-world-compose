import { describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import type { ToolCallContext, ToolOutcome } from 'cortico/core/types.ts';
import { fakeWorldContext } from 'cortico/extensions/dry-mount.ts';
import { COMPOSE } from '../src/definition.ts';
import {
  catalogEntries,
  COMMON_INSTRUMENT_NAMES,
  findInstrument,
  INSTRUMENT_CATALOG,
  instrumentOfProgram,
  parseCategory,
  plainName,
} from '../src/instruments.ts';

describe('instrument catalog', () => {
  it('has all 128 General MIDI programs once, and every canonical name resolves to its program', () => {
    expect(INSTRUMENT_CATALOG).toHaveLength(128);
    expect(new Set(INSTRUMENT_CATALOG.map((entry) => entry.program)).size).toBe(128);
    expect(INSTRUMENT_CATALOG.map((entry) => entry.program).sort((a, b) => a - b)).toEqual([...Array(128).keys()]);
    for (const entry of INSTRUMENT_CATALOG) {
      const found = findInstrument(entry.name);
      expect([entry.name, found?.program]).toEqual([entry.name, entry.program]);
    }
  });

  it('keeps names and aliases unique', () => {
    const seen = new Set<string>();
    for (const entry of INSTRUMENT_CATALOG) {
      for (const name of [entry.name, ...entry.aliases]) {
        const key = plainName(name);
        expect(seen.has(key), `${name} repeats ${key}`).toBe(false);
        seen.add(key);
      }
    }
  });

  it('reads the names that used to need a gm number', () => {
    expect(findInstrument('tubular bells')?.program).toBe(14);
    expect(findInstrument('church organ')?.program).toBe(19);
    expect(findInstrument('baritone sax')?.program).toBe(67);
    expect(findInstrument('distortion guitar')?.program).toBe(30);
    expect(findInstrument('overdrive guitar')?.program).toBe(29);
    expect(findInstrument('gm 105')?.program).toBe(105);
    expect(findInstrument('program #127')?.program).toBe(127);
    expect(findInstrument('gm 128')).toBeNull();
  });

  it('maps programs back to their names', () => {
    expect(instrumentOfProgram(14).name).toBe('tubular bells');
    expect(instrumentOfProgram(30).name).toBe('distortion guitar');
    expect(instrumentOfProgram(100).name).toBe('brightness fx');
    expect(instrumentOfProgram(127).name).toBe('gunshot');
  });

  it('filters by category, query and program without listing the whole table by default', () => {
    expect(catalogEntries({ category: 'strings' })).toHaveLength(8);
    expect(catalogEntries({ category: 'synth lead' })).toHaveLength(8);
    expect(catalogEntries({ category: 'drums' }).map((entry) => entry.name)).toEqual(['drums']);
    expect(catalogEntries({ program: 127 }).map((entry) => [entry.name, entry.anyRange])).toEqual([['gunshot', true]]);
    expect(catalogEntries({ query: 'bell' }).some((entry) => entry.name === 'tubular bells')).toBe(true);
    expect(parseCategory('percussion')).toBe('percussive');
    expect(parseCategory('synth fx')).toBe('synth effects');
    expect(parseCategory('drums')).toBe('drums');
    expect(parseCategory('not a family')).toBeNull();
  });

  it('keeps the common names in the tool description valid', () => {
    for (const name of COMMON_INSTRUMENT_NAMES) expect(findInstrument(name), name).not.toBeNull();
  });
});

describe('compose_instruments tool', () => {
  const call = async (args: Record<string, unknown>) => {
    const world = COMPOSE.create(fakeWorldContext(COMPOSE, { scratchDir: tmpdir() }));
    const tool = world.tools().find((t) => t.name === 'compose_instruments')!;
    return await tool.handler(args, {} as ToolCallContext) as ToolOutcome;
  };

  it('without arguments gives category counts instead of 128 rows', async () => {
    const out = await call({});
    expect(out.failed).toBeFalsy();
    expect(out.text).toContain('Categories:');
    expect(out.text).toContain('piano 8');
    expect(out.text).toContain('drums 1');
    expect(out.text).not.toContain('tubular bells');
  });

  it('filters to a few names and includes program, range and aliases', async () => {
    const out = await call({ query: 'tubular' });
    expect(out.text).toContain('tubular bells | gm 14 | 60–96');
    expect(out.text).toContain('chimes');
  });

  it('rejects an unknown category and an out-of-range program', async () => {
    expect((await call({ category: 'brass band' })).failed).toBe(true);
    expect((await call({ program: 128 })).failed).toBe(true);
  });
});
