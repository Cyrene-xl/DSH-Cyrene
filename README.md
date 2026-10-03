> **This project is an open-source UI & preset skeleton for DeepSeek Harness. It does NOT contain any copyrighted game assets or character lore. Cyrene (昔涟) belongs to HoYoverse/miHoYo. Users must provide their own local preset text.**

---

# dsh-cyrene-chat

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）提供一套
**「纯文本对话模式」agent 预设骨架**：整份替换系统提示词，让模型纯以角色人格对话，
只保留联网搜索与表情包，**不挂文件 / Shell / 设备工具**。

**本仓库不含任何角色文本、游戏资源或美术资产**——`preset/` 是一份空白模板，
人设由使用者自行填入（见 [怎么写自己的人设预设](./docs/writing-your-preset.md)）。

## 它解决什么问题

在 DSH 里给模型套角色人格，常见的做法是把人设写进 `AGENTS.md` 或
`dsh-system-prompt` 的 `personaPrefix`。但那两条路都是**叠加**：

```
顺序 −1000   You are an AI agent powered by DeepSeek Harness.   ← 固定开场白，去不掉
顺序 0       你的角色人设                                        ← 你加的内容
中间        工具规范、编码代理行为准则……                        ← 一直压着角色
```

结果就是角色聊着聊着又会冒出编码代理的口气——「有什么要办的事吗」「要不要我帮你处理」，
或者拿环境描写当开场。这不是措辞问题，是**提示词分层**问题。

本插件用的是另一条路：`dsh-persona` 的 **`complete: true`**。

```yaml
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    complete: true            # 这套提示词就是全部系统提示词
    includeRuntimeContext: false
```

`complete: true` 会**遮蔽其余全部提示词段**，包括那句固定开场白和第一方工具规范。
角色人设成为唯一的系统提示词，没有竞争层。

## 安装

### 1. 装插件本体

```bash
dsh plugin --profile <你的 profile> add dsh-cyrene-chat
```

`cordis.patch.yml` 是纯 `insert` 形式，可热挂载，通常不需要重启。

### 2. 装预设（必须单独做一步）

**DSH 没有公开的 agent 预设安装 API**——`dsh-agent-presets` 只按
`~/.dsh/.agent-presets/<id>/` 目录扫描发现预设，不对外暴露写入接口。
所以预设必须拷贝到位：

```bash
# Linux / macOS
./scripts/install.sh

# Windows PowerShell
powershell -ExecutionPolicy Bypass -File scripts\install.ps1

# Windows 双击
scripts\install.bat

# 任意平台（无 shell 依赖，Node 22+）
node scripts/install.mjs
```

脚本会把 `preset/` 拷到 `~/.dsh/.agent-presets/chat/`。
如果目标已存在且内容不同，**默认拒绝覆盖**（避免抹掉你自己填的人设），
要覆盖得加 `--force` / `-Force`，会先自动备份。

`$DSH_HOME` 环境变量可覆盖默认的 `~/.dsh`。

### 3. 填入你的人设

模板里 `prefix:` 的内容是占位文本，**照着
[`docs/writing-your-preset.md`](./docs/writing-your-preset.md) 换成你自己的**。
改完直接切换模式即可，无需重装插件。

### 4. 启用

在 DSH 界面右上角的模式选择器里选 **「纯文本对话模式」**。

## 这个模式下有什么、没有什么

| | 状态 |
|---|---|
| 联网搜索 | ✅ 通过 `@deepseek-ai/dsh-tool-web`（`fetch: true`） |
| 表情包 | ⚠️ 需要另装 `dsh-meme` 插件才生效（见下） |
| 文件读写 / Shell / 设备控制 | ❌ **不提供**（`complete: true` 把工具规范一起换掉了） |
| 运行时上下文快照 | ❌ 关闭（`includeRuntimeContext: false`） |

**这就是取舍**：人格纯度与干活能力不能兼得。本插件选择前者，并且做成**独立预设**——
你原有的工作模式不受影响，需要干活时切回去就行。

## 可选依赖：表情包

预设末尾预留了一段表情包规则，它会调用 `send_meme` 工具。
该工具由第三方插件 [dsh-meme](https://github.com/yyh-001/dsh-meme)（MIT）提供：

```bash
dsh plugin --profile <你的 profile> add dsh-meme
```

**不装也能用**，只是模型没有 `send_meme` 可调，表情包规则自然不生效。
本仓库不捆绑任何表情图库——图片版权归各自作者。

## 自定义

装好之后预设就在 `~/.dsh/.agent-presets/chat/`，**直接改那两个文件即可**，
DSH 会按目录实时发现：

- `preset.yml` —— 模态名称、描述、排序（`order`）
- `agent.cordis.yml` —— 人设正文与工具挂载

改完**不用重新安装插件**。但注意：重新跑 `install.sh` 时若检测到内容不同会拒绝覆盖，
这正是为了防止你的改动被抹掉。

## 重命名

如果你希望仓库名与包名完全不带任何 IP 关联，改这几处即可：

- `package.json` 的 `name`
- `plugin.json` / `dsh.plugin.json` 的 `id` 与 `name`
- `cordis.patch.yml` 里的 `id` 与 `name`（**必须与包名一致**，否则报 `Cannot find package`）

## 目录结构

```
dsh-cyrene-chat/
├── index.js                 宿主半体（刻意不做任何运行时改动）
├── cordis.patch.yml         bundle patch：把插件挂进 loader
├── package.json             含 dsh.bundle.patch 等声明
├── plugin.json              DSH 插件清单
├── dsh.plugin.json          同上（兼容不同版本的清单名）
├── preset/
│   ├── agent.cordis.yml     人设模板 + 工具挂载（需你自己填内容）
│   └── preset.yml           模态元信息
├── scripts/
│   ├── install.sh           Linux / macOS
│   ├── install.ps1          Windows PowerShell
│   ├── install.bat          Windows 双击入口
│   └── install.mjs          跨平台（Node）
├── docs/
│   ├── writing-your-preset.md   怎么写自己的人设
│   └── why-no-host-logic.md     为什么宿主半体是空壳
├── THIRD_PARTY_NOTICES.md   授权与 IP 声明
└── LICENSE                   MIT
```

## 排查

**装了插件但模式选择器里没有新选项** —— 预设没装。跑 `scripts/install.*`，
确认 `~/.dsh/.agent-presets/chat/` 下确实有 `agent.cordis.yml` 和 `preset.yml`。

**加载报 `Cannot find package`** —— `cordis.patch.yml` 里的 `name` 必须是实际包名，
与 `package.json` 的 `name` 一致。

**选了模式但角色还是助手腔** —— 检查 `agent.cordis.yml` 里 `dsh-persona` 那条
是否还是 `complete: true`。少了这行就退化成叠加模式，固定开场白又会回来。

**想彻底卸载** —— `scripts/install.sh --uninstall` 删预设，再
`dsh plugin --profile <你的 profile> remove dsh-cyrene-chat` 删插件。

## 授权

本项目（含 `preset/` 模板文本）采用 **MIT License**，见 [`LICENSE`](./LICENSE)。

**本仓库不包含任何第三方角色文本或游戏资源。** Cyrene（昔涟）及《崩坏：星穹铁道》
相关角色与美术的知识产权归 **HoYoverse / 米哈游** 所有；本项目为非官方同人周边工具，
与 IP 方无任何关联、背书或赞助关系。

你自行填入的人设文本，其来源与授权由你自己负责——请勿把游戏内文本、
他人创作的角色卡或美术资源打包进公开发布的仓库。详见
[`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)。
