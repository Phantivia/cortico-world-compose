/**
 * The tools as the model sees them. `toolset` picks how a song is written down: `sheet` as the fields of a tool
 * call, `score` as one text with the same notation, `abc` as ABC notation, `notes` as bare tracks. Playing,
 * stopping, opening and reading are the same in all of them.
 */
import type { ToolDef } from 'cortico/core/types.ts';
import type { ComposeConfigSection } from './config.ts';
import { GROOVES, GROOVE_NAMES } from './grooves.ts';
import { INSTRUMENT_NAMES } from './instruments.ts';

type Decl = Omit<ToolDef, 'handler'>;

// The examples in these texts show notation only: one pitch, a plain cadence, a two-bar layout. A model given a
// tuneful example writes that tune (the 0.1.0 example, a bossa line in D major, came back as the song in 2026-11-19 runs).

const LINE_FORMAT =
  'A line is bars separated by "|". A bar is slots of equal length separated by spaces: 4 slots are quarter notes, 8 are eighths, ' +
  '16 are sixteenths (3, 6 or 12 for triplets); bars of one line may use different slot counts. A slot is a pitch ("F#5", "Bb4"; C4 is middle C), ' +
  '"-" to hold the previous note, or "." for a rest. "%" repeats the previous bar. ' +
  'Two bars of eighths on one pitch: ". C4 C4 C4 - - C4 - | - . . C4 C4 - . ."';

const LINE_EXTRAS =
  'A line can also hold, where the music asks for it: pitches joined by "+" that sound together ("C3+G3+E4"); "[..]", a group of slots that share one slot ' +
  '("C4 [C4 C4 C4] C4 -" puts a triplet on beat 2); dynamic marks "(pp)" "(p)" "(mp)" "(mf)" "(f)" "(ff)", which take no slot and set the loudness of that line from there on, ' +
  'with "(<)" and "(>)" ramping to the next mark. A line without marks takes its loudness from the section\'s energy.';

const GROOVE_TEXT =
  Object.entries(GROOVES).map(([name, g]) => `${name}: ${g.summary}`).join('. ') + '. none: no band, only the written lines.' +
  ' waltz needs meter 3/4; the others except ambient and none need 4/4.';

const ENERGY_TEXT = 'How full and loud the band plays: 1 is the barest version of the groove, 5 the busiest. Written lines get louder with it too.';

const BAND_TEXT =
  'Changes to the band the groove brings, in this section. Its roles are "chords", "bass", "drums" and "fills" (the fill into the next section and the crash that opens a loud one). ' +
  '"off" silences a role, leaving it to a line you write or to nobody; "chords" and "bass" also take an instrument name, which hands the role to that instrument. Roles not named play as the groove has them.';

const DRUM_TEXT = 'drum letters instead of pitches (K kick, S snare, X rim, H hi-hat, O open hat, R ride, C crash, T tom, M shaker) or General MIDI percussion key numbers, several per slot ("KH", "K+56")';

const PART_KEYS =
  'An instrument name may carry a label after a colon ("piano:left", "drums:hats"), which gives that instrument one more line of its own, ' +
  'and may be "gm" with a General MIDI program number ("gm 105") for an instrument not in the list.';

const METER_TEXT = 'Like "4/4", "3/4", "6/8", "5/4", "7/8": a bar of 1 to 8 quarter notes. Default 4/4. Tempo counts quarter notes in every meter.';

const RECEIPT_TEXT = 'The receipt gives the file and measured facts: length, the level of each section and what of the band played in it, ranges, notes that clash with their chord, bars that repeat.';

const SHEET_TOOL: Decl = {
  name: 'compose_render',
  description:
    'Render a song written as a lead sheet to an audio file. You write the form, the chords and the melodic lines; ' +
    "chords, bass and drums are played from each section's groove and energy. Rendering a title again replaces its audio. " +
    LINE_FORMAT + ' ' + LINE_EXTRAS + ' ' + RECEIPT_TEXT,
  tags: ['write'],
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string', description: 'Song title; also the file name.' },
      tempo: { type: 'number', description: 'Quarter notes per minute, 30–300.' },
      key: { type: 'string', description: 'Like "D major", "B minor", "F dorian".' },
      meter: { type: 'string', description: METER_TEXT },
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
            groove: { type: 'string', enum: GROOVE_NAMES, description: 'What the band plays. ' + GROOVE_TEXT },
            energy: { type: 'integer', minimum: 1, maximum: 5, description: ENERGY_TEXT },
            chords: { type: 'string', description: 'One bar per "|", one to eight symbols per bar sharing it equally, "-" holds, "%" repeats the bar, "N.C." silences the band: "C | F G7 | Am7 - - E7b9".' },
            melody: { type: 'string', description: 'The line of the lead instrument.' },
            parts: {
              type: 'object',
              additionalProperties: { type: 'string' },
              description: `More lines, keyed by instrument name: counter-melodies, answers, doublings, or a role of the band written by hand. ${PART_KEYS} The key "drums" takes ${DRUM_TEXT}.`,
            },
            stops: { type: 'array', items: { type: 'integer' }, description: 'Bar numbers within the section where the band plays one hit on beat 1 and then rests; written lines go on.' },
            band: {
              type: 'object',
              additionalProperties: false,
              properties: { chords: { type: 'string' }, bass: { type: 'string' }, drums: { type: 'string' }, fills: { type: 'string' } },
              description: BAND_TEXT + ' Example: {"bass": "off", "chords": "vibraphone"}.',
            },
            tempo: { type: 'number', description: "This section's own tempo, when it differs from the song's." },
            meter: { type: 'string', description: "This section's own meter, when it differs from the song's." },
            key: { type: 'string', description: "This section's own key, when it differs from the song's." },
          },
          required: ['name'],
        },
      },
    },
    required: ['title', 'tempo', 'sections'],
  },
};

const SHEET_PROPERTIES = (SHEET_TOOL.parameters as { properties: Record<string, Record<string, unknown>> }).properties;

const REVISE_TOOL: Decl = {
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

const SCORE_TEXT =
  'The song as text. It opens with header lines: "title: …" (also the file name), "tempo: <number>" (quarter notes per minute, 30–300), "key: C major" (or minor, dorian, …), ' +
  '"meter: 6/8" (a bar of 1 to 8 quarter notes; default 4/4), "lead: <instrument>" (the instrument of each section\'s "melody" line), ' +
  '"form: A B A" (section names in playing order, a name may come more than once; without it the sections play once each as written), ' +
  'and "motif <name>: <line>" for a line to reuse: a bar written "@name" stands for it, "@name+1" or "@name-2" moves it by that many scale steps of the key.\n' +
  'A section opens with "[name] groove=<groove> energy=<1-5>". "like=<earlier section>" copies that section, and the lines written here replace the copied ones; "tempo=", "meter=" and "key=" hold for this section only. ' +
  'Below it, one line per part:\n' +
  '"chords: C | F G7 | Am7 - - E7b9": one bar per "|", one to eight symbols sharing it equally, "-" holds, "%" repeats the bar, "N.C." silences the band.\n' +
  '"melody: …": the line of the lead instrument.\n' +
  '"<instrument>: …": more lines (counter-melodies, answers, doublings, or a role of the band written by hand). ' + PART_KEYS + ' "drums: …" takes ' + DRUM_TEXT + '.\n' +
  '"stops: 4 8": bars of the section where the band plays one hit on beat 1 and then rests; written lines go on.\n' +
  '"band: bass=off chords=vibraphone": ' + BAND_TEXT.charAt(0).toLowerCase() + BAND_TEXT.slice(1) + '\n' +
  'A blank line inside a section ends a system: the lines after it go on from the bar where the longest line above stopped, so a part left out of a system rests through it.\n' +
  'Grooves: ' + GROOVE_TEXT + '\n' +
  'Energy: ' + ENERGY_TEXT.charAt(0).toLowerCase() + ENERGY_TEXT.slice(1) + '\n' +
  `Instruments: ${INSTRUMENT_NAMES.join(', ')}.\n` +
  'How a score is laid out (the notes are placeholders):\ntitle: Layout\ntempo: 100\nkey: C major\nlead: piano\nform: A B A\n\n[A] groove=pop energy=2\nchords: C | G7\nmelody: C5 . C5 . | C5 - - -\n\nchords: Am | G7\nmelody: C5 . C5 . | C5 - - -\nflute:  . . . . | . . C6 -\n\n[B] groove=none\nmelody: (p) C5 - - - | C5 - . .\npiano:left: C3+G3 - - - | C3+G3 - . .';

const SCORE_TOOL: Decl = {
  name: 'compose_render',
  description:
    'Render a song written as a score to an audio file. You write the form, the chords and the melodic lines; ' +
    "chords, bass and drums are played from each section's groove and energy. Rendering a title again replaces its audio. " +
    LINE_FORMAT + ' ' + LINE_EXTRAS + ' ' + RECEIPT_TEXT,
  tags: ['write'],
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: { score: { type: 'string', description: SCORE_TEXT } },
    required: ['score'],
  },
};

const SCORE_REVISE_TOOL: Decl = {
  name: 'compose_revise',
  description:
    'Change parts of a song already written (rendered, or kept as a draft after a failed render) and render it. Give a score that holds only what changes: ' +
    'a section with the name of an existing one replaces it, a section with a new name is added (at the end of the playing order unless a form line is given), ' +
    'a motif line replaces the motif of that name, and tempo, key, lead and form lines replace the old values. Everything else stays as it was. The receipt is that of a full render.',
  tags: ['write'],
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string', description: 'Title of the song to change.' },
      score: { type: 'string', description: 'Header lines, motifs and sections in the notation of compose_render; sections are written in full.' },
    },
    required: ['title', 'score'],
  },
};

const ABC_TOOL: Decl = {
  name: 'compose_render',
  description:
    'Render a tune written in ABC notation to an audio file. Rendering a title again replaces its audio. ' +
    'Read from the ABC: the header (T: is the title and file name, M:, L:, Q:, K:), voices (V:), notes and rests with lengths, chords in brackets, ties, tuplets, broken rhythm, ' +
    'repeats with first and second endings, chord symbols in quotes, !p! to !ff! dynamics, inline fields. Grace notes, lyrics and other decorations are skipped. ' +
    'Each voice is an instrument, picked by its name (V:1 name="flute") or by a "%%MIDI program <n>" line under it; a voice named drums plays General MIDI percussion keys (C,, is 36, the kick; D,, the snare; ^F,, the closed hi-hat). ' +
    'By itself the tune is played as written, nothing added. A line "%%groove <groove> <energy 1-5>" before a bar starts a section in which a band plays chords, bass and drums from the chord symbols; ' +
    '"%%groove none" ends that. "%%band bass=off chords=vibraphone" changes the band: ' + BAND_TEXT.charAt(0).toLowerCase() + BAND_TEXT.slice(1) + ' A "P:<name>" line names the section that starts there. ' +
    'Grooves: ' + GROOVE_TEXT + ' Energy: ' + ENERGY_TEXT.charAt(0).toLowerCase() + ENERGY_TEXT.slice(1) + ' ' +
    `Instruments: ${INSTRUMENT_NAMES.join(', ')}. ` + RECEIPT_TEXT,
  tags: ['write'],
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: { abc: { type: 'string', description: 'The whole tune in ABC notation, header first.' } },
    required: ['abc'],
  },
};

const NOTES_TOOL: Decl = {
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

const READ_TOOL: Decl = {
  name: 'compose_read',
  description: 'Without a title: list the songs written so far. With a title: return the song last rendered under it, as it was written.',
  tags: ['read'],
  parameters: { type: 'object', additionalProperties: false, properties: { title: { type: 'string' } } },
};

const TITLE_ONLY = { type: 'object', additionalProperties: false, properties: { title: { type: 'string' } }, required: ['title'] };

const PLAY_TOOL: Decl = {
  name: 'compose_play',
  description: "Play a rendered song aloud on this computer, through the output device chosen in this World's settings. It returns as soon as playback has started; a song already playing is stopped first.",
  tags: ['act'],
  parameters: TITLE_ONLY,
};

const STOP_TOOL: Decl = {
  name: 'compose_stop',
  description: 'Stop the song that compose_play is playing.',
  tags: ['act'],
  parameters: { type: 'object', additionalProperties: false, properties: {} },
};

const OPEN_TOOL: Decl = {
  name: 'compose_open',
  description: "Open a rendered song's audio file in the computer's default player application, where the person can pause, seek and replay it themselves.",
  tags: ['act'],
  parameters: TITLE_ONLY,
};

const SHARED: Decl[] = [READ_TOOL, PLAY_TOOL, STOP_TOOL, OPEN_TOOL];

/** The tools of each toolset, `compose_render` first. */
export const TOOLSETS: Record<ComposeConfigSection['toolset'], Decl[]> = {
  sheet: [SHEET_TOOL, REVISE_TOOL, ...SHARED],
  score: [SCORE_TOOL, SCORE_REVISE_TOOL, ...SHARED],
  abc: [ABC_TOOL, ...SHARED],
  notes: [NOTES_TOOL, ...SHARED],
};
