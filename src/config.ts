import type { ConfigGroup } from 'cortico/core/types.ts';

/** config.json 的 worlds.compose 段。 */
export interface ComposeConfigSection {
  enabled: boolean;
  /** SoundFont 文件(.sf2 或 .sf3);空串时用包里 `assets/` 下的那一个。热改，下一次渲染生效。 */
  soundfontFile: string;
  /** 渲染出的音频与谱子存放的目录;空串时是部署数据目录下的 `compose/`。 */
  outputDir: string;
  /** false 时 `compose_play` 与 `compose_open` 都不出声、不开播放器，只回执文件位置。 */
  canPlay: boolean;
  /** `compose_play` 与面板「设备播放」用的输出设备名;空串是系统默认设备。 */
  playbackDevice: string;
  /** 设备播放的音量，0 到 1。 */
  playbackVolume: number;
  /**
   * 曲子怎么写下来。`sheet`:工具调用的字段(曲式、和弦、旋律各一个字段),伴奏按律动生成;
   * `score`:同一套记法写成一整段文本;`abc`:ABC 记谱，乐队用 `%%groove` 一行请进来;
   * `notes`:每一轨(含贝斯和鼓)都逐音写，没有伴奏生成，只为对照留着。重启生效。
   */
  toolset: 'sheet' | 'score' | 'abc' | 'notes';
  /** 渲染回执是否带量出来的事实(各段电平、音域、和弦外音、重复的小节)。 */
  reportsFacts: boolean;
}

export const COMPOSE_DEFAULTS: ComposeConfigSection = {
  enabled: false,
  soundfontFile: '',
  outputDir: '',
  canPlay: true,
  playbackDevice: '',
  playbackVolume: 1,
  toolset: 'sheet',
  reportsFacts: true,
};

export function composeConfigGroup(language: string): ConfigGroup {
  const zh = language.startsWith('zh');
  return {
    id: 'world:compose',
    owner: 'world:compose',
    schema: {
      type: 'object',
      title: zh ? '作曲' : 'Compose',
      properties: {
        'worlds.compose.soundfontFile': {
          type: 'string',
          title: zh ? '音色库文件' : 'SoundFont file',
          description: zh ? '.sf2 或 .sf3 的完整路径;留空使用扩展自带的音色库。' : 'Full path of an .sf2 or .sf3 file; empty uses the one shipped with the extension.',
          'x-hot': true,
        },
        'worlds.compose.outputDir': {
          type: 'string',
          title: zh ? '存放目录' : 'Output directory',
          description: zh ? '音频和谱子写到这里;留空写到数据目录下的 compose。' : 'Audio and sheets are written here; empty writes to compose/ in the data directory.',
          'x-hot': true,
        },
        'worlds.compose.canPlay': {
          type: 'boolean',
          title: zh ? '允许播放' : 'Allow playback',
          description: zh ? '关闭后 compose_play 与 compose_open 都只回执文件位置。' : 'When off, compose_play and compose_open only report the file location.',
          'x-hot': true,
        },
        'worlds.compose.playbackDevice': {
          type: 'string',
          title: zh ? '试听设备' : 'Playback device',
          description: zh ? 'compose_play 与面板的「设备播放」从这个输出设备出声。' : 'compose_play and the panel\'s device playback sound through this output device.',
          'x-options': 'compose-playback',
          'x-hot': true,
        },
        'worlds.compose.playbackVolume': {
          type: 'number',
          minimum: 0,
          maximum: 1,
          title: zh ? '试听音量' : 'Playback volume',
          description: zh ? '设备播放的音量，0 到 1。' : 'Volume of device playback, 0 to 1.',
          'x-hot': true,
        },
        'worlds.compose.reportsFacts': {
          type: 'boolean',
          title: zh ? '回执带测量结果' : 'Measured facts in receipts',
          description: zh ? '渲染回执列出各段电平、音域、和弦外音与重复的小节。' : 'Render receipts list section levels, ranges, notes outside their chord and repeated bars.',
          'x-hot': true,
        },
        'worlds.compose.toolset': {
          type: 'string',
          enum: ['sheet', 'score', 'abc', 'notes'],
          title: zh ? '记谱方式' : 'Notation',
          description: zh
            ? 'sheet:曲式、和弦、旋律各填一个字段;score:同一套记法写成一整段文本;abc:ABC 记谱;notes:每一轨逐音写，没有自动伴奏。前三种都能按段关掉或改写自动伴奏。'
            : 'sheet: form, chords and melodies as fields of the call; score: the same notation as one text; abc: ABC notation; notes: every track note by note, no generated band. In the first three the generated band can be switched off or rewritten per section.',
          'x-hot': false,
        },
      },
    },
  };
}
