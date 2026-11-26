/**
 * Reads a tune in ABC notation into a `Song`: the common subset of the 2.1 standard with several voices (header
 * fields, notes, rests, chords in brackets, ties, tuplets, broken rhythm, chord symbols, repeats with first and
 * second endings, inline fields, dynamics). Grace notes, lyrics and other decorations are skipped.
 *
 * Two directives beyond the standard bring in the generated band, from the bar they stand before:
 *   %%groove <name> <energy>     the band plays the chord symbols in that groove; a new section starts here
 *   %%band bass=off chords=vibraphone     changes to that band
 * A `P:` line names the section that starts there.
 */
import { GROOVES, GROOVE_NAMES } from './grooves.ts';
import { findInstrument, instrumentOfProgram, type Instrument } from './instruments.ts';
import { DYNAMICS, parseMeter, readBand, SheetError, type ChordSpan, type Part, type Section, type Song } from './sheet.ts';
import { parseChord, parseKey, type Chord, type Key } from './theory.ts';

interface Ev { at: number; len: number; pitches: number[]; tied: boolean[]; velocity?: number }
interface Mark { section?: string; groove?: string; energy?: number; band?: Record<string, string>; tempo?: number }
interface AbcBar {
  events: Ev[];
  symbols: Array<{ at: number; text: string }>;
  len: number;
  meter: string;
  beats: number;
  mark: Mark | null;
  startRepeat: boolean;
  endRepeat: boolean;
  firstEnding: boolean;
}
interface Voice {
  id: string;
  name: string;
  program: number | null;
  drums: boolean;
  octave: number;
  unit: number;
  meter: string;
  beats: number;
  keyAcc: Record<string, number>;
  barAcc: Map<string, number>;
  bars: AbcBar[];
  cur: AbcBar;
  pos: number;
  tie: Set<number>;
  tuplet: { left: number; scale: number } | null;
  broken: number;
  last: { len: number } | null;
  velocity?: number;
  ending: number;
}

const SEMIS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const FIFTHS: Record<string, number> = { F: -1, C: 0, G: 1, D: 2, A: 3, E: 4, B: 5 };
const MODE_SHIFT: Record<string, number> = { maj: 0, ion: 0, lyd: 1, mix: -1, dor: -2, min: -3, aeo: -3, m: -3, phr: -4, loc: -5 };
const OUR_MODE: Record<string, string> = { maj: 'major', ion: 'major', m: 'minor', min: 'minor', aeo: 'minor', dor: 'dorian', mix: 'mixolydian', lyd: 'lydian', phr: 'phrygian' };

/** The accidentals a `K:` field puts on each letter, and the key in this package's terms when it has one. */
function keySignature(text: string): { acc: Record<string, number>; key: Key | null } {
  const m = /^\s*([A-G])([#b]?)\s*([A-Za-z]*)/.exec(text);
  if (!m) return { acc: {}, key: null };
  const word = m[3].toLowerCase();
  let mode = word === '' ? 'maj' : word === 'm' ? 'm' : word.slice(0, 3);
  if (MODE_SHIFT[mode] === undefined) mode = 'maj';
  const count = FIFTHS[m[1]] + (m[2] === '#' ? 7 : m[2] === 'b' ? -7 : 0) + MODE_SHIFT[mode];
  const acc: Record<string, number> = {};
  for (const letter of 'FCGDAEB'.slice(0, Math.max(0, Math.min(7, count)))) acc[letter] = 1;
  for (const letter of 'BEADGCF'.slice(0, Math.max(0, Math.min(7, -count)))) acc[letter] = -1;
  let key: Key | null = null;
  if (OUR_MODE[mode]) { try { key = parseKey(`${m[1]}${m[2]} ${OUR_MODE[mode]}`); } catch { /* a key this package has no name for */ } }
  return { acc, key };
}

/** Quarter notes per minute from a `Q:` field: `1/4=120`, `3/8=60`, `120`. */
function tempoOf(text: string): number | null {
  const m = /(\d+)\s*\/\s*(\d+)\s*=\s*(\d+(?:\.\d+)?)/.exec(text);
  if (m) return Number(m[3]) * (Number(m[1]) / Number(m[2])) * 4;
  const bare = /(\d{2,3})\s*$/.exec(text.replace(/"[^"]*"/g, '').trim());
  return bare ? Number(bare[1]) : null;
}

const multiplier = (num: string, slashes: string, den: string): number => (num === '' ? 1 : Number(num)) / (slashes === '' ? 1 : den !== '' ? Number(den) : 2 ** slashes.length);

function byName(text: string): Instrument | null {
  const clean = text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim();
  if (clean === '') return null;
  const words = clean.split(/\s+/);
  for (let size = Math.min(3, words.length); size >= 1; size--) {
    for (let i = 0; i + size <= words.length; i++) {
      const found = findInstrument(words.slice(i, i + size).join(' '));
      if (found) return found;
    }
  }
  return null;
}

/** Plays repeats out: `|: A |1 B :|2 C` becomes A B A C. */
function unfold(bars: AbcBar[]): AbcBar[] {
  const out: AbcBar[] = [];
  let i = 0, start = 0, pass = 1, guard = 0;
  while (i < bars.length && guard++ < 5000) {
    const b = bars[i];
    if (b.startRepeat && i !== start) { start = i; pass = 1; }
    if (pass === 2 && b.firstEnding) { i++; if (b.endRepeat) { pass = 1; start = i; } continue; }
    out.push(b);
    if (b.endRepeat) {
      if (pass === 1) { pass = 2; i = start; continue; }
      pass = 1; start = i + 1;
    }
    i++;
  }
  return out;
}

export function readAbc(text: string): Song {
  const problems: string[] = [];
  const notes: string[] = [];
  const uses: Record<string, number> = {};
  const header = { title: '', meter: '4/4', beats: 4, unit: null as number | null, tempo: 120, key: null as Key | null, keyAcc: {} as Record<string, number> };
  const voices = new Map<string, Voice>();
  let current: Voice | null = null;
  let pending: Mark | null = null;
  let firstProgram: number | null = null;
  let inBody = false;
  const mark = (): Mark => (pending ??= {});
  const say = (list: string[], limit: number, text: string) => { if (list.length < limit) list.push(text); else if (list.length === limit) list.push('… and more of the same'); };

  const setMeter = (target: { meter: string; beats: number }, value: string, where: string) => {
    const v = value.trim();
    const meter = v === 'C' ? parseMeter('4/4') : v === 'C|' ? parseMeter('2/2') : /^none$/i.test(v) ? parseMeter('4/4') : parseMeter(v);
    if (!meter) { problems.push(`${where}: meter "${value}" is not readable; write it like M:4/4, M:3/4, M:6/8`); return; }
    target.meter = meter.label; target.beats = meter.beats;
  };
  const unitOf = (value: string): number | null => {
    const m = /(\d+)\s*\/\s*(\d+)/.exec(value);
    return m ? (4 * Number(m[1])) / Number(m[2]) : null;
  };
  const newBar = (v: Voice): AbcBar => ({ events: [], symbols: [], len: 0, meter: v.meter, beats: v.beats, mark: null, startRepeat: false, endRepeat: false, firstEnding: false });
  const voice = (id = '1', params = ''): Voice => {
    let v = voices.get(id);
    if (!v) {
      v = {
        id, name: '', program: voices.size === 0 ? firstProgram : null, drums: false, octave: 0,
        unit: header.unit ?? (header.beats < 3 ? 0.25 : 0.5), meter: header.meter, beats: header.beats,
        keyAcc: { ...header.keyAcc }, barAcc: new Map(), bars: [], cur: null as unknown as AbcBar, pos: 0,
        tie: new Set(), tuplet: null, broken: 1, last: null, ending: 0,
      };
      v.cur = newBar(v);
      voices.set(id, v);
    }
    const name = /(?:name|nm|sname|snm)\s*=\s*(?:"([^"]*)"|(\S+))/.exec(params);
    if (name) v.name = (name[1] ?? name[2]).trim();
    const octave = /octave\s*=\s*(-?\d)/.exec(params);
    if (octave) v.octave = Number(octave[1]);
    if (/clef\s*=\s*perc/.test(params)) v.drums = true;
    return v;
  };
  const here = (): Voice => (current ??= voice());
  const touch = (v: Voice) => {
    if (pending && v.cur.events.length === 0 && v.cur.symbols.length === 0 && v.pos === 0) { v.cur.mark = { ...v.cur.mark, ...pending }; pending = null; }
  };
  const closeBar = (v: Voice) => {
    if (v.cur.events.length === 0 && v.cur.symbols.length === 0 && v.pos === 0) return;
    v.cur.len = v.pos;
    v.cur.firstEnding = v.ending === 1;
    v.bars.push(v.cur);
    v.cur = newBar(v);
    v.pos = 0;
    v.barAcc.clear();
  };
  const add = (v: Voice, pitches: number[], length: number, tied = false) => {
    touch(v);
    const len = length * (v.tuplet ? v.tuplet.scale : 1) * v.broken;
    v.broken = 1;
    if (v.tuplet && --v.tuplet.left <= 0) v.tuplet = null;
    if (pitches.length > 0) {
      const ev: Ev = { at: v.pos, len, pitches, tied: pitches.map((p) => v.tie.has(p)), velocity: v.velocity };
      v.cur.events.push(ev);
      v.last = ev;
      v.tie = tied ? new Set(pitches) : new Set();
    } else {
      v.last = { len };
      v.tie = new Set();
    }
    v.pos += len;
  };
  const NOTE = /^(\^{1,2}|_{1,2}|=)?([A-Ga-g])([,']*)(\d*)(\/*)(\d*)/;
  const pitchOf = (v: Voice, m: RegExpExecArray): number => {
    const letter = m[2].toUpperCase();
    let midi = 60 + SEMIS[letter] + (m[2] === letter ? 0 : 12) + 12 * v.octave;
    for (const c of m[3]) midi += c === "'" ? 12 : -12;
    const at = `${m[2]}${m[3]}`;
    let acc: number;
    if (m[1]) { acc = m[1] === '=' ? 0 : m[1][0] === '^' ? m[1].length : -m[1].length; v.barAcc.set(at, acc); }
    else acc = v.barAcc.get(at) ?? v.keyAcc[letter] ?? 0;
    return midi + acc;
  };
  const field = (letter: string, value: string, where: string) => {
    if (letter === 'V') { const [id, ...rest] = value.split(/\s+/); current = voice(id || '1', rest.join(' ')); return; }
    // in the header these set the tune's values for every voice; in the body they change the voice being written
    if (letter === 'K') {
      const { acc, key } = keySignature(value);
      if (inBody && current) current.keyAcc = acc;
      else { header.keyAcc = acc; header.key ??= key; for (const v of voices.values()) v.keyAcc = { ...acc }; }
      return;
    }
    if (letter === 'M') {
      if (inBody && current) {
        setMeter(current, value, where);
        if (current.cur.events.length === 0 && current.pos === 0) { current.cur.meter = current.meter; current.cur.beats = current.beats; }
      } else {
        setMeter(header, value, where);
        for (const v of voices.values()) { v.meter = header.meter; v.beats = header.beats; v.cur.meter = v.meter; v.cur.beats = v.beats; if (header.unit === null) v.unit = header.beats < 3 ? 0.25 : 0.5; }
      }
      return;
    }
    if (letter === 'L') {
      const unit = unitOf(value);
      if (unit === null) return;
      if (inBody && current) current.unit = unit; else { header.unit = unit; for (const v of voices.values()) v.unit = unit; }
      return;
    }
    if (letter === 'Q') { const tempo = tempoOf(value); if (tempo) { if (inBody) mark().tempo = tempo; else header.tempo = tempo; } return; }
    if (letter === 'P' && inBody) { mark().section = value.trim(); return; }
    if (letter === 'T' && header.title === '') header.title = value.trim();
  };
  const directive = (line: string) => {
    const groove = /^%%\s*groove\s+(\S+)(?:\s+(?:energy\s*=?\s*)?(\d))?/i.exec(line);
    if (groove) { mark().groove = groove[1].toLowerCase(); if (groove[2]) mark().energy = Number(groove[2]); return; }
    const band = /^%%\s*band\s+(.+)$/i.exec(line);
    if (band) { mark().band = Object.fromEntries([...band[1].matchAll(/([A-Za-z]+)\s*=\s*([^=]+?)(?=\s+[A-Za-z]+\s*=|\s*$)/g)].map((m) => [m[1].toLowerCase(), m[2].trim()])); return; }
    // "%%MIDI program 73" is for the voice being written; "%%MIDI program 2 73" names its channel, taken as the second voice
    const program = /^%%\s*MIDI\s+program\s+(?:(\d+)\s+)?(\d+)/i.exec(line);
    if (program) {
      const target = program[1] ? [...voices.values()][Number(program[1]) - 1] ?? current : current;
      if (target) target.program = Number(program[2]); else firstProgram ??= Number(program[2]);
      return;
    }
    if (/^%%\s*MIDI\s+channel\s+10\b/i.test(line) && current) current.drums = true;
  };

  const scan = (text: string, where: string) => {
    let i = 0;
    while (i < text.length) {
      const c = text[i], rest = text.slice(i);
      if (c === '%') break;
      if (c === '"') {
        const j = text.indexOf('"', i + 1);
        if (j < 0) break;
        const symbol = text.slice(i + 1, j).trim();
        if (symbol !== '' && !/^[\^_<>@]/.test(symbol)) { const v = here(); touch(v); v.cur.symbols.push({ at: v.pos, text: symbol }); }
        i = j + 1; continue;
      }
      if (c === '!') {
        const j = text.indexOf('!', i + 1);
        if (j < 0 || j - i > 24) { i++; continue; }
        const velocity = DYNAMICS[text.slice(i + 1, j).toLowerCase()];
        if (velocity !== undefined) { here().velocity = velocity; uses.marks = (uses.marks ?? 0) + 1; }
        i = j + 1; continue;
      }
      if (c === '{') { const j = text.indexOf('}', i + 1); i = j < 0 ? text.length : j + 1; continue; }
      if (c === '[') {
        const inline = /^\[([A-Za-z]):([^\]]*)\]/.exec(rest);
        if (inline) { field(inline[1].toUpperCase(), inline[2].trim(), where); i += inline[0].length; continue; }
        const ending = /^\[(\d)[\d,-]*/.exec(rest);
        if (ending) { const v = here(); closeBar(v); v.ending = Number(ending[1]); i += ending[0].length; continue; }
        if (rest[1] !== '|') {
          const j = text.indexOf(']', i + 1);
          if (j < 0) { i++; continue; }
          const v = here();
          const pitches: number[] = [];
          let inner = text.slice(i + 1, j), first = 1, tied = false, k = 0;
          while (inner.length > 0) {
            const m = NOTE.exec(inner);
            if (!m) { if (inner[0] === '-') tied = true; inner = inner.slice(1); continue; }
            pitches.push(pitchOf(v, m));
            if (k++ === 0) first = multiplier(m[4], m[5], m[6]);
            inner = inner.slice(m[0].length);
          }
          const outer = /^(\d*)(\/*)(\d*)/.exec(text.slice(j + 1))!;
          i = j + 1 + outer[0].length;
          if (text[i] === '-') { tied = true; i++; }
          if (pitches.length > 1) uses.stacks = (uses.stacks ?? 0) + 1;
          add(v, pitches, v.unit * first * multiplier(outer[1], outer[2], outer[3]), tied);
          continue;
        }
      }
      const barline = /^(\[\|:?|:*\|[|\]]*:*|::)(\d?)/.exec(rest);
      if (barline && barline[1] !== '') {
        const v = here(), token = barline[1];
        closeBar(v);
        const ends = token.startsWith(':'), starts = token.endsWith(':') && (token.length > 1);
        if (ends && v.bars.length > 0) { v.bars[v.bars.length - 1].endRepeat = true; v.ending = 0; }
        if (/\|\||\|\]|\[\|/.test(token) && v.ending === 2) v.ending = 0;
        if (starts) { v.cur.startRepeat = true; v.ending = 0; }
        if (barline[2]) v.ending = Number(barline[2]);
        i += barline[0].length; continue;
      }
      const tuplet = /^\((\d)(?::(\d?))?(?::(\d?))?/.exec(rest);
      if (tuplet) {
        const v = here(), p = Number(tuplet[1]);
        const compound = v.meter.endsWith('/8') && Number(v.meter.split('/')[0]) % 3 === 0;
        const q = tuplet[2] ? Number(tuplet[2]) : ({ 2: 3, 3: 2, 4: 3, 6: 2, 8: 3 } as Record<number, number>)[p] ?? (compound ? 3 : 2);
        v.tuplet = { left: tuplet[3] ? Number(tuplet[3]) : p, scale: q / p };
        i += tuplet[0].length; continue;
      }
      if (c === '-') { const v = here(); if (v.last && 'pitches' in v.last) v.tie = new Set((v.last as Ev).pitches); i++; continue; }
      if (c === '>' || c === '<') {
        let n = 0;
        while (text[i + n] === c) n++;
        const v = here(), f = 2 ** -n;
        if (v.last) { const delta = v.last.len * (c === '>' ? 1 - f : f - 1); v.last.len += delta; v.pos += delta; }
        v.broken = c === '>' ? f : 2 - f;
        i += n; continue;
      }
      const note = NOTE.exec(rest);
      if (note) {
        const v = here();
        const pitch = pitchOf(v, note);
        i += note[0].length;
        const tied = text[i] === '-';
        if (tied) i++;
        add(v, [pitch], v.unit * multiplier(note[4], note[5], note[6]), tied);
        continue;
      }
      const silence = /^[zx](\d*)(\/*)(\d*)/.exec(rest);
      if (silence) { const v = here(); add(v, [], v.unit * multiplier(silence[1], silence[2], silence[3])); i += silence[0].length; continue; }
      const wholeBars = /^[ZX](\d*)/.exec(rest);
      if (wholeBars) {
        const v = here();
        for (let k = 0; k < Number(wholeBars[1] || 1); k++) { closeBar(v); touch(v); v.pos = v.beats; closeBar(v); }
        i += wholeBars[0].length; continue;
      }
      if (c === '&') say(notes, 6, `${where}: "&" (a second line inside one voice) is not read; what follows it in the bar is added after it instead`);
      i++;
    }
  };

  // join lines ending in a backslash, then read line by line
  const lines = text.replace(/\r/g, '').replace(/\\\n/g, ' ').split('\n');
  lines.forEach((raw, index) => {
    const line = raw.trim();
    const where = `line ${index + 1}`;
    if (line === '' || line.startsWith('```')) return;
    if (line.startsWith('%%')) { directive(line); return; }
    if (line.startsWith('%')) return;
    const f = /^([A-Za-z]):\s*(.*)$/.exec(line);
    if (f && !/^[A-Ga-gz]:\|/.test(line)) {
      const letter = f[1].toUpperCase();
      if (letter === 'W' || f[1] === 'w') return;
      field(letter, f[2].replace(/%.*$/, '').trim(), where);
      // the first K: closes the header; music with no voice named goes to the first voice declared
      if (letter === 'K' && !inBody) { inBody = true; current = [...voices.values()][0] ?? null; }
      return;
    }
    inBody = true;
    scan(line, where);
  });
  for (const v of voices.values()) closeBar(v);

  const played = [...voices.values()].map((v) => ({ v, bars: unfold(v.bars) })).filter((x) => x.bars.some((b) => b.events.length > 0 || b.symbols.length > 0));
  if (played.length === 0) throw new SheetError(['the ABC text holds no notes; a tune needs header lines (X:, T:, M:, L:, Q:, K:) and then bars of notes']);
  const barCount = Math.max(...played.map((x) => x.bars.length));
  if (barCount > 400) problems.push(`the tune has ${barCount} bars with its repeats played out; the limit is 400`);
  const firstWith = <T>(i: number, pick: (b: AbcBar) => T | null | undefined): T | null => {
    for (const x of played) { const b = x.bars[i]; const got = b ? pick(b) : null; if (got !== null && got !== undefined) return got; }
    return null;
  };

  // sections: a new one at each mark that names a section, a groove, a band or a tempo, and wherever the meter changes
  const state = { groove: 'none', energy: 3, tempo: header.tempo, band: undefined as Record<string, string> | undefined };
  const sections: Section[] = [];
  const starts: number[] = [];
  let beat = 0, last: Chord | null = null;
  const chordOf = (symbol: string, where: string): Chord | null => {
    if (/^N\.?C\.?$/i.test(symbol)) return null;
    try { return parseChord(symbol.replace(/\s+/g, '')); } catch (e) { say(problems, 12, `${where}: ${(e as Error).message}`); return last; }
  };
  for (let i = 0; i < barCount; i++) {
    const meter = firstWith(i, (b) => b.meter)!, beats = firstWith(i, (b) => b.beats)!;
    const m = firstWith(i, (b) => b.mark);
    const open = sections[sections.length - 1];
    const fresh = i === 0 || meter !== open.meter || (m !== null && (m.section !== undefined || m.groove !== undefined || m.band !== undefined || (m.tempo !== undefined && m.tempo !== state.tempo)));
    if (m?.groove !== undefined) state.groove = m.groove;
    if (m?.energy !== undefined) state.energy = Math.min(5, Math.max(1, m.energy));
    if (m?.tempo !== undefined) state.tempo = m.tempo;
    if (m?.band !== undefined) state.band = m.band;
    if (fresh) {
      const name = m?.section ?? `part ${sections.length + 1}`;
      if (!GROOVE_NAMES.includes(state.groove)) { problems.push(`section ${name}: groove "${state.groove}" is not known; use one of: ${GROOVE_NAMES.join(', ')}`); state.groove = 'none'; }
      const g = GROOVES[state.groove];
      if (g && g.beats !== 0 && `${g.beats}/4` !== meter) problems.push(`section ${name}: groove "${state.groove}" is in ${g.beats}/4 and the meter here is ${meter}; in other meters the grooves are ambient and none`);
      if (!(state.tempo >= 30 && state.tempo <= 300)) { problems.push(`section ${name}: tempo ${state.tempo} quarter notes per minute is outside 30 to 300`); state.tempo = 120; }
      sections.push({
        name, groove: state.groove, energy: state.energy, firstBar: i, barCount: 0, firstBeat: beat, beats, meter, tempo: state.tempo, key: header.key,
        band: readBand(state.band, state.groove, `section ${name}`, problems, notes, uses), chords: [], stops: new Set(),
      });
    }
    const section = sections[sections.length - 1];
    const shift = (x: { bars: AbcBar[] }) => (i === 0 && x.bars[0] && x.bars[0].len > 0 && x.bars[0].len < beats - 1e-6 ? beats - x.bars[0].len : 0);
    const source = played.find((x) => (x.bars[i]?.symbols.length ?? 0) > 0);
    const spans: ChordSpan[] = [];
    if (source) {
      const symbols = source.bars[i].symbols.map((s) => ({ at: Math.min(beats, s.at + shift(source)), text: s.text })).sort((a, b) => a.at - b.at);
      if (symbols[0].at > 1e-6) spans.push({ chord: last, at: 0, len: symbols[0].at });
      symbols.forEach((s, k) => {
        last = chordOf(s.text, `bar ${i + 1}`);
        const len = (symbols[k + 1]?.at ?? beats) - s.at;
        if (len > 1e-6) spans.push({ chord: last, at: s.at, len });
      });
    } else {
      spans.push({ chord: last, at: 0, len: beats });
    }
    section.chords.push(spans);
    section.barCount++;
    starts.push(beat);
    beat += beats;
  }
  for (const section of sections) {
    const named = section.chords.some((spans) => spans.some((s) => s.chord !== null));
    if (!named) section.chords = [];
    if (section.groove !== 'none' && !named) problems.push(`section ${section.name}: groove "${section.groove}" needs chord symbols ("Am7" before a note) to play`);
  }

  const parts: Part[] = [];
  let leadGiven = false;
  for (const x of played) {
    const v = x.v;
    if (!v.drums && v.program !== null && (v.program < 0 || v.program > 127)) problems.push(`voice ${v.id}: %%MIDI program ${v.program} is outside 0–127; a General MIDI program is 0–127`);
    const drums = v.drums || /drum|perc/i.test(v.name) || /drum|perc/i.test(v.id);
    const instrument = drums ? null : byName(v.name) ?? (v.program !== null ? instrumentOfProgram(v.program) : null) ?? byName(v.id) ?? findInstrument('piano')!;
    const base = instrument?.name ?? 'drums';
    const name = parts.some((p) => p.name === base) ? `${base}:${v.id.toLowerCase()}` : base;
    const part: Part = { name, instrument, drums, lead: !drums && !leadGiven, notes: [] };
    if (part.lead) leadGiven = true;
    x.bars.forEach((bar, i) => {
      const beats = sections.find((s) => i >= s.firstBar && i < s.firstBar + s.barCount)!.beats;
      const pickup = i === 0 && bar.len > 0 && bar.len < beats - 1e-6 ? beats - bar.len : 0;
      if (bar.len > beats + 1e-6) say(problems, 12, `voice ${v.id}, bar ${i + 1}: its notes and rests add up to ${Number(bar.len.toFixed(3))} quarter notes; a ${bar.meter} bar holds ${beats}`);
      else if (i > 0 && bar.len < beats - 1e-6 && bar.events.length > 0) say(notes, 6, `voice ${v.id}, bar ${i + 1}: its notes and rests add up to ${Number(bar.len.toFixed(3))} of ${beats} quarter notes; the rest of the bar is silence`);
      for (const ev of bar.events) {
        const start = starts[i] + pickup + ev.at;
        ev.pitches.forEach((written, k) => {
          let pitch = written;
          if (drums) { while (pitch > 87) pitch -= 12; while (pitch < 27) pitch += 12; }
          const held = ev.tied[k] ? [...part.notes].reverse().find((n) => n.pitch === pitch && Math.abs(n.start + n.len - start) < 1e-6) : undefined;
          if (held) held.len += ev.len;
          else part.notes.push({ start, len: ev.len, pitch, ...(ev.velocity === undefined ? {} : { velocity: ev.velocity }) });
        });
      }
    });
    parts.push(part);
  }
  if (problems.length > 0) throw new SheetError(problems);
  return { title: header.title || 'Untitled', tempo: header.tempo, key: header.key, sections, parts, bars: barCount, beats: beat, notes, uses };
}
