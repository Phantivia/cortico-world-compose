/**
 * Compose World: the bot writes a lead sheet, the World plays it. Receipts state what was written to disk and
 * what was measured in the result.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ToolDef, ToolOutcome, World, WorldHost, WorldWebUiDecl } from 'cortico/core/types.ts';
import { arrange } from './arrange.ts';
import { composeConfigGroup, type ComposeConfigSection } from './config.ts';
import { describeFacts, measure } from './facts.ts';
import { GROOVES, GROOVE_NAMES } from './grooves.ts';
import { INSTRUMENT_NAMES } from './instruments.ts';
import { readSong, SheetError } from './sheet.ts';
import { Player } from './player.ts';
import { levelDb, render, SoundFont, wavBytes } from './synth.ts';
import { songView } from './view.ts';

const ENV_PROMPT_FILE = fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url));
const ASSETS_DIR = fileURLToPath(new URL('../assets/', import.meta.url));

const LINE_FORMAT =
  'A line is bars separated by "|". A bar is slots of equal length separated by spaces: 4 slots are quarter notes, 8 are eighths, ' +
  '16 are sixteenths (3, 6 or 12 for triplets); bars of one line may use different slot counts. A slot is a pitch ("F#5", "Bb4"; C4 is middle C), ' +
  '"-" to hold the previous note, or "." for a rest. "%" repeats the previous bar. ' +
  'Two bars of eighths: ". F#5 A5 D6 - - E6 - | - . . C#6 B5 - . ."';

const SHEET_TOOL: Omit<ToolDef, 'handler'> = {
  name: 'compose_render',
  description:
    'Render a song written as a lead sheet to an audio file. You write the form, the chords and the melodic lines; ' +
    "chords, bass and drums are played from each section's groove and energy. Rendering a title again replaces its audio. " +
    LINE_FORMAT + ' ' +
    'The receipt gives the file and measured facts: length, the level of each section, ranges, notes that clash with their chord, bars that repeat.',
  tags: ['write'],
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string', description: 'Song title; also the file name.' },
      tempo: { type: 'number', description: 'Beats per minute, 30–300.' },
      key: { type: 'string', description: 'Like "D major", "B minor", "F dorian".' },
      meter: { type: 'string', enum: ['4/4', '3/4'], description: 'Default 4/4.' },
      lead: { type: 'string', description: `Instrument that plays each section's "melody". One of: ${INSTRUMENT_NAMES.join(', ')}.` },
      motifs: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'Named lines to reuse. In any line, a bar written "@name" stands for the motif; "@name+1" or "@name-2" moves it by that many scale steps of the key.',
      },
      form: { type: 'array', items: { type: 'string' }, description: 'Section names in playing order; a name may come more than once. Without it the sections play once each, in the order written.' },
      sections: {
        type: 'array',
        description: 'The sections of the song, each written once.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string' },
            like: { type: 'string', description: 'Name of an earlier section to copy; fields given here replace the copied ones.' },
            groove: {
              type: 'string',
              enum: GROOVE_NAMES,
              description: 'What the band plays. ' + Object.entries(GROOVES).map(([name, g]) => `${name}: ${g.summary}`).join('. ') + '. none: no band, only the written lines.' +
                ' waltz needs meter 3/4; the others except ambient and none need 4/4.',
            },
            energy: { type: 'integer', minimum: 1, maximum: 5, description: 'How full and loud the band plays: 1 is the barest version of the groove, 5 the busiest. Written lines get louder with it too.' },
            chords: { type: 'string', description: 'One bar per "|", one to eight symbols per bar sharing it equally, "-" holds, "%" repeats the bar, "N.C." silences the band: "Dmaj9 | Em9 A13 | F#m7 - - B7b9".' },
            melody: { type: 'string', description: 'The line of the lead instrument.' },
            parts: { type: 'object', additionalProperties: { type: 'string' }, description: 'More lines, keyed by instrument name: counter-melodies, answers, doublings. The key "drums" takes drum letters instead of pitches (K kick, S snare, X rim, H hi-hat, O open hat, R ride, C crash, T tom, M shaker), several per slot.' },
            stops: { type: 'array', items: { type: 'integer' }, description: 'Bar numbers within the section where the band plays one hit on beat 1 and then rests; written lines go on.' },
          },
          required: ['name'],
        },
      },
    },
    required: ['title', 'tempo', 'sections'],
  },
};

const NOTES_TOOL: Omit<ToolDef, 'handler'> = {
  name: 'compose_render',
  description:
    'Render written tracks to an audio file. Nothing is added: every instrument, bass and drums included, is a line you write. ' +
    'Rendering a title again replaces its audio. ' + LINE_FORMAT,
  tags: ['write'],
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string', description: 'Song title; also the file name.' },
      tempo: { type: 'number', description: 'Beats per minute, 30–300.' },
      meter: { type: 'string', enum: ['4/4', '3/4'], description: 'Default 4/4.' },
      tracks: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: `One line per instrument, all starting at bar 1. Instruments: ${INSTRUMENT_NAMES.join(', ')}. The key "drums" takes drum letters instead of pitches (K kick, S snare, X rim, H hi-hat, O open hat, R ride, C crash, T tom, M shaker), several per slot.`,
      },
    },
    required: ['title', 'tempo', 'tracks'],
  },
};

const SHEET_PROPERTIES = (SHEET_TOOL.parameters as { properties: Record<string, Record<string, unknown>> }).properties;

const REVISE_TOOL: Omit<ToolDef, 'handler'> = {
  name: 'compose_revise',
  description:
    'Change parts of a song already written (rendered, or kept as a draft after a failed render) and render it. Give only what changes: a section with the name of an existing one replaces it, ' +
    'a section with a new name is added (at the end of the playing order unless form is given), a motif replaces the one of the same name, ' +
    'and tempo, key, lead and form replace the old values. Everything else stays as it was. The receipt is that of a full render.',
  tags: ['write'],
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string', description: 'Title of the song to change.' },
      tempo: SHEET_PROPERTIES.tempo,
      key: SHEET_PROPERTIES.key,
      lead: SHEET_PROPERTIES.lead,
      motifs: SHEET_PROPERTIES.motifs,
      form: SHEET_PROPERTIES.form,
      sections: { ...SHEET_PROPERTIES.sections, description: 'Sections to replace or add, written in full.' },
    },
    required: ['title'],
  },
};

const READ_TOOL: Omit<ToolDef, 'handler'> = {
  name: 'compose_read',
  description: 'Without a title: list the songs written so far. With a title: return the sheet last rendered under it, as it was written.',
  tags: ['read'],
  parameters: { type: 'object', additionalProperties: false, properties: { title: { type: 'string' } } },
};

const TITLE_ONLY = { type: 'object', additionalProperties: false, properties: { title: { type: 'string' } }, required: ['title'] };

const PLAY_TOOL: Omit<ToolDef, 'handler'> = {
  name: 'compose_play',
  description: "Play a rendered song aloud on this computer, through the output device chosen in this World's settings. It returns as soon as playback has started; a song already playing is stopped first.",
  tags: ['act'],
  parameters: TITLE_ONLY,
};

const STOP_TOOL: Omit<ToolDef, 'handler'> = {
  name: 'compose_stop',
  description: 'Stop the song that compose_play is playing.',
  tags: ['act'],
  parameters: { type: 'object', additionalProperties: false, properties: {} },
};

const OPEN_TOOL: Omit<ToolDef, 'handler'> = {
  name: 'compose_open',
  description: "Open a rendered song's audio file in the computer's default player application, where the person can pause, seek and replay it themselves.",
  tags: ['act'],
  parameters: TITLE_ONLY,
};

/** Every tool an instance may return; `toolset` picks which `compose_render` it is. */
export const COMPOSE_TOOL_DECLS: ReadonlyArray<Omit<ToolDef, 'handler'>> = [SHEET_TOOL, REVISE_TOOL, READ_TOOL, PLAY_TOOL, STOP_TOOL, OPEN_TOOL];

export interface ComposeWorldOptions {
  cfg: ComposeConfigSection;
  dataDir: string;
}

const slug = (title: string): string => title.trim().replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').slice(0, 80) || 'Untitled';

export class ComposeWorld implements World {
  readonly id = 'compose';
  private readonly soundFont = new SoundFont();
  private readonly toolset: ComposeConfigSection['toolset'];
  private readonly player = new Player();

  constructor(private readonly opts: ComposeWorldOptions) {
    this.toolset = opts.cfg.toolset;
  }

  envPromptVars(): Record<string, string> {
    return {};
  }

  tools(): ToolDef[] {
    return [
      { ...(this.toolset === 'notes' ? NOTES_TOOL : SHEET_TOOL), handler: (args) => this.renderSong(args) },
      ...(this.toolset === 'notes' ? [] : [{ ...REVISE_TOOL, handler: (args: Record<string, unknown>) => this.revise(args) }]),
      { ...READ_TOOL, handler: async (args) => this.read(args) },
      { ...PLAY_TOOL, handler: async (args) => this.play(args) },
      { ...STOP_TOOL, handler: async () => this.stopPlaying() },
      { ...OPEN_TOOL, handler: async (args) => this.open(args) },
    ];
  }

  webUi(language = 'zh'): WorldWebUiDecl {
    const zh = language.startsWith('zh');
    return {
      label: zh ? '作曲' : 'Compose',
      config: [composeConfigGroup(language)],
      panels: [{ id: 'songs', title: zh ? '曲子' : 'Songs', description: zh ? '写过的曲子:音符、段落、测量结果和试听。' : 'The songs written so far: notes, sections, measured facts and playback.' }],
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

  async start(_host: WorldHost): Promise<void> {}

  async stop(): Promise<void> {
    this.player.stop();
  }

  /** Data for the Songs panel. */
  private async invokePanel(panel: string, method: string, args: unknown[]): Promise<unknown> {
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
        return { view: songView(readSong(this.asSheet(JSON.parse(readFileSync(file, 'utf8')))), levels) };
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
    throw new Error(`unknown method: ${method}`);
  }

  private asSheet(args: Record<string, unknown>): Record<string, unknown> {
    return args.tracks !== undefined && args.sections === undefined
      ? { title: args.title, tempo: args.tempo, meter: args.meter, sections: [{ name: 'song', groove: 'none', parts: args.tracks }] }
      : args;
  }

  private outputDir(): string {
    const dir = this.opts.cfg.outputDir || join(this.opts.dataDir, 'compose');
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  private soundFontFile(): string | null {
    if (this.opts.cfg.soundfontFile) return existsSync(this.opts.cfg.soundfontFile) ? this.opts.cfg.soundfontFile : null;
    if (!existsSync(ASSETS_DIR)) return null;
    const shipped = readdirSync(ASSETS_DIR).find((f) => /\.sf[23]$/i.test(f));
    return shipped ? join(ASSETS_DIR, shipped) : null;
  }

  private async renderSong(args: Record<string, unknown>): Promise<ToolOutcome> {
    const sheet = this.asSheet(args);
    let song;
    try {
      song = readSong(sheet);
    } catch (e) {
      if (!(e instanceof SheetError)) throw e;
      let kept = '';
      if (this.toolset === 'sheet' && typeof args.title === 'string' && args.title.trim() !== '') {
        writeFileSync(join(this.outputDir(), `${slug(args.title)}.json`), JSON.stringify(args, null, 2) + '\n');
        kept = '\nThe sheet is kept as a draft under its title; correcting the sections named above is enough.';
      }
      return { failed: true, text: `[not rendered] ${e.problems.length} problem${e.problems.length === 1 ? '' : 's'} in the sheet:\n- ${e.problems.join('\n- ')}${kept}` };
    }
    const file = this.soundFontFile();
    if (file === null) {
      return { failed: true, text: `[not rendered] no SoundFont file: ${this.opts.cfg.soundfontFile || `${ASSETS_DIR} holds no .sf2 or .sf3`}. The sheet itself reads without problems.` };
    }
    const arrangement = arrange(song);
    const audio = await render(arrangement, this.soundFont.load(file));
    const dir = this.outputDir(), name = slug(song.title);
    const wav = join(dir, `${name}.wav`);
    writeFileSync(wav, wavBytes(audio));
    const versions = readdirSync(dir).filter((f) => f.startsWith(`${name}.v`) && f.endsWith('.json')).length;
    writeFileSync(join(dir, `${name}.v${versions + 1}.json`), JSON.stringify(args, null, 2) + '\n');
    writeFileSync(join(dir, `${name}.json`), JSON.stringify(args, null, 2) + '\n');
    const lines = [`Rendered "${song.title}" to ${wav} (version ${versions + 1}).`];
    const facts = measure(song);
    const spb = arrangement.secondsPerBeat * song.beatsPerBar;
    for (const s of facts.sections) s.levelDb = levelDb(audio, arrangement.leadIn + (s.bars[0] - 1) * spb, arrangement.leadIn + s.bars[1] * spb);
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
    const stored = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    const sections = [...((stored.sections as Array<Record<string, unknown>>) ?? [])];
    const added: string[] = [];
    for (const section of (args.sections as Array<Record<string, unknown>>) ?? []) {
      const at = sections.findIndex((s) => s.name === section.name);
      if (at >= 0) sections[at] = section;
      else { sections.push(section); added.push(String(section.name)); }
    }
    const merged: Record<string, unknown> = { ...stored, sections };
    for (const key of ['tempo', 'key', 'lead', 'form'] as const) if (args[key] !== undefined && args[key] !== null) merged[key] = args[key];
    if (args.motifs && typeof args.motifs === 'object') merged.motifs = { ...((stored.motifs as object) ?? {}), ...(args.motifs as object) };
    if (args.form === undefined && Array.isArray(stored.form)) merged.form = [...(stored.form as string[]), ...added];
    return this.renderSong(merged);
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
      return { text: songs.length === 0 ? `No songs yet in ${dir}.` : `Songs in ${dir}:\n${songs.join('\n')}` };
    }
    const file = join(dir, `${slug(title)}.json`);
    if (!existsSync(file)) return { failed: true, text: `[not found] no song titled "${title}" in ${dir}` };
    return { text: readFileSync(file, 'utf8') };
  }

  /** The rendered file of a title, or the receipt that says why there is none to play. */
  private playable(args: Record<string, unknown>): { file: string; title: string } | ToolOutcome {
    const title = typeof args.title === 'string' ? args.title : '';
    const file = join(this.outputDir(), `${slug(title)}.wav`);
    if (!existsSync(file)) return { failed: true, text: `[not found] no rendered song titled "${title}"` };
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
    const [command, commandArgs] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', found.file]]
      : process.platform === 'darwin' ? ['open', [found.file]] : ['xdg-open', [found.file]];
    spawn(command as string, commandArgs as string[], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    return { text: `Asked the system to open ${found.file} in its default player. Whether it is audible cannot be seen from here.` };
  }
}
