# 改这个仓库前必须知道的几件事

这份文档记录的是**实测出来的 DSH 行为** —— 它们不在 DSH 官方文档里，都是踩出来的。
每条都注明了源码位置，方便你自己复核。

---

## 一、三个 DSH 行为，会让你写出"看着对、其实静默失效"的代码

### 1. 装配跑在用户消息落库之前

```
dsh-agent-loop/lib/index.js:889    assemble()                      ← provider 在这里被调用
dsh-agent-loop/lib/index.js:1028   session.append("user/message")  ← 用户消息到这里才进会话
```

后果：任何在**装配期求值**的 provider（`systemPrompt.variable()` / `systemPrompt.context()`）
去读会话时，**本轮用户消息还没写进去**。新会话的第一轮更是一条用户消息都没有。

**最阴的是它静默失效**：`context()` 返回空文本时，`renderContextSections()` 会把该 section
直接过滤掉 —— 快照里看不出任何异常，UI 上也不会报错，表现就是"什么都没有发生"。

所以：**需要本轮用户消息的注入，不能走 `variable()` / `context()`。**

- 走 `agent/pre-step` —— 它的 `messages` 参数就是本轮 claimed 输入
- 或走 `llm/stream` —— 改写出站请求（但有下面第 2 条的坑）

> 本仓库的世界书插件第一版就是在这里坏的：`context()` 里读会话做关键词匹配，
> 新会话第一轮永远匹配不到东西。现在拆成常驻块（走 `context()`，不需要本轮消息）
> 与命中块（走 `agent/pre-step`）。

### 2. `llm/stream` 里的 `options.messages` 是**冻结**的

原地改会直接抛：

```
Cannot add property 2, object is not extensible
```

所以 `llm/stream` 想改请求，只有一条路：**重建请求对象，再重调 `llm.stream(newRequest)`**。

而 `llm.stream()` 本身就是瀑布入口（`dsh-llm` 的 `streamWithRegistration()` 里
`ctx.waterfall(this, "llm/stream", …)`），所以那一步是**从瀑布顶端重新进入**。两个后果：

1. 必须用 `WeakSet` 之类的守卫挡住自递归；
2. 排在它前面的 `llm/stream` 处理器会对**改写后的**请求再跑一遍。DSH 自带的那两个
   （`session-title` 的记账、`checkpoint-policy` 的 flush）都是幂等的，所以现在无害 ——
   但这是运气，不是保证。

### 3. 预设作用域里调用 `ctx.provide()` 会让**整个预设挂载失败**

`dsh-agent-presets` 的 `mountPreset()` 挂载完成后会做一次 `leakedServices` 校验：
凡是在预设 fiber 内发布、且落进**根 isolate realm** 的服务，一律判为"污染进程全局"，
直接抛错。

**后果不是"这个插件坏了"，而是整个预设不可用 —— 连新建会话都会出问题。**
本项目踩过一次，排查了很久。

> 预设级插件只注册 `context` / `variable` / `tool`。真要发布服务，
> 得用 `isolate` realm，或者把插件搬到 host composition（profile 级）。

---

## 二、两条注入通道怎么选

| 通道 | 拿得到本轮消息 | 污染会话历史 | 被 `includeRuntimeContext:false` 压掉 | 前缀缓存 |
| --- | --- | --- | --- | --- |
| `systemPrompt.variable()` | ✗ | 否 | 否 | 差（改人设＝改头部） |
| `systemPrompt.context()` | ✗ | 否（有去重） | **是**（整体清空） | 好（尾部） |
| `agent/pre-step` | **✓** | **是**（每轮追加） | 否 | 好（尾部） |
| `llm/stream` 改写 | **✓** | 否 | 否 | 好（尾部） |

实测数据（同一任务、只改注入位置，3 步累计的全价 input token）：
改头部约 **19,785**，改尾部约 **2,460** —— 差约 8 倍。**注入位置决定缓存生死。**

`context()` 的快照是 **append 型** surface 事件：内容一变就追加一条新的，旧的不会自动消失。
所以不稳定的内容别和稳定的内容揉在同一条 `context()` 里，否则每次变化都连带重发。

---

## 三、"改预设能热生效，改插件不能"——这条边界很不直观

| 改什么 | 生效方式 |
| --- | --- |
| 预设 YAML（`agent.cordis.yml`） | **下次新建会话**即可，不用重启。`ensureStanding` 会比对文件指纹（mtime+size），不一致就重挂一份 |
| 插件源码（`.js` / `.mjs`） | **必须重启**。DSH 的 loader 用裸 `import()`，没有缓存击穿；线上 profile 的 HMR 也是 `disabled: true` |

两个附加事实：

- **已经加入的会话保留它运行的那一代组装** —— 改完预设也必须开新会话才看得到。
- 被取代的旧代次**在进程存活期间不会被回收**（只有整棵树 teardown 才释放）。
  改几次无所谓，改得多了值得重启一次清掉。

---

## 四、改完必须全量跑

这一条是本仓库反复吃亏的地方。**改一个导出、忘改一个 import，会让所有测试命令一起失败**，
而这种失败看起来像"测试命令写法不对"，很容易误判方向（本项目就误判过一次）。

```bash
npm test              # 全部单元测试
npm run harness:check # 全部运行时代码的语法检查
```

另外：**`node --test tests/`（带尾斜杠）会挂**，Node 会把目录当模块解析：

```
MODULE_NOT_FOUND: Cannot find module '…/tests'
```

要用 `npm test`，或 `node --test "tests/*.mjs"`（引号让 Node 自己展开 glob，跨平台）。

---

## 五、其它零碎但容易踩的

- **世界书数据目录**按 `import.meta.url` 相对模块解析，不拼 `DSH_HOME` —— 这样装进
  profile 的 `node_modules` 与从仓库绝对路径加载指向同一份数据，不会各自漂移。
- **上游格式**见 [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md) 第 1 节：
  条目字段的语义（含 `连带触发词` 的 One-Shot 定义）来自 Cyrene-Agent，不是本项目发明的。
- **`内在价值` 字段在本实现里不起作用** —— 上游只在 DMAE 状态机里消费它，本实现没有状态机。
  `优先级` 则从上游的 tiebreaker 变成了主排序键。
- 世界书那部分是**纯函数 + 薄注入层**：`worldbook/{parse,match,assemble}.mjs` 不碰任何
  DSH API，可以直接单测；只有 `worldbook/index.mjs` 与 DSH 交互。改匹配逻辑改前者，
  改注入时机改后者。

## 六、往会话里塞消息，**必须自己生成 `id`**

这条单独列出来，因为它是本项目**唯一一次造成真实数据损坏**的坑：3 个会话因此
再也打不开，而报错信息完全看不出跟本插件有关。

DSH 自己的消息都走 `dsh-llm` 的 `createMessage()`，它内部会赋：

```js
function createMessage(input) {
  return freezeMessage({ ...input, id: brandString(randomUUID()) });
}
```

而 `worldbook/index.mjs` 的命中块是**手写描述符**（因为要避开 `link:` 安装下解析不到的
`@deepseek-ai/dsh-llm`），绕过了那个工厂。少写一个 `id`，后果是：

1. 这条 `user/message` **带着缺 id 的原样**写进会话事件；
2. 之后任何一次历史加载都会在 `dsh-session` 的 `assertMessageEventShape` 上被拒：

   ```
   session event at seq N lacks an identified message
   ```

   该校验要求消息类事件（`system/message` / `user/message` / `assistant/message` /
   `tool/result`）的 `id` 是**非空字符串**；`user/message` 的 data 本身就是消息，
   其余三种取 `data.message`。
3. 表现是**那个会话永久打不开**（"历史加载失败"），而错误里只有 seq 号，
   没有任何线索指向注入方。

**所以：手写消息描述符时，`id: randomUUID()`（`node:crypto`）不是可选项。**
`tests/worldbook.test.mjs` 里有一条专门守着它。

> 已损坏的会话可以离线修：逐帧解压，给缺 id 的那条补一个 `randomUUID()`，
> 只重写含它的那一帧，其余帧原样保留。修完要逐条比对，确认除 `id` 外**零差异**。
