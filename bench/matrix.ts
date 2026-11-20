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
};
