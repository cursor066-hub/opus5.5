// Procedural soundtrack for the SuperX showreel — 120 BPM, synced to render.mjs timeline.
import fs from 'fs';

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function renderAudio(file, DUR = 15) {
  const SR = 48000, N = Math.ceil(SR * DUR);
  const L = new Float32Array(N), R = new Float32Array(N), send = new Float32Array(N);
  const duck = new Float32Array(N).fill(1);
  const r = rng(3), noise = () => r() * 2 - 1;
  const TAU = Math.PI * 2;

  const add = (i, v, pan = 0, s = 0) => {
    if (i < 0 || i >= N) return;
    const a = (pan + 1) * Math.PI / 4;
    L[i] += v * Math.cos(a); R[i] += v * Math.sin(a); send[i] += v * s;
  };
  const span = (t0, len, fn) => {
    const i0 = Math.floor(t0 * SR), n = Math.floor(len * SR);
    for (let k = 0; k < n; k++) fn(i0 + k, k / SR, k / n);
  };

  const kick = (t0, amp = 1) => {
    let ph = 0;
    span(t0, 0.5, (i, tt) => {
      ph += TAU * (45 + 130 * Math.exp(-tt * 28)) / SR;
      const env = Math.exp(-tt * 6) * (1 - Math.exp(-tt * 2000));
      add(i, (Math.sin(ph) * env + noise() * Math.exp(-tt * 300) * 0.25) * amp * 0.9, 0, 0.05);
    });
    span(t0, 0.45, (i, tt) => { if (i < N) duck[i] = Math.min(duck[i], 1 - 0.85 * Math.exp(-tt * 9)); });
  };
  const snare = (t0, amp = 1) => {
    let last = 0;
    span(t0, 0.35, (i, tt) => {
      const n = noise(), hp = n - last; last = n;
      const v = hp * Math.exp(-tt * 16) * 0.3 + Math.sin(TAU * 185 * tt) * Math.exp(-tt * 25) * 0.35;
      add(i, v * amp, 0, 0.3);
    });
  };
  const hat = (t0, amp = 1, pan = 0) => {
    let a = 0, b = 0;
    span(t0, 0.08, (i, tt) => {
      const n = noise(), h1 = n - a; a = n; const h2 = h1 - b; b = h1;
      add(i, h2 * Math.exp(-tt * 55) * 0.09 * amp, pan, 0.05);
    });
  };
  const blip = (t0, f, amp = 0.1, pan = 0) =>
    span(t0, 0.06, (i, tt) => add(i, Math.sin(TAU * f * tt) * Math.exp(-tt * 80) * amp, pan, 0.2));
  const whoosh = (tc, dur = 0.5, amp = 0.35) => {
    let lp = 0;
    span(tc - dur / 2, dur, (i, tt, p) => {
      const env = Math.pow(Math.sin(Math.PI * p), 2);
      lp += (0.02 + 0.35 * env) * (noise() - lp);
      add(i, lp * env * amp * 2.2, -0.8 + 1.6 * p, 0.3);
    });
  };
  const riser = (t0, t1, amp = 1) => {
    let last = 0, ph = 0;
    span(t0, t1 - t0, (i, tt, p) => {
      const n = noise(), hp = n - last * (1 - p * 0.9); last = n;
      ph += TAU * 150 * Math.pow(2, p * 3.2) / SR;
      add(i, (hp * p * p * 0.22 + Math.sin(ph) * p * 0.08) * amp, Math.sin(tt * 9) * 0.4 * p, 0.35);
    });
  };
  const impact = (t0, amp = 1) => {
    kick(t0, 1.3 * amp);
    let lp = 0;
    span(t0, 2.6, (i, tt) => {
      lp += 0.05 * (noise() - lp);
      const sub = Math.sin(TAU * 38 * tt) * Math.exp(-tt * 1.4) * 0.45;
      add(i, (sub + lp * Math.exp(-tt * 3) * 1.4) * amp, 0, 0.6);
    });
  };
  const bell = (t0, f, amp = 0.1, pan = 0) =>
    span(t0, 2.5, (i, tt) => {
      const e = Math.exp(-tt * 2.6);
      add(i, (Math.sin(TAU * f * tt) + 0.35 * Math.sin(TAU * f * 2.76 * tt) * Math.exp(-tt * 6)) * e * amp, pan, 0.55);
    });

  // ── Arrangement ─────────────────────────────────────────────────
  blip(0.08, 880, 0.22);                      // dot pop
  whoosh(0.72, 0.5, 0.25);                    // line stretch
  for (let t = 1.0; t < 1.55; t += 0.035) blip(t, 2400 + r() * 1400, 0.035, noise() * 0.6); // decode ticks
  riser(0.9, 2.0);
  impact(2.0);

  for (let b = 2.5; b < 11.5; b += 0.5) kick(b);
  for (let b = 2.5; b <= 11.0; b += 1.0) snare(b);
  for (let b = 2.25; b < 11.5; b += 0.5) hat(b, 1, 0.3);
  for (let b = 7.3; b < 9.5; b += 0.25) hat(b + 0.125, 0.55, -0.35); // 16ths in the grid scene

  whoosh(4.55, 0.45); whoosh(7.2, 0.5); whoosh(9.45, 0.4);
  for (const t of [5.25, 5.75, 6.25, 6.75]) { blip(t, 1320, 0.07, -0.4); blip(t + 0.06, 1760, 0.05, 0.4); }
  for (const t of [10.5, 11.0]) whoosh(t + 0.1, 0.3, 0.3);          // X rotation snaps

  riser(11.0, 12.0, 1.1);
  whoosh(11.8, 0.7, 0.4);
  impact(12.0, 1.2);
  bell(12.5, 880, 0.08, -0.3); bell(12.58, 1318.5, 0.06, 0.3); bell(12.66, 1760, 0.05, 0);
  for (let t = 13.0; t < 13.7; t += 0.04) blip(t, 2600 + r() * 1200, 0.025, noise() * 0.6);

  // Bass (sidechained), A minor progression, one note per 2 beats
  const seq = [55, 55, 43.65, 49, 55, 55, 65.41, 49, 43.65, 49];
  seq.forEach((f, k) => {
    let ph = 0;
    span(2.0 + k, 1.0, (i, tt) => {
      ph += TAU * f / SR;
      const env = Math.min(1, tt / 0.005) * (0.7 + 0.3 * Math.exp(-tt * 8)) * Math.min(1, (1 - tt) / 0.03);
      const v = Math.sin(ph) + 0.35 * Math.sin(2 * ph) + 0.15 * Math.sin(3 * ph);
      add(i, v * env * 0.22 * duck[Math.min(i, N - 1)], 0, 0);
    });
  });

  // Pad — Am9, swells in intro and outro
  const pad = [110, 164.81, 196, 246.94, 261.63];
  span(0, DUR, (i, tt) => {
    let lvl = 0.045 * Math.min(1, tt / 1.5);
    if (tt > 12) lvl = 0.07 * Math.min(1, (tt - 12) / 0.4);
    lvl *= Math.min(1, (DUR - tt) / 0.8);
    let v = 0;
    for (const f of pad) v += Math.sin(TAU * f * 0.997 * tt) + Math.sin(TAU * f * 1.003 * tt);
    add(i, v * lvl * 0.2 * (0.85 + 0.15 * Math.sin(tt * 5)) * duck[i], 0, 0.5);
  });

  // ── Reverb (Schroeder) ──────────────────────────────────────────
  const reverb = (off) => {
    const out = new Float32Array(N);
    const sc = 48000 / 44100;
    for (const d0 of [1557, 1617, 1491, 1422]) {
      const d = Math.round((d0 + off) * sc), buf = new Float32Array(d);
      let idx = 0, lp = 0;
      for (let i = 0; i < N; i++) {
        const y = buf[idx]; lp = y * 0.6 + lp * 0.4;
        buf[idx] = send[i] + lp * 0.84; idx = (idx + 1) % d; out[i] += y * 0.25;
      }
    }
    for (const d0 of [225, 556]) {
      const d = Math.round((d0 + off) * sc), buf = new Float32Array(d);
      let idx = 0;
      for (let i = 0; i < N; i++) {
        const b = buf[idx], y = -out[i] + b; buf[idx] = out[i] + b * 0.5; idx = (idx + 1) % d; out[i] = y;
      }
    }
    return out;
  };
  const rl = reverb(0), rr = reverb(23);
  let peak = 0;
  for (let i = 0; i < N; i++) {
    L[i] += rl[i] * 0.35; R[i] += rr[i] * 0.35;
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }

  // ── Master: normalize, soft clip, fade, write 16-bit WAV ────────
  const g = 1.15 / peak, buf = Buffer.alloc(44 + N * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
  for (let i = 0; i < N; i++) {
    const fade = Math.min(1, (N - i) / (SR * 0.3));
    const sl = Math.tanh(L[i] * g) * 0.89 * fade, sr = Math.tanh(R[i] * g) * 0.89 * fade;
    buf.writeInt16LE(Math.round(sl * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(sr * 32767), 46 + i * 4);
  }
  fs.writeFileSync(file, buf);
}
