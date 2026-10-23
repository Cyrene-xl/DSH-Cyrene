# 发布契约与能力披露（DSH STORE）

这份文档回答 DSH STORE 固定源检查里的几个问题：**兼容范围、运行文件、依赖、权限、
外部服务、失败边界，以及一次性 Profile 的安装/卸载证据**。它不是安全审计，也不是
"已通过人工审核"的声明 —— 只是一个可核对的清单。

## 兼容范围

| 项 | 声明 | 说明 |
| --- | --- | --- |
| Node.js | `>=22` | 仓库零运行时依赖，测试用 `node:test`，需要 22 内置的测试运行器 |
| DSH | `>=0.1.0 <0.3.0` | 在 **0.1.5-rc.2** 上实测（Android App / web profile）；0.2.0+ 的声明式预设由 `scripts/install.mjs` 分支处理 |
| Profile | `web` | 预设与客户端半边都按 web profile 验证；其它 profile 未验证 |
| 固定源 | Commit | 安装请固定到 [`install-source.md`](./install-source.md) 里的 40 位 Commit，不要用浮动 `main` |

`package.json` 的 `engines` 里同时声明了 `node` 与 `dsh` 两个范围 —— DSH STORE 的
自动检查要求"显式声明"，缺 `engines.dsh` 会被判
`DSH compatibility is not explicitly declared`。

## 运行文件（`files`）

`package.json` 的 `files` 显式列出分发面；`exports` 的每个目标都必须是**文件**
（目录形式的 export，例如 `"./worldbook/": "./worldbook/"`，会被判
`runtime artifact path is invalid`，本仓库已移除）。

运行时入口：

| 文件 | 作用 |
| --- | --- |
| `index.js` | 主机半边：`/cyrene-scene-api`、`/cyrene-nickname-api`、`/cyrene-edit-api`、编辑图标 |
| `client.js` | 浏览器半边：设置 → 通用里的两行、编辑按钮与版本箭头 |
| `memory.js` / `nickname.js` / `scene.js` / `style.js` | 会话级插件（由预设挂载） |
| `worldbook/*.mjs`、`worldbook/data/*.md` | 世界书解析/匹配/注入 + 随包数据（只读） |
| `preset/chat/`、`preset/cyrene-work/` | 两套 agent 预设（人设 + 工具挂载） |
| `styles/` | 五档风格提示词（随包发运） |
| `assets/edit-icon.png` | 编辑按钮图标（由主机半边发运） |
| `scripts/install.mjs` 等 | 安装/导出/体检脚本（**不在运行时加载**） |

本地自检：`npm run verify:package`（检查 engines / exports 全为文件 / files 覆盖
所有 export 目标 / 无生命周期脚本 / 无运行时依赖）。

## 依赖与外部服务

- **零运行时依赖**：`dependencies` / `optionalDependencies` 都为空；只用 `node:` 内置模块。
- **零生命周期脚本**：`preinstall` / `install` / `postinstall` / `prepare` 都没有。
- **无外部服务**：不访问任何第三方 API、不上传任何数据。文档里提到的联网搜索由
  DSH 自带的 `@deepseek-ai/dsh-tool-web` 提供，属于部署方能力，不在本包内。

## 权限披露（源码扫描信号）

DSH STORE 的固定源扫描会读运行时代码并标记四类能力信号。本包的实际信号：

| 信号 | 是否出现 | 说明 |
| --- | --- | --- |
| `files` | **是** | 记忆 / 风格 / 开关 / 扉页都落在 `<DSH_HOME>` 下的 md/json 文件（读-改-写）；世界书数据只读 |
| `network` | **是** | `client.js` 用 `fetch` 调用**本机** `/cyrene-*-api`（同一进程的 webServer），没有外部域名 |
| `commands` | 否 | 不 spawn 任何子进程；`scripts/` 里的脚本只在用户手动执行安装/体检时运行 |
| `credentials` | **否** | 只读 `DSH_HOME` / `HOME`（宿主变量），不读别的环境变量，不接触任何 token / 密钥 |

> 之前扫描确实命中过 `credentials`：`memory.js` 读了一个自定义环境变量
> `DSH_CYRENE_PAGE_QUOTA`。那不是凭据，但按扫描口径会被算作"读环境"信号，所以
> 该变量已移除（配额固定 64 KB）。

`files` 与 `network` 是**功能本身决定的**：一个落盘记忆 + 设置页接口的插件无法同时
满足"零文件、零网络"。按 DSH STORE 的规则，这类项目可能仍保持 `blocked` /
人工复核状态；上面的披露用于让人工复核有据可查，不构成自动批准。

## 失败边界

| 场景 | 行为 |
| --- | --- |
| 状态文件不存在 / 损坏 | 退回默认值（记忆为空、开关关、风格默认），不抛错 |
| `<DSH_HOME>` 不可写 | 写入函数返回失败并给出提示；不崩溃、不改其它文件 |
| 没有 `webServer` 服务 | 设置页接口不注册，预设与人设照常工作 |
| 没有 `sessions` 服务 | 编辑/版本功能不注册，其余功能不受影响 |
| 没有 `commands` 服务 | `/style` 入口消失，风格注入仍按会话状态生效 |
| 会话在跑工具时编辑 | 明确拒绝（409 / 提示原因），不写日志 |
| DSH 版本不在声明范围内 | 未验证；预设挂载可能失败，插件不会尝试修改 DSH 自身 |

## 一次性 Profile 的安装 / 启动 / 卸载证据

CI 里用**临时 `DSH_HOME`**跑，不碰真实 profile：

```bash
DSH_HOME=$(mktemp -d)
node scripts/install.mjs            # 安装预设
ls "$DSH_HOME/.agent-presets"       # chat / cyrene-work 出现
node scripts/install.mjs            # 幂等：应输出「已是最新」
node scripts/install.mjs --uninstall
[ ! -e "$DSH_HOME/.agent-presets/chat" ] && echo "卸载干净"
```

对应的 workflow 步骤：`.github/workflows/test.yml` 里
「`install.mjs` 在 Windows 上试装（临时 DSH_HOME）」与
「发布契约自检 + 临时 Profile 试装/卸载」。

"启动"这一项 CI 只能做到**模块可加载**（`node --check` 全部入口 +
`import('./index.js')`），真实的 DSH 启动验收在设备上完成（DSH 0.1.5-rc.2 / web profile）；
DSH STORE 的自动通道本身也不执行安装或运行时代码，所以这里不把它写成 `passed`。
