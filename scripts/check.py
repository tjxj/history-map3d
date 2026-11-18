# -*- coding: utf-8 -*-
"""三维考据地图 · 故事检查

  python3 check.py <项目目录>              全面检查（build.py 每次都会先跑它）
  python3 check.py <项目目录> --stage 1    阶段验收：1 资料  2 大纲  3 地理（还没写章节）  4 起同全面检查

报告同时写到 <项目>/qa/check.json。
  ✖ 错误：网页会坏，或者会显示错的内容。必须改完，build.py 才会生成网页
  ▲ 警告：会难看、可能写错、缺出处。也要改到 0
  · 提示：建议，可以不改
每一条都带「怎么改」。照着改，再跑一次。
"""
import difflib, re, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (ATMOS, BASE_COLORS, CHAPTER_KEYS, FX_KEYS, FX_KINDS, LABEL_TYPES, SCENE_KEYS, SCENE_KINDS, SFX, SHAPES,  # noqa: E402
                    SIDE_KINDS, STOP_KEYS, TOUR_KEYS, TRACK_KEYS, UNIT_KEYS, WEATHER, Report, StoryError, die, hav, load_json,
                    load_story, save_json)

# ------------------------------------------------------------------ 字数上限（按版面量出来的；汉字算 1，字母数字算 0.55）
LIM = {
    'ch.num': 2, 'ch.title': 6, 'ch.sub': 24, 'ch.lead': 70, 'ch.rank': 16, 'ch.era': 12, 'ch.year': 14, 'ch.age': 6,
    'kpi.l': 12, 'kpi.s': 14, 'kpi.u': 2, 'story': 140, 'tl.t': 6, 'tl.h': 14, 'tl.d': 36, 'src.t': 140, 'src.s': 18,
    'var.k': 6, 'var.a': 32, 'var.h': 60, 'deb.t': 16, 'deb.q': 110, 'opt.n': 16, 'opt.d': 40, 'opt.tag': 8,
    'ppl.n': 18, 'ppl.r': 18, 'ppl.d': 40, 'cap': 30, 'who': 16, 'tour.h': 16, 'tour.d': 70, 'toast': 44,
    'sc.title': 12, 'sc.kicker': 14, 'sc.line': 34, 'sc.quote': 40, 'sc.qs': 20, 'st.l': 12, 'st.t': 10, 'banner': 12,
    'fxlabel': 14, 'unitlabel': 8, 'label': 8, 'label.s': 14, 'place.n': 10, 'place.d': 20,
    'poem.t': 14, 'poem.a': 8, 'poem.line': 16, 'poem.lines': 12, 'relic.t': 12, 'relic.d': 60,
}
HYPE = ['夯', '王炸', '吊打', '封神', '颠覆', '炸裂', '神器', '天花板', '爆火', '完全', '一分钱不花', '史诗级', '震撼', '史上最']
PLACEHOLDER = re.compile(r'TODO|todo|待补|待定|待查|XXX|xxx|占位|lorem|示例文字|这里写')
NOT_BUT = re.compile(r'不是[^，。；！？\n]{0,24}而是')
KEY_RE = re.compile(r'^[A-Za-z][A-Za-z0-9_]*$')
REF_RE = re.compile(r'\{(km|li):([\w@]+)(?:>([\w@]+))?\}')
HEX_RE = re.compile(r'^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$')
SITE_KEYS = {'title', 'subtitle', 'span', 'motto', 'mottoSrc', 'credits', 'hero', 'factions', 'words', 'sideNames', 'sideColors',
             'kindNames', 'overview', 'introStats', 'li', 'legend', 'variants', 'terrDefault', 'terrAll', 'pulseSide', 'globe',
             'cues', 'seal', 'kicker', 'pageTitle', 'description', 'layers', 'about', 'relics', 'sides', 'peopleGroups',
             'mainTags', 'overviewChapter'}
WORD_KEYS = {'go', 'story', 'tour', 'rank', 'dash', 'tabReport', 'tabSources', 'tabDebates', 'tabPeople'}
OVW_KEYS = {'num', 'title', 'sub', 'span', 'lead', 'list', 'col', 'btn'}


def wlen(s):
    n = 0.0
    for c in str(s):
        o = ord(c)
        n += 1.0 if (o >= 0x2E80 or 0xFF00 <= o <= 0xFFEF or c in '“”‘’…—') else 0.55
    return round(n, 1)


def sug(x, pool):
    m = difflib.get_close_matches(str(x), [str(p) for p in pool], n=3, cutoff=0.5)
    return f'（是不是 {"、".join(m)}？）' if m else ''


def walk(o, path=''):
    if isinstance(o, str): yield path, o
    elif isinstance(o, dict):
        for k, v in o.items():
            if str(k).startswith('_'): continue
            yield from walk(v, f'{path}.{k}' if path else str(k))
    elif isinstance(o, list):
        for i, v in enumerate(o): yield from walk(v, f'{path}[{i}]')


def is_ll(v):
    return isinstance(v, list) and len(v) == 2 and all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in v)


def is_num(v): return isinstance(v, (int, float)) and not isinstance(v, bool)


class Checker:
    def __init__(self, story, rep):
        self.st, self.r = story, rep
        self.places = {k: v for k, v in story['places'].items() if not k.startswith('_')}
        self.routes = {k: v for k, v in story['routes'].items() if not k.startswith('_')}
        self.site = story['site']
        self.geo = story['geo'] or {}
        self.peaks = set((self.geo.get('peaks') or {}).keys())
        self.terrs = set((self.geo.get('terr') or {}).keys())
        fk = [f.get('k') for f in (self.site.get('factions') or []) if isinstance(f, dict)]
        self.sides = set(BASE_COLORS) | set((self.site.get('sides') or {}).keys()) | {k for k in fk if k}
        self.relics = set((self.site.get('relics') or {}).keys())
        self.used_routes = set()

    # ---------------------------------------------------------- 小工具
    def e(self, code, w, msg, fix=''): self.r.err(code, w, msg, fix)
    def w(self, code, w, msg, fix=''): self.r.warn(code, w, msg, fix)
    def i(self, code, w, msg, fix=''): self.r.info(code, w, msg, fix)

    def unknown(self, obj, allowed, where, what):
        if not isinstance(obj, dict): return
        for k in obj:
            if k.startswith('_') or k in allowed: continue
            self.w('UNKNOWN_KEY', where, f'{what}里有引擎不认识的字段 "{k}"{sug(k, allowed)}，它会被忽略',
                   f'改成正确的字段名，或删掉。{what}能写的字段：{"、".join(sorted(allowed))}')

    def text(self, where, s, lim_key, label):
        if s is None: return
        if not isinstance(s, str):
            if is_num(s): return
            self.e('BAD_TYPE', where, f'{label}应该是一段文字，现在是 {type(s).__name__}', '写成 "……" 字符串')
            return
        lim = LIM[lim_key]; n = wlen(s)
        if n > lim:
            self.w('LONG_TEXT', where, f'{label}「{s[:24]}{"…" if len(s) > 24 else ""}」约 {n:g} 字，版面上限 {lim} 字，会被截断或挤出框',
                   f'压到 {lim} 字以内：删修饰语，只留一个事实；放不下的内容挪到本章 story 段落里')

    def ref_ok(self, x):
        """地点引用：places 键名（可带 @n）、geo.peaks 键名、[经度, 纬度]"""
        if is_ll(x): return True
        if isinstance(x, str):
            k = x.split('@')[0]
            return k in self.places or k in self.peaks
        return False

    def bad_ref(self, where, x, label):
        k = str(x).split('@')[0] if isinstance(x, str) else x
        self.e('UNKNOWN_PLACE', where, f'{label}写的地点 {x!r} 在 places.json 里没有{sug(k, list(self.places) + list(self.peaks))}',
               '在 places.json 里加上这个地点（键名 + n 名称 + ll 坐标），或改成已有的键名，或直接写 [经度, 纬度]')

    def color(self, where, c, label):
        if not isinstance(c, str) or not HEX_RE.match(c):
            self.e('BAD_COLOR', where, f'{label} 写成了 {c!r}', '写成 # 开头的十六进制颜色，例如 "#c8321e"')

    def side_ok(self, where, s, label='side'):
        if s not in self.sides:
            self.e('UNKNOWN_SIDE', where, f'{label} 写了 {s!r}，没有这个颜色{sug(s, self.sides)}',
                   f'能用的：{"、".join(sorted(self.sides))}。想加新颜色，在 site.json 的 sides 里写 {{"{s}": "#rrggbb"}}，或在 factions 里加一个势力')

    def times(self, where, obj, dur, keys=('t0', 't1')):
        vals = [obj.get(k) for k in keys if is_num(obj.get(k))]
        for k in keys:
            v = obj.get(k)
            if v is not None and not is_num(v): self.e('BAD_TYPE', where, f'{k} 应该是秒数，现在是 {v!r}', '写成数字，例如 4.5')
        if dur and any(v > dur + 0.01 for v in vals):
            self.w('AFTER_END', where, f'时间 {", ".join(f"{k}={obj.get(k)}" for k in keys if obj.get(k) is not None)} 超过了场景时长 dur={dur}，这部分不会演出来',
                   f'把时间改到 {dur} 秒以内，或把场景 dur 加大')
        if len(vals) == 2 and vals[0] > vals[1]:
            self.e('TIME_ORDER', where, f'{keys[0]}={vals[0]} 比 {keys[1]}={vals[1]} 还晚', f'{keys[0]} 是开始秒数，{keys[1]} 是结束秒数，开始要早于结束')

    def offset(self, where, v, label):
        if v is None: return
        if not is_ll(v):
            self.e('BAD_TYPE', where, f'{label} 应该是 [东西公里, 南北公里]，现在是 {v!r}', '写成两个数字，例如 [-20, 6]：相对场景中心，向东 / 向北为正')
        elif max(abs(v[0]), abs(v[1])) > 260:
            self.w('FAR_OFFSET', where, f'{label} {v} 离场景中心超过 260 公里，镜头里看不见', '演出坐标是相对场景 at 的公里数，一般在 ±60 以内')

    # ---------------------------------------------------------- site.json
    def site_json(self):
        s, W = self.site, 'site.json'
        self.unknown(s, SITE_KEYS, W, 'site.json ')
        t = s.get('title') or ''
        if not (2 <= len(t) <= 8): self.e('TITLE_LEN', f'{W} · title', f'大标题「{t}」{len(t)} 个字；开场大字只放得下 2–8 个字', '换一个 2–8 字的标题，长的说法放进 subtitle')
        seal = s.get('seal') or ''
        if not (1 <= len(seal) <= 2): self.e('SEAL_LEN', f'{W} · seal', f'印章「{seal}」要 1–2 个字', '写人物的字、号或封号里的 1–2 个字，例如 "太白"')
        hero = s.get('hero') or {}
        if not hero.get('name'): self.w('NO_HERO', f'{W} · hero', '没写 hero.name（地图上行进标记显示的名字）', '写 "hero": {"name": "李白", "flag": "李", "legend": "李白行迹"}')
        if hero.get('flag') and len(hero['flag']) != 1: self.e('FLAG_LEN', f'{W} · hero.flag', f'旗号「{hero["flag"]}」只能 1 个字', '写姓或名里的一个字')
        for k in ('title', 'subtitle', 'pageTitle', 'description', 'kicker', 'span'):
            if not s.get(k): self.w('MISSING', f'{W} · {k}', f'没写 {k}', '照 examples/huoqubing/story/site.json 补上')
        for i, f in enumerate(s.get('factions') or []):
            w = f'{W} · factions[{i}]'
            if not isinstance(f, dict) or not f.get('k') or not f.get('n'):
                self.e('BAD_FACTION', w, '势力要写 {"k": 英文键, "n": 名称, "c": 颜色}', '照范例的 factions 写'); continue
            if not KEY_RE.match(str(f['k'])): self.e('BAD_KEY', w, f'势力键 {f["k"]!r} 只能用英文字母、数字、下划线', '例如 "tang"')
            for ck in ('c', 'glow'):
                if f.get(ck): self.color(w, f[ck], ck)
        for k, v in (s.get('sides') or {}).items(): self.color(f'{W} · sides.{k}', v.get('c') if isinstance(v, dict) else v, k)
        self.unknown(s.get('words') or {}, WORD_KEYS, f'{W} · words', 'words ')
        self.unknown(s.get('overview') or {}, OVW_KEYS, f'{W} · overview', 'overview ')
        li = s.get('li')
        if li is not None and not (isinstance(li, dict) and li.get('name') and is_num(li.get('km')) and li['km'] > 0):
            self.e('BAD_LI', f'{W} · li', f'li 写成了 {li!r}', '写 {"name": "唐里", "km": 0.54}，km 是一里合多少公里；不想显示古里就删掉 li')
        for i, x in enumerate(s.get('introStats') or []):
            if not isinstance(x, dict) or not (is_num(x.get('v')) or x.get('v') == 'km'):
                self.e('BAD_STAT', f'{W} · introStats[{i}]', f'开场数字写成了 {x!r}', 'v 写数字，或写 "km"（自动算全部路线公里）')
        if len(s.get('introStats') or []) > 5: self.w('TOO_MANY', f'{W} · introStats', '开场数字超过 5 个，手机上排不下', '留最重要的 3–5 个')
        for k, v in (s.get('cues') or {}).items():
            for j, x in enumerate(v or []): self.sfx(f'{W} · cues.{k}[{j}]', x, None)
        for k, v in (s.get('relics') or {}).items():
            w = f'{W} · relics.{k}'
            if not isinstance(v, dict) or not v.get('t'): self.e('BAD_RELIC', w, '文物要写 {"t": 名称, "d": 一句说明}', '照范例写'); continue
            self.text(w + '.t', v.get('t'), 'relic.t', '文物名'); self.text(w + '.d', v.get('d'), 'relic.d', '文物说明')
        for k in ('terrDefault', 'terrAll'):
            if s.get(k) and s[k] not in self.terrs:
                self.e('UNKNOWN_TERR', f'{W} · {k}', f'疆域 {s[k]!r} 在 geo.json 的 terr 里没有{sug(s[k], self.terrs)}', '写 geo.json terr 里的键名；没有疆域图就删掉这一项')
        if s.get('pulseSide'): self.side_ok(f'{W} · pulseSide', s['pulseSide'], 'pulseSide')
        g = s.get('globe')
        if g is not None and not (isinstance(g, dict) and is_ll(g.get('c'))): self.e('BAD_GLOBE', f'{W} · globe', 'globe 要写 {"c": [经度, 纬度], "z": 1.7}', '不确定就删掉，引擎会自动取全部路线的中心')
        for i, a in enumerate(s.get('about') or []):
            if not isinstance(a, dict) or not a.get('h') or not a.get('p'): self.e('BAD_ABOUT', f'{W} · about[{i}]', '「关于本图」每段写 {"h": 小标题, "p": 正文}', '照范例写')
        if not s.get('about'): self.w('MISSING', f'{W} · about', '没写「关于本图」（史料依据、路线怎么定的、演出是示意）', '照范例的 about 写三段：史料、路线、演出')
        for path, txt in walk(s):
            for m in REF_RE.finditer(txt):
                if m.group(2) != 'all': self.e('BAD_REF', f'{W} · {path}', f'site.json 里只能用 {{km:all}}，{m.group(0)} 会显示成「若干」', '改成 {km:all}，或写死数字')

    # ---------------------------------------------------------- places / routes / labels
    def places_json(self):
        bb = self.geo.get('bbox')
        for k, p in self.places.items():
            w = f'places.json · {k}'
            if not KEY_RE.match(k): self.e('BAD_KEY', w, f'地点键名 {k!r} 只能用英文字母开头，后面跟字母、数字、下划线', '用拼音，例如 "jiangling"、"e2_baidi"')
            if not isinstance(p, dict): self.e('BAD_TYPE', w, '每个地点写成 {"n": 名称, "d": 说明, "ll": [经度, 纬度]}', '照范例写'); continue
            self.unknown(p, {'n', 'd', 'll', 'peak', 'snap', 'src', 'conf', 'now'}, w, '地点')
            if 'n' in p: self.text(w + '.n', p['n'], 'place.n', '地名')
            if 'd' in p: self.text(w + '.d', p['d'], 'place.d', '地点说明')
            if not (p.get('ll') or p.get('peak') or p.get('snap')): self.e('NO_COORD', w, '没有坐标', '写 "ll": [经度, 纬度]（东经为正、北纬为正，经度在前）'); continue
            ll = p.get('ll')
            if ll is not None:
                if not is_ll(ll): self.e('BAD_COORD', w, f'll 写成了 {ll!r}', '写成 [经度, 纬度] 两个数字'); continue
                lon, lat = ll
                if abs(lat) > 90 or abs(lon) > 180: self.e('BAD_COORD', w, f'坐标 {ll} 超出地球范围', '经度在前、纬度在后：[经度, 纬度]')
                elif 15 <= lon <= 56 and 70 <= lat <= 140:
                    self.e('LATLON_SWAP', w, f'坐标 {ll} 像是把经纬度写反了', f'改成 [{lat}, {lon}]：经度在前、纬度在后')
                elif bb and not (bb[0] <= lon <= bb[2] and bb[1] <= lat <= bb[3]):
                    self.w('OFF_MAP', w, f'坐标 {ll} 在 geo.json 的 bbox {bb} 外面，这里不会画河流和地名', '核对坐标；没错的话把 bbox 放大')
            if p.get('ll') and isinstance(p.get('ll'), list) and len(p['ll']) == 2:
                if all(is_num(d) and abs(d - round(d)) < 1e-9 for d in p['ll']): self.i('ROUND_COORD', w, f'坐标 {p["ll"]} 是整数度，误差可能有几十公里', '查到小数点后两位（约 1 公里）')

    def routes_json(self):
        for rid, r in self.routes.items():
            w = f'routes.json · {rid}'
            if not KEY_RE.match(rid): self.e('BAD_KEY', w, f'路线 id {rid!r} 只能用英文字母开头，后面跟字母、数字、下划线', '例如 "e2_chu_shu"')
            via = r.get('via') if isinstance(r, dict) else r
            if isinstance(r, dict): self.unknown(r, {'via', 'step', 'smooth', 'jumpOk', 'note'}, w, '路线')
            if not isinstance(via, list) or len(via) < 2: self.e('BAD_ROUTE', w, 'via 至少要两个点', '写 "via": ["起点键名", "经停点", ..., "终点键名"]'); continue
            for j, x in enumerate(via):
                if isinstance(x, str):
                    if x.split('@')[0] not in self.places: self.bad_ref(f'{w}.via[{j}]', x, '路线经停点')
                elif isinstance(x, dict):
                    if not x.get('river'): self.e('BAD_VIA', f'{w}.via[{j}]', f'看不懂 {x!r}', '沿河走写 {"river": "长江"}，前后各写一个地点')
                    elif j == 0 or j == len(via) - 1: self.e('BAD_VIA', f'{w}.via[{j}]', '{"river": …} 不能放在第一个或最后一个', '前后都要有一个地点')
                elif not is_ll(x): self.e('BAD_VIA', f'{w}.via[{j}]', f'看不懂 {x!r}', 'via 里每一项写地点键名、[经度, 纬度]，或 {"river": "河名"}')

    def labels_json(self):
        bb = self.geo.get('bbox')
        for j, l in enumerate(self.st['labels']):
            if isinstance(l, dict) and l.get('_'): continue
            w = f'labels.json[{j}]'
            if isinstance(l, list):
                if len(l) < 5: self.e('BAD_LABEL', w, f'{l!r} 少了字段', '写 {"t": 类型, "n": 文字, "ll": [经度, 纬度], "z": 最小缩放}'); continue
                t, n, ll, z = l[0], l[1], [l[2], l[3]], l[4]; opt = l[5] if len(l) > 5 else {}
            elif isinstance(l, dict):
                self.unknown(l, {'t', 'n', 'll', 'z', 's', 'big', 'cap', 'peak', 'chap', 'node'}, w, '地名注记')
                t, n, ll, z, opt = l.get('t'), l.get('n'), l.get('ll'), l.get('z', 5), l
            else: self.e('BAD_LABEL', w, f'看不懂 {l!r}', '照范例写'); continue
            if t not in LABEL_TYPES: self.e('UNKNOWN_LABEL_TYPE', w, f'注记类型 {t!r} 不认识{sug(t, LABEL_TYPES)}', '能用的：' + '、'.join(f'{k}（{v}）' for k, v in LABEL_TYPES.items()))
            self.text(w + '.n', n, 'label', '注记文字')
            if isinstance(opt, dict) and opt.get('s'): self.text(w + '.s', opt['s'], 'label.s', '注记副标题')
            if isinstance(opt, dict) and opt.get('node') and opt['node'] not in self.places: self.bad_ref(w + '.node', opt['node'], '注记的 node（航点出现时隐藏这条注记）')
            if not is_ll(ll): self.e('BAD_COORD', w, f'坐标写成了 {ll!r}', '写 "ll": [经度, 纬度]')
            elif bb and not (bb[0] <= ll[0] <= bb[2] and bb[1] <= ll[1] <= bb[3]): self.w('OFF_MAP', w, f'注记「{n}」{ll} 在 bbox 外面', '核对坐标')
            if not is_num(z): self.e('BAD_TYPE', w, f'z（最小缩放）写成了 {z!r}', '写 3–9 的数字：越小越早出现。大区域 3–4，城市 6–7')

    # ---------------------------------------------------------- 章节
    def chapters(self):
        chs = self.st['chapters']
        if not chs: self.e('NO_CHAPTER', 'story/chapters', '一章都没有', '照范例在 story/chapters/ 下写 01-prologue.json、02-xxx.json ……'); return
        ids, last_y = {}, None
        for f, c in chs:
            w = f'chapters/{f.name}'
            if not isinstance(c, dict): self.e('BAD_TYPE', w, '一章是一个 {…} 对象', '照范例写'); continue
            cid = c.get('id')
            if not cid or not KEY_RE.match(str(cid)): self.e('BAD_KEY', w, f'章节 id {cid!r} 要用英文字母开头的英文键', '例如 "e3"、"shu"')
            elif cid in ids: self.e('DUP_ID', w, f'章节 id {cid!r} 和 {ids[cid]} 重复', '每章 id 不同')
            else: ids[cid] = f.name
            if not re.match(r'^\d{2}-', f.name): self.w('FILE_NAME', w, '章节文件名要以两位数字开头，例如 03-shu.json；网页按文件名排序', '改文件名')
            y = c.get('y')
            if is_num(y):
                if last_y is not None and y < last_y: self.w('YEAR_ORDER', w, f'这一章 y={y} 比上一章 y={last_y} 早，章节顺序可能排错了', '章节按文件名前缀排序。调整文件名前的数字，或核对 y（公元前写负数）')
                last_y = y
            self.chapter(w, c)
        ov = self.site.get('overviewChapter')
        if ov and ov not in ids: self.e('UNKNOWN_CHAPTER', 'site.json · overviewChapter', f'没有 id 为 {ov!r} 的章节{sug(ov, ids)}', '写尾声那一章的 id，或删掉（默认用最后一章）')

    def chapter(self, w, c):
        self.unknown(c, CHAPTER_KEYS, w, '章节')
        for k in ('num', 'title', 'sub', 'lead'):
            if not c.get(k): self.e('MISSING', f'{w} · {k}', f'没写 {k}', '照范例补上')
        for k, lk in (('num', 'ch.num'), ('title', 'ch.title'), ('sub', 'ch.sub'), ('lead', 'ch.lead'), ('rank', 'ch.rank'), ('era', 'ch.era'), ('year', 'ch.year'), ('age', 'ch.age')):
            self.text(f'{w} · {k}', c.get(k), lk, {'num': '章号', 'title': '章标题', 'sub': '副标题', 'lead': '导语', 'rank': '身份', 'era': '年号', 'year': '年份', 'age': '年龄'}[k])
        if c.get('color'): self.color(f'{w} · color', c['color'], 'color')
        else: self.e('MISSING', f'{w} · color', '没写章节主色 color', '写 "#rrggbb"，相邻两章换不同颜色')
        if c.get('atmo') and c['atmo'] not in ATMOS: self.e('UNKNOWN_ATMO', f'{w} · atmo', f'氛围 {c["atmo"]!r} 不认识{sug(c["atmo"], ATMOS)}', '能用的：' + '、'.join(f'{k}（{v}）' for k, v in ATMOS.items()))
        if c.get('terr') and c['terr'] not in self.terrs: self.e('UNKNOWN_TERR', f'{w} · terr', f'疆域 {c["terr"]!r} 在 geo.json 的 terr 里没有{sug(c["terr"], self.terrs)}', '写 geo.json terr 的键名，或删掉')
        v = c.get('view')
        if not (isinstance(v, dict) and is_ll(v.get('c')) and is_num(v.get('z'))):
            self.e('NO_VIEW', f'{w} · view', '没写开场镜头 view，或写错了', '写 "view": {"c": [经度, 纬度], "z": 5.4, "p": 50, "b": 0}：c 是画面中心，z 缩放（4 看一省，6 看一城），p 俯仰（0 垂直向下，60 斜看），b 朝向')
        else:
            if not (3 <= v['z'] <= 10): self.w('BAD_ZOOM', f'{w} · view.z', f'z={v["z"]} 太{"远" if v["z"] < 3 else "近"}', '章节开场一般 4.5–6.5')
            if is_num(v.get('p')) and not (0 <= v['p'] <= 75): self.w('BAD_PITCH', f'{w} · view.p', f'p={v["p"]} 超出 0–75', '一般 45–60')
        track, tour = c.get('track'), c.get('tour')
        if not track and not tour: self.e('NO_TRACK', w, '这一章既没有 track（路线）也没有 tour（巡游镜头）', '有路线的章写 track；序章、尾声写 tour')
        if track and tour: self.w('BOTH', w, '同时写了 track 和 tour；有 track 时 tour 不会播放', '二选一')
        for j, k in enumerate(c.get('kpis') or []):
            ww = f'{w} · kpis[{j}]'
            if not isinstance(k, dict) or k.get('v') is None or not k.get('l'): self.e('BAD_KPI', ww, f'{k!r}', '写 {"v": 数字或短词, "u": "单位", "l": "说明", "s": "出处"}'); continue
            self.text(ww + '.l', k.get('l'), 'kpi.l', '数字说明'); self.text(ww + '.s', k.get('s'), 'kpi.s', '数字出处'); self.text(ww + '.u', k.get('u'), 'kpi.u', '单位')
            if isinstance(k.get('v'), str) and wlen(k['v']) > 5: self.w('LONG_TEXT', ww + '.v', f'大数字位置写了「{k["v"]}」，太长', '写数字或 1–4 个字')
        if len(c.get('kpis') or []) > 4: self.w('TOO_MANY', f'{w} · kpis', '数字卡超过 4 个，排不下', '留 3–4 个')
        for j, p in enumerate(c.get('story') or []): self.text(f'{w} · story[{j}]', p, 'story', '经过段落')
        if not c.get('story'): self.w('MISSING', f'{w} · story', '没写 story（经过）段落', '写 2–4 段，每段一件事')
        for j, t in enumerate(c.get('timeline') or []):
            ww = f'{w} · timeline[{j}]'
            if not isinstance(t, dict): self.e('BAD_TYPE', ww, '写 {"t": 时间, "h": 标题, "d": 一句话, "at": 地点}', '照范例写'); continue
            self.text(ww + '.t', t.get('t'), 'tl.t', '时间'); self.text(ww + '.h', t.get('h'), 'tl.h', '时间线标题'); self.text(ww + '.d', t.get('d'), 'tl.d', '时间线说明')
            if t.get('at') is not None and not self.ref_ok(t['at']): self.bad_ref(ww + '.at', t['at'], '时间线')
        srcs = c.get('sources') or []
        for j, s in enumerate(srcs):
            ww = f'{w} · sources[{j}]'
            if not isinstance(s, dict) or not s.get('s') or not s.get('t'): self.e('BAD_SOURCE', ww, '史料写 {"s": "《书名·篇名》", "t": "原文"}', '照范例写'); continue
            self.text(ww + '.s', s['s'], 'src.s', '史料出处'); self.text(ww + '.t', s['t'], 'src.t', '史料原文')
            if not re.search(r'《.+》', s['s']): self.w('SOURCE_FORMAT', ww, f'出处「{s["s"]}」没有书名号', '写成「《书名·篇名》」')
        if not srcs: self.w('MISSING_SOURCE', f'{w} · sources', '这一章一条史料原文都没有', '至少摘 2 条原文，每条写清《书名·篇名》；原文要抄自 research/ 里核对过的版本')
        for j, x in enumerate(c.get('variants') or []):
            ww = f'{w} · variants[{j}]'
            if not isinstance(x, dict): continue
            self.text(ww + '.k', x.get('k'), 'var.k', '异文条目'); self.text(ww + '.a', x.get('a'), 'var.a', '甲本'); self.text(ww + '.b', x.get('b'), 'var.a', '乙本'); self.text(ww + '.h', x.get('h'), 'var.h', '按语')
        for j, d in enumerate(c.get('debates') or []):
            ww = f'{w} · debates[{j}]'
            if not isinstance(d, dict) or not isinstance(d.get('opts'), list): self.e('BAD_DEBATE', ww, '考据写 {"t": 问题, "q": 说明, "opts": [{"n": 说法, "tag": "主流", "at": 地点, "d": 依据}]}', '照范例写'); continue
            self.text(ww + '.t', d.get('t'), 'deb.t', '考据题目'); self.text(ww + '.q', d.get('q'), 'deb.q', '考据说明')
            for o_i, o in enumerate(d['opts']):
                wo = f'{ww}.opts[{o_i}]'
                self.text(wo + '.n', o.get('n'), 'opt.n', '候选说法'); self.text(wo + '.d', o.get('d'), 'opt.d', '候选依据'); self.text(wo + '.tag', o.get('tag'), 'opt.tag', '标签')
                if o.get('at') is not None and not self.ref_ok(o['at']): self.bad_ref(wo + '.at', o['at'], '考据候选点')
        for j, p in enumerate(c.get('people') or []):
            ww = f'{w} · people[{j}]'
            if not isinstance(p, dict) or not p.get('n'): self.e('BAD_PERSON', ww, '人物写 {"n": 名字, "side": 分组键, "r": 身份, "d": 一句话}', '照范例写'); continue
            self.text(ww + '.n', p.get('n'), 'ppl.n', '人名'); self.text(ww + '.r', p.get('r'), 'ppl.r', '人物身份'); self.text(ww + '.d', p.get('d'), 'ppl.d', '人物说明')
        groups = self.site.get('peopleGroups') or self.site.get('factions') or []
        gk = [g.get('k') for g in groups if isinstance(g, dict)]
        for j, p in enumerate(c.get('people') or []):
            if isinstance(p, dict) and gk and p.get('side') not in gk:
                self.i('PEOPLE_GROUP', f'{w} · people[{j}]', f'{p.get("n")} 的 side={p.get("side")!r} 不在分组 {gk} 里，会归到第一组', '写 site.json peopleGroups 或 factions 里的 k')
        # 路线
        nodes_by_seg, main_keys = [], set()
        for j, t in enumerate(track or []):
            ww = f'{w} · track[{j}]'
            if not isinstance(t, dict) or not t.get('r'): self.e('BAD_TRACK', ww, '每段写 {"r": 路线id, "v": 速度, "cap": 一句说明}', '照范例写'); nodes_by_seg.append(set()); continue
            self.unknown(t, TRACK_KEYS, ww, '路线段')
            r = t['r']; self.used_routes.add(r)
            if r not in self.routes:
                self.e('UNKNOWN_ROUTE', ww, f'路线 {r!r} 在 routes.json 里没有{sug(r, self.routes)}', '在 routes.json 里加这条路线，或改成已有的 id'); nodes_by_seg.append(set()); continue
            via = self.routes[r].get('via') if isinstance(self.routes[r], dict) else self.routes[r]
            ks = {x.split('@')[0] for x in (via or []) if isinstance(x, str)}
            nodes_by_seg.append(ks); main_keys |= ks
            if not (isinstance(via[0], str) and isinstance(via[-1], str)):
                self.w('FEW_KEYS', ww, f'主线路线 {r} 的起点或终点写的是坐标，停靠点、里程挂不上去', '主线路线的第一个和最后一个点都写 places.json 里的键名')
            self.text(ww + '.cap', t.get('cap'), 'cap', '路线说明'); self.text(ww + '.who', t.get('who'), 'who', '行进标记名字')
            if t.get('flag') and len(t['flag']) != 1: self.e('FLAG_LEN', ww + '.flag', f'旗号「{t["flag"]}」只能 1 个字', '写一个字')
            if t.get('v') is not None and (not is_num(t['v']) or not (0.2 <= t['v'] <= 8)):
                self.w('BAD_SPEED', ww + '.v', f'v={t.get("v")} 不合适', 'v 是播放速度倍数：短路线 0.6–1.2，几百公里 1.5–3，上千公里 3–5')
        self.cur = {'w': w, 'segs': nodes_by_seg, 'main': main_keys, 'chapter': c}
        for j, s in enumerate(c.get('side') or []):
            ww = f'{w} · side[{j}]'
            if not isinstance(s, dict): continue
            self.unknown(s, {'r', 'from', 'to', 'k', 'who'}, ww, '支线')
            if s.get('r') not in self.routes: self.e('UNKNOWN_ROUTE', ww, f'支线路线 {s.get("r")!r} 在 routes.json 里没有{sug(s.get("r"), self.routes)}', '在 routes.json 里加这条路线'); continue
            self.used_routes.add(s['r'])
            if s.get('k') not in SIDE_KINDS: self.e('UNKNOWN_SIDE_KIND', ww + '.k', f'支线类型 {s.get("k")!r} 不认识', '能用的：' + '、'.join(f'{k}（{v}）' for k, v in SIDE_KINDS.items()))
            for kk in ('from', 'to'): self.on_track(ww + '.' + kk, s.get(kk), '支线的 ' + kk)
            self.text(ww + '.who', s.get('who'), 'who', '支线人物')
        for ref, st in (c.get('stops') or {}).items():
            ww = f'{w} · stops.{ref}'
            if st == {}: self.i('EMPTY_STOP', ww, '空的停靠点，什么也不会发生', '删掉，或写 toast / scene'); continue
            self.on_track(ww, ref, '停靠点')
            self.stop(ww, st, ref)
        side_keys = set()
        for s in c.get('side') or []:
            r = self.routes.get(s.get('r')) if isinstance(s, dict) else None
            via = (r.get('via') if isinstance(r, dict) else r) or []
            side_keys |= {x.split('@')[0] for x in via if isinstance(x, str)}
        for key, st in (c.get('sideStops') or {}).items():
            ww = f'{w} · sideStops.{key}'
            if key not in side_keys: self.e('NOT_ON_TRACK', ww, f'{key} 不在本章任何一条支线的 via 里，这个停靠点不会触发', f'支线经过的点：{"、".join(sorted(side_keys)) or "（本章没有支线）"}')
            self.stop(ww, st, key)
        has_scene = any(isinstance(st, dict) and st.get('scene') for st in list((c.get('stops') or {}).values()) + list((c.get('sideStops') or {}).values()))
        if track and not has_scene: self.w('NO_SCENE', w, '这一章有路线但没有一个场景演出（stops 里的 scene），看起来只是一条线在走', '挑本章最重要的 1–2 件事写成 scene，见 references/scenes.md')
        for j, t in enumerate(tour or []):
            ww = f'{w} · tour[{j}]'
            if not isinstance(t, dict): continue
            self.unknown(t, TOUR_KEYS, ww, '巡游镜头')
            if t.get('at') is None or not self.ref_ok(t['at']): self.bad_ref(ww + '.at', t.get('at'), '巡游镜头')
            self.text(ww + '.h', t.get('h'), 'tour.h', '巡游标题'); self.text(ww + '.d', t.get('d'), 'tour.d', '巡游说明')
            dur = t.get('dur', 8)
            if not is_num(dur) or not (4 <= dur <= 22): self.w('BAD_DUR', ww + '.dur', f'dur={dur}', '每个巡游镜头 6–12 秒')
            if t.get('route'):
                rr = t['route'] if isinstance(t['route'], list) else [t['route']]
                for x in rr:
                    if x not in self.routes: self.e('UNKNOWN_ROUTE', ww + '.route', f'路线 {x!r} 不存在{sug(x, self.routes)}', '写 routes.json 里的 id')
                    else: self.used_routes.add(x)
            if t.get('terr') and t['terr'] not in self.terrs: self.e('UNKNOWN_TERR', ww + '.terr', f'疆域 {t["terr"]!r} 不存在', '写 geo.json terr 的键名')
            for x_i, f in enumerate(t.get('fx') or []): self.fx(f'{ww}.fx[{x_i}]', f, dur)
            for x_i, x in enumerate(t.get('sfx') or []): self.sfx(f'{ww}.sfx[{x_i}]', x, dur)
        for j, x in enumerate(c.get('cue') or []): self.sfx(f'{w} · cue[{j}]', x, None)
        # 文字里的 {km:a>b}
        for path, txt in walk(c):
            for m in REF_RE.finditer(txt):
                if m.group(1) == 'li' and not self.site.get('li'):
                    self.e('BAD_REF', f'{w} · {path}', f'用了 {m.group(0)}，但 site.json 没写 li（古里折算）', '在 site.json 写 "li": {"name": "唐里", "km": 0.54}，或改成 {km:…}')
                for x in (m.group(2), m.group(3)):
                    if x and x != 'all': self.on_track(f'{w} · {path}', x, f'{m.group(0)} 里的')
                if m.group(2) != 'all' and not m.group(3): self.e('BAD_REF', f'{w} · {path}', f'{m.group(0)} 要写成 {{km:起点>终点}}', '例如 {km:jiangling>baidi}')

    def on_track(self, w, ref, label):
        if ref is None: self.e('MISSING', w, f'{label}没写', '写本章路线经过的地点键名'); return
        k, _, n = str(ref).partition('@')
        segs = self.cur['segs']
        if not segs:
            self.e('NOT_ON_TRACK', w, f'{label} {ref!r}：这一章没有 track，挂不上去（会显示「若干」或不触发）', '序章、尾声里写死数字，不用 {km:…}'); return
        if n:
            if not n.isdigit() or not (1 <= int(n) <= len(segs)):
                self.e('BAD_REF', w, f'{label} {ref!r}：@ 后面是第几段路线（1 到 {len(segs)}）', f'写 {k}@1 … {k}@{len(segs)}'); return
            if k not in segs[int(n) - 1]:
                self.e('NOT_ON_TRACK', w, f'{label} {ref!r}：第 {n} 段路线 {self.cur["chapter"]["track"][int(n) - 1].get("r")} 的 via 里没有 {k}', f'这一段经过的点：{"、".join(sorted(segs[int(n) - 1]))}')
            return
        if k not in self.cur['main']:
            self.e('NOT_ON_TRACK', w, f'{label} {ref!r} 不在本章任何一段 track 路线的 via 里，引擎找不到它（停靠点不会触发，里程显示「若干」）{sug(k, self.cur["main"])}',
                   f'本章路线经过的点：{"、".join(sorted(self.cur["main"]))}。要么改成其中一个，要么把这个点加进 routes.json 对应路线的 via')

    def stop(self, w, st, ref):
        if not isinstance(st, dict): self.e('BAD_STOP', w, '停靠点写 {"toast": 一句话} 或 {"scene": {…}}', '照范例写'); return
        self.unknown(st, STOP_KEYS, w, '停靠点')
        self.text(w + '.toast', st.get('toast'), 'toast', '路过提示')
        if st.get('pulse') is not None and not self.ref_ok(st['pulse']): self.bad_ref(w + '.pulse', st['pulse'], 'pulse')
        if st.get('pulseSide'): self.side_ok(w + '.pulseSide', st['pulseSide'], 'pulseSide')
        fx = st.get('fx')
        if fx is not None and fx != 'cross':
            if not isinstance(fx, list): self.e('BAD_FX', w + '.fx', 'fx 要写成 [ {…}, {…} ] 列表，或写 "cross"（过河水花）', '照范例写')
            else:
                for j, f in enumerate(fx): self.fx(f'{w}.fx[{j}]', f, None)
        if st.get('scene'): self.scene(w + '.scene', st['scene'], ref)

    # ---------------------------------------------------------- 场景
    def scene(self, w, sc, ref):
        if not isinstance(sc, dict): self.e('BAD_SCENE', w, '场景是一个 {…}', '照 references/scenes.md 写'); return
        self.unknown(sc, SCENE_KEYS, w, '场景')
        if sc.get('kind') not in SCENE_KINDS: self.e('UNKNOWN_KIND', w + '.kind', f'场景类型 {sc.get("kind")!r} 不认识{sug(sc.get("kind"), SCENE_KINDS)}', '能用的：' + '、'.join(f'{k}（{v}）' for k, v in SCENE_KINDS.items()))
        for k in ('title', 'kicker'):
            if not sc.get(k): self.e('MISSING', f'{w}.{k}', f'场景没写 {k}', 'title 是场景名（≤12 字），kicker 是「时间 · 地点」（≤14 字）')
        self.text(w + '.title', sc.get('title'), 'sc.title', '场景标题'); self.text(w + '.kicker', sc.get('kicker'), 'sc.kicker', '场景眉题')
        if sc.get('at') is None or not self.ref_ok(sc['at']): self.bad_ref(w + '.at', sc.get('at'), '场景中心 at')
        dur = sc.get('dur')
        if not is_num(dur) or not (6 <= dur <= 32): self.e('BAD_DUR', w + '.dur', f'场景时长 dur={dur!r}', '写 10–20 秒；诗作场景按句数算，每句 1.5–2 秒，再加 4 秒'); dur = 16
        if is_num(sc.get('z')) and not (5.5 <= sc['z'] <= 12.5): self.w('BAD_ZOOM', w + '.z', f'z={sc["z"]}', '场景镜头一般 8–10（看清一座城到一片战场）')
        if is_num(sc.get('p')) and not (0 <= sc['p'] <= 80): self.w('BAD_PITCH', w + '.p', f'p={sc["p"]}', '一般 50–68')
        st = sc.get('stats') or []
        if len(st) > 4: self.w('TOO_MANY', w + '.stats', f'{len(st)} 个数字，场景卡只放得下 4 个', '留 2–4 个')
        for j, x in enumerate(st):
            ww = f'{w}.stats[{j}]'
            if not isinstance(x, dict) or not x.get('l'): self.e('BAD_STAT', ww, f'{x!r}', '写 {"v": 数字, "u": "单位", "l": "说明"} 或 {"t": "短词", "l": "说明"}'); continue
            self.text(ww + '.l', x.get('l'), 'st.l', '数字说明'); self.text(ww + '.t', x.get('t'), 'st.t', '短词')
            if x.get('e') is not None and x['e'] not in self.peaks and x['e'] not in self.places: self.e('UNKNOWN_PEAK', ww + '.e', f'海拔引用 {x["e"]!r} 既不是 geo.json 的 peaks，也不是 places 里的地点', '写山峰键名（geo.json peaks）或地点键名，引擎会显示那里的海拔')
            if 'v' not in x and 't' not in x and 'e' not in x: self.e('BAD_STAT', ww, '要有 v、t 或 e 其中之一', '见 references/scenes.md')
        q = sc.get('quote')
        if q:
            if not isinstance(q, dict) or not q.get('t'): self.e('BAD_QUOTE', w + '.quote', '引文写 {"t": "原文", "s": "《出处》"}', '照范例写')
            else:
                self.text(w + '.quote.t', q.get('t'), 'sc.quote', '场景引文'); self.text(w + '.quote.s', q.get('s'), 'sc.qs', '引文出处')
                if not q.get('s'): self.w('MISSING_SOURCE', w + '.quote', f'引文「{q["t"][:16]}…」没写出处 s', '写 "s": "《书名·篇名》"；找不到原文就删掉这条引文')
        lines = sc.get('lines') or []
        if not lines: self.w('NO_LINES', w + '.lines', '场景没有字幕 lines', '写 3–5 句字幕 [[秒, "一句话"], …]，每句 ≤ 44 字')
        last = -1
        for j, ln in enumerate(lines):
            ww = f'{w}.lines[{j}]'
            if not (isinstance(ln, list) and len(ln) == 2 and is_num(ln[0]) and isinstance(ln[1], str)):
                self.e('BAD_LINE', ww, f'{ln!r}', '每句字幕写 [秒数, "一句话"]'); continue
            if ln[0] < last: self.e('TIME_ORDER', ww, f'字幕时间 {ln[0]} 比上一句 {last} 早', '按时间先后排')
            last = ln[0]
            self.text(ww, ln[1], 'sc.line', '字幕')
            if ln[0] > dur - 1: self.w('AFTER_END', ww, f'字幕在第 {ln[0]} 秒出现，场景 {dur} 秒就结束了', '提前，或把 dur 加大')
        if lines and isinstance(lines[-1], list) and len(lines[-1]) == 2 and is_num(lines[-1][0]):
            need = lines[-1][0] + max(2.0, wlen(lines[-1][1]) / 8)
            if need > dur + 0.5: self.w('LINE_TIME', w + '.lines', f'最后一句字幕只能停 {dur - lines[-1][0]:.1f} 秒，读不完', f'把 dur 加到 {need:.0f} 以上，或把这句提前')
        for j, u in enumerate(sc.get('units') or []):
            ww = f'{w}.units[{j}]'
            if not isinstance(u, dict): continue
            self.unknown(u, UNIT_KEYS, ww, '兵力 / 人物符号')
            self.side_ok(ww + '.side', u.get('side'))
            if u.get('shape') and u['shape'] not in SHAPES: self.e('UNKNOWN_SHAPE', ww + '.shape', f'形状 {u["shape"]!r} 不认识', '能用的：' + '、'.join(f'{k}（{v}）' for k, v in SHAPES.items()))
            for k in ('from', 'to', 'flee'): self.offset(f'{ww}.{k}', u.get(k), k)
            self.times(ww, u, dur); self.times(ww, u, dur, ('f0', 'f1'))
            if is_num(u.get('n')) and u['n'] > 400: self.w('TOO_MANY', ww + '.n', f'n={u["n"]}，粒子太多手机会卡', '写 200 以内')
            self.text(ww + '.label', u.get('label'), 'unitlabel', '符号标签')
        for j, f in enumerate(sc.get('fx') or []): self.fx(f'{w}.fx[{j}]', f, dur)
        for j, x in enumerate(sc.get('sfx') or []): self.sfx(f'{w}.sfx[{j}]', x, dur)
        if sc.get('weather') and sc['weather'] not in WEATHER: self.e('UNKNOWN_WEATHER', w + '.weather', f'天气 {sc["weather"]!r} 不认识{sug(sc["weather"], WEATHER)}', '能用的：' + '、'.join(f'{k}（{v}）' for k, v in WEATHER.items()))
        r = sc.get('relic')
        if r is not None:
            if isinstance(r, str):
                if r not in self.relics: self.e('UNKNOWN_RELIC', w + '.relic', f'文物 {r!r} 在 site.json 的 relics 里没有', '在 site.json relics 里写 {"' + r + '": {"t": 名称, "d": 说明}}，或直接写 {"t": …, "d": …}')
            elif not (isinstance(r, dict) and r.get('t')): self.e('BAD_RELIC', w + '.relic', '文物写 {"t": 名称, "d": 一句说明}', '照范例写')
            else: self.text(w + '.relic.t', r.get('t'), 'relic.t', '文物名'); self.text(w + '.relic.d', r.get('d'), 'relic.d', '文物说明')
        pm = sc.get('poem')
        if pm is not None: self.poem(w + '.poem', pm, dur)
        if sc.get('kind') == 'poem' and not pm: self.w('NO_POEM', w, 'kind 是 poem，但没写 poem（诗作卡）', '写 "poem": {"t": 题目, "a": 作者, "l": [每句], "s": 出处}')

    def poem(self, w, pm, dur):
        if not isinstance(pm, dict) or not isinstance(pm.get('l'), list) or not pm['l']:
            self.e('BAD_POEM', w, '诗作写 {"t": "题目", "a": "作者", "l": ["第一句", "第二句"], "s": "《出处》"}', '照 references/scenes.md 写'); return
        self.unknown(pm, {'t', 'a', 'l', 's', 'at'}, w, '诗作')
        self.text(w + '.t', pm.get('t'), 'poem.t', '诗题'); self.text(w + '.a', pm.get('a'), 'poem.a', '作者')
        if len(pm['l']) > LIM['poem.lines']: self.w('LONG_TEXT', w + '.l', f'{len(pm["l"])} 句，诗作卡最多放 {LIM["poem.lines"]} 句', '长诗只摘最有名的 4–8 句，题目后加「（节选）」')
        for j, x in enumerate(pm['l']):
            self.text(f'{w}.l[{j}]', x, 'poem.line', '诗句')
            if isinstance(x, str) and re.search(r'[，。；][^，。；]', x.rstrip('，。；！？')): self.i('POEM_LINE', f'{w}.l[{j}]', f'「{x}」一行里有两句', '竖排时一行一句更好看：在逗号处拆成两行')
        if not pm.get('s'): self.w('MISSING_SOURCE', w, '诗作没写出处 s', '写 "s": "《李太白全集》卷十五" 这样的版本出处')
        at = pm.get('at')
        if at is not None:
            if not isinstance(at, list) or len(at) != len(pm['l']) or not all(is_num(x) for x in at):
                self.e('BAD_POEM', w + '.at', f'at 要和诗句一一对应（{len(pm["l"])} 个秒数）', '删掉 at（自动均匀出现），或补齐')
            elif any(b < a for a, b in zip(at, at[1:])) or at[-1] > dur - 1:
                self.w('TIME_ORDER', w + '.at', f'at={at}：要从小到大，且都早于场景结束（dur={dur}）', '调整秒数')
        need = 0.4 + len(pm['l']) * 1.5 + 3
        if dur and need > dur + 0.5: self.w('LINE_TIME', w, f'{len(pm["l"])} 句诗在 {dur} 秒里出不完', f'把场景 dur 加到 {need:.0f} 以上')

    def fx(self, w, f, dur):
        if not isinstance(f, dict): self.e('BAD_FX', w, f'{f!r}', '每个特效写 {"k": 类型, …}'); return
        self.unknown(f, FX_KEYS, w, '特效')
        if f.get('k') not in FX_KINDS: self.e('UNKNOWN_FX', w + '.k', f'特效类型 {f.get("k")!r} 不认识{sug(f.get("k"), FX_KINDS)}', '能用的：' + '、'.join(f'{k}（{v}）' for k, v in FX_KINDS.items())); return
        for k in ('at', 'from', 'to'): self.offset(f'{w}.{k}', f.get(k), k)
        self.times(w, f, dur)
        if f.get('side'): self.side_ok(w + '.side', f['side'])
        if f['k'] == 'banner': self.text(w + '.t', f.get('t'), 'banner', '横幅大字')
        if f['k'] == 'label': self.text(w + '.t', f.get('t'), 'fxlabel', '特效文字')
        if f.get('label'): self.text(w + '.label', f.get('label'), 'unitlabel', '特效标签')
        if f.get('char') and len(f['char']) != 1: self.e('FLAG_LEN', w + '.char', f'旗上的字「{f["char"]}」只能 1 个', '写一个字')
        if f['k'] in ('banner', 'label') and not f.get('t'): self.e('MISSING', w + '.t', f'{f["k"]} 特效没写文字 t', '写 "t": "……"')

    def sfx(self, w, x, dur):
        if not (isinstance(x, list) and len(x) == 2 and is_num(x[0]) and isinstance(x[1], str)):
            self.e('BAD_SFX', w, f'{x!r}', '音效写 [秒数, "名字"]，例如 [0.5, "bell"]'); return
        name = x[1].split(':')[0]
        if name not in SFX: self.e('UNKNOWN_SFX', w, f'音效 {x[1]!r} 不认识{sug(name, SFX)}', '能用的：' + '、'.join(f'{k}（{v}）' for k, v in SFX.items()))
        if dur and x[0] > dur: self.w('AFTER_END', w, f'音效在第 {x[0]} 秒，场景 {dur} 秒就结束了', '提前')

    # ---------------------------------------------------------- 全文扫描
    def scan_text(self):
        files = [('site.json', self.site), ('places.json', self.places), ('labels.json', self.st['labels'])] + [(f'chapters/{f.name}', c) for f, c in self.st['chapters']]
        for fname, obj in files:
            for path, s in walk(obj):
                w = f'{fname} · {path}'
                if '台湾' in s: self.e('FORBID', w, f'「{s[:30]}」出现了「台湾」二字', '按规则写到城市一级，例如「台南」「台北」')
                if NOT_BUT.search(s): self.e('FORBID', w, f'「{NOT_BUT.search(s).group(0)}」用了「不是……而是……」句式', '直接说是什么，删掉「不是……」半句')
                for h in HYPE:
                    if h in s: self.w('HYPE', w, f'「{s[:30]}」用了浮夸词「{h}」', '换成具体事实或数字'); break
                if PLACEHOLDER.search(s): self.w('PLACEHOLDER', w, f'「{s[:30]}」像是没写完的占位文字', '换成真实内容，或删掉这一项')
                if re.search(r'[一-鿿]"|"[一-鿿]', s): self.i('QUOTE_MARK', w, f'「{s[:30]}」中文里用了英文双引号', '中文引号用「」')

    def ledger(self):
        """数字台账：页面上出现的每个数字都要先记进 research/facts.md"""
        p = self.st['proj'] / 'research' / 'facts.md'
        if not p.exists():
            self.w('NO_LEDGER', 'research/facts.md', '没有考据台账', '第一阶段先写 research/facts.md：每个数字、每句原文都记下出处，见 references/research.md'); return
        flat = re.sub(r'(?<=\d)[,，](?=\d{3})', '', p.read_text(encoding='utf-8'))
        nums = set(re.findall(r'\d+(?:\.\d+)?', flat))

        def chk(v, w, label):
            if not is_num(v): return
            s = ('%g' % v) if isinstance(v, float) else str(v)
            if s not in nums:
                self.w('NUM_UNSOURCED', w, f'{label} {s} 在 research/facts.md 里找不到',
                       '数字要先进台账：在 facts.md 的数字表里加一行「数字 | 原文 | 出处」（数字用阿拉伯数字）。查不到原文的数字删掉')
        for i, x in enumerate(self.site.get('introStats') or []):
            if isinstance(x, dict): chk(x.get('v'), f'site.json · introStats[{i}]', '开场数字')
        for f, c in self.st['chapters']:
            w = f'chapters/{f.name}'
            for j, k in enumerate(c.get('kpis') or []):
                if isinstance(k, dict): chk(k.get('v'), f'{w} · kpis[{j}]', '数字卡')
            for grp in ('stops', 'sideStops'):
                for ref, st in (c.get(grp) or {}).items():
                    sc = st.get('scene') if isinstance(st, dict) else None
                    for j, x in enumerate((sc or {}).get('stats') or []):
                        if isinstance(x, dict): chk(x.get('v'), f'{w} · {grp}.{ref}.scene.stats[{j}]', '场景数字')

    def unused(self):
        for rid in self.routes:
            if rid not in self.used_routes: self.i('UNUSED_ROUTE', f'routes.json · {rid}', '这条路线没有任何章节用到', '在某章 track / side / tour.route 里用上，或删掉')

    def run(self):
        self.site_json(); self.places_json(); self.routes_json(); self.labels_json(); self.chapters(); self.scan_text(); self.ledger(); self.unused()


# ------------------------------------------------------------------ 需要 geo 结果的检查
def check_geo(story, rep, meta):
    bb, nodes = meta.get('bbox'), meta.get('nodes', {})
    routes = {k: v for k, v in story['routes'].items() if not k.startswith('_')}
    for rid, m in (meta.get('routes') or {}).items():
        w = f'routes.json · {rid}'
        if m['len'] < 0.5: rep.warn('SHORT_ROUTE', w, f'路线只有 {m["len"]} 公里，几乎看不见', '起点和终点是不是写成了同一个点？')
        if isinstance(routes.get(rid), dict) and routes[rid].get('jumpOk'): continue
        c, ks = m['ctrl'], m['keys']
        nm = lambda j: ks[j] or str(c[j])
        for j in range(len(c) - 1):
            d = hav(c[j], c[j + 1])
            if d > 250:
                rep.warn('JUMP', w, f'{nm(j)} → {nm(j + 1)} 直线 {d:.0f} 公里，中间一个经停点都没有，路线会直直穿过山和河',
                         '在两点之间加 1–3 个经停点（沿河谷、驿道、关隘），沿河走写 {"river": "河名"}；确实是海路或荒漠直线就在这条路线上写 "jumpOk": true')
        for a, km, up, at in m.get('climb') or []:
            if up > 900 and km > 25:
                rep.warn('CLIMB', w, f'{nm(a)} → {nm(a + 1)} 之间要翻过一处比两头高 {up} 米的山（{at} 附近），古人很少这样走',
                         '查这一段的古道：把河谷里的点、关隘或垭口加进 via（用 python3 geo.py near 经度 纬度 看海拔和附近的河）；确实翻山就把垭口写成经停点，或写 "jumpOk": true')
    for k, ll in nodes.items():
        if bb and not (bb[0] <= ll[0] <= bb[2] and bb[1] <= ll[1] <= bb[3]):
            rep.warn('OFF_MAP', f'places.json · {k}', f'{ll} 在地图范围 {bb} 外', '核对坐标；没错的话放大 geo.json 的 bbox')
    rl = {rid: r for rid, r in (meta.get('routes') or {}).items()}
    for f, c in story['chapters']:
        w = f'chapters/{f.name}'
        tr = [t for t in (c.get('track') or []) if isinstance(t, dict) and t.get('r') in rl]
        for a, b in zip(tr, tr[1:]):
            pa, pb = rl[a['r']]['ctrl'][-1], rl[b['r']]['ctrl'][0]
            d = hav(pa, pb)
            if d > 30: rep.warn('GAP', w, f'路线 {a["r"]} 的终点和下一段 {b["r"]} 的起点相距 {d:.0f} 公里，行进标记会瞬移', '让下一段从上一段的终点出发（via 第一个点写上一段最后一个点）')
        v = c.get('view') or {}
        if bb and is_ll(v.get('c')) and not (bb[0] - 3 <= v['c'][0] <= bb[2] + 3 and bb[1] - 3 <= v['c'][1] <= bb[3] + 3):
            rep.warn('OFF_MAP', w + ' · view.c', f'开场镜头中心 {v["c"]} 在地图范围外', '写本章路线中间的经纬度')
        for ref, st in (c.get('stops') or {}).items():
            sc = (st or {}).get('scene') if isinstance(st, dict) else None
            if not sc or sc.get('kind') == 'cut': continue
            k = ref.split('@')[0]
            at = sc.get('at'); p = nodes.get(at.split('@')[0]) if isinstance(at, str) else (at if is_ll(at) else None)
            if k in nodes and p:
                d = hav(nodes[k], p)
                if d > 200: rep.warn('SCENE_FAR', f'{w} · stops.{ref}.scene', f'场景发生地离触发它的停靠点 {k} 有 {d:.0f} 公里，镜头会突然飞走', '场景 at 写停靠点附近；要演「同一时刻另一处」的事，把 kind 写成 cut')
    for x in meta.get('warns') or []: rep.items.append(x)


def check_story(story, rep):
    Checker(story, rep).run()


# ------------------------------------------------------------------ 阶段 1、2：考据文件
RESEARCH = [  # 文件名、叫法、至少几行（不算空行）
    ('chronology.md', '生平年表', 15), ('places.md', '地点考据', 8), ('facts.md', '考据台账', 5),
    ('sources.md', '原文摘录', 8), ('debates.md', '争议考据', 3),
]


def check_research(proj, rep, stage):
    rd = Path(proj).resolve() / 'research'
    for fn, label, least in RESEARCH:
        p, w = rd / fn, f'research/{fn}'
        if not p.exists():
            rep.err('NO_RESEARCH', w, f'没有{label}', f'照 references/research.md 写，格式照抄 examples/libai/research/{fn}'); continue
        t = p.read_text(encoding='utf-8')
        n = len([x for x in t.splitlines() if x.strip()])
        if n < least: rep.err('THIN_RESEARCH', w, f'{label}只有 {n} 行', f'至少 {least} 行有出处的内容；格式照抄 examples/libai/research/{fn}')
        if PLACEHOLDER.search(t): rep.warn('PLACEHOLDER', w, '还有模板里的占位文字（TODO、待补……）', '查到就写上，查不到就删掉这一行或写「不详」')
        if NOT_BUT.search(t): rep.warn('NOT_BUT', w, '用了「不是……而是……」句式', '直接写结论')
    p = rd / 'places.md'
    if p.exists():
        n = len(re.findall(r'-?\d{1,3}\.\d+\s*[,，]\s*-?\d{1,2}\.\d+', p.read_text(encoding='utf-8')))
        if n < 3: rep.err('NO_COORDS', 'research/places.md', f'只找到 {n} 个坐标', '每个地点写 [经度, 纬度]，例如 [108.94, 34.26]；用 geo.py near 核对')
    if stage >= 2:
        p = rd / 'outline.md'
        if not p.exists(): rep.err('NO_OUTLINE', 'research/outline.md', '没有章节大纲', '格式照抄 examples/libai/research/outline.md')
        else:
            t = p.read_text(encoding='utf-8')
            n = len(set(re.findall(r'\d\d-[A-Za-z0-9_]+\.json', t)))
            if n < 3: rep.err('THIN_OUTLINE', 'research/outline.md', f'只找到 {n} 个章节文件名', '每章写一个文件名（如 03-shu.json）；全站 5–9 章，含序章和尾声')
            if PLACEHOLDER.search(t): rep.warn('PLACEHOLDER', 'research/outline.md', '还有占位文字', '补上或删掉')


def run(proj, stage=0):
    import geo  # noqa
    rep = Report()
    out = Path(proj).resolve() / 'qa' / 'check.json'
    if stage in (1, 2):
        check_research(proj, rep, stage)
        rep.print(f'阶段 {stage} 验收')
        save_json(out, rep.items)
        print('\n✔ 阶段 %d 验收通过' % stage if not rep.errors else '\n✖ 还有错误，照「怎么改」修完再跑一次')
        return rep
    try:
        story = load_story(proj)
    except StoryError as e:
        die(str(e))
    if stage == 3: story = dict(story, chapters=[])  # 章节到阶段 4 才写，模板章节里的示例地点先不查
    check_story(story, rep)
    if stage == 3:  # 还没写章节：不报「一章都没有」「路线没人用」，先把地点和路线算通
        rep.items = [i for i in rep.items if i['code'] not in ('NO_CHAPTER', 'UNUSED_ROUTE', 'UNUSED_PLACE')]
    if not rep.errors:
        try:
            meta = geo.build(proj, quiet=True)
            check_geo(story, rep, meta)
        except StoryError as e:
            rep.err('GEO', 'geo', str(e), '')
    rep.print('故事检查' if not stage else f'阶段 {stage} 验收')
    save_json(out, rep.items)
    print(f'\n报告：{out}')
    if stage == 3: print('✔ 阶段 3 验收通过（警告到阶段 4、5 再清）' if not rep.errors else '✖ 还有错误，照「怎么改」修完再跑一次')
    return rep


if __name__ == '__main__':
    a = sys.argv[1:]
    if not a or a[0] in ('-h', '--help'): print(__doc__); sys.exit(0)
    stage = 0
    if '--stage' in a:
        i = a.index('--stage')
        try: stage = int(a[i + 1])
        except (IndexError, ValueError): die('--stage 后面写数字 1–8')
        del a[i:i + 2]
    r = run(a[0], stage)
    sys.exit(1 if r.errors else 0)
