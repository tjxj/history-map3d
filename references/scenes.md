# 场景写法

场景 `scene` 是行进途中的一场演出：镜头飞到某个地点停下、缓慢环绕，屏幕上出场景卡、字幕、诗卡，地图上放特效和人物符号，配合成音效。场景写在章节 `stops` 里：

```jsonc
"stops": {
  "jiangling": {"toast": "路过时弹出的一句话"},
  "baidicheng": {"scene": { … }}
}
```

每章挑最重要的 1–3 件事写成场景，其余地点写 `toast`。

## 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `kind` | ✔ | 场景类型，见下表 |
| `kicker` | ✔ | 眉题「时间 · 地点」≤ 14，例 `"约725 · 三峡"` |
| `title` | ✔ | 场景名 ≤ 12（10 字以内最好看） |
| `at` | ✔ | 场景中心：地点键名、geo.json 山峰键名，或 `[经度, 纬度]` |
| `z` / `p` / `b` | | 镜头缩放（8–10 看清一座城到一片战场）、俯仰（50–68）、朝向（度） |
| `orbit` | | 演出期间镜头环绕的角度，例 12–20 |
| `dur` | ✔ | 时长 6–32 秒，一般 10–20 |
| `weather` | | 天气粒子，见下表 |
| `stats` | | 场景卡数字 2–4 个：`{"v": 数字, "u": 单位, "l": 说明 ≤ 12}`、`{"t": 短词 ≤ 10, "l": 说明}`，或 `{"e": 地点或山峰键名, "l": "海拔"}` 显示那里的海拔 |
| `quote` | | 引文 `{"t": 原文 ≤ 40, "s": 出处 ≤ 20}` |
| `lines` | | 字幕 3–5 句：`[[秒, "一句话 ≤ 34"], …]`，按时间排。最后一句要留够读的时间（约 8 字一秒） |
| `poem` | | 诗卡，见「诗作」 |
| `relic` | | 文物卡：site.json `relics` 的键名，或 `{"t": 名称, "d": 说明}` |
| `units` | | 人物 / 兵力符号，见「兵力」 |
| `fx` | | 特效，见「特效」 |
| `sfx` | | 音效 `[[秒, "名字"], …]`，名字见 `references/spec.md「音效」` |

演出里所有位置（`units` 的 `from` `to`，`fx` 的 `at` `to` `from`）都是相对场景中心的 `[向东公里, 向北公里]`，一般在 ±60 以内。时间都是从场景开始算的秒数。

## 场景类型

| kind | 名称 | 常见写法 |
|---|---|---|
| `poem` | 诗作 | 诗卡 + 两三句字幕交代缘由，`qin` 开场 |
| `voyage` | 舟行 | `move` 特效加 `boat: true`，`water` `wind` |
| `meet` | 相会 | 两个 `single` 符号走到一起，或一个 `pulse` |
| `vista` | 地理 / 风景 | 只用镜头、天气和 `stats` 里的海拔 |
| `event` | 事件 | `banner` 大字 + `pulse` |
| `ritual` | 典礼 | `beam` 光柱、`flags` 旗阵、`bell` |
| `battle` | 战役 | `units` 对冲 + `arrows` `clash`，见 `examples/huoqubing` |
| `surrender` | 受降 | `convert` 颜色转换、`units` 的 `surrender` |
| `cut` | 同一时刻 | 切到另一处同时发生的事 |

显示名可以在 site.json `kindNames` 里改。

## 天气与氛围

`weather`（场景）：`dust` 沙尘、`snow` 雪、`pollen` 飞絮、`heat` 热浪、`leaves` 落叶、`grass` 草屑、`embers` 火星、`rain` 雨丝、`mist` 雾团、`petals` 花瓣、`motes` 萤光微尘、`storm` 沙暴。

`atmo`（章节）：`dusk` 黄昏、`dawn` 清晨、`spring` 春、`summer` 夏、`autumn` 秋、`steppe` 草原、`night` 夜、`rain` 雨、`snow` 雪、`moon` 月夜、`mist` 雾、`blossom` 花开。

## 诗作

```jsonc
{
  "kind": "poem", "kicker": "开元十三年 · 峨眉山", "title": "峨眉山月歌",
  "at": "emei", "z": 9, "p": 60, "b": -20, "orbit": 12, "dur": 13,
  "weather": "motes",
  "poem": {"t": "峨眉山月歌", "a": "李白", "l": ["峨眉山月半轮秋，", "影入平羌江水流。", "夜发清溪向三峡，", "思君不见下渝州。"], "s": "《全唐诗》卷一六七"},
  "lines": [[0, "峨眉山头，半轮秋月。"], [4, "月影落入平羌江水。"], [9, "夜发清溪驿，向三峡而去。"]],
  "sfx": [[0.2, "qin"], [4, "water"]]
}
```

- `l` 一行一句，每句 ≤ 16 字，最多 12 句。长诗摘 4–8 句，题目后加「（节选）」。
- 诗句逐句出现，`dur` 至少 `0.4 + 句数 × 1.5 + 3` 秒。想自己定每句出现的时间，写 `"at": [秒, 秒, …]`，和诗句一一对应。
- `s` 写版本出处，诗句和 `research/sources.md` 逐字一致。

## 舟行

```jsonc
{
  "kind": "voyage", "kicker": "约725 · 三峡", "title": "出峡",
  "at": "baidicheng", "z": 9, "dur": 13,
  "stats": [{"t": "长江", "l": "水路"}],
  "quote": {"t": "夜发清溪向三峡，思君不见下渝州。", "s": "《峨眉山月歌》"},
  "lines": [[0, "从清溪驿夜发，舟行向三峡。"], [4, "巴水夹两岸青山。"], [9, "出峡之后，山随平野尽。"]],
  "fx": [{"k": "move", "at": [-16, -4], "to": [14, 5], "t0": 0.5, "t1": 12, "boat": true, "side": "gold"}],
  "sfx": [[0.2, "water"], [3, "wind"]]
}
```

小舟从 `at` 划到 `to`。方向顺着河道写：先用 `python3 scripts/geo.py near 经度 纬度` 看河在场景中心的哪一侧。

## 特效

每个特效写 `{"k": 类型, …}`。`side` 是颜色：site.json `factions` 的 `k`、`sides` 里的键，或内置的 `han` `xn` `sur` `gold` `white` `water` `earth` `steel`。

| k | 效果 | 参数 |
|---|---|---|
| `pulse` | 脉冲光圈 | `at` `t0` `t1` `side` |
| `ring` | 包围圈 | `at` `r`（半径公里）`side` `t0` `t1` |
| `beam` | 光柱 | `at` `t0` `t1`，`gold: true` 金色，`h` 高度（0.3–0.8） |
| `banner` | 大字横幅 | `at` `t0` `t`（≤ 12 字），`gold: true` 金色 |
| `label` | 一行字 | `at` `t`（≤ 14 字）`t0` `t1` `side` |
| `move` | 一人或一舟移动 | `at`（起点）`to`（终点）`t0` `t1` `side`，`boat: true` 画小舟，`label` 名签 ≤ 8 |
| `escape` | 一人逃离 | 同 `move` |
| `escort` | 沿整条路线护送 | `r`（routes.json 的路线 id）`t0` `t1` |
| `flag` | 一面旗倒下 | `at` `t0` `side` `char`（旗上一个字） |
| `flags` | 一圈旗阵 | `at` `r` `n`（面数）`t0` |
| `arrows` | 箭雨 | `from` `to` `t0` `t1` `n`（支数）`side`；`radial: 8` 从 `from` 向四周射 |
| `clash` | 交锋火花 | `at` `r` `t0` `t1`，`edge: true` 火花只在圈边 |
| `convert` | 颜色转换（受降） | `at` `to` `n` `t0` `t1` `side` |
| `storm` | 沙暴墙 | `t0` `t1` |

巡游镜头 `tour` 的 `fx` 写法相同，坐标相对镜头的 `at`。

## 兵力

`units` 是一群可以移动、交战、溃逃的粒子，每个粒子代表一队人。文人题材用 `single`（单人）就够了。

```jsonc
{"side": "gold", "shape": "single", "n": 1, "from": [-12, 0], "to": [-1, 0], "t0": 0.5, "t1": 6, "label": "李白"}
```

| 字段 | 说明 |
|---|---|
| `side` | 颜色，同特效 |
| `shape` | `wedge` 楔形冲锋、`line` 横列、`blob` 一团、`camp` 营地、`ring` 环形（`r` 半径，`square: true` 方阵）、`single` 单人 |
| `n` | 粒子数，200 以内（手机会卡）；`single` 写 1 |
| `from` / `to` / `t0` / `t1` | 从哪走到哪、开始和结束的秒数 |
| `label` | 名签 ≤ 8，`big: true` 大号 |
| `melee` | 到达后近身交战几秒 |
| `flee` / `f0` / `f1` | 溃逃终点和时间；`lead: true` 领头者慢慢退 |
| `die` | 交战中损失的比例 0–1；`cut: true` 溃逃中被斩 |
| `chase` / `c0` / `c1` | 在 c0–c1 秒内追向 `clash` 的位置 |
| `stream` / `s0` / `s1` | 在 s0–s1 秒内陆续走向 `stream` 指的位置（迁徙、投奔） |
| `surrender` / `s0` | 从 s0 秒起聚到 `surrender` 指的位置（受降） |

完整的战役写法照抄 `examples/huoqubing/story/chapters/03-e2.json`。

## 巡游镜头

序章、尾声不走路线，用 `tour` 依次飞几个镜头：

```jsonc
"tour": [
  {"at": "suiye", "z": 7, "p": 55, "b": 15, "dur": 9, "h": "碎叶 · 出生地之一说", "d": "一说生于西域碎叶城，五岁随父迁居蜀中。",
   "fx": [{"k": "pulse", "at": [0, 0], "t0": 0.5, "t1": 9, "side": "gold"}], "sfx": [[0.3, "qin"]]},
  {"at": [111.6, 32.3], "z": 5, "p": 30, "b": 0, "dur": 10, "all": true, "h": "一生行迹", "d": "全部行程约 {km:all} 公里。"}
]
```

每个镜头 6–12 秒，`h` ≤ 16，`d` ≤ 70。尾声最后一个镜头写 `"all": true`，亮出全部路线。

## 常见问题

- **镜头里看不见主体**：`z` 太大或 `at` 偏了。`z` 改到 8–9，把 `at` 写成主体所在的地点。
- **手机上卡片挡住主体**：场景卡在上方、字幕在下方，主体放在画面中部。shoot.py 报 `FOCUS_HIDDEN` 时调 `b`（换个朝向）或把 `at` 往主体方向挪几公里。
- **字幕读不完**：每句 ≤ 34 字，相邻两句间隔 3.5–5 秒；最后一句离 `dur` 至少留 3 秒。
- **想要引擎没有的效果**：先用现有特效近似，再记进 `research/engine-wishes.md`。
