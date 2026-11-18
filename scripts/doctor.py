# -*- coding: utf-8 -*-
"""三维考据地图 · 环境自检

  python3 doctor.py          检查 Python 依赖、截图用的浏览器、字体、网络

每一项不通过都会给出安装命令。
"""
import importlib, sys, urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import SKILL, find_font  # noqa: E402

OK, BAD, SOFT = '✔', '✖', '▲'


def main():
    bad = 0
    print(f'Python {sys.version.split()[0]}')
    if sys.version_info < (3, 9): print(f'{BAD} 需要 Python 3.9 以上'); bad += 1
    req = SKILL / 'requirements.txt'
    for mod, pkg, use in (('numpy', 'numpy', '地理数据'), ('PIL', 'pillow', '高程瓦片、截图拼版'), ('fontTools', 'fonttools', '字体子集'),
                          ('brotli', 'brotli', 'woff2 字体压缩'), ('playwright', 'playwright', '截图查版面')):
        try:
            importlib.import_module(mod); print(f'{OK} {pkg}')
        except ImportError:
            print(f'{BAD} 缺 {pkg}（{use}）  →  python3 -m pip install -r "{req}"'); bad += 1
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            exe = Path(p.chromium.executable_path)
        print(f'{OK} 截图浏览器 Chromium' if exe.exists() else f'{BAD} 没装截图浏览器  →  python3 -m playwright install chromium')
        bad += 0 if exe.exists() else 1
    except Exception:
        pass
    font = find_font()
    if font: print(f'{OK} 字体 {font}')
    else: print(f'{SOFT} 没找到思源宋体 SourceHanSerifSC-VF.ttf，网页会用系统宋体。想嵌字体：从 github.com/adobe-fonts/source-han-serif 下载，放进 {SKILL / "fonts"}/，或设环境变量 HMAP_FONT=字体路径')
    for name, url in (('高程瓦片（AWS Terrain Tiles）', 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/0/0/0.png'),
                      ('卫星影像（Esri World Imagery）', 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/0/0/0')):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'history-map3d'}), timeout=10) as r:
                print(f'{OK} 网络 · {name}' if r.status == 200 else f'{BAD} 网络 · {name} 返回 {r.status}')
        except Exception as e:
            print(f'{BAD} 网络 · {name} 连不上（{type(e).__name__}）：geo.py 和 shoot.py 都要联网'); bad += 1
    print('\n✔ 环境就绪' if not bad else f'\n✖ {bad} 项要处理，照上面的命令装好再跑一次')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
