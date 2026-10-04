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
| 预设 YAML `preset/agent.cordis.yml` | **下次新建会话**，不用重启（但已加入的会话保留旧组装） |
| 插件源码 `.js` / `.mjs` | **必须重启** —— loader 用裸 `import()`，没有缓存击穿 |

## 来源与边界

- **人设文本与世界书数据来自 Cyrene-Agent（MIT）**，不是本项目原创。字段的**语义**
  （含 `连带触发词` 的 One-Shot 定义）也来自上游。改任何相关文案前先读
  [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)。
- **不要往预设正文里手写没注册过的 `{{...}}`** —— DSH 遇未注册变量会在**装配期直接抛错**，
  表现不是加载失败，而是这个模式下每一轮对话都失败。要加变量，先加注册它的插件。
- 世界书是**纯函数 + 薄注入层**：`worldbook/{parse,match,assemble}.mjs` 不碰 DSH API；
  只有 `worldbook/index.mjs` 与 DSH 交互。
- 角色 IP 归 HoYoverse / 米哈游所有，**含角色 IP 的衍生物禁止商业使用**。

## 提交前

- `npm test` 全绿、`npm run harness:check` 通过。
- 版本号只需要改 `package.json`（`version` 与 `dsh.version`）、`plugin.json`、`dsh.plugin.json`
  三处 —— `index.js` 从 `package.json` 读，不用手改。
