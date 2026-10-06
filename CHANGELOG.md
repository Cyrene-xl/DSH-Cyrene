# 更新记录

这里记**面向使用者**的变化：要不要升级、升级能解决什么。逐条 commit 的过程看
`git log`（每条说明都写得比较长），已知的坑看 [`docs/pitfalls.md`](./docs/pitfalls.md)
与 [`docs/windows.md`](./docs/windows.md)。

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
