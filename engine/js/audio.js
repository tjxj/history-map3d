/* 三维考据地图引擎 · 程序化声音
 * 全部声音由 Web Audio 实时合成，无外部音频文件：
 * 环境：朔风（布朗噪声 + 低频调制）、持续低音、古琴（Karplus-Strong 拨弦）
 * 效果：战鼓、号角、马蹄、金铁交鸣、箭雨、喊杀、编钟、埙、风沙、流水 */
window.AUDIO = (function () {
  'use strict';
  let ctx = null, master, comp, musicBus, ambBus, sfxBus, rev, enabled = false, started = false;
  let brown, white, hoofLoop = null, clangs = [], whooshes = [];
  let amb = null, qinTimer = 0, sceneBus = null;
  let moodName = 'dusk';
  const KS = {};

  const MOODS = {
    dusk:   { root: 73.42, wind: 0.20, drone: 0.050, gap: [5, 9],  bright: 520 },
    dawn:   { root: 82.41, wind: 0.16, drone: 0.045, gap: [4, 8],  bright: 640 },
    spring: { root: 87.31, wind: 0.12, drone: 0.040, gap: [3, 7],  bright: 760 },
    summer: { root: 77.78, wind: 0.14, drone: 0.050, gap: [4, 8],  bright: 700 },
    autumn: { root: 69.30, wind: 0.20, drone: 0.055, gap: [5, 9],  bright: 520 },
    steppe: { root: 65.41, wind: 0.24, drone: 0.055, gap: [5, 10], bright: 480 },
    night:  { root: 55.00, wind: 0.10, drone: 0.060, gap: [6, 11], bright: 380 },
    rain:    { root: 61.74, wind: 0.22, drone: 0.050, gap: [6, 11], bright: 420 },
    snow:    { root: 58.27, wind: 0.26, drone: 0.045, gap: [6, 12], bright: 460 },
    moon:    { root: 55.00, wind: 0.08, drone: 0.055, gap: [5, 10], bright: 420 },
    mist:    { root: 65.41, wind: 0.10, drone: 0.045, gap: [5, 10], bright: 500 },
    blossom: { root: 87.31, wind: 0.10, drone: 0.040, gap: [3, 7],  bright: 780 },
  };
  const YU = [0, 3, 5, 7, 10]; // 羽调式五声

  /* ---------- 基础 ---------- */
  function now() { return ctx ? ctx.currentTime : 0; }
  function G(v) { const g = ctx.createGain(); g.gain.value = v; return g; }
  function F(type, f, q) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q != null) b.Q.value = q; return b; }
  function O(type, f) { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; return o; }
  function S(buf, loop) { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = !!loop; return s; }
  function out() { return sceneBus || sfxBus; }
  function chain() { for (let i = 0; i < arguments.length - 1; i++) arguments[i].connect(arguments[i + 1]); return arguments[arguments.length - 1]; }
  function env(g, t, a, peak, d, sustain) {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    if (sustain) g.gain.setValueAtTime(peak, t + a + sustain);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + (sustain || 0) + d);
  }
  function noiseBuf(sec, kind) {
    const n = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c); let last = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; } else d[i] = w;
      }
    }
    return b;
  }
  function impulse(sec, decay) {
    const n = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) { const t = i / n; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (t < 0.01 ? t * 100 : 1); }
    }
    return b;
  }
  /* 离线渲染的采样：马蹄循环、金铁、箭啸 */
  function synthBuffer(sec, fn) {
    const sr = ctx.sampleRate, n = Math.floor(sr * sec), b = ctx.createBuffer(2, n, sr);
    const L = b.getChannelData(0), R = b.getChannelData(1);
    fn(L, R, sr, n);
    return b;
  }
  function buildSamples() {
    // 马蹄：六匹马、每匹三连蹄，周期 0.42 秒，叠成 2.52 秒循环
    hoofLoop = synthBuffer(2.52, (L, R, sr, n) => {
      for (let h = 0; h < 7; h++) {
        const period = 0.42, off = Math.random() * period, pan = Math.random();
        for (let k = 0; k < 6; k++) {
          for (let j = 0; j < 3; j++) {
            const t0 = off + k * period + j * (0.075 + Math.random() * 0.02);
            const amp = (j === 0 ? 0.9 : 0.6) * (0.6 + Math.random() * 0.4);
            const s0 = Math.floor((t0 % 2.52) * sr), len = Math.floor(0.09 * sr);
            let lp = 0; const f = 55 + Math.random() * 40;
            for (let i = 0; i < len; i++) {
              const idx = (s0 + i) % n, tt = i / sr;
              lp += 0.18 * ((Math.random() * 2 - 1) - lp);
              const v = amp * (lp * 1.6 * Math.exp(-tt * 55) + Math.sin(2 * Math.PI * f * tt) * Math.exp(-tt * 38) * 0.9);
              L[idx] += v * (1 - pan * 0.6); R[idx] += v * (0.4 + pan * 0.6);
            }
          }
        }
      }
      for (let i = 0; i < n; i++) { L[i] *= 0.22; R[i] *= 0.22; }
    });
    // 金铁交鸣：非谐泛音
    clangs = [];
    for (let v = 0; v < 6; v++) {
      const base = 700 + Math.random() * 900, ratios = [1, 1.47, 2.09, 2.76, 3.9, 5.3];
      clangs.push(synthBuffer(0.9, (L, R, sr, n) => {
        const pan = Math.random();
        ratios.forEach((r, k) => {
          const f = base * r * (1 + (Math.random() - 0.5) * 0.02), dec = 5 + k * 3 + Math.random() * 4, a = 0.32 / (1 + k * 0.55);
          for (let i = 0; i < n; i++) { const t = i / sr, s = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * dec) * a; L[i] += s * (1 - pan * 0.5); R[i] += s * (0.5 + pan * 0.5); }
        });
        for (let i = 0; i < 600; i++) { const s = (Math.random() * 2 - 1) * 0.5 * (1 - i / 600); L[i] += s; R[i] += s; }
      }));
    }
    // 箭啸：滤波噪声 + 下滑哨音
    whooshes = [];
    for (let v = 0; v < 4; v++) {
      whooshes.push(synthBuffer(0.7, (L, R, sr, n) => {
        let lp = 0, ph = 0; const f0 = 2400 + Math.random() * 1600, pan = Math.random();
        for (let i = 0; i < n; i++) {
          const t = i / n, a = Math.sin(Math.PI * Math.min(1, t * 1.25)) ** 2;
          const k = 0.04 + 0.4 * (1 - t);
          lp += k * ((Math.random() * 2 - 1) - lp);
          ph += 2 * Math.PI * (f0 * (1 - 0.55 * t)) / sr;
          const s = (lp * 0.7 + Math.sin(ph) * 0.08) * a;
          L[i] = s * (1 - pan * 0.7); R[i] = s * (0.3 + pan * 0.7);
        }
      }));
    }
  }
  function ksBuffer(freq, dur) {
    const key = Math.round(freq * 10);
    if (KS[key]) return KS[key];
    const sr = ctx.sampleRate, n = Math.floor(sr * (dur || 3.6)), b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
    const N = Math.max(2, Math.round(sr / freq)), line = new Float32Array(N);
    for (let i = 0; i < N; i++) line[i] = Math.random() * 2 - 1;
    for (let p = 0; p < 3; p++) for (let i = 1; i < N; i++) line[i] = 0.5 * (line[i] + line[i - 1]);
    const decay = Math.pow(10, -3 / (3.2 * freq));
    let idx = 0;
    for (let i = 0; i < n; i++) {
      const cur = line[idx], nx = line[(idx + 1) % N];
      line[idx] = decay * (0.5 * cur + 0.5 * nx);
      d[i] = cur * (i < 40 ? i / 40 : 1);
      idx = (idx + 1) % N;
    }
    KS[key] = b; return b;
  }

  /* ---------- 初始化 ---------- */
  function init() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = G(0);
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 14; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.3;
    chain(master, comp, ctx.destination);
    rev = ctx.createConvolver(); rev.buffer = impulse(3.4, 2.4);
    const revOut = G(0.5); chain(rev, revOut, master);
    musicBus = G(0.6); musicBus.connect(master); const ms = G(0.75); chain(musicBus, ms, rev);
    ambBus = G(0.55); ambBus.connect(master); const as = G(0.2); chain(ambBus, as, rev);
    sfxBus = G(0.95); sfxBus.connect(master); const ss = G(0.3); chain(sfxBus, ss, rev);
    brown = noiseBuf(5, 'brown'); white = noiseBuf(2, 'white');
    buildSamples();
    return true;
  }

  /* ---------- 环境声 ---------- */
  function startAmbient() {
    if (amb) return;
    const t = now();
    const src = S(brown, true), bp = F('bandpass', 420, 0.55), wg = G(0);
    const lfo = O('sine', 0.055), lfoG = G(240); chain(lfo, lfoG, bp.frequency);
    const lfo2 = O('sine', 0.13), lfo2G = G(0.06); chain(lfo2, lfo2G, wg.gain);
    chain(src, bp, wg, ambBus);
    // 第二层高频风声
    const src2 = S(white, true), hp = F('bandpass', 2200, 0.8), wg2 = G(0);
    const lfo3 = O('sine', 0.09), lfo3G = G(900); chain(lfo3, lfo3G, hp.frequency);
    chain(src2, hp, wg2, ambBus);
    // 持续低音
    const dg = G(0), lp = F('lowpass', 520, 0.5);
    const o1 = O('sine', 73.42), o2 = O('triangle', 110.1), o3 = O('sawtooth', 146.9), g3 = G(0.12), o4 = O('sine', 36.7), g4 = G(0.6);
    o1.connect(lp); o2.connect(lp); chain(o3, g3, lp); chain(o4, g4, lp); chain(lp, dg, musicBus);
    const trem = O('sine', 0.11), tremG = G(0.014); chain(trem, tremG, dg.gain);
    [src, src2, lfo, lfo2, lfo3, o1, o2, o3, o4, trem].forEach(n => n.start(t));
    amb = { wg, wg2, dg, lp, o1, o2, o3, o4 };
    mood(moodName, true);
    scheduleQin(2.5);
  }
  function mood(name, instant) {
    moodName = name || moodName;
    if (!ctx || !amb) return;
    const m = MOODS[moodName] || MOODS.dusk, t = now(), k = instant ? 0.5 : 4;
    amb.wg.gain.setTargetAtTime(m.wind, t, k);
    amb.wg2.gain.setTargetAtTime(m.wind * 0.12, t, k);
    amb.dg.gain.setTargetAtTime(m.drone, t, k);
    amb.lp.frequency.setTargetAtTime(m.bright, t, k);
    amb.o1.frequency.setTargetAtTime(m.root, t, k);
    amb.o2.frequency.setTargetAtTime(m.root * 1.5, t, k);
    amb.o3.frequency.setTargetAtTime(m.root * 2.003, t, k);
    amb.o4.frequency.setTargetAtTime(m.root / 2, t, k);
  }
  function scheduleQin(delay) {
    clearTimeout(qinTimer);
    qinTimer = setTimeout(() => {
      if (enabled && !document.hidden) qinPhrase(now() + 0.05, 0.8);
      const m = MOODS[moodName] || MOODS.dusk;
      scheduleQin(m.gap[0] + Math.random() * (m.gap[1] - m.gap[0]));
    }, (delay || 6) * 1000);
  }
  function qinNote(t, f, vol, dest) {
    const s = S(ksBuffer(f)), g = G(vol), body = F('peaking', 240, 1.2), lp = F('lowpass', 3200, 0.5);
    body.gain.value = 5; s.playbackRate.value = 1 + (Math.random() - 0.5) * 0.004;
    chain(s, body, lp, g, dest || musicBus);
    s.start(t); s.stop(t + 3.6);
  }
  function qinPhrase(t, vol) {
    const m = MOODS[moodName] || MOODS.dusk, base = m.root * 4;
    const n = 2 + Math.floor(Math.random() * 3);
    let deg = Math.floor(Math.random() * 7), tt = t;
    for (let i = 0; i < n; i++) {
      const oct = Math.floor(deg / 5), st = YU[((deg % 5) + 5) % 5] + 12 * oct;
      qinNote(tt, base * Math.pow(2, st / 12), (vol || 1) * (0.42 - i * 0.04));
      if (Math.random() < 0.35) qinNote(tt + 0.02, base * Math.pow(2, (st - 12) / 12), (vol || 1) * 0.16);
      tt += 0.32 + Math.random() * 0.6;
      deg += Math.random() < 0.6 ? -1 : (Math.random() < 0.5 ? 1 : -2);
      if (deg < 0) deg = 2;
    }
  }

  /* ---------- 音效 ---------- */
  const FXS = {
    drum(t, vol) {
      vol = vol || 1;
      const o = O('sine', 118), g = G(0);
      o.frequency.setValueAtTime(118, t); o.frequency.exponentialRampToValueAtTime(44, t + 0.45);
      env(g, t, 0.004, 0.95 * vol, 1.1); chain(o, g, out()); o.start(t); o.stop(t + 1.4);
      const o2 = O('sine', 62), g2 = G(0); env(g2, t, 0.01, 0.6 * vol, 1.6); chain(o2, g2, out()); o2.start(t); o2.stop(t + 1.8);
      const n = S(white), lp = F('lowpass', 1100, 0.7), ng = G(0); env(ng, t, 0.001, 0.55 * vol, 0.14);
      chain(n, lp, ng, out()); n.start(t, Math.random()); n.stop(t + 0.3);
    },
    drums(t) {
      const p = [0, 0.62, 1.1, 1.45, 1.75, 2.0, 2.2, 2.38, 2.54, 2.7, 3.1];
      p.forEach((x, i) => FXS.drum(t + x, 0.55 + i * 0.05 + (i === p.length - 1 ? 0.3 : 0)));
    },
    horn(t, dur) {
      dur = dur || 3.4;
      const f = 98, g = G(0), lp = F('lowpass', 260, 2.2);
      lp.frequency.setValueAtTime(240, t); lp.frequency.linearRampToValueAtTime(1350, t + 0.9); lp.frequency.linearRampToValueAtTime(760, t + dur);
      const vib = O('sine', 5.1), vg = G(1.4); vib.connect(vg);
      const mk = (ff, type, start, end, lvl) => {
        const o = O(type, ff * 0.93); o.frequency.setValueAtTime(ff * 0.93, t + start); o.frequency.exponentialRampToValueAtTime(ff, t + start + 0.35);
        vg.connect(o.frequency); const og = G(0);
        og.gain.setValueAtTime(0.0001, t + start); og.gain.linearRampToValueAtTime(lvl, t + start + 0.45);
        og.gain.setValueAtTime(lvl, t + end - 0.9); og.gain.exponentialRampToValueAtTime(0.0001, t + end);
        chain(o, og, lp); o.start(t + start); o.stop(t + end + 0.1);
      };
      mk(f, 'sawtooth', 0, dur, 0.34); mk(f * 1.004, 'sawtooth', 0, dur, 0.22); mk(f * 1.5, 'sawtooth', 0.85, dur - 0.2, 0.2); mk(f / 2, 'triangle', 0, dur, 0.25);
      g.gain.value = 0.55; chain(lp, g, out()); vib.start(t); vib.stop(t + dur + 0.2);
      const n = S(white), bp = F('bandpass', 1300, 3), ng = G(0); env(ng, t, 0.3, 0.05, dur - 0.3);
      chain(n, bp, ng, out()); n.start(t); n.stop(t + dur);
    },
    gallop(t, dur) {
      dur = dur || 4; if (!hoofLoop) return;
      const s = S(hoofLoop, true), g = G(0), lp = F('lowpass', 1800, 0.5);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.9, t + 0.6);
      g.gain.setValueAtTime(0.9, t + Math.max(0.7, dur - 0.8)); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.4);
      s.playbackRate.value = 1.05; chain(s, lp, g, out()); s.start(t, Math.random() * 2); s.stop(t + dur + 0.5);
      const r = S(brown, true), rl = F('lowpass', 140, 0.7), rg = G(0); env(rg, t, 0.8, 0.45, dur, 0.1);
      chain(r, rl, rg, out()); r.start(t); r.stop(t + dur + 1.2);
    },
    clash(t, dur) {
      dur = dur || 4.5; if (!clangs.length) return;
      const n = Math.round(dur * 7);
      for (let i = 0; i < n; i++) {
        const tt = t + Math.pow(Math.random(), 1.3) * dur, s = S(clangs[i % clangs.length]), g = G(0.12 + Math.random() * 0.22);
        s.playbackRate.value = 0.75 + Math.random() * 0.6; chain(s, g, out()); s.start(tt); s.stop(tt + 1);
      }
      const b = S(brown, true), bp = F('bandpass', 380, 0.8), bg = G(0); env(bg, t, 0.4, 0.5, dur, 0.2);
      chain(b, bp, bg, out()); b.start(t); b.stop(t + dur + 1);
    },
    arrows(t) {
      if (!whooshes.length) return;
      for (let i = 0; i < 18; i++) {
        const tt = t + Math.random() * 1.6, s = S(whooshes[i % whooshes.length]), g = G(0.22 + Math.random() * 0.2);
        s.playbackRate.value = 0.8 + Math.random() * 0.5; chain(s, g, out()); s.start(tt); s.stop(tt + 0.8);
        if (Math.random() < 0.6) { const th = S(white), lp = F('lowpass', 600), tg = G(0); env(tg, tt + 0.55, 0.002, 0.2, 0.08); chain(th, lp, tg, out()); th.start(tt + 0.55, Math.random()); th.stop(tt + 0.7); }
      }
    },
    roar(t, dur) {
      dur = dur || 4;
      const b = S(brown, true), f1 = F('bandpass', 560, 1.4), f2 = F('bandpass', 1150, 2.2), g = G(0), m = G(1);
      b.connect(f1); b.connect(f2); f1.connect(m); f2.connect(m);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.9, t + 1.1); g.gain.setValueAtTime(0.9, t + dur * 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      chain(m, g, out()); b.start(t, Math.random() * 3); b.stop(t + dur + 0.2);
      const vg = G(0), vf = F('bandpass', 720, 3.5), vf2 = F('bandpass', 1250, 5);
      vg.gain.setValueAtTime(0.0001, t); vg.gain.linearRampToValueAtTime(0.05, t + 1); vg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      vf.connect(vg); vf2.connect(vg); vg.connect(out());
      for (let i = 0; i < 10; i++) {
        const f = 130 + Math.random() * 110, o = O('sawtooth', f);
        o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * (1.08 + Math.random() * 0.1), t + 1.4);
        o.connect(i % 2 ? vf : vf2); o.start(t + Math.random() * 0.3); o.stop(t + dur);
      }
    },
    sting(t) {
      [55, 58.27, 61.74, 110].forEach((f, i) => {
        const o = O(i === 3 ? 'triangle' : 'sawtooth', f), g = G(0), lp = F('lowpass', 420, 1);
        env(g, t, 0.25, i === 3 ? 0.1 : 0.16, 3.8); chain(o, lp, g, out()); o.start(t); o.stop(t + 4.2);
      });
      const s = O('sine', 42), sg = G(0); env(sg, t, 0.01, 0.8, 2.2); chain(s, sg, out()); s.start(t); s.stop(t + 2.5);
      const n = S(white), hp = F('highpass', 3500), ng = G(0);
      ng.gain.setValueAtTime(0.0001, t - 0.9); ng.gain.exponentialRampToValueAtTime(0.12, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      chain(n, hp, ng, out()); n.start(Math.max(now(), t - 0.9)); n.stop(t + 0.2);
    },
    bell(t) {
      const f0 = 196, parts = [[0.5, 0.35, 6], [1, 1, 5], [1.006, 0.5, 5], [2.76, 0.45, 2.6], [5.4, 0.22, 1.4], [8.93, 0.12, 0.8]];
      parts.forEach(([r, a, d]) => { const o = O('sine', f0 * r), g = G(0); env(g, t, 0.003, a * 0.3, d); chain(o, g, out()); o.start(t); o.stop(t + d + 0.1); });
      const n = S(white), bp = F('bandpass', 2400, 1.5), ng = G(0); env(ng, t, 0.001, 0.2, 0.05); chain(n, bp, ng, out()); n.start(t); n.stop(t + 0.1);
    },
    qin(t) { qinPhrase(t, 1.2); },
    xun(t) {
      const notes = [293.66, 261.63, 220.0, 196.0, 220.0];
      const pick = Math.random() < 0.5 ? [0, 2, 3] : [1, 2, 4];
      pick.forEach((k, i) => {
        const tt = t + i * 1.15, f = notes[k], d = i === 2 ? 2.4 : 1.25;
        const o = O('sine', f), o2 = O('triangle', f * 2), g = G(0), g2 = G(0.05);
        const vib = O('sine', 4.6), vg = G(f * 0.006); chain(vib, vg, o.frequency);
        g.gain.setValueAtTime(0.0001, tt); g.gain.linearRampToValueAtTime(0.16, tt + 0.28); g.gain.setValueAtTime(0.16, tt + d - 0.3); g.gain.exponentialRampToValueAtTime(0.0001, tt + d + 0.2);
        o.connect(g); chain(o2, g2, g); g.connect(musicBus);
        const n = S(white), bp = F('bandpass', f * 2, 6), ng = G(0); env(ng, tt, 0.25, 0.05, d);
        chain(n, bp, ng, musicBus);
        [o, o2, vib].forEach(x => { x.start(tt); x.stop(tt + d + 0.3); }); n.start(tt); n.stop(tt + d + 0.3);
      });
    },
    wind(t, dur) {
      dur = dur || 5;
      const b = S(brown, true), bp = F('bandpass', 300, 0.7), g = G(0);
      bp.frequency.setValueAtTime(260, t); bp.frequency.linearRampToValueAtTime(900, t + dur * 0.45); bp.frequency.linearRampToValueAtTime(380, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.75, t + dur * 0.4); g.gain.linearRampToValueAtTime(0.0001, t + dur);
      chain(b, bp, g, out()); b.start(t, Math.random() * 3); b.stop(t + dur + 0.1);
    },
    storm(t, dur) {
      dur = dur || 7;
      const b = S(brown, true), bp = F('bandpass', 500, 0.5), g = G(0), lfo = O('sine', 0.7), lg = G(300);
      chain(lfo, lg, bp.frequency);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(1.1, t + 1.2); g.gain.setValueAtTime(1.1, t + dur - 1.5); g.gain.linearRampToValueAtTime(0.0001, t + dur);
      chain(b, bp, g, out()); b.start(t); b.stop(t + dur + 0.1); lfo.start(t); lfo.stop(t + dur);
      const s = S(white, true), hp = F('highpass', 4200, 0.6), sg = G(0);
      sg.gain.setValueAtTime(0.0001, t); sg.gain.linearRampToValueAtTime(0.09, t + 1.5); sg.gain.linearRampToValueAtTime(0.0001, t + dur);
      chain(s, hp, sg, out()); s.start(t); s.stop(t + dur + 0.1);
      const r = S(brown, true), rl = F('lowpass', 110), rg = G(0); env(rg, t, 1.4, 0.9, dur - 1.4);
      chain(r, rl, rg, out()); r.start(t, 1); r.stop(t + dur + 0.2);
    },
    water(t, dur) {
      dur = dur || 4.5;
      const n = S(white, true), lp = F('lowpass', 1200, 0.5), bp = F('bandpass', 600, 0.9), g = G(0);
      env(g, t, 0.8, 0.22, dur - 0.8, 0.2); chain(n, lp, bp, g, out()); n.start(t); n.stop(t + dur + 0.5);
      for (let i = 0; i < 16; i++) {
        const tt = t + 0.3 + Math.random() * (dur - 0.6), f = 380 + Math.random() * 700, o = O('sine', f), og = G(0);
        o.frequency.setValueAtTime(f, tt); o.frequency.exponentialRampToValueAtTime(f * 1.9, tt + 0.05);
        env(og, tt, 0.003, 0.05, 0.06); chain(o, og, out()); o.start(tt); o.stop(tt + 0.1);
      }
    },
    whoosh(t) {
      const n = S(white), bp = F('bandpass', 400, 1.2), g = G(0);
      bp.frequency.setValueAtTime(380, t); bp.frequency.exponentialRampToValueAtTime(2600, t + 0.35); bp.frequency.exponentialRampToValueAtTime(500, t + 0.8);
      env(g, t, 0.25, 0.16, 0.55); chain(n, bp, g, sfxBus); n.start(t, Math.random()); n.stop(t + 0.9);
    },
    tick(t) {
      const o = O('sine', 1800), g = G(0); env(g, t, 0.001, 0.05, 0.05); chain(o, g, sfxBus); o.start(t); o.stop(t + 0.08);
    },
  };

  function play(name, delay) {
    if (!enabled || !ctx) return;
    const [k, arg] = String(name).split(':');
    const fn = FXS[k]; if (!fn) return;
    try { fn(now() + (delay || 0) + 0.02, arg ? parseFloat(arg) : undefined); } catch (e) { /* 忽略单个音效错误 */ }
  }
  function beginScene() {
    if (!ctx) return;
    endScene(0.3);
    sceneBus = G(1); sceneBus.connect(sfxBus);
    musicBus.gain.setTargetAtTime(0.32, now(), 0.6);
    ambBus.gain.setTargetAtTime(0.35, now(), 0.6);
  }
  function endScene(fade) {
    if (!ctx) return;
    if (sceneBus) {
      const b = sceneBus, t = now(); sceneBus = null;
      b.gain.setTargetAtTime(0.0001, t, (fade || 0.6) / 3);
      setTimeout(() => { try { b.disconnect(); } catch (e) {} }, (fade || 0.6) * 1000 + 400);
    }
    musicBus.gain.setTargetAtTime(0.6, now(), 1.2);
    ambBus.gain.setTargetAtTime(0.55, now(), 1.2);
  }
  function setEnabled(on) {
    if (on) {
      if (!init()) return false;
      enabled = true;
      if (ctx.state === 'suspended') ctx.resume();
      if (!started) { started = true; startAmbient(); }
      master.gain.cancelScheduledValues(now());
      master.gain.setTargetAtTime(0.9, now(), 0.4);
    } else if (ctx) {
      enabled = false;
      master.gain.setTargetAtTime(0.0001, now(), 0.15);
    }
    return enabled;
  }
  document.addEventListener('visibilitychange', () => {
    if (!ctx || !enabled) return;
    if (document.hidden) master.gain.setTargetAtTime(0.0001, now(), 0.2);
    else master.gain.setTargetAtTime(0.9, now(), 0.4);
  });

  return {
    setEnabled, play, mood, beginScene, endScene,
    get enabled() { return enabled; },
    time: now,
  };
})();
