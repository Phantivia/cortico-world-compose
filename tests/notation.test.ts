import { describe, it, expect } from 'vitest';
import { readAbc } from '../src/abc.ts';
import { arrange } from '../src/arrange.ts';
import { parseScore, writeScore } from '../src/score.ts';
import { readSong, SheetError, type Song } from '../src/sheet.ts';
import { parsePitch } from '../src/theory.ts';

const sheet = (sections: Array<Record<string, unknown>>, over: Record<string, unknown> = {}) => ({ title: 'T', tempo: 120, key: 'C major', lead: 'piano', sections, ...over });
const part = (song: Song, name: string) => song.parts.find((p) => p.name === name)!;
const spelled = (song: Song, name: string) => part(song, name).notes.map((n) => [n.start, n.len, n.pitch]);
const p = (name: string) => parsePitch(name)!;
const problemsOf = (run: () => unknown): string => { try { run(); return ''; } catch (e) { return (e as SheetError).problems.join('\n'); } };

describe('line notation', () => {
  it('a group shares its slot, stacked pitches start together and a hold lengthens all of them', () => {
    const song = readSong(sheet([{ name: 'A', melody: 'C5 [D5 E5 F5] G5+B5 -' }]));
    expect(spelled(song, 'piano')).toEqual([
      [0, 1, p('C5')], [1, 1 / 3, p('D5')], [1 + 1 / 3, 1 / 3, p('E5')], [1 + 2 / 3, 1 / 3, p('F5')], [2, 2, p('G5')], [2, 2, p('B5')],
    ]);
  });

  it('a dynamic mark takes no slot and sets the velocity until the next one; a hairpin ramps to it', () => {
    const song = readSong(sheet([{ name: 'A', melody: '(p) C5 D5 (<) E5 F5 | G5 A5 (f) B5 C6', parts: { flute: 'C5 D5 E5 F5 | %' } }]));
    // the hairpin starts on E5 at (p) = 56 and arrives at (f) = 98 four beats later, on B5
    expect(part(song, 'piano').notes.map((n) => n.velocity)).toEqual([56, 56, 56, 67, 77, 88, 98, 98]);
    expect(part(song, 'flute').notes.every((n) => n.velocity === undefined)).toBe(true);
  });

  it('a dynamic mark may stand in front of a motif bar', () => {
    const song = readSong(sheet([{ name: 'A', melody: '(p) @m | (f) @m+1' }], { motifs: { m: 'C5 D5 E5 F5' } }));
    expect(part(song, 'piano').notes.map((n) => [n.pitch, n.velocity])).toEqual([[p('C5'), 56], [p('D5'), 56], [p('E5'), 56], [p('F5'), 56], [p('D5'), 98], [p('E5'), 98], [p('F5'), 98], [p('G5'), 98]]);
  });

  it('beside a melody, a line under the lead instrument\'s name is a line of its own', () => {
    const song = readSong(sheet([{ name: 'A', melody: 'E5 - - -', parts: { piano: 'C3 G3 C4 G3' } }, { name: 'B', parts: { piano: 'C5 D5 E5 F5' } }]));
    // section B has no melody, so its piano line is the lead's
    expect(song.parts.map((x) => [x.name, x.lead, x.notes.length])).toEqual([['piano', true, 5], ['piano:2', false, 4]]);
  });

  it('instrument names read the same with quotes around them or an underscore inside', () => {
    const song = readSong(sheet([{ name: 'A', groove: 'pop', chords: 'C', melody: 'C5 - - -', band: { chords: '"electric piano"' }, parts: { '"synth pad"': 'C4 - - -', synth_lead: 'C5 - - -' } }]));
    expect(song.parts.map((x) => x.name)).toEqual(['piano', 'synth pad', 'synth lead']);
    expect(song.sections[0].band.chords?.name).toBe('electric piano');
  });

  it('a label gives an instrument a second line, and labelled drum lines play as one kit', () => {
    const song = readSong(sheet([{ name: 'A', melody: 'C5 - - -', parts: { 'piano:left': 'C3+G3 - - -', 'drums:hats': 'H H H H', drums: 'K . 56 .' } }]));
    expect(song.parts.map((x) => x.name)).toEqual(['piano', 'piano:left', 'drums:hats', 'drums']);
    expect(arrange(song).tracks.map((t) => [t.name, t.notes.length])).toEqual([['piano', 1], ['piano:left', 2], ['drums', 6]]);
  });
});

describe('sections of their own', () => {
  it('meter and tempo may change with the section, and bars are timed by them', () => {
    const song = readSong(sheet([
      { name: 'A', melody: 'C5 D5 E5 F5' },
      { name: 'B', meter: '6/8', tempo: 90, melody: 'C5 D5 E5 F5 G5 A5 | C5 - - D5 - -' },
      { name: 'C', meter: '7/8', groove: 'ambient', chords: 'Am', melody: 'A4 B4 C5 D5 E5 F5 G5' },
    ]));
    expect(song.sections.map((s) => [s.firstBeat, s.beats, s.tempo])).toEqual([[0, 4, 120], [4, 3, 90], [10, 3.5, 120]]);
    const times = arrange(song).barTimes.map((t) => Number((t - 0.3).toFixed(3)));
    expect(times).toEqual([0, 2, 4, 6, 7.75]);
  });

  it('a slot count that is no note value of the meter is a problem, and so is a groove in another meter', () => {
    const problems = problemsOf(() => readSong(sheet([{ name: 'A', meter: '3/4', groove: 'bossa', chords: 'C', melody: 'C5 D5 E5 F5' }])));
    expect(problems).toContain('4 slots');
    expect(problems).toContain('groove "bossa" is in 4/4');
  });
});

describe('band', () => {
  const tracks = (band: Record<string, string> | undefined) =>
    arrange(readSong(sheet([{ name: 'A', groove: 'pop', energy: 5, chords: 'C | F | G | C', band }, { name: 'B', groove: 'pop', energy: 5, chords: 'C' }]))).tracks;

  it('each role of the groove can be silenced or, for chords and bass, handed to another instrument', () => {
    expect(tracks(undefined).map((t) => t.name).sort()).toEqual(['bass:electric bass', 'comp:piano', 'drums']);
    expect(tracks({ bass: 'off', chords: 'vibraphone' }).map((t) => t.name).sort()).toEqual(['bass:electric bass', 'comp:piano', 'comp:vibraphone', 'drums']);
    // section B keeps the whole band, so the tracks above still exist; section A's four bars hold no bass note
    const a = arrange(readSong(sheet([{ name: 'A', groove: 'pop', energy: 5, chords: 'C | F | G | C', band: { bass: 'off', drums: 'off' } }])));
    expect(a.tracks.map((t) => t.name)).toEqual(['comp:piano']);
  });

  it('without fills the bar before the next section has no toms and the section opens without a crash', () => {
    const kit = (band?: Record<string, string>) => new Set(tracks(band).find((t) => t.name === 'drums')!.notes.map((n) => n.pitch));
    expect([...kit()].filter((n) => [43, 45, 48, 49, 50].includes(n)).length).toBeGreaterThan(0);
    const plain = arrange(readSong(sheet([{ name: 'A', groove: 'pop', energy: 5, chords: 'C | F', band: { fills: 'off' } }, { name: 'B', groove: 'pop', energy: 5, chords: 'C', band: { fills: 'off' } }])));
    expect(plain.tracks.find((t) => t.name === 'drums')!.notes.some((n) => [43, 45, 48, 49, 50].includes(n.pitch))).toBe(false);
  });
});

describe('score text', () => {
  const text = [
    'title: Gate 12', 'tempo: 132', 'key: D major', 'lead: flute', 'form: A A B', 'motif hop: D5 . F#5 . A5 - - - | G5 - E5 - D5 - - -', '',
    '[A] groove=bossa energy=3', 'chords: Dmaj9 | Em9 A13', 'melody: . F#5 A5 D6 - - E6 - | - . . C#6 B5 - . .', '',
    'chords: Dmaj9 | Em9 A13 | Dmaj9', 'melody: @hop | D6 - - -', 'vibraphone: . | . . . . G5 - - - | A5 - - -', 'band: bass=off', '',
    '[B like A] bossa 4 tempo=140', 'stops: 2', 'piano:left: D3+A3 - - - |', '  E3+B3 - A2+E3 -',
  ].join('\n');

  it('reads to the same song as the fields it stands for', () => {
    const { sheet: read, problems } = parseScore(text);
    expect(problems).toEqual([]);
    const song = readSong(read);
    expect(song.sections.map((s) => [s.name, s.groove, s.energy, s.barCount, s.tempo, s.band.bass?.name ?? null])).toEqual([
      ['A', 'bossa', 3, 5, 132, null], ['A', 'bossa', 3, 5, 132, null], ['B', 'bossa', 4, 5, 140, null],
    ]);
    expect(song.sections[2].stops.has(1)).toBe(true);
  });

  it('a part first written in a later system starts at that system\'s first bar', () => {
    const song = readSong(parseScore(text).sheet);
    // system 2 of section A begins at bar 3; the vibraphone's own first bar there is a rest
    expect(spelled(song, 'vibraphone').slice(0, 2)).toEqual([[14, 2, p('G5')], [16, 4, p('A5')]]);
  });

  it('written back out and read again gives the same notes', () => {
    const first = readSong(parseScore(text).sheet);
    const second = readSong(parseScore(writeScore(parseScore(text).sheet)).sheet);
    expect(second.parts.map((x) => [x.name, x.notes])).toEqual(first.parts.map((x) => [x.name, x.notes]));
    expect(second.sections.map((s) => [s.name, s.tempo, s.chords])).toEqual(first.sections.map((s) => [s.name, s.tempo, s.chords]));
  });

  it('a line that begins in a later system and runs past the section is told where it was placed', () => {
    const written = '[A] groove=pop\nchords: C | F\nmelody: C5 - - - | C5 - - -\n\nchords: G | C\nflute: . | . | C6 - - - | C6 - - -';
    expect(parseScore(written).problems.join(' ')).toContain('its first bar is bar 3 of the section');
  });

  it('a line that is neither a header nor inside a section is a problem', () => {
    expect(parseScore('tempo: 100\nmelody: C5 D5 E5 F5').problems.join(' ')).toContain('no section has begun');
  });
});

describe('ABC', () => {
  const abc = [
    'X:1', 'T:Small Tune', 'M:4/4', 'L:1/8', 'Q:1/4=100', 'V:1 name="Flute"', 'V:2 name="Acoustic Bass" clef=bass', 'K:D',
    '%%groove bossa 3', '%%band bass=off', 'P:A',
    '[V:1] A2 |: "D"d2 fe d2 (3ABc | "G"B4- B2 z2 |1 "A7"c2 e2 a2 g2 :|2 "A7"c2 e2 "D"d4 |]',
    '[V:2] z2 |: D,4 A,,4 | G,,4 D,4 |1 A,,4 E,4 :|2 A,,4 D,4 |]',
  ].join('\n');

  it('key signature, lengths, a tie, a triplet and a pickup bar land where the notation puts them', () => {
    const song = readAbc(abc);
    expect([song.title, song.tempo, song.key?.label]).toEqual(['Small Tune', 100, 'D major']);
    const flute = spelled(song, 'flute').slice(0, 9).map(([start, len, pitch]) => [Number(start.toFixed(3)), Number(len.toFixed(3)), pitch]);
    expect(flute).toEqual([
      [3, 1, p('A4')], [4, 1, p('D5')], [5, 0.5, p('F#5')], [5.5, 0.5, p('E5')], [6, 1, p('D5')],
      [7, 0.333, p('A4')], [7.333, 0.333, p('B4')], [7.667, 0.333, p('C#5')], [8, 3, p('B4')],
    ]);
  });

  it('repeats are played out with their endings, in every voice', () => {
    const song = readAbc(abc);
    expect(song.bars).toBe(7);
    expect(song.sections[0].chords.map((spans) => spans.map((s) => s.chord?.symbol ?? '-').join(' '))).toEqual(['-', 'D', 'G', 'A7', 'D', 'G', 'A7 D']);
    expect(part(song, 'acoustic bass').notes.map((n) => n.pitch).slice(-2)).toEqual([p('A2'), p('D3')]);
  });

  it('%%groove brings the band in and %%band changes it', () => {
    const song = readAbc(abc);
    expect([song.sections[0].name, song.sections[0].groove, song.sections[0].energy, song.sections[0].band.bass]).toEqual(['A', 'bossa', 3, null]);
    expect(arrange(song).tracks.map((t) => t.role).sort()).toEqual(['comp', 'drums', 'lead', 'part']);
    expect(readAbc(abc.replace('%%groove bossa 3\n%%band bass=off\n', '')).sections[0].groove).toBe('none');
  });

  it('a bar longer than its meter is a problem that names the voice and the bar', () => {
    expect(problemsOf(() => readAbc('X:1\nT:t\nM:4/4\nL:1/4\nK:C\nC D E F G | C4 |'))).toContain('voice 1, bar 1');
  });

  it('a MIDI program outside 0–127 is a problem, not something passed to the synth', () => {
    expect(problemsOf(() => readAbc('X:1\nT:t\nM:4/4\nL:1/4\nK:C\nV:1\n%%MIDI program 128\nC D E F |'))).toContain('outside 0–127');
  });
});

describe('the default path', () => {
  it('a sheet that uses none of the optional notation is arranged as version 0.1.0 arranged it', () => {
    // every track's note count, summed start and end seconds, and summed pitch × velocity, taken from the 0.1.0 code
    const song = readSong({
      title: 'Golden', tempo: 96, key: 'F major', lead: 'electric piano', motifs: { m: 'A4 - - . C5 - A4 . | G4 - - . F4 - . .' }, form: ['A', 'B', 'A', 'C'],
      sections: [
        { name: 'A', groove: 'lofi', energy: 2, chords: 'Fmaj7 | Bbmaj7 | Am7 | Dm7 G7', melody: '@m | A4 - - . C5 - D5 . | C5 - - . A4 - . .', parts: { kalimba: '. . . . . . . D6 | . . . A5 . . . . | . . . . . . E5 . | . . . . . . . .' }, stops: [4] },
        { name: 'B', groove: 'bossa', energy: 4, chords: 'Gm7 C7 | Fmaj7 | Gm7 C7 | F6', melody: 'D5 . F5 . G5 - - - | A5 - - - . . . . | @m+1', parts: { drums: 'K . H . S . H . | % | % | K . . . S S S S' } },
        { name: 'C', groove: 'swing', energy: 5, chords: 'Dm7 | G13 | Cmaj7 | A7b9', melody: 'F5 E5 D5 | A5 - - | G5 - E5 | C#5 - -' },
      ],
    });
    const sums = arrange(song).tracks.map((t) => [t.name, t.notes.length, Number(t.notes.reduce((s, n) => s + n.at + n.until, 0).toFixed(3)), t.notes.reduce((s, n) => s + n.pitch * n.velocity, 0)]);
    expect(sums).toEqual([
      ['comp:electric piano', 24, 719.59, 70355], ['bass:electric bass', 8, 239.258, 17286], ['drums', 162, 6686.658, 538245], ['comp:nylon guitar', 36, 1108.614, 137615],
      ['bass:acoustic bass', 32, 1619.439, 100779], ['comp:piano', 34, 2403.744, 144279], ['electric piano', 36, 1351.896, 235546], ['kalimba', 6, 175.237, 33240],
    ]);
  });
});
