# 参与这个项目

## 先说维护边界（重要）

**作者能验证的环境只有一种：DSH App（Android）。**

没有自己的电脑，整套东西都是在 DSH App 里做的 —— 本地没有 Windows、没有
PowerShell、也没有 macOS。所以：

| 范围 | 谁维护 |
| --- | --- |
| 插件本体、两套预设、世界书、记忆、安装脚本（`install.sh` / `install.mjs`） | 作者 |
| **桌面端（Windows / macOS / Linux）的各种差异** | **社区** —— 欢迎 PR，作者无力代劳 |
| DSH 各版本之间的行为差异（0.1.x ↔ 0.2.0+） | 作者尽力跟进，但需要你反馈实测结果 |

这不代表拒绝桌面端 —— `install.mjs` 跨平台，CI 也**在真实 Windows 上跑测试**
（见下）。只是"作者声称支持"和"作者验证过"是两件事，这里不想混为一谈。

已知的桌面端差异与坑，全部记在 [`docs/windows.md`](./docs/windows.md) ——
动手前先读它。

## 提交前**必须**做什么

```bash
npm test              # 全部单元测试（当前 73 条）
npm run harness:check # 全部运行时代码的语法检查
```

两条都要跑，**不要只跑改动的那一个文件**。本仓库在这上面吃过亏：改一个导出、
忘改一个 import，会让**所有**测试一起失败，看起来像"命令写法不对"，容易查错方向。

另外：`node --test tests/`（带尾斜杠）会挂，用 `npm test`。

## 涉及平台的改动：先真机跑通，再提交

这条是硬规则，因为吃到过三次教训：

> **不要凭着"看着没问题"就提交平台相关的改动。**
> 本仓库曾为一个 `install.ps1` 连续踩三轮 —— LF 行尾、跨行管道、here-string、
> `if` 当表达式赋值 —— 每一轮都是"人工审查通过、真机失败"。

- 平台相关的**可执行脚本**（`.ps1` / `.bat` / `.sh`）：**必须在你自己的那个平台上
  跑通**再提。CI 覆盖不到的部分，作者无法替你验证。
- 平台相关的**Node 代码**：CI 会在 `ubuntu-latest` 与 `windows-latest` 上各跑一遍，
  但**测试断言得由你写** —— 光断言退出码抓不到"exit 0 但零输出"这类问题。

## CI 会替作者跑 Windows

`.github/workflows/test.yml` 里除了 ubuntu 的 Node 22/24 矩阵，还有一个
`windows-latest` job。它做四件事，每一步都对应一个真实踩过的坑：

1. `npm run harness:check` + `npm test`
2. **声明导出必须真的有输出**（入口判断曾在 Windows 上静默零输出）
3. `install.mjs` 用临时 `DSH_HOME` 试装：安装 → 幂等复跑 → 卸载
4. 行尾等可移植性断言（在 `tests/portability.test.mjs` 里）

也就是说：**你不需要有 Windows，CI 会告诉你错在哪。** 加平台相关改动时，
把它能验证的部分写成断言，比写一段说明有用得多。

## 有哪些东西不该提交

- **个人配置**：`~/.dsh/dream-skin.json`、`anime-theme/config.json`、`cyrene-memory.md`
  之类含有你的壁纸历史、昵称、记忆内容。**分享参数，不分享文件。**
- **第三方资源**：表情图库、壁纸图片。本仓库**不捆绑、不再分发**任何第三方表情或
  美术资源，详见 [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)。
- **上游人设文本的改动**：`preset/*/agent.cordis.yml` 里的人设正文来自
  Cyrene-Agent（MIT）。**本项目一律追加自己的段落，不改上游正文** —— 想调整就往
  文件末尾加块，并标明「本项目补充，非上游正文」。原因见
  [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) 第 1 节。

## 报 bug 时请带上

- DSH 版本（如 `0.2.0-rc.2`）与跑的 profile（如 `web` / `desktop`）
- 操作系统
- 完整的报错原文（不要只写"不行"）
- 你实际执行了什么命令、期望什么、实际发生什么

桌面端的问题尤其需要这些 —— 作者无法复现，只能靠你的信息定位。
