> **This project is an open-source preset plugin for DeepSeek Harness. It does NOT contain any game assets (Live2D models, artwork, audio). The bundled persona text is adapted from the open-source Cyrene-Agent project (MIT, Copyright (c) 2026 Playa). Cyrene (昔涟) and Honkai: Star Rail belong to HoYoverse/miHoYo. This is an unofficial fan tool — non-commercial use only.**

---

# dsh-cyrene-chat

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）提供一套
**「纯文本对话模式」agent 预设**：整份替换系统提示词，让模型纯以角色人格对话，
只保留联网搜索与表情包，**不挂文件 / Shell / 设备工具**。

> ⚠️ **禁止商业使用。** 本项目为非官方同人作品，与 HoYoverse / 米哈游无任何关联、
> 背书或赞助关系。角色 IP 归 HoYoverse / 米哈游所有。随包的人设文本整理自开源项目
> Cyrene-Agent（MIT，Copyright (c) 2026 Playa）。**使用前请先读
> [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)。**

## 关于随包的人设文本

`preset/agent.cordis.yml` **已包含一份可用的角色人设**，装完即可对话。它来自开源项目
[Cyrene-Agent](https://github.com/Playa-Cyrene/Cyrene-Agent)（MIT），
**并已取得原作者同意**。许可与归属细节见
[`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)。

> **授权凭据**：原作者在
> [issue #137](https://github.com/Playa-Cyrene/Cyrene-Agent/issues/137#issuecomment-5969268084)
> 公开回复同意使用，并将该 issue 以 **closed as completed** 结案（2026-10-03）。
>
> 上游本就是 MIT，本仓库已按 MIT 要求保留版权声明与许可证全文
> （[`LICENSES/Cyrene-Agent-LICENSE.txt`](./LICENSES/Cyrene-Agent-LICENSE.txt)）；
> 上述确认属礼貌性征询，不构成额外授权条件。
>
> ⚠️ **该确认明确排除 Live2D 模型**——模型需另行向模型原作者取得授权。
> 本仓库不包含任何模型或美术资源；日后若要加入，必须自行取得授权，不得援引本确认。

**你也可以完全不用它**：清空或替换 `prefix:` 里的内容即可，本插件的装配机制不依赖具体人设
（写法见 [`docs/writing-your-preset.md`](./docs/writing-your-preset.md)）。

> ⚠️ 原作者的同意覆盖的是**提示词文本**本身；**角色 IP**（昔涟及《崩坏：星穹铁道》
> 相关内容）归 HoYoverse / 米哈游所有，原作者无权代为授权，**非商业使用条款继续适用**。

本仓库**不包含**任何 Live2D 模型、立绘、美术资源或音频——这些不在随包范围内，
也不在 MIT 授权范围内。

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

### 3. （可选）换成人设

`prefix:` 里**已经是一份完整可用的昔涟人设**，装完直接就能对话，这一步可以跳过。
若想换成别的角色，照着
[`docs/writing-your-preset.md`](./docs/writing-your-preset.md) 替换即可。
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

## 推荐搭配（第三方插件，均不在本仓库内）

本插件只负责「纯对话预设」这一件事。界面美化、表情包这些能力都由**别的插件**提供——
请各自从它们的仓库安装，本仓库**不捆绑**任何第三方插件、图库或主题资源。

### 表情包

预设末尾预留了一段表情包规则，它会调用 `send_meme` 工具，
该工具由 [dsh-meme](https://github.com/yyh-001/dsh-meme)（MIT）提供：

```bash
dsh plugin --profile <你的 profile> add dsh-meme
```

**不装也能用**，只是模型没有 `send_meme` 可调，表情包规则自然不生效。
图库内图片版权归各自作者。

### 界面美化

如果你想要"桌面伴侣"那种观感，可以自行搭配以下插件（均为 MIT，各自独立维护）：

| 插件 | 作用 | 上游 |
|---|---|---|
| `dsh-dream-skin` | 皮肤 / 壁纸 / 面板透明度 | [RevolutionLA/dsh-dream-skin](https://github.com/RevolutionLA/dsh-dream-skin) |
| `dsh-ui-boost` | 主色调着色、Dock 等界面微调 | [DoshinJiu/dsh-ui-boost](https://github.com/DoshinJiu/dsh-ui-boost) |
| `dsh-anime-theme` | 随机二次元壁纸背景 | [zxr2115-1/dsh-anime-theme](https://github.com/zxr2115-1/dsh-anime-theme) |

安装方式以各自仓库的说明为准，通常是：

```bash
dsh plugin --profile <你的 profile> add <插件名>
```

**想复刻推荐观感？** 完整步骤（插件清单 + 参数配方）见
[`docs/theme-recipe.md`](./docs/theme-recipe.md)。

**注意：不要把这些插件的配置文件（`~/.dsh/` 下的 `dream-skin.json`、
`anime-theme/config.json` 等）提交到公开仓库或分享给别人**——它们含有你本机的壁纸历史、
图片数据与绝对路径，既不适合公开，换台机器也会失效。**分享参数，不分享文件。**

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
│   ├── agent.cordis.yml     完整人设 + 工具挂载（可直接用，也可替换）
│   └── preset.yml           模态元信息
├── scripts/
│   ├── install.sh           Linux / macOS
│   ├── install.ps1          Windows PowerShell
│   ├── install.bat          Windows 双击入口
│   └── install.mjs          跨平台（Node）
├── docs/
│   ├── writing-your-preset.md   怎么写自己的人设
│   ├── theme-recipe.md          复刻观感指南：插件清单 + 参数配方
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

本仓库的**代码**采用 **MIT License**，见 [`LICENSE`](./LICENSE)。

`preset/agent.cordis.yml` 内的**人设文本**来自开源项目
[Cyrene-Agent](https://github.com/Playa-Cyrene/Cyrene-Agent)
（MIT License, Copyright (c) 2026 Playa），许可证副本见
[`LICENSES/Cyrene-Agent-LICENSE.txt`](./LICENSES/Cyrene-Agent-LICENSE.txt)。

**角色 IP 声明**：Cyrene（昔涟）及《崩坏：星穹铁道》相关角色、世界观、名称与美术的
知识产权归 **HoYoverse / 米哈游** 所有，**不属于本 MIT 授权范围**。本项目为
非官方同人周边工具，与 IP 方无任何关联、背书或赞助关系。

**非商业使用条款**：因底层角色 IP 涉及米哈游同人创作规范，**本仓库中包含角色 IP 的
衍生物禁止商业使用**——包括但不限于售卖、付费社群、广告变现、打包销售。

本仓库不包含 Live2D 模型、立绘、美术资源或音频。若你要在其基础上继续创作并公开分发，
请保留本声明与许可证副本，并同样声明角色 IP 归属与禁止商业使用。完整说明见
[`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)。
