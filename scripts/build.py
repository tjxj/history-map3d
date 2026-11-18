# -*- coding: utf-8 -*-
"""三维考据地图 · 一键构建

  python3 build.py <项目目录>                  检查故事 → 算地理数据 → 生成网站到 <项目>/dist/
  python3 build.py <项目目录> --no-font        不嵌字体（快，调试用；页面用系统宋体）
  python3 build.py <项目目录> --force-geo      地理数据强制重算（高程瓦片下载失败过、或改了 geo.py 时用）
  python3 build.py <项目目录> --allow-errors   有错误也照样生成（只在排查问题时用，交付前必须 0 错误）

产物：<项目>/dist/ 整个文件夹就是网站；<项目>/qa/check.json 是检查报告。
下一步：python3 shoot.py <项目目录>  截图并自动查版面问题。
"""
import hashlib, html, json, shutil, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import check  # noqa: E402
import geo  # noqa: E402
from common import CACHE, ENGINE, SKILL, Report, find_font, StoryError, compile_data, die, load_story, save_json, shq  # noqa: E402

FONT_CACHE = CACHE / 'fonts'
ALWAYS = ('，。、；：？！「」『』（）《》〈〉—…·～“”‘’【】％＋－×÷°′″→←↑↓●○■□▲△★☆ '
          '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'
          '零一二三四五六七八九十百千万亿年月日时分秒前后公元里公里米岁约东西南北上下左右')
E = html.escape


def fill_template(site, meta, geo_obj):
    t = (ENGINE / 'index.html').read_text(encoding='utf-8')
    title = site.get('title', '')
    seal = site.get('seal', title[:2])
    ov = site.get('overview') or {}
    lay = site.get('layers') or {}
    rows = []
    if geo_obj['terr']: rows.append(('terr', lay.get('terr', '势力范围')))
    rows.append(('water', lay.get('water', '水系')))
    if geo_obj['walls']['features']: rows.append(('wall', lay.get('wall', '长城')))
    rep = {
        '{{PAGE_TITLE}}': E(site.get('pageTitle') or f'{title} · {site.get("subtitle", "")}'),
        '{{DESCRIPTION}}': E(site.get('description') or site.get('subtitle', '')),
        '{{SEAL}}': (f'<b class="one">{E(seal)}</b>' if len(seal) == 1 else ''.join(f'<b>{E(c)}</b>' for c in seal[:2])),
        '{{TITLE}}': E(title),
        '{{SUBTITLE}}': E(site.get('subtitle', '')),
        '{{BTN_ALL}}': E(ov.get('btn', '全部路线')),
        '{{LAYER_ROWS}}': '\n'.join(f'  <label class="tg"><input type="checkbox" data-l="{k}" checked><i></i>{E(v)}</label>' for k, v in rows),
        '{{KICKER}}': E(site.get('kicker', '')),
        '{{TITLE_N}}': f'n{len(title)}' if len(title) > 4 else '',
        '{{TITLE_SPANS}}': ''.join(f'<span>{E(c)}</span>' for c in title),
        '{{ABOUT}}': '\n'.join(f'        <h5>{E(a.get("h", ""))}</h5>\n        <p>{E(a.get("p", ""))}</p>' for a in site.get('about') or []),
    }
    for k, v in rep.items(): t = t.replace(k, v)
    if '{{' in t: die('页面模板里还有没填的 {{…}}：' + t[t.index('{{'):t.index('{{') + 30])
    return t


def font_css(chars, no_font):
    local = "@font-face{font-family:'SHS';src:local('Source Han Serif SC VF'),local('Source Han Serif SC'),local('Noto Serif CJK SC'),local('Songti SC');font-weight:200 900;font-display:swap}\n"
    if no_font: return local, '未嵌字体（--no-font）'
    src = find_font()
    if not src or not src.exists():
        return local, ('▲ 没找到思源宋体，页面会用系统宋体。想嵌字体：从 github.com/adobe-fonts/source-han-serif 下载简体可变字体 '
                       'SourceHanSerifSC-VF.ttf，放进本仓库 fonts/ 文件夹，或设环境变量 HMAP_FONT=字体路径')
    txt = ''.join(sorted(set(chars)))
    h = hashlib.sha1((txt + str(src.stat().st_size) + 'v2').encode()).hexdigest()[:16]
    cache = FONT_CACHE / f'{h}.woff2'
    if not cache.exists():
        from fontTools import subset
        t0 = time.time()
        opts = subset.Options()
        opts.flavor = 'woff2'; opts.layout_features = ['*']; opts.notdef_outline = True; opts.hinting = False
        opts.name_IDs = ['*']; opts.name_languages = ['*']
        font = subset.load_font(str(src), opts)
        sub = subset.Subsetter(opts); sub.populate(text=txt); sub.subset(font)
        FONT_CACHE.mkdir(parents=True, exist_ok=True)
        subset.save_font(font, str(cache), opts)
        msg = f'字体子集 {len(txt)} 字，{cache.stat().st_size // 1024} KB（用时 {time.time() - t0:.0f} 秒，已缓存）'
    else:
        msg = f'字体子集 {len(txt)} 字，{cache.stat().st_size // 1024} KB（用缓存）'
    import base64
    b = base64.b64encode(cache.read_bytes()).decode()
    css = "@font-face{font-family:'SHS';src:url(data:font/woff2;base64," + b + ") format('woff2');font-weight:200 900;font-style:normal;font-display:block}\n"
    return css, msg


def main(argv):
    if len(argv) < 2 or argv[1] in ('-h', '--help'): print(__doc__); return 0
    proj = Path(argv[1]).resolve()
    no_font, force_geo, allow = '--no-font' in argv, '--force-geo' in argv, '--allow-errors' in argv
    t0 = time.time()
    try:
        story = load_story(proj)
    except StoryError as e:
        die(str(e))
    rep = Report()
    check.check_story(story, rep)
    qa = proj / 'qa'
    if rep.errors and not allow:
        rep.print('故事检查'); rep.save(qa / 'check.json')
        die(f'{len(rep.errors)} 个错误，网页没有生成。照每条的「怎么改」修好，再运行：python3 {shq(SKILL / "scripts" / "build.py")} {shq(proj)}', 1)
    try:
        meta = geo.build(proj, force=force_geo)
    except StoryError as e:
        die(str(e))
    check.check_geo(story, rep, meta)
    rep.save(qa / 'check.json')
    rep.print('故事检查')
    if rep.errors and not allow:
        die(f'{len(rep.errors)} 个错误，网页没有生成。照每条的「怎么改」修好，再运行一次', 1)

    dist = proj / 'dist'
    site, NI, labels, chapters = compile_data(story)
    data_js = ('/* 由 build.py 从 story/ 生成，不要手改 */\n'
               'window.SITE=' + json.dumps(site, ensure_ascii=False, separators=(',', ':')) + ';\n'
               'window.NODE_INFO=' + json.dumps(NI, ensure_ascii=False, separators=(',', ':')) + ';\n'
               'window.LABELS=' + json.dumps(labels, ensure_ascii=False, separators=(',', ':')) + ';\n'
               'window.CHAPTERS=' + json.dumps(chapters, ensure_ascii=False, separators=(',', ':')) + ';\n')
    (dist / 'js').mkdir(parents=True, exist_ok=True)
    (dist / 'js' / 'data.js').write_text(data_js, encoding='utf-8')
    for sub in ('js/app.js', 'js/fx.js', 'js/audio.js', 'css/app.css', 'vendor/maplibre-gl.js', 'vendor/maplibre-gl.css',
                'vendor/LICENSE-maplibre.txt'):
        (dist / sub).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ENGINE / sub, dist / sub)
    geo_txt = (dist / 'data' / 'geo.js').read_text(encoding='utf-8')
    geo_obj = json.loads(geo_txt[len('window.GEO='):].rstrip().rstrip(';'))
    page = fill_template(site, meta, geo_obj)
    (dist / 'index.html').write_text(page, encoding='utf-8')
    # 字体：页面上可能出现的每个字
    chars = set(ALWAYS) | set(data_js) | set(page)
    for f in ('js/app.js', 'js/fx.js', 'css/app.css'): chars |= set((ENGINE / f).read_text(encoding='utf-8'))
    for fc in ('rivers', 'lakes', 'ancient', 'deserts', 'walls'):
        for ft in geo_obj[fc]['features']: chars |= set(str(ft['properties'].get('n', '')))
    for v in geo_obj['terr'].values():
        for ft in v['features']: chars |= set(str(ft['properties'].get('n', '')))
    chars = {c for c in chars if ord(c) >= 32}
    css, msg = font_css(chars, no_font)
    (dist / 'css').mkdir(parents=True, exist_ok=True)
    (dist / 'css' / 'font.css').write_text(css, encoding='utf-8')
    print('· ' + msg)
    size = sum(p.stat().st_size for p in dist.rglob('*') if p.is_file())
    build_info = {'time': time.strftime('%Y-%m-%d %H:%M:%S'), 'chapters': [c.get('id') for c in chapters], 'errors': len(rep.errors),
                  'warns': len(rep.warns), 'size_kb': size // 1024, 'routes_km': round(sum(m['len'] for m in meta['routes'].values()), 1)}
    save_json(qa / 'build.json', build_info)
    print(f'\n✔ 网站已生成：{dist}（{size / 1024 / 1024:.1f} MB，{len(chapters)} 章，用时 {time.time() - t0:.0f} 秒）')
    if rep.warns: print(f'▲ 还有 {len(rep.warns)} 个警告，交付前要改到 0（见上面的列表，或 {qa / "check.json"}）')
    print(f'本地预览：python3 -m http.server 8000 -d {shq(dist)}   然后打开 http://localhost:8000')
    print(f'下一步：python3 {shq(SKILL / "scripts" / "shoot.py")} {shq(proj)}    截图 + 自动查版面')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
