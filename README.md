# cortico-world-compose

Owner: `src/definition.ts`、`src/world.ts`

作曲 World:bot 写一份谱子(曲式、和弦、旋律),World 按每段的律动配上和弦、贝斯和鼓，用 SoundFont 渲染成 WAV,回执给出文件位置和量出来的事实。
目标是让小模型也能写出结构完整的曲子：模型只决定音乐上要拿主意的事，其余由 World 做。

## 工具

| 工具 | 作用 |
|---|---|
| `compose_render` | 渲染一整份谱子。谱子有问题时不渲染，回执逐条列出问题，谱子留作草稿 |
| `compose_revise` | 只给出要改的部分(某几段、动机、速度、段落顺序),合进已有的谱子或草稿后重新渲染 |
| `compose_read` | 不带曲名列出写过的曲子;带曲名取回最近一次的谱子 |
| `compose_play` | 在配置里选定的输出设备上播放(World 自己出声);开始播放就返回，再播一首会先停掉上一首 |
| `compose_stop` | 停止 `compose_play` 正在播的曲子 |
| `compose_open` | 用系统默认播放器打开音频文件，人可以自己暂停、拖动、重听 |

World 不推事件。文件写在 `outputDir`:`<曲名>.wav`(同名覆盖)、`<曲名>.json`(当前谱子)、`<曲名>.v<n>.json`(每次渲染成功的谱子)、`<曲名>.levels.json`(各段实测电平，面板用)。

## 谱子

```jsonc
{
  "title": "雨窗作业", "tempo": 76, "key": "F major", "lead": "electric piano",
  "motifs": { "drip": "A4 - - . C5 - A4 . | G4 - - . F4 - . ." },
  "form": ["intro", "A", "B", "A"],
  "sections": [
    { "name": "A", "groove": "lofi", "energy": 2,
      "chords": "Fmaj7 | Bbmaj7 | Am7 | Dm7",
      "melody": "@drip | A4 - - . C5 - D5 . | C5 - - . A4 - . .",
      "parts": { "kalimba": ". . . . . . . D6 | . . . A5 . . . . | . . . . . . E5 . | . . . . . . . ." },
      "stops": [4] }
  ]
}
```

- **一行**是用 `|` 隔开的小节;一小节是等长的格子，4 格是四分音符，8 格八分，16 格十六分(3、6、12 格是三连音),同一行里各小节格数可以不同。
  格子里写音高(`F#5`,C4 是中央 C)、`-`(延长前一个音，可跨小节)或 `.`(休止);`%` 重复上一小节。`drums` 这一行写鼓的字母。
- **和弦**一小节 1 到 8 个，平分这一小节;`-` 延长，`%` 重复，`N.C.` 让乐队休息。认得的写法见 `src/theory.ts` 的 `parseChord`。
- **动机**:`motifs` 里起名，任何一行里写 `@名字` 就是它,`@名字+1`、`@名字-2` 按调内音级上下移。
- **段落**:`like` 抄一段再改;`form` 给演奏顺序，段名可以重复;`stops` 里的小节乐队只在第一拍给一下，然后停。
- **律动**(`src/grooves.ts`):pop、rock、ballad、bossa、samba、swing、waltz、funk、lofi、dance、ambient、none。`energy` 1 到 5 决定用稀疏、标准还是密集的型，
  哪些鼓的层进来，以及整体力度。段落末尾自动加一小串过门，能量 4 以上的段落开头加一下吊镲。
- **乐器**:50 种通用 MIDI 音色，名字见 `src/instruments.ts`。

## 回执里的事实

长度、每段的实测电平、各声部音域和超出乐器音域的音数、主旋律有多少种不同的小节节奏、级进与跳进各多少、哪些小节一音不差地重复、
哪些长音或落在第一拍的音不在和弦里且比某个和弦音高半音。回执只陈述这些，不评好坏;怎么读它们写在环境提示词里。

## 环境提示词

`src/ENV_PROMPT.md`:先定动机、段落和高低点;旋律按乐句写(陈述、变化重复、打破);各段在律动、能量、配器上拉开;
长音落在和弦里;分遍写，先渲染一个短的初稿，再对着回执改。

## 配置(`worlds.compose`)

| 键 | 默认 | 含义 |
|---|---|---|
| `soundfontFile` | 空 | .sf2 或 .sf3 的路径;空时用包里 `assets/` 下的那一个 |
| `outputDir` | 空 | 空时是部署数据目录下的 `compose/` |
| `canPlay` | true | 关掉后 `compose_play` 与 `compose_open` 都只回执文件位置 |
| `playbackDevice` | 空 | `compose_play` 与面板「设备播放」用的输出设备名，下拉框现列本机设备;空是系统默认设备 |
| `playbackVolume` | 1 | 设备播放的音量，0 到 1 |
| `reportsFacts` | true | 回执带不带测量结果 |
| `toolset` | `sheet` | `notes` 是没有自动伴奏、每一轨逐音写的对照形状，只为台架留着;重启生效 |

## 面板

World 页多一个「曲子」页签(`src/webui/client.ts`,服务端数据在 `world.ts` 的 `invokePanel` 和 `src/view.ts`):

- 选一首曲子，画出钢琴卷帘：各声部的音符(主旋律用主题强调色),段落底色与段名、律动、能量，每小节的和弦，鼓的一行，底下是各段实测电平的条。
- 回执里报的和弦外音在卷帘上描红框。下方原样列出回执里的那几行事实。
- 「在浏览器试听」把音频取到页面里播，卷帘上有播放线，点卷帘跳到那一拍;「设备播放」「停止」「用播放器打开」与三个播放工具走同一套代码。
- 读不出来的草稿显示它的问题清单。

设备播放用 [audify](https://github.com/almoghamdani/audify)(RtAudio)。Windows 上固定走 WASAPI:装了厂商 ASIO 驱动的机器上 RtAudio 自选后端会挑 ASIO,设备表不是系统那张。

## 音色库

默认音色库是 MuseScore_General.sf3(MIT,39.9 MB,Fluid R3 的改进版，许可全文随它一起下到 `assets/`)。它不进 git:

```bash
node scripts/fetch-soundfont.mjs
```

下载到 `assets/`,发布的包带上它(`prepack` 会先跑这个脚本)。别的 SoundFont 用 `soundfontFile` 指过去。
合成用 [spessasynth_core](https://github.com/spessasus/spessasynth_core)(Apache-2.0,纯 JavaScript),一分钟的曲子渲染约 1 秒。

## 开发

```bash
corepack pnpm install
pnpm build                  # 面板:src/webui → dist/webui.js、dist/webui.css
pnpm typecheck && pnpm test
```

在 Cortico 检出的根下:`pnpm describe:extension <本目录>`(工具或提示词改了之后)、`pnpm check:extension <本目录>`。

| 文件 | 内容 |
|---|---|
| `src/theory.ts` | 音名、调、和弦符号解析、伴奏配置音 |
| `src/sheet.ts` | 把工具参数读成 `Song`,收集全部问题 |
| `src/grooves.ts` | 各律动的伴奏型 |
| `src/arrange.ts` | 生成伴奏、过门、停顿，加几毫秒的随机抖动(种子取自曲名，重渲结果不变) |
| `src/synth.ts` | SoundFont 渲染、响度处理、WAV |
| `src/facts.ts` | 回执里的测量 |
| `src/player.ts` | 输出设备列表与设备播放 |
| `src/view.ts`、`src/webui/` | 面板的数据与浏览器端 |

## 台架(`bench/`)

用一份 Coopanion 检出起无头的 Coo(全新数据目录、默认 Persona、不开桌宠窗口、统计关),把本包 link 进去，经控制台通道发一句请求，
等它停下来。模型是 Coopanion 默认的 DeepSeek 端点(`deepseek-flash`,思考开);key 文件复制进这一轮的数据目录，不打印。

```bash
npx tsx bench/run.ts <变体> <题目> [序号]     # 变体与题目见 bench/matrix.ts;序号决定端口，并行时各不相同
bash bench/all.sh                              # 整张表，三个并行
npx tsx bench/score.ts                         # 打分，写 bench/runs/scores.json
node bench/show.cjs <轮名>                     # 这一轮的每次工具调用
node bench/pack.cjs <目录>                     # 每轮最后的成曲转成 MP3 放到一处
npx tsx bench/serve.ts [端口]                  # 只起 WebUI 看面板:用几轮台架的谱子重渲出曲子，不发请求、不调模型，音量 0
```

需要:`bench/local.json`(不进 git,写法见 `bench/local.ts`:一份 `pnpm install` 与 `pnpm run build:cortico` 做过的 Coopanion 检出、一个带 `DEEPSEEK_API_KEY` 的 .env 文件;2026-11-15 用的是 Coopanion v0.2.21)、
`bench/extensions`(在里面 `corepack pnpm add link:../..`)、PATH 上的 ffmpeg(只有 `pack.cjs` 用)。环境变量 `MODEL`、`MAXTOK`、`TRIAL`、`LIMIT_MS`、`IDLE_MS` 见 `run.ts`。

### 2026-11-15 的结果(deepseek-flash)

变体:

| 变体 | 工具 | 回执 | 环境提示词 |
|---|---|---|---|
| notes | 每一轨逐音写，没有伴奏生成 | 只有文件 | 一句话 |
| sheet | 谱子，伴奏自动生成 | 只有文件 | 一句话 |
| facts | 同上 | 带测量结果 | 一句话 |
| guided | 同上 | 带测量结果 | 作曲引导 |
| staged | 同上，加 `compose_revise` | 带测量结果 | 作曲引导加「分遍写」(现在的默认) |

题目三个:bossa nova(航站楼、未来感、领航员)、下雨天写作业的 lofi、三十秒生日小曲。每格一轮,bossa 另有重复。

| | 出曲 | 段落数 | 用到的律动 | 各段电平差 | 主旋律跳进占比 | 用动机 | 用停顿 | 每首花费 |
|---|---|---|---|---|---|---|---|---|
| notes | 2/3 | 1 | 1 | 1–2 dB | 0.58–0.89 | 0 | 0 | 0.3–0.6 美分 |
| sheet | 3/3 | 3–5 | 1 | 3.7–6.9 dB | 0.45–0.86 | 0 | 0 | 0.2–0.5 美分 |
| facts | 3/3 | 2–6 | 1 | 2.4–8.1 dB | 0.59–0.76 | 0 | 0 | 0.3–0.8 美分 |
| guided | 2/4 | 3–4 | 1–3 | 4.7–5.1 dB | 0.37–0.52 | 2/2 | 2/2 | 0.6 美分 |
| staged | 4/5 | 4–8 | 1–3 | 6.2–8.5 dB | 0.41–0.63 | 4/4 | 4/4 | 0.7–1.6 美分 |
| staged,输出上限 24000 | 3/3 | 5–7 | 1–2 | 5.3–10.3 dB | 0.44–0.62 | 2/3 | 3/3 | 1.0–1.4 美分 |

读法:

- **逐音写(notes)最差**:没有段落，电平一条直线,lofi 那首 72% 的小节是重复的。贝斯和鼓它确实会写，但是整段复制粘贴。
- **伴奏自动生成之后**，模型把同样的输出量花在了曲式上：分出 3 到 6 段，每段给不同的能量。
- **只加测量结果(facts)没有改变行为**:三轮都是渲染一次就交差，没有对着回执改。
- **作曲引导改变的是旋律和结构**:开始定义动机、让第二件乐器在句尾对答、用停顿，跳进占比从六到八成降到四到五成。
- **`compose_revise` 加「分遍写」之后才出现迭代**:四首成曲里三首修改过，最多连改七次，曲子也更长(44 到 56 小节)。
- **交白卷的四轮(bossa 题)都是同一个原因**:模型在思考里逐小节打草稿，写到两万多字时撞上端点 8192 的输出上限，这一轮没有任何工具调用就结束了。
  把上限提到 24000 后三轮全部出曲。这个上限是 Coopanion 端点的默认值，不归这个 World 管。
- 表里的数只说明结构，好不好听没有量;这 21 轮用的音色库是 Fluid R3 GM。
