# 分阶段提示词

给能力较弱、一次走不下全程的模型用（例如各家的 flash、mini 系列）。全程拆成八段，每段开一个新对话，做完一段你看过清单再发下一段。

**用法**

- 每个阶段开一个新对话：先贴「通用说明」，再贴这一阶段的提示词。
- `{人物}` 换成人名；`{仓库}` 换成本仓库的完整路径；`{项目}` 换成项目文件夹的完整路径。
- 开始前先新建项目：`python3 {仓库}/scripts/new.py {项目} {人物}`。
- 阶段 5 每章发一次，`{N}` 换成章序号。

---

## 通用说明（每个阶段开头都贴）

```text
你在做「{人物}」的三维考据地图网站：在三维地形上按时间走一遍人物一生的行程，路过关键地点时演出场景（字幕、诗卡、特效、音效）。

引擎和检查脚本已经写好，你只写数据。工具仓库（下文叫 HMAP）：{仓库}
- 数据格式：HMAP/references/spec.md；场景写法：HMAP/references/scenes.md
- 考据规矩：HMAP/references/research.md；看图清单：HMAP/references/review.md
- 范例：文人题材照 HMAP/examples/libai/，武将题材照 HMAP/examples/huoqubing/
- 你的项目：{项目}/research/ 放考据，{项目}/story/ 放数据，网站生成在 {项目}/dist/

常用命令（路径有空格就加引号）：
阶段验收      python3 HMAP/scripts/check.py {项目} --stage 阶段号
构建 + 检查   python3 HMAP/scripts/build.py {项目}
截图查版面    python3 HMAP/scripts/shoot.py {项目}
核对坐标      python3 HMAP/scripts/geo.py near 经度 纬度
查范围内的河  python3 HMAP/scripts/geo.py rivers 西,南,东,北
看一条路线    python3 HMAP/scripts/geo.py route {项目} 路线id

规矩：
1. 只改 {项目} 里的文件，HMAP 里的东西不许动。引擎做不到的效果，先用现有写法近似，再记进 {项目}/research/engine-wishes.md。
2. 每条报警都带「怎么改」，照着改，改完再跑一次。
3. 事实只用 research/ 里记了出处的。查不到就标「约」「一说」，或者不写，绝不编。数字先记进 research/facts.md 再上网页。
4. 文字用中文短句，写具体事实，不用浮夸词。禁用的句式和词 check.py 会报出来，照改。
5. 做完本阶段就停，交一份清单：改了哪些文件，还有哪些拿不准。
```

## 阶段 1 · 资料整理

```text
阶段 1：资料整理。只写 {项目}/research/，先不碰 story/。
资料优先用我给的：{资料路径，没有就删掉这句}。要联网查的，原文以维基文库、ctext.org 为准。

模板已经在 research/ 里，照 HMAP/examples/libai/research/ 的格式填满五个文件：
1. chronology.md 生平年表：开头先列书目；每行公元年、年龄、在哪（古地名 + 今地）、做了什么、出处
2. places.md 地点考据：键名（拼音）、古地名、今地、坐标 [经度, 纬度]（两位小数）、依据、把握（确定 / 约 / 一说）
3. facts.md 数字台账：网页上要用的每个数字，写阿拉伯数字 + 原文 + 出处；推算出来的写「推算」和算法
4. sources.md 原文摘录：要上网页的诗文、史传原文，注明版本和卷次，逐字照抄
5. debates.md 争议：年份、地点、行程有异说的，列出各说和依据

只收能落到具体地点的事。每个坐标跑 geo.py near 核对。
完成标准：check.py --stage 1 通过。
```

## 阶段 2 · 章节大纲

```text
阶段 2：章节大纲。读 research/，填写 research/outline.md，先不碰 story/。格式照 HMAP/examples/libai/research/outline.md。

全站：大标题（2–8 字）、开场题句（原文 + 出处）、开场数字 3–5 个（都在 facts.md 里）。
分 5–9 章：序章（时代与出身）+ 若干段行程 + 尾声。每章写：
- 文件名（如 03-shu.json）、英文 id、章号（序 壹 贰 叁 … 终）、章标题（≤ 5 字）、副标题、年份、年龄、身份、主色（相邻两章不同色）
- 路线：按先后列 places.md 里的地点，注明陆路还是水路（沿哪条河）
- 场景 1–3 个：在哪个地点、类型（poem 诗作 / voyage 舟行 / vista 风景 / meet 相会 / event 事件 / ritual 典礼 / battle 战役）、演什么、用哪句原文或哪首诗
- 其余路过的地点各写一句提示

完成标准：check.py --stage 2 通过；每个场景都有出处，没有出处的事不进大纲。
```

## 阶段 3 · 地理数据

```text
阶段 3：地理数据。照 HMAP/references/spec.md 写 {项目}/story/ 下这五个文件（模板已在，换掉 TODO 和示例地点）：
- site.json 先填 title、subtitle、span、seal、hero、factions（第一个是主角一方，第二个是对方）
- places.json：大纲里用到的每个地点。键名用 places.md 的拼音键名，n 古地名（≤ 10 字），d 今地（≤ 20 字），ll [经度, 纬度]
- routes.json：每段行程一条路线。via 按先后写地点键名；陆路在河谷、垭口加 [经度, 纬度] 拐点，别让线横穿山脊；水路写 {"river": "河名"}，沿河走到下一个点。同一章里前一条路线的终点要是后一条的起点
- labels.json：地图大字 15–40 条（大区域、山、水、古城）
- geo.json：默认写法就能用

chapters/ 里的模板章节到阶段 4 再改，这一阶段的验收不查它们。
用 geo.py 核对：
- 每条路线跑 geo.py route，看长度和最高海拔，翻山不合常理就加拐点
- 河名用 geo.py rivers 查「中文名」那一列；报「不连通」就在断口两侧各加一个点
完成标准：check.py --stage 3 通过；每条路线的长度和史料里的里程大致对得上。
```

## 阶段 4 · 章节骨架

```text
阶段 4：章节骨架。按 outline.md 写 story/chapters/ 下的全部章节，先求跑通，内容留到阶段 5。
- 序章、尾声用 tour 巡游镜头（照模板的 01-prologue.json、03-epilogue.json）；尾声永远是最后一个文件，最后一个镜头加 "all": true
- 中间每章照模板的 02-c1.json，复制成 02-xxx.json、03-xxx.json ……先写 id、y、num、title、sub、era、year、age、rank、color、atmo、view、lead、track；stops 里每个地点先写一句 toast
- site.json 其余字段照 spec.md「site.json」补全（overview、introStats、words、cues、about、credits 等）。用古里就查清一里合多少公里、记进 facts.md
- 范例的题材专用内容不要带过来：文物 relics、图例 legend、古湖、长城
完成标准：build.py 0 错误（警告留到阶段 5 清）。
```

## 阶段 5 · 逐章充实（每章发一次）

```text
阶段 5：充实第 {N} 章，只改这一章的文件（数字台账 research/facts.md 可以补）。
1. 补齐 kpis 数字卡 2–4 个、story 经过 2–4 段、timeline、sources 原文 2 条以上、variants 异文（没有就写 []）、debates 考据、people 人物。数字和原文都要在 research/ 里找得到
2. 按大纲写 1–3 个场景，放进 stops 里对应地点的 scene，写法见 HMAP/references/scenes.md（诗卡、舟行、相会、战役都有例子）
3. 跑 build.py，把这一章的报警清到 0
完成标准：0 错误，警告里没有这一章的。
```

## 阶段 6 · 截图查版面

```text
阶段 6：截图查版面。
1. 跑 shoot.py（要联网，约 3–5 分钟；命令有时间上限就分两次跑：加 --only desktop、--only mobile）
2. 照 qa/shots.json 每条的「怎么改」修，再 build.py → shoot.py（只拍改过的章：加 --ch 章序号），直到 0 错误 0 警告
3. 照 HMAP/references/review.md 逐张看 qa/sheet-*.png：卡片和字幕有没有挡住主体；路线有没有横穿山脊或海面；地名有没有叠在一起；手机上有没有字被截断
完成标准：0 错误 0 警告，拼版图看过，列出改了什么。
```

## 阶段 7 · 通读审校

```text
阶段 7：通读审校。只改文字和数据，不加新内容。逐章对照 research/：
- 每个数字、年份、年龄都能在 facts.md、chronology.md 找到；年龄全站统一用虚岁或周岁
- 每句引文、每首诗和 sources.md 的版本逐字一致
- 地名用当时的叫法，今地写进 d；同一地点全站写法一致
- 有异说的地方，网页上标了「约」「一说」，debates 里列了各说
- 语气平实，没有浮夸词
改完 build.py 0 错误 0 警告。交一份审校记录：改了什么，还有什么拿不准。
```

## 阶段 8 · 部署（等你确认）

```text
阶段 8：部署。先停下来问我两件事：域名、托管平台（Cloudflare、GitHub Pages、Netlify 等）。我回复确认后再动手：
1. 跑 build.py，确认 0 错误 0 警告
2. 用 Cloudflare 时，在 {项目} 写 wrangler.jsonc：
   {"name": "项目名", "compatibility_date": "2026-11-01", "assets": {"directory": "./dist"}, "routes": [{"pattern": "域名", "custom_domain": true}], "workers_dev": false, "preview_urls": false}
   然后在 {项目} 里运行 npx wrangler deploy；别的平台把 {项目}/dist/ 整个文件夹传上去
3. 打开线上地址，看首页、任意一章、手机宽度
```
