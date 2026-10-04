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
| 长期记忆 | ✅ 由本包的 `memory.js` 提供 `remember` / `forget` 工具 |
| 可配置称呼 | ✅ 由本包的 `nickname.js` 提供 `{{user_nickname}}` |
| 世界书 | ✅ 由本包的 `worldbook/` 提供，**数据随包发运**（61 条） |
| 表情包 | ⚠️ 需要另装 `dsh-meme` 插件才生效（见下） |
| 文件读写 / Shell / 设备控制 | ❌ **不提供**（对话模式只挂 7 个工具，实测无 `bash` / `read`） |
| 运行时上下文快照 | ✅ 开启（`includeRuntimeContext: true`，世界书依赖它） |

**这就是取舍**：人格纯度与干活能力不能兼得。本插件选择前者，并且做成**独立预设**——
你原有的工作模式不受影响，需要干活时切回去就行。

上面那些 ✅ 是本包的宿主逻辑，它们**挂在预设里**，所以只在这个模式生效，
工作模式看不到这些变量和工具。详见 [`docs/host-side.md`](./docs/host-side.md)。

## 长期记忆

这个模式能记住关于你的事，跨会话保留。

- **存在哪**：`~/.dsh/cyrene-memory.md`，纯 markdown，一行一条 `- 内容`，
  也可以自由写小标题和说明。
- **怎么记**：直接说「记住：我不喜欢被叫先生」。角色会调用 `remember` 工具写进去；
  说「忘掉……」则用 `forget` 按关键词删。
- **怎么改**：那就是个普通文本文件，随时能手改、也能整个删掉。**删了就是真忘掉** ——
  插件不会另存一份，也不会偷偷回写。
- **注入上限**：按 2000 字符、按行截断，免得记忆把对话空间吃光。

### 两个设计细节

**为什么记忆走模板变量。** 本预设是 `complete: true`，它会把全部 prompt section
换成只剩人设那一段；而变量插值发生在**人设那一段文本内部**，是这把刀砍不到的地方。
记忆和称呼都走这条路，正是因为它们必须活下来。（世界书用的是另一条通道，见下节。）

**写进记忆的内容会被当成数据，不会被当成指令执行。** 这一点实测过：模型不会因为
记忆文件里写了一句话就去执行它。但反过来，**记忆写错了也照样会被当成事实使用** ——
发现记错就用 `forget` 清掉。

## 世界书

昔涟带着一份**随包发运的世界书**：61 条设定条目，覆盖她自己、相关角色、世界观与剧情。
它不靠她去"查资料"，而是**按你这轮说的话自动挑出相关的几条**，注入进上下文。

- **数据在哪**：包内的 `worldbook/data/`。装上就有，**不需要你自备任何东西**。
- **怎么触发**：条目分两类 —— 常驻的每轮都在；其余靠触发词，命中你这句才注入。
- **上限**：每轮最多注入 8 条命中条目（常驻不占这个名额），免得一次塞太多。
- **换数据**：想用自己的世界书，在 `~/.dsh/cyrene-worldbook.json` 里写
  `{"dir": "/你的/目录"}` 覆盖。
- **关掉它**：同一个文件里写 `{"enabled": false}`。

### 它和「长期记忆」是两套东西

| | 长期记忆 | 世界书 |
| --- | --- | --- |
| 内容从哪来 | 从对话里**攒**出来的 | **预先写好**的设定 |
| 存哪 | `~/.dsh/cyrene-memory.md` | 包内 `worldbook/data/` |
| 怎么进去 | 模板变量 `{{cyrene_memory}}` | 运行时上下文快照 |
| 什么时候变 | 你让她记、或你手改 | 命中变化时 |

### 一条必须知道的依赖

世界书走 `systemPrompt.context()`，而这一项会被 `includeRuntimeContext: false`
**整体清空**。所以本预设把它设成了 `true` —— 代价是上下文里会多出两段策略文字
（文件策略、审批策略，约 400 字符，内容稳定、只落库一次）。

**如果你把它改回 `false`，世界书会静默失效** —— 不报错，只是一句话都注不进去。

### 来源与参考

世界书的**条目格式与字段语义**（触发词 / 常驻 / 内在价值 / 优先级 / 连带触发词）
来自 Cyrene-Agent 的 `src/main/rag/worldbook.ts`，**不是本项目发明的**；本项目的匹配器
是它的等效简化实现，去掉了 DMAE 激活状态机，因此 `内在价值` 不生效、`优先级` 成为主排序键。

「命中块挂在 `agent/pre-step` 上」这个**做法**参考了两个社区插件（代码一行未抄）：

- [dsh-local-vector-memory](https://github.com/liangxiaobing520/dsh-local-vector-memory)
- [dsh-universal-worldbook](https://github.com/TritiumWang/dsh-universal-worldbook)

细节见 [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) 第 1 节与第 7 节。

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
├── index.js                 宿主半体锚点（刻意不做任何运行时改动）
├── memory.js                会话级插件：长期记忆变量 + remember / forget 工具
├── nickname.js              会话级插件：称呼变量 {{user_nickname}}
├── worldbook/
│   ├── index.mjs            会话级插件：世界书注入（常驻块走 context，命中块走 pre-step）
│   ├── parse.mjs            解析 Cyrene-Agent 格式的条目（纯函数）
│   ├── match.mjs            触发词 / 常驻 / 连带匹配（纯函数）
│   ├── assemble.mjs         组装注入块（纯函数）
│   └── data/                随包发运的世界书数据（61 条，5 个文件）
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
├── tests/
│   └── worldbook.test.mjs   世界书解析 / 匹配 / 组装 / 注入层的单元测试
├── docs/
│   ├── writing-your-preset.md   怎么写自己的人设
│   ├── theme-recipe.md          复刻观感指南：插件清单 + 参数配方
│   └── host-side.md             宿主半体与会话级插件
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

**报 `unknown prompt variable "{{…}}"`** —— 预设正文引用了没有注册者的模板变量。
本包自带 `{{user_nickname}}` 与 `{{cyrene_memory}}` 的注册者；如果你自己往预设里
加了 `{{...}}`，必须同时有插件注册它。注意这个错误的形态很阴：它**不是加载失败**，
模式在选择器里看着好好的，发第一条消息才炸，之后每一轮都失败。也正因如此，
不要照搬上游 Cyrene-Agent 新版 prompts 里的模板变量。

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
