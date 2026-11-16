/**
 * Plays a rendered WAV on a chosen output device through RtAudio (audify). One song at a time; starting
 * another stops the one playing. Frames are fed a little ahead of the clock, so stopping is immediate.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

interface RtAudioLike {
  openStream(out: { deviceId: number; nChannels: number; firstChannel: number }, input: null, format: number, sampleRate: number,
    frameSize: number, streamName: string, inputCallback: null, frameOutputCallback: null): void;
  closeStream(): void;
  start(): void;
  write(buf: Buffer): void;
  getDevices(): Array<{ id: number; name: string; outputChannels: number }>;
  getDefaultOutputDevice(): number;
  isStreamOpen(): boolean;
}
interface AudifyModule {
  RtAudio: new (api?: number) => RtAudioLike;
  RtAudioFormat: { RTAUDIO_SINT16: number };
  RtAudioApi: { WINDOWS_WASAPI: number };
}

const FRAME = 1024;
const AHEAD_SECONDS = 0.5;

/** Loaded on first use: the native module stays out of processes that never play. */
function loadAudify(): AudifyModule | null {
  try {
    return createRequire(import.meta.url)('audify') as AudifyModule;
  } catch {
    return null;
  }
}

// On Windows RtAudio picks ASIO first when a vendor driver is installed; WASAPI lists the system's own devices.
const apiOf = (audify: AudifyModule): number | undefined => (process.platform === 'win32' ? audify.RtAudioApi.WINDOWS_WASAPI : undefined);

export interface PlaybackDevice { name: string; isDefault: boolean }

/** Output devices of this computer; empty when the audio layer is unavailable. */
export function listPlaybackDevices(): PlaybackDevice[] {
  const audify = loadAudify();
  if (!audify) return [];
  try {
    const rt = new audify.RtAudio(apiOf(audify));
    const fallback = rt.getDefaultOutputDevice();
    return rt.getDevices().filter((d) => d.outputChannels > 0).map((d) => ({ name: d.name, isDefault: d.id === fallback }));
  } catch {
    return [];
  }
}

/** The dropdown of `worlds.compose.playbackDevice`: the system default first, then each device by name. */
export function composeConfigOptions(kind: string, language: string): Array<{ value: string; label: string }> {
  if (kind !== 'compose-playback') return [];
  const zh = language.startsWith('zh');
  return [
    { value: '', label: zh ? '系统默认设备' : 'System default device' },
    ...listPlaybackDevices().map((d) => ({ value: d.name, label: d.isDefault ? `${d.name}${zh ? ' · 默认' : ' · default'}` : d.name })),
  ];
}

interface Wav { rate: number; channels: number; samples: Int16Array }

function readWav(file: string): Wav {
  const bytes = readFileSync(file);
  let at = 12, rate = 44100, channels = 2;
  while (at + 8 <= bytes.length) {
    const id = bytes.toString('ascii', at, at + 4), size = bytes.readUInt32LE(at + 4);
    if (id === 'fmt ') { channels = bytes.readUInt16LE(at + 10); rate = bytes.readUInt32LE(at + 12); }
    if (id === 'data') {
      const n = Math.floor(Math.min(size, bytes.length - at - 8) / 2);
      const samples = new Int16Array(n);
      for (let i = 0; i < n; i++) samples[i] = bytes.readInt16LE(at + 8 + i * 2);
      return { rate, channels, samples };
    }
    at += 8 + size + (size % 2);
  }
  throw new Error(`${file} holds no audio data`);
}

/** Interleaved stereo at `rate` → interleaved `channels` at `target`, scaled by `volume`. */
function fit(wav: Wav, target: number, channels: number, volume: number): Int16Array {
  const frames = wav.samples.length / wav.channels;
  const outFrames = Math.round(frames * target / wav.rate);
  const out = new Int16Array(outFrames * channels);
  for (let i = 0; i < outFrames; i++) {
    const x = i * wav.rate / target, a = Math.min(frames - 1, Math.floor(x)), b = Math.min(frames - 1, a + 1), t = x - a;
    const at = (frame: number, ch: number) => wav.samples[frame * wav.channels + Math.min(ch, wav.channels - 1)];
    const l = (at(a, 0) * (1 - t) + at(b, 0) * t) * volume, r = (at(a, 1) * (1 - t) + at(b, 1) * t) * volume;
    if (channels === 1) out[i] = Math.round((l + r) / 2);
    else { out[i * channels] = Math.round(l); out[i * channels + 1] = Math.round(r); }
  }
  return out;
}

export interface Playing { title: string; device: string; seconds: number; startedAtMs: number }

export class Player {
  private rt: RtAudioLike | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private current: Playing | null = null;

  /** What is sounding now, or null. */
  playing(): Playing | null {
    return this.current;
  }

  /** Starts playback and returns once the device has accepted the stream. Throws with the reason when it does not. */
  play(title: string, file: string, deviceName: string, volume: number): Playing {
    this.stop();
    const audify = loadAudify();
    if (!audify) throw new Error('the audio layer (audify) could not be loaded on this computer');
    const wav = readWav(file);
    const rt = new audify.RtAudio(apiOf(audify));
    const devices = rt.getDevices().filter((d) => d.outputChannels > 0);
    const device = (deviceName ? devices.find((d) => d.name === deviceName) : undefined) ?? devices.find((d) => d.id === rt.getDefaultOutputDevice()) ?? devices[0];
    if (!device) throw new Error('this computer reports no output device');
    if (deviceName && device.name !== deviceName) throw new Error(`output device "${deviceName}" is not present; present: ${devices.map((d) => d.name).join(', ')}`);
    const channels = Math.min(2, device.outputChannels);
    let rate = wav.rate;
    const open = (r: number) => rt.openStream({ deviceId: device.id, nChannels: channels, firstChannel: 0 }, null, audify.RtAudioFormat.RTAUDIO_SINT16, r, FRAME, 'cortico-compose', null, null);
    try { open(rate); } catch { rate = 48000; open(rate); }
    rt.start();
    const pcm = fit(wav, rate, channels, Math.min(1, Math.max(0, volume)));
    const total = pcm.length / channels;
    const playing: Playing = { title, device: device.name, seconds: total / rate, startedAtMs: Date.now() };
    let written = 0;
    const feed = () => {
      const due = Math.min(total, Math.ceil(((Date.now() - playing.startedAtMs) / 1000 + AHEAD_SECONDS) * rate));
      try {
        while (written < due) {
          const frame = new Int16Array(FRAME * channels);
          frame.set(pcm.subarray(written * channels, Math.min(total, written + FRAME) * channels));
          rt.write(Buffer.from(frame.buffer));
          written += FRAME;
        }
      } catch {
        this.stop();
        return;
      }
      if (written >= total && Date.now() - playing.startedAtMs > (playing.seconds + AHEAD_SECONDS) * 1000) this.stop();
    };
    this.rt = rt;
    this.current = playing;
    feed();
    this.timer = setInterval(feed, 100);
    return playing;
  }

  /** Stops what is playing; returns it, or null when nothing was. */
  stop(): Playing | null {
    const was = this.current;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.current = null;
    if (this.rt) { try { if (this.rt.isStreamOpen()) this.rt.closeStream(); } catch { /* the device is already gone */ } }
    this.rt = null;
    return was;
  }
}
