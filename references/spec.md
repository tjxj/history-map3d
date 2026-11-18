# 数据格式

一个项目就是一个文件夹，`scripts/new.py` 会生成它：

```text
<项目>/
├── research/            考据笔记（Markdown），见 references/research.md
│   ├── chronology.md    生平年表
│   ├── places.md        地点考据
│   ├── facts.md         考据台账：网页上每个数字的出处
│   ├── sources.md       原文摘录
│   ├── debates.md       争议
│   └── outline.md       章节大纲
├── story/               网页数据（JSONC：可以写 // 注释，末尾可以多一个逗号）
│   ├── site.json        全站设置
│   ├── places.json      地点
│   ├── routes.json      路线
│   ├── labels.json      地图大字
│   ├── geo.json         底图参数
│   └── chapters/        每章一个文件：01-prologue.json、02-xxx.json …… 按文件名排序
├── dist/                build.py 生成的网页（静态文件，直接部署）
└── qa/                  check.json、shots.json、截图
```

通用规则：

- 键名（地点、路线、章节 id、势力 k）只用英文字母开头，后面跟字母、数字、下划线。地点键名用拼音，例如 `jiangling`。
- 坐标一律 `[经度, 纬度]`，经度在前。东经、北纬为正，查到小数点后两位（约 1 公里）。
- 以 `_` 开头的键会被忽略，可以拿来写备注：`"_说明": "……"`。
- 字数按版面算：汉字算 1，字母数字算 0.55。超过上限 check.py 会报 `LONG_TEXT`。下文 `≤ N` 都是这个意思。
- 文字里可以写 `{km:甲>乙}`，网页上换成甲、乙两点之间沿路线的公里数（两点都要在本章路线上）；`{li:甲>乙}` 换成古里（要先在 site.json 写 `li`）；`{km:all}` 是全部路线的总长，只有它能用在 site.json 和序章、尾声里。

## site.json

| 字段 | 必填 | 说明 |
|---|---|---|
| `title` | ✔ | 开场大字，2–8 个字 |
| `subtitle` | ✔ | 开场副标题，一行 |
| `span` | ✔ | 生卒年，例 `"701 — 762"` |
| `motto` / `mottoSrc` | | 开场题句（原文）和出处《书名·篇名》 |
| `seal` | ✔ | 左上角印章，1–2 个字 |
| `kicker` | ✔ | 开场小字，例 `"旧唐书 · 李白传"` |
| `pageTitle` / `description` | ✔ | 浏览器标题、分享卡片说明 |
| `hero` | ✔ | `{"name": 行进标记名字, "flag": 旗上一个字, "legend": 图例文字}` |
| `factions` | ✔ | 势力，至少两个：`{"k": 键, "n": 名称, "c": 主色, "glow": 光晕色}`。第一个是主角一方。演出里的 `side`、人物的 `side` 都写这里的 `k` |
| `words` | | 界面用词：`go` 行进按钮、`story` 经过页、`tour` 巡游、`rank` 身份栏、`dash` 虚线路线、`tabReport` `tabSources` `tabDebates` `tabPeople` 资料面板四个标签 |
| `sideNames` | | 支线四种类型的显示名：`ally` `enemy` `lost` `flow` |
| `sideColors` | | 支线颜色，例 `{"ally": "#ffd9a0"}` |
| `kindNames` | | 场景类型的显示名，例 `{"meet": "相会"}`。不写用默认 |
| `overview` | | 「全部路线」总览页：`num` `title` `sub` `span` `lead` `list` `col` `btn` |
| `overviewChapter` | | 总览页借用哪一章的镜头，默认最后一章 |
| `introStats` | | 开场数字 3–5 个：`{"v": 数字, "u": 单位, "l": 说明}`；`"v": "km"` 自动算全部路线公里数 |
| `li` | | 古里折算：`{"name": "唐里", "km": 0.53}`。汉里约 0.416，唐里约 0.53，宋里约 0.56，明清里约 0.576 公里 |
| `variants` | | 异文对照表的表头：`{"t": "两书异文", "a": "史记", "b": "汉书"}` |
| `cues` | | 音效：进入章节 `chapter`、看全部路线 `all`、章末 `end`，每项是 `[[秒, "音效名"], …]` |
| `layers` | | 图层面板里的名字：`{"water": "水系 · 湖泊", "terr": "势力范围", "wall": "长城"}` |
| `legend` | | 图例文字：`{"walls": "长城", "ancient": "古湖（复原）"}` |
| `sides` | | 演出用的自定义颜色：`{"tang": "#d0523a"}`，之后 `side` 可以写 `tang` |
| `peopleGroups` | | 人物页的分组：`[{"k": "me", "n": "师友"}, …]`，不写就按 `factions` 分 |
| `mainTags` | | 考据候选说法里哪些 `tag` 算主线，默认 `["主流", "本图主线", "可考", "通说"]` |
| `pulseSide` | | 地图上提示光圈的颜色键 |
| `terrDefault` / `terrAll` | | 默认疆域、总览页疆域，写 geo.json `terr` 的键名 |
| `relics` | | 文物卡：`{"jian": {"t": 名称 ≤ 12, "d": 说明 ≤ 60}}`，场景里写 `"relic": "jian"` |
| `globe` | | 开场地球的中心和缩放 `{"c": [经度, 纬度], "z": 1.8}`，不写自动算 |
| `about` | ✔ | 「关于本图」，每段 `{"h": 小标题, "p": 正文}`，写三段：史料、路线、演出 |
| `credits` | | 数据来源，一行一条 |

### 音效

`cues`、场景和巡游镜头的 `sfx` 都写 `[秒, "名字"]`。音效全部由 Web Audio 实时合成，没有音频文件。

| 名字 | 声音 | 名字 | 声音 |
|---|---|---|---|
| `qin` | 古琴一句 | `bell` | 钟 |
| `xun` | 埙 | `wind` | 风 |
| `water` | 水声 | `storm` | 风暴 |
| `whoosh` | 转场呼声 | `tick` | 轻响 |
| `drum` | 单鼓 | `drums` | 鼓阵 |
| `horn` | 号角 | `gallop` | 马蹄，可写 `gallop:4.4` 持续 4.4 秒 |
| `clash` | 兵刃 | `arrows` | 箭雨 |
| `roar` | 呐喊 | `sting` | 短促的惊音 |

文人题材常用 `qin` `bell` `water` `wind` `xun`，战争题材常用 `drums` `horn` `gallop` `clash` `arrows` `roar`。

## places.json

```jsonc
{
  "jiangling": {"n": "江陵", "d": "今湖北荆州", "ll": [112.24, 30.35]},
  "emei": {"n": "峨眉山", "d": "今四川峨眉山市", "ll": [103.33, 29.52], "conf": "约"}
}
```

| 字段 | 说明 |
|---|---|
| `n` | 古地名 ≤ 10 |
| `d` | 今地 ≤ 20 |
| `ll` | 坐标 `[经度, 纬度]` |
| `peak` | 取山顶：写 geo.json `peaks` 的键名，或写范围 `[西, 南, 东, 北]` 自动找最高点 |
| `snap` | 吸附到河岸或湖岸：`{"river": "长江", "near": [经度, 纬度]}`、`{"lake": "洞庭湖", "near": […]}` |
| `src` / `conf` / `now` | 备注：依据、把握（确定 / 约 / 一说）、今名，引擎不显示 |

## routes.json

```jsonc
{
  "shu_chu": {"via": ["chengdu", [105.05, 29.58], "yuzhou", {"river": "长江"}, "jiangling"]}
}
```

`via` 按先后写，三种写法：

- 地点键名：经停点，停靠点 `stops` 和里程 `{km:…}` 都挂在这上面。主线路线的第一个和最后一个点必须是键名。
- `[经度, 纬度]`：拐点。陆路在河谷、垭口加拐点，别让线横穿山脊。
- `{"river": "河名"}`：从前一个点沿这条河走到后一个点。河名用 `python3 scripts/geo.py rivers 西,南,东,北` 查到的中文名。Natural Earth 的河道有断开的地方，报「不连通」就在断口两侧各加一个点，或改走陆路拐点。

可选：`"step": 2`（重采样间距，公里）、`"smooth": false`（不做曲线平滑）、`"note": "备注"`。

同一章里，前一条路线的终点要是后一条的起点，否则行进标记会瞬移。

## labels.json

地图上的大字，15–40 条：

```jsonc
[
  {"t": "region", "n": "巴蜀", "ll": [104.5, 30.2], "z": 3.5},
  {"t": "mount", "n": "巫山", "ll": [109.9, 31.1], "z": 6},
  {"t": "city", "n": "长安", "ll": [108.94, 34.27], "z": 5, "s": "今西安"}
]
```

| 字段 | 说明 |
|---|---|
| `t` | 类型：`region` 大区域、`people` 部族 / 势力、`mount` 山、`water` 水、`desert` 沙漠、`city` 古城、`modern` 今地名 |
| `n` | 文字 ≤ 8 |
| `ll` | 坐标 |
| `z` | 从多大缩放开始显示：大区域 3–4，山水 5–6，城市 6–7 |
| `s` | 副标题 ≤ 14 |
| `big` | 写 `true` 用大号字 |
| `node` | 某个地点键名：这个地点的航点出现时隐藏这条注记，避免叠字 |

## geo.json

默认写法够用：

```jsonc
{"rivers": {"ne": "auto", "maxScalerank": 6, "rdp": 0.006}, "lakes": {"maxScalerank": 8}}
```

| 字段 | 说明 |
|---|---|
| `bbox` | 地图范围 `[西, 南, 东, 北]`，不写按全部地点自动算 |
| `rivers.ne` | `"auto"` 自动画范围内的河，用 Natural Earth 自带中文名；或写 `{"英文名": "图上中文名"}` 自己挑 |
| `rivers.maxScalerank` | `auto` 时画到几级河：6 只画大河，8 画到较大的支流 |
| `rivers.hand` | 手画古河道：`[{"n": "弱水", "r": 5, "c": [[经度, 纬度], …]}]` |
| `lakes` | `{"maxScalerank": 8, "names": {"原名": "改名"}}`；写 `false` 不画湖 |
| `ancient` | 古湖示意（椭圆）：`[{"n": "居延泽（示意）", "c": [经度, 纬度], "rx": 0.24, "ry": 0.13, "rot": 0.35}]` |
| `deserts` | 沙漠：`{"ne": {"GOBI DESERT": "大漠"}, "ellipses": [ … ]}` |
| `terr` | 历史疆域：`{"b1": {"file": "geo/xxx.geojson", "prop": "title", "map": {"汉": "han", "匈奴": "xn"}}}`。先用 `geo.py inspect 文件 属性名` 看真实取值 |
| `walls` | 长城、直道：`[{"n": "秦长城（示意）", "k": "wall", "c": [[经度, 纬度], …]}]` |
| `peaks` | 山峰：`{"qilian": [西, 南, 东, 北]}`，自动找范围内最高点，地点和场景数字 `e` 可以引用 |

长城、古湖、古河道的完整写法见 `examples/huoqubing/story/geo.json`。疆域要自备 GeoJSON（多边形，属性里有势力名），先确认数据许可允许再分发。

## 章节

每章一个文件，文件名前两位数字决定顺序。序章、尾声写 `tour`（巡游镜头），中间各章写 `track`（走路线）。

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✔ | 英文键，各章不同 |
| `y` | | 这一章开始的公元年份（公元前写负数），只用来检查章节顺序 |
| `num` | ✔ | 章号 ≤ 2：序 壹 贰 叁 … 终 |
| `title` / `sub` | ✔ | 章标题 ≤ 6（5 字以内最好看）、副标题 ≤ 24 |
| `era` / `year` / `age` / `rank` | | 年号 ≤ 12、年份 ≤ 14、年龄 ≤ 6、身份 ≤ 16（有变化写「甲 → 乙」） |
| `color` | ✔ | 章节主色 `#rrggbb`，相邻两章换不同颜色 |
| `atmo` | | 氛围：`dusk` `dawn` `spring` `summer` `autumn` `steppe` `night` `rain` `snow` `moon` `mist` `blossom` |
| `view` | ✔ | 开场镜头 `{"c": [经度, 纬度], "z": 5.4, "p": 50, "b": 0}`：z 缩放（4 看几省，6 看一城），p 俯仰 0–75，b 朝向 |
| `lead` | ✔ | 导语 ≤ 70 |
| `kpis` | | 数字卡 2–4 个：`{"v": 数字, "u": 单位 ≤ 2, "l": 说明 ≤ 12, "s": 出处 ≤ 14}` |
| `story` | | 「经过」段落 2–4 段，每段 ≤ 140 |
| `timeline` | | `{"t": 时间 ≤ 6, "h": 标题 ≤ 14, "d": 一句话 ≤ 36, "at": 地点}`，点击后地图飞过去 |
| `sources` | | 史料原文：`{"s": "《书名·篇名》" ≤ 18, "t": 原文 ≤ 140}`，每章至少 2 条 |
| `variants` | | 异文：`{"k": 条目 ≤ 6, "a": 甲本 ≤ 32, "b": 乙本 ≤ 32, "h": 按语 ≤ 60}`，没有写 `[]` |
| `debates` | | 考据：`{"t": 问题 ≤ 16, "q": 说明 ≤ 110, "opts": [{"n": 说法 ≤ 16, "tag": "主流", "at": 地点, "d": 依据 ≤ 40}]}` |
| `people` | | 人物：`{"n": 名字, "side": 分组键, "r": 身份, "d": 一句话 ≤ 40}` |
| `track` | | 路线段：`{"r": 路线id, "v": 速度, "cap": 一句话 ≤ 30, "who": 行进标记名 ≤ 16, "dash": true}`。v 是播放倍速：几十公里 0.6–1.2，几百公里 1.5–3，上千公里 3–5；`dash` 画成虚线（返程、推测的路） |
| `stops` | | 停靠点：`{"地点键名": {"toast": 一句话 ≤ 44}}` 或 `{"地点键名": {"scene": {…}}}`，地点必须在本章路线的 via 里。同一地点在本章路线里出现两次时写 `键名@2`（第 2 段路线上的那次） |
| `side` | | 支线：`{"r": 路线id, "k": "ally", "from": 主线地点, "to": 主线地点, "who": 名字}`，k 是 `ally` 同行、`enemy` 对手、`lost` 失道、`flow` 迁徙 |
| `sideStops` | | 支线上的停靠点，写法同 `stops` |
| `tour` | | 巡游镜头：`{"at": 地点, "z": 7.5, "p": 55, "b": 15, "dur": 9, "h": 小标题 ≤ 16, "d": 说明 ≤ 70, "fx": […], "sfx": […], "route": 路线id, "all": true}`。`route` 亮出某条路线，`all` 亮出全部路线（放在尾声最后一个镜头） |
| `cue` | | 本章开场音效，覆盖 site.json `cues.chapter` |
| `terr` | | 本章显示哪个疆域（geo.json `terr` 的键名） |

场景 `scene` 的写法见 `references/scenes.md`。
