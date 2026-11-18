# -*- coding: utf-8 -*-
"""三维考据地图 · 截图 + 自动查版面

  python3 shoot.py <项目目录>                  电脑（1440×900）和手机（390×844）都拍，约 3–5 分钟
  python3 shoot.py <项目目录> --only desktop   只拍电脑版（命令有时间上限时，电脑、手机分两次跑）
  python3 shoot.py <项目目录> --only mobile    只拍手机版
  python3 shoot.py <项目目录> --ch 3           只拍第 3 章（可写 --ch 2,5，也可写章节 id）
  python3 shoot.py <项目目录> --hd             两倍清晰度（慢，交付前看细节用）
  python3 shoot.py <项目目录> --soft-gl        地图一直是黑的 / 空白时用（软件渲染，慢但稳）

要联网：地图影像和高程瓦片从网上取。
产物：
  <项目>/qa/shots/desktop/*.png、mobile/*.png   每个画面一张
  <项目>/qa/sheet-desktop-1.png …               缩略图拼版，一张看十二个画面，有问题的画面描红框
  <项目>/qa/shots.json                          版面问题清单，每条带「怎么改」
有错误时退出码为 1。
"""
import collections, functools, hashlib, http.server, io, json, os, shutil, sys, threading, time
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import CACHE, SKILL, Report, StoryError, die, load_story, save_json, shq  # noqa: E402

VIEWPORTS = {'desktop': (1440, 900), 'mobile': (390, 844)}
# 地图瓦片本地缓存：第一次从网上取，之后重拍直接读盘（几秒拍完一章）。可随时删掉
WEB_CACHE = Path(os.environ.get('HMAP_WEBCACHE', str(CACHE / 'web')))
VP_N = {'desktop': '电脑', 'mobile': '手机'}

# ------------------------------------------------------------------ 页面里的检查函数（注入到浏览器执行）
QA_JS = r"""
(() => {
  const A = window.__app;
  const W = () => innerWidth, H = () => innerHeight;
  const opa = el => { let o = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') return 0; o *= +cs.opacity; } return o; };
  const vis = el => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 && opa(el) > 0.3; };
  const R = el => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; };
  const inter = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const area = a => Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]);
  const txt = el => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  const NAMES = { '#scene-card': '场景卡', '#poem': '诗作卡', '#subtitle p.on': '字幕', '#tour-card': '巡游说明卡', '#chapter-end': '章末面板',
    '#titlecard .tc-in': '章节标题卡', '#caption': '路线说明', '#toasts .toast': '途经提示', '#topbar': '顶栏', '#dock': '底部播放条',
    '#hud': '经纬度面板', '#legend': '图例', '#dossier': '章节资料面板', '#intro .in-wrap': '开场页' };
  const STORY = ['#scene-card', '#poem', '#subtitle p.on', '#tour-card', '#chapter-end', '#titlecard .tc-in', '#caption', '#toasts .toast'];
  const CHROME = ['#topbar', '#dock', '#hud', '#legend', '#dossier'];
  function all(sel) { return Array.from(document.querySelectorAll(sel)).filter(vis); }
  function boxes(list) { const out = []; list.forEach(sel => all(sel).forEach(el => out.push({ sel, el, r: R(el) }))); return out; }
  function ready() { const m = A.map; try { return !!m && m.loaded() && m.areTilesLoaded() && !m.isMoving(); } catch (e) { return false; } }
  function layout() {
    const out = [], w = W(), h = H();
    const add = (code, msg, data) => out.push(Object.assign({ code, msg }, data || {}));
    // 1. 讲故事的卡片超出屏幕
    const story = boxes(STORY);
    story.forEach(b => {
      const r = b.r, over = Math.max(-r[0], -r[1], r[2] - w, r[3] - h);
      if (over > 3) add('OFF_SCREEN', (NAMES[b.sel] || b.sel) + '超出屏幕 ' + Math.round(over) + ' 像素', { el: b.sel, px: Math.round(over), text: txt(b.el).slice(0, 40) });
    });
    // 2. 卡片里的字被裁掉（overflow:hidden 的盒子装不下）
    story.forEach(b => {
      [b.el].concat(Array.from(b.el.querySelectorAll('*'))).forEach(e => {
        if (!vis(e)) return;
        const cs = getComputedStyle(e);
        const hid = v => v === 'hidden' || v === 'clip';
        if ((hid(cs.overflowY) && e.scrollHeight > e.clientHeight + 3) || (hid(cs.overflowX) && e.scrollWidth > e.clientWidth + 3))
          add('TEXT_CLIPPED', (NAMES[b.sel] || b.sel) + '里有字被裁掉', { el: b.sel, text: txt(e).slice(0, 40) });
      });
    });
    // 3. 卡片互相压住、或压住界面
    const chrome = boxes(CHROME);
    for (let i = 0; i < story.length; i++) {
      const a = story[i];
      story.slice(i + 1).concat(chrome).forEach(b => {
        if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) return;
        const s = inter(a.r, b.r), m = Math.min(area(a.r), area(b.r));
        if (s > 300 && s > 0.04 * m) add('OVERLAP', (NAMES[a.sel] || a.sel) + '和' + (NAMES[b.sel] || b.sel) + '重叠（' + Math.round(100 * s / m) + '%）', { el: a.sel, el2: b.sel, pct: Math.round(100 * s / m) });
      });
    }
    // 4. 该一行的标题折行
    [['.sc-title', '场景标题'], ['#titlecard .tc-t', '章节标题'], ['#tour-card .tc-h', '巡游小标题'], ['#chapter-end .ce-t', '章末标题']].forEach(([sel, n]) => {
      all(sel).forEach(e => {
        const cs = getComputedStyle(e), lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3;
        const kids = Array.from(e.children).reduce((a, c) => a + (getComputedStyle(c).display === 'block' ? c.offsetHeight : 0), 0);
        if (e.offsetHeight - kids > lh * 1.7) add('WRAP', n + '折成了两行', { el: sel, text: (e.firstChild && e.firstChild.textContent || txt(e)).slice(0, 30) });
      });
    });
    // 5. 地图上的名字叠在一起（引擎会自动避让，叠住说明太密）
    const labs = Array.from(document.querySelectorAll('#overlay .lb, #overlay .wp, #overlay .sh, #overlay #head')).filter(e => opa(e) > 0.6).map(e => {
      const n = e.querySelector('.n, span, .hd-name') || e; const r = R(n); return { e, r, t: txt(n).slice(0, 14) || txt(e).slice(0, 14) };
    }).filter(l => l.r[2] > 0 && l.r[0] < w && l.r[3] > 0 && l.r[1] < h && area(l.r) > 30);
    for (let i = 0; i < labs.length; i++) for (let j = i + 1; j < labs.length; j++) {
      const s = inter(labs[i].r, labs[j].r), m = Math.min(area(labs[i].r), area(labs[j].r));
      if (s > 0.35 * m && labs[i].t && labs[j].t) add('LABEL_OVERLAP', '「' + labs[i].t + '」和「' + labs[j].t + '」叠在一起', { a: labs[i].t, b: labs[j].t });
    }
    return out;
  }
  // 演出：兵力、特效、中心点有没有跑出画面或被卡片挡住；每句字幕在这个屏宽下折几行
  function sceneCheck() {
    const s = A.S.scene; if (!s) return [];
    const out = [], sc = s.sc, w = W(), h = H(), m = A.map;
    const km = (x, y) => [s.at[0] + x / (111.32 * Math.cos(s.at[1] * Math.PI / 180)), s.at[1] + y / 110.574];
    const blk = boxes(['#scene-card', '#poem', '#subtitle p.on']).map(b => ({ n: NAMES[b.sel], r: b.r }));
    const pts = [];
    (sc.units || []).forEach((u, i) => { ['from', 'to'].forEach(k => { if (Array.isArray(u[k])) pts.push(['units[' + i + '].' + k, km(u[k][0], u[k][1])]); }); });
    (sc.fx || []).forEach((f, i) => { ['at', 'to', 'from'].forEach(k => { if (Array.isArray(f[k]) && typeof f[k][0] === 'number') pts.push(['fx[' + i + '].' + k, km(f[k][0], f[k][1])]); }); });
    const bad = [];
    pts.forEach(([n, ll]) => {
      const p = m.project(ll);
      if (!(p.x > 8 && p.x < w - 8 && p.y > 8 && p.y < h - 8)) { bad.push(n + ' 在画面外'); return; }
      const b = blk.find(q => p.x > q.r[0] && p.x < q.r[2] && p.y > q.r[1] && p.y < q.r[3]);
      if (b) bad.push(n + ' 被' + b.n + '挡住');
    });
    if (pts.length && bad.length / pts.length > 0.25) out.push({ code: 'SCENE_OFFSCREEN', msg: pts.length + ' 个兵力 / 特效位置里有 ' + bad.length + ' 个看不见：' + bad.slice(0, 4).join('；'), bad });
    const c = m.project(s.at), cb = blk.find(q => c.x > q.r[0] && c.x < q.r[2] && c.y > q.r[1] && c.y < q.r[3]);
    if (cb) out.push({ code: 'FOCUS_HIDDEN', msg: '演出中心点被' + cb.n + '挡住' });
    // 字幕：逐句放进字幕框量高度（不等时间轴）
    const sub = document.querySelector('#subtitle');
    if (sub && (sc.lines || []).length) {
      (sc.lines || []).forEach((ln, i) => {
        const p = document.createElement('p'); p.className = 'on'; p.style.visibility = 'hidden'; p.textContent = ln[1]; sub.appendChild(p);
        const lh = parseFloat(getComputedStyle(p).lineHeight) || 35, n = Math.round(p.offsetHeight / lh); p.remove();
        if (n > 2) out.push({ code: 'SUB_LINES', msg: '第 ' + (i + 1) + ' 句字幕折成 ' + n + ' 行', line: i, text: String(ln[1]).slice(0, 24), n });
      });
    }
    return out;
  }
  // 把演出定在第 T 秒（暂停状态），镜头摆到观众那一刻看到的位置
  function sceneTime(T) {
    const s = A.S.scene; if (!s) return false;
    const sc = s.sc, dur = sc.dur || 10, k = Math.min(1, Math.max(0, T / dur)), e = k * k * (3 - 2 * k);
    A.setPlaying(false);
    A.map.stop();
    s.t = T; s.user = false;
    if (!s.shown) { s.shown = true; document.querySelector('#scene-card').classList.add('on'); }
    s.c0 = -99;
    A.map.jumpTo({ center: s.at, zoom: s.z + 0.3 * e, pitch: sc.p != null ? sc.p : 60, bearing: (sc.b || 0) + (sc.orbit || 0) * e, padding: { top: 0, bottom: 0, left: 0, right: 0 } });
    return true;
  }
  function tourAt(i) {
    A.hideTitle(); A.setPlaying(false); A.startTour(i);
    const T = A.S.tour; if (!T) return false;
    const st = T.st;
    A.map.stop();
    A.map.jumpTo({ center: T.at, zoom: st.z || 7, pitch: st.p != null ? st.p : 50, bearing: st.b || 0, padding: A.pad() });
    T.t = Math.min(T.dur - 0.6, 2 + (st.dur || 8) * 0.6);
    return true;
  }
  function events() {
    return A.M.events.map((e, i) => {
      const sc = e.st && e.st.scene;
      return { i, km: e.km, key: e.key, side: !!e.side, scene: !!sc, title: sc ? sc.title || '' : '', dur: sc ? sc.dur || 10 : 0,
        lines: sc ? (sc.lines || []).map(l => l[0]) : [], poem: !!(sc && sc.poem && sc.poem.l && sc.poem.l.length) };
    });
  }
  window.__qa = { ready, layout, sceneCheck, sceneTime, tourAt, events };
  return true;
})()
"""

FIX = {
    'OFF_SCREEN': {
        '#scene-card': '场景卡太高：stats 减到 3 个以内，quote 缩到 30 字以内，或去掉 relic；长句子挪进 lines 当字幕',
        '#poem': '诗作卡太大：诗句减到 8 句以内，每句不超过 7 个字；长诗只摘最有名的几句',
        '#tour-card': '巡游说明太长：tour 的 d 缩到 50 字以内',
        '#chapter-end': '章末面板放不下：章节 title 缩到 4 字以内、sub 缩到 16 字以内',
        '#titlecard .tc-in': '章节标题卡放不下：title 缩到 4 字以内、sub 缩到 16 字以内，era / year / age 写短',
        '#toasts .toast': '途经提示太长：toast 缩到 30 字以内',
        '#caption': '路线说明太长：track 的 cap 缩到 20 字以内',
        '': '缩短这张卡片里的文字',
    },
    'TEXT_CLIPPED': '缩短这张卡片里的文字（被裁掉的那段见 text）',
    'OVERLAP': {
        ('#scene-card', '#poem'): '诗作卡和场景卡抢地方：诗句减到 8 句以内；或者这个演出去掉 stats / quote，让卡片矮一点',
        ('#scene-card', '#subtitle p.on'): '字幕压到场景卡：这句字幕缩到 20 字以内，或拆成两句',
        ('#poem', '#subtitle p.on'): '字幕压到诗：诗作演出的 lines 少写几句、每句写短',
        '': '两张卡片叠在一起：缩短其中一张的文字',
    },
    'WRAP': '标题写短一点（场景标题 ≤ 10 字，章节标题 ≤ 5 字，巡游小标题 ≤ 12 字；长标题引擎会自动缩字号，再长就放不下了）',
    'LABEL_OVERLAP': '两个地名挤在一起：在 labels.json 里给其中一个把 z 调大 0.5–1（放大后才出现），或把 ll 挪开一点；两个都是航点就删掉一个的 n（变成只画线的转折点）',
    'SCENE_OFFSCREEN': '把 scene.z 调小 0.5（镜头拉远），或把 units / fx 的 from、to、at 偏移缩短（单位是公里，一般 ±25 以内）；被卡片挡住时调 scene.b 转个方向',
    'FOCUS_HIDDEN': '调 scene.b（转个方向）或把 scene.at 换一个点，让演出中心露出来',
    'SUB_LINES': '这句字幕太长，拆成两句：lines 里多加一条，时间往后错 3 秒；手机上一句最好不超过 18 个字',
    'MAP_BLANK': '地图没画出来：先确认能联网（影像和高程瓦片在网上）；再试 --soft-gl',
    'JS_ERROR': '页面脚本报错。先运行 build.py 看检查报告有没有漏掉的错误；还不行就把这条报错原文写进 qa/notes.md，交给人处理',
    'SCENE_NOT_FIRED': '这个演出没有触发。运行 check.py，看有没有 NOT_ON_TRACK（stops 的键不在主线上，或支线的写到了 stops 里）',
    'TILES_SLOW': '拍的时候瓦片还没加载完，画面可能发糊。网络慢就重拍一次，不用改故事',
    'NET_FAIL': '网络请求失败，跟故事写得好不好无关。网络好了再拍',
    'PAGE_DEAD': '页面没跑起来。先运行 build.py；如果构建没问题，把这条报错原文写进 qa/notes.md，交给人处理',
}
LEVEL = {'OFF_SCREEN': 'WARN', 'TEXT_CLIPPED': 'WARN', 'OVERLAP': 'WARN', 'WRAP': 'WARN', 'LABEL_OVERLAP': 'INFO', 'SCENE_OFFSCREEN': 'WARN',
         'FOCUS_HIDDEN': 'WARN', 'SUB_LINES': 'WARN', 'MAP_BLANK': 'ERROR', 'JS_ERROR': 'ERROR', 'SCENE_NOT_FIRED': 'ERROR',
         'TILES_SLOW': 'INFO', 'NET_FAIL': 'INFO', 'PAGE_DEAD': 'ERROR'}


def fix_of(it):
    f = FIX.get(it['code'], '')
    if isinstance(f, dict):
        if it['code'] == 'OVERLAP':
            k = (it.get('el'), it.get('el2'))
            return f.get(k) or f.get((k[1], k[0])) or f['']
        return f.get(it.get('el'), f[''])
    return f


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


def serve(root):
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(root)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def make_router(net):
    """拦下网上的瓦片请求：有缓存直接给，没有就去取（12 秒超时）并存盘"""
    def handler(route):
        try:
            req = route.request
            if req.method != 'GET':
                route.continue_(); return
            u = req.url
            h = hashlib.sha1(u.encode()).hexdigest()
            f = WEB_CACHE / h[:2] / h
            if f.exists():
                b = f.read_bytes()
                ct = 'image/png' if b[:4] == b'\x89PNG' else 'image/jpeg' if b[:2] == b'\xff\xd8' else 'application/octet-stream'
                route.fulfill(status=200, body=b, headers={'content-type': ct, 'access-control-allow-origin': '*'}); return
            try:
                r = route.fetch(timeout=12000)
            except Exception:  # noqa: BLE001
                net.update([urlparse(u).netloc + '（超时）'])
                route.abort(); return
            if r.status == 200 and r.headers.get('content-type', '').startswith('image/'):
                try:
                    f.parent.mkdir(parents=True, exist_ok=True); f.write_bytes(r.body())
                except OSError:
                    pass
            elif r.status >= 400 and r.status != 404:
                net.update([urlparse(u).netloc + f'（{r.status}）'])
            route.fulfill(response=r)
        except Exception:  # noqa: BLE001
            pass  # 页面已经关掉
    return handler


def launch(pw, soft):
    args = ['--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--mute-audio']
    if soft: args += ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    else:
        args.append('--enable-gpu')
        if sys.platform == 'darwin': args.append('--use-angle=metal')
    last = None
    for kw in (dict(channel='chrome'), dict()):
        try:
            return pw.chromium.launch(headless=True, args=args, **kw)
        except Exception as e:  # noqa: BLE001
            last = e
    die('打不开浏览器：' + str(last).split('\n')[0] + '\n  怎么改：运行  python3 -m playwright install chromium  ，装好后再跑一次')


def blank(png_bytes):
    """地图区域几乎是纯色 → 没画出来"""
    from PIL import Image, ImageStat
    im = Image.open(io.BytesIO(png_bytes)).convert('L')
    w, h = im.size
    im = im.crop((int(w * 0.2), int(h * 0.25), int(w * 0.8), int(h * 0.75))).resize((96, 64))
    return ImageStat.Stat(im).stddev[0] < 5


class Shooter:
    def __init__(self, proj, story, vp, page, outdir, log, state):
        self.proj, self.story, self.vp, self.page, self.out, self.log, self.state = proj, story, vp, page, outdir, log, state
        self.shots = []
        self.seq = 0
        self.files = {c.get('id'): f'chapters/{f.name}' for f, c in story['chapters']}

    def wait(self, js, sec):
        try:
            self.page.wait_for_function(js, timeout=int(sec * 1000), polling=100)
            return True
        except Exception:  # noqa: BLE001
            return False

    def settle(self, sec=8, min_sec=0.6):
        t0 = time.time()
        self.page.wait_for_timeout(int(min_sec * 1000))
        ok = self.wait('() => window.__qa.ready()', max(0.5, sec - (time.time() - t0)))
        self.page.wait_for_timeout(250)
        return ok

    def issue(self, shot, it, where_file='', fix=None):
        lv = LEVEL.get(it['code'], 'WARN')
        where = f"{VP_N[self.vp]} · {shot['title']}" + (f"（{where_file}）" if where_file else '')
        msg = it['msg'] + (f"：「{it['text']}」" if it.get('text') and it['code'] in ('OFF_SCREEN', 'TEXT_CLIPPED', 'WRAP', 'SUB_LINES') else '')
        shot['issues'].append({'level': lv, 'code': it['code'], 'where': where, 'msg': msg, 'fix': fix or fix_of(it)})

    def shot(self, name, title, ch, kind, where_file='', checks=True, extra=None, tiles=True):
        self.seq += 1
        shot = {'file': '', 'vp': self.vp, 'ch': ch, 'kind': kind, 'title': title, 'seq': self.seq, 'issues': []}
        if checks:
            seen = set()
            for it in self.page.evaluate('() => window.__qa.layout()') + (extra or []):
                k = (it['code'], it['msg'])
                if k in seen: continue
                seen.add(k)
                self.issue(shot, it, where_file)
        if not tiles: self.issue(shot, {'code': 'TILES_SLOW', 'msg': '瓦片没加载完'}, where_file)
        png = self.page.screenshot(type='png')
        f = self.out / f'{name}.png'
        f.write_bytes(png)
        shot['file'] = str(f.relative_to(self.proj))
        if kind not in ('intro', 'title') and blank(png):
            self.issue(shot, {'code': 'MAP_BLANK', 'msg': '地图区域一片空白'}, where_file)
        self.shots.append(shot)
        bad = [i for i in shot['issues'] if i['level'] != 'INFO']
        self.log(f"  {'▲' if bad else '✓'} {title}" + (f"（{len(bad)} 个问题）" if bad else ''))
        return shot

    def intro(self):
        self.wait("() => document.querySelector('#in-load') && document.querySelector('#in-load').classList.contains('done')", 12)
        self.page.wait_for_timeout(4300)
        self.shot('00-intro', '开场页', '_intro', 'intro', 'site.json', checks=False)
        # 开场页的字有没有出屏
        over = self.page.evaluate("""() => { const w = innerWidth, h = innerHeight, out = [];
          document.querySelectorAll('#intro *').forEach(e => { if (!e.children.length && (e.textContent || '').trim()) { const r = e.getBoundingClientRect();
            if (r.width > 0 && (r.left < -3 || r.right > w + 3 || r.top < -3 || r.bottom > h + 3)) out.push((e.textContent || '').trim().slice(0, 20)); } }); return out; }""")
        for t in over[:4]:
            self.issue(self.shots[-1], {'code': 'OFF_SCREEN', 'msg': f'开场页的字出了屏幕：「{t}」'}, 'site.json',
                       'site.json 的 title、subtitle、motto、introStats 写短一点')

    def chapter(self, i, ch):
        p, cid = self.page, ch.get('id')
        num = f'{i + 1:02d}'
        fn = self.files.get(cid, '')
        head = f"{ch.get('num', '')} {ch.get('title', '')}".strip()
        self.log(f"[{VP_N[self.vp]}] 第 {i + 1} 章 {head}")
        self.state['ch'] = cid
        p.evaluate('(i) => __app.loadChapter(i, { flyDur: 400 })', i)
        p.wait_for_timeout(1500)
        self.shot(f'{num}-{cid}-title', f'{head} · 标题卡', cid, 'title', fn, tiles=True)
        p.evaluate('() => __app.hideTitle()')
        evs = p.evaluate('() => window.__qa.events()')
        is_tour = not ch.get('track') and ch.get('tour')
        if is_tour:
            for k, st in enumerate(ch.get('tour') or []):
                p.evaluate('(k) => window.__qa.tourAt(k)', k)
                p.wait_for_timeout(900)
                ok = self.settle(7, 0.3)
                self.shot(f'{num}-{cid}-tour{k + 1}', f"{head} · 巡游 {k + 1} {st.get('h', '')}", cid, 'tour', f'{fn} → tour[{k}]', tiles=ok)
        else:
            total = p.evaluate('() => __app.M.total')
            p.evaluate('(km) => { __app.seek(km, false); __app.snapCam(); }', total * 0.42)
            ok = self.settle(8)
            self.shot(f'{num}-{cid}-mid', f'{head} · 行进途中', cid, 'mid', fn, tiles=ok)
            n_sc = 0
            for ev in evs:
                if not ev['scene']: continue
                n_sc += 1
                grp = 'sideStops' if ev['side'] else 'stops'
                where = f"{fn} → {grp}.{ev['key']}.scene"
                fired = p.evaluate('(i) => { __app.fireAt(i); return !!__app.S.scene; }', ev['i'])
                if not fired:
                    self.seq += 1
                    sh = {'file': '', 'vp': self.vp, 'ch': cid, 'kind': 'scene', 'title': f"{head} · 演出 {ev['title']}", 'seq': self.seq, 'issues': []}
                    self.issue(sh, {'code': 'SCENE_NOT_FIRED', 'msg': f"演出「{ev['title']}」没有触发"}, where)
                    self.shots.append(sh)
                    continue
                lines, dur = ev['lines'], ev['dur']
                if ev['poem']: T = dur
                elif lines:
                    j = min(range(len(lines)), key=lambda j: abs(lines[j] - dur * 0.5))
                    T = lines[j] + 0.4
                else: T = dur * 0.5
                p.evaluate('(T) => window.__qa.sceneTime(T)', T)
                ok = self.settle(8, 1.0)
                extra = p.evaluate('() => window.__qa.sceneCheck()')
                self.shot(f"{num}-{cid}-scene{n_sc}-{ev['key']}", f"{head} · 演出 {ev['title']}", cid, 'scene', where, extra=extra, tiles=ok)
                p.evaluate('() => __app.finishScene()')
            p.evaluate('() => { __app.seek(__app.M.total, false); __app.chapterEnd(); __app.fitChapter(300); }')
            ok = self.settle(8, 1.0)
            self.shot(f'{num}-{cid}-end', f'{head} · 本章全图', cid, 'end', fn, tiles=ok)

    def overview(self):
        self.log(f'[{VP_N[self.vp]}] 全部路线')
        self.state['ch'] = '_all'
        self.page.evaluate("() => { __app.showAll(); __app.fitAll(300); }")
        ok = self.settle(8, 1.2)
        self.shot('99-all', '全部路线', '_all', 'all', 'site.json', tiles=ok)


def contact_sheets(proj, shots, vp):
    from PIL import Image, ImageDraw, ImageFont
    qa = proj / 'qa'
    for old in qa.glob(f'sheet-{vp}-*.png'): old.unlink()
    items = [s for s in shots if s['vp'] == vp and s.get('file') and (proj / s['file']).exists()]
    if not items: return []
    tw = 470 if vp == 'desktop' else 230
    cols = 3 if vp == 'desktop' else 6
    per = cols * (4 if vp == 'desktop' else 2)
    font = None
    for fp in (Path.home() / 'Library' / 'Fonts' / 'SourceHanSerifSC-VF.ttf', Path('/System/Library/Fonts/STHeiti Medium.ttc'),
               Path('/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc'), Path('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc')):
        try:
            font = ImageFont.truetype(str(fp), 15); break
        except Exception:  # noqa: BLE001
            continue
    font = font or ImageFont.load_default()
    out = []
    for si in range(0, len(items), per):
        batch = items[si:si + per]
        ims = []
        for s in batch:
            im = Image.open(proj / s['file']).convert('RGB')
            th = round(im.height * tw / im.width)
            ims.append((s, im.resize((tw, th))))
        th = max(i.height for _, i in ims)
        cap = 40
        rows = (len(ims) + cols - 1) // cols
        sheet = Image.new('RGB', (cols * (tw + 12) + 12, rows * (th + cap + 12) + 12), (20, 18, 16))
        d = ImageDraw.Draw(sheet)
        for k, (s, im) in enumerate(ims):
            x, y = 12 + (k % cols) * (tw + 12), 12 + (k // cols) * (th + cap + 12)
            sheet.paste(im, (x, y))
            bad = [i for i in s['issues'] if i['level'] != 'INFO']
            if bad:
                d.rectangle([x - 3, y - 3, x + tw + 2, y + im.height + 2], outline=(230, 60, 40), width=4)
            t = s['title'] + (f'  ▲{len(bad)}' if bad else '')
            d.text((x, y + im.height + 6), t[:34 if vp == 'desktop' else 15], fill=(255, 120, 90) if bad else (235, 225, 205), font=font)
        f = qa / f'sheet-{vp}-{si // per + 1}.png'
        sheet.save(f, optimize=True)
        out.append(f)
    return out


def main(argv):
    if len(argv) < 2 or argv[1] in ('-h', '--help'): print(__doc__); return 0
    proj = Path(argv[1]).resolve()
    opt = lambda k: argv[argv.index(k) + 1] if k in argv and argv.index(k) + 1 < len(argv) else None  # noqa: E731
    only, chsel, hd, soft = opt('--only'), opt('--ch'), '--hd' in argv, '--soft-gl' in argv
    if only and only not in VIEWPORTS: die(f'--only 只能写 desktop 或 mobile，你写的是 {only}')
    dist = proj / 'dist'
    if not (dist / 'index.html').exists():
        die(f'还没有网站成品。先运行：python3 {shq(SKILL / "scripts" / "build.py")} {shq(proj)}')
    try:
        story = load_story(proj)
    except StoryError as e:
        die(str(e))
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        die('缺少 playwright。怎么改：运行  python3 -m pip install playwright pillow  再运行  python3 -m playwright install chromium')
    chs = [c for _, c in story['chapters']]
    pick = list(range(len(chs)))
    if chsel:
        pick = []
        for tok in str(chsel).split(','):
            tok = tok.strip()
            if tok.isdigit() and 1 <= int(tok) <= len(chs): pick.append(int(tok) - 1)
            else:
                j = next((j for j, c in enumerate(chs) if c.get('id') == tok), None)
                if j is None: die(f'--ch 写的「{tok}」不是章节序号（1–{len(chs)}）也不是章节 id')
                pick.append(j)
    vps = [only] if only else ['desktop', 'mobile']
    redo = {c.get('id') for c in (chs[j] for j in pick)} | (set() if chsel else {'_intro', '_all', '_load'})
    qa = proj / 'qa'
    try:
        old = json.loads((qa / 'shots.json').read_text(encoding='utf-8'))
    except Exception:  # noqa: BLE001
        old = {}
    # 只重拍了一部分时，别的章节 / 别的屏幕上次的结果留着
    gone = lambda s: s.get('vp') in vps and s.get('ch') in redo  # noqa: E731
    keep = [s for s in old.get('shots', []) if not gone(s) and s.get('ch') in {c.get('id') for c in chs} | {'_intro', '_all', '_load'}]
    globs = [g for g in old.get('globals', []) if not gone(g)]
    t0 = time.time()
    log = lambda s: print(s, flush=True)  # noqa: E731
    srv = serve(dist)
    url = f'http://127.0.0.1:{srv.server_address[1]}/index.html'
    new_shots = []
    with sync_playwright() as pw:
        br = launch(pw, soft)
        for vp in vps:
            w, h = VIEWPORTS[vp]
            out = qa / 'shots' / vp
            if not chsel and out.exists(): shutil.rmtree(out)
            out.mkdir(parents=True, exist_ok=True)
            for j in pick:
                for f in out.glob(f'{j + 1:02d}-*.png'): f.unlink()
            ctx = br.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2 if (hd or vp == 'mobile') else 1,
                                 is_mobile=vp == 'mobile', has_touch=vp == 'mobile', locale='zh-CN')
            page = ctx.new_page()
            page.set_default_timeout(30000)
            state = {'ch': '_load'}
            jserr, net = [], collections.Counter()

            def on_console(m, jserr=jserr, net=net, state=state):
                if m.type != 'error': return
                t = m.text
                if 'Failed to load resource' in t or 'AJAXError' in t or 'net::' in t: net['（控制台）'] += 1
                else: jserr.append((state['ch'], t))
            page.on('console', on_console)
            page.on('pageerror', lambda e, jserr=jserr, state=state: jserr.append((state['ch'], str(e))))
            ctx.route(lambda u: not u.startswith('http://127.0.0.1'), make_router(net))
            # 网站自己的文件 404：少了文件，算错误
            page.on('response', lambda r, jserr=jserr, state=state: jserr.append((state['ch'], f'网站缺文件 {urlparse(r.url).path}（{r.status}）'))
                    if r.status >= 400 and r.url.startswith('http://127.0.0.1') and not r.url.endswith('favicon.ico') else None)
            log(f'\n==== 开拍：{VP_N[vp]}（{w}×{h}）====')
            page.goto(url, wait_until='load', timeout=60000)
            sh = Shooter(proj, story, vp, page, out, log, state)
            vg = []
            G = lambda code, ch, where, msg, fix: vg.append({'vp': vp, 'ch': ch, 'level': LEVEL[code], 'code': code, 'where': f'{VP_N[vp]} · {where}', 'msg': msg, 'fix': fix})  # noqa: E731
            if not sh.wait('() => window.__app && window.__app.map && window.__app.map.loaded()', 40):
                G('PAGE_DEAD', '_load', '打开页面', '页面 40 秒内没跑起来' + (f'：{jserr[0][1][:200]}' if jserr else ''), FIX['PAGE_DEAD'])
            else:
                page.evaluate(QA_JS)
                try:
                    page.evaluate('() => document.fonts.ready.then(() => 1)')
                except Exception:  # noqa: BLE001
                    pass
                if not chsel: sh.intro()
                page.evaluate('() => __app.enter(false)')
                page.wait_for_timeout(600)
                for j in pick:
                    try:
                        sh.chapter(j, chs[j])
                    except Exception as e:  # noqa: BLE001
                        G('JS_ERROR', chs[j].get('id'), f"第 {j + 1} 章 {chs[j].get('title', '')}", '拍这一章时出错：' + str(e).split('\n')[0][:200], FIX['JS_ERROR'])
                if not chsel:
                    try:
                        sh.overview()
                    except Exception as e:  # noqa: BLE001
                        G('JS_ERROR', '_all', '全部路线', '拍全图时出错：' + str(e).split('\n')[0][:200], FIX['JS_ERROR'])
            names = {c.get('id'): f"第 {k + 1} 章 {c.get('title', '')}" for k, c in enumerate(chs)}
            names.update({'_load': '打开页面', '_intro': '开场页', '_all': '全部路线'})
            for ch, t in list(dict.fromkeys(jserr))[:8]:
                G('JS_ERROR', ch, f"{names.get(ch, ch)} · 页面脚本", t[:240], FIX['JS_ERROR'])
            for host, n in net.most_common(4):
                G('NET_FAIL', '_load', '网络', f'{host} 有 {n} 个请求失败', FIX['NET_FAIL'])
            globs += vg
            new_shots += sh.shots
            ctx.close()
        br.close()
    srv.shutdown()
    order = {c.get('id'): k for k, c in enumerate(chs)}
    order.update({'_load': -2, '_intro': -1, '_all': 999})
    shots = sorted(keep + new_shots, key=lambda s: (s['vp'] != 'desktop', order.get(s['ch'], 500), s.get('seq', 0)))
    rep = Report()
    for g in globs: rep.items.append({k: g[k] for k in ('level', 'code', 'where', 'msg', 'fix')})
    for s in shots: rep.items += s['issues']
    sheets = []
    for vp in ('desktop', 'mobile'):
        sheets += contact_sheets(proj, shots, vp)
    save_json(qa / 'shots.json', {'time': time.strftime('%Y-%m-%d %H:%M:%S'), 'sheets': [str(s.relative_to(proj)) for s in sheets],
                                  'issues': rep.items, 'globals': globs, 'shots': shots})
    rep.print('版面检查')
    print(f'\n本次截图 {len([s for s in new_shots if s["file"]])} 张，用时 {time.time() - t0:.0f} 秒')
    for s in sheets: print(f'  拼版：{s}')
    print(f'  清单：{qa / "shots.json"}')
    if rep.errors:
        print(f'\n✖ {len(rep.errors)} 个错误要先修。修完运行 build.py，再运行 shoot.py')
        return 1
    if rep.warns:
        print(f'\n▲ {len(rep.warns)} 个警告：照「怎么改」修完，build.py → shoot.py 再来一轮（可以只拍改过的章：--ch 序号）')
    else:
        print('\n✔ 版面检查通过。再打开拼版图逐张看一遍画面（看图清单见 references/review.md）')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
