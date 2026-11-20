/**
 * The sheet as one text, and back. The text holds what the sheet's fields hold, laid out as a score:
 *
 *   title: Rain on the window
 *   tempo: 76
 *   key: F major
 *   lead: electric piano
 *   form: A B A
 *   motif drip: A4 - - . C5 - A4 . | G4 - - . F4 - . .
 *
 *   [A] groove=lofi energy=2
 *   chords:  Fmaj7 | Bbmaj7
 *   melody:  @drip
 *   kalimba: . . . . . . . D6 | . . . A5 . . . .
 *
 *   chords:  Am7 | Dm7
 *   melody:  A4 - - . C5 - D5 . | C5 - - . A4 - . .
 *
 * Inside a section a blank line ends a system. The lines of the next system go on from the bar where the
 * longest line above stopped, so a part that is not written in a system rests through it.
 */
import { barsIn } from './sheet.ts';
import { GROOVE_NAMES } from './grooves.ts';

type Raw = Record<string, unknown>;

const HEADER_KEYS = ['title', 'tempo', 'key', 'meter', 'lead', 'form'];
const SECTION_OPTIONS = ['groove', 'energy', 'tempo', 'meter', 'key', 'like'];

const trimBars = (text: string): string => text.trim().replace(/^\|+/, '').replace(/\|+\s*$/, '').trim();
const names = (text: string): string[] => (/[,|>→]/.test(text) ? text.split(/[,|>→]+/) : text.split(/\s+/)).map((n) => n.trim()).filter(Boolean);

/** `a=1 b=two words c=3` as an object; a value runs to the next `name=`. */
function pairs(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const found = [...text.matchAll(/([A-Za-z]+)\s*=\s*/g)];
  found.forEach((m, i) => {
    out[m[1].toLowerCase()] = text.slice(m.index! + m[0].length, i + 1 < found.length ? found[i + 1].index : undefined).replace(/[,;]\s*$/, '').trim();
  });
  return out;
}

/** The words after `[name]` when the line is a section's first line, else null (a line of notes may also start with a bracket). */
function sectionWords(line: string): { name: string; rest: string } | null {
  const head = /^\[([^\]]+)\]\s*(.*)$/.exec(line);
  if (!head || line.includes('|')) return null;
  const bare = head[2].split(/[A-Za-z]+\s*=/)[0].split(/[\s,]+/).filter(Boolean);
  const optionWords = bare.every((w) => GROOVE_NAMES.includes(w.toLowerCase()) || /^[1-5]$/.test(w));
  return head[2] === '' || head[2].includes('=') || optionWords ? { name: head[1].trim(), rest: head[2] } : null;
}

/**
 * Reads a score text into the fields of a sheet. `knownMotifs` are motifs defined elsewhere (the stored sheet,
 * when the text is a revision), needed to count the bars of a line that uses them.
 */
export function parseScore(text: string, knownMotifs: Record<string, string> = {}): { sheet: Raw; problems: string[] } {
  const problems: string[] = [];
  const sheet: Raw = {};
  const motifs: Record<string, string> = {};
  const sections: Raw[] = [];
  let section: (Raw & { parts: Record<string, string> }) | null = null;
  /** Bars before the current system, the bar its longest line has reached, and the line a line without a name continues. */
  let offset = 0, reached = 0, lastKey: string | null = null;
  /** Lines of the current section that began in a later system: where, and the text line that began them. */
  let late: Array<{ key: string; from: number; where: string }> = [];
  /** A line that began in a later system and runs past the chords was probably written from bar 1; say where it was placed. */
  const closeSection = () => {
    if (section === null) return;
    const length = bars(String(section.chords ?? ''));
    for (const { key, from, where } of late) {
      const have = bars(String((key === 'melody' ? section.melody : section.parts[key]) ?? ''));
      if (length > 0 && have > length) problems.push(`${where}: "${key}" begins in a later system of section ${String(section.name)}, so its first bar is bar ${from + 1} of the section; with the ${have - from} bars written it runs to bar ${have}, and the section has ${length}`);
    }
    late = [];
  };
  const bars = (line: string): number => (line === '' ? 0 : barsIn(line, { ...knownMotifs, ...motifs }));

  /** Adds bars to a line of the current section: straight after what it holds, or from the system's first bar. */
  const add = (key: string, body: string, continuing: boolean) => {
    const s = section!;
    const field = key === 'chords' || key === 'melody';
    const have = String((field ? s[key] : s.parts[key]) ?? '');
    const pad = continuing ? [] : Array.from({ length: Math.max(0, offset - bars(have)) }, () => (key === 'chords' ? 'N.C.' : '.'));
    if (pad.length > 0 && have === '' && key !== 'chords') late.push({ key, from: offset, where: `line ${lineNumber}` });
    const joined = [...(have === '' ? [] : [have]), ...pad, trimBars(body)].join(' | ');
    if (field) s[key] = joined; else s.parts[key] = joined;
    reached = Math.max(reached, bars(joined));
  };

  let lineNumber = 0;
  text.replace(/\r/g, '').split('\n').forEach((rawLine, index) => {
    const line = rawLine.trim();
    const where = `line ${index + 1}`;
    lineNumber = index + 1;
    if (line.startsWith('```')) return;
    if (line === '') { offset = Math.max(offset, reached); lastKey = null; return; }
    const head = sectionWords(line);
    if (head) {
      let name = head.name;
      const options = pairs(head.rest);
      const likeInName = /^(.*?)\s+like\s+(.+)$/i.exec(name);
      if (likeInName) { name = likeInName[1].trim(); options.like ??= likeInName[2].trim(); }
      for (const word of head.rest.split(/[A-Za-z]+\s*=/)[0].split(/[\s,]+/).filter(Boolean)) {
        if (/^[1-5]$/.test(word)) options.energy ??= word; else options.groove ??= word.toLowerCase();
      }
      closeSection();
      section = { name, parts: {} };
      for (const [key, value] of Object.entries(options)) {
        if (!SECTION_OPTIONS.includes(key)) { problems.push(`${where}: "${key}=" is not one of ${SECTION_OPTIONS.join(', ')}`); continue; }
        section[key] = key === 'energy' || key === 'tempo' ? Number(value) : value;
      }
      sections.push(section);
      offset = 0; reached = 0; lastKey = null;
      return;
    }
    const motif = /^(?:motif\s+|@)([A-Za-z0-9_]+)\s*[:=]\s*(.+)$/i.exec(line);
    if (motif) { motifs[motif[1]] = trimBars(motif[2]); return; }
    if (section === null) {
      const colon = line.indexOf(':');
      const key = colon < 0 ? '' : line.slice(0, colon).trim().toLowerCase(), value = line.slice(colon + 1).trim();
      if (!HEADER_KEYS.includes(key)) {
        problems.push(`${where}: "${line.slice(0, 40)}" is not a header line (${HEADER_KEYS.join(', ')}, motif <name>) and no section has begun; a section begins with a line like "[A] groove=pop energy=3"`);
        return;
      }
      if (key === 'tempo') sheet.tempo = Number(value.replace(/\s*bpm$/i, ''));
      else if (key === 'form') sheet.form = names(value);
      else sheet[key] = value;
      return;
    }
    const colon = line.lastIndexOf(':');
    if (colon < 0) {
      // a long line broken by its writer: the rest of the line above
      if (lastKey === null) problems.push(`${where}: "${line.slice(0, 40)}" has no "name:" in front and follows no line it could continue`);
      else add(lastKey, line, true);
      return;
    }
    const key = line.slice(0, colon).trim().toLowerCase().replace(/\s*:\s*/g, ':'), body = line.slice(colon + 1).trim();
    if (SECTION_OPTIONS.includes(key)) { section[key] = key === 'energy' || key === 'tempo' ? Number(body) : body; return; }
    if (key === 'stops') { section.stops = [...((section.stops as number[]) ?? []), ...body.split(/[\s,]+/).filter(Boolean).map(Number)]; return; }
    if (key === 'band') {
      const roles = pairs(body);
      if (Object.keys(roles).length === 0 && body !== '') problems.push(`${where}: band is written like "band: bass=off chords=vibraphone"`);
      section.band = { ...((section.band as Raw) ?? {}), ...roles };
      return;
    }
    if (body === '') return;
    add(key, body, lastKey === key);
    lastKey = key;
  });

  closeSection();
  if (Object.keys(motifs).length > 0) sheet.motifs = motifs;
  for (const s of sections) if (Object.keys(s.parts as object).length === 0) delete s.parts;
  if (sections.length > 0) sheet.sections = sections;
  return { sheet, problems };
}

/** Writes a sheet's fields as a score text, one line per part and section. */
export function writeScore(sheet: Raw): string {
  const out: string[] = [];
  for (const key of HEADER_KEYS) {
    const value = sheet[key];
    if (value === undefined || value === null || value === '') continue;
    out.push(`${key}: ${Array.isArray(value) ? value.join(key === 'form' && value.some((n) => /\s/.test(String(n))) ? ', ' : ' ') : String(value)}`);
  }
  for (const [name, line] of Object.entries((sheet.motifs as Record<string, string>) ?? {})) out.push(`motif ${name}: ${line}`);
  for (const section of (sheet.sections as Raw[]) ?? []) {
    const options = SECTION_OPTIONS.filter((k) => section[k] !== undefined && section[k] !== null && section[k] !== '').map((k) => `${k}=${String(section[k])}`);
    out.push('', `[${String(section.name)}]${options.length > 0 ? ` ${options.join(' ')}` : ''}`);
    const lines: Array<[string, string]> = [];
    if (typeof section.chords === 'string') lines.push(['chords', section.chords]);
    if (typeof section.melody === 'string') lines.push(['melody', section.melody]);
    for (const [name, line] of Object.entries((section.parts as Record<string, string>) ?? {})) lines.push([name, line]);
    const width = Math.max(0, ...lines.map(([name]) => name.length)) + 1;
    for (const [name, line] of lines) out.push(`${`${name}:`.padEnd(width)} ${line}`);
    if (Array.isArray(section.stops) && section.stops.length > 0) out.push(`stops: ${section.stops.join(' ')}`);
    if (section.band && typeof section.band === 'object') out.push(`band: ${Object.entries(section.band as Raw).map(([k, v]) => `${k}=${String(v)}`).join(' ')}`);
  }
  return out.join('\n') + '\n';
}
