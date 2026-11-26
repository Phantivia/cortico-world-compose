# Changelog

## 0.4.0

- 128 个 General MIDI program 都有名字、别名和音域；以前只有 50 个，其余只能写 `gm <n>` 盲猜。
- 新增 `compose_instruments`：不带参数列分类和数量，可按分类、名字/别名片段或 program 0–127 过滤；每行给名字、program、MIDI 音域和别名。
- `notes`、`compose_phrase` 的工具说明只保留 8 个常用音色，其余用 `compose_instruments` 按需查，避免每轮请求把整张表塞进上下文；`compose_render`、`score`、`abc` 同样不再列全表。
- 未知乐器的错误不再列全表，只提示用 `compose_instruments` 查或用 `gm 0–127`。
- ABC 的 `%%MIDI program` 超出 0–127 时报错，不再原样交给合成器。
- `distortion guitar` 现在是 GM program 30（Distortion Guitar）；program 29 仍叫 `overdrive guitar`，保留 `rock guitar` 别名。

## 0.3.1

- 「曲子」页签多一个「打开产物库」按钮，在文件管理器里打开 `outputDir`(曲子的 WAV 和谱子、`phrases/` 里的乐句都在里面),方便拿去别处用。

## 0.3.0

- 新增乐句：`compose_phrase` 写下一两句并立刻渲染，存进乐句本(`outputDir` 下的 `phrases/`);`compose_play`、`compose_read`、`compose_open` 对乐句名同样有效;
  曲子里写 `@乐句名` 就把它当动机用，渲染时把那一行抄进曲子自己的 `motifs`。
- World 页多一个「键盘」页签：鼠标或电脑键盘弹，节拍器可开可关，按录音键录一段，停下时作为 `compose.take` 事件发给 Coo,
  带音符数据、(开了节拍器时)对齐到十六分音符的谱面和这段演奏的音频;录的这段也存成乐句。乐句本里的每一条都能在页签里试听，琴键跟着亮。
- 环境提示词开头改成两种尺寸(乐句和整首),说明什么时候一句就够。

## 0.2.0

- 自动伴奏变成可以按段解除的默认值:`band` 逐个角色(和弦、贝斯、鼓、过门)关掉或换乐器;行里可以写力度记号、叠音(`C3+G3`)、分组(`[..]`);
  同一件乐器可以多行(`piano:left`);各段可以有自己的拍号、速度和调，拍号放开到 5/4、6/8、7/8 这类;乐器可以用 GM 音色号，鼓可以用 GM 键号。
  不用这些写法的谱子编配结果与 0.1.0 相同。
- 新增两种记谱方式(配置 `toolset`):`score` 把同一套记法写成一整段文本，`abc` 用 ABC 记谱。
- 回执的段落一行写明这一段乐队实际出了哪几个角色。
- 工具说明里的示例换成不带旋律的格式示意(原来那句示例会被模型原样写进曲子)。
- 面板按各段的拍号和速度画小节线、走播放线。

## 0.1.0

- 第一版:`compose_render`、`compose_revise`、`compose_read`、`compose_play`;11 种律动的自动伴奏;渲染回执带测量结果。
- `compose_play` 在配置里选定的输出设备上播放，`compose_stop` 停止，`compose_open` 用系统播放器打开文件。
- World 页的「曲子」面板：钢琴卷帘、段落与和弦、实测电平、和弦外音标记、浏览器试听与设备播放。
