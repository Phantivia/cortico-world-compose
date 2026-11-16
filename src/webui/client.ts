/**
 * Songs panel of the Compose World: pick a song, see its notes on a piano roll with sections, chords, measured
 * levels and the notes the receipt flags, and play it in the browser or on the configured output device.
 * Everything comes through `ctx.invoke`; the only framework import is the panel contract's types.
 */
import type { WebUiClientBundle, WebUiPanelContext } from 'cortico/web/shared/client-panel.ts';
import type { SongView } from '../view.ts';
import './style.css';

interface SongRow { title: string; rendered: boolean; versions: number; changedAtMs: number }
interface SongList { songs: SongRow[]; playing: { title: string; device: string } | null; device: string }

const TEXT = {
  zh: {
    none: '还没有曲子。让 bot 写一首之后这里会列出来。', draft: '草稿，未渲染', versions: (n: number) => `第 ${n} 版`,
    listen: '在浏览器试听', device: '设备播放', stop: '停止', open: '用播放器打开', loading: '载入音频…',
    problems: '这份草稿读不出来：', onDevice: (d: string) => `试听设备:${d || '系统默认'}`, lead: '主旋律', drums: '鼓', outside: '和弦外音',

  },
  en: {
    none: 'No songs yet. They are listed here once the bot has written one.', draft: 'draft, not rendered', versions: (n: number) => `version ${n}`,
    listen: 'Listen in browser', device: 'Play on device', stop: 'Stop', open: 'Open in player', loading: 'Loading audio…',
    problems: 'This draft does not read:', onDevice: (d: string) => `Playback device: ${d || 'system default'}`, lead: 'lead', drums: 'drums', outside: 'outside its chord',

  },
};
const PALETTE = ['#2f9e97', '#c58a2b', '#8e6fd6', '#4f86d6', '#c9627a', '#6f9a3a'];
const GUTTER = 40, HEAD = 38, DRUM_LANE = 26, LEVEL_LANE = 44, ROW = 6;

function mount(ctx: WebUiPanelContext): void {
  const { h } = ctx.ui;
  const t = ctx.language.startsWith('zh') ? TEXT.zh : TEXT.en;
  const sheet = ctx.ui.sheet({ title: ctx.language.startsWith('zh') ? '曲子' : 'Songs' });
  ctx.root.append(sheet.el);
  const bar = h('div', 'compose-bar');
  const picker = h('select', 'field compose-picker');
  const meta = h('span', 'compose-meta');
  const buttons = h('div', 'compose-buttons');
  const audio = h('audio', 'compose-audio');
  audio.controls = true;
  audio.hidden = true;
  const status = h('div', 'compose-status');
  const legend = h('div', 'compose-legend');
  const scroller = h('div', 'compose-scroll');
  const canvas = h('canvas', 'compose-roll');
  scroller.append(canvas);
  const facts = h('ul', 'compose-facts');
  bar.append(picker, meta);
  sheet.body.append(bar, buttons, audio, status, legend, scroller, facts);

  let view: SongView | null = null;
  let current = ctx.memo.get<string>('title', '');
  let audioUrl: string | null = null;
  let pxPerBeat = 22;
  let rows: SongRow[] = [];

  const button = (label: string, run: () => Promise<void> | void) => {
    const b = h('button', 'btn', label);
    b.type = 'button';
    b.addEventListener('click', () => { void Promise.resolve(run()).catch((e: unknown) => { status.textContent = e instanceof Error ? e.message : String(e); }); }, { signal: ctx.signal });
    return b;
  };
  const say = (text: string) => { status.textContent = text; };

  const releaseAudio = () => {
    audio.pause();
    audio.hidden = true;
    audio.removeAttribute('src');
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = null;
  };
  ctx.own({ dispose: releaseAudio });

  const colour = (name: string, fallback: string) => getComputedStyle(ctx.root).getPropertyValue(name).trim() || fallback;

  function draw(): void {
    const v = view;
    const g = canvas.getContext('2d');
    if (!v || !g) return;
    const ink = colour('--ink', '#222'), soft = colour('--ink-soft', '#888'), line = colour('--line-2', '#ddd'), accent = colour('--accent', '#d2691e'), danger = colour('--danger', '#c0392b');
    const melodic = v.parts.filter((p) => !p.drums), drums = v.parts.filter((p) => p.drums);
    const pitches = melodic.flatMap((p) => p.notes.map((n) => n[2]));
    const lo = (pitches.length ? Math.min(...pitches) : 60) - 2, hi = (pitches.length ? Math.max(...pitches) : 72) + 2;
    const totalBeats = v.bars * v.beatsPerBar;
    pxPerBeat = Math.max(4, Math.min(22, 15000 / totalBeats));
    const rollH = (hi - lo + 1) * ROW, drumH = drums.length ? DRUM_LANE : 0;
    const width = GUTTER + totalBeats * pxPerBeat + 12, height = HEAD + rollH + drumH + LEVEL_LANE;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    g.clearRect(0, 0, width, height);
    g.font = '11px system-ui, sans-serif';
    g.textBaseline = 'middle';
    const x = (beat: number) => GUTTER + beat * pxPerBeat;
    const y = (pitch: number) => HEAD + (hi - pitch) * ROW;

    v.sections.forEach((s, i) => {
      const x0 = x(s.firstBar * v.beatsPerBar), w = s.barCount * v.beatsPerBar * pxPerBeat;
      g.fillStyle = accent;
      g.globalAlpha = i % 2 === 0 ? 0.07 : 0.025;
      g.fillRect(x0, 0, w, height);
      g.globalAlpha = 1;
      g.fillStyle = ink;
      g.save();
      g.beginPath(); g.rect(x0, 0, w - 4, 18); g.clip();
      g.fillText(`${s.name} · ${s.groove === 'none' ? '—' : s.groove} · ${'●'.repeat(s.energy)}${'○'.repeat(5 - s.energy)}`, x0 + 4, 9);
      g.restore();
      // measured level of the section: -40 dB is the floor of the lane, -8 dB its top
      if (s.levelDb !== null) {
        const frac = Math.max(0.04, Math.min(1, (s.levelDb + 40) / 32));
        const barH = frac * (LEVEL_LANE - 16);
        g.fillStyle = accent;
        g.globalAlpha = 0.55;
        g.fillRect(x0 + 2, height - 4 - barH, w - 4, barH);
        g.globalAlpha = 1;
        g.fillStyle = ink;
        g.fillText(`${s.levelDb.toFixed(1)} dB`, x0 + 6, height - LEVEL_LANE + 8);
      }
    });

    g.strokeStyle = line;
    g.lineWidth = 1;
    for (let b = 0; b <= v.bars; b++) {
      const xb = Math.round(x(b * v.beatsPerBar)) + 0.5;
      g.beginPath(); g.moveTo(xb, 20); g.lineTo(xb, height - LEVEL_LANE); g.stroke();
      if (b < v.bars && pxPerBeat * v.beatsPerBar > 30) {
        g.fillStyle = soft;
        g.save();
        g.beginPath(); g.rect(xb, 20, pxPerBeat * v.beatsPerBar - 3, 18); g.clip();
        g.fillText(v.chords[b] || String(b + 1), xb + 3, 29);
        g.restore();
      }
    }
    for (let p = lo; p <= hi; p++) {
      if (p % 12 !== 0) continue;
      const yy = Math.round(y(p) + ROW) + 0.5;
      g.beginPath(); g.moveTo(GUTTER, yy); g.lineTo(width, yy); g.stroke();
      g.fillStyle = soft;
      g.fillText(`C${p / 12 - 1}`, 6, y(p) + ROW / 2);
    }

    const flagged = new Set(v.outside.map(([beat, pitch]) => `${beat.toFixed(3)}:${pitch}`));
    melodic.forEach((part, i) => {
      const fill = part.lead ? accent : PALETTE[i % PALETTE.length];
      for (const [start, len, pitch] of part.notes) {
        const w = Math.max(2, len * pxPerBeat - 1);
        g.fillStyle = fill;
        g.globalAlpha = part.lead ? 1 : 0.8;
        g.fillRect(x(start), y(pitch), w, ROW - 1);
        g.globalAlpha = 1;
        if (flagged.has(`${start.toFixed(3)}:${pitch}`)) {
          g.strokeStyle = danger;
          g.lineWidth = 2;
          g.strokeRect(x(start) - 1, y(pitch) - 1, w + 2, ROW + 1);
        }
      }
    });
    if (drums.length) {
      const top = HEAD + rollH;
      g.fillStyle = soft;
      g.fillText(t.drums, 4, top + DRUM_LANE / 2);
      const lanes = [...new Set(drums.flatMap((p) => p.notes.map((n) => n[2])))].sort((a, b) => a - b);
      for (const part of drums) for (const [start, , pitch] of part.notes) {
        g.fillStyle = ink;
        g.globalAlpha = 0.65;
        g.fillRect(x(start), top + 3 + (lanes.indexOf(pitch) / Math.max(1, lanes.length)) * (DRUM_LANE - 8), Math.max(2, pxPerBeat / 4), 3);
        g.globalAlpha = 1;
      }
    }
    g.fillStyle = soft;
    g.fillText('dB', 6, height - LEVEL_LANE + 8);

    legend.replaceChildren(...melodic.map((part, i) => {
      const chip = h('span', 'compose-chip');
      const dot = h('i', null);
      dot.style.background = part.lead ? accent : PALETTE[i % PALETTE.length];
      chip.append(dot, document.createTextNode(part.lead ? `${part.name} (${t.lead})` : part.name));
      return chip;
    }), ...(v.outside.length ? [(() => { const chip = h('span', 'compose-chip'); const dot = h('i', 'compose-outside'); chip.append(dot, document.createTextNode(`${t.outside} × ${v.outside.length}`)); return chip; })()] : []));
  }

  const head = h('div', 'compose-playhead');
  scroller.append(head);
  const secondsPerBeat = () => (view ? 60 / view.tempo : 0.5);
  ctx.frame(() => {
    if (!view || audio.hidden) { head.hidden = true; return; }
    head.hidden = false;
    const left = GUTTER + Math.max(0, (audio.currentTime - view.leadIn) / secondsPerBeat()) * pxPerBeat;
    head.style.left = `${left}px`;
    head.style.height = canvas.style.height;
    if (!audio.paused && (left < scroller.scrollLeft + 40 || left > scroller.scrollLeft + scroller.clientWidth - 60)) scroller.scrollLeft = left - 80;
  });
  canvas.addEventListener('click', (e) => {
    if (!view || audio.hidden) return;
    const beat = (e.offsetX - GUTTER) / pxPerBeat;
    audio.currentTime = Math.max(0, view.leadIn + beat * secondsPerBeat());
  }, { signal: ctx.signal });

  async function show(title: string): Promise<void> {
    current = title;
    ctx.memo.set('title', title);
    releaseAudio();
    say('');
    const row = rows.find((r) => r.title === title);
    const answer = await ctx.invoke<{ view?: SongView; problems?: string[] }>('song', [title]);
    view = answer.view ?? null;
    buttons.replaceChildren();
    if (!view) {
      scroller.hidden = true; legend.replaceChildren();
      meta.textContent = t.draft;
      facts.replaceChildren(h('li', null, t.problems), ...(answer.problems ?? []).map((p) => h('li', null, p)));
      return;
    }
    scroller.hidden = false;
    const length = (view.bars * view.beatsPerBar * 60) / view.tempo;
    meta.textContent = [`${view.tempo} bpm`, view.key, `${view.bars} bars`, `${Math.floor(length / 60)}:${String(Math.round(length % 60)).padStart(2, '0')}`,
      row ? (row.rendered ? t.versions(row.versions) : t.draft) : ''].filter(Boolean).join(' · ');
    if (row?.rendered) {
      buttons.append(
        button(t.listen, async () => {
          say(t.loading);
          const blob = await ctx.invokeBinary('audio', [title]);
          if (current !== title) return;
          audioUrl = URL.createObjectURL(blob);
          audio.src = audioUrl;
          audio.hidden = false;
          say('');
          await audio.play();
        }),
        button(t.device, async () => say((await ctx.invoke<{ text: string }>('play', [title])).text)),
        button(t.stop, async () => { audio.pause(); say((await ctx.invoke<{ text: string }>('stop', [])).text); }),
        button(t.open, async () => say((await ctx.invoke<{ text: string }>('open', [title])).text)),
      );
    }
    facts.replaceChildren(...view.facts.map((line) => h('li', null, line)));
    draw();
    scroller.scrollLeft = 0;
  }

  async function refresh(): Promise<void> {
    const list = await ctx.invoke<SongList>('list', []);
    const before = rows.map((r) => `${r.title}:${r.changedAtMs}`).join('|');
    rows = list.songs;
    if (rows.length === 0) {
      picker.hidden = true; scroller.hidden = true;
      meta.textContent = t.none;
      return;
    }
    picker.hidden = false; scroller.hidden = false;
    if (before === rows.map((r) => `${r.title}:${r.changedAtMs}`).join('|') && view) return;
    picker.replaceChildren(...rows.map((r) => { const o = h('option', null, r.rendered ? r.title : `${r.title} (${t.draft})`); o.value = r.title; return o; }));
    const pick = rows.some((r) => r.title === current) ? current : rows[0].title;
    picker.value = pick;
    await show(pick);
  }

  picker.addEventListener('change', () => { void show(picker.value).catch((e: unknown) => say(String(e))); }, { signal: ctx.signal });
  void refresh().catch((e: unknown) => say(e instanceof Error ? e.message : String(e)));
  ctx.interval(() => { void refresh().catch(() => undefined); }, 5000);
}

const bundle: WebUiClientBundle = { panels: { songs: { mount } } };
export default bundle;
