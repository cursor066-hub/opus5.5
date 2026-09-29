// SuperX — 15s motion design showreel. 1920x1080 @ 60fps, fully procedural.
// Usage: npm run render   (optional: node render.mjs --stills 0.5,2.1,...)
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import ffmpeg from 'ffmpeg-static';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { renderAudio } from './audio.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(DIR, 'out');
fs.mkdirSync(OUT, { recursive: true });

const W = 1920, H = 1080, FPS = 60, DUR = 15, FRAMES = FPS * DUR;
const CX = W / 2, CY = H / 2;

const font = (pkg, file, name) =>
  GlobalFonts.registerFromPath(path.join(DIR, 'node_modules/@fontsource', pkg, 'files', file), name);
font('inter', 'inter-latin-900-normal.woff2', 'InterBlack');
font('inter', 'inter-latin-800-normal.woff2', 'InterXB');
font('space-grotesk', 'space-grotesk-latin-700-normal.woff2', 'Grotesk');
font('jetbrains-mono', 'jetbrains-mono-latin-500-normal.woff2', 'Mono');

// ── Palette ─────────────────────────────────────────────────────────
const C = {
  bg: '#0B0B12', ink: '#F4F1EA', violet: '#7B5CFF', coral: '#FF4D5E',
  lime: '#C8FF3D', deep: '#120E24', void: '#07060D',
};

// ── Math / easing ───────────────────────────────────────────────────
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const prog = (t, a, b) => clamp((t - a) / (b - a));
const E = {
  outExpo: (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  inExpo: (x) => (x <= 0 ? 0 : Math.pow(2, 10 * x - 10)),
  inOutExpo: (x) => x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2,
  outCubic: (x) => 1 - Math.pow(1 - x, 3),
  inOutCubic: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  inCubic: (x) => x * x * x,
  outBack: (x, s = 1.70158) => 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2),
  inOutBack: (x) => {
    const c = 1.70158 * 1.525;
    return x < 0.5 ? (Math.pow(2 * x, 2) * ((c + 1) * 2 * x - c)) / 2
      : (Math.pow(2 * x - 2, 2) * ((c + 1) * (x * 2 - 2) + c) + 2) / 2;
  },
  outElastic: (x) => x <= 0 ? 0 : x >= 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * (2 * Math.PI / 3)) + 1,
};
const hash = (a, b = 0) => {
  let h = Math.imul(a * 374761393 + b * 668265263, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Exponential decay pulse fired at given times
const pulse = (t, times, k = 8) => times.reduce((m, t0) => (t >= t0 ? Math.max(m, Math.exp(-(t - t0) * k)) : m), 0);

// ── Canvases ────────────────────────────────────────────────────────
const main = createCanvas(W, H), x = main.getContext('2d');
const tmp = createCanvas(W, H), tx = tmp.getContext('2d');
const acc = createCanvas(W, H), ax = acc.getContext('2d');

// Film grain tiles
const GRAIN = [0, 1, 2, 3].map((k) => {
  const c = createCanvas(256, 256), g = c.getContext('2d'), img = g.createImageData(256, 256), r = mulberry(99 + k);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = r() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0); return c;
});
// Vignette
const vig = createCanvas(W, H);
{
  const g = vig.getContext('2d'), gr = g.createRadialGradient(CX, CY, H * 0.35, CX, CY, W * 0.72);
  gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
}

// ── Drawing helpers ─────────────────────────────────────────────────
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*@/<>';
function scramble(str, p, frame, seed = 0) {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const lockAt = (i + 1) / str.length;
    if (str[i] === ' ' || p >= lockAt) out += str[i];
    else if (p > lockAt - 0.35) out += GLYPHS[Math.floor(hash(Math.floor(frame / 2), i + seed * 97) * GLYPHS.length)];
    else out += ' ';
  }
  return out;
}
// Lays out letters centered at (cx, cy) and hands each to fn(ch, lx, i, n)
function letters(str, cx, cy, fontSpec, tracking, fn) {
  x.font = fontSpec;
  const ws = [...str].map((ch) => x.measureText(ch).width);
  const total = ws.reduce((a, b) => a + b, 0) + tracking * (str.length - 1);
  let lx = cx - total / 2;
  [...str].forEach((ch, i) => { fn(ch, lx + ws[i] / 2, i, str.length, ws[i]); lx += ws[i] + tracking; });
  return total;
}
function fitFont(str, family, maxW, maxSize) {
  x.font = `${maxSize}px ${family}`;
  return Math.min(maxSize, (maxSize * maxW) / x.measureText(str).width);
}
function drawX(cx, cy, size, thick, rot, colA, colB, stroke = 0) {
  x.save(); x.translate(cx, cy); x.rotate(rot);
  for (const [a, col] of [[Math.PI / 4, colA], [-Math.PI / 4, colB]]) {
    x.save(); x.rotate(a);
    if (stroke) { x.strokeStyle = col; x.lineWidth = stroke; x.strokeRect(-size / 2, -thick / 2, size, thick); }
    else { x.fillStyle = col; x.fillRect(-size / 2, -thick / 2, size, thick); }
    x.restore();
  }
  x.restore();
}

// Shape morph: every shape resampled to N points, starting at top, clockwise
const NPTS = 160;
function samplePoly(verts) {
  const segs = verts.map((v, i) => { const w = verts[(i + 1) % verts.length]; return [v, w, Math.hypot(w[0] - v[0], w[1] - v[1])]; });
  const total = segs.reduce((a, s) => a + s[2], 0), pts = [];
  for (let k = 0; k < NPTS; k++) {
    let d = (k / NPTS) * total, s = 0;
    while (d > segs[s][2]) { d -= segs[s][2]; s++; }
    const [a, b, l] = segs[s], u = d / l;
    pts.push([lerp(a[0], b[0], u), lerp(a[1], b[1], u)]);
  }
  return pts;
}
const ngon = (n, r, k = 1, r2 = r) => Array.from({ length: n * k }, (_, i) => {
  const a = -Math.PI / 2 + (i / (n * k)) * Math.PI * 2, rr = i % 2 && k === 2 ? r2 : r;
  return [Math.cos(a) * rr, Math.sin(a) * rr];
});
const SHAPES = [
  Array.from({ length: NPTS }, (_, i) => { const a = -Math.PI / 2 + (i / NPTS) * Math.PI * 2; return [Math.cos(a), Math.sin(a)]; }),
  samplePoly([[0, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([a, b]) => [a * 0.86, b * 0.86])),
  samplePoly(ngon(3, 1.15).map(([a, b]) => [a, b + 0.18])),
  samplePoly(ngon(5, 1.15, 2, 0.5)),
];
SHAPES.push(SHAPES[0]);
function shapePath(pts, s) {
  x.beginPath();
  pts.forEach(([px, py], i) => (i ? x.lineTo(px * s, py * s) : x.moveTo(px * s, py * s)));
  x.closePath();
}
function morphAt(t) {
  const keys = [5.25, 5.75, 6.25, 6.75];
  let idx = 0, m = 0;
  keys.forEach((k, i) => { if (t >= k) { idx = i; m = E.inOutBack(prog(t, k, k + 0.4)); } });
  if (t < keys[0]) return SHAPES[0];
  const a = SHAPES[idx], b = SHAPES[idx + 1];
  return a.map((p, i) => [lerp(p[0], b[i][0], m), lerp(p[1], b[i][1], m)]);
}

// Precomputed particles
const rnd = mulberry(7);
const BURST = Array.from({ length: 260 }, () => ({
  a: rnd() * Math.PI * 2, v: 500 + rnd() ** 2 * 2200, s: 2 + rnd() * 7,
  c: [C.violet, C.coral, C.lime, C.ink][Math.floor(rnd() * 4)], spin: rnd() * 10 - 5, sq: rnd() > 0.6,
}));
const TUNNEL = Array.from({ length: 22 }, (_, i) => ({ z: 200 + i * 130, r: rnd() * Math.PI, c: [C.violet, C.coral, C.lime, C.ink][i % 4] }));
const STARS = Array.from({ length: 180 }, () => ({ a: rnd() * Math.PI * 2, d: rnd(), sp: 0.4 + rnd() }));

// ── Scenes ──────────────────────────────────────────────────────────
// 1 · 0.0–2.0  Dot → line → decode "SUPERX"
function sceneIntro(t, f) {
  x.fillStyle = C.bg; x.fillRect(0, 0, W, H);
  const push = 1 + 0.12 * E.inCubic(prog(t, 1.2, 2.0));
  x.save(); x.translate(CX, CY); x.scale(push, push);

  const pop = E.outBack(prog(t, 0.08, 0.4), 3);
  const stretch = E.inOutExpo(prog(t, 0.45, 0.95));
  const open = E.outExpo(prog(t, 0.95, 1.35));
  const lineW = lerp(28 * pop, 1300, stretch), lineH = lerp(28 * pop, 6, E.outCubic(prog(t, 0.45, 0.7)));

  if (t < 0.45) { // dot + ripple
    x.fillStyle = C.ink; x.beginPath(); x.arc(0, 0, 14 * pop, 0, Math.PI * 2); x.fill();
    const rp = prog(t, 0.1, 0.45);
    x.strokeStyle = `rgba(244,241,234,${0.6 * (1 - rp)})`; x.lineWidth = 2;
    x.beginPath(); x.arc(0, 0, 14 + rp * 90, 0, Math.PI * 2); x.stroke();
  } else {
    // Two lines separate vertically, text revealed between them
    const gap = open * 170;
    const fs2 = 250;
    if (open > 0) {
      x.save(); x.beginPath(); x.rect(-lineW / 2, -gap, lineW, gap * 2); x.clip();
      const p = prog(t, 1.0, 1.65);
      const str = scramble('SUPERX', p, f, 1);
      letters(str, 0, 0, `${fs2}px InterBlack`, 6, (ch, lx, i) => {
        const locked = p >= (i + 1) / 6;
        x.fillStyle = locked ? (i === 5 ? C.lime : C.ink) : C.violet;
        x.textAlign = 'center'; x.textBaseline = 'middle';
        const dy = (1 - E.outExpo(prog(t, 1.0 + i * 0.05, 1.5 + i * 0.05))) * 120;
        x.fillText(ch, lx, dy + 8);
      });
      x.restore();
    }
    x.fillStyle = C.ink;
    x.fillRect(-lineW / 2, -gap - lineH / 2, lineW, lineH);
    if (gap > 1) x.fillRect(-lineW / 2, gap - lineH / 2, lineW, lineH);
    // mono captions riding the lines
    if (t > 1.25) {
      x.font = '20px Mono'; x.fillStyle = C.ink; x.globalAlpha = E.outCubic(prog(t, 1.25, 1.5));
      x.textAlign = 'left'; x.fillText(scramble('MOTION DESIGN SHOWREEL', prog(t, 1.25, 1.7), f, 3), -lineW / 2, -gap - 22);
      x.textAlign = 'right'; x.fillText(scramble('VOL. 2026', prog(t, 1.3, 1.7), f, 4), lineW / 2, gap + 36);
      x.globalAlpha = 1;
    }
  }
  x.restore();
}

// 2 · 2.0–4.5  Kinetic type, hard cuts on the beat
const WORDS = ['BOLD.', 'FAST.', 'PRECISE.', 'PLAYFUL.', 'ALIVE.'];
const WBG = [C.coral, C.ink, C.violet, C.lime, C.bg];
const WFG = [C.bg, C.bg, C.ink, C.bg, C.ink];
function sceneType(t, f) {
  const k = clamp(Math.floor((t - 2.0) / 0.5), 0, 4), lt = t - 2.0 - k * 0.5;
  x.fillStyle = WBG[k]; x.fillRect(0, 0, W, H);

  // Background outlined marquee
  x.save(); x.globalAlpha = 0.14; x.strokeStyle = WFG[k]; x.lineWidth = 2;
  x.font = '190px InterBlack'; x.textBaseline = 'middle'; x.textAlign = 'left';
  const row = WORDS.join(' ') + ' ';
  const rw = x.measureText(row).width;
  for (let r = -1; r <= 4; r++) {
    const dir = r % 2 ? 1 : -1, off = ((t * 380 * dir) % rw + rw) % rw;
    for (let s = -1; s < 2; s++) x.strokeText(row, -off + s * rw, r * 210 + 120);
  }
  x.restore();

  const size = fitFont(WORDS[k], 'InterBlack', 1600, 400);
  const bandH = size * 0.95;
  x.save(); x.beginPath(); x.rect(0, CY - bandH / 2, W, bandH); x.clip();
  x.textAlign = 'center'; x.textBaseline = 'middle';
  // Outgoing word (prev colors inverted onto the new background)
  if (k > 0 && lt < 0.2) {
    const o = E.inExpo(prog(lt, 0, 0.2));
    x.fillStyle = WFG[k]; x.globalAlpha = 1 - o;
    x.font = `${fitFont(WORDS[k - 1], 'InterBlack', 1600, 400)}px InterBlack`;
    x.fillText(WORDS[k - 1], CX, CY - o * bandH);
    x.globalAlpha = 1;
  }
  letters(WORDS[k], CX, CY, `${size}px InterBlack`, -size * 0.02, (ch, lx, i, n) => {
    const p = E.outExpo(prog(lt, 0.04 + i * 0.022, 0.4 + i * 0.022));
    x.save(); x.translate(lx, CY + (1 - p) * bandH * 1.1);
    x.transform(1, 0, -0.25 * (1 - p), 1, 0, 0);
    x.fillStyle = WFG[k]; x.fillText(ch, 0, size * 0.04);
    x.restore();
  });
  x.restore();

  // Beat counter + index strip
  x.font = '22px Mono'; x.fillStyle = WFG[k]; x.textAlign = 'left';
  x.fillText(`0${k + 1} / 05`, 120, CY + bandH / 2 + 60);
  for (let i = 0; i < 5; i++) {
    x.globalAlpha = i === k ? 1 : 0.3;
    x.fillRect(W - 120 - (5 - i) * 46, CY + bandH / 2 + 52, 36 * (i === k ? E.outExpo(prog(lt, 0, 0.3)) : 1), 6);
  }
  x.globalAlpha = 1;

  // Circle wipe into scene 3
  const wp = E.inExpo(prog(t, 4.25, 4.5));
  if (wp > 0) { x.fillStyle = C.deep; x.beginPath(); x.arc(CX, CY, wp * 1150, 0, Math.PI * 2); x.fill(); }
}

// 3 · 4.5–7.2  Shape morphing, orbit systems, easing visualizer
function sceneShapes(t, f) {
  x.fillStyle = C.deep; x.fillRect(0, 0, W, H);
  const lt = t - 4.5;

  // dotted grid backdrop
  x.fillStyle = 'rgba(244,241,234,0.08)';
  for (let gx = 60; gx < W; gx += 60) for (let gy = 60; gy < H; gy += 60) x.fillRect(gx - 1, gy - 1, 2, 2);

  x.save(); x.translate(CX, CY);
  // concentric dashed rings
  [300, 380, 460].forEach((r, i) => {
    const p = E.outExpo(prog(lt, 0.1 + i * 0.08, 0.9 + i * 0.08));
    x.save(); x.rotate(t * (i % 2 ? -0.4 : 0.3));
    x.strokeStyle = `rgba(244,241,234,${0.25 - i * 0.05})`; x.lineWidth = 2;
    x.setLineDash([4 + i * 6, 14 + i * 4]);
    x.beginPath(); x.arc(0, 0, r, 0, Math.PI * 2 * p); x.stroke();
    x.restore();
  });
  x.setLineDash([]);

  // orbiting dots with staggered pulses
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2 + t * 0.6;
    const appear = E.outBack(prog(lt, 0.2 + i * 0.012, 0.6 + i * 0.012));
    const wave = Math.sin(t * 6 - i * 0.5) * 0.5 + 0.5;
    const r = 380 + wave * 24;
    x.fillStyle = i % 3 === 0 ? C.lime : C.ink;
    x.beginPath(); x.arc(Math.cos(a) * r, Math.sin(a) * r, (3 + wave * 5) * appear, 0, Math.PI * 2); x.fill();
  }

  // Hero morphing shape with echo trail
  const intro = E.outElastic(prog(lt, 0.05, 1.1));
  const grow = E.inExpo(prog(t, 6.95, 7.2));
  const size = 190 * intro + grow * 1500;
  const rot = t * 0.5 + E.inOutBack(prog(t, 5.25, 5.65)) * 0.8 + E.inOutBack(prog(t, 6.25, 6.65)) * 0.8;
  for (let e = 4; e >= 0; e--) {
    const te = t - e * 0.035;
    x.save(); x.rotate(t < 7 ? rot - e * 0.06 : rot);
    shapePath(morphAt(te), size * (1 - e * 0.03));
    if (e > 0) { x.strokeStyle = e % 2 ? C.coral : C.violet; x.globalAlpha = 0.5 - e * 0.1; x.lineWidth = 3; x.stroke(); }
    else {
      const g = x.createLinearGradient(-size, -size, size, size);
      const lp = prog(t, 6.9, 7.15);
      g.addColorStop(0, lp > 0 ? C.lime : C.violet); g.addColorStop(1, lp > 0 ? C.lime : C.coral);
      x.globalAlpha = 1; x.fillStyle = g; x.shadowColor = 'rgba(123,92,255,0.6)'; x.shadowBlur = 60 * (1 - grow); x.fill();
      x.shadowBlur = 0;
    }
    x.restore();
  }
  x.globalAlpha = 1;
  x.restore();

  // Easing curve panel
  const pp = E.outExpo(prog(lt, 0.4, 1.0));
  if (pp > 0 && grow < 1) {
    const px = 120, py = H - 120 - 240, s = 240;
    x.save(); x.globalAlpha = pp * (1 - grow); x.translate(-(1 - pp) * 80, 0);
    x.strokeStyle = 'rgba(244,241,234,0.25)'; x.lineWidth = 1; x.strokeRect(px, py, s, s);
    x.strokeStyle = C.lime; x.lineWidth = 3; x.beginPath();
    const n = Math.floor(60 * pp);
    for (let i = 0; i <= n; i++) { const u = i / 60; const yy = py + s - E.inOutBack(u) * s; i ? x.lineTo(px + u * s, yy) : x.moveTo(px, yy); }
    x.stroke();
    const u = ((t - 5.25) % 0.5 + 0.5) % 0.5 / 0.4, uu = clamp(u);
    x.fillStyle = C.ink; x.beginPath(); x.arc(px + uu * s, py + s - E.inOutBack(uu) * s, 7, 0, Math.PI * 2); x.fill();
    x.font = '18px Mono'; x.textAlign = 'left'; x.fillStyle = C.ink;
    x.fillText('cubic-bezier(.68,-.6,.32,1.6)', px, py + s + 34);
    x.fillText(`t = ${uu.toFixed(3)}`, px, py - 16);
    x.restore();
  }
  // Shape name ticker, right side
  const names = ['CIRCLE', 'SQUARE', 'TRIANGLE', 'STAR', 'CIRCLE'];
  const ni = [5.25, 5.75, 6.25, 6.75].filter((k) => t >= k).length;
  x.save(); x.globalAlpha = pp * (1 - grow);
  x.font = '64px Grotesk'; x.textAlign = 'right'; x.fillStyle = C.ink;
  x.fillText(scramble(names[ni], prog(t, [4.6, 5.25, 5.75, 6.25, 6.75][ni], [4.6, 5.25, 5.75, 6.25, 6.75][ni] + 0.25), f, ni), W - 120, H - 150);
  x.font = '18px Mono'; x.fillStyle = C.lime; x.fillText(`MORPH ${ni}/4 · ${NPTS} VERTICES`, W - 120, H - 110);
  x.restore();
}

// 4 · 7.2–9.5  Tile system — ripple, X reveal, flip, collapse
const COLS = 17, ROWS = 9, CELL = 112;
function sceneGrid(t) {
  const lt = t - 7.2;
  x.fillStyle = C.lime; x.fillRect(0, 0, W, H);
  const zoom = 1 + E.inExpo(prog(t, 9.15, 9.5)) * 14;
  x.save(); x.translate(CX, CY); x.scale(zoom, zoom);
  const ox = -(COLS * CELL) / 2, oy = -(ROWS * CELL) / 2;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const u = c - (COLS - 1) / 2, v = r - (ROWS - 1) / 2;
    const d = Math.hypot(u, v);
    const inX = Math.abs(Math.abs(u) - Math.abs(v)) < 0.6;
    const appear = E.outBack(prog(lt, d * 0.035, d * 0.035 + 0.45), 2.2);
    if (appear <= 0) continue;
    const flipT = prog(t, 8.0 + d * 0.03, 8.3 + d * 0.03);
    const flip = Math.cos(E.inOutCubic(flipT) * Math.PI);
    const round = E.inOutCubic(prog(t, 8.55 + (c / COLS) * 0.45, 8.85 + (c / COLS) * 0.45));
    const wave = Math.sin(t * 7 - d * 0.7) * 0.08 * prog(t, 8.3, 8.6);
    const s = (CELL * 0.84) * appear * (1 + wave);
    x.save();
    x.translate(ox + (c + 0.5) * CELL, oy + (r + 0.5) * CELL);
    x.rotate((1 - appear) * Math.PI / 2);
    x.scale(inX ? Math.abs(flip) || 0.001 : 1, 1);
    x.fillStyle = inX && flipT >= 0.5 ? (Math.abs(u) === 0 && Math.abs(v) === 0 ? C.violet : (c + r) % 2 ? C.violet : C.coral) : C.bg;
    const rr = inX ? s / 2 * round : s * 0.12 * round;
    x.beginPath(); x.roundRect(-s / 2, -s / 2, s, s, rr); x.fill();
    x.restore();
  }
  // scanning sweep line
  const sw = prog(t, 8.55, 9.1);
  if (sw > 0 && sw < 1) {
    x.fillStyle = C.ink; x.globalAlpha = 0.9;
    x.fillRect(ox + sw * COLS * CELL - 2, oy - 30, 4, ROWS * CELL + 60);
    x.globalAlpha = 1;
  }
  x.restore();
}

// 5 · 9.5–12.0  X tunnel, rotation snaps, hyperspace ramp
function sceneTunnel(t, f) {
  const lt = t - 9.5;
  x.fillStyle = C.void; x.fillRect(0, 0, W, H);
  const ramp = E.inCubic(prog(t, 11.0, 12.0));

  // streaking stars
  x.save(); x.translate(CX, CY);
  for (const s of STARS) {
    const d = ((s.d + lt * s.sp * (0.25 + ramp * 3)) % 1);
    const r0 = 40 + d * d * 1300, len = 6 + ramp * 400 * d;
    x.strokeStyle = `rgba(244,241,234,${0.15 + d * 0.6})`; x.lineWidth = 1 + d * 2;
    x.beginPath(); x.moveTo(Math.cos(s.a) * r0, Math.sin(s.a) * r0);
    x.lineTo(Math.cos(s.a) * (r0 + len), Math.sin(s.a) * (r0 + len)); x.stroke();
  }

  // tunnel Xs
  const travel = lt * 700 + ramp * ramp * 2600;
  const span = TUNNEL.length * 130;
  const sorted = TUNNEL.map((o) => ({ ...o, zz: ((o.z - travel) % span + span) % span + 60 })).sort((a, b) => b.zz - a.zz);
  for (const o of sorted) {
    const sc = 520 / o.zz;
    if (sc > 12) continue;
    const alpha = clamp(1 - o.zz / span) * clamp((12 - sc) / 4);
    x.globalAlpha = alpha * E.outCubic(prog(lt, 0, 0.4));
    drawX(0, 0, 900 * sc, 70 * sc, o.r + lt * 0.8 + o.zz * 0.002, o.c, o.c, Math.max(1.5, 3 * sc));
  }
  x.globalAlpha = 1;

  // hero X with snaps (X → + → X)
  const snap = E.outBack(prog(t, 10.5, 10.75), 2.5) + E.outBack(prog(t, 11.0, 11.25), 2.5);
  const heroIn = E.outExpo(prog(lt, 0.05, 0.6));
  const beat = pulse(t, [10.0, 10.5, 11.0, 11.5], 10);
  const hs = (480 + beat * 40) * heroIn * (1 + ramp * 0.3);
  x.shadowColor = C.violet; x.shadowBlur = 50 + beat * 40;
  drawX(0, 0, hs, hs * 0.2, snap * Math.PI / 4, t >= 10.5 ? C.lime : C.ink, t >= 11.0 ? C.coral : C.violet);
  x.shadowBlur = 0;
  x.restore();

  // readouts
  x.font = '20px Mono'; x.fillStyle = C.ink; x.textAlign = 'left';
  x.fillText(`Z-VELOCITY  ${(700 + ramp * ramp * 5200).toFixed(0).padStart(5, '0')}`, 120, CY - 10);
  x.fillText(`ROTATION    ${(snap * 45).toFixed(1).padStart(5, '0')}°`, 120, CY + 24);

  // white-out into the finale
  const wo = E.inExpo(prog(t, 11.7, 12.0));
  if (wo > 0) { x.fillStyle = `rgba(244,241,234,${wo})`; x.fillRect(0, 0, W, H); }
}

// 6 · 12.0–15.0  Logo lockup + particle burst
function sceneLogo(t, f) {
  const lt = t - 12.0;
  x.fillStyle = C.bg; x.fillRect(0, 0, W, H);
  const push = 1 + lt * 0.015;
  x.save(); x.translate(CX, CY); x.scale(push, push);

  // shockwaves
  for (let i = 0; i < 3; i++) {
    const p = E.outExpo(prog(lt, i * 0.08, 1.2 + i * 0.08));
    if (p <= 0 || p >= 1) continue;
    x.strokeStyle = [C.lime, C.violet, C.coral][i]; x.globalAlpha = 1 - p; x.lineWidth = 10 * (1 - p) + 1;
    x.beginPath(); x.arc(0, 0, 40 + p * 1100, 0, Math.PI * 2); x.stroke();
  }
  x.globalAlpha = 1;

  // particles with drag
  for (const pt of BURST) {
    const k = 3.2, d = (pt.v / k) * (1 - Math.exp(-k * lt));
    const px = Math.cos(pt.a) * d, py = Math.sin(pt.a) * d + lt * lt * 18;
    const life = clamp(1 - lt / 2.6);
    if (life <= 0) continue;
    x.globalAlpha = life; x.fillStyle = pt.c;
    x.save(); x.translate(px, py); x.rotate(pt.spin * lt);
    if (pt.sq) x.fillRect(-pt.s, -pt.s, pt.s * 2, pt.s * 2);
    else { x.beginPath(); x.arc(0, 0, pt.s, 0, Math.PI * 2); x.fill(); }
    x.restore();
  }
  x.globalAlpha = 1;

  // wordmark: SUPER + X mark
  const fs3 = 230;
  x.font = `${fs3}px InterBlack`;
  const superW = x.measureText('SUPER').width + 4 * 8;
  const markS = 250, gap = 34, total = superW + gap + markS * 0.72;
  const left = -total / 2;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  letters('SUPER', left + superW / 2, 0, `${fs3}px InterBlack`, 8, (ch, lx, i) => {
    const p = E.outExpo(prog(lt, 0.08 + i * 0.045, 0.7 + i * 0.045));
    x.save(); x.globalAlpha = clamp(p * 1.5);
    x.translate(lx, (1 - p) * 140); x.scale(1 + (1 - p) * 0.4, 1 + (1 - p) * 0.4);
    x.fillStyle = C.ink; x.fillText(ch, 0, 10); x.restore();
  });
  const mx = left + superW + gap + markS * 0.36;
  const mp = E.outBack(prog(lt, 0.3, 0.85), 2);
  const bar = markS * clamp(mp, 0, 1.2);
  x.save(); x.translate(mx, 0);
  x.save(); x.rotate(Math.PI / 4 * mp); x.fillStyle = C.lime; x.fillRect(-bar / 2, -24, bar, 48); x.restore();
  x.save(); x.rotate(-Math.PI / 4 * mp); x.globalCompositeOperation = 'screen'; x.fillStyle = C.violet; x.fillRect(-bar / 2, -24, bar, 48); x.restore();
  x.restore();

  // underline + tagline
  const ul = E.inOutExpo(prog(lt, 0.8, 1.4));
  x.fillStyle = C.ink; x.fillRect(left, 150, total * ul, 3);
  x.font = '28px Mono'; x.textAlign = 'left';
  x.fillText(scramble('MOTION DESIGN  ·  SHOWREEL 2026', prog(lt, 0.6, 1.3), f, 7), left, 205);
  x.textAlign = 'right'; x.fillStyle = C.lime;
  x.fillText(scramble('AVAILABLE FOR WORK', prog(lt, 1.0, 1.7), f, 8), left + total, 205);
  x.restore();

  // end fade
  const fo = E.inCubic(prog(t, 14.4, 15.0));
  if (fo > 0) { x.fillStyle = `rgba(0,0,0,${fo})`; x.fillRect(0, 0, W, H); }
}

// ── Global post: shake, chromatic aberration, flashes, HUD, grain ───
const CUTS = [2.0, 4.5, 7.2, 9.5, 12.0];
const LABELS = [[0, '00 / INTRO'], [2.0, '01 / KINETIC TYPE'], [4.5, '02 / SHAPE & EASING'], [7.2, '03 / SYSTEMS'], [9.5, '04 / DEPTH'], [12.0, '05 / IDENTITY']];

function chroma(amt) {
  const off = Math.round(amt);
  if (off < 1) return;
  ax.globalCompositeOperation = 'source-over'; ax.fillStyle = '#000'; ax.fillRect(0, 0, W, H);
  for (const [col, dx] of [['#ff0000', -off], ['#00ff00', 0], ['#0000ff', off]]) {
    tx.globalCompositeOperation = 'source-over'; tx.drawImage(main, 0, 0);
    tx.globalCompositeOperation = 'multiply'; tx.fillStyle = col; tx.fillRect(0, 0, W, H);
    ax.globalCompositeOperation = 'lighter'; ax.drawImage(tmp, dx, 0);
  }
  ax.globalCompositeOperation = 'source-over';
  x.drawImage(acc, 0, 0);
}

function hud(t, f) {
  const a = E.outCubic(prog(t, 1.4, 1.9)) * (1 - prog(t, 14.2, 14.6));
  if (a <= 0) return;
  x.save(); x.globalAlpha = a; x.globalCompositeOperation = 'difference';
  x.strokeStyle = '#fff'; x.fillStyle = '#fff'; x.lineWidth = 2;
  const m = 56, l = 28;
  for (const [cx0, cy0, sx, sy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) {
    x.beginPath(); x.moveTo(cx0, cy0 + sy * l); x.lineTo(cx0, cy0); x.lineTo(cx0 + sx * l, cy0); x.stroke();
  }
  x.font = '16px Mono'; x.textBaseline = 'middle';
  x.textAlign = 'left'; x.fillText('SUPERX ⁄ MOTION', m + 44, m + 4);
  const label = LABELS.filter(([s]) => t >= s).pop()[1];
  x.textAlign = 'right'; x.fillText(label, W - m - 44, m + 4);
  const fr = f % FPS, sec = Math.floor(f / FPS);
  x.textAlign = 'left'; x.fillText(`TC 00:00:${String(sec).padStart(2, '0')}:${String(fr).padStart(2, '0')}`, m + 44, H - m - 4);
  x.textAlign = 'right'; x.fillText('1920×1080 · 60FPS', W - m - 44, H - m - 4);
  // progress bar
  x.globalAlpha = a * 0.5; x.fillRect(m + 44, H - m + 16, (W - 2 * m - 88) * (t / DUR), 2);
  x.restore();
}

function drawFrame(f) {
  const t = f / FPS;
  const impact = pulse(t, [2.0, 12.0], 5);
  const cut = pulse(t, CUTS, 12);
  const beats = t >= 2.5 && t < 11.5 ? pulse(t, [Math.floor(t * 2) / 2], 14) : 0;

  // camera shake
  const sh = impact * 26 + cut * 8 + beats * 3;
  x.save();
  x.translate(Math.sin(f * 1.7) * sh + Math.sin(f * 0.37) * sh * 0.5, Math.cos(f * 1.3) * sh);
  if (sh > 0) { x.translate(CX, CY); x.scale(1 + sh / 900, 1 + sh / 900); x.translate(-CX, -CY); }

  if (t < 2.0) sceneIntro(t, f);
  else if (t < 4.5) sceneType(t, f);
  else if (t < 7.2) sceneShapes(t, f);
  else if (t < 9.5) sceneGrid(t, f);
  else if (t < 12.0) sceneTunnel(t, f);
  else sceneLogo(t, f);
  x.restore();

  chroma(impact * 22 + cut * 10 + beats * 3);

  // impact flash
  const fl = pulse(t, [2.0, 12.0], 9) * 0.9 + pulse(t, [9.5], 10) * 0.7;
  if (fl > 0.01) {
    x.fillStyle = t >= 9.5 && t < 11 ? `rgba(123,92,255,${fl})` : `rgba(244,241,234,${fl})`;
    x.fillRect(0, 0, W, H);
  }

  x.drawImage(vig, 0, 0);
  hud(t, f);

  // grain
  x.save(); x.globalAlpha = 0.07; x.globalCompositeOperation = 'overlay';
  const gt = GRAIN[f % 4], gx = -Math.floor(hash(f, 1) * 256), gy = -Math.floor(hash(f, 2) * 256);
  for (let yy = gy; yy < H; yy += 256) for (let xx = gx; xx < W; xx += 256) x.drawImage(gt, xx, yy);
  x.restore();
}

// ── Main ────────────────────────────────────────────────────────────
const stillsArg = process.argv.indexOf('--stills');
if (stillsArg > 0) {
  const times = process.argv[stillsArg + 1].split(',').map(Number);
  for (const s of times) {
    const f = Math.round(s * FPS); drawFrame(f);
    fs.writeFileSync(path.join(OUT, `still_${s.toFixed(2)}.png`), main.toBuffer('image/png'));
  }
  console.log(`wrote ${times.length} stills`);
} else {
  const wav = path.join(OUT, 'soundtrack.wav'), mp4 = path.join(OUT, 'superx-showreel.mp4');
  console.log('synthesizing audio…'); renderAudio(wav, DUR);
  const ff = spawn(ffmpeg, [
    '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', `${FPS}`, '-i', '-',
    '-i', wav, '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', mp4,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = Date.now();
  for (let f = 0; f < FRAMES; f++) {
    drawFrame(f);
    const buf = Buffer.from(x.getImageData(0, 0, W, H).data.buffer);
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (f % 60 === 0) process.stdout.write(`\rframe ${f}/${FRAMES}`);
  }
  ff.stdin.end();
  await new Promise((r, j) => ff.on('close', (c) => (c ? j(new Error('ffmpeg exit ' + c)) : r())));
  console.log(`\rrendered ${FRAMES} frames in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${mp4}`);
}
