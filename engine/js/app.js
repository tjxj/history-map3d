/* 三维考据地图引擎 · 主程序
 * 三维地形（MapLibre GL 5）· 路线推进 · 场景演出 · 章节档案 · 音效联动
 * 数据：GEO（data/geo.js，由 scripts/geo.py 生成）、SITE / NODE_INFO / LABELS / CHAPTERS（js/data.js，由 scripts/build.py 生成）
 * 本文件不写任何具体人物：人物名、势力、界面用词、总览、开场数字都从 SITE 读取 */
(function () {
  'use strict';

  /* ================================================================ 工具 */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = t => { t = clamp(t, 0, 1); return 1 - Math.pow(1 - t, 3); };
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const fmt = n => Math.round(n).toLocaleString('en-US');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const body = document.body, root = document.documentElement;

  const CH = window.CHAPTERS, NI = window.NODE_INFO, SITE = window.SITE, LABELS = window.LABELS;
  const G = window.GEO, NODES = G.nodes;
  // 古里折算：SITE.li = { name: '汉里', km: 0.4158 }；不填则界面只显示公里
  const LI = SITE.li && SITE.li.km ? SITE.li : null, HANLI = LI ? LI.km : 1, LI_N = LI ? LI.name : '';
  const liTxt = km => (LI ? fmt(km / HANLI) + ' ' + LI_N : '');
  const liTh = () => (LI ? '<th>' + esc(LI_N) + '</th>' : '');
  const liTd = km => (LI ? '<td>' + fmt(km / HANLI) + '</td>' : '');
  // 界面用词：军事题材写「行军 / 战报 / 官职」，文人题材用默认的「行程 / 经过 / 身份」
  const W_ = Object.assign({ go: '行程', story: '经过', tour: '巡游', rank: '身份', dash: '归途 · 示意', tabReport: '经过', tabSources: '史料', tabDebates: '考据', tabPeople: '人物' }, SITE.words || {});
  const HERO = Object.assign({ name: '', flag: '', legend: '' }, SITE.hero || {});
  const OVW = Object.assign({ num: '全', title: '全部路线', sub: '路线总览', span: '', lead: '', list: '全部章节', col: '章节', btn: '全部路线' }, SITE.overview || {});
  const VAR = Object.assign({ t: '异文对照', a: '甲本', b: '乙本' }, SITE.variants || {});
  const FACTIONS = SITE.factions || [];
  const TERRS = G.terr || {};
  const TERR0 = TERRS[SITE.terrDefault] ? SITE.terrDefault : (Object.keys(TERRS)[0] || null);
  const FIRST_TRACK = Math.max(0, CH.findIndex(c => c.track && c.track.length));
  // 总览页的数字、史料、考据取自「尾声」章：SITE.overviewChapter 指定章 id，不填就用最后一章
  const EPI = CH.find(c => c.id === SITE.overviewChapter) || CH[CH.length - 1];
  // 全部路线的范围：开场地球朝向、预热瓦片都用它
  const RB = (() => {
    let a = 180, b = 90, c = -180, d = -90;
    Object.keys(G.routes || {}).forEach(k => G.routes[k].c.forEach(p => { if (p[0] < a) a = p[0]; if (p[0] > c) c = p[0]; if (p[1] < b) b = p[1]; if (p[1] > d) d = p[1]; }));
    return a > c ? [93, 32, 121, 53] : [a - 2, b - 2, c + 2, d + 2];
  })();
  // 固定音效提示：章节开场 / 全图总览 / 章节结束。军事题材可写 { chapter: [[0.25, 'drums'], [1.2, 'horn']] }
  const CUES = Object.assign({ chapter: [[0.2, 'bell'], [0.9, 'qin']], all: [[0.1, 'bell']], end: [[0.2, 'bell']] }, SITE.cues || {});
  const cue = (k, ch) => ((ch && ch.cue) || CUES[k] || []).forEach(([sec, name]) => AUDIO.play(name, sec));
  const GLOBE = Object.assign({ c: [(RB[0] + RB[2]) / 2, (RB[1] + RB[3]) / 2], z: 1.7 }, SITE.globe || {});
  const routeAt = FX.routeAt;
  const EMPTY = { type: 'FeatureCollection', features: [] };
  const ALL_KM = CH.reduce((a, c) => a + (c.track || []).reduce((b, t) => b + (G.routes[t.r] ? G.routes[t.r].len : 0), 0), 0);

  function hexRgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h.replace(/./g, '$&$&');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const mixRgb = (a, b, k) => { const x = hexRgb(a), y = hexRgb(b); return 'rgb(' + x.map((v, i) => Math.round(v + (y[i] - v) * k)).join(',') + ')'; };
  function bearingOf(a, b) {
    const p1 = a[1] * D2R, p2 = b[1] * D2R, dl = (b[0] - a[0]) * D2R;
    const y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) * R2D + 360) % 360;
  }
  const angDiff = (a, b) => ((((b - a) % 360) + 540) % 360) - 180;
  function distKm(a, b) {
    const p1 = a[1] * D2R, p2 = b[1] * D2R, dp = p2 - p1, dl = (b[0] - a[0]) * D2R;
    const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function llOf(at) {
    if (!at) return null;
    if (Array.isArray(at)) return at;
    const k = String(at).split('@')[0];
    if (NODES[k]) return NODES[k];
    if (G.peaks[k]) return [G.peaks[k][0], G.peaks[k][1]];
    return null;
  }
  const nameOf = k => (NI[k] ? NI[k][0] : k);
  const descOf = k => (NI[k] ? NI[k][1] : '');
  const lineF = (coords, props) => ({ type: 'Feature', properties: props || {}, geometry: { type: 'LineString', coordinates: coords } });
  const fc = f => ({ type: 'FeatureCollection', features: f });
  // 截取路线 0..km 的折线（末点精确落在 km 处）
  function cut(route, km) {
    const d = route.d, c = route.c, last = d.length - 1;
    if (km <= 0) return [c[0], c[0]];
    if (km >= d[last]) return c;
    let lo = 0, hi = last;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (d[m] <= km) lo = m; else hi = m; }
    const out = c.slice(0, lo + 1);
    out.push(routeAt(route, km));
    return out;
  }
  const timers = [];
  function later(ms, fn) {
    const id = setTimeout(() => { const i = timers.indexOf(id); if (i >= 0) timers.splice(i, 1); fn(); }, ms);
    timers.push(id);
    return id;
  }
  function clearTimers() { timers.splice(0).forEach(clearTimeout); }

  /* ================================================================ 常量 */
  const DEM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
  const SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  // 支线 side 只有四种 k：ally 同行 / enemy 对手 / lost 失道 / flow 迁徙；图例名称在 SITE.sideNames 里改
  const SIDE_C = Object.assign({ ally: '#ffd9a0', enemy: '#7fb6ff', lost: '#b8b2a8', flow: '#c9a6ff' }, SITE.sideColors || {});
  const SIDE_N = Object.assign({ ally: '同行', enemy: '对手', lost: '失道', flow: '迁徙' }, SITE.sideNames || {});
  const KIND_N = Object.assign({ battle: '战役', cut: '同一时刻', vista: '地理', ritual: '典礼', surrender: '受降', poem: '诗作', meet: '相会', voyage: '舟行', event: '事件' }, SITE.kindNames || {});
  const CAM_N = { follow: '跟随', overview: '全景', free: '自由' };
  const MAIN_TAGS = SITE.mainTags || ['主流', '本图主线', '可考', '通说'];
  const ATMO = {
    dusk:   { op: 0.34, sat: [-0.12, 0.22, 0.92], sky: '#1d1712', hor: '#c98446', fog: '#6a4a30', wx: 'dust',   tint: 'linear-gradient(180deg,#ffb066 0%,#c0703a 45%,#5a2a10 100%)' },
    dawn:   { op: 0.32, sat: [-0.05, 0.18, 0.97], sky: '#28324a', hor: '#e8a66a', fog: '#6a5a50', wx: 'grass',  tint: 'linear-gradient(180deg,#ffc6a2 0%,#c88a7a 45%,#4a3c6a 100%)' },
    spring: { op: 0.22, sat: [0.05, 0.14, 1.00],  sky: '#4d6f96', hor: '#d9c7a0', fog: '#8a8a78', wx: 'pollen', tint: 'linear-gradient(180deg,#eef2c8 0%,#a8b878 50%,#4a5a34 100%)' },
    summer: { op: 0.26, sat: [0.08, 0.16, 1.00],  sky: '#3b6fa6', hor: '#f0d9a8', fog: '#a39070', wx: 'heat',   tint: 'linear-gradient(180deg,#ffe6a8 0%,#d8a858 50%,#7a5a28 100%)' },
    autumn: { op: 0.30, sat: [-0.02, 0.18, 0.97], sky: '#3a4a66', hor: '#e09a5a', fog: '#7a5a40', wx: 'leaves', tint: 'linear-gradient(180deg,#ffbe7a 0%,#c47a40 50%,#5a301a 100%)' },
    steppe: { op: 0.22, sat: [0.02, 0.15, 1.00],  sky: '#1f4f86', hor: '#e9dfc0', fog: '#b9b49a', wx: 'grass',  tint: 'linear-gradient(180deg,#dfe9ff 0%,#8a9cb0 50%,#2e3a48 100%)' },
    night:  { op: 0.50, sat: [-0.55, 0.12, 0.60], sky: '#05070d', hor: '#2a3550', fog: '#141a26', wx: 'embers', tint: 'linear-gradient(180deg,#7a90c8 0%,#2a3a6a 50%,#080e24 100%)' },
    rain:    { op: 0.36, sat: [-0.35, 0.10, 0.80], sky: '#2a323c', hor: '#7d8a96', fog: '#4a525a', wx: 'rain',   tint: 'linear-gradient(180deg,#9fb0c0 0%,#56687a 50%,#1e2a36 100%)' },
    snow:    { op: 0.30, sat: [-0.45, 0.12, 1.00], sky: '#4a5868', hor: '#d8dee6', fog: '#9aa4ae', wx: 'snow',   tint: 'linear-gradient(180deg,#eef4ff 0%,#a8b8c8 50%,#3a4858 100%)' },
    moon:    { op: 0.46, sat: [-0.50, 0.12, 0.66], sky: '#070b18', hor: '#3a4a6e', fog: '#18203a', wx: 'motes', moon: true, tint: 'linear-gradient(180deg,#a8bce8 0%,#34477a 50%,#0a1230 100%)' },
    mist:    { op: 0.30, sat: [-0.25, 0.06, 0.94], sky: '#55606a', hor: '#c4c8c0', fog: '#a4aaa6', wx: 'mist',   tint: 'linear-gradient(180deg,#e4e8e0 0%,#a0aaa4 50%,#3c4844 100%)' },
    blossom: { op: 0.24, sat: [0.04, 0.14, 1.00],  sky: '#5a78a0', hor: '#f0d4d4', fog: '#a08c90', wx: 'petals', tint: 'linear-gradient(180deg,#ffe4ea 0%,#d8a0a8 50%,#5a3a44 100%)' },
  };
  const ICON = {
    battle: '<svg viewBox="0 0 24 24"><path d="M4 4l11 11M20 4L9 15M13 17l4-4M11 17l-4-4M15.5 15.5l4 4M8.5 15.5l-4 4"/></svg>',
    vista: '<svg viewBox="0 0 24 24"><path d="M2.5 19.5l6.5-11 4 6.5 2.5-3.5 6 8z M7.4 11.2l1.6 1.4 1.4-1.2"/></svg>',
    cut: '<svg viewBox="0 0 24 24"><path d="M7 3.5h10M7 20.5h10M8 3.5c0 5 8 5.5 8 8.5s-8 3.5-8 8.5M16 3.5c0 5-8 5.5-8 8.5s8 3.5 8 8.5"/></svg>',
    ritual: '<svg viewBox="0 0 24 24"><path d="M12 3c2.5 3 4 5 4 7.5a4 4 0 0 1-8 0c0-1.8 1-3 2-4 .2 1.6 1 2.6 2 2.8-.4-2.6 0-4.6 0-6.3zM4.5 21h15M7 17.5h10V21H7z"/></svg>',
    surrender: '<svg viewBox="0 0 24 24"><path d="M6 21V3.5M6 4.5h12l-2.5 4 2.5 4H6"/></svg>',
    poem: '<svg viewBox="0 0 24 24"><path d="M19.5 3.5c-4 1-8.5 5.5-10.5 10l2 2c4.5-2 9-6.5 9.5-10.5zM9 13.5l-3.5 4-1 3 3-1 4-3.5M4 21h9"/></svg>',
    meet: '<svg viewBox="0 0 24 24"><path d="M10 7.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 1 1 5 0M19 7.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 1 1 5 0M3 20c0-3.6 2-6 4.5-6s4.5 2.4 4.5 6M12 20c0-3.6 2-6 4.5-6s4.5 2.4 4.5 6"/></svg>',
    voyage: '<svg viewBox="0 0 24 24"><path d="M3.5 15h17l-3 4.5h-11zM12 15V3.5l6 9h-6M2.5 21.5c1.5 0 1.5-.8 3-.8s1.5.8 3 .8 1.5-.8 3-.8 1.5.8 3 .8 1.5-.8 3-.8 1.5.8 3 .8"/></svg>',
    event: '<svg viewBox="0 0 24 24"><path d="M12 3l8.5 9-8.5 9-8.5-9zM12 8.5v4.5M12 15.6v.4"/></svg>',
  };
  const SVG_PLAY = '<svg viewBox="0 0 24 24"><path d="M7 4.5l13 7.5-13 7.5z"/></svg>';
  const SVG_PAUSE = '<svg viewBox="0 0 24 24"><path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z"/></svg>';
  const SVG_EYE = '<svg viewBox="0 0 24 24"><path d="M3 6.5l6-2 6 2 6-2v13l-6 2-6-2-6 2z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  // 文物 / 物证卡：scene.relic = { t: '名称', d: '一句说明', svg: '可选的内联 SVG' }，或写 SITE.relics 里的键名
  function relicHtml(r) {
    if (typeof r === 'string') r = (SITE.relics || {})[r];
    if (!r || !r.t) return '';
    return '<div class="sc-relic">' + (r.svg || '') + '<p><b>' + esc(r.t) + '</b>' + esc(r.d || '') + '</p></div>';
  }

  /* ================================================================ 地图样式 */
  const RELIEF = ['interpolate', ['linear'], ['elevation'],
    -100, '#56747c', 0, '#cdbb92', 300, '#d6c59b', 800, '#d8c393', 1200, '#d0b682', 1600, '#c4a470',
    2000, '#b5905f', 2600, '#a07a4e', 3200, '#8a6644', 3900, '#7c5e44', 4500, '#a39684', 5000, '#d8d1c6', 5500, '#f4f0e8'];
  const zw = (a, b, c) => ['interpolate', ['linear'], ['zoom'], 3, a, 6, b, 10, c];
  const RW = k => {
    const r = ['coalesce', ['get', 'r'], 3];
    return ['interpolate', ['exponential', 1.5], ['zoom'], 3, ['*', r, 0.06 * k], 6, ['*', r, 0.2 * k], 10, ['*', r, 0.5 * k]];
  };
  const ROUND = { 'line-cap': 'round', 'line-join': 'round' };
  const demSrc = () => ({ type: 'raster-dem', tiles: [DEM], encoding: 'terrarium', tileSize: 256, maxzoom: 12 });
  function skyOf(a) {
    return {
      'sky-color': a.sky, 'horizon-color': a.hor, 'fog-color': a.fog,
      'sky-horizon-blend': 0.7, 'horizon-fog-blend': 0.35, 'fog-ground-blend': 0.72,
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0],
    };
  }
  function sideLayers() {
    const out = [];
    ['flow', 'lost', 'enemy', 'ally'].forEach(k => {
      const f = ['==', ['get', 'k'], k];
      out.push({ id: 'sp-glow-' + k, type: 'line', source: 'sidep', filter: f, layout: ROUND, paint: { 'line-color': SIDE_C[k], 'line-width': zw(4, 7, 11), 'line-blur': zw(3, 5, 8), 'line-opacity': 0.34 } });
      const p = { 'line-color': SIDE_C[k], 'line-width': zw(1.5, 2.4, 3.6), 'line-opacity': 0.96 };
      if (k === 'ally') p['line-dasharray'] = [2.2, 1.3];
      if (k === 'lost') p['line-dasharray'] = [0.1, 1.9];
      out.push({ id: 'sp-' + k, type: 'line', source: 'sidep', filter: f, layout: k === 'ally' ? { 'line-join': 'round' } : ROUND, paint: p });
    });
    return out;
  }
  function allRoutesFC() {
    const f = [];
    CH.forEach(c => (c.track || []).forEach(t => {
      const r = G.routes[t.r];
      if (r) f.push(lineF(r.c, { c: c.color, ch: c.id, dash: t.dash ? 1 : 0 }));
    }));
    return fc(f);
  }
  // 疆域配色：疆域多边形的 side 属性对应 SITE.factions[].k
  function facMatch(pick, fallback) {
    if (!FACTIONS.length) return fallback;
    const e = ['match', ['get', 'side']];
    FACTIONS.forEach(f => e.push(f.k, pick(f)));
    e.push(fallback);
    return e;
  }
  function buildStyle() {
    const a = ATMO.dusk;
    return {
      version: 8,
      projection: { type: 'globe' },
      transition: { duration: 1500, delay: 0 },
      sources: {
        sat: { type: 'raster', tiles: [SAT], tileSize: 256, maxzoom: 11, attribution: 'Esri, Maxar, Earthstar Geographics' },
        demT: demSrc(), demH: demSrc(), demC: demSrc(),
        terr: { type: 'geojson', data: (TERR0 && TERRS[TERR0]) || EMPTY },
        rivers: { type: 'geojson', data: G.rivers },
        lakes: { type: 'geojson', data: G.lakes },
        ancient: { type: 'geojson', data: G.ancient },
        deserts: { type: 'geojson', data: G.deserts },
        walls: { type: 'geojson', data: G.walls },
        allr: { type: 'geojson', data: allRoutesFC() },
        ghost: { type: 'geojson', data: EMPTY },
        sideg: { type: 'geojson', data: EMPTY },
        sidep: { type: 'geojson', data: EMPTY },
        prog: { type: 'geojson', data: EMPTY },
      },
      sky: skyOf(a),
      terrain: { source: 'demT', exaggeration: 1.6 },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#6f6446' } },
        { id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-saturation': a.sat[0], 'raster-contrast': a.sat[1], 'raster-brightness-max': a.sat[2], 'raster-fade-duration': 250 } },
        { id: 'relief', type: 'color-relief', source: 'demC', layout: { visibility: 'none' }, paint: { 'color-relief-color': RELIEF, 'color-relief-opacity': 1 } },
        { id: 'hill', type: 'hillshade', source: 'demH', paint: { 'hillshade-exaggeration': 0.32, 'hillshade-shadow-color': '#1a0f05', 'hillshade-highlight-color': 'rgba(255,240,210,0.35)', 'hillshade-accent-color': '#2a1a0c' } },
        { id: 'des-wash', type: 'fill', source: 'deserts', paint: { 'fill-color': '#e6be82', 'fill-opacity': 0.07 } },
        { id: 'des-stip', type: 'fill', source: 'deserts', layout: { visibility: 'none' }, paint: { 'fill-pattern': 'stip', 'fill-opacity': 0.7 } },
        { id: 'terr-fill', type: 'fill', source: 'terr', paint: { 'fill-color': facMatch(f => f.c, '#8a8a8a'), 'fill-opacity': facMatch(f => (f.fo != null ? f.fo : 0.1), 0.1) } },
        { id: 'terr-glow', type: 'line', source: 'terr', layout: ROUND, paint: { 'line-color': facMatch(f => f.glow || f.c, '#aaaaaa'), 'line-width': zw(5, 8, 12), 'line-blur': zw(4, 7, 10), 'line-opacity': 0.2 } },
        { id: 'terr-line', type: 'line', source: 'terr', paint: { 'line-color': facMatch(f => f.line || f.c, 'rgba(200,200,200,0.5)'), 'line-width': zw(0.8, 1.3, 1.8), 'line-dasharray': [3, 2] } },
        { id: 'anc-fill', type: 'fill', source: 'ancient', paint: { 'fill-color': '#5aaadc', 'fill-opacity': 0.2 } },
        { id: 'anc-line', type: 'line', source: 'ancient', paint: { 'line-color': '#8fd0f5', 'line-width': zw(0.8, 1.2, 1.8), 'line-dasharray': [2, 2], 'line-opacity': 0.85 } },
        { id: 'lake-fill', type: 'fill', source: 'lakes', paint: { 'fill-color': '#3f86bb', 'fill-opacity': 0.55 } },
        { id: 'lake-line', type: 'line', source: 'lakes', paint: { 'line-color': '#9fdcff', 'line-width': 0.8, 'line-opacity': 0.55 } },
        { id: 'riv-glow', type: 'line', source: 'rivers', filter: ['!', ['has', 'h']], layout: ROUND, paint: { 'line-color': '#3f9fe6', 'line-width': RW(3), 'line-blur': RW(2.2), 'line-opacity': 0.32 } },
        { id: 'riv', type: 'line', source: 'rivers', filter: ['!', ['has', 'h']], layout: ROUND, paint: { 'line-color': '#93d5ff', 'line-width': RW(1), 'line-opacity': 0.85 } },
        { id: 'riv-h', type: 'line', source: 'rivers', filter: ['has', 'h'], layout: ROUND, paint: { 'line-color': '#93d5ff', 'line-width': RW(1), 'line-opacity': 0.7, 'line-dasharray': [3, 2] } },
        { id: 'wall', type: 'line', source: 'walls', filter: ['==', ['get', 'k'], 'wall'], paint: { 'line-color': '#d8b98a', 'line-width': zw(1, 1.6, 2.4), 'line-dasharray': [3, 1.5], 'line-opacity': 0.8 } },
        { id: 'road', type: 'line', source: 'walls', filter: ['==', ['get', 'k'], 'road'], layout: ROUND, paint: { 'line-color': '#ead3a2', 'line-width': zw(1.3, 2, 2.8), 'line-dasharray': [0.1, 2.2], 'line-opacity': 0.75 } },
        { id: 'allr-glow', type: 'line', source: 'allr', layout: Object.assign({ visibility: 'none' }, ROUND), paint: { 'line-color': ['get', 'c'], 'line-width': zw(10, 16, 24), 'line-blur': zw(6, 10, 14), 'line-opacity': 0.55 } },
        { id: 'allr', type: 'line', source: 'allr', layout: Object.assign({ visibility: 'none' }, ROUND), paint: { 'line-color': ['get', 'c'], 'line-width': zw(2.6, 3.8, 5.5), 'line-opacity': 1 } },
        { id: 'ghost', type: 'line', source: 'ghost', layout: ROUND, paint: { 'line-color': '#d9b26a', 'line-width': zw(1, 1.6, 2.4), 'line-opacity': 0.45, 'line-dasharray': [1.5, 2] } },
        { id: 'chev', type: 'symbol', source: 'ghost', layout: { 'symbol-placement': 'line', 'symbol-spacing': 90, 'icon-image': 'chev', 'icon-size': 0.5, 'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true }, paint: { 'icon-opacity': 0.7 } },
        { id: 'side-ghost', type: 'line', source: 'sideg', layout: ROUND, paint: { 'line-color': ['match', ['get', 'k'], 'ally', SIDE_C.ally, 'enemy', SIDE_C.enemy, 'lost', SIDE_C.lost, SIDE_C.flow], 'line-width': zw(0.8, 1.2, 2), 'line-opacity': 0.3, 'line-dasharray': [1, 2] } },
        ...sideLayers(),
        { id: 'prog-glow', type: 'line', source: 'prog', layout: ROUND, paint: { 'line-color': '#d9b26a', 'line-width': zw(8, 14, 22), 'line-blur': zw(6, 10, 14), 'line-opacity': 0.5 } },
        { id: 'prog-mid', type: 'line', source: 'prog', filter: ['!=', ['get', 'dash'], 1], layout: ROUND, paint: { 'line-color': '#d9b26a', 'line-width': zw(2.6, 5, 7) } },
        { id: 'prog-dash', type: 'line', source: 'prog', filter: ['==', ['get', 'dash'], 1], layout: { 'line-join': 'round' }, paint: { 'line-color': '#d9b26a', 'line-width': zw(2.4, 4, 6), 'line-dasharray': [1.6, 1.1] } },
        { id: 'prog-core', type: 'line', source: 'prog', filter: ['!=', ['get', 'dash'], 1], layout: ROUND, paint: { 'line-color': '#fff6dc', 'line-width': zw(1, 1.8, 2.6) } },
      ],
    };
  }
  function makeChev(col) {
    const s = 36, cv = document.createElement('canvas'); cv.width = cv.height = s;
    const x = cv.getContext('2d');
    x.lineCap = 'round'; x.lineJoin = 'round';
    const path = () => { x.beginPath(); x.moveTo(12, 9); x.lineTo(24, 18); x.lineTo(12, 27); x.stroke(); };
    x.strokeStyle = 'rgba(0,0,0,0.55)'; x.lineWidth = 7; path();
    x.strokeStyle = col; x.lineWidth = 3.4; path();
    return x.getImageData(0, 0, s, s);
  }
  function makeStip() {
    const s = 32, cv = document.createElement('canvas'); cv.width = cv.height = s;
    const x = cv.getContext('2d');
    let seed = 11;
    const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 24; i++) {
      x.fillStyle = `rgba(${(118 + r() * 40) | 0},${(78 + r() * 30) | 0},${(38 + r() * 22) | 0},${(0.35 + r() * 0.4).toFixed(2)})`;
      x.beginPath(); x.arc(r() * s, r() * s, 0.6 + r() * 0.9, 0, 6.283); x.fill();
    }
    return x.getImageData(0, 0, s, s);
  }

  /* ================================================================ 状态 */
  const S = {
    mode: 'intro', ci: -1, ch: null, km: 0, playing: false, speed: 1, cam: 'follow',
    scene: null, tour: null, atmo: 'dusk', wx: 'dust', terrK: TERR0, allOn: false,
    base: 'sat', exag: 1.6, accent: '#d9b26a', lastSeg: -1, seen: new Set(),
    lastHud: 0, lastDock: 0, lastProg: 0, lastDust: 0, dzW: 388, entered: false,
  };
  let M = { segs: [], nodes: [], events: [], sides: [], wps: [], cands: [], total: 0, wpSet: new Set() };
  const CAM = { c: null, z: 0, b: 0, p: 0, pad: null };

  /* ================================================================ 地图 */
  const map = new maplibregl.Map({
    container: 'map',
    style: buildStyle(),
    center: GLOBE.c, zoom: GLOBE.z, pitch: 0, bearing: 0,
    maxPitch: 78, maxZoom: 16.5, minZoom: 1,
    attributionControl: false,
    canvasContextAttributes: { antialias: true },
    fadeDuration: 250,
    renderWorldCopies: false,
  });
  window.__map = map;
  let ready = false;
  const readyQ = [];
  function addImages() {
    try { if (!map.hasImage('chev')) map.addImage('chev', makeChev(S.accent), { pixelRatio: 2 }); } catch (e) { /* 已存在 */ }
    try { if (!map.hasImage('stip')) map.addImage('stip', makeStip(), { pixelRatio: 2 }); } catch (e) { /* 已存在 */ }
  }
  map.on('style.load', () => {
    addImages();
    ready = true;
    readyQ.splice(0).forEach(f => f());
  });
  map.on('styleimagemissing', e => { if (e.id === 'chev' || e.id === 'stip') addImages(); });
  function whenReady(fn) { if (ready) fn(); else readyQ.push(fn); }
  function src(id) { return ready ? map.getSource(id) : null; }
  function vis(ids, on) { whenReady(() => ids.forEach(id => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'))); }

  /* ================================================================ 氛围 · 势力 · 主色 */
  function skyFor(a) { return skyOf(a); }
  function setAtmo(name, instant) {
    const a = ATMO[name] || ATMO.dusk;
    S.atmo = name; S.wx = a.wx;
    $('.g-tint').style.background = a.tint;
    $('.g-tint').style.opacity = a.op;
    // 地平线以上为透明画布：用 CSS 渐变铺天空，颜色随氛围走
    root.style.setProperty('--sk-top', mixRgb(a.sky, '#000000', 0.38));
    root.style.setProperty('--sk-mid', a.sky);
    root.style.setProperty('--sk-low', mixRgb(a.sky, a.hor, 0.55));
    root.style.setProperty('--sk-hor', a.hor);
    root.style.setProperty('--sk-hor-rgb', hexRgb(a.hor).join(','));
    root.style.setProperty('--sk-fog-rgb', hexRgb(a.fog).join(','));
    body.classList.toggle('moon-on', !!a.moon);
    if (!S.scene) FX.setWeather(a.wx);
    AUDIO.mood(name, instant);
    whenReady(() => {
      map.setPaintProperty('sat', 'raster-saturation', a.sat[0]);
      map.setPaintProperty('sat', 'raster-contrast', a.sat[1]);
      map.setPaintProperty('sat', 'raster-brightness-max', a.sat[2]);
      map.setSky(skyFor(a));
    });
  }
  function setTerr(k) {
    k = TERRS[k] ? k : TERR0;
    if (!k || S.terrK === k) return;
    S.terrK = k;
    whenReady(() => map.getSource('terr').setData(TERRS[k]));
  }
  function setAllr(on) {
    if (S.allOn === on) return;
    S.allOn = on;
    S.allT = on ? 0 : null;
    if (on) { const a = src('allr'); if (a) a.setData(EMPTY); }
    vis(['allr-glow', 'allr'], on);
  }
  function setAccent(hex) {
    S.accent = hex;
    root.style.setProperty('--accent', hex);
    root.style.setProperty('--accent-rgb', hexRgb(hex).join(','));
    whenReady(() => {
      ['prog-glow', 'prog-mid', 'prog-dash', 'ghost'].forEach(id => map.setPaintProperty(id, 'line-color', hex));
      try { if (map.hasImage('chev')) map.updateImage('chev', makeChev(hex)); else addImages(); } catch (e) { /* 忽略 */ }
    });
  }

  /* ================================================================ 章节模型 */
  function kmOf(ref, Mx) {
    Mx = Mx || M;
    if (!ref || !Mx.nodes.length) return null;
    const [k, n] = String(ref).split('@');
    const nd = n ? Mx.nodes.find(x => x.k === k && x.si === +n - 1) : Mx.nodes.find(x => x.k === k);
    return nd ? nd.km : null;
  }
  function buildModel(ch) {
    const Mx = { ch, segs: [], nodes: [], events: [], sides: [], wps: [], cands: [], total: 0, wpSet: new Set() };
    let off = 0;
    (ch.track || []).forEach(t => {
      const route = G.routes[t.r];
      if (!route) return;
      const dash = t.dash ? 1 : 0;
      const seg = { i: Mx.segs.length, r: t.r, route, v: t.v || 1, cap: t.cap || '', off, len: route.len, dash, who: t.who || '', flag: t.flag || '', by: t.by || '', dashName: t.dashName || '' };
      Mx.segs.push(seg);
      route.nodes.forEach(([k, km]) => Mx.nodes.push({ k, si: seg.i, km: off + km, ll: NODES[k] || routeAt(route, km) }));
      off += route.len;
    });
    Mx.total = off;
    (ch.side || []).forEach(s => {
      const route = G.routes[s.r];
      if (!route) return;
      const k0 = kmOf(s.from, Mx), k1 = kmOf(s.to, Mx);
      if (k0 == null || k1 == null) return;
      Mx.sides.push(Object.assign({}, s, { route, k0, k1: Math.max(k1, k0 + 1) }));
    });
    Object.keys(ch.stops || {}).forEach(ref => {
      const st = ch.stops[ref];
      if (!st || !(st.toast || st.scene || st.pulse || st.fx)) return;
      const km = kmOf(ref, Mx);
      if (km == null) return;
      Mx.events.push({ km, o: 0, key: ref.split('@')[0], st, fired: false });
    });
    Object.keys(ch.sideStops || {}).forEach(key => {
      const st = ch.sideStops[key];
      for (const s of Mx.sides) {
        const nd = s.route.nodes.find(n => n[0] === key);
        if (nd) { Mx.events.push({ km: s.k0 + (s.k1 - s.k0) * nd[1] / s.route.len, o: 1, key, st, side: s, fired: false }); break; }
      }
    });
    Mx.events.sort((a, b) => a.km - b.km || a.o - b.o);

    // 航点：主线节点、支线节点、提示点
    const byKey = new Map();
    const add = (k, km, ll, side) => {
      if (!NI[k] || byKey.has(k)) return;
      byKey.set(k, { k, km, ll: NODES[k] || ll, name: nameOf(k), desc: descOf(k), key: false, icon: null, side: side || null, done: null });
    };
    Mx.nodes.forEach(n => add(n.k, n.km, n.ll));
    Mx.sides.forEach(s => s.route.nodes.forEach(([k, km]) => add(k, s.k0 + (s.k1 - s.k0) * km / s.route.len, routeAt(s.route, km), s.k)));
    Mx.events.forEach(ev => {
      if (ev.st.pulse && NODES[ev.st.pulse]) add(ev.st.pulse, ev.km, NODES[ev.st.pulse], 'enemy');
      const w = byKey.get(ev.key);
      if (w && ev.st.scene) { w.key = true; w.icon = ev.st.scene.kind; w.scene = ev.st.scene.title; }
      else if (w && ev.st.toast) w.toast = true;
    });
    (ch.tour || []).forEach((t, i) => {
      if (typeof t.at === 'string') add(t.at, i, NODES[t.at]);
    });
    Mx.wps = Array.from(byKey.values()).filter(w => w.ll);
    Mx.wps.forEach(w => Mx.wpSet.add(w.k));
    // 考据候选
    const cs = new Map();
    (ch.debates || []).forEach(d => d.opts.forEach(o => {
      const ll = llOf(o.at);
      if (ll && !cs.has(o.at)) cs.set(o.at, { at: o.at, ll, name: o.n, tag: o.tag, hot: false });
    }));
    Mx.cands = Array.from(cs.values());
    return Mx;
  }
  function segAt(km) {
    const s = M.segs;
    for (let i = s.length - 1; i > 0; i--) if (km >= s[i].off) return s[i];
    return s[0];
  }
  function posAt(km) {
    const s = segAt(km);
    return routeAt(s.route, clamp(km - s.off, 0, s.len));
  }
  let lastHd = 0;
  function headingAt(km) {
    const a = posAt(Math.max(0, km - 6)), b = posAt(Math.min(M.total, km + 30));
    if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) < 1e-7) return lastHd;
    return (lastHd = bearingOf(a, b));
  }
  function elevAt(km) {
    if (!M.total) return 0;
    const s = segAt(km), r = s.route, local = clamp(km - s.off, 0, s.len), d = r.d, e = r.e;
    let lo = 0, hi = d.length - 1;
    if (local <= d[0]) return e[0];
    if (local >= d[hi]) return e[hi];
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (d[m] <= local) lo = m; else hi = m; }
    return lerp(e[lo], e[hi], (local - d[lo]) / ((d[hi] - d[lo]) || 1));
  }
  function nearestNode(km) {
    let best = null, bd = 1e9;
    M.nodes.forEach(n => { const d = Math.abs(n.km - km); if (d < bd && NI[n.k]) { bd = d; best = n; } });
    return best && bd < 60 ? best : null;
  }

  /* ================================================================ 叠加层（标注 · 航点 · 主将） */
  const OV = $('#overlay');
  const PRI = { region: 550, people: 500, mount: 450, water: 400, desert: 380, city: 350, modern: 200 };
  const labels = [];
  let headEl = null, headName = null, headFlag = null, headW = 120;
  let sideEls = [], chapTags = [];
  let overlayDirty = true;
  const HEAD = { el: null, tx: null, ty: null };

  function initLabels() {
    LABELS.forEach(([type, text, lon, lat, minZ, o]) => {
      o = o || {};
      const el = document.createElement('div');
      el.className = 'lb t-' + type + (o.big ? ' big' : '') + (o.cap ? ' cap' : '');
      let sub = o.s || '';
      if (o.peak && G.peaks[o.peak]) sub = '海拔 ' + fmt(G.peaks[o.peak][2]) + ' 米';
      el.innerHTML = esc(text) + (sub ? '<span class="s">' + esc(sub) + '</span>' : '');
      el.style.opacity = 0;
      OV.appendChild(el);
      let pri = PRI[type] || 300;
      if (type === 'city' && o.cap) pri = 650;
      if (type === 'region' && o.big) pri = 600;
      labels.push({
        el, type, ll: [lon, lat], minZ, maxZ: type === 'region' ? minZ + 3.2 : type === 'people' ? minZ + 4 : 99,
        chap: o.chap, node: o.node, pri, cap: !!o.cap, free: type === 'region' || (type === 'desert' && !!o.big),
        w: 0, h: 0, ax: 0, ay: 0, op: 0, tx: null, ty: null,
      });
    });
    headEl = document.createElement('div');
    headEl.id = 'head';
    headEl.innerHTML = '<i class="hd-pulse"></i><i class="hd-pulse b"></i><i class="hd-pole"></i><div class="hd-flag"><b>' + esc(HERO.flag) + '</b></div><i class="hd-dot"></i><span class="hd-name"></span>';
    OV.appendChild(headEl);
    headName = $('.hd-name', headEl); headFlag = $('.hd-flag', headEl);
    HEAD.el = headEl;
  }
  function anchorOf(l) {
    if (l.type === 'city') { l.ax = l.cap ? 4.5 : 3.5; l.ay = l.cap ? 9.5 : 8.5; }
    else if (l.type === 'mount') { l.ax = 5; l.ay = 8; }
    else if (l.type === 'modern') { l.ax = 5.5; l.ay = 5.5; }
    else { l.ax = l.w / 2; l.ay = l.h / 2; }
  }
  function measure() {
    labels.forEach(l => { l.w = l.el.offsetWidth; l.h = l.el.offsetHeight; anchorOf(l); });
    M.wps.forEach(w => { if (w.el) w.nw = $('.n', w.el).offsetWidth; });
    chapTags.forEach(t => { t.w = t.el.offsetWidth; t.h = t.el.offsetHeight; t.ax = t.w / 2; t.ay = t.h / 2; });
    sideEls.forEach(s => { const w = $('span', s.el).offsetWidth; if (w) s.sw = w; else s.swDirty = true; });
    if (headName) { const w = headName.offsetWidth; if (w) headW = w; else S.hwDirty = true; }
    overlayDirty = true;
  }
  function buildWaypoints() {
    // 本章同名地标（封狼居胥山、攻祁连山……）与邻近航点挤在一起时优先留下
    const ttl = (M.ch || S.ch || {}).title || '';
    $$('.wp,.cand,.sh', OV).forEach(e => e.remove());
    M.wps.forEach(w => {
      const el = document.createElement('div');
      el.className = 'wp' + (w.key ? ' key' : '');
      el.innerHTML = (w.icon && ICON[w.icon] ? '<div class="ic">' + ICON[w.icon] + '</div>' : '') + '<i class="d"></i><span class="n">' + esc(w.name) + '</span>';
      el.style.opacity = 0;
      el.addEventListener('mouseenter', e => wpTip(w, e));
      el.addEventListener('mousemove', e => moveTip(e));
      el.addEventListener('mouseleave', hideTip);
      el.addEventListener('click', () => onWp(w));
      OV.appendChild(el);
      w.el = el; w.nw = $('.n', el).offsetWidth; w.done = null; w.op = 0; w.tx = w.ty = null; w.pri = (w.key ? 900 : 800) + (ttl && String(w.name).indexOf(ttl) >= 0 ? 30 : 0); w.kind = 'wp';
    });
    M.cands.forEach(c => {
      const el = document.createElement('div');
      el.className = 'cand';
      el.innerHTML = '<i class="r"></i><span class="n">' + esc(c.name) + '<b>' + esc(c.tag) + '</b></span>';
      el.addEventListener('click', () => flyToSpot(c.ll, 'steel', 8));
      el.style.opacity = 0;
      OV.appendChild(el);
      c.el = el; c.nw = 0; c.op = 0; c.tx = c.ty = null; c.kind = 'cand';
    });
    sideEls = M.sides.map(s => {
      const el = document.createElement('div');
      el.className = 'sh k-' + s.k;
      el.innerHTML = '<i></i><span>' + esc(s.who) + '</span>';
      OV.appendChild(el);
      return { el, s, sw: $('span', el).offsetWidth || 90, on: false, op: 0, tx: null, ty: null, kind: 'sh', pri: 850 };
    });
    measure();
  }
  function buildChapTags() {
    chapTags.forEach(t => t.el.remove());
    chapTags = CH.filter(c => c.track).map(c => {
      const r = G.routes[c.track[0].r], mid = routeAt(r, r.len * 0.56);
      const el = document.createElement('div');
      el.className = 'lb t-chap';
      el.style.setProperty('--c', c.color);
      el.innerHTML = '<b>' + c.num + '</b>' + esc(c.title) + '<span class="s">' + esc(c.year) + ' · ' + fmt(c.track.reduce((a, t) => a + (G.routes[t.r] ? G.routes[t.r].len : 0), 0)) + ' 公里</span>';
      el.style.opacity = 0;
      el.addEventListener('click', () => loadChapter(CH.indexOf(c)));
      OV.appendChild(el);
      return { el, ll: mid, pri: 980, kind: 'chap', w: 0, h: 0, ax: 0, ay: 0, op: 0, tx: null, ty: null };
    });
  }

  function setPos(it, x, y) {
    const tx = Math.round(x * 2) / 2, ty = Math.round(y * 2) / 2;
    if (tx !== it.tx || ty !== it.ty) { it.el.style.transform = 'translate3d(' + tx + 'px,' + ty + 'px,0)'; it.tx = tx; it.ty = ty; }
  }
  function setOp(it, op) {
    if (it.op === op) return;
    it.op = op;
    it.el.style.opacity = op;
    if (it.kind === 'wp' || it.kind === 'cand' || it.kind === 'chap') it.el.style.pointerEvents = op > 0 ? '' : 'none';
  }

  function drawOverlay() {
    overlayDirty = false;
    if (S.mode === 'intro') return;
    const W = innerWidth, H = innerHeight, z = map.getZoom(), pitch = map.getPitch(), brg = map.getBearing();
    const cen = map.getCenter(), cll = [cen.lng, cen.lat];
    const tr = map.transform;
    const mpp = 40075.016 * Math.cos(cen.lat * D2R) / (512 * Math.pow(2, z));
    const maxD = pitch > 45 ? 1.6 * W * mpp : 1e9;
    const camBack = ((tr && tr.cameraToCenterDistance) || H * 1.5) * Math.sin(pitch * D2R) * mpp * 0.92;
    const occl = tr && typeof tr.isLocationOccluded === 'function';
    const proj = ll => {
      if (pitch > 30) {
        const d = distKm(cll, ll);
        if (d > maxD) return null;
        if (d > camBack * 0.5 && d * Math.cos((bearingOf(cll, ll) - brg) * D2R) < -camBack) return null;
      }
      if (occl && z < 6) { try { if (tr.isLocationOccluded(new maplibregl.LngLat(ll[0], ll[1]))) return null; } catch (e) { /* 忽略 */ } }
      const p = map.project(ll);
      if (!(p.x > -90 && p.x < W + 90 && p.y > -70 && p.y < H + 70)) return null;
      return p;
    };
    const noLab = body.classList.contains('no-labels'), noMod = body.classList.contains('no-modern'), showC = body.classList.contains('show-cands');
    const allMode = S.mode === 'all';
    const chapId = allMode ? '__all' : (S.ch && S.ch.id);
    const list = [];
    const blockers = uiBlockers();
    const hitUI = r => blockers.some(q => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]);

    // 主将
    const headOn = !!(M.total && !S.scene && !allMode && S.mode !== 'intro');
    if (headOn) {
      const hl = posAt(S.km), p = proj(hl);
      if (p) {
        if (headEl.style.display !== 'block') headEl.style.display = 'block';
        if (S.hwDirty) { headW = headName.offsetWidth || headW; S.hwDirty = false; }
        setPos(HEAD, p.x, p.y);
        S.headP = p;
        // 名牌贴到屏幕右缘或压到面板时挂到旗杆左侧
        const NR = [p.x + 10, p.y - 26, p.x + 18 + headW, p.y], NL = [p.x - 8 - headW, p.y - 26, p.x - 2, p.y];
        const flip = NL[0] >= 4 && (NR[2] > W - 4 || (hitUI(NR) && !hitUI(NL)));
        if (S.headFlip !== flip) { S.headFlip = flip; headEl.classList.toggle('flip', flip); }
        list.push({ fixed: true, r: flip ? [p.x - 10 - headW, p.y - 62, p.x + 46, p.y + 26] : [p.x - 26, p.y - 62, p.x + 16 + headW, p.y + 26], pri: 1000 });
      } else { headEl.style.display = 'none'; S.headP = null; }
    } else if (headEl.style.display !== 'none') { headEl.style.display = 'none'; S.headP = null; }

    // 支线将领
    sideEls.forEach(it => {
      const s = it.s, on = !allMode && !S.scene && M.total && S.km >= s.k0 && S.km <= s.k1 + 40;
      let p = null;
      if (on) p = proj(routeAt(s.route, clamp((S.km - s.k0) / (s.k1 - s.k0), 0, 1) * s.route.len));
      if (!p) { if (it.on) { it.el.style.display = 'none'; it.on = false; } return; }
      if (!it.on) { it.el.style.display = 'block'; it.on = true; }
      if (it.swDirty) { it.sw = $('span', it.el).offsetWidth || it.sw || 90; it.swDirty = false; }
      setPos(it, p.x, p.y);
      const near = !!(S.headP && Math.hypot(p.x - S.headP.x, p.y - S.headP.y) < 120);
      if (it.near !== near) { it.near = near; it.el.classList.toggle('near', near); }
      // 名牌默认挂在右侧；压到面板或越出屏幕右缘时翻到左侧
      const R = [p.x - 7, p.y - 27, p.x + 14 + it.sw, p.y + 7], L = [p.x - 14 - it.sw, p.y - 27, p.x + 7, p.y + 7];
      const left = !near && L[0] >= 4 && (R[2] > W - 4 || (hitUI(R) && !hitUI(L)));
      if (it.left !== left) { it.left = left; it.el.classList.toggle('left', left); }
      list.push({ fixed: true, r: near ? [p.x - 7, p.y - 7, p.x + 7, p.y + 7] : left ? L : R, pri: 850 });
    });

    // 航点
    M.wps.forEach(w => {
      const p = allMode ? null : proj(w.ll);
      if (!p) { setOp(w, 0); return; }
      setPos(w, p.x, p.y);
      w.x = p.x; w.y = p.y;
      list.push(w);
    });
    // 考据候选
    M.cands.forEach(c => {
      const p = (showC && !allMode) ? proj(c.ll) : null;
      if (!p) { setOp(c, 0); return; }
      if (!c.nw) c.nw = $('.n', c.el).offsetWidth;
      setPos(c, p.x, p.y);
      c.x = p.x; c.y = p.y; c.pri = c.hot ? 950 : 700;
      list.push(c);
    });
    // 全图章节标签
    const tagsOn = allMode || S.allOn;
    chapTags.forEach(t => {
      const p = tagsOn ? proj(t.ll) : null;
      if (!p) { setOp(t, 0); return; }
      if (!t.w) { t.w = t.el.offsetWidth; t.h = t.el.offsetHeight; t.ax = t.w / 2; t.ay = t.h / 2; }
      t.x = p.x; t.y = p.y;
      list.push(t);
    });
    // 地名
    labels.forEach(l => {
      let ok = z >= l.minZ && z < l.maxZ;
      if (ok && l.chap) ok = l.chap.indexOf(chapId) >= 0;
      if (ok && l.node && M.wpSet.has(l.node) && !allMode) ok = false;
      if (ok && (l.type === 'modern' ? noMod : noLab)) ok = false;
      const p = ok ? proj(l.ll) : null;
      if (!p) { setOp(l, 0); return; }
      setPos(l, p.x - l.ax, p.y - l.ay);
      l.x = p.x; l.y = p.y;
      list.push(l);
    });

    list.sort((a, b) => b.pri - a.pri);
    const placed = blockers.slice(), keyR = blockers.slice(), frees = [];
    const hitIn = (arr, r) => {
      for (let i = 0; i < arr.length; i++) { const q = arr[i]; if (r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]) return true; }
      return false;
    };
    const hit = r => hitIn(placed, r);
    const padR = (r, m) => [r[0] - m, r[1] - m, r[2] + m, r[3] + m];
    const chapR = [];
    for (const it of list) {
      if (it.fixed) { placed.push(it.r); keyR.push(it.r); continue; }
      if (it.kind === 'wp') {
        const top = it.icon ? it.y - 43 : it.y - 12;
        const R = [it.x - 8, top, it.x + 14 + it.nw, it.y + 11];
        if (it.x < 6 || it.x > W - 6 || top < 4 || it.y > H - 4) { setOp(it, 0); continue; }
        let left = false;
        if (hit(R) || R[2] > W - 4) {
          const L = [it.x - 14 - it.nw, top, it.x + 8, it.y + 11];
          if (hit(L) || L[0] < 4) { setOp(it, 0); continue; }
          left = true;
        }
        if (it.left !== left) { it.left = left; it.el.classList.toggle('left', left); }
        const PR = padR(left ? [it.x - 14 - it.nw, top, it.x + 8, it.y + 11] : R, 2);
        placed.push(PR); keyR.push(PR);
        setOp(it, 1);
        continue;
      }
      if (it.kind === 'cand') {
        const R = [it.x - 10, it.y - 12, it.x + 16 + it.nw, it.y + 12];
        if (hit(R)) { setOp(it, 0); continue; }
        placed.push(padR(R, 2)); keyR.push(R); setOp(it, 1);
        continue;
      }
      if (it.kind === 'chap') {
        let R = [it.x - it.ax, it.y - it.ay, it.x + it.ax, it.y + it.ay];
        if (hitIn(chapR, padR(R, 3))) {
          for (const k of [-1, 1, -2, 2, -3, 3]) {
            const d = k * (it.h + 6), Q = [R[0], R[1] + d, R[2], R[3] + d];
            if (Q[1] > 4 && Q[3] < H - 4 && !hitIn(chapR, padR(Q, 3))) { R = Q; break; }
          }
        }
        setPos(it, R[0], R[1]);
        chapR.push(R); placed.push(padR(R, 4)); keyR.push(R); setOp(it, 1);
        continue;
      }
      const R = [it.x - it.ax, it.y - it.ay, it.x - it.ax + it.w, it.y - it.ay + it.h];
      if (it.free) { frees.push([it, R]); continue; }
      if (hit(R) || R[0] < 4 || R[2] > W - 4 || R[1] < 4 || R[3] > H - 4) { setOp(it, 0); continue; }
      placed.push(padR(R, 3));
      setOp(it, 1);
    }
    // 区域名：贴边、压住关键标注或彼此重叠时隐去
    const fr = [];
    frees.forEach(([it, R]) => {
      const bad = R[0] < 8 || R[2] > W - 8 || R[1] < 8 || R[3] > H - 8 || hitIn(keyR, R) || hitIn(fr, R);
      if (!bad) fr.push(padR(R, 8));
      setOp(it, bad ? 0 : 1);
    });
  }
  // 界面面板所占区域：其下的地名与航点让位
  let blkT = -1e9, blk = [];
  function uiBlockers() {
    const now = performance.now();
    if (now - blkT < 250) return blk;
    blkT = now;
    blk = [];
    const add = el => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || r.right < 0 || r.left > innerWidth || r.bottom < 0 || r.top > innerHeight) return;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.1) return;
      blk.push([r.left - 4, r.top - 4, r.right + 4, r.bottom + 4]);
    };
    ['#topbar', '#hud', '#legend', '#dossier', '#dossier-toggle', '#dock', '#tour-card', '#scene-card', '#chapter-end', '#caption', '#layers-panel'].forEach(sel => add($(sel)));
    $$('#toasts .toast').forEach(add);
    return blk;
  }

  /* ================================================================ 界面元素 */
  const HUD = { ll: $('#hud-ll'), el: $('#hud-el'), km: $('#hud-km'), cam: $('#hud-cam'), rose: $('.c-rose') };
  const dkCap = $('#dk-cap'), dkKm = $('#dk-km'), capEl = $('#caption'), toastBox = $('#toasts');
  const scCard = $('#scene-card'), tourCard = $('#tour-card'), ceEl = $('#chapter-end'), subEl = $('#subtitle'), tipEl = $('#tip');
  const dzHead = $('#dz-head'), dzBody = $('#dz-body');
  const PF = { el: $('#profile'), tip: $('#pf-tip'), w: 600, all: false, Y: null, clip: null, ph: null, phd: null, hv: null, hi: 0 };
  const FLY = 2.6;
  const SVG_REPLAY = '<svg viewBox="0 0 24 24"><path d="M12 5a7 7 0 1 1-6.6 4.7l1.9.6A5 5 0 1 0 12 7v3L7.5 6 12 2z"/></svg>';
  let capTimer = 0, dzTab = 'report', roseAng = 0;

  function caption(html, ms) {
    capEl.innerHTML = html;
    capEl.classList.add('on');
    clearTimeout(capTimer);
    capTimer = setTimeout(() => capEl.classList.remove('on'), ms || 5000);
  }
  function toast(name, sub, text) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = '<h6>' + esc(name) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</h6><p>' + fill(text) + '</p>';
    toastBox.appendChild(el);
    while (toastBox.children.length > 3) toastBox.firstChild.remove();
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('on')));
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 700); }, 7600);
  }
  function setSubtitle(text) {
    const old = $$('p', subEl).filter(p => !p.classList.contains('out'));
    old.forEach(p => {
      p.style.transitionDelay = '0s';
      p.classList.remove('on'); p.classList.add('out');
      setTimeout(() => p.remove(), 450);
    });
    if (!text) return;
    const p = document.createElement('p');
    p.textContent = text;
    if (old.length) p.style.transitionDelay = '.36s';
    subEl.appendChild(p);
    requestAnimationFrame(() => requestAnimationFrame(() => p.classList.add('on')));
  }
  function pad() {
    const open = innerWidth > 860 && !body.classList.contains('dz-closed') && S.mode !== 'scene';
    let bottom = innerWidth > 860 ? 150 : Math.max(180, (S.dockH || 0) + 30);
    if (S.mode === 'end') bottom += ceEl.offsetHeight + 24;   // 章末面板压在播放条上方，别让路线钻到面板底下
    return { top: 96, bottom, left: 40, right: open ? S.dzW + 40 : 40 };
  }
  // 数据文字里的占位：{km:a>b}、{li:a>b}、{km:all}
  function fill(s) {
    if (s == null) return '';
    s = String(s).replace(/\{(km|li):([\w@]+)(?:>([\w@]+))?\}/g, (m, u, a, b) => {
      let km = null;
      if (a === 'all') km = ALL_KM;
      else { const ka = kmOf(a), kb = kmOf(b); if (ka != null && kb != null) km = Math.abs(kb - ka); }
      if (km == null) return '若干';
      return '\u0001' + fmt(u === 'li' ? km / HANLI : km) + '\u0002';
    });
    return esc(s).replace(/\u0001/g, '<b>').replace(/\u0002/g, '</b>');
  }
  function countUp(els, ms, delay) {
    const t0 = performance.now() + (delay || 0);
    const step = now => {
      const k = easeOut((now - t0) / ms);
      els.forEach(el => { const u = el.dataset.u || ''; el.innerHTML = fmt(+el.dataset.v * k) + (u ? '<small>' + esc(u) + '</small>' : ''); });
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  const chapterKm = c => (c.track || []).reduce((a, t) => a + (G.routes[t.r] ? G.routes[t.r].len : 0), 0);
  const shortCap = c => String(c || '').split(/[：，·]/)[0].trim().slice(0, 10);
  const yearShort = c => { const f = v => String(v || '').replace(/\s*—.*$/, '').replace(/年/g, '').replace(/\s+/g, ' ').trim(); return f(c.year) || f(c.era); };

  /* ================================================================ 行军 */
  function setKm(km, quiet) {
    S.km = clamp(km, 0, M.total || 0);
    if (!M.total) return;
    const seg = segAt(S.km);
    if (seg.i !== S.lastSeg) {
      S.lastSeg = seg.i;
      // 队首名牌写 track[].who；track[].flag 换旗字（旗子同时换成紫色）
      headName.textContent = seg.who || HERO.name || '';
      headFlag.classList.toggle('hun', !!seg.flag);
      headEl.classList.toggle('boat', seg.by === 'boat');
      $('b', headFlag).textContent = seg.flag || HERO.flag || '';
      S.hwDirty = true;
      dkCap.innerHTML = '<i>' + (seg.i + 1) + ' / ' + M.segs.length + '</i>' + esc(seg.cap);
      if (!quiet) caption('<b>' + esc(S.ch.num) + ' · ' + (seg.i + 1) + '</b>' + esc(seg.cap), 5200);
      overlayDirty = true;
    }
    updateProg();
  }
  function updateProg(force) {
    const now = performance.now();
    if (!force && now - S.lastProg < 33) return;
    S.lastProg = now;
    if (!M.total) return;
    const f = [];
    M.segs.forEach(s => {
      if (S.km <= s.off + 0.01) return;
      f.push(lineF(cut(s.route, Math.min(s.len, S.km - s.off)), { dash: s.dash }));
    });
    const sp = [];
    M.sides.forEach(s => {
      if (S.km <= s.k0 + 0.01) return;
      sp.push(lineF(cut(s.route, clamp((S.km - s.k0) / (s.k1 - s.k0), 0, 1) * s.route.len), { k: s.k }));
    });
    const a = src('prog'), b = src('sidep');
    if (a) a.setData(fc(f));
    if (b) b.setData(fc(sp));
    M.wps.forEach(w => {
      const d = S.km >= w.km - 0.6;
      if (w.done !== d) { w.done = d; if (w.el) w.el.classList.toggle('done', d); }
    });
  }
  function stepMarch(dt) {
    if (!S.playing || !M.total) return;
    const seg = segAt(S.km);
    const nk = S.km + 32 * (seg.v || 1) * S.speed * dt;
    const ev = M.events.find(e => !e.fired);
    if (ev && nk >= ev.km) {
      setKm(Math.max(S.km, ev.km));
      ev.fired = true;
      fire(ev);
      return;
    }
    if (nk >= M.total) { setKm(M.total); updateProg(true); chapterEnd(); return; }
    setKm(nk);
  }
  function fire(ev) {
    const st = ev.st, ll = llOf(ev.key) || posAt(ev.km);
    if (st.pulse) { const pl = llOf(st.pulse); if (pl) FX.ping(pl, st.pulseSide || SITE.pulseSide || ((SITE.factions || [])[1] || {}).k || 'xn', 7, 90); }
    if (st.fx === 'cross') { FX.ping(ll, 'water', 5, 70); AUDIO.play('water'); }
    if (st.toast) {
      toast(nameOf(ev.key), descOf(ev.key), st.toast);
      AUDIO.play('tick');
      FX.ping(ll, 'gold', 4, 60);
    }
    if (st.scene) startScene(st.scene, ev);
  }
  // 截图脚本用：直接触发本章第 i 个事件（演出 / 提示），不用等行进标记走到
  function fireAt(i) {
    const ev = M.events[i];
    if (!ev) return false;
    seek(ev.km, false);
    M.events.forEach(e => { e.fired = e === ev || e.km < ev.km - 0.01; });
    fire(ev);
    return true;
  }
  function seek(km, play) {
    if (!M.total) return;
    if (S.scene) finishScene();
    hideEnd();
    km = clamp(km, 0, M.total);
    M.events.forEach(e => { e.fired = e.km < km - 0.01; });
    S.lastSeg = -1;
    S.mode = 'march';
    setKm(km, true);
    updateProg(true);
    if (S.cam !== 'follow') setCam('follow');
    CAM.c = null;
    if (play) setPlaying(true);
    updateActs();
  }

  /* ================================================================ 跟随镜头 */
  function camTarget() {
    const v = S.ch.view, seg = segAt(S.km);
    const head = posAt(S.km), ahead = posAt(Math.min(M.total, S.km + 70));
    return {
      c: [lerp(head[0], ahead[0], 0.35), lerp(head[1], ahead[1], 0.35)],
      z: v.z + 0.7 - ((seg.v || 1) > 2 ? 0.8 : 0),
      p: v.p,
      b: seg.dash ? null : headingAt(S.km),
    };
  }
  function updateCam(dt) {
    if (S.cam !== 'follow' || !M.total) return;
    if (map.isEasing && map.isEasing()) return;
    const T = camTarget();
    if (!CAM.c) {
      const c = map.getCenter();
      CAM.c = [c.lng, c.lat]; CAM.z = map.getZoom(); CAM.p = map.getPitch(); CAM.b = map.getBearing();
      CAM.pad = Object.assign({ top: 0, bottom: 0, left: 0, right: 0 }, map.getPadding());
    }
    const k1 = 1 - Math.exp(-dt / 0.35), k2 = 1 - Math.exp(-dt / 1.4), k3 = 1 - Math.exp(-dt / 2.6);
    const P = pad();
    const before = CAM.c[0] + CAM.c[1] + CAM.z + CAM.p + CAM.b + CAM.pad.right;
    CAM.c = [lerp(CAM.c[0], T.c[0], k1), lerp(CAM.c[1], T.c[1], k1)];
    CAM.z = lerp(CAM.z, T.z, k2);
    CAM.p = lerp(CAM.p, T.p, k2);
    if (T.b != null) CAM.b = CAM.b + angDiff(CAM.b, T.b) * k3;
    ['top', 'bottom', 'left', 'right'].forEach(k => { CAM.pad[k] = lerp(CAM.pad[k] || 0, P[k], k2); });
    const after = CAM.c[0] + CAM.c[1] + CAM.z + CAM.p + CAM.b + CAM.pad.right;
    if (!S.playing && Math.abs(after - before) < 1e-6) return;
    map.jumpTo({ center: CAM.c, zoom: CAM.z, pitch: CAM.p, bearing: CAM.b, padding: CAM.pad });
  }
  // 截图脚本（scripts/shoot.py）用：镜头立刻摆到跟随位置，不等缓动
  function snapCam() {
    if (!M.total) return;
    const T = camTarget();
    CAM.c = T.c; CAM.z = T.z; CAM.p = T.p;
    if (T.b != null) CAM.b = T.b;
    CAM.pad = Object.assign({}, pad());
    map.stop();
    map.jumpTo({ center: CAM.c, zoom: CAM.z, pitch: CAM.p, bearing: CAM.b, padding: CAM.pad });
  }
  function setCam(m, silent) {
    S.cam = m;
    $$('#cam button').forEach(b => b.classList.toggle('on', b.dataset.v === m));
    if (silent) return;
    if (m === 'follow') {
      CAM.c = null;
      if (S.tour) { const st = S.tour.st; S.tour.user = false; map.flyTo({ center: S.tour.at, zoom: st.z || 7, pitch: st.p != null ? st.p : 50, bearing: st.b || 0, duration: 1800, padding: pad(), essential: true }); }
      if (S.mode === 'end' && M.total) { hideEnd(); S.mode = 'march'; }
    } else if (m === 'overview') {
      if (S.mode === 'all') fitAll(); else fitChapter();
    }
  }
  // 地球投影下 fitBounds 遇到大边距与俯仰角时估算偏差很大（路线偏到一侧、只占可用区域四成）。
  // 以它的结果为初值，在同一帧内试摆镜头、实测投影包围盒、迭代修正缩放与中心，最后恢复原镜头再飞过去。
  function solveFit(pts, o) {
    const cv = map.getContainer(), W = cv.clientWidth, H = cv.clientHeight, P = o.padding;
    const aw = W - P.left - P.right, ah = H - P.top - P.bottom, tx = P.left + aw / 2, ty = P.top + ah / 2;
    const b = new maplibregl.LngLatBounds(pts[0], pts[0]);
    pts.forEach(p => b.extend(p));
    const zero = { top: 0, bottom: 0, left: 0, right: 0 };
    const save = { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing(), padding: map.getPadding() };
    // cameraForBounds 会把地图当前的 padding 叠加进来，边距大时直接算不出（MapLibre 内部报错）：先清零再估算
    let est = null;
    try { map.jumpTo({ padding: zero }); est = map.cameraForBounds(b, o); } catch (e) { est = null; }
    if (!est || aw < 60 || ah < 60) { map.jumpTo(save); return est; }
    const box = () => {
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      pts.forEach(p => { const q = map.project(p); if (q.x < x0) x0 = q.x; if (q.x > x1) x1 = q.x; if (q.y < y0) y0 = q.y; if (q.y > y1) y1 = q.y; });
      return [x0, y0, x1, y1];
    };
    let c = est.center, z = est.zoom;
    try {
      for (let i = 0; i < 4; i++) {
        map.jumpTo({ center: c, zoom: z, pitch: o.pitch, bearing: o.bearing, padding: zero });
        let q = box();
        z = Math.min(o.maxZoom, z + Math.log2(Math.min(aw / Math.max(1, q[2] - q[0]), ah / Math.max(1, q[3] - q[1]))));
        map.jumpTo({ zoom: z });
        q = box();
        const dx = (q[0] + q[2]) / 2 - tx, dy = (q[1] + q[3]) / 2 - ty;
        c = map.unproject([W / 2 + dx, H / 2 + dy]);
        if (Math.abs(dx) < 1.5 && Math.abs(dy) < 1.5) break;
      }
    } catch (e) {
      c = est.center; z = est.zoom;
    } finally {
      map.jumpTo(save);
    }
    return { center: c, zoom: z, pitch: o.pitch, bearing: o.bearing, padding: zero };
  }
  function fitPts(pts, dur, opt) {
    if (!pts.length) return;
    const P = pad(), nar = innerWidth <= 600;
    const o = Object.assign({
      padding: nar ? { top: P.top + 36, bottom: P.bottom + 40, left: 30, right: 30 } : { top: P.top + 30, bottom: P.bottom + 40, left: P.left + 50, right: P.right + 30 },
      pitch: nar ? 34 : 40, bearing: S.ch && S.ch.view ? S.ch.view.b || 0 : 0, maxZoom: 7.5,
    }, opt || {});
    // 面板多、屏幕矮时边距可能比画面还大：按比例压缩，至少给路线留三成高度、四成宽度
    const cv = map.getContainer(), p = o.padding = Object.assign({}, o.padding);
    const vh = p.top + p.bottom, hw = p.left + p.right;
    if (cv.clientHeight - vh < cv.clientHeight * 0.3) { const k = cv.clientHeight * 0.7 / vh; p.top *= k; p.bottom *= k; }
    if (cv.clientWidth - hw < cv.clientWidth * 0.4) { const k = cv.clientWidth * 0.6 / hw; p.left *= k; p.right *= k; }
    map.stop();
    const cam = solveFit(pts, o);
    if (cam) map.flyTo(Object.assign(cam, { duration: dur || 2600, essential: true }));
  }
  function fitChapter(dur) {
    const pts = [];
    const push = c => { for (let i = 0; i < c.length; i += 4) pts.push(c[i]); pts.push(c[c.length - 1]); };
    const box = arr => arr.reduce((a, p) => [Math.min(a[0], p[0]), Math.min(a[1], p[1]), Math.max(a[2], p[0]), Math.max(a[3], p[1])], [1e9, 1e9, -1e9, -1e9]);
    M.segs.forEach(s => push(s.route.c));
    // 手机竖屏可用宽度只有两百来像素：与主线不相邻的远方支线（如祁连之战东路的李广、张骞）不计入取景，免得主线缩成一团
    let nb = null;
    if (pts.length && innerWidth <= 600) {
      const a = box(pts), mx = (a[2] - a[0]) * 0.35 + 0.5, my = (a[3] - a[1]) * 0.35 + 0.5;
      nb = [a[0] - mx, a[1] - my, a[2] + mx, a[3] + my];
    }
    M.sides.forEach(s => {
      if (nb) { const b = box(s.route.c); if (b[2] < nb[0] || b[0] > nb[2] || b[3] < nb[1] || b[1] > nb[3]) return; }
      push(s.route.c);
    });
    if (!pts.length && S.ch && S.ch.tour) S.ch.tour.forEach(t => { const ll = llOf(t.at); if (ll && !t.all) pts.push(ll); });
    fitPts(pts, dur);
  }
  function fitAll(dur) {
    const pts = [];
    CH.forEach(c => (c.track || []).forEach(t => { const r = G.routes[t.r]; if (r) for (let i = 0; i < r.c.length; i += 6) pts.push(r.c[i]); }));
    const P = pad();
    fitPts(pts, dur || 3200, { pitch: 26, bearing: 0, maxZoom: 6, padding: { top: 104, bottom: P.bottom + 16, left: 80, right: P.right + 16 } });
  }

  /* ================================================================ 战役演出 */
  function sceneStats(sc) {
    return (sc.stats || []).map(s => {
      if (s.e) {
        const e = G.peaks[s.e] ? G.peaks[s.e][2] : (G.nodeElev && G.nodeElev[s.e] != null ? G.nodeElev[s.e] : null);
        return e == null ? null : { v: Math.round(e), u: '米', l: s.l };
      }
      return s;
    }).filter(Boolean);
  }
  // 诗作卡：scene.poem = { t: '题目', a: '作者', l: ['第一句', ...], s: '出处', at: [每句出现的秒数，可省] }
  const poemEl = document.createElement('section');
  poemEl.id = 'poem';
  poemEl.setAttribute('aria-live', 'polite');
  document.body.appendChild(poemEl);
  let poemLines = [];
  function renderPoem(p) {
    poemLines = [];
    body.classList.toggle('poem-on', !!(p && p.l && p.l.length));
    if (!p || !p.l || !p.l.length) { poemEl.className = ''; poemEl.innerHTML = ''; return; }
    poemEl.innerHTML = '<div class="pm-in"><div class="pm-h"><b>' + esc(p.t || '') + '</b>' + (p.a ? '<em>' + esc(p.a) + '</em>' : '') + '</div>' +
      '<div class="pm-l">' + p.l.map(x => '<p>' + esc(x) + '</p>').join('') + '</div>' + (p.s ? '<cite>' + esc(p.s) + '</cite>' : '') + '</div>';
    poemLines = $$('.pm-l p', poemEl);
    poemEl.className = 'on' + (p.l.length > 8 ? ' long' : '');
  }
  function updatePoem(sc, t, dur) {
    const p = sc.poem;
    if (!p || !poemLines.length) return;
    const gap = Math.max(0.7, Math.min(2.4, (dur * 0.7) / poemLines.length));
    poemLines.forEach((el, i) => el.classList.toggle('on', t >= (p.at && p.at[i] != null ? p.at[i] : 0.4 + i * gap)));
  }
  // 标题偏长时自动缩小字号（不算空格；8–9 字 long，10 字以上 xl）
  // 标题偏长时自动缩小字号（不算空格）。默认按场景标题：8–9 字 long，10 字以上 xl
  function titleCls(s, long, xl) {
    const n = String(s || '').replace(/\s/g, '').length;
    return n >= (xl || 10) ? ' xl' : n >= (long || 8) ? ' long' : '';
  }
  function renderSceneCard(sc) {
    const st = sceneStats(sc);
    scCard.innerHTML =
      '<div class="sc-kind"><i>' + (KIND_N[sc.kind] || '') + '</i>' + esc(sc.kicker || '') + '</div>' +
      '<div class="sc-title' + titleCls(sc.title) + '">' + esc(sc.title) + '</div>' +
      (st.length ? '<div class="sc-stats">' + st.map(s => '<div class="sc-st">' +
        (s.t ? '<div class="v t">' + esc(s.t) + '</div>' : '<div class="v" data-v="' + s.v + '" data-u="' + esc(s.u || '') + '">0' + (s.u ? '<small>' + esc(s.u) + '</small>' : '') + '</div>') +
        '<div class="l">' + esc(s.l) + '</div></div>').join('') + '</div>' : '') +
      (sc.quote ? '<div class="sc-q"><p>' + esc(sc.quote.t) + '</p><cite>' + esc(sc.quote.s) + '</cite></div>' : '') +
      relicHtml(sc.relic) +
      '<div class="sc-prog"><i></i></div>' +
      '<div class="sc-btns"><button class="btn" data-a="replay">' + SVG_REPLAY + '重播</button><button class="btn pri" data-a="next">继续<small></small></button></div>';
  }
  function scheduleSfx(s, from) {
    (s.sc.sfx || []).forEach(([sec, name]) => { if (sec >= from - 0.001) AUDIO.play(name, sec - from); });
  }
  // 手机竖屏的诗作演出：诗作卡压在下半屏，把镜头中心挪到场景卡和诗作卡之间的空当
  function scenePad() {
    const z = { top: 0, bottom: 0, left: 0, right: 0 }, cv = map.getContainer(), H = cv.clientHeight;
    if (!matchMedia('(max-width:760px)').matches || !body.classList.contains('poem-on')) return z;
    const pm = poemEl.querySelector('.pm-in'), card = document.getElementById('scene-card');
    if (!pm) return z;
    const top = card ? card.getBoundingClientRect().bottom : 0, y = (top + pm.getBoundingClientRect().top - 10) / 2;
    return y > 40 && y < H / 2 ? Object.assign(z, { bottom: Math.round(H - 2 * y) }) : z;
  }

  function startScene(sc, ev) {
    const at = llOf(sc.at) || (ev ? (llOf(ev.key) || posAt(ev.km)) : map.getCenter().toArray());
    hideTip();
    S.mode = 'scene';
    const zs = (sc.z || 9) + (sc.units && sc.units.length ? 0.75 : 0) + (map.getContainer().clientWidth < 600 ? -0.45 : 0);
    S.scene = { sc, ev, at, z: zs, t: -FLY, user: false, hold: 0, line: -1, shown: false, counted: false, c0: 0 };
    body.classList.add('scene');
    body.classList.toggle('mode-cut', sc.kind === 'cut');
    $$('.toast', toastBox).forEach(t => t.classList.add('out'));
    capEl.classList.remove('on');
    map.stop();
    renderSceneCard(sc);
    renderPoem(sc.poem);
    map.flyTo({ center: at, zoom: zs, pitch: sc.p != null ? sc.p : 60, bearing: sc.b || 0, duration: FLY * 1000, curve: 1.3, padding: scenePad(), essential: true });
    FX.startShow(sc, at);
    FX.setShowTime(0, 0);
    if (sc.weather) FX.setWeather(sc.weather);
    if (S.playing) { AUDIO.beginScene(); scheduleSfx(S.scene, -FLY); }
    AUDIO.play('whoosh');
    setSubtitle('');
    overlayDirty = true;
    updateActs();
  }
  function updateScene(dt) {
    const s = S.scene;
    if (!s) return;
    const sc = s.sc, dur = sc.dur || 10;
    if (S.playing) s.t += dt;
    const t = s.t;
    FX.setShowTime(Math.max(0, t), clamp((t + 0.9) / 0.9, 0, 1));
    if (t >= 0 && S.playing && !s.user && !(map.isEasing && map.isEasing())) {
      const k = clamp(t / dur, 0, 1), e = k * k * (3 - 2 * k);
      map.jumpTo({ bearing: (sc.b || 0) + (sc.orbit || 0) * e, zoom: s.z + 0.3 * e });
    }
    if (!s.shown && t > -1.6) { s.shown = true; s.c0 = t; scCard.classList.add('on'); }
    if (s.shown && !s.counted) {
      const k = easeOut((t - s.c0) / 1.6);
      $$('.sc-st .v[data-v]', scCard).forEach(el => { const u = el.dataset.u; el.innerHTML = fmt(+el.dataset.v * k) + (u ? '<small>' + esc(u) + '</small>' : ''); });
      if (k >= 1) s.counted = true;
    }
    const lines = sc.lines || [];
    let li = -1;
    for (let i = 0; i < lines.length; i++) if (lines[i][0] <= t) li = i;
    if (li !== s.line) { s.line = li; setSubtitle(li >= 0 ? lines[li][1] : ''); }
    updatePoem(sc, t, dur);
    const bar = $('.sc-prog i', scCard);
    if (bar) bar.style.width = (clamp(t / dur, 0, 1) * 100).toFixed(2) + '%';
    if (t >= dur) {
      if (S.playing) s.hold += dt;
      const sm = $('[data-a="next"] small', scCard);
      if (sm) sm.textContent = S.playing ? Math.max(1, Math.ceil(4 - s.hold)) + ' 秒' : '';
      if (s.hold >= 4) finishScene();
    }
  }
  function finishScene() {
    const s = S.scene;
    if (!s) return;
    S.scene = null;
    FX.stopShow();
    AUDIO.endScene(1.2);
    body.classList.remove('scene', 'mode-cut');
    scCard.classList.remove('on');
    renderPoem(null);
    setSubtitle('');
    FX.setWeather(S.wx);
    S.mode = 'march';
    CAM.c = null;
    if (S.cam === 'overview') fitChapter();
    overlayDirty = true;
    updateActs();
  }
  function replayScene() {
    const s = S.scene;
    if (!s) return;
    FX.stopShow();
    AUDIO.endScene(0.2);
    S.scene = null;
    S.playing = true; body.classList.add('playing');
    startScene(s.sc, s.ev);
  }

  /* ================================================================ 巡游（序章 · 尾声） */
  function startTour(i) {
    const tour = S.ch && S.ch.tour;
    if (!tour) return;
    if (i >= tour.length) { clearTour(); chapterEnd(); return; }
    clearTour();
    hideEnd();
    const st = tour[i], at = llOf(st.at);
    S.mode = 'tour';
    S.tour = { i, st, at, t: 0, dur: Math.max(st.dur || 8, 7) + 2.2, user: false, route: st.route ? G.routes[st.route] : null, fr: -1 };
    if (S.cam !== 'free') {
      map.stop();
      map.flyTo({ center: at, zoom: st.z || 7, pitch: st.p != null ? st.p : 50, bearing: st.b || 0, duration: 3200, curve: 1.25, padding: pad(), essential: true });
    }
    setTerr(st.terr || S.ch.terr || TERR0);
    setAllr(!!st.all);
    if (st.fx && st.fx.length) { FX.startShow({ fx: st.fx, units: [] }, at); FX.setShowTime(0, 0); } else FX.stopShow();
    AUDIO.play('whoosh');
    if (S.playing) (st.sfx || []).forEach(([sec, name]) => AUDIO.play(name, 2 + sec));
    tourCard.innerHTML = '<div class="tc-k">' + esc(S.ch.num + ' · ' + S.ch.title) + ' · ' + (i + 1) + ' / ' + tour.length + '</div>' +
      '<div class="tc-h' + titleCls(st.h, 9, 12) + '">' + esc(st.h) + '</div><div class="tc-d">' + fill(st.d) + '</div><div class="tc-p"><i></i></div>';
    tourCard.classList.remove('on');
    later(700, () => { if (S.tour && S.tour.i === i) tourCard.classList.add('on'); });
    $$('#tour-strip .ts').forEach((b, j) => {
      b.classList.toggle('on', j === i);
      b.classList.toggle('done', j < i);
      $('i', b).style.width = '';
    });
    M.wps.forEach(w => { const d = w.km <= i; if (w.done !== d) { w.done = d; if (w.el) w.el.classList.toggle('done', d); } });
    later(2600, () => { if (S.tour && S.tour.i === i && at) FX.ping(at, 'gold', 4, 70); });
    overlayDirty = true;
    updateActs();
  }
  function clearTour() {
    if (!S.tour) return;
    const T = S.tour;
    S.tour = null;
    FX.stopShow();
    if (T.route) { const p = src('prog'); if (p) p.setData(EMPTY); }
    tourCard.classList.remove('on');
  }
  function updateTour(dt) {
    const T = S.tour;
    if (!T) return;
    if (S.playing) T.t += dt;
    const st = T.st, t = T.t;
    FX.setShowTime(Math.max(0, t - 2), clamp((t - 1.4) / 0.8, 0, 1));
    if (t > 3.3 && S.playing && !T.user && S.cam !== 'free' && !(map.isEasing && map.isEasing())) map.setBearing(map.getBearing() + 0.55 * dt);
    if (T.route) {
      const fr = clamp((t - 2) / ((st.dur || 8) * 0.55), 0, 1);
      if (Math.abs(fr - T.fr) > 0.004 || (fr === 1 && T.fr !== 1)) {
        T.fr = fr;
        const p = src('prog');
        if (p) p.setData(fr > 0 ? fc([lineF(cut(T.route, T.route.len * fr), { dash: 0 })]) : EMPTY);
      }
    }
    const k = (clamp(t / T.dur, 0, 1) * 100).toFixed(2) + '%';
    const bar = $('.tc-p i', tourCard);
    if (bar) bar.style.width = k;
    const sb = $('#tour-strip .ts.on i');
    if (sb) sb.style.width = k;
    if (t >= T.dur && S.playing) startTour(T.i + 1);
  }

  /* ================================================================ 章节结束 · 全图 */
  function chapterEnd() {
    setPlaying(false);
    S.mode = 'end';
    S.seen.add(S.ci);
    updateRail();
    const ch = S.ch, next = CH[S.ci + 1];
    let h = '<div class="ce-t">' + esc(ch.num) + ' · ' + esc(ch.title) + '<b>' + esc(ch.sub) + '</b></div>';
    h += '<button class="btn" data-a="replay">' + SVG_REPLAY + '重看本章</button>';
    if (next) h += '<button class="btn pri" data-a="next">继续 · ' + esc(next.num) + ' ' + esc(next.title) + '</button>';
    else h += '<button class="btn pri" data-a="all">' + esc(OVW.btn) + '</button><button class="btn" data-a="intro">回到开场</button>';
    ceEl.className = 'glass corners';
    ceEl.innerHTML = h;
    placeEnd();
    requestAnimationFrame(() => ceEl.classList.add('on'));
    if (M.total) fitChapter(3200);
    cue('end');
    updateActs();
  }
  function hideEnd() { ceEl.classList.remove('on'); body.classList.remove('ce-lg'); }
  // 章末面板摆在地图空白处：右边让开档案栏，左边尽量让开图例；放不下才暂时收起图例（手机端交给 CSS）
  function placeEnd() {
    body.classList.remove('ce-lg');
    ceEl.style.left = ceEl.style.maxWidth = '';
    if (S.mode !== 'end' || innerWidth <= 860) return;
    const open = !body.classList.contains('dz-closed');
    const R = open ? innerWidth - 32 - S.dzW : innerWidth - 16;
    const lr = $('#legend').getBoundingClientRect();
    const L1 = lr.width ? lr.right + 16 : 16;
    ceEl.style.maxWidth = (R - 16) + 'px';
    const w = ceEl.offsetWidth;
    let L = 16;
    if (R - L1 >= w) L = L1;
    else if (lr.width) body.classList.add('ce-lg');
    ceEl.style.left = Math.round((L + R) / 2) + 'px';
    ceEl.style.maxWidth = (R - L) + 'px';
  }
  function restartChapter() {
    hideEnd();
    if (body.classList.contains('tour')) { setCam('follow', true); setPlaying(true); startTour(0); }
    else seek(0, true);
  }
  function hideTitle() { $('#titlecard').classList.remove('on'); body.classList.remove('titling'); }
  function showAll() {
    clearTimers();
    hideTitle();
    if (S.scene) finishScene();
    clearTour();
    hideEnd();
    hideTip();
    setPlaying(false);
    if (S.ci >= 0) S.seen.add(S.ci);
    S.mode = 'all';
    body.classList.remove('tour');
    body.classList.add('mode-all');
    $('#btn-all').classList.add('on');
    setAccent('#d9b26a');
    setAtmo('dusk');
    setTerr(SITE.terrAll || TERR0);
    setAllr(true);
    whenReady(() => ['ghost', 'sideg', 'sidep', 'prog'].forEach(id => map.getSource(id).setData(EMPTY)));
    M = { segs: [], nodes: [], events: [], sides: [], wps: [], cands: [], total: 0, wpSet: new Set() };
    buildWaypoints();
    updateRail();
    renderAllDossier();
    renderLegend();
    renderAllProfile();
    dkCap.innerHTML = '<i>全图</i>' + esc(OVW.sub);
    dkKm.innerHTML = '合计 <b>' + fmt(ALL_KM) + '</b> 公里' + (LI ? ' · 约 ' + liTxt(ALL_KM) : '');
    setCam('overview', true);
    fitAll();
    cue('all');
    try { history.replaceState(null, '', '#all'); } catch (e) { /* 忽略 */ }
    overlayDirty = true;
  }

  /* ================================================================ 档案面板 */
  function kpiHtml(list) {
    return '<div class="kpis">' + (list || []).map(k => '<div class="kpi"><div class="v" data-v="' + k.v + '" data-u="' + esc(k.u || '') + '">0' + (k.u ? '<small>' + esc(k.u) + '</small>' : '') + '</div><div class="l">' + esc(k.l) + '</div><div class="s">' + esc(k.s || '') + '</div></div>').join('') + '</div>';
  }
  function renderDossier(ch) {
    const total = chapterKm(ch);
    const meta = [['纪年', ch.era], ['时间', ch.year], ['年龄', ch.age], [W_.rank, ch.rank], ['路线', total ? fmt(total) + ' 公里' : '']].filter(m => m[1] && m[1] !== '—');
    dzHead.dataset.num = ch.num;
    dzHead.innerHTML =
      '<div class="dz-row"><div class="dz-num">' + esc(ch.num) + '</div><div class="dz-title"><h2>' + esc(ch.title) + '</h2><p>' + esc(ch.sub) + '</p></div></div>' +
      '<div class="dz-meta">' + meta.map(m => '<span>' + m[0] + '<b>' + esc(m[1]) + '</b></span>').join('') + '</div>' +
      '<p class="dz-lead">' + fill(ch.lead) + '</p>' + kpiHtml(ch.kpis) +
      '<div class="dz-acts"><button class="btn pri" data-a="play"></button><button class="btn" data-a="overview">' + SVG_EYE + '全景</button></div>';
    countUp($$('.kpi .v', dzHead), 1500, 300);
    updateActs();
    $('#dz-scroll').scrollTop = 0;
    setTab(dzTab);
  }
  function renderAllDossier() {
    const ep = EPI;
    dzHead.dataset.num = OVW.num;
    dzHead.innerHTML =
      '<div class="dz-row"><div class="dz-num">' + esc(OVW.num) + '</div><div class="dz-title"><h2>' + esc(OVW.title) + '</h2><p>' + esc(OVW.sub) + '</p></div></div>' +
      '<div class="dz-meta">' + (OVW.span ? '<span>时间<b>' + esc(OVW.span) + '</b></span>' : '') + '<span>路线合计<b>' + fmt(ALL_KM) + ' 公里</b></span>' + (LI ? '<span>折合<b>' + liTxt(ALL_KM) + '</b></span>' : '') + '</div>' +
      '<p class="dz-lead">' + fill(OVW.lead) + '</p>' +
      kpiHtml(OVW.kpis || ep.kpis);
    countUp($$('.kpi .v', dzHead), 1500, 300);
    $('#dz-scroll').scrollTop = 0;
    setTab(dzTab);
  }
  function updateActs() {
    const b = $('.dz-acts [data-a="play"]', dzHead);
    if (!b) return;
    const isTour = body.classList.contains('tour');
    b.innerHTML = S.playing ? SVG_PAUSE + '暂停' : SVG_PLAY + (isTour ? (S.tour ? '继续' + W_.tour : '开始' + W_.tour) : (S.km > 0.5 && S.km < M.total - 0.5 ? '继续' + W_.go : '开始' + W_.go));
  }
  const TABS = {
    report(ch) {
      let h = '<h4>' + esc(W_.story) + '</h4><div class="story">' + (ch.story || []).map(p => '<p>' + fill(p) + '</p>').join('') + '</div>';
      h += '<h4>时间线</h4><div class="tl">' + (ch.timeline || []).map((t, i) => '<div class="tl-i" data-i="' + i + '"><div class="t">' + esc(t.t) + '</div><div class="h">' + esc(t.h) + '</div><div class="d">' + fill(t.d) + '</div></div>').join('') + '</div>';
      if (M.segs.length) {
        h += '<h4>' + esc(W_.go) + '分段</h4><table class="vt"><thead><tr><th>分段</th><th>公里</th>' + liTh() + '</tr></thead><tbody>' +
          M.segs.map(s => '<tr class="seg-row" data-km="' + s.off.toFixed(1) + '"><td>' + (s.i + 1) + ' · ' + esc(shortCap(s.cap)) + '</td><td>' + fmt(s.len) + '</td>' + liTd(s.len) + '</tr>').join('') +
          '<tr><td>合计</td><td>' + fmt(M.total) + '</td>' + liTd(M.total) + '</tr></tbody></table>';
      }
      return h;
    },
    sources(ch) {
      let h = '<h4>原文</h4>' + (ch.sources || []).map(s => '<div class="src"><p>' + esc(s.t) + '</p><cite>' + esc(s.s) + '</cite></div>').join('');
      if (ch.variants && ch.variants.length) {
        h += '<h4>' + esc(VAR.t) + '</h4><table class="vt"><thead><tr><th>项目</th><th>' + esc(VAR.a) + '</th><th>' + esc(VAR.b) + '</th></tr></thead><tbody>' +
          ch.variants.map(v => '<tr><td>' + esc(v.k) + '</td><td>' + esc(v.a) + '</td><td>' + esc(v.b) + '</td></tr>' + (v.h ? '<tr><td class="h" colspan="3">' + esc(v.h) + '</td></tr>' : '')).join('') + '</tbody></table>';
      }
      return h;
    },
    debates(ch) {
      return (ch.debates || []).map((d, di) => '<div class="db"><h5>' + esc(d.t) + '</h5><p>' + fill(d.q) + '</p><div class="opts">' +
        d.opts.map((o, oi) => '<button class="opt" data-d="' + di + '" data-o="' + oi + '"><span class="tag' + (MAIN_TAGS.indexOf(o.tag) >= 0 ? ' t-main' : '') + '">' + esc(o.tag) + '</span><span class="on">' + esc(o.n) + '</span><span class="od">' + fill(o.d) + '</span></button>').join('') +
        '</div></div>').join('') + '<p class="db-note">点击候选地点，地图会飞到该处；图层面板里可以一次显示全部考据候选。</p>';
    },
    people(ch) {
      // 分组：SITE.peopleGroups 或 SITE.factions；side 对不上任何一组的人归入第一组
      const groups = SITE.peopleGroups || (FACTIONS.length ? FACTIONS : [{ k: '', n: W_.tabPeople }]);
      const keys = groups.map(g => g.k);
      return groups.map((g, gi) => {
        const ps = (ch.people || []).filter(p => p.side === g.k || (gi === 0 && keys.indexOf(p.side) < 0));
        if (!ps.length) return '';
        const av = g.c && g.k !== 'han' && g.k !== 'xn' ? ' style="background:' + esc(g.c) + ';color:#fff6e6"' : '';
        return '<h4>' + esc(g.n) + '</h4><div class="ppl">' + ps.map(p => '<div class="pp ' + esc(g.k) + '"><div class="av"' + av + '>' + esc(p.n[0]) + '</div><div><h6>' + esc(p.n) + '<small>' + esc(p.r) + '</small></h6><p>' + fill(p.d) + '</p></div></div>').join('') + '</div>';
      }).join('');
    },
  };
  const ALLTABS = {
    report() {
      const cs = CH.filter(c => c.track);
      return '<h4>' + esc(OVW.list) + '</h4><div class="tl">' + cs.map(c => '<div class="tl-i" data-ch="' + CH.indexOf(c) + '"><div class="t">' + esc(c.era) + ' · ' + esc(c.year) + '</div><div class="h">' + esc(c.num) + ' · ' + esc(c.title) + '　<small style="color:' + c.color + '">' + esc(c.sub) + '</small></div><div class="d">' + esc(c.lead) + '</div></div>').join('') + '</div>' +
        '<h4>路线里程</h4><table class="vt"><thead><tr><th>' + esc(OVW.col) + '</th><th>公里</th>' + liTh() + '</tr></thead><tbody>' +
        cs.map(c => '<tr><td>' + esc(c.num) + ' · ' + esc(c.title) + '</td><td>' + fmt(chapterKm(c)) + '</td>' + liTd(chapterKm(c)) + '</tr>').join('') +
        '<tr><td>合计</td><td>' + fmt(ALL_KM) + '</td>' + liTd(ALL_KM) + '</tr></tbody></table>';
    },
    sources() { return TABS.sources(EPI); },
    debates() { return TABS.debates(EPI); },
    people() {
      const seen = new Set(), all = [];
      CH.forEach(c => (c.people || []).forEach(p => { if (!seen.has(p.n)) { seen.add(p.n); all.push(p); } }));
      return TABS.people({ people: all });
    },
  };
  function setTab(tab) {
    dzTab = tab;
    $$('#dz-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    dzBody.innerHTML = S.mode === 'all' ? ALLTABS[tab]() : TABS[tab](S.ch);
  }
  function onTl(t) {
    const at = t.at;
    if (S.ch.tour && !S.ch.track) {
      const i = S.ch.tour.findIndex(s => s.at === at);
      if (i >= 0) { setCam('follow', true); setPlaying(true); startTour(i); return; }
    }
    if (M.total) {
      let km = kmOf(at);
      if (km == null) { const w = M.wps.find(w => w.k === at); if (w) km = w.km; }
      if (km != null) { seek(Math.max(0, km - 0.6), true); return; }
    }
    flyToSpot(llOf(at), 'gold', 8.2);
  }
  function onOpt(btn, o) {
    const ll = llOf(o.at);
    if (!ll) return;
    body.classList.add('show-cands');
    const cb = $('[data-l="cands"]'); if (cb) cb.checked = true;
    M.cands.forEach(c => { c.hot = c.at === o.at; c.el.classList.toggle('hot', c.hot); });
    $$('.opt', dzBody).forEach(b => b.classList.toggle('hot', b === btn));
    flyToSpot(ll, 'steel', Math.max(7.8, Math.min(9, map.getZoom() + 1)));
  }
  function flyToSpot(ll, col, z) {
    if (!ll) return;
    if (S.scene) finishScene();
    setPlaying(false);
    setCam('free', true);
    map.stop();
    map.flyTo({ center: ll, zoom: z || 8, pitch: 55, duration: 2400, padding: pad(), essential: true });
    later(2000, () => FX.ping(ll, col || 'gold', 5, 70));
    overlayDirty = true;
  }
  function onWp(w) {
    hideTip();
    if (S.mode === 'all' || !S.ch) return;
    if (S.ch.tour && !S.ch.track) {
      const i = S.ch.tour.findIndex(t => t.at === w.k);
      if (i >= 0) { setCam('follow', true); setPlaying(true); startTour(i); }
      return;
    }
    if (M.total && w.km != null) seek(Math.max(0, w.km - 0.6), true);
  }

  /* ================================================================ 悬停提示 */
  function wpTip(w, e) {
    const elev = G.nodeElev ? G.nodeElev[w.k] : null;
    const meta = [w.desc, elev != null ? '海拔 ' + fmt(elev) + ' 米' : '', M.total && w.km != null ? '行程第 ' + fmt(w.km) + ' 公里' : ''].filter(Boolean).join(' · ');
    tipEl.innerHTML = '<h6>' + esc(w.name) + '</h6>' + (meta ? '<div class="m">' + esc(meta) + '</div>' : '') +
      (w.scene ? '<p>' + esc(KIND_N[w.icon] || '') + ' · ' + esc(w.scene) + '　点击进入</p>' : (M.total ? '<p>点击从这里继续' + esc(W_.go) + '</p>' : ''));
    tipEl.classList.add('on');
    moveTip(e);
  }
  function moveTip(e) {
    tipEl.style.left = Math.min(innerWidth - 300, e.clientX + 16) + 'px';
    tipEl.style.top = Math.min(innerHeight - 130, e.clientY + 14) + 'px';
  }
  function hideTip() { tipEl.classList.remove('on'); }

  /* ================================================================ 剖面图 · 底栏 */
  function renderProfile() {
    PF.all = false;
    const svg = PF.el;
    if (!M.total) { svg.innerHTML = ''; return; }
    const W = Math.max(240, Math.round(svg.getBoundingClientRect().width || 600)), H = 62;
    PF.w = W;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    const N = Math.min(520, Math.round(W / 2)), pts = [];
    let lo = 1e9, hi = -1e9;
    for (let i = 0; i <= N; i++) { const km = M.total * i / N, e = elevAt(km); pts.push([km, e]); if (e < lo) lo = e; if (e > hi) hi = e; }
    PF.hi = hi;
    const base = Math.max(0, lo - 150), range = Math.max(900, hi - base), top = 27, bot = H - 3;
    const X = km => km / M.total * W, Y = e => bot - (e - base) / range * (bot - top);
    PF.Y = Y;
    const line = pts.map((p, i) => (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join('');
    const area = line + 'L' + W + ' ' + H + 'L0 ' + H + 'Z';
    let h = '<defs><linearGradient id="pfg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + S.accent + '" stop-opacity=".6"/><stop offset="1" stop-color="' + S.accent + '" stop-opacity=".05"/></linearGradient>' +
      '<linearGradient id="pfg0" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#efe4cc" stop-opacity=".2"/><stop offset="1" stop-color="#efe4cc" stop-opacity=".02"/></linearGradient>' +
      '<clipPath id="pfc"><rect x="0" y="0" width="0" height="' + H + '"/></clipPath></defs>';
    h += '<path class="pf-area" d="' + area + '" fill="url(#pfg0)"/><path class="pf-line" d="' + line + '" stroke="rgba(239,228,204,.42)"/>';
    h += '<g clip-path="url(#pfc)"><path class="pf-area" d="' + area + '" fill="url(#pfg)"/><path class="pf-done" d="' + line + '" stroke="' + S.accent + '"/></g>';
    M.segs.forEach((s, i) => {
      const x = X(s.off), w = X(s.off + s.len) - x, lab = shortCap(s.cap);
      if (i) h += '<line class="pf-seg" x1="' + x + '" x2="' + x + '" y1="26" y2="' + H + '"/>';
      if (w > lab.length * 10.5 + 14) h += '<text class="pf-segl" x="' + (x + 5) + '" y="' + (H - 5) + '">' + esc(lab) + '</text>';
    });
    const rows = [[], []];
    const fits = (r, a, b) => rows[r].every(q => b < q[0] - 6 || a > q[1] + 6);
    M.events.forEach(ev => {
      const x = X(ev.km), y0 = Y(elevAt(ev.km));
      if (ev.st.scene) {
        const t = ev.st.scene.title, w = t.length * 11.7 + 6, lx = clamp(x, w / 2 + 2, W - w / 2 - 2);
        const row = fits(0, lx - w / 2, lx + w / 2) ? 0 : fits(1, lx - w / 2, lx + w / 2) ? 1 : -1;
        h += '<line x1="' + x + '" x2="' + x + '" y1="' + (row === 1 ? 25 : 14) + '" y2="' + (y0 - 4) + '" stroke="rgba(255,241,214,.4)" stroke-dasharray="1.5 2"/>';
        h += '<path class="pf-stop" d="M' + x.toFixed(1) + ' ' + (y0 - 5).toFixed(1) + 'l4.5 5-4.5 5-4.5-5z" fill="' + S.accent + '" stroke="#fff3d6" stroke-width=".9"/>';
        if (row >= 0) { rows[row].push([lx - w / 2, lx + w / 2]); h += '<text class="pf-tick key" x="' + lx.toFixed(1) + '" y="' + (row ? 22 : 10) + '">' + esc(t) + '</text>'; }
      } else if (ev.st.toast) {
        h += '<path class="pf-stop" d="M' + x.toFixed(1) + ' ' + (y0 - 3).toFixed(1) + 'l3 3-3 3-3-3z" fill="#f3d79a" opacity=".9"/>';
      }
    });
    h += '<line class="pf-hv" x1="0" x2="0" y1="0" y2="' + H + '"/>';
    h += '<line class="pf-ph" x1="0" x2="0" y1="4" y2="' + H + '"/><circle class="pf-phd" r="3.8" cx="0" cy="' + Y(pts[0][1]).toFixed(1) + '" fill="#fff3d4" stroke="' + S.accent + '" stroke-width="1.6"/>';
    svg.innerHTML = h;
    PF.clip = $('#pfc rect', svg); PF.ph = $('.pf-ph', svg); PF.phd = $('.pf-phd', svg); PF.hv = $('.pf-hv', svg);
    S.lastDock = 0;
  }
  function renderAllProfile() {
    const svg = PF.el, W = Math.max(240, Math.round(svg.getBoundingClientRect().width || 600)), H = 62;
    PF.all = true; PF.w = W;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    let x = 0, h = '';
    const chs = CH.filter(c => c.track), narrow = W < 520;
    const widest = chs.reduce((m, c) => chapterKm(c) > chapterKm(m) ? c : m, chs[0]);
    chs.forEach(c => {
      const km = chapterKm(c), w = km / ALL_KM * W;
      h += '<g class="pf-ch" data-i="' + CH.indexOf(c) + '"><rect x="' + (x + 1.5).toFixed(1) + '" y="28" width="' + Math.max(1, w - 3).toFixed(1) + '" height="13" fill="' + c.color + '" opacity=".85"/>' +
        '<text class="pf-tick key" x="' + (x + w / 2).toFixed(1) + '" y="18">' + (narrow ? '' : esc(c.num) + ' · ') + esc(c.title) + '</text>' +
        '<text class="pf-tick" x="' + (x + w / 2).toFixed(1) + '" y="57">' + fmt(km) + (narrow && c !== widest ? '' : ' 公里') + '</text></g>';
      x += w;
    });
    svg.innerHTML = h;
  }
  function updateDock() {
    if (S.mode === 'all' || PF.all) return;
    if (M.total) {
      const x = S.km / M.total * PF.w;
      if (PF.ph) { PF.ph.setAttribute('x1', x); PF.ph.setAttribute('x2', x); }
      if (PF.clip) PF.clip.setAttribute('width', x);
      if (PF.phd && PF.Y) { PF.phd.setAttribute('cx', x); PF.phd.setAttribute('cy', PF.Y(elevAt(S.km)).toFixed(1)); }
      dkKm.innerHTML = '<b>' + fmt(S.km) + '</b> / ' + fmt(M.total) + ' 公里 · 最高 ' + fmt(PF.hi) + ' 米';
    } else if (S.ch && S.ch.tour) {
      dkKm.innerHTML = S.tour ? '第 <b>' + (S.tour.i + 1) + '</b> / ' + S.ch.tour.length + ' 站' : S.ch.tour.length + ' 站';
    }
  }
  function renderStrip() {
    const ts = $('#tour-strip'), ch = S.ch;
    if (!ch || ch.track || !ch.tour) { ts.innerHTML = ''; return; }
    ts.innerHTML = ch.tour.map((t, i) => {
      const parts = String(t.h).split(' · ');
      const sm = String(i + 1).padStart(2, '0') + (parts.length > 1 ? ' · ' + parts[0] : '');
      return '<button class="ts" data-i="' + i + '" title="' + esc(t.h) + '"><small>' + esc(sm) + '</small><b>' + esc(parts.length > 1 ? parts.slice(1).join(' · ') : parts[0]) + '</b><i></i></button>';
    }).join('');
    dkCap.innerHTML = '<i>' + esc(ch.num) + '</i>' + esc(ch.title + ' · ' + ch.sub);
  }

  /* ================================================================ 图例 · 章节栏 · 罗盘 · HUD */
  function renderLegend() {
    const L = [];
    if (S.mode === 'all') {
      CH.filter(c => c.track).forEach(c => L.push('<div class="lg"><i style="color:' + c.color + ';border-top-width:4px"></i>' + esc(c.num) + ' · ' + esc(c.title) + ' <span class="lg-k">' + fmt(chapterKm(c)) + ' 公里</span></div>'));
    } else {
      if (M.total) L.push('<div class="lg"><i class="main"></i>' + esc(HERO.legend || HERO.name || W_.go) + '</div>');
      const dseg = M.segs.find(s => s.dash);
      if (dseg) L.push('<div class="lg"><i class="dash" style="color:' + S.accent + '"></i>' + esc(dseg.dashName || W_.dash) + '</div>');
      Array.from(new Set(M.sides.map(s => s.k))).forEach(k => L.push('<div class="lg"><i class="' + (k === 'lost' ? 'dot' : k === 'ally' ? 'dash' : '') + '" style="color:' + SIDE_C[k] + '"></i>' + SIDE_N[k] + '</div>'));
    }
    const LG = SITE.legend || {}, has = fcx => !!(fcx && fcx.features && fcx.features.length);
    if (FACTIONS.length && TERR0) L.push('<div class="lg">' + FACTIONS.map((f, i) => '<i class="area" style="color:' + esc(f.c) + (i ? ';margin-left:12px' : '') + '"></i>' + esc(f.n)).join('') + '</div>');
    if (has(G.walls) && LG.walls) L.push('<div class="lg"><i class="dash" style="color:#d8b98a"></i>' + esc(LG.walls) + '</div>');
    if (has(G.ancient) && LG.ancient) L.push('<div class="lg"><i class="area" style="color:#5aaadc"></i>' + esc(LG.ancient) + '</div>');
    L.push('<div class="lg-src">影像 Esri · 地形 AWS Terrain Tiles</div>');
    $('#legend').innerHTML = L.join('');
  }
  function renderRail() {
    $('#rail').innerHTML = CH.map((c, i) => '<button class="ri" data-i="' + i + '" style="--c:' + c.color + '" title="' + esc(c.title + ' · ' + c.sub) + '"><span class="rn">' + esc(c.num) + '</span><span class="rt"><b>' + esc(c.title) + '</b><small>' + esc(yearShort(c)) + '</small></span></button>').join('');
  }
  function updateRail() {
    $$('#rail .ri').forEach((b, i) => {
      b.classList.toggle('on', S.mode !== 'all' && i === S.ci);
      b.classList.toggle('seen', S.seen.has(i));
    });
    const rail = $('#rail'), on = $('#rail .ri.on');
    if (rail && on && rail.scrollWidth > rail.clientWidth + 2) rail.scrollTo({ left: on.offsetLeft - rail.clientWidth / 2 + on.offsetWidth / 2, behavior: 'smooth' });
  }
  function initCompass() {
    let h = '';
    for (let i = 0; i < 72; i++) {
      const a = i * 5 * D2R, r1 = i % 18 === 0 ? 38.5 : i % 6 === 0 ? 41.5 : 43.5, r2 = 46;
      h += '<line x1="' + (50 + Math.sin(a) * r1).toFixed(2) + '" y1="' + (50 - Math.cos(a) * r1).toFixed(2) + '" x2="' + (50 + Math.sin(a) * r2).toFixed(2) + '" y2="' + (50 - Math.cos(a) * r2).toFixed(2) + '"' + (i % 18 === 0 ? ' style="stroke-width:1.6"' : '') + '/>';
    }
    $('.c-ticks').innerHTML = h;
  }
  function updateHud() {
    let lng, lat, el = null;
    if ((S.mode === 'march' || S.mode === 'title' || S.mode === 'end') && M.total) {
      const p = posAt(S.km); lng = p[0]; lat = p[1]; el = elevAt(S.km);
    } else {
      const c = map.getCenter(); lng = c.lng; lat = c.lat;
      try { const e = map.queryTerrainElevation(c); if (e != null) el = e / (S.exag || 1); } catch (e) { /* 忽略 */ }
    }
    HUD.ll.textContent = Math.abs(lat).toFixed(2) + '°' + (lat >= 0 ? 'N' : 'S') + '  ' + Math.abs(lng).toFixed(2) + '°' + (lng >= 0 ? 'E' : 'W');
    HUD.el.textContent = el == null ? '—' : fmt(Math.max(0, el)) + ' 米';
    if (M.total) HUD.km.innerHTML = '<b>' + fmt(S.km) + '</b> 公里' + (LI ? ' · ' + liTxt(S.km) : '');
    else if (S.mode === 'all') HUD.km.innerHTML = '<b>' + fmt(ALL_KM) + '</b> 公里 · 全部路线';
    else if (S.ch && S.ch.tour) HUD.km.innerHTML = S.tour ? '第 <b>' + (S.tour.i + 1) + '</b> / ' + S.ch.tour.length + ' 站' : '—';
    const brg = map.getBearing();
    HUD.cam.textContent = (S.scene ? '演出' : CAM_N[S.cam]) + ' · 俯仰 ' + Math.round(map.getPitch()) + '° · 方位 ' + String(Math.round((brg + 360) % 360)).padStart(3, '0') + '°';
    roseAng += angDiff(roseAng, -brg);
    HUD.rose.style.transform = 'rotate(' + roseAng.toFixed(1) + 'deg)';
  }

  /* ================================================================ 章节标题 · 载入 */
  function showTitle(ch, ms) {
    const tc = $('#titlecard');
    const e = [ch.era, ch.year, ch.age].filter(x => x && x !== '—');
    tc.innerHTML = '<div class="tc-bg"></div><div class="tc-in"><div class="tc-num">' + esc(ch.num) + '</div><div class="tc-t' + titleCls(ch.title, 5, 7) + '">' + esc(ch.title) + '</div><div class="tc-s">' + esc(ch.sub) + '</div>' +
      '<div class="tc-e">' + e.map(x => '<span>' + esc(x) + '</span>').join('') + '</div><div class="tc-line"></div></div>';
    tc.classList.remove('on');
    void tc.offsetWidth;
    tc.classList.add('on');
    body.classList.add('titling');
    later(ms, () => { tc.classList.remove('on'); body.classList.remove('titling'); });
  }
  function loadChapter(i, opts) {
    opts = opts || {};
    if (i < 0 || i >= CH.length) return;
    clearTimers();
    if (S.scene) finishScene();
    clearTour();
    hideEnd();
    hideTip();
    setPlaying(false);
    if (S.ci >= 0 && S.mode !== 'all' && S.mode !== 'intro') S.seen.add(S.ci);
    S.ci = i; S.ch = CH[i];
    const ch = S.ch, isTour = !ch.track && !!ch.tour;
    body.classList.remove('mode-all');
    $('#btn-all').classList.remove('on');
    M = buildModel(ch);
    S.km = 0; S.lastSeg = -1; S.mode = 'title';
    body.classList.toggle('tour', isTour);
    setAllr(false);
    setAccent(ch.color);
    setAtmo(ch.atmo || 'dusk');
    setTerr(ch.terr || TERR0);
    toastBox.innerHTML = '';
    M.cands.forEach(c => { c.hot = false; });
    updateRail();
    renderDossier(ch);
    renderLegend();
    renderStrip();
    buildWaypoints();
    whenReady(() => {
      map.getSource('ghost').setData(fc(M.segs.map(s => lineF(s.route.c, { dash: s.dash }))));
      map.getSource('sideg').setData(fc(M.sides.map(s => lineF(s.route.c, { k: s.k }))));
      map.getSource('sidep').setData(EMPTY);
      map.getSource('prog').setData(EMPTY);
    });
    if (M.total) setKm(0, true);
    updateProg(true);
    renderProfile();
    updateDock();
    setCam('follow', true);
    const v = ch.view, fly = opts.flyDur || 4200;
    map.stop();
    map.flyTo({ center: v.c, zoom: v.z, pitch: v.p, bearing: v.b || 0, duration: fly, curve: 1.42, padding: pad(), essential: true });
    showTitle(ch, 4300);
    cue('chapter', ch);
    later(Math.max(4800, fly + 300), () => {
      if (S.ch !== ch || S.mode !== 'title') return;
      if (isTour) { setPlaying(true); startTour(0); }
      else { S.mode = 'march'; CAM.c = null; setPlaying(true); }
    });
    try { history.replaceState(null, '', '#' + ch.id); } catch (e) { /* 忽略 */ }
    overlayDirty = true;
  }

  /* ================================================================ 播放控制 */
  function setPlaying(on) {
    on = !!on;
    if (S.playing !== on) {
      S.playing = on;
      body.classList.toggle('playing', on);
      if (S.scene) {
        if (on) { AUDIO.beginScene(); scheduleSfx(S.scene, S.scene.t + 0.05); }
        else AUDIO.endScene(0.4);
      }
    }
    updateActs();
  }
  function togglePlay() {
    if (S.mode === 'intro' || S.mode === 'title') return;
    if (S.mode === 'all') { loadChapter(S.ci >= 1 && CH[S.ci] && CH[S.ci].track ? S.ci : FIRST_TRACK); return; }
    if (S.mode === 'end') { restartChapter(); return; }
    if (body.classList.contains('tour') && !S.tour) { setCam('follow', true); setPlaying(true); startTour(0); return; }
    if (M.total && !S.scene && S.km >= M.total - 0.01) { seek(0, true); return; }
    if (!S.playing && S.mode === 'march' && S.cam === 'free') setCam('follow');
    setPlaying(!S.playing);
  }
  function setSound(on) {
    AUDIO.setEnabled(on);
    body.classList.toggle('muted', !AUDIO.enabled);
    if (AUDIO.enabled) AUDIO.mood(S.atmo, true);
  }
  function toggleDossier() {
    body.classList.toggle('dz-closed');
    overlayDirty = true;
    placeEnd();
  }

  /* ================================================================ 开场 */
  function initIntro() {
    $('#in-span').textContent = SITE.span;
    $('#in-sub').textContent = SITE.subtitle;
    $('#in-motto').textContent = SITE.motto;
    $('#in-motto-src').textContent = SITE.mottoSrc;
    // 开场数字：SITE.introStats = [{ v: 数字 或 'km'（自动算全部路线公里）, u: '单位', l: '说明' }]
    const stats = (SITE.introStats || []).map(s => [s.v === 'km' ? Math.round(ALL_KM) : s.v, s.u || '', s.l || '']);
    $('#in-stats').innerHTML = stats.map(s => '<div class="in-st"><div class="v" data-v="' + s[0] + '" data-u="' + s[1] + '">0<small>' + s[1] + '</small></div><div class="l">' + s[2] + '</div></div>').join('');
    countUp($$('#in-stats .v'), 1800, 2300);
    const done = () => $('#in-load').classList.add('done');
    map.once('idle', done);
    map.once('idle', () => setTimeout(warmTiles, 600));
    setTimeout(done, 4000);
    $('#enter-sound').addEventListener('click', () => enter(true));
    $('#enter-mute').addEventListener('click', () => enter(false));
  }
  // 预热瓦片缓存：开场停留期间，后台拉取路线一带的低层级影像与高程，切章时少见空白瓦片
  function warmTiles() {
    if (S.warmed) return;
    S.warmed = true;
    const tl = (lon, lat, z) => { const n = Math.pow(2, z); return [Math.floor((lon + 180) / 360 * n), Math.floor((1 - Math.asinh(Math.tan(lat * D2R)) / Math.PI) / 2 * n)]; };
    const urls = [], seen = new Set();
    const add = (tpl, z, x, y) => { const u = tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y); if (!seen.has(u)) { seen.add(u); urls.push(u); } };
    for (let z = 3; z <= 6; z++) {
      const a = tl(RB[0], RB[3], z), b = tl(RB[2], RB[1], z);
      for (let x = a[0]; x <= b[0]; x++) for (let y = a[1]; y <= b[1]; y++) { add(SAT, z, x, y); if (z >= 4) add(DEM, z, x, y); }
    }
    const pts = [];
    Object.keys(G.routes).forEach(k => { const c = G.routes[k].c; for (let i = 0; i < c.length; i += 2) pts.push(c[i]); });
    pts.forEach(q => { const t = tl(q[0], q[1], 7); add(SAT, 7, t[0], t[1]); add(DEM, 7, t[0], t[1]); });
    pts.forEach(q => { const t = tl(q[0], q[1], 8); add(SAT, 8, t[0], t[1]); });
    let i = 0, live = 0;
    const next = () => {
      while (live < 4 && i < urls.length) {
        const u = urls[i++]; live++;
        fetch(u, { mode: 'cors', credentials: 'same-origin', priority: 'low' }).then(r => r.blob()).catch(() => {}).finally(() => { live--; next(); });
      }
    };
    next();
  }
  function enter(sound) {
    if (S.entered) return;
    S.entered = true;
    setSound(sound);
    $('#intro').classList.add('gone');
    body.classList.remove('is-intro');
    const m = /^#(\w+)/.exec(location.hash || '');
    if (m && m[1] === 'all') { S.mode = 'title'; showAll(); return; }
    const idx = m ? CH.findIndex(c => c.id === m[1]) : -1;
    loadChapter(idx >= 0 ? idx : 0, { flyDur: 5200 });
  }
  function backToIntro() {
    clearTimers();
    hideTitle();
    if (S.scene) finishScene();
    clearTour();
    hideEnd();
    hideTip();
    setPlaying(false);
    S.mode = 'intro';
    S.entered = false;
    body.classList.add('is-intro');
    body.classList.remove('tour', 'mode-all');
    $('#btn-all').classList.remove('on');
    $('#intro').classList.remove('gone');
    setAllr(false);
    whenReady(() => ['ghost', 'sideg', 'sidep', 'prog'].forEach(id => map.getSource(id).setData(EMPTY)));
    headEl.style.display = 'none';
    setAtmo('dusk');
    map.stop();
    map.flyTo({ center: GLOBE.c, zoom: GLOBE.z, pitch: 0, bearing: 0, duration: 3200, padding: { top: 0, bottom: 0, left: 0, right: 0 }, essential: true });
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* 忽略 */ }
  }

  /* ================================================================ 事件绑定 */
  function initUI() {
    $$('#hud,#dossier,#dock,#scene-card,#tour-card,#chapter-end,#layers-panel').forEach(e => e.classList.add('glass', 'corners'));
    $('#legend').classList.add('glass');
    $('#credits').innerHTML = (SITE.credits || []).map(c => '<li>' + esc(c) + '</li>').join('');
    renderRail();
    initCompass();
    const TABN = { report: W_.tabReport, sources: W_.tabSources, debates: W_.tabDebates, people: W_.tabPeople };
    $$('#dz-tabs button').forEach(b => { if (TABN[b.dataset.tab]) b.textContent = TABN[b.dataset.tab]; });

    $('#rail').addEventListener('click', e => { const b = e.target.closest('.ri'); if (b) loadChapter(+b.dataset.i); });
    $('#play').addEventListener('click', togglePlay);
    $$('#speed button').forEach(b => b.addEventListener('click', () => { S.speed = +b.dataset.v; $$('#speed button').forEach(x => x.classList.toggle('on', x === b)); }));
    $$('#cam button').forEach(b => b.addEventListener('click', () => setCam(b.dataset.v)));
    $('#btn-all').addEventListener('click', () => { if (S.mode === 'all') loadChapter(S.ci >= 1 && CH[S.ci].track ? S.ci : FIRST_TRACK); else showAll(); });
    $('#btn-sound').addEventListener('click', () => setSound(!AUDIO.enabled));
    $('#btn-about').addEventListener('click', () => $('#about').classList.add('on'));
    $('#about-x').addEventListener('click', () => $('#about').classList.remove('on'));
    $('#about').addEventListener('click', e => { if (e.target.id === 'about') $('#about').classList.remove('on'); });
    $('#btn-layers').addEventListener('click', e => { e.stopPropagation(); $('#layers-panel').classList.toggle('on'); $('#btn-layers').classList.toggle('on', $('#layers-panel').classList.contains('on')); });
    document.addEventListener('click', e => {
      const lp = $('#layers-panel');
      if (lp.classList.contains('on') && !e.target.closest('#layers-panel,#btn-layers')) { lp.classList.remove('on'); $('#btn-layers').classList.remove('on'); }
    });
    $('#dossier-toggle').addEventListener('click', toggleDossier);
    $('#brand').addEventListener('click', backToIntro);
    $('#compass').addEventListener('click', () => {
      if (S.cam === 'follow' && (S.mode === 'march' || S.mode === 'tour')) setCam('free', true);
      map.easeTo({ bearing: 0, duration: 900 });
    });
    $$('#dz-tabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
    dzHead.addEventListener('click', e => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      if (b.dataset.a === 'play') togglePlay();
      else if (b.dataset.a === 'overview') setCam('overview');
    });
    dzBody.addEventListener('click', e => {
      const tl = e.target.closest('.tl-i'), op = e.target.closest('.opt'), sr = e.target.closest('.seg-row');
      if (tl && tl.dataset.ch != null) { loadChapter(+tl.dataset.ch); return; }
      if (S.mode === 'all') {
        if (op) { const ep = EPI; const o = ep.debates[+op.dataset.d].opts[+op.dataset.o]; flyToSpot(llOf(o.at), 'steel', 7.5); }
        return;
      }
      if (tl) { onTl(S.ch.timeline[+tl.dataset.i]); return; }
      if (op) { onOpt(op, S.ch.debates[+op.dataset.d].opts[+op.dataset.o]); return; }
      if (sr) seek(+sr.dataset.km + 0.2, true);
    });
    ceEl.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.i != null) { loadChapter(+b.dataset.i); return; }
      const a = b.dataset.a;
      if (a === 'replay') restartChapter();
      else if (a === 'next') loadChapter(S.ci + 1);
      else if (a === 'all') showAll();
      else if (a === 'intro') backToIntro();
    });
    scCard.addEventListener('click', e => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      if (b.dataset.a === 'replay') replayScene();
      else if (b.dataset.a === 'next') { finishScene(); setPlaying(true); }
    });
    $('#tour-strip').addEventListener('click', e => { const b = e.target.closest('.ts'); if (b) { setCam('follow', true); setPlaying(true); startTour(+b.dataset.i); } });

    // 剖面图
    PF.el.addEventListener('mousemove', e => {
      if (PF.all || !M.total) return;
      const r = PF.el.getBoundingClientRect(), fx = clamp((e.clientX - r.left) / r.width, 0, 1), km = fx * M.total;
      if (PF.hv) { PF.hv.setAttribute('x1', fx * PF.w); PF.hv.setAttribute('x2', fx * PF.w); PF.hv.style.display = 'block'; }
      const nn = nearestNode(km);
      PF.tip.innerHTML = '<b>' + fmt(km) + ' 公里</b> · 海拔 ' + fmt(elevAt(km)) + ' 米' + (nn ? ' · ' + esc(nameOf(nn.k)) : '');
      PF.tip.style.left = clamp(e.clientX - r.left, 110, r.width - 110) + 'px';
      PF.tip.style.opacity = 1;
    });
    PF.el.addEventListener('mouseleave', () => { if (PF.hv) PF.hv.style.display = 'none'; PF.tip.style.opacity = 0; });
    PF.el.addEventListener('click', e => {
      if (PF.all) { const g = e.target.closest('.pf-ch'); if (g) loadChapter(+g.dataset.i); return; }
      if (!M.total) return;
      const r = PF.el.getBoundingClientRect();
      seek(clamp((e.clientX - r.left) / r.width, 0, 1) * M.total, true);
    });

    // 图层面板
    $$('#basemode button').forEach(b => b.addEventListener('click', () => {
      const v = b.dataset.v;
      S.base = v;
      $$('#basemode button').forEach(x => x.classList.toggle('on', x === b));
      whenReady(() => {
        map.setLayoutProperty('sat', 'visibility', v === 'sat' ? 'visible' : 'none');
        map.setLayoutProperty('relief', 'visibility', v === 'relief' ? 'visible' : 'none');
        map.setLayoutProperty('des-stip', 'visibility', v === 'relief' ? 'visible' : 'none');
        map.setPaintProperty('hill', 'hillshade-exaggeration', v === 'relief' ? 0.75 : 0.32);
        map.setPaintProperty('des-wash', 'fill-opacity', v === 'relief' ? 0.2 : 0.07);
      });
    }));
    $$('#exag button').forEach(b => b.addEventListener('click', () => {
      S.exag = +b.dataset.v;
      $$('#exag button').forEach(x => x.classList.toggle('on', x === b));
      whenReady(() => map.setTerrain({ source: 'demT', exaggeration: S.exag }));
      overlayDirty = true;
    }));
    const LAYERS = {
      terr: ['terr-fill', 'terr-glow', 'terr-line'],
      water: ['riv-glow', 'riv', 'riv-h', 'lake-fill', 'lake-line', 'anc-fill', 'anc-line'],
      wall: ['wall', 'road'],
    };
    $$('#layers-panel input[data-l]').forEach(inp => inp.addEventListener('change', () => {
      const k = inp.dataset.l, on = inp.checked;
      if (LAYERS[k]) vis(LAYERS[k], on);
      else if (k === 'labels') body.classList.toggle('no-labels', !on);
      else if (k === 'modern') body.classList.toggle('no-modern', !on);
      else if (k === 'cands') body.classList.toggle('show-cands', on);
      else if (k === 'weather') FX.weatherOn(on);
      measure();
    }));

    // 用户操控地图 → 自由镜头
    ['dragstart', 'rotatestart', 'pitchstart', 'zoomstart'].forEach(n => map.on(n, e => {
      if (!e.originalEvent) return;
      if (S.scene) { S.scene.user = true; return; }
      if (S.tour) S.tour.user = true;
      if (S.cam !== 'free' && S.mode !== 'intro') setCam('free', true);
    }));
    map.keyboard.disable();

    addEventListener('keydown', e => {
      if (e.target.closest && e.target.closest('input,textarea')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (S.mode === 'intro') { if (e.key === 'Enter') enter(true); return; }
      switch (e.key) {
        case ' ': e.preventDefault(); togglePlay(); break;
        case 'ArrowRight': e.preventDefault(); loadChapter(S.mode === 'all' ? FIRST_TRACK : S.ci + 1); break;
        case 'ArrowLeft': e.preventDefault(); loadChapter(S.mode === 'all' ? CH.length - 1 : S.ci - 1); break;
        case 'a': case 'A': if (S.mode === 'all') loadChapter(S.ci >= 0 ? S.ci : FIRST_TRACK); else showAll(); break;
        case 'd': case 'D': toggleDossier(); break;
        case 'm': case 'M': setSound(!AUDIO.enabled); break;
        case 'l': case 'L': $('#btn-layers').click(); break;
        case 'Escape':
          $('#about').classList.remove('on'); $('#layers-panel').classList.remove('on');
          if (S.scene) { finishScene(); setPlaying(true); }
          break;
      }
    });
    // 实测底部播放条高度（手机上会折成两行），巡游卡、章末面板据此让位
    const dockEl = $('#dock');
    const syncDock = () => {
      const h = dockEl.offsetHeight;
      if (h && h !== S.dockH) { S.dockH = h; root.style.setProperty('--dockH', h + 'px'); }
    };
    syncDock();
    if (window.ResizeObserver) new ResizeObserver(syncDock).observe(dockEl);
    let rz = 0;
    addEventListener('resize', () => {
      clearTimeout(rz);
      rz = setTimeout(() => {
        S.dzW = parseFloat(getComputedStyle(root).getPropertyValue('--dz')) || 388;
        syncDock();
        placeEnd();
        if (S.mode === 'all') renderAllProfile(); else renderProfile();
        measure();
        updateDock();
      }, 160);
    });
  }

  /* ================================================================ 主循环 */
  function spinGlobe(dt) {
    if (map.isEasing && map.isEasing()) return;
    const c = map.getCenter();
    map.jumpTo({ center: [c.lng + 3.2 * dt, c.lat] });
  }
  function emitDust(now) {
    if (!S.playing || S.mode !== 'march' || !S.headP || now - S.lastDust < 40) return;
    S.lastDust = now;
    const b = map.project(posAt(Math.max(0, S.km - 4)));
    const dx = S.headP.x - b.x, dy = S.headP.y - b.y, L = Math.hypot(dx, dy) || 1;
    const sg = segAt(S.km), boat = !!sg && sg.by === 'boat';
    FX.headDust(S.headP.x, S.headP.y, -dx / L * (boat ? 9 : 14), -dy / L * (boat ? 9 : 14), boat ? [200, 232, 255] : null);
  }
  function revealAll(dt) {
    if (S.allT == null || !S.allOn) return;
    S.allT += dt;
    const now = performance.now();
    if (S.allT < 6 && now - (S.allLast || 0) < 33) return;
    S.allLast = now;
    const a = src('allr');
    if (!a) return;
    if (S.allT >= 6) { a.setData(allRoutesFC()); S.allT = null; return; }
    const f = [];
    CH.filter(c => c.track).forEach((c, j) => {
      const tot = chapterKm(c);
      let drawn = clamp((S.allT - 0.3 - j * 0.5) / 2.6, 0, 1);
      drawn = (1 - Math.pow(1 - drawn, 2)) * tot;
      c.track.forEach(t => {
        const r = G.routes[t.r];
        if (!r || drawn <= 0.01) { drawn -= r ? r.len : 0; return; }
        f.push(lineF(cut(r, Math.min(r.len, drawn)), { c: c.color, ch: c.id, dash: t.dash ? 1 : 0 }));
        drawn -= r.len;
      });
    });
    a.setData(fc(f));
  }
  function update(dt, now) {
    if (S.mode === 'intro') { spinGlobe(dt); return; }
    revealAll(dt);
    if (S.mode === 'march') { stepMarch(dt); updateCam(dt); emitDust(now); }
    else if (S.mode === 'scene') updateScene(dt);
    else if (S.mode === 'tour') updateTour(dt);
    if (now - S.lastHud > 125) { S.lastHud = now; updateHud(); }
    if (now - S.lastDock > 100) { S.lastDock = now; updateDock(); }
  }
  let lastNow = performance.now(), lastSig = '', drawnInRender = false, ovT = 0;
  // 追踪地平线：二分查找画面中线上「射线落在球面」的最高像素，驱动天空渐变与地平线雾带
  let skyHz = -1;
  function updateSky() {
    const tr = map.transform, cv = map.getContainer();
    const W = cv.clientWidth, H = cv.clientHeight;
    let hz = -1;
    if (tr && tr.isPointOnMapSurface && map.getZoom() > 4.9 && map.getPitch() > 35) {
      const on = y => { try { return tr.isPointOnMapSurface(new maplibregl.Point(W / 2, y)); } catch (e) { return true; } };
      if (!on(0) && on(H * 0.92)) {
        let lo = 0, hi = H * 0.92;
        for (let i = 0; i < 12; i++) { const m = (lo + hi) / 2; if (on(m)) hi = m; else lo = m; }
        hz = Math.round(hi);
      }
    }
    if (hz === skyHz) return;
    skyHz = hz;
    body.classList.toggle('sky-on', hz > 0);
    if (hz > 0) root.style.setProperty('--hz', hz + 'px');
  }
  map.on('render', () => { updateSky(); drawOverlay(); ovT = performance.now(); FX.draw(performance.now()); drawnInRender = true; });
  function camSig() {
    const c = map.getCenter();
    return c.lng.toFixed(5) + ',' + c.lat.toFixed(5) + ',' + map.getZoom().toFixed(3) + ',' + map.getPitch().toFixed(2) + ',' + map.getBearing().toFixed(2);
  }
  function tick(now) {
    requestAnimationFrame(tick);
    const dt = Math.min(0.1, Math.max(0, (now - lastNow) / 1000));
    lastNow = now;
    drawnInRender = false;
    try { update(dt, now); } catch (e) { console.error(e); }
    if (map._frameRequest) map.redraw();
    if (!drawnInRender) {
      const sig = camSig();
      if (sig !== lastSig || overlayDirty || now - ovT > 400) { lastSig = sig; ovT = now; drawOverlay(); }
      FX.draw(now);
    }
  }

  /* ================================================================ 启动 */
  FX.init($('#fx'), map);
  initLabels();
  buildChapTags();
  initUI();
  initIntro();
  setAtmo('dusk', true);
  S.dzW = parseFloat(getComputedStyle(root).getPropertyValue('--dz')) || 388;
  if (document.fonts) {
    document.fonts.load('16px SHS').then(() => { measure(); }).catch(() => {});
    document.fonts.ready.then(() => { measure(); if (S.mode !== 'intro' && S.mode !== 'all') renderProfile(); });
  }
  requestAnimationFrame(tick);
  window.__app = { S, get M() { return M; }, get map() { return map; }, llOf, posAt, kmOf, loadChapter, showAll, seek, enter, setPlaying, startTour, finishScene, setCam, fitChapter, fitAll, backToIntro, hideTitle, snapCam, pad, chapterEnd, fireAt };
})();
