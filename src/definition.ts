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
      compose_phrase: { zh: '写下一两句旋律并立刻渲染，存进乐句本;在曲子里用 @名字 引用。', en: 'Writes down a phrase or two, renders it at once and keeps it in the notebook; a song refers to it as @name.' },
      compose_read: { zh: '列出写过的曲子和乐句，或取回其中一个。', en: 'Lists the songs and phrases written so far, or returns one of them.' },
      compose_play: { zh: '在配置里选定的输出设备上播放一首曲子或一个乐句。', en: 'Plays a song or a phrase on the output device chosen in the settings.' },
      compose_stop: { zh: '停止正在播放的声音。', en: 'Stops what is playing.' },
      compose_open: { zh: '用系统默认播放器打开曲子或乐句的音频文件。', en: "Opens the audio file of a song or a phrase in the system's default player." },
    }),
    events: [
      {
        type: 'compose.take',
        description: { zh: '有人在「键盘」页签弹了一段并录了下来:音符数据、对齐到十六分音符的谱面(开了节拍器时)和这段演奏的音频。', en: 'Someone played and recorded a take on the Keyboard tab: the notes as data, as lines moved to sixteenths (when the metronome was on), and the audio of the playing.' },
        trigger: 'flush',
      },
    ],
  },
};
