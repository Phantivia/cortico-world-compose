/**
 * Keyboard panel of the Compose World: a piano played with the mouse or the computer's keys, a metronome, and a
 * record key. A finished take goes to the World, which delivers it to Coo as an event. Below it, the phrase
 * notebook: takes and the phrases Coo wrote, each one click from being heard, with the keys lighting up.
 *
 * The sound here is a plain synthesised tone, made in the browser so a key answers without delay; what Coo
 * receives is the same notes rendered through the World's SoundFont.
 */
import type { WebUiPanelContext } from 'cortico/web/shared/client-panel.ts';

interface PhraseRow { name: string; played: boolean; rendered: boolean; changedAtMs: number }
interface PhraseView { name: string; played: boolean; seconds: number; notes: Array<[number, number, number]>; lines: string[] }

const TEXT = {
  zh: {
    title: '键盘', record: '录音', stop: '停止并发送', discard: '丢弃', metronome: '节拍器', octaveDown: '低八度', octaveUp: '高八度', volume: '音量',
    focus: '点一下琴键，就能用电脑键盘弹', keys: '白键 Q W E R T Y U I O P [ ]　黑键 2 3 5 6 7 9 0 =　Z / X 换八度　空格 录音　Esc 丢弃',
    armedFree: '弹第一个音开始录', countIn: (n: number) => `预备 ${n}`, recording: (s: string, n: number) => `正在录 ${s} · ${n} 个音`,
    sending: '正在发给 Coo…', sent: (name: string, n: number) => `已发给 Coo:${name},${n} 个音`, kept: (name: string) => `已存为 ${name}(Coo 没在运行，没有发出)`,
    empty: '一个音都没弹，没有发送', discarded: '已丢弃', phrases: '乐句', none: '还没有乐句。录一段，或者让 Coo 写一句。', played: '键盘录的', written: 'Coo 写的',
    listen: '试听', pause: '停下', remove: '删除', confirm: '确认删除', noAudio: '没有音频', free: '自由速度', limit: (s: number) => `最长录 ${s} 秒，到时自动发送`,
  },
  en: {
    title: 'Keyboard', record: 'Record', stop: 'Stop and send', discard: 'Discard', metronome: 'Metronome', octaveDown: 'Octave down', octaveUp: 'Octave up', volume: 'Volume',
    focus: 'Click the keys to play them from the computer keyboard', keys: 'White keys Q W E R T Y U I O P [ ]  Black keys 2 3 5 6 7 9 0 =  Z / X octave  Space record  Esc discard',
    armedFree: 'Recording starts with your first note', countIn: (n: number) => `Count-in ${n}`, recording: (s: string, n: number) => `Recording ${s} · ${n} notes`,
    sending: 'Sending to Coo…', sent: (name: string, n: number) => `Sent to Coo: ${name}, ${n} notes`, kept: (name: string) => `Kept as ${name} (Coo is not running, nothing was sent)`,
    empty: 'No note was played; nothing sent', discarded: 'Discarded', phrases: 'Phrases', none: 'No phrases yet. Record one, or ask Coo to write one.', played: 'played here', written: 'written by Coo',
    listen: 'Listen', pause: 'Stop', remove: 'Delete', confirm: 'Confirm', noAudio: 'no audio', free: 'free time', limit: (s: number) => `A take is at most ${s} seconds and is sent when they run out`,
  },
};

/** Semitones above the base C for each physical key, by `KeyboardEvent.code` so layouts and input methods do not matter. */
// The letter row is the white keys and the digit row above it the black keys, laid out as on a piano.
const KEY_MAP: Record<string, number> = {
  KeyQ: 0, Digit2: 1, KeyW: 2, Digit3: 3, KeyE: 4, KeyR: 5, Digit5: 6, KeyT: 7, Digit6: 8, KeyY: 9, Digit7: 10, KeyU: 11,
  KeyI: 12, Digit9: 13, KeyO: 14, Digit0: 15, KeyP: 16, BracketLeft: 17, Equal: 18, BracketRight: 19,
};
const KEY_LABEL: Record<number, string> = {
  0: 'Q', 1: '2', 2: 'W', 3: '3', 4: 'E', 5: 'R', 6: '5', 7: 'T', 8: '6', 9: 'Y', 10: '7', 11: 'U',
  12: 'I', 13: '9', 14: 'O', 15: '0', 16: 'P', 17: '[', 18: '=', 19: ']',
};
/** Semitones the mapped keys span above the base C. */
const SPAN = 19;
const LOW = 36, HIGH = 96;               // C2 to C7 on screen
const BLACK = new Set([1, 3, 6, 8, 10]);
const WHITE_W = 30;
// A take lists every note in the event Coo reads; a minute of playing is a few hundred lines of it.
const MAX_TAKE_SECONDS = 60;
const METERS: Record<string, number> = { '4/4': 4, '3/4': 3, '6/8': 3 };

type Recording =
  | { state: 'idle' }
  | { state: 'armed' }
  | { state: 'count'; startsAt: number }
  | { state: 'on'; startedAt: number };

export function mountKeyboard(ctx: WebUiPanelContext): void {
  const { h } = ctx.ui;
  const t = ctx.language.startsWith('zh') ? TEXT.zh : TEXT.en;
  const sheet = ctx.ui.sheet({ title: t.title });
  ctx.root.append(sheet.el);

  // ---- controls
  const bar = h('div', 'compose-kb-bar');
  const recordButton = h('button', 'btn compose-kb-record');
  recordButton.type = 'button';
  const discardButton = h('button', 'btn', t.discard);
  discardButton.type = 'button';
  discardButton.hidden = true;
  const clickBox = h('input', null);
  clickBox.type = 'checkbox';
  clickBox.checked = ctx.memo.get<boolean>('click', false);
  const clickLabel = h('label', 'compose-kb-check');
  clickLabel.append(clickBox, document.createTextNode(t.metronome));
  const tempoField = h('input', 'field compose-kb-tempo');
  tempoField.type = 'number'; tempoField.min = '40'; tempoField.max = '240'; tempoField.step = '1';
  tempoField.value = String(ctx.memo.get<number>('tempo', 100));
  const meterField = h('select', 'field');
  for (const m of Object.keys(METERS)) { const o = h('option', null, m); o.value = m; meterField.append(o); }
  meterField.value = ctx.memo.get<string>('meter', '4/4');
  const down = h('button', 'btn', '−'); down.type = 'button'; down.title = t.octaveDown;
  const range = h('span', 'compose-kb-range');
  const up = h('button', 'btn', '+'); up.type = 'button'; up.title = t.octaveUp;
  const volumeField = h('input', 'compose-kb-volume');
  volumeField.type = 'range'; volumeField.min = '0'; volumeField.max = '1'; volumeField.step = '0.05'; volumeField.title = t.volume;
  volumeField.value = String(ctx.memo.get<number>('volume', 0.6));
  bar.append(recordButton, discardButton, clickLabel, tempoField, meterField, down, range, up, volumeField);
  const status = h('div', 'compose-status');
  const tape = h('canvas', 'compose-kb-tape');
  const stage = h('div', 'compose-kb-stage');
  stage.tabIndex = 0;
  const strip = h('div', 'compose-kb-keys');
  const hint = h('div', 'compose-kb-hint', t.focus);
  stage.append(strip, hint);
  const legend = h('div', 'compose-kb-legend', t.keys);
  const listTitle = h('h4', 'compose-kb-list-title', t.phrases);
  const list = h('div', 'compose-kb-list');
  const audio = h('audio', null);
  audio.hidden = true;
  sheet.body.append(bar, status, tape, stage, legend, listTitle, list, audio);

  const say = (text: string) => { status.textContent = text; };
  const fail = (e: unknown) => say(e instanceof Error ? e.message : String(e));

  // ---- the piano
  const keyEls = new Map<number, HTMLElement>();
  let whites = 0;
  for (let p = LOW; p <= HIGH; p++) {
    const black = BLACK.has(p % 12);
    const key = h('div', black ? 'compose-kb-key compose-kb-black' : 'compose-kb-key compose-kb-white');
    key.dataset.pitch = String(p);
    if (black) key.style.left = `${whites * WHITE_W - 9}px`;
    else { key.style.left = `${whites * WHITE_W}px`; whites++; }
    key.append(h('b', null), h('span', null, p % 12 === 0 ? `C${p / 12 - 1}` : ''));
    keyEls.set(p, key);
    strip.append(key);
  }
  strip.style.width = `${whites * WHITE_W}px`;

  let base = ctx.memo.get<number>('base', 60);
  const showBase = () => {
    for (const [p, key] of keyEls) {
      const offset = p - base;
      key.classList.toggle('compose-kb-mapped', offset >= 0 && offset <= SPAN);
      (key.firstChild as HTMLElement).textContent = KEY_LABEL[offset] ?? '';
    }
    range.textContent = `C${base / 12 - 1}`;
    const first = keyEls.get(base);
    if (first) stage.scrollLeft = Math.max(0, first.offsetLeft - (stage.clientWidth - 12 * WHITE_W) / 2);
  };
  const shift = (by: number) => {
    const next = base + by;
    if (next < LOW || next + SPAN > HIGH) return;
    releaseAll();
    base = next;
    ctx.memo.set('base', base);
    showBase();
  };

  // ---- sound
  let ac: AudioContext | null = null;
  let master: GainNode | null = null;
  const voices = new Map<number, { gain: GainNode; stop: () => void }>();
  const sound = (): { ac: AudioContext; master: GainNode } => {
    if (!ac || !master) {
      ac = new AudioContext({ latencyHint: 'interactive' });
      master = ac.createGain();
      master.gain.value = Number(volumeField.value);
      master.connect(ac.destination);
      const made = ac;
      ctx.own({ dispose: () => { void made.close(); } });
    }
    if (ac.state === 'suspended') void ac.resume();
    return { ac, master };
  };
  const toneOn = (pitch: number) => {
    const { ac: a, master: m } = sound();
    const hz = 440 * 2 ** ((pitch - 69) / 12);
    const gain = a.createGain(), filter = a.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = Math.min(9000, hz * 6);
    const body = a.createOscillator(), air = a.createOscillator(), airGain = a.createGain();
    body.type = 'triangle'; body.frequency.value = hz;
    air.type = 'sine'; air.frequency.value = hz * 2; airGain.gain.value = 0.25;
    body.connect(gain); air.connect(airGain).connect(gain);
    gain.connect(filter).connect(m);
    const now = a.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.32, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.11, now + 0.6);
    body.start(now); air.start(now);
    voices.get(pitch)?.stop();
    voices.set(pitch, {
      gain,
      stop: () => {
        const at = a.currentTime;
        gain.gain.cancelScheduledValues(at);
        gain.gain.setValueAtTime(gain.gain.value, at);
        gain.gain.exponentialRampToValueAtTime(0.0008, at + 0.22);
        body.stop(at + 0.25); air.stop(at + 0.25);
      },
    });
  };
  const toneOff = (pitch: number) => { voices.get(pitch)?.stop(); voices.delete(pitch); };
  const click = (at: number, strong: boolean) => {
    const { ac: a, master: m } = sound();
    const osc = a.createOscillator(), gain = a.createGain();
    osc.frequency.value = strong ? 1568 : 1046;
    gain.gain.setValueAtTime(strong ? 0.35 : 0.2, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.05);
    osc.connect(gain).connect(m);
    osc.start(at); osc.stop(at + 0.06);
  };

  // ---- playing and recording
  const held = new Map<number, number>();                     // pitch -> performance time of its note-on
  let taken: Array<[number, number, number]> = [];            // finished notes of the take: at, length, pitch (seconds)
  let recording: Recording = { state: 'idle' };
  let shown: { notes: Array<[number, number, number]>; seconds: number } | null = null;   // what the tape draws when not recording
  const tempo = () => Math.min(240, Math.max(40, Number(tempoField.value) || 100));
  const beat = () => 60 / tempo();
  const clicking = () => clickBox.checked;
  const seconds = (ms: number) => ms / 1000;

  const noteOn = (pitch: number) => {
    if (held.has(pitch) || pitch < LOW || pitch > HIGH) return;
    const now = performance.now();
    held.set(pitch, now);
    keyEls.get(pitch)?.classList.add('compose-kb-down');
    toneOn(pitch);
    if (recording.state === 'armed' && !clicking()) { recording = { state: 'on', startedAt: now }; taken = []; shown = null; paint(); }
  };
  const noteOff = (pitch: number) => {
    const since = held.get(pitch);
    if (since === undefined) return;
    held.delete(pitch);
    keyEls.get(pitch)?.classList.remove('compose-kb-down');
    toneOff(pitch);
    keep(pitch, since, performance.now());
  };
  /** A note belongs to the take when it began after the start, or within half a sixteenth before the first bar line. */
  const keep = (pitch: number, since: number, until: number) => {
    const origin = recording.state === 'on' ? recording.startedAt : recording.state === 'count' ? recording.startsAt : null;
    if (origin === null) return;
    const early = clicking() ? beat() / 8 : 0;
    const at = seconds(since - origin);
    if (at < -early) return;
    taken.push([Math.max(0, at), Math.max(0.03, seconds(until - Math.max(since, origin))), pitch]);
  };
  const releaseAll = () => { for (const pitch of [...held.keys()]) noteOff(pitch); };

  let clickTimer: { dispose(): void } | null = null;
  const stopClick = () => { clickTimer?.dispose(); clickTimer = null; };
  /** Clicks from `fromAudio` on, scheduled a little ahead of the audio clock; beat 0 is strong. */
  const startClick = (fromAudio: number) => {
    stopClick();
    const perBar = METERS[meterField.value] ?? 4;
    let next = 0;
    const schedule = () => {
      const a = sound().ac;
      while (fromAudio + next * beat() < a.currentTime + 0.15) { click(Math.max(a.currentTime, fromAudio + next * beat()), next % perBar === 0); next++; }
    };
    schedule();
    clickTimer = ctx.interval(schedule, 40);
  };

  const paint = () => {
    const on = recording.state !== 'idle';
    recordButton.classList.toggle('compose-kb-live', on);
    recordButton.textContent = on ? `■ ${t.stop}` : `● ${t.record}`;
    discardButton.hidden = !on;
    for (const field of [clickBox, tempoField, meterField]) field.disabled = on;
  };

  const arm = () => {
    taken = [];
    shown = null;
    if (clicking()) {
      const a = sound().ac;
      const perBar = METERS[meterField.value] ?? 4;
      const startAudio = a.currentTime + 0.1;
      startClick(startAudio);
      recording = { state: 'count', startsAt: performance.now() + (0.1 + perBar * beat()) * 1000 };
    } else {
      recording = { state: 'armed' };
      say(t.armedFree);
    }
    paint();
    stage.focus();
  };
  const finish = async (send: boolean) => {
    const was = recording;
    releaseAll();
    recording = { state: 'idle' };
    stopClick();
    paint();
    if (!send) { taken = []; say(t.discarded); return; }
    if (was.state !== 'on' && was.state !== 'count' || taken.length === 0) { taken = []; say(t.empty); return; }
    const notes = taken.sort((a, b) => a[0] - b[0]);
    taken = [];
    shown = { notes: notes.map(([at, len, pitch]) => [at, at + len, pitch]), seconds: Math.max(...notes.map((n) => n[0] + n[1])) };
    say(t.sending);
    const answer = await ctx.invoke<{ name: string; delivered: boolean }>('take', [{ notes, tempo: clicking() ? tempo() : null, meter: meterField.value }]);
    say(answer.delivered ? t.sent(answer.name, notes.length) : t.kept(answer.name));
    await refresh();
  };
  const toggle = () => { if (recording.state === 'idle') arm(); else void finish(true).catch(fail); };

  recordButton.addEventListener('click', toggle, { signal: ctx.signal });
  discardButton.addEventListener('click', () => { void finish(false); }, { signal: ctx.signal });
  down.addEventListener('click', () => shift(-12), { signal: ctx.signal });
  up.addEventListener('click', () => shift(12), { signal: ctx.signal });
  clickBox.addEventListener('change', () => ctx.memo.set('click', clickBox.checked), { signal: ctx.signal });
  tempoField.addEventListener('change', () => { tempoField.value = String(tempo()); ctx.memo.set('tempo', tempo()); }, { signal: ctx.signal });
  meterField.addEventListener('change', () => ctx.memo.set('meter', meterField.value), { signal: ctx.signal });
  volumeField.addEventListener('input', () => {
    const v = Number(volumeField.value);
    ctx.memo.set('volume', v);
    if (master) master.gain.value = v;
    audio.volume = v;
  }, { signal: ctx.signal });
  audio.volume = Number(volumeField.value);

  stage.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space' || e.code === 'Escape' || e.code === 'KeyZ' || e.code === 'KeyX' || e.code in KEY_MAP) e.preventDefault();
    if (e.repeat) return;
    if (e.code === 'Space') toggle();
    else if (e.code === 'Escape') { if (recording.state !== 'idle') void finish(false); }
    else if (e.code === 'KeyZ') shift(-12);
    else if (e.code === 'KeyX') shift(12);
    else if (e.code in KEY_MAP) noteOn(base + KEY_MAP[e.code]);
  }, { signal: ctx.signal });
  stage.addEventListener('keyup', (e) => { if (e.code in KEY_MAP) noteOff(base + KEY_MAP[e.code]); }, { signal: ctx.signal });
  stage.addEventListener('blur', releaseAll, { signal: ctx.signal });

  // the mouse: press a key, slide across the keys, let go
  let pointerPitch: number | null = null;
  const pitchAt = (e: PointerEvent): number | null => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.compose-kb-key') ?? (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('.compose-kb-key');
    return el && strip.contains(el) ? Number(el.dataset.pitch) : null;
  };
  const pointerTo = (pitch: number | null) => {
    if (pitch === pointerPitch) return;
    if (pointerPitch !== null) noteOff(pointerPitch);
    pointerPitch = pitch;
    if (pitch !== null) noteOn(pitch);
  };
  strip.addEventListener('pointerdown', (e) => { e.preventDefault(); stage.focus(); strip.setPointerCapture(e.pointerId); pointerTo(pitchAt(e)); }, { signal: ctx.signal });
  strip.addEventListener('pointermove', (e) => {
    if (pointerPitch === null && !strip.hasPointerCapture(e.pointerId)) return;
    const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('.compose-kb-key');
    pointerTo(el && strip.contains(el) ? Number(el.dataset.pitch) : null);
  }, { signal: ctx.signal });
  for (const type of ['pointerup', 'pointercancel'] as const) strip.addEventListener(type, () => pointerTo(null), { signal: ctx.signal });

  // ---- the tape: the take being recorded, or the phrase being heard
  const colour = (name: string, fallback: string) => getComputedStyle(ctx.root).getPropertyValue(name).trim() || fallback;
  let lit = new Set<number>();
  ctx.frame(() => {
    const now = performance.now();
    if (recording.state === 'count') {
      const left = seconds(recording.startsAt - now);
      if (left <= 0) recording = { state: 'on', startedAt: recording.startsAt };
      else say(t.countIn(Math.ceil(left / beat())));
    }
    let notes: Array<[number, number, number]> = [], span = 8, headAt: number | null = null;
    if (recording.state === 'on') {
      const elapsed = seconds(now - recording.startedAt);
      if (elapsed >= MAX_TAKE_SECONDS) { void finish(true).catch(fail); return; }
      say(`${t.recording(`${Math.floor(elapsed / 60)}:${String(Math.floor(elapsed % 60)).padStart(2, '0')}`, taken.length + held.size)}${elapsed > MAX_TAKE_SECONDS - 10 ? ` · ${t.limit(MAX_TAKE_SECONDS)}` : ''}`);
      const origin = recording.startedAt;
      notes = [...taken.map(([at, len, pitch]) => [at, at + len, pitch] as [number, number, number]),
        ...[...held].map(([pitch, since]) => [Math.max(0, seconds(since - origin)), elapsed, pitch] as [number, number, number])];
      span = Math.max(8, elapsed + 1);
      headAt = elapsed;
    } else if (shown) {
      notes = shown.notes;
      span = Math.max(4, shown.seconds);
      if (!audio.paused) headAt = audio.currentTime;
    }
    // keys light up under a phrase that is being heard
    const sounding = new Set<number>();
    if (recording.state === 'idle' && shown && !audio.paused) for (const [from, to, pitch] of shown.notes) if (audio.currentTime >= from && audio.currentTime < to) sounding.add(pitch);
    for (const pitch of lit) if (!sounding.has(pitch)) keyEls.get(pitch)?.classList.remove('compose-kb-lit');
    for (const pitch of sounding) if (!lit.has(pitch)) keyEls.get(pitch)?.classList.add('compose-kb-lit');
    lit = sounding;

    const g = tape.getContext('2d');
    if (!g) return;
    const width = tape.clientWidth, height = tape.clientHeight, ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (tape.width !== Math.round(width * ratio)) { tape.width = Math.round(width * ratio); tape.height = Math.round(height * ratio); }
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    g.clearRect(0, 0, width, height);
    if (notes.length === 0) return;
    const lo = Math.min(...notes.map((n) => n[2])) - 2, hi = Math.max(...notes.map((n) => n[2])) + 2;
    const row = Math.min(8, height / (hi - lo + 1));
    g.fillStyle = colour('--accent', '#d2691e');
    for (const [from, to, pitch] of notes) g.fillRect((from / span) * width, height - (pitch - lo + 1) * row, Math.max(2, ((to - from) / span) * width - 1), Math.max(2, row - 1));
    if (headAt !== null) { g.fillStyle = colour('--danger', '#c0392b'); g.fillRect((headAt / span) * width, 0, 2, height); }
  });

  // ---- the notebook
  let rows: PhraseRow[] = [];
  let hearing = '';
  let audioUrl: string | null = null;
  const release = () => {
    audio.pause();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = null;
    hearing = '';
  };
  ctx.own({ dispose: () => { release(); stopClick(); } });
  audio.addEventListener('ended', () => { hearing = ''; drawList(); }, { signal: ctx.signal });

  const listen = async (name: string) => {
    if (hearing === name) { release(); drawList(); return; }
    release();
    const [view, blob] = await Promise.all([ctx.invoke<PhraseView>('phrase', [name]), ctx.invokeBinary('audio', [name])]);
    shown = { notes: view.notes, seconds: view.seconds };
    audioUrl = URL.createObjectURL(blob);
    audio.src = audioUrl;
    hearing = name;
    drawList();
    await audio.play();
  };
  const drawList = () => {
    if (rows.length === 0) { list.replaceChildren(h('div', 'compose-kb-none', t.none)); return; }
    list.replaceChildren(...rows.map((row) => {
      const line = h('div', 'compose-kb-row');
      const name = h('span', 'compose-kb-name', row.name);
      const kind = h('span', 'compose-kb-kind', row.played ? t.played : t.written);
      const hear = h('button', 'btn', !row.rendered ? t.noAudio : hearing === row.name ? t.pause : t.listen);
      hear.type = 'button';
      hear.disabled = !row.rendered;
      hear.addEventListener('click', () => { void listen(row.name).catch(fail); }, { signal: ctx.signal });
      const remove = h('button', 'btn', t.remove);
      remove.type = 'button';
      remove.addEventListener('click', () => {
        if (remove.textContent !== t.confirm) { remove.textContent = t.confirm; return; }
        if (hearing === row.name) release();
        void ctx.invoke('remove', [row.name]).then(refresh).catch(fail);
      }, { signal: ctx.signal });
      line.append(name, kind, hear, remove);
      return line;
    }));
  };
  async function refresh(): Promise<void> {
    const answer = await ctx.invoke<{ phrases: PhraseRow[] }>('phrases', []);
    const before = rows.map((r) => `${r.name}:${r.changedAtMs}`).join('|');
    rows = answer.phrases;
    if (before !== rows.map((r) => `${r.name}:${r.changedAtMs}`).join('|') || list.childElementCount === 0) drawList();
  }

  paint();
  showBase();
  stage.focus();
  ctx.timeout(showBase, 60);   // once the panel has a width, bring the mapped keys to the middle
  void refresh().catch(fail);
  ctx.interval(() => { void refresh().catch(() => undefined); }, 4000);
}
