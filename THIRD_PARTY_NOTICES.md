# 第三方内容与授权声明 / Third-Party Notices

## 一句话概括

- **本仓库的代码**（`index.js`、`worldbook/`、`cordis.patch.yml`、`scripts/`、`package.json` 等）：MIT，本项目作者原创。
- **`preset/agent.cordis.yml` 内的人设文本** 与 **`worldbook/data/` 内的世界书数据**：来自开源项目 **Cyrene-Agent**，MIT，`Copyright (c) 2026 Playa`；**已取得原作者同意**（2026-10-03，见第 1 节「授权确认」与「世界书数据」）。
- **角色 IP**（昔涟 / Cyrene 及《崩坏：星穹铁道》相关内容）：归 **HoYoverse / 米哈游** 所有。
- **禁止商业使用**：含角色 IP 的衍生物不得用于售卖、付费社群、广告变现、打包销售等。

---

## 1. 人设文本与世界书数据的来源与授权

`preset/agent.cordis.yml` 中的人设与语气内容整理自：

- 项目：**Cyrene-Agent** — <https://github.com/Playa-Cyrene/Cyrene-Agent>
- 原作者：Playa
- 源文件：`prompts/chat_system.md`、`prompts/chat_identity.md`、`prompts/soul.md`、`prompts/canon_quotes.md`
- 语气规则：预设中「## 语气规则」那一段（句式禁止 / 语气参考 / 回复边界）来自上游
  `src/main/orchestrator/tone-injector.ts` 的 `DEFAULT_RULES` —— 即上游
  `prompts/tone-rules.md` 缺失时的内置兜底值。这一段在原应用里是**每轮随请求尾部注入**的，
  不是人设文件的一部分；本仓库把它并入预设正文，位置与上游的注入顺序一致（人设之后）。
- 上游许可证：MIT License，`Copyright (c) 2026 Playa`
- 许可证副本：见 [`LICENSES/Cyrene-Agent-LICENSE.txt`](./LICENSES/Cyrene-Agent-LICENSE.txt)

### 世界书数据

`worldbook/data/` 下的 5 个文件（61 条设定条目）同样整理自 **Cyrene-Agent**
（原作者 Playa，MIT License，`Copyright (c) 2026 Playa`），来源为上游戏的
`prompts/worldbook/` 目录。许可与 IP 声明的范围与上一条完全一致。

其中 `_glossary.md` 经过**改写**：上游原文件未带「触发词」「常驻」这类元数据字段，
在本项目的匹配器下会导致该文件的所有条目永远不触发。改写只是补齐这些字段并统一为
标准条目格式，设定文本本身未作改动。这属于 MIT 允许的修改，在此明示以便追溯。

#### 条目格式与字段语义的来源

`worldbook/data/` 里条目的**格式**（`## 标题 / 别名` 加 `- 触发词:` / `- 常驻:` /
`- 内在价值:` / `- 优先级:` / `- 连带触发词:` 以及正文）和这些字段的**含义**，
都来自上游的 `src/main/rag/worldbook.ts`，**不是本项目发明的**：

- `触发词`（keywords）—— 命中检测的依据
- `常驻`（permanent）—— 始终注入，不参与打分，也不占注入上限
- `优先级`（priority）—— 上游仅作排序 tiebreaker（真正的排序键是 activation 分数）
- `内在价值`（intrinsicValue）—— 上游只在 DMAE 的 Floor（首次激活基线）与
  Resistance（遗忘抵抗）里消费它
- `连带触发词`（linkTriggers）—— 上游定义为 **One-Shot 一次性**：本条目被用户命中时，
  连带触发这些关键词对应的条目，只本轮有效、不进状态表

本项目的 `worldbook/match.mjs` 是这套语义的**等效简化实现**：去掉了 DMAE 的激活
状态机与内在价值衰减。因此有两处刻意的行为差异，都写在模块头部注释里：

1. **`内在价值` 在本实现里不起作用** —— 没有状态机就没有落脚点，只解析保留以便数据无损；
2. **`优先级` 从 tiebreaker 变成主排序键** —— 因为没有 activation 分数。

MIT License 允许使用、复制、修改、合并、发布与再分发，条件是在副本中保留上述版权声明
与许可证全文。本仓库已履行该条件。

上游在 README 中对其自身许可范围的说明（转述）：源代码采用 MIT；
角色 IP、Live2D 模型与美术资产不属于 MIT 授权范围，分别遵循其模型授权文件与米哈游同人创作规范处理。

### 授权确认

除上述 MIT 许可外，本项目在公开发布前已征询原作者并取得同意：

- **授权时间**：`2026-10-03`
- **公开回复（主要凭据）**：原作者在
  <https://github.com/Playa-Cyrene/Cyrene-Agent/issues/137#issuecomment-5969268084>
  公开回复「拿就行，除了 live2D 模型，模型需要去找原作者」，
  并将该 issue 以 **closed as completed** 结案（同日 12:42 UTC）。
- **另经私信确认**：同日经 B 站私信沟通，作者亦回复同意使用。

> **许可范围说明**：
>
> 1. 该确认覆盖的是**提示词文本本身**（`prompts/` 下那四篇的整理与再分发）。
> 2. 作者明确**排除 Live2D 模型**——模型不在本确认范围内，其授权需另行向
>    模型原作者取得。**本仓库本就不包含**任何 Live2D 模型、立绘、美术资源或
>    音频，因此不受该排除影响；但**日后若有人要加入模型，必须自行取得授权**，
>    不得援引本确认。
> 3. 该确认**不覆盖角色 IP**——角色、世界观与美术的权利归 HoYoverse / 米哈游
>    所有，原作者无权代为授权该部分。因此本文件第 2 节（角色 IP 声明）与
>    第 3 节（非商业使用条款）**继续完整适用**。

## 2. 角色 IP 声明

Cyrene（昔涟）以及《崩坏：星穹铁道》相关的角色、世界观、名称与美术，
其知识产权归 **HoYoverse / 米哈游** 所有。

本项目为**非官方同人周边工具**，与 HoYoverse / 米哈游**无任何关联、背书或赞助关系**。
本项目不主张对上述 IP 的任何权利。

## 3. 非商业使用条款

承袭上游的同一立场：**因底层角色 IP 涉及米哈游同人创作规范，本仓库中
包含角色 IP 的衍生物禁止商业使用。**

明确禁止的情形包括但不限于：

- 售卖本插件或其修改版
- 放入付费社群、付费内容作为权益发放
- 通过广告、赞助等方式直接变现
- 与其他商品打包销售

## 4. 本仓库不包含什么

为避免扩大授权风险，本仓库**不包含**以下内容，请使用者自行解决：

- ❌ Live2D 模型文件（`.moc3` / `.motion3.json` / `.physics3.json` / 纹理等）
- ❌ 角色立绘、美术资源、音频、语音
- ❌ 游戏内文本的成段收录（`preset/agent.cordis.yml` 中引用的原作台词摘录，
  其内容版权归 HoYoverse / 米哈游所有，仅作语气参考用途）

## 5. 可选依赖（第三方插件）

以下插件**不在本仓库内**，请各自从原始仓库安装。本仓库不捆绑、不再分发它们：

| 插件 | 作者 | 授权 |
|---|---|---|
| [dsh-meme](https://github.com/yyh-001/dsh-meme) | yyh-001 | MIT |
| [dsh-dream-skin](https://github.com/RevolutionLA/dsh-dream-skin) | RevolutionLA | MIT |
| [dsh-ui-boost](https://github.com/DoshinJiu/dsh-ui-boost) | DoshinJiu | MIT |
| [dsh-anime-theme](https://github.com/zxr2115-1/dsh-anime-theme) | zxr2115-1 | MIT |

表情图库与壁纸图片的版权归各自作者所有。

## 6. 使用者的责任

1. 若你**不再需要**人设文本，可以直接删除 `preset/agent.cordis.yml` 中的相关内容，
   或改用空白模板——本插件的装配机制不依赖具体人设。
2. 若你在其基础上**继续创作**并公开分发，请保留本文件与许可证副本，
   并同样声明角色 IP 归属与禁止商业使用。
3. 请勿声称本插件是官方作品，或暗示得到 IP 方授权。

## 7. 设计与参考实现

这一节不涉及第三方内容授权，而是说明**本项目的设计站在谁的肩膀上**。

### 世界书条目的格式与字段语义

条目格式与字段含义来自 Cyrene-Agent 的 `src/main/rag/worldbook.ts`，不是本项目发明的
（详见第 1 节「条目格式与字段语义的来源」）。

### 注入通道的做法参考了谁

「命中块挂在 `agent/pre-step` 上」这个做法**不是本项目想出来的**，而是参考了两个
社区插件（代码一行未抄，两者的实现思路与代码结构都不同）：

- [dsh-local-vector-memory](https://github.com/liangxiaobing520/dsh-local-vector-memory)
  —— 用 `agent/pre-step`，本轮输入就是它的 `messages` 参数
- [dsh-universal-worldbook](https://github.com/TritiumWang/dsh-universal-worldbook)
  —— 用 `llm/stream` 改写出站请求

本项目在这条路上的额外工作是**把「为什么只能这么做」挖清楚并写下来**：

- 装配（`assemble()`）跑在用户消息落库（`session.append`）**之前**，所以任何在装配期
  求值的 provider 读会话都拿不到本轮消息 —— 而空文本的 section 会被静默过滤掉，
  表现是"什么都没有发生"；
- `options.messages` 是**冻结**的，所以 `llm/stream` 那套「重建请求对象 + 重调
  `llm.stream()` + 重入守卫」是被 API 逼出来的唯一做法，不是偷懒；
- 预设作用域内调用 `ctx.provide()` 会被 `leakedServices` 校验判为污染进程全局，
  导致**整个预设挂载失败**（连新建会话都会出问题）。

### 预设与装配格式

`agent.cordis.yml` 的格式、`complete: true` 的语义、`systemPrompt.context()` 与
`agent/pre-step` 这些扩展点，都是 DeepSeek Harness 提供的，非本项目发明。

### 本项目自己写的部分

`index.js`、`memory.js`、`nickname.js`、`worldbook/` 下的全部代码，以及 `scripts/`、
预设的组装方式。这些是原创代码，未复制任何上游或社区插件的实现。

## 8. 遇到异议时

本项目已就提示词文本的整理与再分发取得原作者同意（见第 1 节「授权确认」）。
但若日后 **IP 方（HoYoverse / 米哈游）** 或任何相关方对本仓库的分发提出异议，
维护者应配合下架相关内容，或改为「只分发插件骨架、由使用者自备人设」的形式。
