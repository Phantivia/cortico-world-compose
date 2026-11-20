import { describeTools, type WorldDefinition } from 'cortico/world.ts';
import { COMPOSE_DEFAULTS, type ComposeConfigSection } from './config.ts';
import { composeConfigOptions } from './player.ts';
import { COMPOSE_TOOL_DECLS, ComposeWorld } from './world.ts';

export const COMPOSE: WorldDefinition<ComposeConfigSection> = {
  id: 'compose',
  label: 'Compose',
  defaults: () => ({ ...COMPOSE_DEFAULTS }),
  configOptions: (kind, language) => composeConfigOptions(kind, language),
  create: (ctx) => new ComposeWorld({ cfg: ctx.cfg, dataDir: ctx.dataDir }),
  describe: {
    tools: describeTools(COMPOSE_TOOL_DECLS, {
      compose_render: { zh: '把一份谱子(曲式、和弦、旋律)渲染成音频;伴奏按律动生成，每段可以关掉或改写其中任一角色。', en: 'Renders a lead sheet (form, chords, melodies) to audio; the band is generated from the groove, and any of its roles can be switched off or rewritten per section.' },
      compose_revise: { zh: '只给出要改的部分(某几段、动机、速度、段落顺序),合进已有的谱子后重新渲染。', en: 'Takes only what changes (sections, motifs, tempo, playing order), merges it into the stored sheet and renders again.' },
      compose_read: { zh: '列出写过的曲子，或取回某一首最近一次渲染的谱子。', en: 'Lists the songs written so far, or returns the sheet last rendered under a title.' },
      compose_play: { zh: '在配置里选定的输出设备上播放一首渲染好的曲子。', en: 'Plays a rendered song on the output device chosen in the settings.' },
      compose_stop: { zh: '停止正在播放的曲子。', en: 'Stops the song that is playing.' },
      compose_open: { zh: '用系统默认播放器打开一首曲子的音频文件。', en: "Opens a song's audio file in the system's default player." },
    }),
    events: [],
  },
};
