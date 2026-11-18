# -*- coding: utf-8 -*-
"""三维考据地图 · 地理数据构建与查询

  python3 geo.py build  <项目目录>           生成 <项目>/dist/data/geo.js（build.py 会自动调用）
  python3 geo.py rivers <西,南,东,北>         列出这个范围里 Natural Earth 有哪些河（英文名 / 中文名 / 等级）
  python3 geo.py lakes  <西,南,东,北>         列出湖泊
  python3 geo.py near   <经度> <纬度>         这个点的海拔、最近的几条河和距离（核对坐标用）
  python3 geo.py inspect <文件.geojson> [属性名]   看一个 geojson 有哪些属性、每个属性有哪些取值（做疆域时用）
  python3 geo.py route  <项目目录> <路线id>    单独算一条路线，打印长度、经停点公里数、海拔范围
"""
import hashlib, heapq, io, json, math, os, sys, time, urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import NE_DIR, TILE_CACHE, StoryError, die, hav, load_json, load_story  # noqa: E402

import numpy as np  # noqa: E402

VERSION = 'geo-4'
NET_FAIL = {'n': 0}


# ------------------------------------------------------------------ 高程瓦片（AWS Terrain Tiles, terrarium 编码）
_cache = {}
def tile(z, x, y):
    k = (z, x, y)
    if k in _cache: return _cache[k]
    TILE_CACHE.mkdir(parents=True, exist_ok=True)
    p = TILE_CACHE / f'{z}_{x}_{y}.png'
    if not p.exists():
        url = f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
        ok = False
        for i in range(4):
            try:
                req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 map-prep'})
                data = urllib.request.urlopen(req, timeout=30).read()
                p.write_bytes(data); ok = True
                break
            except Exception as e:  # 网络抖动重试
                print('  重试下载高程瓦片', url, e); time.sleep(1.5)
        if not ok:
            NET_FAIL['n'] += 1
            _cache[k] = np.zeros((256, 256))
            return _cache[k]
    from PIL import Image
    im = np.asarray(Image.open(p).convert('RGB')).astype(np.float64)
    e = im[:, :, 0] * 256 + im[:, :, 1] + im[:, :, 2] / 256 - 32768
    _cache[k] = e
    return e


def world_px(lon, lat, z):
    n = 256 * (2 ** z)
    x = (lon + 180) / 360 * n
    s = math.sin(math.radians(lat))
    y = (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n
    return x, y


def px_lonlat(px, py, z):
    n = 256 * (2 ** z)
    lon = px / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * py / n))))
    return lon, lat


def elev(lon, lat, z=8):
    x, y = world_px(lon, lat, z)
    x -= 0.5; y -= 0.5
    x0, y0 = int(math.floor(x)), int(math.floor(y))
    fx, fy = x - x0, y - y0
    def v(px, py): return tile(z, px // 256, py // 256)[py % 256, px % 256]
    a = v(x0, y0); b = v(x0 + 1, y0); c = v(x0, y0 + 1); d = v(x0 + 1, y0 + 1)
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def peak(bbox, z=9):
    lo1, la1, lo2, la2 = bbox
    xa, ya = world_px(lo1, la2, z); xb, yb = world_px(lo2, la1, z)
    best = (-1e9, 0, 0)
    for tx in range(int(xa // 256), int(xb // 256) + 1):
        for ty in range(int(ya // 256), int(yb // 256) + 1):
            e = tile(z, tx, ty)
            for py in range(256):
                gy = ty * 256 + py
                if gy < ya or gy > yb: continue
                row = e[py]; gx0 = tx * 256
                lo = max(0, int(math.ceil(xa - gx0))); hi = min(255, int(math.floor(xb - gx0)))
                if lo > hi: continue
                i = int(np.argmax(row[lo:hi + 1])) + lo
                if row[i] > best[0]: best = (row[i], gx0 + i + 0.5, gy + 0.5)
    lon, lat = px_lonlat(best[1], best[2], z)
    return [round(lon, 4), round(lat, 4), int(round(best[0]))]


# ------------------------------------------------------------------ 几何
def rdp(pts, eps):
    if len(pts) < 3: return [list(p) for p in pts]
    pts = np.asarray(pts, dtype=float)
    keep = np.zeros(len(pts), bool); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        s, e = stack.pop()
        if e <= s + 1: continue
        a, b = pts[s], pts[e]; seg = pts[s + 1:e]
        ab = b - a; L = np.hypot(*ab)
        if L == 0: d = np.hypot(*(seg - a).T)
        else: d = np.abs(ab[0] * (seg[:, 1] - a[1]) - ab[1] * (seg[:, 0] - a[0])) / L
        i = int(np.argmax(d))
        if d[i] > eps:
            keep[s + 1 + i] = True
            stack.append((s, s + 1 + i)); stack.append((s + 1 + i, e))
    return pts[keep].tolist()


def r4(p): return [round(p[0], 4), round(p[1], 4)]


def catmull(ctrl, step_km=1.0):
    """向心 Catmull-Rom：穿过每个控制点的平滑曲线"""
    if len(ctrl) < 2: return [list(p) for p in ctrl]
    lat0 = sum(p[1] for p in ctrl) / len(ctrl)
    k = math.cos(math.radians(lat0))
    P = [np.array([p[0] * k, p[1]]) for p in ctrl]
    P = [P[0] * 2 - P[1]] + P + [P[-1] * 2 - P[-2]]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        def tj(ti, a, b): return ti + max(np.hypot(*(b - a)), 1e-9) ** 0.5
        t0 = 0; t1 = tj(t0, p0, p1); t2 = tj(t1, p1, p2); t3 = tj(t2, p2, p3)
        seglen = hav(ctrl[i - 1], ctrl[i])
        n = max(2, int(seglen / step_km))
        for j in range(n):
            t = t1 + (t2 - t1) * j / n
            A1 = (t1 - t) / (t1 - t0) * p0 + (t - t0) / (t1 - t0) * p1
            A2 = (t2 - t) / (t2 - t1) * p1 + (t - t1) / (t2 - t1) * p2
            A3 = (t3 - t) / (t3 - t2) * p2 + (t - t2) / (t3 - t2) * p3
            B1 = (t2 - t) / (t2 - t0) * A1 + (t - t0) / (t2 - t0) * A2
            B2 = (t3 - t) / (t3 - t1) * A2 + (t - t1) / (t3 - t1) * A3
            C = (t2 - t) / (t2 - t1) * B1 + (t - t1) / (t2 - t1) * B2
            out.append([C[0] / k, C[1]])
    out.append(list(ctrl[-1]))
    return out


def densify(ctrl, step_km=1.0):
    out = []
    for a, b in zip(ctrl, ctrl[1:]):
        n = max(1, int(hav(a, b) / step_km))
        for j in range(n): out.append([a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n])
    out.append(list(ctrl[-1]))
    return out


def resample(line, step=2.0):
    cum = [0.0]
    for i in range(1, len(line)): cum.append(cum[-1] + hav(line[i - 1], line[i]))
    L = cum[-1]
    n = max(2, int(round(L / step)) + 1)
    res = []; j = 0
    for i in range(n):
        s = L * i / (n - 1)
        while j < len(cum) - 2 and cum[j + 1] < s: j += 1
        seg = cum[j + 1] - cum[j]
        f = 0 if seg == 0 else (s - cum[j]) / seg
        a, b = line[j], line[j + 1]
        res.append([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f])
    cum2 = [0.0]
    for i in range(1, len(res)): cum2.append(cum2[-1] + hav(res[i - 1], res[i]))
    return res, cum2


def ellipse(cx, cy, rx, ry, rot=0, n=48, wobble=0.0, seed=1):
    rng = np.random.default_rng(seed)
    ph = rng.uniform(0, 6.28, 3)
    pts = []
    for i in range(n + 1):
        t = 2 * math.pi * i / n
        w = 1 + wobble * (math.sin(3 * t + ph[0]) * 0.5 + math.sin(5 * t + ph[1]) * 0.3 + math.sin(7 * t + ph[2]) * 0.2)
        x = rx * math.cos(t) * w; y = ry * math.sin(t) * w
        c, s = math.cos(rot), math.sin(rot)
        pts.append([round(cx + (x * c - y * s) / math.cos(math.radians(cy)), 4), round(cy + x * s + y * c, 4)])
    pts[-1] = pts[0]
    return pts


def lines_of(geom):
    if not geom: return []
    if geom['type'] == 'LineString': return [geom['coordinates']]
    if geom['type'] == 'MultiLineString': return geom['coordinates']
    return []


def polys_of(geom):
    if not geom: return []
    if geom['type'] == 'Polygon': return [geom['coordinates']]
    if geom['type'] == 'MultiPolygon': return geom['coordinates']
    return []


def in_bb(coords, bb):
    xs = [c[0] for c in coords]; ys = [c[1] for c in coords]
    return not (max(xs) < bb[0] or min(xs) > bb[2] or max(ys) < bb[1] or min(ys) > bb[3])


def fc(features): return {'type': 'FeatureCollection', 'features': features}


# ------------------------------------------------------------------ Natural Earth
_ne = {}
def ne(name):
    if name not in _ne:
        p = NE_DIR / f'{name}_10m.geojson'
        if not p.exists(): die(f'缺少 Natural Earth 数据 {p}')
        _ne[name] = json.load(open(p, encoding='utf-8'))['features']
    return _ne[name]


def river_names(p):
    return {x for x in (p.get('name'), p.get('name_en'), p.get('name_zh')) if x}


def river_lines(names, bb=None):
    names = set([names] if isinstance(names, str) else names)
    out = []
    for f in ne('rivers'):
        if river_names(f['properties']) & names:
            for ln in lines_of(f.get('geometry')):
                if bb is None or in_bb(ln, bb): out.append(ln)
    return out


def follow_river(names, a, b, eps=0.004):
    """沿一条河从 a 附近走到 b 附近：把这条河的所有线段连成图，求最短路"""
    lines = river_lines(names)
    if not lines: raise StoryError(f'Natural Earth 里找不到叫 {names} 的河。用 python3 geo.py rivers 西,南,东,北 查这一带的河名')
    key = lambda c: (round(c[0], 4), round(c[1], 4))
    adj, pts = {}, {}
    for ln in lines:
        for u, v in zip(ln, ln[1:]):
            ku, kv = key(u), key(v)
            pts[ku] = u; pts[kv] = v
            w = hav(u, v)
            adj.setdefault(ku, []).append((kv, w)); adj.setdefault(kv, []).append((ku, w))
    # 不同要素在交汇处坐标可能不完全相等：把 300 米内的端点也连起来
    ends = [key(ln[0]) for ln in lines] + [key(ln[-1]) for ln in lines]
    for i in range(len(ends)):
        for j in range(i + 1, len(ends)):
            if ends[i] != ends[j] and hav(ends[i], ends[j]) < 0.3:
                adj[ends[i]].append((ends[j], 0.0)); adj[ends[j]].append((ends[i], 0.0))
    ka = min(pts, key=lambda k: hav(k, a)); kb = min(pts, key=lambda k: hav(k, b))
    da, db = hav(ka, a), hav(kb, b)
    dist, prev, pq = {ka: 0.0}, {}, [(0.0, ka)]
    while pq:
        d, u = heapq.heappop(pq)
        if u == kb: break
        if d > dist.get(u, 1e18): continue
        for v, w in adj.get(u, []):
            nd = d + w
            if nd < dist.get(v, 1e18): dist[v] = nd; prev[v] = u; heapq.heappush(pq, (nd, v))
    if kb not in dist: raise StoryError(f'河 {names} 在两点之间不连通（可能是两条同名的河）。把这一段拆开，中间加一个经停点')
    path, u = [kb], kb
    while u != ka: u = prev[u]; path.append(u)
    path.reverse()
    line = rdp([list(p) for p in path], eps)
    return line, {'river_km': round(dist[kb], 1), 'off_a': round(da, 1), 'off_b': round(db, 1)}


# ------------------------------------------------------------------ 构建
def resolve_places(places, peaks, rivers_fc, lakes_fc, warn):
    nodes = {}
    for k, p in places.items():
        if k.startswith('_'): continue
        if p.get('ll'):
            nodes[k] = [round(float(p['ll'][0]), 4), round(float(p['ll'][1]), 4)]
        elif p.get('peak'):
            pk = p['peak']
            if isinstance(pk, str):
                if pk not in peaks: raise StoryError(f'places.json 的 {k} 写了 peak:"{pk}"，但 geo.json 的 peaks 里没有 {pk}')
                nodes[k] = peaks[pk][:2]
            else:
                nodes[k] = peak(pk)[:2]
        elif p.get('snap'):
            sn = p['snap']; near = sn.get('near')
            if sn.get('river'):
                cs = [c for ln in river_lines(sn['river']) for c in ln]
            else:
                cs = [c for f in lakes_fc['features'] if f['properties'].get('n') == sn.get('lake') for c in f['geometry']['coordinates'][0]]
            if not cs or not near: raise StoryError(f'places.json 的 {k}：snap 找不到 {sn}')
            best = min(cs, key=lambda c: hav(c, near))
            nodes[k] = r4(best)
        else:
            raise StoryError(f'places.json 的 {k} 没有坐标：写 "ll": [经度, 纬度]')
    return nodes


def via_points(rid, route, nodes, warn):
    """把 via 列表变成控制点。三种写法：地点键名、[经度, 纬度]、{"river": "长江"}（沿河走到下一个点）"""
    via = route.get('via') if isinstance(route, dict) else route
    if not via or len(via) < 2: raise StoryError(f'routes.json 的 {rid}：via 至少要两个点')
    pts, keys, segs = [], [], []
    def pt(x):
        if isinstance(x, str):
            k = x.split('@')[0]
            if k not in nodes:
                import difflib
                sug = difflib.get_close_matches(k, list(nodes), n=3)
                raise StoryError(f'routes.json 的 {rid} 用到地点 "{k}"，places.json 里没有' + (f'（是不是 {"、".join(sug)}？）' if sug else ''))
            return list(nodes[k]), k
        if isinstance(x, list) and len(x) == 2: return [float(x[0]), float(x[1])], None
        return None, None
    i = 0
    while i < len(via):
        x = via[i]
        if isinstance(x, dict) and x.get('river'):
            if not pts or i + 1 >= len(via): raise StoryError(f'routes.json 的 {rid}：{{"river": …}} 前后都要有点')
            nxt, nk = pt(via[i + 1])
            line, meta = follow_river(x['river'], pts[-1], nxt, x.get('rdp', 0.004))
            if meta['off_a'] > 15 or meta['off_b'] > 15:
                warn('RIVER_FAR', f'routes.{rid}', f'沿 {x["river"]} 走时，起点离河 {meta["off_a"]} 公里、终点离河 {meta["off_b"]} 公里',
                     '离河太远会画出一段横穿陆地的直线；换一个离河更近的经停点，或检查坐标')
            inner = line[1:-1] if len(line) > 2 else []
            if meta['off_a'] > 0.5: inner = [line[0]] + inner
            if meta['off_b'] > 0.5: inner = inner + [line[-1]]
            for c in inner: pts.append(list(c)); keys.append(None)
            segs.append({'river': x['river'], 'km': meta['river_km']})
            i += 1; continue
        p, k = pt(x)
        if p is None: raise StoryError(f'routes.json 的 {rid}：看不懂 via 里的 {json.dumps(x, ensure_ascii=False)}')
        pts.append(p); keys.append(k); i += 1
    return pts, keys, segs


def build_route(rid, route, nodes, warn):
    pts, keys, segs = via_points(rid, route, nodes, warn)
    opt = route if isinstance(route, dict) else {}
    if opt.get('smooth', True) and len(pts) > 2: dense = catmull(pts, 0.8)
    else: dense = densify(pts, 0.8)
    step = opt.get('step') or (2.0 if hav(pts[0], pts[-1]) > 60 else 0.6)
    res, cum = resample(dense, step)
    els = [int(round(elev(p[0], p[1]))) for p in res]
    nds = []
    for p, k in zip(pts, keys):
        if not k: continue
        i = min(range(len(res)), key=lambda j: (res[j][0] - p[0]) ** 2 + (res[j][1] - p[1]) ** 2)
        nds.append([k, round(cum[i], 1)])
    out = {'c': [r4(p) for p in res], 'd': [round(x, 1) for x in cum], 'e': els, 'len': round(cum[-1], 1), 'nodes': nds}
    # 每两个控制点之间：最高处比两头高多少米（翻山检查用）
    ci, prev = [], 0
    for p in pts:
        j = min(range(prev, len(res)), key=lambda j: (res[j][0] - p[0]) ** 2 + (res[j][1] - p[1]) ** 2)
        ci.append(j); prev = j
    climb = []
    for a in range(len(pts) - 1):
        ia, ib = ci[a], ci[a + 1]
        if ib <= ia: continue
        seg = els[ia:ib + 1]; top = max(seg)
        climb.append([a, round(cum[ib] - cum[ia], 1), top - max(els[ia], els[ib]), r4(res[ia + seg.index(top)])])
    meta = {'ctrl': [r4(p) for p in pts], 'keys': keys, 'rivers': segs, 'len': out['len'], 'maxE': max(els) if els else 0, 'minE': min(els) if els else 0,
            'climb': climb}
    return out, meta


def input_hash(story):
    h = hashlib.sha1(VERSION.encode())
    for k in ('geo', 'places', 'routes'):
        h.update(json.dumps(story[k], sort_keys=True, ensure_ascii=False).encode())
    for t in (story['geo'].get('terr') or {}).values():
        p = story['proj'] / t['file']
        if p.exists(): h.update(str(p.stat().st_size).encode()); h.update(str(int(p.stat().st_mtime)).encode())
    return h.hexdigest()


def build(proj, force=False, quiet=False):
    story = load_story(proj)
    out = story['proj'] / 'dist' / 'data' / 'geo.js'
    meta_p = story['proj'] / 'dist' / 'data' / 'geo-meta.json'
    hp = story['proj'] / 'dist' / 'data' / '.geo-hash'
    hsh = input_hash(story)
    if not force and out.exists() and meta_p.exists() and hp.exists() and hp.read_text() == hsh:
        if not quiet: print('· 地理数据没有变化，沿用上次的 geo.js')
        return json.loads(meta_p.read_text(encoding='utf-8'))
    warns = []
    def warn(code, where, msg, fix=''): warns.append({'level': 'WARN', 'code': code, 'where': where, 'msg': msg, 'fix': fix})
    cfg = story['geo'] or {}
    nodes_ll = [p['ll'] for p in story['places'].values() if isinstance(p, dict) and p.get('ll')]
    if cfg.get('bbox'): BB = cfg['bbox']
    elif nodes_ll:
        xs = [p[0] for p in nodes_ll]; ys = [p[1] for p in nodes_ll]
        BB = [min(xs) - 4, min(ys) - 3, max(xs) + 4, max(ys) + 3]
    else: BB = [73, 18, 135, 54]
    print(f'· 地理范围 {BB}')

    # 河流
    rc = cfg.get('rivers') or {}
    names = rc.get('ne') or {}
    rivers = []
    if names == 'auto' or rc.get('auto'):
        maxr = rc.get('maxScalerank', 6)
        for f in ne('rivers'):
            p = f['properties']
            if (p.get('scalerank') or 99) > maxr or not (p.get('name_zh') or p.get('name')): continue
            for ln in lines_of(f.get('geometry')):
                if not in_bb(ln, BB): continue
                s = rdp(ln, rc.get('rdp', 0.006))
                rivers.append({'type': 'Feature', 'properties': {'n': p.get('name_zh') or p.get('name'), 'r': int(p.get('scalerank') or 9)},
                               'geometry': {'type': 'LineString', 'coordinates': [r4(c) for c in s]}})
    else:
        for f in ne('rivers'):
            p = f['properties']
            hit = [names[n] for n in river_names(p) if n in names]
            if not hit: continue
            for ln in lines_of(f.get('geometry')):
                if not in_bb(ln, BB): continue
                s = rdp(ln, rc.get('rdp', 0.006))
                rivers.append({'type': 'Feature', 'properties': {'n': hit[0], 'r': int(p.get('scalerank') or 9)},
                               'geometry': {'type': 'LineString', 'coordinates': [r4(c) for c in s]}})
    for h in rc.get('hand') or []:
        pts = [list(c) for c in h['c']]
        j = h.get('join')
        if j:
            cs = [c for f in rivers if f['properties']['n'] == j['river'] for c in f['geometry']['coordinates']]
            if cs: pts.append(min(cs, key=lambda c: hav(c, j['near'])))
        s = rdp(catmull(pts, 3.0), 0.004)
        rivers.append({'type': 'Feature', 'properties': {'n': h['n'], 'r': h.get('r', 6), 'h': 1},
                       'geometry': {'type': 'LineString', 'coordinates': [r4(c) for c in s]}})

    # 湖泊
    lc = cfg.get('lakes') or {}
    lakes = []
    if lc is not False:
        rename = lc.get('names') or {}
        for f in ne('lakes'):
            p = f['properties']
            for poly in polys_of(f.get('geometry')):
                if not in_bb(poly[0], BB): continue
                if (p.get('scalerank') or 99) > lc.get('maxScalerank', 9): continue
                ring = rdp(poly[0], lc.get('rdp', 0.005))
                if len(ring) < 4: continue
                n = p.get('name_zh') or ''
                n = rename.get(n, rename.get(p.get('name') or '', n))
                lakes.append({'type': 'Feature', 'properties': {'n': n}, 'geometry': {'type': 'Polygon', 'coordinates': [[r4(c) for c in ring]]}})

    def ell(e):
        return {'type': 'Feature', 'properties': {'n': e['n']}, 'geometry': {'type': 'Polygon', 'coordinates': [
            ellipse(e['c'][0], e['c'][1], e['rx'], e['ry'], e.get('rot', 0), wobble=e.get('wobble', 0.12), seed=e.get('seed', 1))]}}
    ancient = [ell(e) for e in cfg.get('ancient') or []]

    # 沙漠
    dc = cfg.get('deserts') or {}
    deserts = []
    dn = dc.get('ne') or {}
    if dn:
        for f in ne('regions'):
            p = f['properties']
            if p.get('NAME') in dn:
                for poly in polys_of(f.get('geometry')):
                    ring = rdp(poly[0], dc.get('rdp', 0.03))
                    deserts.append({'type': 'Feature', 'properties': {'n': dn[p['NAME']]}, 'geometry': {'type': 'Polygon', 'coordinates': [[r4(c) for c in ring]]}})
    deserts += [ell(e) for e in dc.get('ellipses') or []]

    # 疆域
    terr = {}
    for key, t in (cfg.get('terr') or {}).items():
        p = story['proj'] / t['file']
        if not p.exists(): raise StoryError(f'geo.json 的 terr.{key} 指向 {p}，文件不存在')
        src = json.load(open(p, encoding='utf-8'))
        prop, mp, fs = t.get('prop', 'NAME'), t.get('map') or {}, []
        for f in src['features']:
            v = (f.get('properties') or {}).get(prop)
            if v not in mp: continue
            m = mp[v]; side, n = (m, v) if isinstance(m, str) else (m.get('side'), m.get('n', v))
            mpoly = []
            for poly in polys_of(f.get('geometry')):
                rings = [[r4(c) for c in rdp(r, t.get('rdp', 0.03))] for r in poly]
                rings = [r for r in rings if len(r) >= 4]
                if rings: mpoly.append(rings)
            if mpoly: fs.append({'type': 'Feature', 'properties': {'n': n, 'side': side}, 'geometry': {'type': 'MultiPolygon', 'coordinates': mpoly}})
        if not fs: warn('TERR_EMPTY', f'geo.terr.{key}', f'{t["file"]} 里没有 {prop} 等于 {list(mp)} 的要素', f'先运行 python3 geo.py inspect {t["file"]} {prop} 看真实取值')
        terr[key] = fc(fs)

    walls = fc([{'type': 'Feature', 'properties': {'n': w['n'], 'k': w.get('k', 'wall')},
                 'geometry': {'type': 'LineString', 'coordinates': [r4(c) for c in rdp(catmull(w['c'], 4.0), 0.004)]}} for w in cfg.get('walls') or []])

    peaks = {k: peak(b) for k, b in (cfg.get('peaks') or {}).items()}
    if peaks: print('· 山峰', peaks)
    nodes = resolve_places(story['places'], peaks, fc(rivers), fc(lakes), warn)

    routes, rmeta = {}, {}
    for rid, r in story['routes'].items():
        if rid.startswith('_'): continue
        routes[rid], rmeta[rid] = build_route(rid, r, nodes, warn)
        if not quiet: print(f'  路线 {rid:16s} {routes[rid]["len"]:8.1f} 公里  {len(routes[rid]["c"]):5d} 点  海拔 {rmeta[rid]["minE"]}–{rmeta[rid]["maxE"]} 米')
    node_elev = {k: int(round(elev(v[0], v[1]))) for k, v in nodes.items()}
    if NET_FAIL['n']:
        warn('NO_DEM', 'geo', f'{NET_FAIL["n"]} 块高程瓦片下载失败，这些地方海拔按 0 算', '联网后加 --force 重跑：python3 geo.py build 项目目录 --force')

    geo = {'rivers': fc(rivers), 'lakes': fc(lakes), 'ancient': fc(ancient), 'deserts': fc(deserts), 'terr': terr, 'walls': walls,
           'nodes': nodes, 'nodeElev': node_elev, 'peaks': peaks, 'routes': routes}
    out.parent.mkdir(parents=True, exist_ok=True)
    js = 'window.GEO=' + json.dumps(geo, ensure_ascii=False, separators=(',', ':')) + ';\n'
    out.write_text(js, encoding='utf-8')
    meta = {'bbox': BB, 'nodes': nodes, 'routes': rmeta, 'peaks': peaks, 'warns': warns,
            'counts': {'rivers': len(rivers), 'lakes': len(lakes), 'terr': {k: len(v['features']) for k, v in terr.items()}}}
    meta_p.write_text(json.dumps(meta, ensure_ascii=False), encoding='utf-8')
    hp.write_text(hsh)
    print(f'· 写出 {out}（{len(js) // 1024} KB）：河 {len(rivers)} 段、湖 {len(lakes)} 个、路线 {len(routes)} 条、地点 {len(nodes)} 个')
    return meta


# ------------------------------------------------------------------ 查询命令
def parse_bb(s):
    v = [float(x) for x in s.replace('，', ',').split(',')]
    if len(v) != 4: die('范围写成 西,南,东,北，例如 104,28,122,36')
    return v


def cmd_rivers(bb):
    seen = {}
    for f in ne('rivers'):
        p = f['properties']
        for ln in lines_of(f.get('geometry')):
            if in_bb(ln, bb):
                k = (p.get('name') or '', p.get('name_zh') or '')
                L = sum(hav(a, b) for a, b in zip(ln, ln[1:]))
                s = seen.setdefault(k, [p.get('scalerank'), 0.0]); s[1] += L
    print(f'{"英文名 name":24s} {"中文名 name_zh":14s} 等级  范围内长度')
    for (n, z), (r, L) in sorted(seen.items(), key=lambda x: (x[1][0] or 99, -x[1][1])):
        print(f'{n:24s} {z:14s} {r!s:4s}  {L:7.0f} 公里')
    print('\n在 story/geo.json 的 rivers.ne 里写 {"英文名或中文名": "图上显示的名字"}；路线沿河走写 {"river": "中文名"}')


def cmd_lakes(bb):
    for f in ne('lakes'):
        p = f['properties']
        for poly in polys_of(f.get('geometry')):
            if in_bb(poly[0], bb):
                print(f'{p.get("name") or "":24s} {p.get("name_zh") or "":12s} 等级 {p.get("scalerank")}')
                break


def cmd_near(lon, lat):
    e = elev(lon, lat)
    print(f'({lon}, {lat}) 海拔约 {e:.0f} 米')
    best = {}
    for f in ne('rivers'):
        p = f['properties']
        for ln in lines_of(f.get('geometry')):
            for c in ln[::2]:
                d = hav(c, (lon, lat))
                k = p.get('name_zh') or p.get('name')
                if d < best.get(k, (1e9,))[0]: best[k] = (d, c)
    for k, (d, c) in sorted(best.items(), key=lambda x: x[1][0])[:6]:
        print(f'  离 {k} 约 {d:.1f} 公里（河上最近点 {r4(c)}）')


def cmd_inspect(path, prop=None):
    d = json.load(open(path, encoding='utf-8'))
    fs = d.get('features', [])
    print(f'{path}：{len(fs)} 个要素')
    keys = {}
    for f in fs:
        for k, v in (f.get('properties') or {}).items(): keys.setdefault(k, {}).setdefault(str(v), 0); keys[k][str(v)] += 1
    for k, vals in keys.items():
        if prop and k != prop: continue
        items = sorted(vals.items(), key=lambda x: -x[1])
        lim = 400 if prop else 12
        print(f'\n属性 {k}（{len(vals)} 种取值）：')
        print('  ' + '；'.join(f'{v}×{c}' if c > 1 else v for v, c in items[:lim]) + (' ……' if len(items) > lim else ''))


def main(argv):
    if len(argv) < 2 or argv[1] in ('-h', '--help'):
        print(__doc__); return
    c = argv[1]
    try:
        if c == 'build':
            m = build(argv[2], force='--force' in argv)
            for w in m.get('warns', []): print(f"▲ [{w['code']}] {w['where']}：{w['msg']}\n    怎么改：{w['fix']}")
        elif c == 'rivers': cmd_rivers(parse_bb(argv[2]))
        elif c == 'lakes': cmd_lakes(parse_bb(argv[2]))
        elif c == 'near': cmd_near(float(argv[2]), float(argv[3]))
        elif c == 'inspect': cmd_inspect(argv[2], argv[3] if len(argv) > 3 else None)
        elif c == 'route':
            st = load_story(argv[2]); rid = argv[3]
            nodes = resolve_places(st['places'], {}, fc([]), fc([]), lambda *a: print('▲', a))
            r, m = build_route(rid, st['routes'][rid], nodes, lambda *a: print('▲', a))
            print(f'{rid}：{r["len"]} 公里，海拔 {m["minE"]}–{m["maxE"]} 米')
            for k, km in r['nodes']: print(f'  {km:8.1f} 公里  {k}')
            for s in m['rivers']: print(f'  沿 {s["river"]} {s["km"]} 公里')
        else: print(__doc__)
    except StoryError as e:
        die(str(e))


if __name__ == '__main__':
    main(sys.argv)
