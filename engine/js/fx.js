/* 三维考据地图引擎 · 演出特效层
 * 在地图之上的 2D 画布里重演场景：兵力符号、箭雨、交锋、合围、光柱、人物行进、小舟、天气粒子。
 * 战场坐标以「东 / 北 公里」表示，经四角投影求单应矩阵映射到屏幕，随镜头俯仰与旋转实时变形。 */
window.FX = (function () {
  'use strict';
  let cv, g, map, W = 0, H = 0, dpr = 1;
  const RGB = {
    han: [255, 82, 48], xn: [130, 190, 255], sur: [205, 168, 255], gold: [255, 214, 110],
    white: [255, 244, 222], water: [110, 210, 255], earth: [222, 166, 104], steel: [178, 204, 230],
  };
  // 题材自定义颜色：SITE.sides = { tang: '#d0523a', li: '#ffd66e' }，演出里的 side 写这些键
  const hexToRgb = h => { h = String(h).replace('#', ''); if (h.length === 3) h = h.replace(/./g, '$&$&'); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  // 势力键（SITE.factions[].k）自动可用作演出颜色，取 glow 或 c
  if (window.SITE && SITE.factions) SITE.factions.forEach(f => { if (f && f.k && !RGB[f.k] && (f.glow || f.c)) RGB[f.k] = hexToRgb(f.glow || f.c); });
  if (window.SITE && SITE.sides) Object.keys(SITE.sides).forEach(k => { const v = SITE.sides[k], c = v && v.c ? v.c : v; RGB[k] = Array.isArray(c) ? c : hexToRgb(c); });
  // 第一个势力算「我方」，其余算「对方」：决定混战默认伤亡、投降变色、溃逃虚线的颜色（范例里是 han / xn）
  const FK = ((window.SITE && SITE.factions) || []).map(f => f && f.k).filter(k => k && RGB[k]);
  const US = FK[0] || 'han', FOE = FK[1] || 'xn';
  const lossOf = s => s === US ? 0.07 : (s === FOE || FK.indexOf(s) > 0) ? 0.3 : 0;
  const FONT = '"SHS","Source Han Serif SC","Songti SC",serif';
  const sprites = {};
  let show = null;          // 当前战役 / 巡游演出
  let pings = [];           // 地图上的波纹提示
  let dust = [];            // 行军扬尘（屏幕空间）
  let wx = { kind: null, on: true, parts: [], lastKind: null, force: null };
  let lastT = performance.now();

  /* ---------- 工具 ---------- */
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = t => t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t);
  const easeIn = t => { t = clamp(t, 0, 1); return t * t; };
  function rng(seed) { let a = seed >>> 0; return function () { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function rgba(c, a) { return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }
  function mix(c1, c2, t) { return [lerp(c1[0], c2[0], t) | 0, lerp(c1[1], c2[1], t) | 0, lerp(c1[2], c2[2], t) | 0]; }
  function sprite(c) {
    const key = c.join(',');
    if (sprites[key]) return sprites[key];
    const s = document.createElement('canvas'); s.width = s.height = 64;
    const x = s.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, rgba(c, 1)); gr.addColorStop(0.18, rgba(c, 0.6)); gr.addColorStop(0.5, rgba(c, 0.14)); gr.addColorStop(1, rgba(c, 0));
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    return (sprites[key] = s);
  }
  function glow(x, y, c, r, a) { if (a <= 0.01) return; g.globalAlpha = a; g.drawImage(sprite(c), x - r, y - r, r * 2, r * 2); }
  function kmToLL(c, x, y) { return [c[0] + x / (111.32 * Math.cos(c[1] * Math.PI / 180)), c[1] + y / 110.574]; }

  /* ---------- 单应矩阵 ---------- */
  function solve8(A, b) {
    const n = 8, M = A.map((r, i) => r.concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-12) return null;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
    }
    return M.map((r, i) => r[n] / r[i]);
  }
  function homography(src, dst) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i], [u, v] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    return solve8(A, b);
  }
  function makeFrame(center, S) {
    const src = [[-S, -S], [S, -S], [S, S], [-S, S]];
    const dst = src.map(([x, y]) => { const p = map.project(kmToLL(center, x, y)); return [p.x, p.y]; });
    const h = homography(src, dst);
    if (!h) return null;
    const P = (x, y) => { const w = h[6] * x + h[7] * y + 1; return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w]; };
    const o = P(0, 0), ex = P(1, 0), ny = P(0, 1);
    const ppk = (Math.hypot(ex[0] - o[0], ex[1] - o[1]) + Math.hypot(ny[0] - o[0], ny[1] - o[1])) / 2;
    return { P, ppk };
  }
  // 在 at 处取局部仿射，用于画投影后的圆
  function localEllipse(F, at, rKm, fn) {
    const o = F.P(at[0], at[1]), ex = F.P(at[0] + 1, at[1]), ny = F.P(at[0], at[1] + 1);
    g.save();
    g.setTransform(dpr * (ex[0] - o[0]), dpr * (ex[1] - o[1]), dpr * (ny[0] - o[0]), dpr * (ny[1] - o[1]), dpr * o[0], dpr * o[1]);
    fn(rKm);
    g.restore();
  }

  /* ---------- 演出准备 ---------- */
  function formation(u, rnd) {
    const n = u.n, out = [];
    for (let i = 0; i < n; i++) {
      let f = 0, r = 0, km = false;
      switch (u.shape) {
        case 'wedge': { const row = Math.floor(Math.sqrt(i)), col = i - row * row - row; f = -row * 1.05 + (rnd() - 0.5) * 0.35; r = col * 0.95 + (rnd() - 0.5) * 0.35; break; }
        case 'line': {
          // 分队横列：每队 3 排 × 4 列，队与队之间留出空当，远看仍是一字横阵
          const per = 12, sq = Math.ceil(n / per), qi = Math.floor(i / per), j = i % per, row = j % 3, col = Math.floor(j / 3);
          f = -row * 0.85 + (rnd() - 0.5) * 0.3;
          r = (qi - (sq - 1) / 2) * 4.6 + (col - 1.5) * 0.82 + (rnd() - 0.5) * 0.25;
          break;
        }
        case 'blob': { const a = rnd() * 6.2832, rr = Math.sqrt(rnd()) * Math.sqrt(n) * 0.6; f = Math.cos(a) * rr; r = Math.sin(a) * rr; break; }
        case 'camp': {
          const k = Math.max(3, Math.round(n / 15)), ci = i % k, ca = ci * 2.39996, cr = Math.sqrt((ci + 0.5) / k) * Math.sqrt(n) * 0.62;
          const a = rnd() * 6.2832, rr = Math.sqrt(rnd()) * 1.7;
          f = Math.cos(ca) * cr + Math.cos(a) * rr; r = Math.sin(ca) * cr + Math.sin(a) * rr; break;
        }
        case 'ring': {
          km = true; const R = u.r || 5;
          if (u.square) {
            const per = (i / n) * 4, side = Math.floor(per) % 4, q = per - Math.floor(per);
            const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]], a = pts[side], b = pts[side + 1];
            f = (a[0] + (b[0] - a[0]) * q) * R; r = (a[1] + (b[1] - a[1]) * q) * R;
          } else { const a = (i / n) * 6.2832 + (rnd() - 0.5) * 0.06, rr = R * (1 + (rnd() - 0.5) * 0.14); f = Math.cos(a) * rr; r = Math.sin(a) * rr; }
          break;
        }
        default: break;
      }
      out.push({ f, r, km });
    }
    return out;
  }
  function prep(def, center, opts) {
    const fx = def.fx || [];
    const clashes = fx.filter(f => f.k === 'clash');
    const cl0 = clashes.length ? Math.min(...clashes.map(c => c.t0)) : null;
    const cl1 = clashes.length ? Math.max(...clashes.map(c => c.t1)) : null;
    const groups = (def.units || []).map((u, gi) => {
      const rnd = rng(gi * 7919 + 101);
      const d = [u.to[0] - u.from[0], u.to[1] - u.from[1]], dl = Math.hypot(d[0], d[1]);
      let dir = dl > 0.01 ? [d[0] / dl, d[1] / dl] : null;
      if (!dir && u.flee) { const fd = [u.flee[0] - u.from[0], u.flee[1] - u.from[1]], fl = Math.hypot(fd[0], fd[1]); dir = [fd[0] / fl, fd[1] / fl]; }
      if (!dir) dir = [1, 0];
      const G = { u, dir, side: u.side, members: [] };
      if (u.melee) {
        G.m0 = u.t1 > u.t0 ? Math.max(u.t1 - 0.2, cl0 != null ? Math.min(cl0, u.t1) : u.t1) : (cl0 != null ? cl0 : 0);
        G.m1 = u.flee ? u.f0 : Math.max(G.m0 + u.melee, cl1 != null ? cl1 : 0);
        G.amp = clamp(u.melee / 6, 0.3, 1.4);
        // 交锋中心：离到达点最近的 clash
        let best = null, bd = 1e9;
        clashes.forEach(c => { const dd = Math.hypot(c.at[0] - u.to[0], c.at[1] - u.to[1]); if (dd < bd) { bd = dd; best = c.at; } });
        G.pull = best;
      }
      if (u.chase) G.chaseTargets = clashes.filter(c => c.t0 >= u.c0 - 1.5 && c.t0 <= u.c1).map(c => c.at);
      const dieFrac = u.die != null ? u.die : u.cut ? 0.72 : (u.melee ? lossOf(u.side) : 0);
      formation(u, rnd).forEach((m, i) => {
        m.ph = rnd() * 6.2832; m.sp = 0.7 + rnd() * 0.9; m.j = rnd(); m.i = i;
        m.dieAt = Infinity;
        if (rnd() < dieFrac) {
          if (u.cut && u.flee) m.dieAt = u.f0 + 0.6 + rnd() * (u.f1 - u.f0) * 0.75;
          else if (G.m0 != null) m.dieAt = G.m0 + 0.6 + rnd() * Math.max(0.5, (G.m1 - G.m0) - 0.6);
        }
        if (u.stream) { m.st0 = u.s0 + (i / u.n) * (u.s1 - u.s0) * 0.72; m.st1 = m.st0 + (u.s1 - u.s0) * 0.28; }
        if (G.chaseTargets && G.chaseTargets.length) {
          m.ct = G.chaseTargets[i % G.chaseTargets.length];
          const a = rnd() * 6.2832, rr = Math.sqrt(rnd()) * Math.sqrt(u.n / G.chaseTargets.length) * 0.62;
          m.co = [Math.cos(a) * rr, Math.sin(a) * rr];
        }
        G.members.push(m);
      });
      return G;
    });
    // 箭矢
    const arrows = [];
    fx.filter(f => f.k === 'arrows').forEach((f, ai) => {
      const rnd = rng(ai * 104729 + 7);
      for (let i = 0; i < f.n; i++) {
        const dur = 0.8 + rnd() * 0.35, tl = f.t0 + rnd() * Math.max(0.1, f.t1 - f.t0 - dur);
        let s, e;
        if (f.radial) {
          const a = rnd() * 6.2832, r0 = 1 + rnd() * 1.2, r1 = f.radial * (0.7 + rnd() * 0.5);
          s = [f.from[0] + Math.cos(a) * r0, f.from[1] + Math.sin(a) * r0]; e = [f.from[0] + Math.cos(a) * r1, f.from[1] + Math.sin(a) * r1];
        } else {
          const a1 = rnd() * 6.2832, r1 = Math.sqrt(rnd()) * 2, a2 = rnd() * 6.2832, r2 = Math.sqrt(rnd()) * 2.8;
          s = [f.from[0] + Math.cos(a1) * r1, f.from[1] + Math.sin(a1) * r1]; e = [f.to[0] + Math.cos(a2) * r2, f.to[1] + Math.sin(a2) * r2];
        }
        arrows.push({ tl, dur, s, e, c: RGB[f.side] || RGB.white });
      }
    });
    // 祭坛旗阵、玄甲列阵等预计算
    fx.forEach((f, i) => {
      if (f.k === 'escort' && window.GEO && GEO.routes[f.r]) {
        const r = GEO.routes[f.r], pts = [], step = 0.32, L = r.len;
        for (let d = 0.4; d < L - 0.4; d += step) {
          const p = routeAt(r, d), q = routeAt(r, Math.min(L, d + 0.2));
          const lat = p[1] * Math.PI / 180, dx = (q[0] - p[0]) * 111.32 * Math.cos(lat), dy = (q[1] - p[1]) * 110.574, dl = Math.hypot(dx, dy) || 1;
          const nx = -dy / dl, ny = dx / dl;
          [-1, 1].forEach(sgn => pts.push({ ll: kmToLL(p, nx * 0.22 * sgn, ny * 0.22 * sgn), d }));
        }
        f._pts = pts; f._route = r;
      }
    });
    return { def, center, groups, arrows, sparks: [], deaths: [], opts: opts || {}, t: 0, alpha: 0, span: 16 };
  }
  function routeAt(r, km) {
    const d = r.d, c = r.c; let lo = 0, hi = d.length - 1;
    if (km <= 0) return c[0]; if (km >= d[hi]) return c[hi];
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (d[mid] <= km) lo = mid; else hi = mid; }
    const t = (km - d[lo]) / ((d[hi] - d[lo]) || 1);
    return [lerp(c[lo][0], c[hi][0], t), lerp(c[lo][1], c[hi][1], t)];
  }

  /* ---------- 兵力位置 ---------- */
  function center(u, t) {
    if (!(u.t1 > u.t0)) return u.from;
    const k = ease((t - u.t0) / (u.t1 - u.t0));
    return [lerp(u.from[0], u.to[0], k), lerp(u.from[1], u.to[1], k)];
  }
  function basePos(G, m, t, s) {
    const u = G.u, c = center(u, t);
    let x, y;
    if (m.km) { x = c[0] + m.f; y = c[1] + m.r; }
    else { const d = G.dir; x = c[0] + (m.f * d[0] + m.r * d[1]) * s; y = c[1] + (m.f * d[1] - m.r * d[0]) * s; }
    // 行进中的起伏
    if (u.t1 > u.t0 && t > u.t0 && t < u.t1) { const w = Math.sin(t * 6 * m.sp + m.ph) * 0.18 * s; x += -G.dir[1] * w; y += G.dir[0] * w; }
    // 追击
    if (u.chase && m.ct && t > u.c0) {
      const k = ease((t - u.c0) / ((u.c1 - u.c0) * 0.6)), tx = m.ct[0] + (m.co ? m.co[0] : m.f * 0.6) * s, ty = m.ct[1] + (m.co ? m.co[1] : m.r * 0.6) * s;
      x = lerp(x, tx, k); y = lerp(y, ty, k);
    }
    // 近战
    if (G.m0 != null && t > G.m0 && t < G.m1 + 0.6) {
      const k = clamp((t - G.m0) / 0.8, 0, 1) * clamp((G.m1 + 0.6 - t) / 0.6, 0, 1);
      if (G.pull) { const pk = 0.32 * k; x = lerp(x, G.pull[0] + (x - c[0]) * 0.9, pk); y = lerp(y, G.pull[1] + (y - c[1]) * 0.9, pk); }
      const a = G.amp * k * s * 1.1;
      x += Math.sin(t * 9.1 * m.sp + m.ph) * a * 0.9 + Math.sin(t * 3.3 + m.ph * 2) * a * 0.5;
      y += Math.cos(t * 8.3 * m.sp + m.ph * 1.3) * a * 0.9;
    }
    return [x, y];
  }
  function memberState(G, m, t, s) {
    const u = G.u;
    let p = basePos(G, m, t, s), col = RGB[u.side] || RGB.white, a = 1;
    if (u.surrender && t > u.s0) {
      const k = ease((t - u.s0) / (u.s1 - u.s0)), p0 = basePos(G, m, u.s0, s);
      const tx = u.surrender[0] + m.f * s * 0.7, ty = u.surrender[1] + m.r * s * 0.7;
      p = [lerp(p0[0], tx, k), lerp(p0[1], ty, k)]; col = mix(RGB[u.side] || RGB[FOE], RGB.sur, clamp((t - u.s0) / 1.4, 0, 1));
    }
    if (u.stream && t > m.st0) {
      const k = ease((t - m.st0) / (m.st1 - m.st0)), p0 = basePos(G, m, m.st0, s);
      const tx = u.stream[0] + m.f * s * 0.45, ty = u.stream[1] + m.r * s * 0.45;
      p = [lerp(p0[0], tx, k), lerp(p0[1], ty, k)];
    }
    if (u.flee && t > u.f0) {
      const k = easeIn((t - u.f0) / (u.f1 - u.f0)), p0 = basePos(G, m, u.f0, s);
      const sp = u.lead ? 0.5 : 1.7;
      const tx = u.flee[0] + m.f * s * sp, ty = u.flee[1] + m.r * s * sp;
      p = [lerp(p0[0], tx, k), lerp(p0[1], ty, k)];
      a = u.lead ? 1 - clamp((k - 0.85) / 0.15, 0, 1) * 0.6 : 1 - clamp((k - 0.55) / 0.45, 0, 1);
    }
    return { p, col, a };
  }

  /* ---------- 战术箭头：地面上的进军与溃逃方向 ---------- */
  function tacArrow(F, a, b, k, c, A, bend, wKm, dashed) {
    if (k <= 0.01 || A <= 0.01) return;
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
    if (L < 0.5) return;
    const nx = -dy / L, ny = dx / L, mx = (a[0] + b[0]) / 2 + nx * L * bend, my = (a[1] + b[1]) / 2 + ny * L * bend;
    const N = 30, kk = Math.min(1, k), pts = [], len = [0];
    for (let i = 0; i <= N; i++) {
      const q = kk * i / N, u = 1 - q;
      pts.push([u * u * a[0] + 2 * u * q * mx + q * q * b[0], u * u * a[1] + 2 * u * q * my + q * q * b[1]]);
      if (i) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    }
    const tot = len[N];
    if (tot < 0.3) return;
    const hl = Math.min(wKm * 1.3, tot * 0.55), tip = pts[N], pe = pts[N - 1];
    let tx = tip[0] - pe[0], ty = tip[1] - pe[1];
    const tn = Math.hypot(tx, ty) || 1; tx /= tn; ty /= tn;
    const base = [tip[0] - tx * hl, tip[1] - ty * hl], shaft = [];
    for (let i = 0; i <= N; i++) if (len[i] < tot - hl) shaft.push(pts[i]);
    shaft.push(base);
    const hw = wKm / 2, Lf = [], Rt = [], n = shaft.length;
    for (let i = 0; i < n; i++) {
      const p = shaft[i], q = shaft[Math.min(i + 1, n - 1)], o = shaft[Math.max(i - 1, 0)];
      let ex = q[0] - o[0], ey = q[1] - o[1];
      const el = Math.hypot(ex, ey) || 1; ex /= el; ey /= el;
      const w = hw * (0.45 + 0.55 * i / Math.max(1, n - 1));
      Lf.push(F.P(p[0] - ey * w, p[1] + ex * w)); Rt.push(F.P(p[0] + ey * w, p[1] - ex * w));
    }
    const hh = wKm * 0.95;
    const path = Lf.concat([F.P(base[0] - ty * hh, base[1] + tx * hh), F.P(tip[0], tip[1]), F.P(base[0] + ty * hh, base[1] - tx * hh)], Rt.reverse());
    const s0 = F.P(a[0], a[1]), s1 = F.P(tip[0], tip[1]);
    const gr = g.createLinearGradient(s0[0], s0[1], s1[0], s1[1]);
    gr.addColorStop(0, rgba(c, 0.02 * A)); gr.addColorStop(0.55, rgba(c, 0.2 * A)); gr.addColorStop(1, rgba(c, 0.42 * A));
    g.beginPath(); path.forEach((q, i) => i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])); g.closePath();
    g.fillStyle = gr; g.fill();
    const gs = g.createLinearGradient(s0[0], s0[1], s1[0], s1[1]);
    gs.addColorStop(0, rgba(c, 0.08 * A)); gs.addColorStop(1, rgba(mix(c, [255, 255, 255], 0.3), 0.92 * A));
    g.strokeStyle = gs; g.lineWidth = 1.5; g.lineJoin = 'round';
    if (dashed) g.setLineDash([8, 6]);
    g.stroke(); g.setLineDash([]);
  }
  function drawArrows(S, F, t, A) {
    g.globalCompositeOperation = 'source-over';
    S.groups.forEach((G, i) => {
      const u = G.u, c = RGB[u.side] || RGB.white, bend = (i % 2 ? -1 : 1) * 0.12;
      if (u.t1 > u.t0 && u.to) {
        const L = Math.hypot(u.to[0] - u.from[0], u.to[1] - u.from[1]);
        if (L > 3) {
          const k = clamp((t - u.t0 + 0.9) / 1.3, 0, 1), fade = t < u.t1 + 0.5 ? 1 : Math.max(0.3, 1 - (t - u.t1 - 0.5) / 2.5);
          tacArrow(F, u.from, u.to, k, c, A * fade * (u.flee && t > u.f0 ? 0.5 : 1), bend, clamp(L * 0.075, 0.9, 2.6), false);
        }
      }
      if (u.flee && t > u.f0 - 0.4) {
        const a = u.t1 > u.t0 && u.to ? u.to : u.from, L = Math.hypot(u.flee[0] - a[0], u.flee[1] - a[1]);
        if (L > 3) {
          const k = clamp((t - u.f0 + 0.4) / 1.4, 0, 1), fade = t < u.f1 + 0.5 ? 1 : Math.max(0.35, 1 - (t - u.f1 - 0.5) / 2.5);
          tacArrow(F, a, u.flee, k, c, A * fade * 0.9, -bend, clamp(L * 0.075, 0.9, 2.6), true);
        }
      }
    });
  }

  /* ---------- 绘制：演出 ---------- */
  function drawShow(S, dt) {
    const def = S.def, t = S.t, F = makeFrame(S.center, S.span);
    if (!F) return;
    // 竖屏手机：队形像素间距收紧，与镜头拉远配合，整场演出等比缩小入画
    const ppk = F.ppk, s = clamp((W < 600 ? 5.4 : 7.4) / ppk, 0.1, 1.2);
    const A = S.alpha;
    const fx = def.fx || [];
    g.globalCompositeOperation = 'lighter';

    // 地面辉光：交锋、合围、波纹
    fx.forEach(f => {
      if (f.k === 'clash' && t > f.t0 - 0.3 && t < f.t1 + 1) {
        const k = clamp((t - f.t0) / 0.6, 0, 1) * clamp((f.t1 + 1 - t) / 1, 0, 1) * A;
        localEllipse(F, f.at, f.r, r => {
          const gr = g.createRadialGradient(0, 0, 0, 0, 0, r * 1.2);
          gr.addColorStop(0, rgba([255, 120, 50], 0.34 * k * (0.85 + 0.15 * Math.sin(t * 7))));
          gr.addColorStop(0.6, rgba([255, 70, 30], 0.12 * k)); gr.addColorStop(1, 'rgba(255,60,20,0)');
          g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r * 1.2, 0, 6.2832); g.fill();
        });
        // 火花
        const rate = 34 * clamp(f.r / 6, 0.5, 1.6) * (f.edge ? 1.3 : 1);
        if (t < f.t1 && dt > 0) {
          let n = rate * dt; while (n > 0) { if (n >= 1 || Math.random() < n) {
            const a = Math.random() * 6.2832, rr = f.edge ? f.r * (0.92 + Math.random() * 0.16) : Math.sqrt(Math.random()) * f.r;
            S.sparks.push({ x: f.at[0] + Math.cos(a) * rr, y: f.at[1] + Math.sin(a) * rr, b: t, life: 0.3 + Math.random() * 0.3, z: 0.6 + Math.random() * 0.8 });
          } n -= 1; }
        }
      }
      if (f.k === 'pulse' && t > f.t0 && t < f.t1 + 1.5) {
        const c = RGB[f.side] || RGB.gold, R = clamp(130 / ppk, 2, 40), fade = clamp((f.t1 + 1.5 - t) / 1.5, 0, 1) * A;
        for (let k = 0; k < 3; k++) {
          const ph = (((t - f.t0) / 2.4) + k / 3) % 1;
          localEllipse(F, f.at, R * ph, r => { g.strokeStyle = rgba(c, (1 - ph) * 0.85 * fade); g.lineWidth = 2.2 / ppk * (1 + ph); g.beginPath(); g.arc(0, 0, Math.max(0.01, r), 0, 6.2832); g.stroke(); });
        }
        localEllipse(F, f.at, R * 0.3, r => { const gr = g.createRadialGradient(0, 0, 0, 0, 0, r); gr.addColorStop(0, rgba(c, 0.45 * fade)); gr.addColorStop(1, rgba(c, 0)); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r, 0, 6.2832); g.fill(); });
      }
    });

    // 合围圈（实线 + 流动虚线）
    g.globalCompositeOperation = 'source-over';
    fx.forEach(f => {
      if (f.k !== 'ring' || t < f.t0 || t > f.t1 + 1) return;
      const c = RGB[f.side] || RGB[FOE], draw = clamp((t - f.t0) / 1.4, 0, 1), fade = clamp((f.t1 + 1 - t), 0, 1) * A;
      const pts = [];
      for (let i = 0; i <= 96 * draw; i++) { const a = (i / 96) * 6.2832 + Math.PI / 2; pts.push(F.P(f.at[0] + Math.cos(a) * f.r, f.at[1] + Math.sin(a) * f.r)); }
      if (pts.length < 2) return;
      g.lineCap = 'round';
      g.strokeStyle = rgba(c, 0.22 * fade); g.lineWidth = 9; g.setLineDash([]); poly(pts); g.stroke();
      g.strokeStyle = rgba(c, 0.95 * fade); g.lineWidth = 2.2; g.setLineDash([10, 7]); g.lineDashOffset = -t * 30; poly(pts); g.stroke();
      g.setLineDash([]);
    });

    // 战术箭头
    drawArrows(S, F, t, A);

    // 阵亡标记
    S.deaths.forEach(dm => {
      const q = F.P(dm.x, dm.y), a = 0.55 * A;
      g.strokeStyle = dm.side === US ? `rgba(255,150,120,${a})` : `rgba(175,205,235,${a})`; g.lineWidth = 1;
      g.beginPath(); g.moveTo(q[0] - 2, q[1] - 2); g.lineTo(q[0] + 2, q[1] + 2); g.moveTo(q[0] + 2, q[1] - 2); g.lineTo(q[0] - 2, q[1] + 2); g.stroke();
    });

    // 兵力
    const labels = [];
    S.groups.forEach(G => {
      const u = G.u, c0 = RGB[u.side] || RGB.white;
      const moving = (u.t1 > u.t0 && t > u.t0 && t < u.t1) || (u.flee && t > u.f0 && t < u.f1) || (u.chase && t > u.c0 && t < u.c1);
      let cx = 0, cy = 0, cn = 0;
      const pts = [];
      G.members.forEach(m => {
        if (t >= m.dieAt) {
          if (!m.dead) { const st = memberState(G, m, m.dieAt, s); m.dead = 1; S.deaths.push({ x: st.p[0], y: st.p[1], side: u.side }); S.sparks.push({ x: st.p[0], y: st.p[1], b: t, life: 0.35, z: 1, red: 1 }); }
          return;
        }
        const st = memberState(G, m, t, s);
        if (st.a <= 0.02) return;
        const q = F.P(st.p[0], st.p[1]);
        if (q[0] < -50 || q[0] > W + 50 || q[1] < -50 || q[1] > H + 50) return;
        let q0 = null;
        if (moving) { const sp = memberState(G, m, Math.max(0, t - 0.16), s); q0 = F.P(sp.p[0], sp.p[1]); }
        pts.push([q[0], q[1], st.col, st.a, q0]); cx += q[0]; cy += q[1]; cn++;
      });
      if (!cn) return;
      cx /= cn; cy /= cn;
      // 群体光晕
      g.globalCompositeOperation = 'lighter';
      const spread = Math.sqrt(cn) * 7 + 24;
      glow(cx, cy, pts[0][2], spread * 1.4, 0.26 * A);
      // 个体
      const big = u.big || u.side === 'gold' || u.lead;
      // 行进拖影
      if (moving) {
        g.lineCap = 'round'; g.lineWidth = big ? 3 : 2;
        pts.forEach(([x, y, c, a, q0]) => {
          if (!q0) return;
          const gr = g.createLinearGradient(q0[0], q0[1], x, y);
          gr.addColorStop(0, rgba(c, 0)); gr.addColorStop(1, rgba(mix(c, [255, 255, 255], 0.3), 0.55 * a * A));
          g.strokeStyle = gr; g.beginPath(); g.moveTo(q0[0] - (x - q0[0]) * 1.4, q0[1] - (y - q0[1]) * 1.4); g.lineTo(x, y); g.stroke();
        });
      }
      const dens = big ? 1 : clamp(4.6 / Math.sqrt(cn), 0.3, 1);
      pts.forEach(([x, y, c, a]) => glow(x, y, c, big ? 22 : 10, (big ? 0.95 : 0.8 * dens) * a * A));
      g.globalCompositeOperation = 'source-over';
      const chev = (x, y, ux, uy, k) => {
        g.beginPath();
        g.moveTo(x + ux * 3.6 * k, y + uy * 3.6 * k);
        g.lineTo(x - ux * 2.4 * k - uy * 2.7 * k, y - uy * 2.4 * k + ux * 2.7 * k);
        g.lineTo(x - ux * 0.9 * k, y - uy * 0.9 * k);
        g.lineTo(x - ux * 2.4 * k + uy * 2.7 * k, y - uy * 2.4 * k - ux * 2.7 * k);
        g.closePath(); g.fill();
      };
      pts.forEach(([x, y, c, a, q0]) => {
        g.globalAlpha = a * A;
        const dx = q0 ? x - q0[0] : 0, dy = q0 ? y - q0[1] : 0, dl = Math.hypot(dx, dy);
        if (u.square) { g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x - 3.2, y - 1, 6.4, 4); g.fillStyle = rgba(mix(c, [255, 230, 190], 0.4), 1); g.fillRect(x - 3.2, y - 2, 6.4, 4); }
        else if (big) { g.fillStyle = '#fff6dc'; g.beginPath(); g.arc(x, y, 4.6, 0, 6.2832); g.fill(); g.strokeStyle = rgba(c, 1); g.lineWidth = 1.4; g.stroke(); }
        else if (dl > 0.6) {
          const ux = dx / dl, uy = dy / dl;
          g.fillStyle = 'rgba(0,0,0,.4)'; chev(x + 0.6, y + 1.1, ux, uy, 1.08);
          g.fillStyle = rgba(mix(c, [255, 255, 255], 0.45), 1); chev(x, y, ux, uy, 1);
        }
        else { g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x - 1.6, y - 0.9, 3.6, 3.6); g.fillStyle = rgba(mix(c, [255, 255, 255], 0.45), 1); g.fillRect(x - 1.8, y - 1.8, 3.6, 3.6); }
      });
      g.globalAlpha = 1;
      // 扬尘
      if (moving && dt > 0 && Math.random() < 0.8) {
        const p = pts[(Math.random() * pts.length) | 0];
        dust.push({ x: p[0], y: p[1], vx: (Math.random() - 0.5) * 8, vy: -4 - Math.random() * 6, life: 1.6, age: 0, r: 4 + Math.random() * 6, c: [190, 160, 120] });
      }
      if (u.label) labels.push([cx, cy - (u.lead ? 18 : 20), u.label, RGB[u.side] || RGB.gold]);
      if (u.lead && t > u.f0) {
        // 单于遁走轨迹
        const tr = [];
        for (let k = 0; k <= 20; k++) { const tt = u.f0 + (Math.min(t, u.f1) - u.f0) * k / 20, st = memberState(G, G.members[0], tt, s); tr.push(F.P(st.p[0], st.p[1])); }
        g.strokeStyle = rgba(RGB[u.side] || RGB[FOE], 0.7 * A); g.lineWidth = 1.6; g.setLineDash([4, 4]); poly(tr); g.stroke(); g.setLineDash([]);
      }
    });

    // 箭矢
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    S.arrows.forEach(ar => {
      const q = (t - ar.tl) / ar.dur;
      if (q < 0 || q > 1.25) return;
      const a = F.P(ar.s[0], ar.s[1]), b = F.P(ar.e[0], ar.e[1]);
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), hgt = L * 0.32 + 12;
      const pos = k => [lerp(a[0], b[0], k), lerp(a[1], b[1], k) - hgt * 4 * k * (1 - k)];
      if (q <= 1) {
        const h = pos(q), tl = pos(Math.max(0, q - 0.13));
        const gr = g.createLinearGradient(tl[0], tl[1], h[0], h[1]);
        gr.addColorStop(0, rgba(ar.c, 0)); gr.addColorStop(1, rgba(mix(ar.c, [255, 255, 255], 0.55), 0.95 * A));
        g.strokeStyle = gr; g.lineWidth = 1.5; g.beginPath(); g.moveTo(tl[0], tl[1]); g.lineTo(h[0], h[1]); g.stroke();
        glow(h[0], h[1], ar.c, 5, 0.7 * A);
      } else glow(b[0], b[1], ar.c, 8 * (1.25 - q) * 4, 0.6 * A);
    });

    // 火花
    S.sparks = S.sparks.filter(sp => t - sp.b < sp.life && t >= sp.b);
    S.sparks.forEach(sp => {
      const k = (t - sp.b) / sp.life, q = F.P(sp.x, sp.y), c = sp.red ? [255, 90, 60] : [255, 236, 190];
      glow(q[0], q[1], c, 13 * sp.z * (1 - k * 0.5), (1 - k) * A);
      if (!sp.red) {
        g.globalAlpha = (1 - k) * A; g.strokeStyle = 'rgba(255,250,235,1)'; g.lineWidth = 1;
        const r = 2 + 7 * k * sp.z; g.beginPath(); g.moveTo(q[0] - r, q[1]); g.lineTo(q[0] + r, q[1]); g.moveTo(q[0], q[1] - r); g.lineTo(q[0], q[1] + r); g.stroke();
        g.globalAlpha = 1;
      }
    });

    // 倒戈、突围、光柱、旗、玄甲
    fx.forEach((f, fi) => {
      if (f.k === 'convert' && t > f.t0) {
        const rnd = rng(fi * 31 + 5);
        for (let i = 0; i < f.n; i++) {
          const st = f.t0 + (i / f.n) * (f.t1 - f.t0) * 0.45, du = (f.t1 - f.t0) * 0.55, k = ease((t - st) / du);
          const a1 = rnd() * 6.28, r1 = rnd() * 1.2, a2 = rnd() * 6.28, r2 = rnd() * 1.8;
          if (t < st) continue;
          const x = lerp(f.at[0] + Math.cos(a1) * r1, f.to[0] + Math.cos(a2) * r2, k), y = lerp(f.at[1] + Math.sin(a1) * r1, f.to[1] + Math.sin(a2) * r2, k);
          const q = F.P(x, y), c = mix(RGB[f.side] || RGB[US], RGB[FOE], clamp((k - 0.3) / 0.4, 0, 1));
          glow(q[0], q[1], c, 9, 0.9 * A);
        }
      }
      // escape / move：一个人或一小队从 at 走到 to，身后拖虚线；boat: true 画成一叶小舟
      if ((f.k === 'escape' || f.k === 'move') && t > f.t0) {
        const col = RGB[f.side] || RGB[US], k = ease((t - f.t0) / Math.max(0.1, f.t1 - f.t0)), tr = [];
        for (let i = 0; i <= 16; i++) { const kk = k * i / 16; tr.push(F.P(lerp(f.at[0], f.to[0], kk), lerp(f.at[1], f.to[1], kk))); }
        g.globalCompositeOperation = 'source-over';
        g.strokeStyle = rgba(col, 0.6 * A); g.lineWidth = 1.4; g.setLineDash([3, 4]); poly(tr); g.stroke(); g.setLineDash([]);
        const h = tr[tr.length - 1];
        if (f.boat) {
          const p0 = tr[Math.max(0, tr.length - 5)], ang = Math.atan2(h[1] - p0[1], h[0] - p0[0]);
          g.save(); g.translate(h[0], h[1]); g.globalAlpha = A;
          g.save(); g.rotate(ang); g.strokeStyle = 'rgba(220,240,255,.55)'; g.lineWidth = 1;
          for (let w = 1; w <= 3; w++) { g.beginPath(); g.moveTo(-7 * w, -3 * w); g.lineTo(-2, 0); g.lineTo(-7 * w, 3 * w); g.stroke(); }
          g.restore();
          g.fillStyle = '#2a1c10'; g.beginPath(); g.moveTo(-9, 0); g.lineTo(9, 0); g.lineTo(6, 4); g.lineTo(-6, 4); g.closePath(); g.fill();
          g.fillStyle = rgba(col, 1); g.beginPath(); g.moveTo(0, -1); g.lineTo(0, -15); g.lineTo(7, -3); g.closePath(); g.fill();
          g.restore(); g.globalAlpha = 1;
        }
        g.globalCompositeOperation = 'lighter';
        glow(h[0], h[1], col, 14, A); glow(h[0], h[1], [255, 240, 220], 5, A);
        if (f.label) labels.push([h[0], h[1] - (f.boat ? 20 : 13), f.label, col]);
      }
      // label：演出某段时间里，在某个位置写一行字
      if (f.k === 'label' && t > f.t0 && t < (f.t1 != null ? f.t1 : 1e9)) {
        const q = F.P(f.at[0], f.at[1]);
        labels.push([q[0], q[1] - 8, f.t || '', RGB[f.side] || RGB.white]);
      }
      if (f.k === 'beam' && t > f.t0 && t < f.t1 + 1.5) {
        const k = clamp((t - f.t0) / 1.2, 0, 1) * clamp((f.t1 + 1.5 - t) / 1.5, 0, 1) * A;
        const q = F.P(f.at[0], f.at[1]), c = f.gold ? RGB.gold : [200, 225, 255], hh = (f.h || 0.6) * H * 0.62 * k;
        const fl = 0.85 + 0.15 * Math.sin(t * 13) * Math.sin(t * 5.3);
        const gr = g.createLinearGradient(0, q[1], 0, q[1] - hh);
        gr.addColorStop(0, rgba(c, 0.5 * k * fl)); gr.addColorStop(0.5, rgba(c, 0.18 * k)); gr.addColorStop(1, rgba(c, 0));
        g.fillStyle = gr; g.fillRect(q[0] - 22, q[1] - hh, 44, hh);
        const gr2 = g.createLinearGradient(0, q[1], 0, q[1] - hh);
        gr2.addColorStop(0, rgba([255, 255, 255], 0.9 * k)); gr2.addColorStop(1, rgba([255, 255, 255], 0));
        g.fillStyle = gr2; g.fillRect(q[0] - 2.5, q[1] - hh, 5, hh);
        glow(q[0], q[1], c, 90, 0.75 * k * fl); glow(q[0], q[1], [255, 255, 255], 26, k);
        for (let i = 0; i < 14; i++) { const ph = ((t * 0.35 + i / 14) % 1); glow(q[0] + Math.sin(i * 7.3 + t) * 14 * (1 - ph), q[1] - hh * ph, c, 4, k * (1 - ph)); }
      }
      if (f.k === 'flag' && t > f.t0) {
        const q = F.P(f.at[0], f.at[1]), k = clamp((t - f.t0 - 0.5) / 1.1, 0, 1), rot = easeIn(k) * 1.75;
        g.globalCompositeOperation = 'source-over';
        g.save(); g.translate(q[0], q[1]); g.rotate(rot); g.globalAlpha = (1 - k * 0.45) * A;
        g.fillStyle = '#c9b78f'; g.fillRect(-1.2, -50, 2.4, 50);
        g.fillStyle = rgba(RGB[f.side] || RGB[FOE], 1); g.beginPath(); g.moveTo(1, -50); g.lineTo(30, -44); g.lineTo(24, -38); g.lineTo(30, -32); g.lineTo(1, -30); g.closePath(); g.fill();
        g.strokeStyle = '#eaf6ff'; g.lineWidth = 1; g.stroke();
        g.fillStyle = '#0c1a28'; g.font = `800 12px ${FONT}`; g.fillText(f.char || '', 6, -36);
        g.restore(); g.globalAlpha = 1; g.globalCompositeOperation = 'lighter';
        if (k >= 1) glow(q[0], q[1], RGB.gold, 40 * clamp(1 - (t - f.t0 - 1.6) / 1.2, 0, 1), 0.9 * A);
      }
      if (f.k === 'flags' && t > f.t0) {
        const items = [];
        for (let i = 0; i < f.n; i++) { const a = (i / f.n) * 6.2832; items.push({ q: F.P(f.at[0] + Math.cos(a) * f.r, f.at[1] + Math.sin(a) * f.r), i }); }
        items.sort((a, b) => a.q[1] - b.q[1]);
        g.globalCompositeOperation = 'source-over';
        items.forEach(({ q, i }) => {
          const k = ease((t - f.t0 - i * 0.14) / 0.9); if (k <= 0) return;
          const hgt = 36 * k; g.globalAlpha = A;
          g.fillStyle = '#e9d3a0'; g.fillRect(q[0] - 0.9, q[1] - hgt, 1.8, hgt);
          g.fillStyle = '#c8321e'; g.beginPath(); g.moveTo(q[0] + 1, q[1] - hgt);
          for (let j = 0; j <= 6; j++) g.lineTo(q[0] + 1 + j * 3.4, q[1] - hgt + Math.sin(t * 6 + j * 0.9 + i) * 1.6 * (j / 6));
          for (let j = 6; j >= 0; j--) g.lineTo(q[0] + 1 + j * 3.4, q[1] - hgt + 12 + Math.sin(t * 6 + j * 0.9 + i) * 1.6 * (j / 6));
          g.closePath(); g.fill();
        });
        g.globalAlpha = 1; g.globalCompositeOperation = 'lighter';
      }
      if (f.k === 'escort' && f._pts && t > f.t0) {
        const N = f._pts.length, L = f._route.len, k = clamp((t - f.t0) / ((f.t1 - f.t0) * 0.55), 0, 1);
        for (let i = 0; i < N; i++) {
          const pt = f._pts[i]; if (pt.d / L > k) continue;
          const p = map.project(pt.ll); if (p.x < -20 || p.x > W + 20 || p.y < -20 || p.y > H + 20) continue;
          glow(p.x, p.y, RGB.steel, 6, 0.75 * A);
          g.globalAlpha = A; g.fillStyle = '#dbe8f5'; g.fillRect(p.x - 1, p.y - 1, 2, 2); g.globalAlpha = 1;
        }
        const hk = ease((t - f.t0) / (f.t1 - f.t0));
        for (let j = 0; j < 10; j++) {
          const dd = hk * L - j * 0.35; if (dd < 0) continue;
          const p = map.project(routeAt(f._route, dd));
          glow(p.x, p.y, j ? [255, 236, 200] : [255, 255, 255], j ? 8 : 26, (j ? 0.6 : 1) * A);
        }
      }
    });

    // 人物名签
    g.globalCompositeOperation = 'source-over';
    labels.forEach(([x, y, txt, c]) => {
      g.font = `700 12px ${FONT}`; const w = g.measureText(txt).width + 12;
      g.globalAlpha = A; g.fillStyle = 'rgba(10,9,8,.82)'; g.fillRect(x - w / 2, y - 17, w, 18);
      g.strokeStyle = rgba(c, 0.9); g.lineWidth = 1; g.strokeRect(x - w / 2 + 0.5, y - 16.5, w - 1, 17);
      g.fillStyle = rgba(mix(c, [255, 255, 255], 0.5), 1); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, x, y - 8);
      g.globalAlpha = 1;
    });

    // 战报题字
    const banners = fx.filter(f => f.k === 'banner' && t > f.t0);
    banners.forEach((f, bi) => {
      const k = clamp((t - f.t0) / 0.55, 0, 1), age = t - f.t0, q = F.P(f.at[0], f.at[1]);
      const lift = 58 + (bi % 2) * 36, rise = (1 - ease(k)) * 10, a = k * A * (age > 6 ? 0.82 : 1);
      const c = f.gold ? RGB.gold : [255, 120, 90];
      g.globalAlpha = a;
      g.strokeStyle = rgba(c, 0.9); g.lineWidth = 1.2; g.beginPath(); g.moveTo(q[0], q[1]); g.lineTo(q[0], q[1] - lift * ease(k)); g.stroke();
      g.save(); g.translate(q[0], q[1]); g.rotate(Math.PI / 4); g.fillStyle = rgba(c, 1); g.fillRect(-3, -3, 6, 6); g.restore();
      g.font = `800 17px ${FONT}`;
      const tw = g.measureText(f.t).width, w = tw + 30, h = 32;
      let x = q[0] - 6, y = q[1] - lift - h - rise;
      x = clamp(x, 10, W - w - 10);
      g.fillStyle = 'rgba(9,8,7,.86)'; g.fillRect(x, y, w, h);
      g.fillStyle = rgba(c, 1); g.fillRect(x, y, 3, h);
      g.strokeStyle = rgba(c, 0.55); g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      g.fillStyle = f.gold ? '#ffe39a' : '#fff1dc'; g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillText(f.t, x + 16, y + h / 2 + 1);
      g.globalAlpha = 1;
    });

    // 风沙
    fx.forEach(f => {
      if (f.k !== 'storm' || t < f.t0 - 0.5 || t > f.t1 + 2) return;
      const k = clamp((t - f.t0 + 0.5) / 1.5, 0, 1) * clamp((f.t1 + 2 - t) / 2, 0, 1);
      drawStorm(k, t);
    });
  }
  function poly(pts) { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); }

  let stormStreaks = null, stormGrains = null, stormTex = null, stormPat = null;
  function makeStormTex() {
    const w = 512, h = 256, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d'), img = cx.createImageData(w, h), rnd = rng(20260);
    // [横向格数, 纵向格数, 权重]：横向格少、纵向格多 → 特征被横向拉长成沙浪
    const octs = [[3, 10, 0.5], [6, 22, 0.27], [12, 46, 0.15], [24, 92, 0.08]];
    const grids = octs.map(o => { const a = new Float32Array(o[0] * o[1]); for (let i = 0; i < a.length; i++) a[i] = rnd(); return a; });
    for (let j = 0; j < h; j++) {
      const env = Math.sin(Math.PI * j / (h - 1));
      for (let i = 0; i < w; i++) {
        let v = 0;
        for (let k = 0; k < octs.length; k++) {
          const o = octs[k], G = grids[k], gx = i / w * o[0], gy = j / h * o[1];
          const x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
          const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
          const xa = x0 % o[0], xb = (x0 + 1) % o[0], ya = (y0 % o[1]) * o[0], yb = ((y0 + 1) % o[1]) * o[0];
          v += o[2] * lerp(lerp(G[ya + xa], G[ya + xb], sx), lerp(G[yb + xa], G[yb + xb], sx), sy);
        }
        const al = clamp((v - 0.4) * 2.6, 0, 1) * env;
        const p = (j * w + i) * 4;
        img.data[p] = 238; img.data[p + 1] = 212; img.data[p + 2] = 166; img.data[p + 3] = al * 255;
      }
    }
    cx.putImageData(img, 0, 0);
    return cv;
  }
  function drawStorm(k, t) {
    if (!stormStreaks) {
      stormStreaks = [];
      for (let i = 0; i < 150; i++) stormStreaks.push({ x: Math.random(), y: Math.random(), l: 0.6 + Math.random() * 0.8, v: 0.7 + Math.random() * 0.6, a: 0.4 + Math.random() * 0.6, ph: Math.random() * 6.28 });
      stormGrains = [];
      for (let i = 0; i < 170; i++) stormGrains.push({ x: Math.random(), y: Math.random(), v: 0.5 + Math.random() * 0.8, r: 0.5 + Math.random() * 1.1, a: 0.3 + Math.random() * 0.5, ph: Math.random() * 6.28 });
    }
    g.globalCompositeOperation = 'source-over';
    // 沙幕：地平线一带最浓
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, `rgba(170,130,80,${0.56 * k})`); gr.addColorStop(0.42, `rgba(142,104,60,${0.38 * k})`); gr.addColorStop(1, `rgba(102,72,40,${0.5 * k})`);
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    // 翻滚的沙浪：远层慢而扁，近层快而厚，向左推进
    // 用 repeat-x 图案平铺，采样在接缝处自动环绕，不留竖向接缝
    if (!stormPat) { stormTex = makeStormTex(); stormPat = g.createPattern(stormTex, 'repeat-x'); }
    const layer = (y0, hh, sc, sp, a) => {
      const tw = W * sc, off = (((t * W * sp) % tw) + tw) % tw;
      stormPat.setTransform(new DOMMatrix().translateSelf(-off, y0).scaleSelf(tw / stormTex.width, hh / stormTex.height));
      g.globalAlpha = a * k; g.fillStyle = stormPat; g.fillRect(0, y0, W, hh);
    };
    layer(H * 0.06, H * 0.46, 1.7, 0.022, 0.42);
    layer(H * 0.3, H * 0.62, 1.35, 0.045, 0.5);
    layer(H * 0.55, H * 0.6, 1.1, 0.085, 0.42);
    g.globalAlpha = 1; g.lineCap = 'round';
    // 风沙流线：两端淡出的柔和弧线，越靠下越近，越长、越粗、越快
    stormStreaks.forEach(s => {
      const yy = (s.y + t * 0.015 * s.v) % 1, d = yy * yy;
      const len = (40 + d * 230) * s.l, sp = (0.3 + d * 1.1) * s.v;
      const y = H * (0.08 + 0.92 * yy), x = ((((s.x - t * sp * 0.6) % 1) + 1) % 1) * (W + len * 2) - len;
      const a = (0.04 + 0.17 * d) * s.a * k;
      if (a < 0.01) return;
      const x2 = x + len, y2 = y - len * 0.08, bow = Math.sin(t * 1.3 + s.ph) * (2 + d * 9);
      const lg = g.createLinearGradient(x, y, x2, y2);
      lg.addColorStop(0, 'rgba(244,222,182,0)'); lg.addColorStop(0.3, `rgba(244,222,182,${a})`); lg.addColorStop(1, 'rgba(244,222,182,0)');
      g.strokeStyle = lg; g.lineWidth = 1.2 + d * 4.6;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + len * 0.5, y - len * 0.04 + bow, x2, y2); g.stroke();
    });
    // 扑面的沙粒
    g.fillStyle = 'rgb(248,230,196)';
    stormGrains.forEach(p => {
      const d = p.y * p.y, y = H * (0.1 + 0.9 * p.y) + Math.sin(t * 2.2 + p.ph) * (3 + d * 8);
      const x = ((((p.x - t * p.v * (0.22 + d * 0.9)) % 1) + 1) % 1) * W;
      const r = p.r * (0.6 + d * 1.4);
      g.globalAlpha = p.a * k * (0.25 + 0.75 * d);
      g.fillRect(x, y, r * 2.6, r * 0.9);
    });
    g.globalAlpha = 1;
  }

  /* ---------- 天气 ---------- */
  const WX = {
    dust:   { n: 70,  make: () => ({ x: Math.random() * W, y: Math.random() * H, vx: 6 + Math.random() * 10, vy: -2 + Math.random() * 3, r: 0.8 + Math.random() * 1.8, a: 0.12 + Math.random() * 0.3, c: [255, 216, 160], tw: Math.random() * 6 }) },
    snow:   { n: 170, make: () => ({ x: Math.random() * W, y: Math.random() * H, vx: -10 + Math.random() * 6, vy: 22 + Math.random() * 40, r: 0.8 + Math.random() * 2.2, a: 0.45 + Math.random() * 0.5, c: [255, 255, 255], tw: Math.random() * 6 }) },
    pollen: { n: 60,  make: () => ({ x: Math.random() * W, y: Math.random() * H, vx: 4 + Math.random() * 8, vy: -4 + Math.random() * 6, r: 0.8 + Math.random() * 1.6, a: 0.2 + Math.random() * 0.4, c: [255, 246, 200], tw: Math.random() * 6 }) },
    heat:   { n: 46,  make: () => ({ x: Math.random() * W, y: Math.random() * H, vx: -2 + Math.random() * 4, vy: -6 - Math.random() * 8, r: 1 + Math.random() * 2, a: 0.08 + Math.random() * 0.18, c: [255, 230, 180], tw: Math.random() * 6 }) },
    leaves: { n: 42,  make: () => ({ x: Math.random() * W, y: Math.random() * H, vx: 16 + Math.random() * 20, vy: 14 + Math.random() * 18, r: 2 + Math.random() * 2.5, a: 0.5 + Math.random() * 0.4, c: Math.random() < 0.5 ? [214, 120, 52] : [190, 70, 40], tw: Math.random() * 6, leaf: 1 }) },
    grass:  { n: 70,  make: () => ({ x: Math.random() * W, y: H * (0.38 + Math.random() * 0.62), vx: 40 + Math.random() * 50, vy: -3 + Math.random() * 6, r: 0.7 + Math.random() * 0.9, a: 0.1 + Math.random() * 0.22, c: [236, 230, 190], tw: Math.random() * 6, streak: 1, len: 18 + Math.random() * 26 }) },
    embers: { n: 64,  make: () => ({ x: Math.random() * W, y: H * (0.3 + Math.random() * 0.8), vx: -3 + Math.random() * 6, vy: -10 - Math.random() * 18, r: 0.8 + Math.random() * 1.6, a: 0.3 + Math.random() * 0.6, c: [255, 150, 70], tw: Math.random() * 6, glow: 1 }) },
    rain:   { n: 220, make: () => ({ x: Math.random() * W, y: Math.random() * H, vx: -60 - Math.random() * 30, vy: 620 + Math.random() * 260, r: 0.8 + Math.random() * 0.7, a: 0.18 + Math.random() * 0.22, c: [200, 215, 235], tw: Math.random() * 6, rain: true }) },
    mist:   { n: 16,  make: () => ({ x: Math.random() * W, y: H * (0.35 + Math.random() * 0.65), vx: 5 + Math.random() * 9, vy: 0, r: 30 + Math.random() * 34, a: 0.05 + Math.random() * 0.06, c: [236, 240, 236], tw: Math.random() * 6, glow: true }) },
    petals: { n: 48,  make: () => ({ x: Math.random() * W, y: Math.random() * H, vx: 12 + Math.random() * 16, vy: 14 + Math.random() * 14, r: 1.8 + Math.random() * 2, a: 0.55 + Math.random() * 0.35, c: Math.random() < 0.5 ? [255, 196, 210] : [250, 226, 232], tw: Math.random() * 6, leaf: true }) },
    motes:  { n: 40,  make: () => ({ x: Math.random() * W, y: Math.random() * H, vx: 2 + Math.random() * 4, vy: -2 + Math.random() * 3, r: 0.6 + Math.random() * 1.1, a: 0.25 + Math.random() * 0.4, c: [214, 228, 255], tw: Math.random() * 6, glow: true }) },
    storm:  { n: 0, make: () => ({}) },
  };
  function setWeather(kind) {
    wx.kind = kind || null;
    if (wx.kind === wx.lastKind) return;
    wx.lastKind = wx.kind;
    const def = WX[wx.kind]; wx.parts = [];
    if (def) for (let i = 0; i < def.n; i++) wx.parts.push(def.make());
  }
  function drawWeather(dt, t) {
    if (!wx.on || !wx.kind) return;
    if (wx.kind === 'storm') { drawStorm(0.85, t); return; }
    const def = WX[wx.kind];
    wx.parts.forEach(p => {
      p.x += (p.vx + Math.sin(t * 0.8 + p.tw) * 6) * dt; p.y += p.vy * dt;
      if (p.x > W + 20) p.x = -20; if (p.x < -20) p.x = W + 20;
      if (p.y > H + 20) { p.y = p.streak ? H * (0.38 + Math.random() * 0.5) : -20; p.x = Math.random() * W; }
      if (p.y < -20) { if (wx.kind === 'embers') { p.y = H + 10; p.x = Math.random() * W; } else p.y = H + 20; }
      const tw = 0.65 + 0.35 * Math.sin(t * 2.2 + p.tw * 3);
      if (p.rain) { g.globalAlpha = p.a; g.strokeStyle = rgba(p.c, 1); g.lineWidth = p.r; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035); g.stroke(); return; }
      if (p.glow) { g.globalCompositeOperation = 'lighter'; glow(p.x, p.y, p.c, p.r * 5, p.a * tw); g.globalCompositeOperation = 'source-over'; return; }
      g.globalAlpha = p.a * tw; g.fillStyle = rgba(p.c, 1);
      if (p.leaf) { g.save(); g.translate(p.x, p.y); g.rotate(t * 2 + p.tw); g.fillRect(-p.r, -p.r * 0.45, p.r * 2, p.r * 0.9); g.restore(); }
      else if (p.streak) { const gr = g.createLinearGradient(p.x - p.len, p.y, p.x, p.y); gr.addColorStop(0, rgba(p.c, 0)); gr.addColorStop(1, rgba(p.c, 1)); g.strokeStyle = gr; g.lineWidth = p.r; g.lineCap = 'round'; g.beginPath(); g.moveTo(p.x - p.len, p.y + 1); g.lineTo(p.x, p.y); g.stroke(); }
      else { g.beginPath(); g.arc(p.x, p.y, p.r, 0, 6.2832); g.fill(); }
    });
    g.globalAlpha = 1;
  }

  /* ---------- 波纹与扬尘 ---------- */
  function drawPings(now) {
    pings = pings.filter(p => now - p.b < p.dur * 1000);
    const pitch = map.getPitch() * Math.PI / 180, sy = Math.max(0.3, Math.cos(pitch));
    pings.forEach(p => {
      const q = map.project(p.ll), age = (now - p.b) / 1000, c = RGB[p.c] || RGB.gold;
      const fade = clamp((p.dur - age) / 1, 0, 1);
      g.globalCompositeOperation = 'lighter';
      glow(q.x, q.y, c, 26, 0.7 * fade);
      for (let k = 0; k < 3; k++) {
        const ph = ((age / 1.6) + k / 3) % 1, r = 8 + ph * (p.r || 60);
        g.strokeStyle = rgba(c, (1 - ph) * 0.9 * fade); g.lineWidth = 2;
        g.beginPath(); g.ellipse(q.x, q.y, r, r * sy, 0, 0, 6.2832); g.stroke();
      }
      g.globalCompositeOperation = 'source-over';
    });
  }
  function drawDust(dt) {
    dust = dust.filter(d => (d.age += dt) < d.life);
    dust.forEach(d => {
      d.x += d.vx * dt; d.y += d.vy * dt; const k = d.age / d.life;
      g.globalAlpha = (1 - k) * 0.22; g.fillStyle = rgba(d.c, 1);
      g.beginPath(); g.arc(d.x, d.y, d.r * (0.6 + k * 1.6), 0, 6.2832); g.fill();
    });
    g.globalAlpha = 1;
  }

  /* ---------- 对外接口 ---------- */
  function init(canvas, m) {
    cv = canvas; g = cv.getContext('2d'); map = m;
    resize(); window.addEventListener('resize', resize);
  }
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    stormStreaks = null;
  }
  function startShow(def, centerLL, opts) { show = prep(def, centerLL, opts); }
  function stopShow() { show = null; }
  function setShowTime(t, alpha) { if (show) { show.t = t; show.alpha = alpha == null ? 1 : alpha; } }
  function draw(clock) {
    const now = performance.now(), dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    try {
      drawPings(now);
      if (show && show.alpha > 0) drawShow(show, show.lastT == null ? 0 : Math.max(0, show.t - show.lastT));
      if (show) show.lastT = show.t;
      drawDust(dt);
      drawWeather(dt, (clock || now) / 1000);
    } catch (e) { console.warn('[FX]', e); }
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
  }
  return {
    init, resize, draw, startShow, stopShow, setShowTime,
    setWeather, weatherOn(v) { wx.on = v; },
    ping(ll, c, dur, r) { pings.push({ ll, c, dur: dur || 4, r: r || 60, b: performance.now() }); },
    headDust(x, y, vx, vy, c) { dust.push({ x: x + (Math.random() - 0.5) * 6, y: y + (Math.random() - 0.5) * 4, vx: vx + (Math.random() - 0.5) * 10, vy: vy - 3 - Math.random() * 5, life: 1.3, age: 0, r: 3 + Math.random() * 5, c: c || [214, 182, 136] }); },
    get busy() { return !!show || pings.length > 0 || dust.length > 0 || (wx.on && !!wx.kind); },
    get weather() { return wx.kind; },
    routeAt,
  };
})();
