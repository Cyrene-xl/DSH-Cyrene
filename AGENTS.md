# AGENTS.md

给在这个仓库里动手的人（或 agent）的几条硬规则。**详细版与实测证据见
[`docs/pitfalls.md`](./docs/pitfalls.md)**，这里只列要点。

本仓库是 DeepSeek Harness（DSH）的一个插件 + agent 预设。它的运行时代码**只用 Node 内置模块**，
没有依赖、没有 lockfile，所以 `npm install` 不需要 —— 直接 `npm test` 就行。

## 动手前先读

`docs/pitfalls.md` 记了三个**不在 DSH 官方文档里、只能踩出来**的行为。它们都会让你写出
"看着对、其实静默失效"的代码：

1. **装配跑在用户消息落库之前** —— `systemPrompt.variable()` / `.context()` 的 provider
   在装配期求值，读会话**拿不到本轮用户消息**；而且空文本的 context 会被静默过滤，
   看不出任何异常。需要本轮消息就改走 `agent/pre-step`。
2. **`llm/stream` 的 `options.messages` 是冻结的** —— 只能重建请求对象再重调
   `llm.stream()`，而那是从瀑布顶端重入，必须挡自递归。
3. **预设作用域里 `ctx.provide()` 会让整个预设挂载失败** —— 表现是连新建会话都出问题。
   预设级插件只注册 `context` / `variable` / `tool`。

## 改完必须全量跑

```bash
npm test              # 全部单元测试
npm run harness:check # 全部运行时代码的语法检查
```

**不要只跑你改动的那一个测试文件。** 本仓库在这上面反复吃亏：改一个导出、
忘改一个 import，会让**所有**测试命令一起失败，而那看起来像"命令写法不对"，
很容易查错方向。

另外 `node --test tests/`（带尾斜杠）会挂，用 `npm test` 或 `node --test "tests/*.mjs"`。

## 生效方式（很不直观，别搞错）

| 改什么 | 怎么生效 |
| --- | --- |
| 预设 YAML `preset/<id>/agent.cordis.yml` | **下次新建会话**，不用重启（但已加入的会话保留旧组装） |
| 插件源码 `.js` / `.mjs` | **必须重启** —— loader 用裸 `import()`，没有缓存击穿 |

## ⚠️ 预设的安装方式在 DSH 0.2.0 变了（静默失效）

**0.1.x**：预设由 `dsh-agent-presets` **扫描目录**发现 —— `~/.dsh/.agent-presets/<id>/`。
`scripts/install.*` 做的就是这件事。

**0.2.0 起**：换成声明式注册表。`@deepseek-ai/dsh-agent-preset-registry` 的文档原话是
「**注册表不扫描目录，也不接受 preset 路径**」；预设改为一行插件声明：

```yaml
- id: preset-<你起的名字>
  name: '@deepseek-ai/dsh-agent-preset'
  config:
    id: <预设 id>
    name / description / order: …（可选）
    plugins: [ …整套 entry list… ]     # 必填
```

**危险的地方在于它不报错。** 在 0.2.0+ 上跑 `scripts/install.mjs` 依然会成功、
依然打印"已安装"、目录也确实出现了 —— 但预设**永远不出现在界面上**。实测反馈里
一位 Windows 用户（桌面版 0.2.0-rc.2）就卡在这里，排查成本很高。

对策：`scripts/export-preset-declarations.mjs` 把 `preset/<id>/` 机械转换成上面那种
声明（组合本身就是 entry list，只做整体缩进，不改写内容），生成的片段贴进
`<DSH_HOME>/profiles/<profile>/cordis.patch.yml`。`tests/preset.test.mjs` 有一条
往返用例守着它 —— 那个生成器错了会**静默**产出不一致的声明。

## 来源与边界

- **人设文本与世界书数据来自 Cyrene-Agent（MIT）**，不是本项目原创。字段的**语义**
  （含 `连带触发词` 的 One-Shot 定义）也来自上游。改任何相关文案前先读
  [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)。
- **不要往预设正文里手写没注册过的 `{{...}}`** —— DSH 遇未注册变量会在**装配期直接抛错**，
  表现不是加载失败，而是这个模式下每一轮对话都失败。要加变量，先加注册它的插件。
- 世界书是**纯函数 + 薄注入层**：`worldbook/{parse,match,assemble}.mjs` 不碰 DSH API；
  只有 `worldbook/index.mjs` 与 DSH 交互。
- 角色 IP 归 HoYoverse / 米哈游所有，**含角色 IP 的衍生物禁止商业使用**。

## 验证状态（哪些验过、哪些没验过）

写清楚是为了防止后人把"没验过"当成"验过"。

| 对象 | 状态 | 怎么验的 |
| --- | --- | --- |
| `index.js` / `memory.js` / `nickname.js` / `worldbook/*` | ✅ 已验 | `npm test`（63 条）+ `npm run harness:check`（全量语法检查） |
| `preset/chat/`、`preset/cyrene-work/` 的 YAML | ✅ 已验 | 解析 + 结构断言（`tests/preset.test.mjs`：条目数、`complete: true`、两模式挂载差异） |
| `preset/cyrene-work/` 的**工具行与内置 standard 的同步性** | ✅ 已验（**装了 DSH 才跑**） | `tests/preset.test.mjs` 的漂移护栏：断言比 standard 少 0 行、多出的只允许 `cyrene-memory` / `dsh-cyrene-worldbook`。CI 上没有 DSH，该文件整体跳过 |
| `scripts/install.sh` | ✅ 已验 | 用**临时 `DSH_HOME`** 实跑：安装 → 幂等复跑报"已是最新" → `--uninstall` |
| `scripts/install.mjs` | ✅ 已验 | 同上（安装 / 幂等 / 卸载三条都跑过）。**Windows 也走这条** |
| `scripts/export-preset-declarations.mjs` | ✅ 已验 | 往返比对：解析生成结果，`insert[0].config.plugins` 与源组合深度相等；且断言 patch 顶层只允许出现 `- insert:` |
| ~~`scripts/install.ps1` / `install.bat`~~ | **已删除** | 作者没有自己的电脑，项目是在 DSH App（Android）里做的 —— 那两个脚本**无法实测**，靠用户反馈连试三轮仍未跑通。与其留一条没人能验证的路，不如删掉。详见下面「Windows 已知坑」 |

> ### Windows：脚本已移除，细节见专项文档
>
> `scripts/install.ps1` 与 `install.bat` **已经删掉**，Windows 用户改走
> `node scripts/install.mjs`。原因与那三轮真实反馈换来的**五条坑**，
> 全部写在 **[`docs/windows.md`](./docs/windows.md)** —— 一份文档，一处维护，
> 不要在这里再抄一遍。
>
> 只在这里留两条最容易忘的：
>
> - **`-text` 而不是 `text eol=crlf`。** 后者只转检出，**blob 里仍是 LF**，
>   `git pull` 过的人和 raw 下载的人拿不到修复。
> - **跨平台脚本的入口判断必须用 `pathToFileURL(process.argv[1]).href`。**
>   写成 `` `file://${process.argv[1]}` `` 在 Windows 上永不成立，后果是
>   **exit 0、零输出、零报错**。
>
> 📌 将来若要恢复 Windows 脚本：**先在一台有 Windows 的机器上真跑通，再提交**。
> `tests/portability.test.mjs` 里那几条 `.ps1` 断言是条件式的 —— 现在跳过，
> 文件一加回来立刻生效。这个仓库在这一件事上已经浪费了三轮。

> **抄本漂移是唯一一类"不会报错"的失效。** `preset/cyrene-work/` 的工具行整段抄自内置
> standard，DSH 升级后内置变了这份不会变 —— 表现是静默少挂一个工具。上面那条漂移护栏
> 就是为此设的：**它只在装了 DSH 的机器上跑**，所以别把它当成 CI 覆盖到了。

> 验证安装脚本时**务必用临时 `DSH_HOME`**（`DSH_HOME=/tmp/xxx scripts/install.sh`），
> 否则会覆盖真实 `~/.dsh/.agent-presets/` 下你正在用的预设。

## 提交前

- `npm test` 全绿、`npm run harness:check` 通过。
- 版本号只需要改 `package.json`（`version` 与 `dsh.version`）、`plugin.json`、`dsh.plugin.json`
  三处 —— `index.js` 从 `package.json` 读，不用手改。
