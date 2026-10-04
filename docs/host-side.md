# dsh-cyrene-chat — 宿主半体，与两个会话级插件

## 核心还是那份预设

真正起作用的东西是 `preset/` 目录里的那份 agent 预设：它通过 `dsh-persona` 的
`complete: true` 装配路径**整份替换系统提示词**，从而达到"纯角色对话、不叠加编码
代理身份"的效果。

## 那为什么还会有宿主逻辑

因为预设正文引用了两个模板变量，而 DSH 的 `dsh-system-prompt` 只注册了
`provider` / `model` / `cwd` 三个。**引用未注册的变量会在装配期直接抛错** ——
表现不是预设加载失败，而是这个模式下**每一轮对话都报错**（见
`dsh-system-prompt` 里的 `unknown prompt variable "{{…}}"`）。

所以变量必须有人注册，这是无法回避的宿主逻辑：

| 变量 | 注册者 | 作用 |
| --- | --- | --- |
| `{{user_nickname}}` | `nickname.js` | 可配置称呼，默认「伙伴」 |
| `{{cyrene_memory}}` | `memory.js` | 长期记忆，外加 `remember` / `forget` 两个工具 |

### 这两块逻辑刻意挂在哪

挂在**预设里**（`preset/agent.cordis.yml` 末尾的两条 `insert`），不是挂在包自己的
`cordis.patch.yml` 里。

因为 `systemPrompt.variable()` 与 `tools.register()` 都注册进**调用作用域**，
挂在预设里，这两个变量和两个工具就只属于该预设的会话：工作模式看不到它们，
也拿不到 `remember` / `forget`。若挂在 bundle 里，则会污染每一个模式。

### 为什么这里一处外部依赖都没有

`memory.js` 与 `nickname.js` 只用 `node:` 内置模块，**不 import
`@deepseek-ai/dsh-tools`**。原因很实际：

- 插件模块被解析时，Node 从它的**真实路径**往上逐级找 `node_modules`。
  用户把本包装进 profile 后，往上能碰到 `<DSH_HOME>/node_modules/@deepseek-ai`，
  所以 import 本来是能用的；
- 但开发时用 `link:` 安装，真实路径落在仓库目录，那里往上没有 `@deepseek-ai`，
  就会 `ERR_MODULE_NOT_FOUND`；
- 而 npm 上的 `@deepseek-ai/dsh-tools` 只有 `0.0.1-rc.1`，与运行时版本对不上，
  不能当依赖声明。

与其赌目录布局，不如不依赖：`defineTool` 做的事只是把参数 DSL 翻成 JSON Schema，
这里直接写描述符，交给 `tools.register()` 校验（它只要求 `output` 带 `schema` 与
`render`，并校验 schema 合法）。

## 包的锚点仍然是空壳

`index.js` 依旧不做任何运行时改动，只作为 profile bundle 的可加载锚点，
外加一行启动日志（提示用户去装预设）。真正干活的宿主逻辑都在上面那两个
会话级插件里。

## 预设的安装不在这里

DSH **没有公开的"安装预设"API**（`dsh-agent-presets` 只按
`~/.dsh/.agent-presets/<id>/` 目录扫描发现，不对外暴露写入接口）。

所以预设由 `scripts/install.*` 拷贝，而不是由本插件在运行时写入 ——
插件启动时去写 DSH 主目录属于越界行为，本项目不做。

> 注意：随包预设里的插件引用写的是 `dsh-cyrene-chat/memory` 这样的**包名**，
> 这要求本包已经装进目标 profile（正常流程都是如此）。如果只手动拷了预设、
> 没装包，该模式下每一轮对话都会因变量未注册而报错。
