# 更新记录

这里记**面向使用者**的变化：要不要升级、升级能解决什么。逐条 commit 的过程看
`git log`（每条说明都写得比较长），已知的坑看 [`docs/pitfalls.md`](./docs/pitfalls.md)
与 [`docs/windows.md`](./docs/windows.md)。

## [0.4.0] — 2026-10-16

### 新增

**表达风格档位：`style.js` + `/style` 命令**

- 五档 + custom，**每档 = 一段风格提示词 + 一个温度**，对齐上游 Cyrene-Agent 的
  `prompts/styles/` 与 `BUILT_IN_STYLE_PRESETS`（lively 0.90 / healing 0.55 /
  focused 0.40 / sweet 0.82；`default` 不设采样）。
- 风格提示词走 `systemPrompt.context()`（请求尾部、每轮重算、`order: 130`，
  排在常驻世界书 `140` 之前）；注入外壳与上游 `buildStylePromptBlock()` 逐字一致。
- 温度走 `agent/request` 瀑布（DSH 的预设行没有 `temperature` 字段）。
  `default` 档**不写温度**，跟随模型默认。
- **按会话生效**：状态在 `<DSH_HOME>/cyrene-style.json`（最多留 50 条会话记录），
  `/style` 查看与切换（`/style lively`、`/style default`、无参列出全部）。
- `custom` 档读 `<DSH_HOME>/cyrene-style-custom.md`；没写文件时 `/style custom`
  会报错提示而不是静默不注入。想给它温度就在 JSON 里加 `customTemperature`（0–2）。

- custom 档支持两个可选字段（只影响显示/授权，不参与玩法）：
  - `customLabel`：改这一档的显示名（如叫成自己的风格名）；
  - `customTier`：`1`（默认）/ `2` —— **硬开关**。`style.js` 会按它在注入块里写一行
    授权标记（「第二档已授权」/「未授权」），模型看到的是确定事实，而不是去猜用户
    有没有点头。档位本身的含义由使用者自己的风格文件定义。

**角色扮演场景开关（`scene.js`）**

- 纯文本对话模式默认普通聊天；用户这一轮的消息里出现括号、且括号里写了场景/动作
  （`（雨夜，屋里只有一盏灯）`），本轮切到「叙述＋对话」的场景模式；没有括号了自动切回。
- 判断走 `agent/pre-step`（`context()` 在用户消息落库前执行，看不到本轮输入）；
  且是**状态机**，只在状态切换时追加一条标记，不会每轮往历史里堆指令。
- 中文括号 ≥2 字、半角括号 ≥6 字符才算，避开 `print(x)`、`（1）` 的误触发。
- 只挂对话模式；工作模式不挂（与风格同理）。

### 安全约定

- 风格**在工作模式里被禁用**：预设层面工作模式不挂该插件；`style.js` 的
  `DISABLED_PRESETS` 还会在运行时拒绝 `cyrene-work`（读会话的
  `agent-preset/selected` 事件判断）；新会话页的风格按钮在该模式下不显示。
  原因：工作模式带 shell / 文件 / 网络权限，写作风格不该影响"能不能动手、动哪只手"。

### 已知限制（能力边界，非缺陷）

- DSH 的 `LlmCallConfig` 只暴露 `temperature / maxTokens / stop`：上游的 `top_p`、
  OpenAI `frequency_penalty`、Qwen `repetition_penalty` **无处可放**，未移植。
- `deepseek-flash` 在**思考模式**下温度可能不生效（上游同类规则 `requiresReasoningOff`）。
  本项目不替你改路由，只在 `/style` 的回复里提示。

### 升级须知

- 对话模式预设多挂了一行 `dsh-cyrene/style`，**需要重装预设**才生效：
  `node scripts/install.mjs --force`（已存在且内容不同时默认拒绝覆盖）。
- 从 0.3.0 升级请一并看 0.3.1（行尾修复）与 0.3.2（会话来源修复）两条。

## [0.3.2] — 2026-10-16

### 修复

**新版 DSH 上「发消息没反应」（会话格式 v4 拒收消息来源）**

- **现象**：装好之后能选到模式，但**发消息没有任何反应**；没有任何报错指向本插件。
  旧版本 DSH（如 0.1.5-rc.2）上一切正常 —— 所以自己测是测不出来的。
- **原因**：世界书的命中块是一条手写的消息描述符，`source.kind` 写的是 v3 的裸
  `'plugin'`。会话格式 v4 要求「生产者自有」的 kind（`plugin:<插件 id>`），于是整条
  消息被校验拒掉：
  `SessionFormatError: format v4 message requires a producer-owned source kind`。
- **修法**：改为 `kind: 'plugin:dsh-cyrene/worldbook'` —— 这是 harness 自己的迁移器
  （`producerKind()`）给第三方插件生成的形态，新旧两个版本都接受。
- **已经装了的怎么办**：更新代码后**完全退出 DSH 再启动**。JS 模块替换必须重启进程
  才生效，热重载读到的仍是旧代码。
- ⚠️ 别换成 `runtime-context`：那是 `dsh-agent-loop` 自己持有的 kind，用它会让我们
  注入的内容被当成它的运行时快照，进而被替换/清除。详见
  [`docs/pitfalls.md`](./docs/pitfalls.md) 第七节。

### 测试

- 单元测试 73 → **74** 条。新增一条守 `source.kind`：必须是 `plugin:<id>`、不能是裸
  `plugin`、也不能是 `runtime-context`，且注入块不能被当成真实用户语料。

## [0.3.1] — 2026-10-06

### 修复

**Windows 上世界书整条静默失效（建议升级）**

- **现象**：插件装上了、人设也在、注入块照常出现，但世界书**一条都命中不了**，
  注入的内容也是错的。全程不报错，很容易误判成"人设不对"。
- **原因**：世界书数据是 `worldbook/data/*.md`。Windows 上 `core.autocrlf=true`
  （GitHub 的 windows runner 默认就是）检出来是 CRLF，而解析器只按 `\n` 切行 ——
  于是标题、触发词、正文尾部全挂上一个 `\r`，触发词永远匹配不上（用户消息里没有 `\r`）。
- **修法**：解析层先归一 `\r\n` → `\n`（`worldbook/parse.mjs`）；记忆文件同理
  （`memory.js` 的读取入口）——两者都是**可能被人手改过的**文件，不能假设行尾。
  仓库再加 `.gitattributes` 的 `* text=auto eol=lf` 让各平台检出同一种行尾。
- **已经装了的怎么办**：`git pull` 之后重跑一次装预设的命令（`node scripts/install.mjs`）。
  注意 `.md` 的内容本身没有改动，`git pull` 不一定重新检出它们 —— 但只要解析层是新的，
  就不会再失效。

**`cyrene-work` 在部分部署上整条预设加载失败**

- **现象**：模式选择器里根本不出现「昔涟工作模式」。
- **原因**：三个工具行（`workflow-worker-thread` / `tool-workflow` / `tool-ralph`）
  依赖 `workflowEngine`，而该服务在某些部署里起不来（实测 DSH 桌面端 0.2.0-rc.2）——
  `tool-workflow` / `tool-ralph` 会一直 waiting，激活审计据此判定**整条预设失败**。
- **修法**：这三行默认 `disabled: true`。要用就把那三个 `disabled` 删掉。
  代价是工作模式里暂时没有 workflow / ralph 两个工具 —— 少三个工具 ≪ 整条预设加载失败。
  这是本仓库相对内置 `standard` 抄本**唯一**有意保留的差异，有测试盯着。

**DSH 0.2.0+ 换了预设注册方式（不升级到 0.2.0 的可以跳过）**

- 0.2.0 起预设改为**声明式注册**，注册表不再扫描 `~/.dsh/.agent-presets/` 目录 ——
  老方式在那一代上是静默失效（目录还在、预设不出现）。
- 用 `node scripts/export-preset-declarations.mjs` 生成声明，**自带 `- insert:` 那一层，
  别去掉**（裸的声明行会被当成"按 id 覆盖已有条目"而被跳过）。
- 0.1.x 仍走目录方式，`scripts/install.mjs` 两种都覆盖。

### 变更

- **删掉 `scripts/install.ps1` 与 `install.bat`。** 作者没有自己的电脑，项目是在
  DSH App（Android）里做的，这两个脚本**无法实测** —— 靠用户反馈连试三轮仍未在真机跑通。
  与其留一条"看起来能用、其实没人验证过"的路，不如只留一条能跑通的：
  Windows 用户走 `node scripts/install.mjs`（跨平台、无 shell 依赖、已实测安装/幂等/卸载）。
  六条实测坑与恢复办法见 [`docs/windows.md`](./docs/windows.md)。
- **CI 增加真实 `windows-latest` job**：语法检查、单元测试、声明导出必须真有输出、
  `install.mjs` 试装（安装 → 幂等 → 卸载）。上面那个 CRLF 的 bug 就是它第一次跑抓到的 ——
  作者没有 Windows 机器，这台 runner 就是。
- 新增 [`CONTRIBUTING.md`](./CONTRIBUTING.md)：写清维护边界（插件与预设本体归作者，
  桌面端差异归社区，DSH 版本差异作者尽力跟进但需实测反馈）。

### 测试

- 单元测试 63 → **73** 条。新增：行尾回归（CRLF/CR 输入与 LF 结果逐字一致、
  随包 61 条真数据整份转 CRLF 后仍一致）、`cyrene-work` 的抄本漂移护栏与
  有意关闭集合、声明导出往返比对、可移植性静态断言。
- `npm test` 与 `npm run harness:check` 在 ubuntu（Node 22/24）与 Windows（Node 22）上都跑。
