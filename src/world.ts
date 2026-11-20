/**
 * Compose World: the bot writes a song down, the World plays it. Receipts state what was written to disk and
 * what was measured in the result.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ToolDef, ToolOutcome, World, WorldHost, WorldWebUiDecl } from 'cortico/core/types.ts';
import { readAbc } from './abc.ts';
import { arrange } from './arrange.ts';
import { composeConfigGroup, COMPOSE_DEFAULTS, type ComposeConfigSection } from './config.ts';
import { describeFacts, measure } from './facts.ts';
import { parseScore, writeScore } from './score.ts';
import { describeTake, PHRASE_NAME, phraseLine, phraseSheet, readTake, takeArrangement, takeLines, type StoredPhrase } from './phrase.ts';
import { readSong, SheetError, type Song } from './sheet.ts';
import { Player } from './player.ts';
import { levelDb, render, SoundFont, wavBytes, wavBytesMono } from './synth.ts';
import { TOOLSETS } from './tools.ts';
import { songView } from './view.ts';

const ENV_PROMPT_FILE = fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url));
const ASSETS_DIR = fileURLToPath(new URL('../assets/', import.meta.url));

type Stored = Record<string, unknown>;

/** The tools of the default toolset, for the package's self-description. */
export const COMPOSE_TOOL_DECLS: ReadonlyArray<Omit<ToolDef, 'handler'>> = TOOLSETS[COMPOSE_DEFAULTS.toolset];

/**
 * Reads what a song's .json file holds, whichever toolset wrote it: a sheet's fields (also what a score text is
 * stored as), `{abc}`, or the bare tracks of the `notes` toolset.
 */
export function readStored(stored: Stored): Song {
  if (typeof stored.abc === 'string') return readAbc(stored.abc);
  if (stored.tracks !== undefined && stored.sections === undefined) {
    return readSong({ title: stored.title, tempo: stored.tempo, meter: stored.meter, sections: [{ name: 'song', groove: 'none', parts: stored.tracks }] });
  }
  return readSong(stored);
}

export interface ComposeWorldOptions {
  cfg: ComposeConfigSection;
  dataDir: string;
}

const slug = (title: string): string => title.trim().replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').slice(0, 80) || 'Untitled';
const titleOf = (stored: Stored): string => {
  if (typeof stored.title === 'string' && stored.title.trim() !== '') return stored.title;
  return typeof stored.abc === 'string' ? (/^\s*T:\s*(.+)$/m.exec(stored.abc)?.[1].trim() ?? '') : '';
};

export class ComposeWorld implements World {
  readonly id = 'compose';
  private readonly soundFont = new SoundFont();
  private readonly toolset: ComposeConfigSection['toolset'];
  private readonly player = new Player();
  private host: WorldHost | null = null;

  constructor(private readonly opts: ComposeWorldOptions) {
    this.toolset = TOOLSETS[opts.cfg.toolset] ? opts.cfg.toolset : COMPOSE_DEFAULTS.toolset;
  }

  envPromptVars(): Record<string, string> {
    return {};
  }

  tools(): ToolDef[] {
    const handlers: Record<string, (args: Record<string, unknown>) => Promise<ToolOutcome>> = {
      compose_render: (args) => this.renderWritten(args),
      compose_revise: (args) => this.revise(args),
      compose_phrase: (args) => this.writePhrase(args),
      compose_read: async (args) => this.read(args),
      compose_play: async (args) => this.play(args),
      compose_stop: async () => this.stopPlaying(),
      compose_open: async (args) => this.open(args),
    };
    return TOOLSETS[this.toolset].map((decl) => ({ ...decl, handler: handlers[decl.name] }));
  }

  webUi(language = 'zh'): WorldWebUiDecl {
    const zh = language.startsWith('zh');
    return {
      label: zh ? '作曲' : 'Compose',
      config: [composeConfigGroup(language)],
      panels: [
        { id: 'songs', title: zh ? '曲子' : 'Songs', description: zh ? '写过的曲子:音符、段落、测量结果和试听。' : 'The songs written so far: notes, sections, measured facts and playback.' },
        { id: 'keyboard', title: zh ? '键盘' : 'Keyboard', description: zh ? '弹一句录下来发给 Coo;Coo 写的乐句也在这里听。' : 'Play a phrase, record it and send it to Coo; phrases Coo wrote are heard here too.' },
      ],
      invoke: (panel, method, args) => this.invokePanel(panel, method, args),
      promptDocs: [
        {
          key: 'worlds.compose.envPrompt',
          title: zh ? '作曲 · 环境提示词' : 'Compose · environment prompt',
          description: zh ? '作曲 World 进 system 前缀的那一段。' : 'The Compose section of the system prefix.',
          path: ENV_PROMPT_FILE,
          role: 'envPrompt',
          vars: [],
        },
      ],
    };
  }

  async start(host: WorldHost): Promise<void> {
    this.host = host;
  }

  async stop(): Promise<void> {
    this.player.stop();
  }

  /** Data for the Songs panel. */
  private async invokePanel(panel: string, method: string, args: unknown[]): Promise<unknown> {
    if (panel === 'keyboard') return this.invokeKeyboard(method, args);
    if (panel !== 'songs') throw new Error(`unknown panel: ${panel}`);
    const dir = this.outputDir();
    const title = typeof args[0] === 'string' ? args[0] : '';
    const wav = join(dir, `${slug(title)}.wav`);
    if (method === 'list') {
      const playing = this.player.playing();
      return {
        playing: playing ? { title: playing.title, device: playing.device } : null,
        device: this.opts.cfg.playbackDevice,
        songs: readdirSync(dir).filter((f) => f.endsWith('.json') && !/\.(v\d+|levels)\.json$/.test(f)).map((f) => {
          const name = f.slice(0, -5);
          return {
            title: name,
            rendered: existsSync(join(dir, `${name}.wav`)),
            versions: readdirSync(dir).filter((v) => v.startsWith(`${name}.v`) && v.endsWith('.json')).length,
            changedAtMs: statSync(join(dir, f)).mtimeMs,
          };
        }).sort((a, b) => b.changedAtMs - a.changedAtMs),
      };
    }
    if (method === 'song') {
      const file = join(dir, `${slug(title)}.json`);
      if (!existsSync(file)) throw new Error(`no song titled "${title}"`);
      const levelsFile = join(dir, `${slug(title)}.levels.json`);
      try {
        const levels = existsSync(levelsFile) ? JSON.parse(readFileSync(levelsFile, 'utf8')) as number[] : [];
        return { view: songView(readStored(JSON.parse(readFileSync(file, 'utf8'))), levels) };
      } catch (e) {
        if (e instanceof SheetError) return { problems: e.problems };
        throw e;
      }
    }
    if (method === 'audio') {
      if (!existsSync(wav)) throw new Error(`"${title}" has not been rendered`);
      return { $binary: { mime: 'audio/wav', base64: readFileSync(wav).toString('base64') } };
    }
    if (method === 'play') return { text: this.play({ title }).text };
    if (method === 'stop') return { text: this.stopPlaying().text };
    if (method === 'open') return { text: this.open({ title }).text };
    if (method === 'folder') {
      systemOpen(dir);
      return { text: dir };
    }
    throw new Error(`unknown method: ${method}`);
  }

  /** Data for the Keyboard panel: the phrase notebook, and the door a finished take comes in through. */
  private async invokeKeyboard(method: string, args: unknown[]): Promise<unknown> {
    const dir = this.phraseDir();
    if (method === 'take') return this.keepTake(args[0]);
    if (method === 'phrases') {
      return {
        phrases: readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => {
          const stored = JSON.parse(readFileSync(join(dir, f), 'utf8')) as StoredPhrase;
          return { name: stored.name, played: stored.take !== undefined, rendered: existsSync(join(dir, `${stored.name}.wav`)), changedAtMs: statSync(join(dir, f)).mtimeMs };
        }).sort((a, b) => b.changedAtMs - a.changedAtMs),
      };
    }
    const name = typeof args[0] === 'string' ? args[0] : '';
    const file = join(dir, `${name}.json`);
    if (!PHRASE_NAME.test(name) || !existsSync(file)) throw new Error(`no phrase named "${name}"`);
    if (method === 'phrase') {
      const stored = JSON.parse(readFileSync(file, 'utf8')) as StoredPhrase;
      const arrangement = stored.take ? takeArrangement(stored.take) : arrange(readStored(this.withPhrases(phraseSheet(stored))));
      const notes = arrangement.tracks.filter((track) => track.role === 'lead' || track.role === 'part').flatMap((track) => track.notes.map((n) => [n.at, n.until, n.pitch]));
      return { name, played: stored.take !== undefined, seconds: arrangement.seconds, notes, lines: stored.take ? stored.lines ?? [] : typeof stored.line === 'string' ? [stored.line] : [] };
    }
    if (method === 'audio') {
      const wav = join(dir, `${name}.wav`);
      if (!existsSync(wav)) throw new Error(`"${name}" has no audio`);
      return { $binary: { mime: 'audio/wav', base64: readFileSync(wav).toString('base64') } };
    }
    if (method === 'remove') {
      for (const ext of ['json', 'wav']) rmSync(join(dir, `${name}.${ext}`), { force: true });
      return { removed: name };
    }
    throw new Error(`unknown method: ${method}`);
  }

  private outputDir(): string {
    const dir = this.opts.cfg.outputDir || join(this.opts.dataDir, 'compose');
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  private phraseDir(): string {
    const dir = join(this.outputDir(), 'phrases');
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  private phrase(name: string): StoredPhrase | null {
    const file = join(this.phraseDir(), `${name}.json`);
    return PHRASE_NAME.test(name) && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as StoredPhrase : null;
  }

  /** The phrases a text names with "@name", as motifs: name to line. */
  private phraseMotifs(text: string): Record<string, string> {
    const found: Record<string, string> = {};
    for (const [, name] of text.matchAll(/@([A-Za-z0-9_]+)/g)) {
      if (name in found) continue;
      const line = this.motifLine(name, []);
      if (line !== null) found[name] = line;
    }
    return found;
  }

  /** A phrase's line with the bars that are another phrase ("@take1") written out, since a motif cannot hold a motif. */
  private motifLine(name: string, within: string[]): string | null {
    const stored = this.phrase(name);
    const line = stored ? phraseLine(stored) : null;
    if (line === null) return null;
    return line.split('|').map((bar) => {
      const inner = /^\s*@([A-Za-z0-9_]+)\s*$/.exec(bar)?.[1];
      const written = inner !== undefined && inner !== name && !within.includes(inner) ? this.motifLine(inner, [...within, name]) : null;
      return written === null ? bar : ` ${written} `;
    }).join('|');
  }

  /** A sheet with the phrases it names copied in as motifs, so the stored song does not change when a phrase does. */
  private withPhrases(stored: Stored): Stored {
    if (typeof stored.abc === 'string') return stored;
    const motifs = (stored.motifs && typeof stored.motifs === 'object' ? stored.motifs : {}) as Record<string, string>;
    const named = this.phraseMotifs(JSON.stringify([stored.sections ?? null, stored.tracks ?? null, Object.values(motifs)]));
    for (const name of Object.keys(named)) if (name in motifs) delete named[name];
    return Object.keys(named).length === 0 ? stored : { ...stored, motifs: { ...named, ...motifs } };
  }

  private soundFontFile(): string | null {
    if (this.opts.cfg.soundfontFile) return existsSync(this.opts.cfg.soundfontFile) ? this.opts.cfg.soundfontFile : null;
    if (!existsSync(ASSETS_DIR)) return null;
    const shipped = readdirSync(ASSETS_DIR).find((f) => /\.sf[23]$/i.test(f));
    return shipped ? join(ASSETS_DIR, shipped) : null;
  }

  /** `compose_render`: turns what the toolset's call carries into what is stored, then renders that. */
  private async renderWritten(args: Record<string, unknown>): Promise<ToolOutcome> {
    if (this.toolset === 'score') {
      const text = typeof args.score === 'string' ? args.score : '';
      const { sheet, problems } = parseScore(text, this.phraseMotifs(text));
      return this.renderStored(sheet, problems);
    }
    return this.renderStored(args);
  }

  /** Renders a song from its stored form. `found` are problems met before this point, listed with the rest. */
  private async renderStored(written: Stored, found: string[] = []): Promise<ToolOutcome> {
    const stored = this.withPhrases(written);
    const problems = [...found];
    let song: Song | null = null;
    try {
      song = readStored(stored);
    } catch (e) {
      if (!(e instanceof SheetError)) throw e;
      problems.push(...e.problems);
    }
    if (song === null || problems.length > 0) {
      let kept = '';
      const title = titleOf(stored);
      if (this.toolset !== 'notes' && title !== '') {
        writeFileSync(join(this.outputDir(), `${slug(title)}.json`), JSON.stringify(stored, null, 2) + '\n');
        if (this.toolset !== 'abc') kept = '\nThe song is kept as a draft under its title; correcting the sections named above is enough.';
      }
      return { failed: true, text: `[not rendered] ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n- ${problems.join('\n- ')}${kept}` };
    }
    const file = this.soundFontFile();
    if (file === null) {
      return { failed: true, text: `[not rendered] no SoundFont file: ${this.opts.cfg.soundfontFile || `${ASSETS_DIR} holds no .sf2 or .sf3`}. The song itself reads without problems.` };
    }
    const arrangement = arrange(song);
    const audio = await render(arrangement, this.soundFont.load(file));
    const dir = this.outputDir(), name = slug(song.title);
    const wav = join(dir, `${name}.wav`);
    writeFileSync(wav, wavBytes(audio));
    const versions = readdirSync(dir).filter((f) => f.startsWith(`${name}.v`) && f.endsWith('.json')).length;
    writeFileSync(join(dir, `${name}.v${versions + 1}.json`), JSON.stringify(stored, null, 2) + '\n');
    writeFileSync(join(dir, `${name}.json`), JSON.stringify(stored, null, 2) + '\n');
    const lines = [`Rendered "${song.title}" to ${wav} (version ${versions + 1}).`];
    const facts = measure(song);
    for (const s of facts.sections) s.levelDb = levelDb(audio, arrangement.barTimes[s.bars[0] - 1], arrangement.barTimes[s.bars[1]]);
    writeFileSync(join(dir, `${name}.levels.json`), JSON.stringify(facts.sections.map((s) => Number(s.levelDb!.toFixed(2)))) + '\n');
    if (this.opts.cfg.reportsFacts) {
      lines.push(...describeFacts(song, facts, audio.seconds));
    } else {
      lines.push(`${Math.round(audio.seconds)} seconds, ${song.bars} bars.`);
    }
    return { text: lines.join('\n') };
  }

  private async revise(args: Record<string, unknown>): Promise<ToolOutcome> {
    const title = typeof args.title === 'string' ? args.title : '';
    const file = join(this.outputDir(), `${slug(title)}.json`);
    if (!existsSync(file)) return { failed: true, text: `[not found] no song or draft titled "${title}"` };
    const stored = JSON.parse(readFileSync(file, 'utf8')) as Stored;
    let change = args, found: string[] = [];
    if (this.toolset === 'score') {
      const text = typeof args.score === 'string' ? args.score : '';
      const read = parseScore(text, { ...this.phraseMotifs(text), ...((stored.motifs as Record<string, string>) ?? {}) });
      change = read.sheet;
      found = read.problems;
    }
    const sections = [...((stored.sections as Stored[]) ?? [])];
    const added: string[] = [];
    for (const section of (change.sections as Stored[]) ?? []) {
      const at = sections.findIndex((s) => s.name === section.name);
      if (at >= 0) sections[at] = section;
      else { sections.push(section); added.push(String(section.name)); }
    }
    const merged: Stored = { ...stored, sections };
    for (const key of ['tempo', 'key', 'lead', 'form', 'meter'] as const) if (change[key] !== undefined && change[key] !== null) merged[key] = change[key];
    if (change.motifs && typeof change.motifs === 'object') merged.motifs = { ...((stored.motifs as object) ?? {}), ...(change.motifs as object) };
    if (change.form === undefined && Array.isArray(stored.form)) merged.form = [...(stored.form as string[]), ...added];
    return this.renderStored(merged, found);
  }

  /** `compose_phrase`: keeps a short passage in the notebook and renders it. */
  private async writePhrase(args: Record<string, unknown>): Promise<ToolOutcome> {
    const name = typeof args.name === 'string' ? args.name.trim() : '';
    if (!PHRASE_NAME.test(name)) return { failed: true, text: `[not kept] a phrase name is letters, digits and underscores, so that "@name" can stand for it in a song; got "${name}"` };
    const stored: StoredPhrase = { ...args, name };
    let song: Song;
    try {
      song = readStored(this.withPhrases(phraseSheet(stored)));
    } catch (e) {
      if (!(e instanceof SheetError)) throw e;
      return { failed: true, text: `[not kept] ${e.problems.length} problem${e.problems.length === 1 ? '' : 's'}:\n- ${e.problems.join('\n- ')}` };
    }
    const font = this.soundFontFile();
    if (font === null) return { failed: true, text: `[not kept] no SoundFont file: ${this.opts.cfg.soundfontFile || `${ASSETS_DIR} holds no .sf2 or .sf3`}. The phrase itself reads without problems.` };
    const audio = await render(arrange(song), this.soundFont.load(font));
    const dir = this.phraseDir(), wav = join(dir, `${name}.wav`);
    writeFileSync(wav, wavBytes(audio));
    writeFileSync(join(dir, `${name}.json`), JSON.stringify(stored, null, 2) + '\n');
    const lines = [`Kept the phrase "${name}" and rendered it to ${wav}.`];
    const banded = stored.groove !== undefined && stored.groove !== 'none';
    if (this.opts.cfg.reportsFacts) lines.push(...describeFacts(song, measure(song), audio.seconds).filter((line) => banded || !line.startsWith('Sections:')));
    if (phraseLine(stored) !== null) lines.push(`In a song, a bar written "@${name}" stands for this phrase, and "@${name}+1" moves it a scale step up.`);
    return { text: lines.join('\n') };
  }

  /** A take from the panel's keyboard: kept as a phrase, rendered as it was played, and delivered as an event. */
  private async keepTake(given: unknown): Promise<{ name: string; delivered: boolean; text: string }> {
    const take = readTake(given);
    if (take === null || take.notes.length === 0) throw new Error('the take holds no notes');
    const dir = this.phraseDir();
    let n = 1;
    while (existsSync(join(dir, `take${n}.json`))) n++;
    const name = `take${n}`;
    const lines = takeLines(take);
    const stored: StoredPhrase = { name, take, ...(lines ? { lines } : {}) };
    writeFileSync(join(dir, `${name}.json`), JSON.stringify(stored) + '\n');
    const text = describeTake(name, take, lines);
    const font = this.soundFontFile();
    const blobs: Array<{ bytes: Uint8Array; mime: string; name: string; fallbackText: string }> = [];
    if (font !== null) {
      const audio = await render(takeArrangement(take), this.soundFont.load(font));
      const wav = join(dir, `${name}.wav`);
      writeFileSync(wav, wavBytes(audio));
      blobs.push({ bytes: wavBytesMono(audio), mime: 'audio/wav', name: `${name}.wav`, fallbackText: `(The take as audio, ${audio.seconds.toFixed(1)} s: ${wav})` });
    }
    if (this.host === null) return { name, delivered: false, text };
    await this.host.pushEvent({ type: 'compose.take', ts: new Date().toISOString(), source: this.id, origin: 'internal', text, meta: { phrase: name, notes: take.notes.length }, blobs }, { trigger: 'flush' });
    return { name, delivered: true, text };
  }

  private read(args: Record<string, unknown>): ToolOutcome {
    const dir = this.outputDir();
    const title = typeof args.title === 'string' ? args.title.trim() : '';
    if (title === '') {
      const songs = readdirSync(dir).filter((f) => f.endsWith('.wav')).map((f) => {
        const name = f.slice(0, -4);
        const versions = readdirSync(dir).filter((v) => v.startsWith(`${name}.v`) && v.endsWith('.json')).length;
        return `- ${name} (${versions} version${versions === 1 ? '' : 's'}, last rendered ${statSync(join(dir, f)).mtime.toISOString().slice(0, 16).replace('T', ' ')} UTC)`;
      });
      const phrases = readdirSync(this.phraseDir()).filter((f) => f.endsWith('.json')).map((f) => {
        const stored = JSON.parse(readFileSync(join(this.phraseDir(), f), 'utf8')) as StoredPhrase;
        return `- ${stored.name} (${stored.take ? `played on the keyboard, ${stored.take.notes.length} notes` : 'written'})`;
      });
      return { text: [songs.length === 0 ? `No songs yet in ${dir}.` : `Songs in ${dir}:\n${songs.join('\n')}`, ...(phrases.length > 0 ? [`Phrases:\n${phrases.join('\n')}`] : [])].join('\n') };
    }
    const file = join(dir, `${slug(title)}.json`);
    if (!existsSync(file)) {
      const phrase = this.phrase(title);
      if (phrase === null) return { failed: true, text: `[not found] no song titled "${title}" in ${dir}, and no phrase of that name` };
      if (phrase.take) return { text: describeTake(phrase.name, phrase.take, phrase.lines ?? null) };
      return { text: typeof phrase.abc === 'string' ? phrase.abc : JSON.stringify(phrase, null, 2) + '\n' };
    }
    // in the notation the song was written in: ABC as its text, a score as text, a sheet as its fields
    const stored = JSON.parse(readFileSync(file, 'utf8')) as Stored;
    if (typeof stored.abc === 'string') return { text: stored.abc };
    if (this.toolset === 'score' && Array.isArray(stored.sections)) return { text: writeScore(stored) };
    return { text: JSON.stringify(stored, null, 2) + '\n' };
  }

  /** The rendered file of a title, or the receipt that says why there is none to play. */
  private playable(args: Record<string, unknown>): { file: string; title: string } | ToolOutcome {
    const title = typeof args.title === 'string' ? args.title : '';
    const song = join(this.outputDir(), `${slug(title)}.wav`), phrase = join(this.phraseDir(), `${title}.wav`);
    const file = existsSync(song) ? song : PHRASE_NAME.test(title) && existsSync(phrase) ? phrase : null;
    if (file === null) return { failed: true, text: `[not found] no rendered song titled "${title}", and no phrase of that name` };
    if (!this.opts.cfg.canPlay) return { text: `[not played] playback is turned off in this World's settings. The file is ${file}` };
    return { file, title };
  }

  private play(args: Record<string, unknown>): ToolOutcome {
    const found = this.playable(args);
    if ('text' in found) return found;
    try {
      const playing = this.player.play(found.title, found.file, this.opts.cfg.playbackDevice, this.opts.cfg.playbackVolume);
      const length = `${Math.floor(playing.seconds / 60)}:${String(Math.round(playing.seconds % 60)).padStart(2, '0')}`;
      return { text: `Playing "${found.title}" on ${playing.device}, ${length} long. Whether anyone hears it cannot be seen from here.` };
    } catch (e) {
      return { failed: true, text: `[not played] ${(e as Error).message}. The file is ${found.file}` };
    }
  }

  private stopPlaying(): ToolOutcome {
    const was = this.player.stop();
    return { text: was ? `Stopped "${was.title}" ${Math.round((Date.now() - was.startedAtMs) / 1000)} seconds in.` : 'Nothing was playing.' };
  }

  private open(args: Record<string, unknown>): ToolOutcome {
    const found = this.playable(args);
    if ('text' in found) return found;
    systemOpen(found.file);
    return { text: `Asked the system to open ${found.file} in its default player. Whether it is audible cannot be seen from here.` };
  }
}

/** Hands a file or folder to the system: a file opens in its default app, a folder in the file manager. */
function systemOpen(target: string): void {
  const [command, commandArgs] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', target]]
    : process.platform === 'darwin' ? ['open', [target]] : ['xdg-open', [target]];
  spawn(command as string, commandArgs as string[], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}
