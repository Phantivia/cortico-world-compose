/**
 * What the benchmark varies: how a song is written down (the toolset), whether receipts carry measured facts,
 * and the environment prompt. A variant without `prompt` runs on the shipped src/ENV_PROMPT.md.
 */

export interface Variant { toolset: 'sheet' | 'score' | 'abc' | 'notes'; facts: boolean; prompt?: string; about: string }

export const VARIANTS: Record<string, Variant> = {
  // 2026-11-15: does a generated band, a receipt with facts, a composing guide help a small model
  notes: { toolset: 'notes', facts: false, prompt: 'plain.md', about: 'every track written note by note, no band, bare receipt' },
  sheet: { toolset: 'sheet', facts: false, prompt: 'plain.md', about: 'lead sheet, generated band, bare receipt' },
  facts: { toolset: 'sheet', facts: true, prompt: 'plain.md', about: 'lead sheet, generated band, receipt with measured facts' },
  guided: { toolset: 'sheet', facts: true, prompt: 'guided.md', about: 'as facts, plus an environment prompt on how to build a song' },
  staged: { toolset: 'sheet', facts: true, prompt: 'staged.md', about: 'as guided, with the advice to work in passes (the prompt shipped in 0.1.0)' },
  // 2026-11-19: three ways to write the same song down, with the band a default that can be lifted
  'sheet.guide': { toolset: 'sheet', facts: true, about: 'fields of a tool call, shipped prompt' },
  'score.guide': { toolset: 'score', facts: true, about: 'the same notation as one text, shipped prompt' },
  'abc.guide': { toolset: 'abc', facts: true, about: 'ABC notation, shipped prompt' },
  'sheet.open': { toolset: 'sheet', facts: true, prompt: 'open.md', about: 'fields of a tool call, a prompt that states what is possible and gives no advice on composing' },
  'score.open': { toolset: 'score', facts: true, prompt: 'open.md', about: 'one text, the same bare prompt' },
  'abc.open': { toolset: 'abc', facts: true, prompt: 'open.md', about: 'ABC notation, the same bare prompt' },
};

export const TASKS: Record<string, string> = {
  bossa: '给我写一首 bossa nova，联想要素：1）航站楼 2）未来感 3）领航员。直接写，不用先问我，写完告诉我文件在哪。',
  lofi: '写一首下雨天写作业时听的 lofi，一分钟左右。直接写，不用先问我，写完告诉我文件在哪。',
  birthday: '朋友今天过生日，给他写一段三十秒左右的欢快小曲。直接写，不用先问我，写完告诉我文件在哪。',
  // two requests no stock groove answers: the band has to be written by hand
  nocturne: '写一段一分钟左右的钢琴独奏，夜曲的感觉，左手的伴奏音型你自己设计。直接写，不用先问我，写完告诉我文件在哪。',
  fives: '写一首 5/4 拍的小曲，四十秒左右，鼓和贝斯要有自己的性格，不要现成的套路。直接写，不用先问我，写完告诉我文件在哪。',

  // 2026-11-19 (0.3.0): phrase-sized requests. Is a phrase written and played, or a whole song?
  riff: '我想要一个两小节的吉他 riff，带点放克味。先弹给我听听。',
  endings: '有一段旋律是 C5 D5 E5 G5 | E5 D5 C5 -(4/4，一拍一个音)。给它想两个不同的结尾，各两小节，都弹给我听，我挑一个。',
  // with a take from the keyboard (TAKES below) delivered just before the message
  answer: '我刚在键盘上弹了一句，你听听，接着它往下写两小节，然后连起来弹给我。',
  grow: '用我刚弹的那句当动机，写一首三十秒左右的小曲。直接写，不用先问我，写完告诉我文件在哪。',
};

/** A take delivered through the Keyboard panel before the task of the same name is sent: [seconds, seconds held, pitch]. */
export const TAKES: Record<string, { tempo: number | null; meter: string; notes: Array<[number, number, number]> }> = {
  answer: { tempo: 100, meter: '4/4', notes: [[0.02, 0.55, 64], [0.61, 0.28, 67], [0.9, 0.3, 69], [1.21, 1.1, 67], [2.4, 0.3, 64], [2.71, 0.28, 62], [3.01, 0.56, 60], [3.6, 1.1, 62]] },
  grow: { tempo: null, meter: '4/4', notes: [[0, 0.4, 69], [0.45, 0.2, 72], [0.68, 0.22, 76], [0.93, 0.9, 74], [1.95, 0.2, 72], [2.2, 0.21, 74], [2.44, 1.2, 69]] },
};
