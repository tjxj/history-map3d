# 给编程 Agent 的说明

这个仓库能把一个历史人物的一生做成三维考据地图网站。用户在这里打开你（Codex、Cursor、Gemini CLI、Claude Code 等任何能读文件、跑命令的 agent），说一个人名，例如「做苏轼」「给我做一个王阳明的三维考据地图」，你就照 [SKILL.md](SKILL.md) 的八个阶段做。

在这个仓库里工作时：

- `$HMAP` 就是仓库根目录。
- 新项目放在 `projects/<人名拼音>/`（这个文件夹不进 git）：

  ```bash
  python3 scripts/new.py projects/sushi 苏轼 --seal 东坡
  ```

- 只改 `projects/` 里的文件。`engine/`、`scripts/`、`templates/`、`examples/`、`references/` 是工具本身，用户没要求就不改。
- 每个阶段的验收命令、写法规矩、交付内容都在 SKILL.md。
- 数据格式见 `references/spec.md`，场景写法见 `references/scenes.md`，考据规矩见 `references/research.md`，看图清单见 `references/review.md`。
- 部署是对外发布，先问用户域名和托管平台，得到确认再动手。

能力较弱的模型一次走不下全程时，用 [prompts/stages.md](prompts/stages.md) 分阶段做：每个阶段开一个新对话。
