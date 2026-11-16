/** What the benchmark varies: the tool shape, whether receipts carry measured facts, the environment prompt. */

export interface Variant { toolset: 'sheet' | 'notes'; facts: boolean; prompt?: string; about: string }

export const VARIANTS: Record<string, Variant> = {
  notes: { toolset: 'notes', facts: false, about: 'every track written note by note, no band, bare receipt' },
  sheet: { toolset: 'sheet', facts: false, about: 'lead sheet, generated band, bare receipt' },
  facts: { toolset: 'sheet', facts: true, about: 'lead sheet, generated band, receipt with measured facts' },
  staged: { toolset: 'sheet', facts: true, prompt: 'staged.md', about: 'as guided, with the advice to work in passes (the shipped environment prompt); compose_revise is there in every sheet variant from this point on' },
  guided: { toolset: 'sheet', facts: true, prompt: 'guided.md', about: 'as facts, plus an environment prompt on how to build a song' },
};

export const TASKS: Record<string, string> = {
  bossa: '给我写一首 bossa nova，联想要素：1）航站楼 2）未来感 3）领航员。直接写，不用先问我，写完告诉我文件在哪。',
  lofi: '写一首下雨天写作业时听的 lofi，一分钟左右。直接写，不用先问我，写完告诉我文件在哪。',
  birthday: '朋友今天过生日，给他写一段三十秒左右的欢快小曲。直接写，不用先问我，写完告诉我文件在哪。',
};
