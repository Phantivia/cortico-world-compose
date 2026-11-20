/**
 * Renders an `Arrangement` through a SoundFont to stereo samples, then levels it. One channel per instrument,
 * drums on channel 9. Rendering yields to the event loop between chunks so the process stays responsive.
 */
import { readFileSync } from 'node:fs';
import { BasicSoundBank, SoundBankLoader, SpessaSynthProcessor } from 'spessasynth_core';
import type { Arrangement, Role } from './arrange.ts';

export const SAMPLE_RATE = 44100;

const MIX: Record<Role, { volume: number; reverb: number }> = {
  lead: { volume: 116, reverb: 52 },
  part: { volume: 98, reverb: 48 },
  comp: { volume: 84, reverb: 32 },
  bass: { volume: 104, reverb: 0 },
  drums: { volume: 100, reverb: 22 },
};
const PANS = [64, 46, 82, 54, 74, 40, 88];

export class SoundFont {
  private bank: BasicSoundBank | null = null;
  private loadedFrom = '';

  /** Parses the file once per path; a changed path is read again. */
  load(file: string): BasicSoundBank {
    if (this.bank === null || this.loadedFrom !== file) {
      const bytes = readFileSync(file);
      this.bank = SoundBankLoader.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
      this.loadedFrom = file;
    }
    return this.bank;
  }
}

export interface Rendered { left: Float32Array; right: Float32Array; seconds: number }

export async function render(arrangement: Arrangement, bank: BasicSoundBank, signal?: AbortSignal): Promise<Rendered> {
  const synth = new SpessaSynthProcessor(SAMPLE_RATE);
  await synth.ready;
  synth.soundBankManager.addSoundBank(bank, 'main');
  const total = Math.ceil(arrangement.seconds * SAMPLE_RATE);
  const left = new Float32Array(total), right = new Float32Array(total);

  type Action = { sample: number; on: boolean; channel: number; pitch: number; velocity: number };
  const actions: Action[] = [];
  let nextChannel = 0, melodic = 0;
  for (const track of arrangement.tracks) {
    let channel = 9;
    if (track.role !== 'drums') {
      if (nextChannel % 16 === 9) nextChannel++;
      channel = nextChannel++;
      while (synth.midiChannels.length <= channel) synth.createMIDIChannel();
      synth.programChange(channel, track.instrument!.program);
      synth.controllerChange(channel, 10, track.role === 'lead' || track.role === 'bass' ? 64 : PANS[++melodic % PANS.length]);
    }
    synth.controllerChange(channel, 7, MIX[track.role].volume);
    synth.controllerChange(channel, 91, MIX[track.role].reverb);
    for (const note of track.notes) {
      actions.push({ sample: Math.round(note.at * SAMPLE_RATE), on: true, channel, pitch: note.pitch, velocity: note.velocity });
      actions.push({ sample: Math.round(note.until * SAMPLE_RATE), on: false, channel, pitch: note.pitch, velocity: 0 });
    }
  }
  // note-offs first at equal times, so a repeated pitch re-attacks
  actions.sort((a, b) => a.sample - b.sample || Number(a.on) - Number(b.on));

  const BLOCK = 128;
  let position = 0, sinceYield = 0;
  const advance = async (until: number) => {
    while (position < until) {
      const n = Math.min(BLOCK, until - position);
      synth.process(left, right, position, n);
      position += n;
      if ((sinceYield += n) >= SAMPLE_RATE * 4) {
        sinceYield = 0;
        await new Promise<void>((resolve) => setImmediate(resolve));
        if (signal?.aborted) throw new Error('rendering was interrupted');
      }
    }
  };
  for (const action of actions) {
    await advance(Math.min(total, action.sample));
    if (action.on) synth.noteOn(action.channel, action.pitch, action.velocity);
    else synth.noteOff(action.channel, action.pitch);
  }
  await advance(total);
  master(left, right);
  return { left, right, seconds: arrangement.seconds };
}

/** Brings the loudest stretch to about -1 dBFS and rounds off the few peaks above it; fades the last second. */
function master(left: Float32Array, right: Float32Array): void {
  const peaks: number[] = [];
  const hop = 2048;
  for (let i = 0; i < left.length; i += hop) {
    let p = 0;
    for (let k = i; k < Math.min(left.length, i + hop); k++) p = Math.max(p, Math.abs(left[k]), Math.abs(right[k]));
    peaks.push(p);
  }
  peaks.sort((a, b) => a - b);
  const reference = peaks[Math.floor(peaks.length * 0.995)] || 1e-6;
  const gain = 0.8 / reference;
  const knee = 0.8, ceiling = 0.97;
  const shape = (v: number): number => {
    const a = Math.abs(v);
    if (a <= knee) return v;
    return Math.sign(v) * (knee + (ceiling - knee) * Math.tanh((a - knee) / (ceiling - knee)));
  };
  const fade = Math.min(left.length, SAMPLE_RATE);
  for (let i = 0; i < left.length; i++) {
    const tail = i >= left.length - fade ? (left.length - i) / fade : 1;
    left[i] = shape(left[i] * gain) * tail;
    right[i] = shape(right[i] * gain) * tail;
  }
}

/** RMS level in dBFS of [from, to) seconds. */
export function levelDb(audio: Rendered, from: number, to: number): number {
  const a = Math.max(0, Math.floor(from * SAMPLE_RATE)), b = Math.min(audio.left.length, Math.ceil(to * SAMPLE_RATE));
  let sum = 0;
  for (let i = a; i < b; i++) sum += (audio.left[i] * audio.left[i] + audio.right[i] * audio.right[i]) / 2;
  return 10 * Math.log10(sum / Math.max(1, b - a) + 1e-12);
}

export function wavBytes(audio: Rendered): Buffer {
  const n = audio.left.length;
  const out = Buffer.alloc(44 + n * 4);
  out.write('RIFF', 0); out.writeUInt32LE(36 + n * 4, 4); out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22);
  out.writeUInt32LE(SAMPLE_RATE, 24); out.writeUInt32LE(SAMPLE_RATE * 4, 28); out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34);
  out.write('data', 36); out.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, audio.left[i])) * 32767), 44 + i * 4);
    out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, audio.right[i])) * 32767), 46 + i * 4);
  }
  return out;
}
