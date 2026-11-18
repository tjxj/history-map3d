# -*- coding: utf-8 -*-
"""三维考据地图 · 脚本公用部分：读故事文件、引擎词表、报警格式。"""
import json, os, re, sys
from pathlib import Path

SKILL = Path(__file__).resolve().parent.parent
ENGINE = SKILL / 'engine'
NE_DIR = SKILL / 'data' / 'ne'
CACHE = Path(os.environ.get('HMAP_CACHE', str(Path.home() / '.cache' / 'history-map3d')))
TILE_CACHE = Path(os.environ.get('HMAP_TILES', str(CACHE / 'tiles')))
FONT_NAMES = ['SourceHanSerifSC-VF.ttf', 'SourceHanSerifSC-VF.otf']


def find_font():
    """思源宋体简体可变字体：先看环境变量 HMAP_FONT，再看仓库 fonts/ 和系统字体目录"""
    if os.environ.get('HMAP_FONT'): return Path(os.environ['HMAP_FONT'])
    home = Path.home()
    flat = [SKILL / 'fonts', home / 'Library' / 'Fonts', Path('/Library/Fonts'), home / '.fonts', home / '.local' / 'share' / 'fonts',
            home / 'AppData' / 'Local' / 'Microsoft' / 'Windows' / 'Fonts', Path('C:/Windows/Fonts')]
    for d in flat:
        for n in FONT_NAMES:
            if (d / n).is_file(): return d / n
    for d in (Path('/usr/share/fonts'), Path('/usr/local/share/fonts')):
        if d.is_dir():
            for n in FONT_NAMES:
                hit = next(d.rglob(n), None)
                if hit: return hit
    return None

# ------------------------------------------------------------------ 引擎认得的词（写别的会被 check.py 报 UNKNOWN_*）
SCENE_KINDS = {
    'battle': '战役', 'cut': '同一时刻（切到另一处）', 'vista': '地理 / 风景', 'ritual': '典礼', 'surrender': '受降',
    'poem': '诗作', 'meet': '相会', 'voyage': '舟行', 'event': '事件',
}
ATMOS = {
    'dusk': '黄昏', 'dawn': '清晨', 'spring': '春', 'summer': '夏', 'autumn': '秋', 'steppe': '草原', 'night': '夜',
    'rain': '雨', 'snow': '雪', 'moon': '月夜（天上有月亮）', 'mist': '雾', 'blossom': '花开',
}
WEATHER = {
    'dust': '沙尘', 'snow': '雪', 'pollen': '飞絮', 'heat': '热浪', 'leaves': '落叶', 'grass': '草屑', 'embers': '火星',
    'rain': '雨丝', 'mist': '雾团', 'petals': '花瓣', 'motes': '萤光微尘', 'storm': '沙暴',
}
SFX = {
    'drum': '单鼓', 'drums': '鼓阵', 'horn': '号角', 'gallop': '马蹄（可写 gallop:秒数）', 'clash': '兵刃', 'arrows': '箭雨',
    'roar': '呐喊', 'sting': '短促的惊音', 'bell': '钟', 'qin': '古琴一句', 'xun': '埙', 'wind': '风', 'storm': '风暴',
    'water': '水声', 'whoosh': '转场呼声', 'tick': '轻响',
}
FX_KINDS = {
    'arrows': '箭雨', 'banner': '大字横幅', 'beam': '光柱', 'clash': '交锋火花', 'convert': '颜色转换（受降）', 'escape': '一人逃离',
    'escort': '护送', 'flag': '一面旗', 'flags': '一排旗', 'label': '一行字', 'move': '一人或一舟移动', 'pulse': '脉冲光圈',
    'ring': '包围圈', 'storm': '沙暴墙',
}
SHAPES = {'wedge': '楔形冲锋', 'line': '横列', 'blob': '一团', 'camp': '营地', 'ring': '环形（包围）', 'single': '单人 / 单骑（n 写 1）'}
SIDE_KINDS = {'ally': '同行', 'enemy': '对手', 'lost': '失道', 'flow': '迁徙'}
LABEL_TYPES = {'region': '大区域', 'people': '部族 / 势力', 'mount': '山', 'water': '水', 'desert': '沙漠', 'city': '古城', 'modern': '今地名'}
BASE_COLORS = ['han', 'xn', 'sur', 'gold', 'white', 'water', 'earth', 'steel']

UNIT_KEYS = {'side', 'shape', 'n', 'from', 'to', 't0', 't1', 'melee', 'flee', 'f0', 'f1', 'r', 'die', 'cut', 'chase', 'c0', 'c1',
             'stream', 's0', 's1', 'lead', 'square', 'surrender', 'label', 'big'}
FX_KEYS = {'k', 'at', 'to', 'from', 'r', 't0', 't1', 'n', 'side', 't', 'radial', 'gold', 'h', 'edge', 'boat', 'label', 'char'}
SCENE_KEYS = {'kind', 'kicker', 'title', 'at', 'z', 'p', 'b', 'orbit', 'dur', 'stats', 'quote', 'lines', 'units', 'fx', 'sfx',
              'weather', 'relic', 'poem'}
STOP_KEYS = {'toast', 'scene', 'fx', 'pulse', 'pulseSide'}
TOUR_KEYS = {'at', 'z', 'p', 'b', 'dur', 'h', 'd', 'fx', 'sfx', 'terr', 'route', 'all'}
TRACK_KEYS = {'r', 'v', 'cap', 'who', 'flag', 'dash', 'dashName', 'by'}
CHAPTER_KEYS = {'id', 'num', 'title', 'sub', 'era', 'year', 'y', 'age', 'rank', 'color', 'atmo', 'terr', 'view', 'lead', 'kpis',
                'story', 'timeline', 'sources', 'variants', 'debates', 'people', 'track', 'side', 'stops', 'sideStops', 'tour', 'cue'}


# ------------------------------------------------------------------ 宽容地读 JSON：允许 // 注释、/* */ 注释、末尾多余逗号
def _strip_jsonc(text):
    out, i, n, in_str, esc = [], 0, len(text), False, False
    while i < n:
        c = text[i]
        if in_str:
            out.append(c)
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == '"': in_str = False
            i += 1; continue
        if c == '"': in_str = True; out.append(c); i += 1; continue
        if c == '/' and i + 1 < n and text[i + 1] == '/':
            while i < n and text[i] != '\n': i += 1
            continue
        if c == '/' and i + 1 < n and text[i + 1] == '*':
            j = text.find('*/', i + 2); j = n if j < 0 else j + 2
            out.append(re.sub(r'[^\n]', ' ', text[i:j])); i = j; continue
        out.append(c); i += 1
    s = ''.join(out)
    # 末尾逗号：, 后面只有空白再接 } 或 ]（字符串已经原样保留，这里只处理字符串外）
    res, in_str, esc = [], False, False
    for k, c in enumerate(s):
        if in_str:
            res.append(c)
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == '"': in_str = False
            continue
        if c == '"': in_str = True; res.append(c); continue
        if c == ',':
            m = re.match(r'\s*[}\]]', s[k + 1:])
            if m: res.append(' '); continue
        res.append(c)
    return ''.join(res)


class StoryError(Exception):
    pass


def load_json(path, default=None):
    path = Path(path)
    if not path.exists():
        if default is not None: return default
        raise StoryError(f'找不到文件 {path}')
    raw = path.read_text(encoding='utf-8-sig')
    try:
        return json.loads(_strip_jsonc(raw))
    except json.JSONDecodeError as e:
        lines = raw.split('\n')
        ln = lines[e.lineno - 1] if 0 < e.lineno <= len(lines) else ''
        hint = '常见原因：两项之间少了逗号；字符串里的英文双引号 " 没写成「」或 \\"；中文冒号 ：代替了英文冒号 :；括号没配对。'
        raise StoryError(f'JSON 写错了：{path} 第 {e.lineno} 行第 {e.colno} 列：{e.msg}\n    {ln.strip()[:160]}\n    {" " * max(0, min(e.colno - 1, 160))}^\n  怎么改：{hint}')


def pretty(o, ind=0, width=118):
    """好读的 JSON：短的对象 / 数组放一行，长的才展开"""
    s = json.dumps(o, ensure_ascii=False)
    if len(s) + ind <= width or not isinstance(o, (dict, list)) or not o: return s
    pad = ' ' * (ind + 2)
    if isinstance(o, dict):
        return '{\n' + ',\n'.join(f'{pad}{json.dumps(k, ensure_ascii=False)}: {pretty(v, ind + 2, width)}' for k, v in o.items()) + '\n' + ' ' * ind + '}'
    return '[\n' + ',\n'.join(pad + pretty(v, ind + 2, width) for v in o) + '\n' + ' ' * ind + ']'


def save_json(path, obj, compact=False):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    txt = json.dumps(obj, ensure_ascii=False, separators=(',', ':')) if compact else pretty(obj)
    path.write_text(txt + '\n', encoding='utf-8')


def load_story(proj):
    proj = Path(proj).resolve()
    st = proj / 'story'
    if not st.is_dir():
        raise StoryError(f'{proj} 下面没有 story/ 文件夹。先运行：python3 {shq(SKILL / "scripts" / "new.py")} {shq(proj)} 人物名')
    chs = []
    cdir = st / 'chapters'
    files = sorted(cdir.glob('*.json')) if cdir.is_dir() else []
    for f in files:
        chs.append((f, load_json(f)))
    return {
        'proj': proj,
        'site': load_json(st / 'site.json'),
        'places': load_json(st / 'places.json'),
        'routes': load_json(st / 'routes.json'),
        'labels': load_json(st / 'labels.json', []),
        'geo': load_json(st / 'geo.json', {}),
        'chapters': chs,
    }


# ------------------------------------------------------------------ 编译成引擎要的 SITE / NODE_INFO / LABELS / CHAPTERS
def label_row(l):
    """labels.json 两种写法都收：对象 {t, n, ll, z, s, big, cap, peak, chap, node} 或数组 [类型, 文字, 经度, 纬度, 最小缩放, {选项}]"""
    if isinstance(l, list): return l
    o = {k: v for k, v in l.items() if k not in ('t', 'n', 'll', 'z') and not k.startswith('_')}
    ll = l.get('ll') or [None, None]
    row = [l.get('t', 'city'), l.get('n', ''), ll[0], ll[1], l.get('z', 5)]
    if o: row.append(o)
    return row


def compile_data(story):
    NI = {}
    for k, p in story['places'].items():
        # 没写 n 的点只用来画线（转折点），不进航点列表
        if k.startswith('_') or not isinstance(p, dict) or not p.get('n'): continue
        NI[k] = [p['n'], p.get('d', '')]
    chapters = [c for _, c in story['chapters']]
    labels = [label_row(l) for l in story['labels'] if not (isinstance(l, dict) and l.get('_'))]
    site = {k: v for k, v in story['site'].items() if not k.startswith('_')}
    return site, NI, labels, chapters


# ------------------------------------------------------------------ 报警
class Report:
    def __init__(self):
        self.items = []

    def add(self, level, code, where, msg, fix=''):
        self.items.append({'level': level, 'code': code, 'where': where, 'msg': msg, 'fix': fix})

    def err(self, code, where, msg, fix=''): self.add('ERROR', code, where, msg, fix)
    def warn(self, code, where, msg, fix=''): self.add('WARN', code, where, msg, fix)
    def info(self, code, where, msg, fix=''): self.add('INFO', code, where, msg, fix)

    @property
    def errors(self): return [i for i in self.items if i['level'] == 'ERROR']

    @property
    def warns(self): return [i for i in self.items if i['level'] == 'WARN']

    def print(self, title, limit=400):
        mark = {'ERROR': '✖ 错误', 'WARN': '▲ 警告', 'INFO': '· 提示'}
        print(f'\n==== {title}：{len(self.errors)} 个错误，{len(self.warns)} 个警告 ====')
        shown = 0
        for lv in ('ERROR', 'WARN', 'INFO'):
            for i in self.items:
                if i['level'] != lv: continue
                if shown >= limit: break
                shown += 1
                print(f"{mark[lv]} [{i['code']}] {i['where']}：{i['msg']}")
                if i['fix']: print(f"    怎么改：{i['fix']}")
        if shown < len(self.items): print(f'…… 还有 {len(self.items) - shown} 条，完整列表见 JSON 报告')

    def save(self, path):
        save_json(path, self.items)


def hav(a, b):
    import math
    R = 6371.0088
    la1, la2 = math.radians(a[1]), math.radians(b[1])
    dla = la2 - la1; dlo = math.radians(b[0] - a[0])
    h = math.sin(dla / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(dlo / 2) ** 2
    return 2 * R * math.asin(math.sqrt(min(1.0, h)))


def shq(path):
    """打印给人 / 模型照抄的命令时，路径带空格要加引号"""
    import shlex
    return shlex.quote(str(path))


def die(msg, code=2):
    print('✖ ' + msg)
    sys.exit(code)
