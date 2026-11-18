# -*- coding: utf-8 -*-
"""新建一个人物项目

  python3 new.py <项目目录> <人物名> [--seal 印章] [--flag 旗字]

例：python3 scripts/new.py ~/maps/sushi 苏轼 --seal 东坡

把 templates/starter 复制到项目目录：story/ 是能跑通的数据模板（带注释），research/ 是考据模板。
模板里的 {{NAME}} {{SEAL}} {{FLAG}} 会换成人名；印章默认取名字最后一个字，旗字默认取姓。
下一步照 SKILL.md 从阶段 1（资料整理）做起。
"""
import shutil, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import SKILL, die, shq  # noqa: E402


def main(argv):
    if len(argv) < 2 or argv[0] in ('-h', '--help'): print(__doc__); return 0
    opts = {}
    for k in ('--seal', '--flag'):
        if k in argv:
            i = argv.index(k)
            if i + 1 >= len(argv): die(f'{k} 后面要写字')
            opts[k] = argv[i + 1]; del argv[i:i + 2]
    proj, name = Path(argv[0]).expanduser().resolve(), argv[1].strip()
    if not name: die('人物名不能是空的')
    if proj.exists() and any(proj.iterdir()): die(f'{proj} 已经有文件了。换一个新目录，或者先把它清空')
    seal, flag = opts.get('--seal', name[-1]), opts.get('--flag', name[0])
    if len(seal) > 2: die('印章最多 2 个字，例如 --seal 东坡')
    src = SKILL / 'templates' / 'starter'
    shutil.copytree(src, proj, dirs_exist_ok=True)
    for f in proj.rglob('*'):
        if f.is_file() and f.suffix in ('.json', '.md'):
            t = f.read_text(encoding='utf-8')
            f.write_text(t.replace('{{NAME}}', name).replace('{{SEAL}}', seal).replace('{{FLAG}}', flag[:1]), encoding='utf-8')
    (proj / '.gitignore').write_text('dist/\nqa/\n.wrangler/\n', encoding='utf-8')
    sc = SKILL / 'scripts'
    print(f'✔ 已新建 {name} 的项目：{proj}')
    print('  story/     数据模板（JSONC，带注释，能直接构建）')
    print('  research/  考据模板（阶段 1、2 填写）')
    print('\n下一步：照 SKILL.md 从阶段 1 做起。每个阶段做完跑一次验收：')
    print(f'  python3 {shq(sc / "check.py")} {shq(proj)} --stage 1')
    print('模板本身就能构建（0 错误，TODO 会报成警告），想先看看效果：')
    print(f'  python3 {shq(sc / "build.py")} {shq(proj)} --no-font')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
