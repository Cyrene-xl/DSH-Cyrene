> **This project is an open-source preset plugin for DeepSeek Harness. It does NOT contain any game assets (Live2D models, artwork, audio). The bundled persona text is adapted from the open-source Cyrene-Agent project (MIT, Copyright (c) 2026 Playa). Cyrene (昔涟) and Honkai: Star Rail belong to HoYoverse/miHoYo. This is an unofficial fan tool — non-commercial use only.**

---

# dsh-cyrene

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）提供**两套角色 agent 预设**：

| 预设 | 显示名 | 能力 |
|---|---|---|
| `preset/chat/` | **纯文本对话模式** | 整份替换系统提示词，纯以角色人格对话；只保留联网搜索与表情包，**不挂文件 / Shell / 设备工具** |
| `preset/cyrene-work/` | **昔涟工作模式** | 同样用角色人设整份替换系统提示词，但**带全套工具**（文件 / Shell / 计划 / 目标 / 子代理 / workflow）；干活时也保持她的身份与说话方式 |

两者共享同一份长期记忆（`<DSH_HOME>/cyrene-memory.md`），所以同一个角色在两个模式里的记忆是连续的。

> ⚠️ **禁止商业使用。** 本项目为非官方同人作品，与 HoYoverse / 米哈游无任何关联、
> 背书或赞助关系。角色 IP 归 HoYoverse / 米哈游所有。随包的人设文本整理自开源项目
> Cyrene-Agent（MIT，Copyright (c) 2026 Playa）。**使用前请先读
> [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)。**

## 关于随包的人设文本

两套预设都**已包含可用的角色人设**，装完即可对话。人设文本来自开源项目
[Cyrene-Agent](https://github.com/Playa-Cyrene/Cyrene-Agent)（MIT），
**并已取得原作者同意**。许可与归属细节见
[`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)。

> **两套预设用的是上游不同的提示词组**，这不是随意挑的：上游 `mode-prompt-profile.ts`
> 把各模式拆成不同文件——对话模式用 `chat_system` + `chat_identity` + `soul` + `canon_quotes`，
> 工作模式用 `work_system` + `work_identity` + `work_remark` + `canon_quotes_lite`，
> 通用工具规范另接 `tool_usage`（且**只在非对话模式**接）。本仓库照搬这套组合，一字未改。
>
> ⚠️ 注意上游在**工作模式里刻意不用 `soul.md`**，改用精简台词集 —— 也就是说原应用的
> "工作模式人设"本来就是**轻量版**。觉得干活时不够像角色，第一个该调的是这里
> （把 `soul.md` 加回去），不是本插件的装配机制。

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
dsh plugin --profile <你的 profile> add dsh-cyrene
```

`cordis.patch.yml` 是纯 `insert` 形式，可热挂载，通常不需要重启。

### 2. 装预设（必须单独做一步）

**DSH 没有公开的 agent 预设安装 API**——`dsh-agent-presets` 只按
`~/.dsh/.agent-presets/<id>/` 目录扫描发现预设，不对外暴露写入接口。
所以预设必须拷贝到位：

```bash
# Linux / macOS
./scripts/install.sh

# 任意平台（含 Windows，无 shell 依赖，Node 22+）
node scripts/install.mjs
```

> ### 为什么没有 Windows 专用脚本
>
> 以前有 `scripts/install.ps1` 和 `install.bat`，**已经删掉了**。
>
> 原因很直接：**我没有自己的电脑，这一整套是在 DSH App（Android）里做的** ——
> 开发环境里没有 Windows、也没有 PowerShell，那两个脚本我**根本没法实测**，
> 只能靠用户反馈来回试，连试三轮都没在真机上跑通。
>
> 与其留一条**没人能验证**的路，不如只留一条能跑通的。Windows 用户请直接用
> `node scripts/install.mjs` —— 跨平台、无 shell 依赖，已实测过安装 / 幂等 / 卸载。
>
> **要是它在你的 Windows 上不适配**：那大概率得等我以后有了自己的电脑，
> 才能把那部分补回来重做一遍。在那之前上面这条 `install.mjs` 就是 Windows 的路。
> **完整的 Windows 说明（怎么装、六条实测坑、将来怎么恢复 PS 脚本）见
> [`docs/windows.md`](./docs/windows.md)。**

脚本会把 `preset/` 下的**每个子目录**装成对应的预设：
`preset/chat/` → `~/.dsh/.agent-presets/chat/`，
`preset/cyrene-work/` → `~/.dsh/.agent-presets/cyrene-work/`。

> ### ⚠️ DSH 0.2.0 及以上：上面这一步**不会生效**（而且不报错）
>
> 0.2.0 起预设改为**声明式注册表**，官方文档原话是「注册表不扫描目录，也不接受
> preset 路径」。此时 `scripts/install.*` 依然会成功执行、依然打印"已安装"，
> 但预设**不会出现在界面上**，也没有任何报错。
>
> 这一代的正确做法是声明：
>
> ```bash
> node scripts/export-preset-declarations.mjs --out=preset-declarations.yml
> ```
>
> 生成的内容贴进 `<DSH_HOME>/profiles/<你的 profile>/cordis.patch.yml`。
> 那个文件顶层是一个数组，把生成的内容**作为一个新元素追加进去**即可。
>
> ⚠️ 生成的内容**自带 `- insert:` 那一层，别把它去掉**。patch 数组里的条目分两种：
> 带 `insert` 的是"插入新行"，不带 `insert` 而带 `id` 的是"**按 id 覆盖一个已有条目**"。
> 少了 `insert`，我们的声明会被当成后者 —— 而那个 preset id 并不存在，于是被
> **静默跳过**：文件看着改了，模式却不会出现，且没有任何报错。
>
> **怎么判断自己是哪一代？** 界面里模式选择器没出现本项目的两个模式、
> 但目录确实装好了 —— 那就是 0.2.0+，用上面的声明方式。

预设 id 是**自动发现**的（扫描含 `agent.cordis.yml` 的子目录），所以以后新增预设
只要在 `preset/` 下新建目录，四个安装脚本都不用改。

如果目标已存在且内容不同，**默认拒绝覆盖**（避免抹掉你自己填的人设），
要覆盖得加 `--force` / `-Force`，会先自动备份。

`$DSH_HOME` 环境变量可覆盖默认的 `~/.dsh`。

### 3. （可选）换成人设

`prefix:` 里**已经是一份完整可用的昔涟人设**，装完直接就能对话，这一步可以跳过。
若想换成别的角色，照着
[`docs/writing-your-preset.md`](./docs/writing-your-preset.md) 替换即可。
改完直接切换模式即可，无需重装插件。

### 4. 启用

**新建对话**时选其中一个模式：

- **「纯文本对话模式」** —— 只聊天，不挂编码 / Shell / 设备工具
- **「昔涟工作模式」** —— 同上人设，但带全套工具，能真正干活

> ⚠️ DSH 的规则是**会话一旦说过话，预设就锁死**（服务端报 `agent-preset/locked`）。
> 所以模式要**在新建对话时就选好**；已经聊过的会话改不了，只能再开一个。
> 新建对话页的滑块只在空白会话出现，正是因为这个。

## 两个模式各有什么、没有什么

两套预设的差别**不只是工具多少**，人设正文也取自上游不同的模式组（见
[`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)）。逐项对照：

| 能力 | 纯文本对话模式 | 昔涟工作模式 |
|---|---|---|
| 人设正文 | `chat` 组（含 `soul.md`） | `work` 组（**轻量版**，上游不含 `soul.md`） |
| 联网搜索 | ✅ `@deepseek-ai/dsh-tool-web`（`fetch: true`） | ✅ 同上 |
| 长期记忆 | ✅ 本包 `memory.js`：`remember` / `forget` | ✅ 同上，**与对话模式共用同一份文件** |
| 世界书 | ✅ 本包 `worldbook/`，**数据随包发运**（61 条） | ✅ 同上 |
| 运行时上下文快照 | ✅ `includeRuntimeContext: true`（世界书依赖它） | ✅ 同上 |
| 可配置称呼 | ✅ 本包 `nickname.js` 提供 `{{user_nickname}}` | ❌ **未挂** —— 人设正文也没引用它 |
| 文件读写 / Shell / 文件检索 | ❌ 不提供 | ✅ `bash` / `pwsh` / `tool-fs` / `tool-fs-search` |
| 计划 / 目标 / Skills | ❌ 不提供 | ✅ `plan-mode` / `tool-goal` / `tool-skill` |
| 子代理（含 fork） | ❌ 不提供 | ✅ `tool-subagent` / `tool-subagent-fork` |
| workflow / ralph | ❌ 不提供 | ⚠️ **默认关闭**（见下） |
| 表情包 | ⚠️ 需另装 `dsh-meme` 才生效（见下） | ⚠️ 同上 |

> **为什么 workflow / ralph 默认关着？** 这三行（`workflow-worker-thread`、
> `tool-workflow`、`tool-ralph`）依赖 `workflowEngine` 服务，而该 worker
> **在某些部署里起不来**（实测：DSH 桌面端 0.2.0-rc.2）。起不来时它们会一直
> `waiting for workflowEngine`，激活审计据此判定**整条预设「加载失败」**——
> 用户看到的是这两个预设里只有对话模式能用，工作模式根本不出现。
>
> 取舍很直接：**少三个工具 ≪ 整条预设加载失败**。所以默认关掉。
> 想在能跑 workflow 的部署里启用：把 `preset/cyrene-work/agent.cordis.yml` 里
> 那三行的 `disabled: true` 删掉即可（先确认 `workflowEngine` 在你那儿能起来）。

**这就是两套预设的意义**：以前想用角色人设就得放弃干活能力，于是只能"要干活时切回
原来的工作模式"。现在**「昔涟工作模式」两者兼得** —— 角色人设整份替换系统提示词，
同时挂着完整工具，并且和对话模式**共享同一份长期记忆**，两边记的事能接上。

代价要说清楚：工作模式用的是上游的**轻量人设**（不含 `soul.md`、台词集也是精简版），
所以语气会比对话模式淡一些。这是上游自己的设计取舍，本仓库照搬，没有代为更改；
想调，见 [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) 第 1 节。

> 两个模式都挂了本包的 `memory.js` 与 `worldbook/`，且都在**预设里**挂载，所以
> 只在各自模式内生效。对话模式额外挂了 `nickname.js`（工作模式的人设不需要它）。
> 详见 [`docs/host-side.md`](./docs/host-side.md)。

## 长期记忆

**两个模式共用同一份记忆**，所以你在哪边说的「记住……」另一边也看得到。

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
- **扫描范围**：默认扫最近 3 轮你说过的话（`scanDepth`，可设 1–5）。
- **换数据**：想用自己的世界书，在 `~/.dsh/cyrene-worldbook.json` 里写
  `{"dir": "/你的/目录"}` 覆盖。
- **关掉它**：同一个文件里写 `{"enabled": false}`。

### 每轮实际注入多少

体量由三段相加，值得心里有数：

| 段 | 上限 | 说明 |
| --- | --- | --- |
| 常驻 | **不限条数** | 随包数据里有 15 条，约 560 字符。内容恒定，只落库一次 |
| 命中 | **≤ `maxActive`（默认 8）** | 按触发词命中，按 `优先级` 降序截断，被截掉的条数会写进诊断日志 |
| 连带 | **不限条数** | 由命中条目的 `连带触发词` 拉进来（One-Shot），**不占上面那个名额** |

所以「常驻 15 + 命中 8 + 连带若干」是可能的。想压体积，两条路：把 `maxActive` 调小，
或者把 `worldbook/data/` 里不必要的条目改成非常驻。

命中块的注入**会进这个会话的历史**（和 DSH 自己的运行时快照一样）。同一话题连着聊时，
它会靠"内容与上一轮相同就不重复注入"避免堆积；换了话题才会追加新的一块。

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

| 插件 | 作用 | 必要性 | 上游 |
|---|---|---|---|
| `dsh-dream-skin` | 皮肤 / 壁纸 / 面板透明度 | 常用 | [RevolutionLA/dsh-dream-skin](https://github.com/RevolutionLA/dsh-dream-skin) |
| `dsh-ui-boost` | 主色调着色、Dock 等界面微调 | 可选 | [DoshinJiu/dsh-ui-boost](https://github.com/DoshinJiu/dsh-ui-boost) |
| `dsh-anime-theme` | 随机二次元壁纸背景 | **非必要** | [zxr2115-1/dsh-anime-theme](https://github.com/zxr2115-1/dsh-anime-theme) |

> **`dsh-anime-theme` 是非必要的纯外观插件。** 它只做随机壁纸，能力与
> `dsh-dream-skin` 的壁纸功能**重叠**；本插件的主职（两套预设的加载、人设、世界书、
> 记忆）与它毫无关系，**不装没有任何功能缺失**。
>
> 它还有个特点值得知道：**关闭时零残留** —— 客户端代码在 `enabled: false` 时返回
> **空样式表**，一条规则都不写。此时它在界面上唯一的痕迹是右上角那个
> "换壁纸 / 开-关"小控件；卸载它只会让那个控件一起消失，
> **不会影响其它插件给你的背景与皮肤**。

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

装好之后预设就在 `~/.dsh/.agent-presets/<id>/`（`chat` 或 `cyrene-work`），
**直接改那两个文件即可**，DSH 会按目录实时发现：

- `preset.yml` —— 模态名称、描述、排序（`order`）
- `agent.cordis.yml` —— 人设正文与工具挂载

> 改的是 `~/.dsh/` 下**装好的那一份**；仓库里的 `preset/<id>/` 是发运模板，
> 它不会自动跟着变。想把改动回灌进仓库，得手动同步过去。

改完**不用重新安装插件**。但注意：重新跑 `install.sh` 时若检测到内容不同会拒绝覆盖，
这正是为了防止你的改动被抹掉。

## 重命名

如果你希望仓库名与包名完全不带任何 IP 关联，改这几处即可：

- `package.json` 的 `name`
- `plugin.json` / `dsh.plugin.json` 的 `id` 与 `name`
- `cordis.patch.yml` 里的 `id` 与 `name`（**必须与包名一致**，否则报 `Cannot find package`）

## 目录结构

```
dsh-cyrene/
├── .github/workflows/test.yml  CI：Ubuntu Node 22/24 + 真实 windows-latest
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
│   ├── chat/
│   │   ├── agent.cordis.yml 对话模式人设 + 工具挂载（可直接用，也可替换）
│   │   └── preset.yml       模态元信息
│   └── cyrene-work/
│       ├── agent.cordis.yml 工作模式人设 + 标准模式全套工具
│       └── preset.yml       模态元信息
├── scripts/
│   ├── install.sh           Linux / macOS
│   ├── install.mjs          跨平台（Node，Windows 也走这条）
│   └── export-preset-declarations.mjs  DSH 0.2.0+ 的声明式预设导出
├── tests/
│   ├── worldbook.test.mjs   世界书解析 / 匹配 / 组装 / 注入层的单元测试
│   ├── memory.test.mjs      记忆的净化 / 限长 / forget 边界 / 注入块包裹
│   ├── preset.test.mjs      预设结构 + 与内置 standard 的漂移护栏 + 声明导出往返
│   └── portability.test.mjs 只有别的平台才暴露得出来的写法（静态断言）
├── docs/
│   ├── writing-your-preset.md   怎么写自己的人设
│   ├── theme-recipe.md          复刻观感指南：插件清单 + 参数配方
│   ├── host-side.md             宿主半体与会话级插件
│   ├── pitfalls.md              三个只能踩出来的 DSH 行为（动手前必读）
│   └── windows.md               Windows 怎么装 + 六条实测坑 + 为什么没有 ps1
├── AGENTS.md                上面那份的要点版，给在此仓库工作的 agent 用
├── CONTRIBUTING.md          维护边界 + 提交前的硬规则（想改代码先读这份）
├── THIRD_PARTY_NOTICES.md   授权与 IP 声明
└── LICENSE                   MIT
```

## 排查

**装了插件但模式选择器里没有新选项** —— 预设没装。跑 `scripts/install.*`，
确认 `~/.dsh/.agent-presets/chat/` 与 `~/.dsh/.agent-presets/cyrene-work/` 下
确实都有 `agent.cordis.yml` 和 `preset.yml`。

**滑块上少了某一档** —— 新建对话页的滑块只在**空白会话**显示，且会话预设一旦
锁定（发过消息）就随 Hero 一起消失，这是 DSH 的原生行为。

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
`dsh plugin --profile <你的 profile> remove dsh-cyrene` 删插件。

## 开发与测试

```bash
npm test              # 单元测试（当前 68 条）
npm run harness:check # 语法检查：对所有运行时代码做 node --check
```

**不需要 `npm install`** —— 运行时代码与测试都只用 Node 内置模块，没有依赖，所以也没有 lockfile。
Node ≥ 22 即可。

⚠️ **不要写 `node --test tests/`**（带尾斜杠）—— Node 会把目录当模块解析，报
`MODULE_NOT_FOUND`。要用 `npm test`，或 `node --test "tests/*.mjs"`。
本仓库的测试文件顶部早先就写错过这条命令，注意别再改回去。

CI 在 `.github/workflows/test.yml`：`ubuntu-latest` 的 Node 22 / 24 矩阵各跑一遍，
外加一个 **`windows-latest`** job —— 后者专门补作者本地覆盖不到的那块（见下）。

世界书那部分刻意做成**纯函数 + 薄注入层**：`worldbook/{parse,match,assemble}.mjs`
不碰任何 DSH API，可以直接单测；只有 `worldbook/index.mjs` 与 DSH 交互。
要改匹配逻辑，改前者；要改注入时机，改后者。

## 维护边界

**作者能验证的环境只有一种：DSH App（Android）。** 没有自己的电脑，整套东西都是在
DSH App 里做的 —— 本地没有 Windows、没有 PowerShell、也没有 macOS。

| 范围 | 谁维护 |
| --- | --- |
| 插件本体、两套预设、世界书、记忆、`install.sh` / `install.mjs` | 作者 |
| **桌面端（Windows / macOS / Linux）的各种差异** | **社区** —— 欢迎 PR |
| DSH 各版本之间的行为差异（0.1.x ↔ 0.2.0+） | 作者尽力跟进，但需要你反馈实测结果 |

这不代表拒绝桌面端：`install.mjs` 跨平台，CI 也**在真实 Windows 上跑测试**。
只是"声称支持"和"验证过"是两件事，这里不想混为一谈。

想参与的话请先读 [`CONTRIBUTING.md`](./CONTRIBUTING.md)（含"平台相关改动必须先真机跑通"
这条硬规则）；已知的桌面端坑在 [`docs/windows.md`](./docs/windows.md)。

**动手前请先读 [`docs/pitfalls.md`](./docs/pitfalls.md)** —— 里面记了三个**只能踩出来、
不在 DSH 官方文档里**的行为（装配跑在用户消息落库之前、`llm/stream` 的 messages 冻结、
预设里 `provide()` 会让整个预设挂载失败）。它们都会让你写出"看着对、其实静默失效"的代码。
[`AGENTS.md`](./AGENTS.md) 是同一份内容的要点版，给在此仓库工作的 agent 用。

## 授权

本仓库的**代码**采用 **MIT License**，见 [`LICENSE`](./LICENSE)。

`preset/chat/agent.cordis.yml` 与 `preset/cyrene-work/agent.cordis.yml` 内的
**人设文本**来自开源项目
[Cyrene-Agent](https://github.com/Playa-Cyrene/Cyrene-Agent)
（MIT License, Copyright (c) 2026 Playa），许可证副本见
[`LICENSES/Cyrene-Agent-LICENSE.txt`](./LICENSES/Cyrene-Agent-LICENSE.txt)。
两套预设分别取自上游不同模式的提示词组（对话组 / 工作组，外加通用工具规范），
**均一字未改**，具体文件清单见 [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)。

**角色 IP 声明**：Cyrene（昔涟）及《崩坏：星穹铁道》相关角色、世界观、名称与美术的
知识产权归 **HoYoverse / 米哈游** 所有，**不属于本 MIT 授权范围**。本项目为
非官方同人周边工具，与 IP 方无任何关联、背书或赞助关系。

**非商业使用条款**：因底层角色 IP 涉及米哈游同人创作规范，**本仓库中包含角色 IP 的
衍生物禁止商业使用**——包括但不限于售卖、付费社群、广告变现、打包销售。

本仓库不包含 Live2D 模型、立绘、美术资源或音频。若你要在其基础上继续创作并公开分发，
请保留本声明与许可证副本，并同样声明角色 IP 归属与禁止商业使用。完整说明见
[`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)。
