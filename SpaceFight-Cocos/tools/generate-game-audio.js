const fs = require('node:fs');
const path = require('node:path');

const RATE = 24000;
const output = path.resolve(__dirname, '../assets/resources/audio');
fs.mkdirSync(output, { recursive: true });

function noise(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return (value / 0xffffffff) * 2 - 1;
  };
}

function write(name, seconds, sample) {
  const count = Math.floor(seconds * RATE);
  const data = Buffer.alloc(count * 2);
  for (let index = 0; index < count; index += 1) {
    const time = index / RATE;
    const value = Math.max(-1, Math.min(1, sample(time, seconds)));
    data.writeInt16LE(Math.round(value * 32767), index * 2);
  }
  const wav = Buffer.alloc(44 + data.length);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + data.length, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22); wav.writeUInt32LE(RATE, 24); wav.writeUInt32LE(RATE * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
  wav.writeUInt32LE(data.length, 40); data.copy(wav, 44);
  fs.writeFileSync(path.join(output, `${name}.wav`), wav);
}

const random = noise(0x5f3759df);
const decay = (time, seconds, power = 2) => Math.pow(Math.max(0, 1 - time / seconds), power);
write('pulse-shot', 0.18, (t, s) => (Math.sin(2 * Math.PI * (210 - t * 520) * t) * 0.58 + random() * 0.16) * decay(t, s, 2.8));
write('missile-launch', 0.48, (t, s) => (random() * 0.34 + Math.sin(2 * Math.PI * (92 + t * 180) * t) * 0.38) * decay(t, s, 1.5));
write('hit-confirm', 0.13, (t, s) => (Math.sin(2 * Math.PI * 760 * t) + Math.sin(2 * Math.PI * 1140 * t) * 0.5) * 0.34 * decay(t, s, 3));
write('destroyed', 0.72, (t, s) => (random() * 0.4 + Math.sin(2 * Math.PI * (78 - t * 36) * t) * 0.34) * decay(t, s, 1.2));
write('player-hit', 0.3, (t, s) => (random() * 0.35 + Math.sin(2 * Math.PI * 118 * t) * 0.42) * decay(t, s, 2));
write('pickup', 0.42, (t, s) => (Math.sin(2 * Math.PI * (420 + t * 760) * t) + Math.sin(2 * Math.PI * 840 * t) * 0.24) * 0.35 * decay(t, s, 1.5));
write('return', 0.8, (t, s) => Math.sin(2 * Math.PI * (180 + t * 190) * t) * 0.34 * decay(t, s, 0.6));
write('ui-select', 0.09, (t, s) => Math.sin(2 * Math.PI * 520 * t) * 0.3 * decay(t, s, 2.4));
write('engine-loop', 2.4, (t) => {
  const edge = Math.min(1, t * 12, (2.4 - t) * 12);
  return (Math.sin(2 * Math.PI * 54 * t) * 0.2 + Math.sin(2 * Math.PI * 108 * t) * 0.07 + random() * 0.035) * edge;
});

