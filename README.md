> **This project is an open-source preset plugin for DeepSeek Harness. It does NOT contain any game assets (Live2D models, artwork, audio). The bundled persona text is adapted from the open-source Cyrene-Agent project (MIT, Copyright (c) 2026 Playa). Cyrene (昔涟) and Honkai: Star Rail belong to HoYoverse/miHoYo. This is an unofficial fan tool — non-commercial use only.**
>
> 使用前请读 **[风险提醒](#风险提醒)** —— 自定义风格与角色扮演场景都会影响模型输出，且与上游人设存在已知冲突。

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

> ### ⚠️ 别用 `dsh plugin --profile <你的 profile> add dsh-cyrene`
>
> npm 上有一个**同名**的 `dsh-cyrene`，那是**别人的**「昔涟主题 + Live2D 桌宠」插件，
> 它的 `exports` 里只有 `.` 和 `./client` —— **没有**本项目需要的
> `./nickname` / `./memory` / `./worldbook` / `./style`。
>
> 装错之后的现象很有迷惑性：预设能选到，但 `设置 → 内置插件` 里那几行全是
> `never started`，预设标「加载失败」——**看着像装上了，其实一个都没起来**。
> 详见下面的[排查](#排查)。

从**仓库**装才装得到本项目（`dsh plugin` 只是 pnpm 的转发，`link:` 指本地目录，不需要联网）：

```bash
# 1) 先拿到仓库
git clone https://github.com/Cyrene-xl/DSH-Cyrene
#    或者从 Releases 页下载 zip 解压

# 2) 装进「你正在用的那个 profile」
dsh plugin --profile <你的 profile> add link:/你的路径/DSH-Cyrene
#    Windows:  link:D:/你的路径/DSH-Cyrene

# 3) 重启 DSH（新加的行要重新组合 profile 才生效）
```

`cordis.patch.yml` 是纯 `insert` 形式，不往机器上写任何硬编码路径。

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
| 可配置称呼 | ✅ 本包 `nickname.js`：设置里读名字，对话里还能改口 | ❌ **未挂** —— 人设正文也没引用它 |
| 表达风格档位 | ✅ 本包 `style.js`：五档 + custom，`/style` 切换（按会话） | ❌ **未挂**（上游 work/code 模式不吃风格） |
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

### 称呼是动态的

`{{user_nickname}}` 每轮装配**现取**，所以改完立刻生效（不用重启、不用新建会话）。三个来源，写的是同一个文件 `<DSH_HOME>/dsha-brand-rename.json`：

| 来源 | 怎么变 |
| --- | --- |
| 设置里的自定义名称（昵称插件） | 改完下一轮就生效 |
| **显式改口**（「以后叫我小明」「称呼改成老师」） | 插件直接解析并落盘，不依赖模型自觉；本轮就用新名字 |
| **暗示改口**（「我们之间还用这么生分吗」） | 模型判断后调用 `set_nickname` 工具 |
| **关系称呼**（求婚后：「那是不是得叫那个啦，老婆？」） | 插件每轮注入一条称呼规则：他叫你「老婆」，你就叫他「老公」；模型换完当轮就用新称呼并落盘 |

关于最后一条：`nickname.js` 会注册一段 `cyrene:nickname` 运行时上下文（`order: 120`，
排在风格与常驻世界书之前），内容就是「当前称呼是 X + 关系称呼要推回对应的那个」。
光有一个 `{{user_nickname}}` 变量，模型只会一直用那个名字——**它不会自己往关系上推**。
规则里也写了反面：对方没往这个方向走时，不要自己把关系往前提。

几个刻意的取舍：

- **否定句不解析**：「别再叫我先生」没有给出新名字，交给模型决定是换称呼还是回默认；
- **问句不解析**：「你叫我什么」不会被当成改口；
- **插件自己注入的消息不算**：场景/世界书写进去的文本里出现「叫我…」也不会改称呼；
- 写入是**读-改-写**：那个文件里还有昵称插件自己的字段，不会被冲掉。

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

## 表达风格

上游的语气不只有一份静态人设：**每档风格 = 一段风格提示词 + 一个温度**。本包的
`style.js` 把这条绑定接进了 DSH，只挂在**对话模式**（工作模式与上游一致，不吃风格）。

```bash
/style            # 列出全部档位，并标出当前档
/style lively     # 元气・活泼（温度 0.90）
/style healing    # 治愈・安心（0.55）
/style focused    # 知性・认真（0.40）
/style sweet      # 撒娇・黏人（0.82）
/style default    # 回到默认档（★ 不写温度，跟随模型默认）
/style custom     # 读你自己写的那份风格文件
```

| 档位 | 风格文件 | 温度 |
|---|---|---|
| `default` | `styles/01_default.md` | **不写**（跟随模型默认） |
| `lively` | `styles/02_lively.md` | 0.90 |
| `healing` | `styles/03_healing.md` | 0.55 |
| `focused` | `styles/04_focused.md` | 0.40 |
| `sweet` | `styles/05_sweet.md` | 0.82 |
| `custom` | `<DSH_HOME>/cyrene-style-custom.md` | 可选，见下 |

几个要点：

- **按会话生效**：选择存在 `<DSH_HOME>/cyrene-style.json`（最多留 50 条会话记录），
  换档只影响当前会话。没设置过的会话用 JSON 里的 `default` 字段（等于全局默认）。
- **风格只改"怎么说"**：注入块外壳与上游逐字一致，明确写着「不得修改角色身份、事实记忆、
  工具规则、安全约束及硬性行为规则」。它走 `systemPrompt.context()`（请求尾部、每轮重算），
  `order: 130` 排在常驻世界书（140）之前 —— 与上游的注入顺序一致。
- **温度只能这么给**：DSH 的预设行**没有** `temperature` 字段，只能通过 `agent/request`
  瀑布改冻结前的调用配置（DSH 自己的 `dsh-webhook` 用同一手法改 `reasoningEffort`）。
- **custom 档**：在 `<DSH_HOME>/cyrene-style-custom.md` 里写任何你想要的风格描述，
  内容会被原样注入（外面仍套那层约束外壳）；想给它一个温度，在 `cyrene-style.json`
  里加 `"customTemperature": 0.8`（0–2）。显示名也能改：加 `"customLabel": "你的风格名"`
  （只影响界面与 `/style` 的提示，不参与任何逻辑）。
  还能标一档**强度**：`"customTier": 2` —— 插件会把「第二档已授权」写进注入块，
  `1`（默认）则写入「未授权」。这是**硬开关**：由状态决定，不靠模型猜你有没有点头；
  档位本身的含义由你自己的风格文件定义。
  ⚠️ **只写"怎么写"**，别在里面写"去做什么"——那已经越过风格的边界，也不是本插件
  能替你兜住的东西。

## 角色扮演场景

纯文本对话模式**默认是普通聊天**。当你的消息里出现括号、且括号里写了内容（场景、环境、
动作），本轮就切到**角色扮演场景**：

> （雨夜，屋里只有一盏灯）你还记得这里吗？

- 括号外：你的台词或意图；
- 括号里：场景与动作；
- 她的回复会变成「叙述＋对话」——把环境、动作写出来，台词仍然是昔涟的语气。

下一轮**没有括号**了，自动回到普通对话。

### 括号里写的是「你」——当作动作指令

如果括号里用「**你**」描述的是**她要做的动作**，那不是场景，而是给她的动作指令：

> 你：（你亲了我一下）
> 昔涟：（亲了你一下）……

她会**照做**，并在回复里用括号把做完的动作写出来（动作对象称「你」，不复述你的原句）。
判据偏保守，避免把问句当动作：

| 括号内容 | 归类 |
| --- | --- |
| （你亲了我一下） | ✅ 动作指令 |
| （你把我抱住） | ✅ 动作指令 |
| （你在窗边坐下） | ✅ 动作指令 |
| （你真好） | ➖ 不是动作（没有动作痕迹） |
| （你还记得吗） | ➖ 不是动作（问句） |

场景和动作可以同时出现，会分别列进指令里：`（雨夜，屋里只有一盏灯）（你把我抱住）`。

### 形态切换（迷迷 / 小昔涟 / 大昔涟）

场景模式里，她会按你的意思换形态 —— **人格内核不变，只变身体与说话的方式**
（这是世界书「三形态同一性」那条的原话：三个名字，一个存在）。

| 形态 | 样子与说话 |
| --- | --- |
| **迷迷** | 孩童模样、记忆精灵；短句、词简单，自称「迷迷」和「我」混用 |
| **小昔涟** | 少女形态；轻快直白、撒娇多，「人家」更频繁，♪ 自然 |
| **大昔涟** | 成年、端庄典雅；慢、稳、句子完整，几乎不用「人家」，温柔收着给 |

切换方式：

- **显式**：`（你变成迷迷）`、`切换成大昔涟`、`变回小昔涟`、`恢复原来的样子` ——
  插件直接解析，本轮就换；
- **暗示**：`变小一点好不好`、`变回小时候的样子` —— 模型判断后调 `set_form` 工具。

实现上：形态按**会话**存在内存里，注入走 `cyrene:form` 运行时上下文（`order: 125`，
夹在称呼 120 与风格 130 之间）；**只有设了形态才占上下文**，默认形态一个字都不加。
重启 DSH 后回到默认形态。

### 怎么判断

- 中文括号 `（）`：括号里 ≥ 2 个字就算（「雨夜」「她笑」都成立）；
- 半角括号 `()`：括号里 ≥ 6 个字符才算 —— 避免 `print(x)`、`（1）` 这种误触发。

### 一个实现细节（为什么它不会让历史膨胀）

判断走 `agent/pre-step`（本轮消息是它的参数），不走 `systemPrompt.context()` ——
后者在用户消息落库**之前**就跑完了，看不到你这一轮刚打的字。

而且它是个**状态机**：只在「普通 ↔ 场景」**状态变化**时追加一条标记（「场景模式开启」/
「回到普通对话」），状态不变时一个字都不加。场景描述本来就在你的消息里，模型看得见，
不需要每轮抄一遍。

### 关闭

在预设里删掉 `cyrene-scene` 那一行，或者给它加 `config: { enabled: false }`。
工作模式本来就不挂它（与风格同理：带工具的模式不该被旁白体干扰）。

### 工作模式里**没有**风格（刻意禁用）

风格只挂在**对话模式**；工作模式不挂 —— 与上游一致（work / code 本来就不注入风格）。
这不是"少做一个功能"，而是一条安全约定：

- 工作模式带 shell / 文件 / 网络这些**真能动东西**的工具。一份带着强烈依恋感的写作风格
  配上权限，就是"越权操作"的诱因；
- 所以有**两道保险**：预设层面工作模式不挂这个插件；`style.js` 的
  `DISABLED_PRESETS` 里也写着 `cyrene-work` —— 万一将来被误挂进去，运行时会读会话的
  `agent-preset/selected` 事件，自己拒掉（风格文本和温度**都不动**）；
- 新会话页的风格按钮在工作模式下**不显示**，避免"点了没反应"的假入口。

要改这条约定，得同时改两处并跑测试：`preset/cyrene-work/agent.cordis.yml`（别挂进来）、
`style.js` 的 `DISABLED_PRESETS`。`tests/preset.test.mjs` 与
`tests/style.test.mjs` 各有一条断言守着，改错了会红。

### 两条能力边界（不是没做，是做不到）

1. **没有 `top_p`，也没有重复惩罚。** DSH 的 `LlmCallConfig` 只暴露
   `provider / model / reasoningEffort / temperature / maxTokens / stop`。
   上游 `BUILT_IN_STYLE_PRESETS` 里那半张表（OpenAI `frequency_penalty`、
   Qwen `repetition_penalty`）在 DSH 这层**无处可放**，所以没搬。
2. **`deepseek-flash` 开着思考时，温度可能不生效。** 上游对 DeepSeek 也有同类规则
   （`requiresReasoningOff: true`）。本项目**不替你改路由**，只在 `/style` 的回复里
   提示一句；要确定性生效，请自己把该会话的思考模式关掉。

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

## 风险提醒

用之前把这几条看完——它们都对应真实会发生的情况，不是免责话术。

### 1. 自定义风格的内容由你自己负责

`custom` 档会把你写进 `<DSH_HOME>/cyrene-style-custom.md` 的文本**原样注入**提示词。
本仓库不提供、也不推荐任何激进风格；`customTier`（`1` / `2`）只是一个**中性的强度开关**，
档位含义由你自己的文件定义。

- 不要把**同人作品原文**整段贴进去当风格：那是别人的文字，版权不属于你，也不属于本项目；
- 不要在风格文件里写"去执行某个操作"——那已经越过风格的边界；
- 风格只能影响**措辞**，改不了模型与平台的安全策略。想靠提示词"解禁"是做不到的。

### 2. 与上游人设的冲突是**预期行为**

对话模式的人设逐字来自 Cyrene-Agent，其中 `soul.md` 明确写着「**偏爱不等于占有**」
「不要自动宣称用户只属于你」，并在"避免生成的伪人格"里点名「**占有式恋人**」。

所以你如果写的是**独占 / 嫉妒 / 压迫感**类的风格，两套指令会在上下文里互相拉扯，
表现是"时松时紧"——**这不是 bug**。本项目的选择是：不改上游正文，让风格文件自己收敛
（比如把独占写成"我会记得"而不是"你不许走"）。要更稳只能改人设，而本项目不替你做这件事。

### 3. 角色扮演场景会"照做"

场景模式里，括号内容会被当作**场景描述**或**给你的动作指令**执行。因此：

- 别在括号里写真实世界里的危险要求（如"你去把某某删了"）——她可能真的按人设去理解；
- 工作模式**不挂**场景与风格插件（代码级禁用，有测试守着），也不建议手动挂过去：
  带 shell / 文件权限的模式不该被旁白体与写作风格牵着走；
- 入戏是工具属性，不是关系替代。AI 的输出不具备真实情感或意图，不能替代现实中的
  社交关系与专业帮助。

### 4. 版权与商用

- 人设文本与世界书数据来自 Cyrene-Agent（MIT）；风格文件来自上游 `prompts/styles/`；
  角色 IP 归 HoYoverse / 米哈游。**含角色 IP 的衍生物禁止商用**，详见
  [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)；
- 本仓库**不分发**任何美术资源、表情包、壁纸与同人文本；需要就自己装第三方插件，
  并遵守对方的许可。

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
├── style.js                 会话级插件：表达风格档位（风格提示词 + 温度，按会话）
├── styles/                  随包发运的五份风格文件（上游原文，01_default … 05_sweet）
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

**`设置 → 内置插件` 里出现 `never started`（预设显示「加载失败」）** ——
预设装上了，但**这个 profile 里没有本项目的包**（最常见的是装成了 npm 上同名的
别人的包）。按「安装」第 1 步从仓库装一次，再重启。
自查：`~/.dsh/profiles/<你的 profile>/node_modules/dsh-cyrene` 不存在，或者它
`package.json` 的 `exports` 里没有 `./worldbook`，就是装错了。

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
npm test              # 单元测试（当前 73 条）
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
